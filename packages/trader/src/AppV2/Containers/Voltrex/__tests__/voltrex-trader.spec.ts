import type { TScanRow } from '../use-voltrex-scanner';
import { analyseMarket } from '../voltrex-analysis';
import { TRiseFallSpec } from '../voltrex-contracts';
import { DEFAULT_RISK, emptyRiskState, TRiskSettings } from '../voltrex-risk';
import { TOrder, TTraderOptions, TTraderSnapshot, VoltrexTrader } from '../voltrex-trader';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

type TFakeRunner = {
    options: Parameters<NonNullable<TTraderOptions['createRunner']>>[0];
    start: jest.Mock;
    stop: jest.Mock;
};

const SPEC: TRiseFallSpec = { ticks: { min: 1, max: 10 }, minutes: { min: 1, max: 60 } };

const candles = (up: boolean) =>
    Array.from({ length: 120 }, (_item, index) => {
        const close = up ? 100 + index + 0.03 * index ** 2 : 400 - index - 0.03 * index ** 2;
        return { epoch: index * 300, open: close, high: close + 0.2, low: close - 0.2, close };
    });

const row = (symbol: string, up = true, overrides: Partial<TScanRow> = {}): TScanRow =>
    ({
        symbol,
        name: symbol,
        category: 'volatility',
        market_name: 'Derived',
        is_open: true,
        pip_size: 2,
        status: 'ready',
        price: 100,
        change_pct: 1,
        signal: analyseMarket(candles(up), candles(up)),
        volatility_level: 'medium',
        is_live: true,
        ...overrides,
    }) as TScanRow;

const order = (overrides: Partial<TOrder> = {}): TOrder => ({
    symbol: 'R_100',
    name: 'Volatility 100 Index',
    side: 'CALL',
    stake: 1,
    duration: 5,
    duration_unit: 't',
    source: 'manual',
    why: 'test',
    ...overrides,
});

const setup = (config: Partial<TTraderOptions> & { risk?: Partial<TRiskSettings>; rows?: TScanRow[] } = {}) => {
    const runners: TFakeRunner[] = [];
    const snapshots: TTraderSnapshot[] = [];
    let rows = config.rows ?? [];
    const risk = { ...DEFAULT_RISK, max_open_trades: 3, max_daily_loss: 20, ...config.risk };
    const trader = new VoltrexTrader({
        api: {} as never,
        currency: 'USD',
        is_virtual: true,
        getBalance: () => 1000,
        getRisk: () => risk,
        getRows: () => rows,
        getSpec: async () => SPEC,
        initial_risk: emptyRiskState(),
        onChange: snapshot => snapshots.push(snapshot),
        createRunner: options => {
            const runner = { options, start: jest.fn(), stop: jest.fn() };
            runners.push(runner);
            return runner;
        },
        symbol_cooldown_ms: 1000,
        ...config,
    });
    return {
        trader,
        runners,
        snapshots,
        setRows: (next: TScanRow[]) => {
            rows = next;
        },
        last: () => trader.getSnapshot(),
    };
};

/** Simulates the engine buying the contract and then finishing it. */
const finish = (runner: TFakeRunner, profit: number, contract_id = 1) => {
    const status = profit >= 0 ? 'won' : 'lost';
    runner.options.onTransaction?.({
        contract_id,
        contract_type: 'CALL',
        symbol: 'x',
        buy_price: 1,
        payout: 1.95,
        profit: 0,
        entry_spot: '1',
        exit_spot: '',
        status: 'open',
        time: '',
    });
    runner.options.onTransaction?.({
        contract_id,
        contract_type: 'CALL',
        symbol: 'x',
        buy_price: 1,
        payout: 1.95,
        profit,
        entry_spot: '1',
        exit_spot: '2',
        status,
        time: '',
    });
    runner.options.onStats?.({
        runs: 1,
        won: profit >= 0 ? 1 : 0,
        lost: profit < 0 ? 1 : 0,
        total_profit: profit,
        total_stake: 1,
        total_payout: 1.95,
    });
    runner.options.onStatus('stopped');
};

describe('placing a manual trade', () => {
    it('starts one engine run with a one-trade program, a stake cap and a loss cap equal to the stake', () => {
        const { trader, runners } = setup();
        const result = trader.place(order({ stake: 2 }), SPEC);
        expect(result.ok).toBe(true);
        expect(runners).toHaveLength(1);
        expect(runners[0].start).toHaveBeenCalledTimes(1);
        expect(runners[0].options.limits).toEqual({ max_trades: 1, max_stake: 2, max_loss: 2 });
        expect(runners[0].options.program.setup).toMatchObject({ symbol: 'R_100', contract_type: 'CALL' });
        expect(runners[0].options.program.before_purchase).toEqual([{ t: 'purchase', contract_type: 'CALL' }]);
        expect(runners[0].options.program.options).toMatchObject({
            duration_unit: 't',
            duration: { t: 'num', v: 5 },
            amount: { t: 'num', v: 2 },
        });
    });

    it('follows the contract from placing to open, and records a win once', () => {
        const { trader, runners, last } = setup();
        trader.place(order(), SPEC);
        expect(last().trades[0].status).toBe('placing');
        finish(runners[0], 0.95);
        const snapshot = last();
        expect(snapshot.trades[0]).toMatchObject({ status: 'won', profit: 0.95, contract_id: 1 });
        expect(snapshot.risk).toMatchObject({ realised_profit: 0.95, consecutive_losses: 0, open_stakes: [] });
    });

    it('records a loss and counts it in the streak', () => {
        const { trader, runners, last } = setup();
        trader.place(order(), SPEC);
        finish(runners[0], -1);
        expect(last().trades[0]).toMatchObject({ status: 'lost', profit: -1 });
        expect(last().risk).toMatchObject({ realised_profit: -1, consecutive_losses: 1 });
    });

    it('marks a run that placed nothing as failed and records no result', () => {
        const { trader, runners, last } = setup();
        trader.place(order(), SPEC);
        runners[0].options.onStatus('stopped');
        expect(last().trades[0].status).toBe('failed');
        expect(last().risk).toMatchObject({ realised_profit: 0, consecutive_losses: 0, open_stakes: [] });
    });

    it('gives up a run that never opens a contract', () => {
        jest.useFakeTimers();
        const { trader, runners } = setup({ entry_timeout_ms: 1000 });
        trader.place(order(), SPEC);
        jest.advanceTimersByTime(1001);
        expect(runners[0].stop).toHaveBeenCalled();
        jest.useRealTimers();
    });
});

describe('refusing an order', () => {
    it('refuses, without starting anything, when a risk limit or a rule is broken', () => {
        const { trader, runners } = setup({ risk: { max_stake: 5 } });
        const cases: [Partial<TOrder>, TRiseFallSpec | null][] = [
            [{ stake: 6 }, SPEC],
            [{ stake: 0 }, SPEC],
            [{ duration: 99 }, SPEC],
            [{ duration_unit: 'm', duration: 90 }, SPEC],
            [{}, null],
        ];
        cases.forEach(([change, spec]) => expect(trader.place(order(change), spec).ok).toBe(false));
        expect(runners).toHaveLength(0);
    });

    it('refuses a second trade on a market that already has one, even when called twice at once', () => {
        const { trader, runners } = setup();
        const first = trader.place(order(), SPEC);
        const second = trader.place(order(), SPEC);
        expect(first.ok).toBe(true);
        expect(second).toMatchObject({ ok: false, scope: 'market' });
        expect(runners).toHaveLength(1);
    });

    it('lets the market be traded again once the first trade has finished', () => {
        const { trader, runners } = setup();
        trader.place(order(), SPEC);
        finish(runners[0], 1);
        expect(trader.place(order(), SPEC).ok).toBe(true);
    });

    it('counts trades that are still being placed against the open-trade limit', () => {
        const { trader, runners } = setup({ risk: { max_open_trades: 1 } });
        expect(trader.place(order({ symbol: 'R_10' }), SPEC).ok).toBe(true);
        expect(trader.place(order({ symbol: 'R_25' }), SPEC)).toMatchObject({ ok: false, scope: 'account' });
        expect(runners).toHaveLength(1);
    });

    it('counts open stakes against the daily loss limit', () => {
        const { trader } = setup({ risk: { max_daily_loss: 3, max_stake: 5, max_open_trades: 5 } });
        expect(trader.place(order({ symbol: 'R_10', stake: 2 }), SPEC).ok).toBe(true);
        expect(trader.place(order({ symbol: 'R_25', stake: 2 }), SPEC).ok).toBe(false);
        expect(trader.place(order({ symbol: 'R_50', stake: 1 }), SPEC).ok).toBe(true);
    });

    it('never lets auto orders onto a real account', () => {
        const { trader, runners } = setup({ is_virtual: false });
        const result = trader.place(order({ source: 'auto', strength: 90 }), SPEC);
        expect(result.ok).toBe(false);
        expect(runners).toHaveLength(0);
        expect(trader.place(order(), SPEC).ok).toBe(true);
    });
});

describe('emergency stop', () => {
    it('cancels trades that are not bought yet, switches auto off and refuses new orders at once', () => {
        const { trader, runners, last } = setup();
        trader.place(order({ symbol: 'R_10' }), SPEC);
        trader.place(order({ symbol: 'R_25' }), SPEC);
        trader.emergencyStop();
        expect(runners[0].stop).toHaveBeenCalled();
        expect(runners[1].stop).toHaveBeenCalled();
        expect(last().risk.emergency_stop).toBe(true);
        expect(last().auto).toBe('off');
        expect(trader.place(order({ symbol: 'R_50' }), SPEC)).toMatchObject({ ok: false });
        expect(runners).toHaveLength(2);
    });

    it('leaves a contract that is already open to finish, and records its result', () => {
        const { trader, runners, last } = setup();
        trader.place(order(), SPEC);
        runners[0].options.onTransaction?.({
            contract_id: 7,
            contract_type: 'CALL',
            symbol: 'R_100',
            buy_price: 1,
            payout: 1.95,
            profit: 0,
            entry_spot: '1',
            exit_spot: '',
            status: 'open',
            time: '',
        });
        trader.emergencyStop();
        expect(runners[0].stop).not.toHaveBeenCalled();
        finish(runners[0], 0.95, 7);
        expect(last().trades[0].status).toBe('won');
    });

    it('allows trading again only after it is reset', () => {
        const { trader } = setup();
        trader.emergencyStop();
        expect(trader.place(order(), SPEC).ok).toBe(false);
        trader.resetEmergency();
        expect(trader.place(order(), SPEC).ok).toBe(true);
    });

    it('refuses to start auto-trading while it is on', () => {
        const { trader, last } = setup();
        trader.emergencyStop();
        expect(trader.startAuto({ strategy: 'confluence', stake: 1, categories: ['volatility'] })).not.toBeNull();
        expect(last().auto).toBe('off');
    });
});

describe('auto-trading', () => {
    const config = { strategy: 'confluence' as const, stake: 1, categories: ['volatility' as const] };
    const flush = () =>
        new Promise(resolve => {
            setTimeout(resolve, 0);
        });

    it('refuses to start on a real account or with a stake above the maximum', () => {
        expect(setup({ is_virtual: false }).trader.startAuto(config)).not.toBeNull();
        expect(setup().trader.startAuto({ ...config, stake: 99 })).not.toBeNull();
        expect(setup().trader.startAuto({ ...config, categories: [] })).not.toBeNull();
    });

    it('trades the strongest qualifying market, on the side the strategy says, and only one per look', async () => {
        const { trader, runners } = setup({
            rows: [row('R_10', true), row('R_25', false), row('R_50', true, { status: 'unavailable' })],
        });
        expect(trader.startAuto(config)).toBeNull();
        await flush();
        await flush();
        expect(runners).toHaveLength(1);
        expect(['CALL', 'PUT']).toContain(runners[0].options.program.setup.contract_type);
        expect(trader.getSnapshot().trades[0].source).toBe('auto');
        trader.dispose();
    });

    it('ignores categories that were not chosen and signals below the minimum strength', async () => {
        const { trader, runners } = setup({
            rows: [row('frxEURUSD', true, { category: 'forex' })],
            risk: { min_strength: 50 },
        });
        trader.startAuto(config);
        await flush();
        expect(runners).toHaveLength(0);
        trader.dispose();

        const strict = setup({ rows: [row('R_10', true)], risk: { min_strength: 100 } });
        strict.trader.startAuto(config);
        await flush();
        expect(strict.runners).toHaveLength(0);
        strict.trader.dispose();
    });

    it('does not open a second trade on a market that has one open', async () => {
        const { trader, runners } = setup({ rows: [row('R_10', true)] });
        trader.startAuto(config);
        await flush();
        await trader.cycle();
        await trader.cycle();
        expect(runners).toHaveLength(1);
        trader.dispose();
    });

    it('stays away from a market for the cooldown after closing a trade on it', async () => {
        let clock = 1_000_000;
        const { trader, runners } = setup({ rows: [row('R_10', true)], now: () => clock, symbol_cooldown_ms: 5000 });
        trader.startAuto(config);
        await flush();
        finish(runners[0], 1);
        await trader.cycle();
        expect(runners).toHaveLength(1);
        clock += 5001;
        await trader.cycle();
        expect(runners).toHaveLength(2);
        trader.dispose();
    });

    it('stops by itself after the allowed number of losses in a row', async () => {
        let clock = 1_000_000;
        const { trader, runners, last } = setup({
            rows: [row('R_10', true)],
            now: () => clock,
            symbol_cooldown_ms: 0,
            risk: { max_consecutive_losses: 2, max_daily_loss: 50 },
        });
        trader.startAuto(config);
        await flush();
        finish(runners[0], -1);
        expect(last().auto).toBe('running');
        clock += 1;
        await trader.cycle();
        finish(runners[1], -1, 2);
        expect(last().auto).toBe('off');
        expect(last().log.some(entry => /in a row/.test(entry.message))).toBe(true);
        await trader.cycle();
        expect(runners).toHaveLength(2);
    });

    it('stops at the daily profit target', async () => {
        const { trader, runners, last } = setup({
            rows: [row('R_10', true)],
            risk: { daily_profit_target: 1 },
        });
        trader.startAuto(config);
        await flush();
        finish(runners[0], 1.5);
        expect(last().auto).toBe('off');
    });

    it('places nothing while paused, and carries on after resume', async () => {
        const { trader, runners, last } = setup({ rows: [row('R_10', true)] });
        trader.startAuto(config);
        await flush();
        finish(runners[0], 1);
        trader.pauseAuto();
        expect(last().auto).toBe('paused');
        await trader.cycle();
        expect(runners).toHaveLength(1);
        trader.resumeAuto();
        expect(last().auto).toBe('running');
        trader.dispose();
    });

    it('does not place a trade that was found while the emergency stop was pressed', async () => {
        let release: (value: TRiseFallSpec) => void = () => undefined;
        const { trader, runners } = setup({
            rows: [row('R_10', true)],
            getSpec: () =>
                new Promise<TRiseFallSpec>(resolve => {
                    release = resolve;
                }),
        });
        trader.startAuto(config);
        trader.emergencyStop();
        release(SPEC);
        await flush();
        expect(runners).toHaveLength(0);
    });
});

describe('scan report', () => {
    const config = { strategy: 'confluence' as const, stake: 1, categories: ['volatility' as const] };
    const flush = () =>
        new Promise(resolve => {
            setTimeout(resolve, 0);
        });

    it('says why nothing was traded when markets fit the strategy but none reaches the minimum strength', async () => {
        const { trader, runners, last } = setup({ rows: [row('R_10', true)], risk: { min_strength: 100 } });
        trader.startAuto(config);
        await flush();
        const scan = last().scan;
        expect(runners).toHaveLength(0);
        expect(scan).toMatchObject({ in_scope: 1, waiting: 0, qualified: 0, min_strength: 100 });
        expect(scan?.accepted).toBe(1);
        expect(scan?.closest?.name).toBe('R_10');
        expect(scan?.note).toMatch(/none reaches your minimum strength/);
        trader.dispose();
    });

    it('reports markets that are still loading, and markets outside the chosen categories', async () => {
        const { trader, last } = setup({
            rows: [
                row('R_10', true, { status: 'loading', signal: null }),
                row('frxEURUSD', true, { category: 'forex' }),
            ],
        });
        trader.startAuto(config);
        await flush();
        expect(last().scan).toMatchObject({ in_scope: 1, waiting: 1, qualified: 0 });
        expect(last().scan?.note).toMatch(/Waiting for the first analysis/);
        trader.dispose();
    });

    it('says a trade was placed, and counts the qualifying markets', async () => {
        const { trader, last } = setup({ rows: [row('R_10', true), row('R_25', false)] });
        trader.startAuto(config);
        await flush();
        await flush();
        expect(last().scan?.qualified).toBe(2);
        expect(last().scan?.note).toMatch(/Placed a trade on/);
        trader.dispose();
    });

    it('writes the same refusal once, not on every look', async () => {
        const { trader, last } = setup({
            rows: [row('R_10', true), row('R_25', true)],
            risk: { max_open_trades: 1 },
            now: () => 5_000_000,
        });
        trader.startAuto(config);
        await flush();
        await trader.cycle();
        await trader.cycle();
        await trader.cycle();
        const refusals = last().log.filter(entry => /open trades/.test(entry.message));
        expect(refusals).toHaveLength(1);
        trader.dispose();
    });

    it('warns once, not on every look, about a market that does not offer Rise/Fall', async () => {
        const { trader, last, runners } = setup({
            rows: [row('R_10', true)],
            getSpec: async () => null,
            now: () => 7_000_000,
        });
        trader.startAuto(config);
        await flush();
        await trader.cycle();
        await trader.cycle();
        expect(runners).toHaveLength(0);
        expect(last().log.filter(entry => /not offered/.test(entry.message))).toHaveLength(1);
        trader.dispose();
    });
});
