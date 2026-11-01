import type { TApiResponse, TBotApi, TLevel, TTradeRequest } from '../../BotBuilder/Engine/types';
import { DEFAULT_SCAN, TScanFilters } from '../markets-scanner';
import { TMarketRow } from '../markets-utils';
import { ScanTrader, TScanTraderOptions, TScanTraderState } from '../scan-trader';
import { DEFAULT_AUTO, TAutoSettings, TScanSession } from '../scan-trader-logic';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

type TFakeApi = TBotApi & {
    emitTick: (quote: number) => void;
    emitContract: (update: Record<string, unknown>) => void;
    resolveBuy: (response: TApiResponse) => void;
    calls: { proposal: TTradeRequest[]; buy: [string, number][]; ticks: string[] };
    answer: { proposal: 'ok' | 'error' | 'never' };
};

const createFakeApi = (): TFakeApi => {
    const callbacks: Record<string, (response: TApiResponse) => void> = {};
    let buy_resolve: (response: TApiResponse) => void = () => undefined;
    const calls: TFakeApi['calls'] = { proposal: [], buy: [], ticks: [] };
    const answer: TFakeApi['answer'] = { proposal: 'ok' };
    const handle = { unsubscribe: () => undefined };
    return {
        subscribeTicks: (symbol, cb) => {
            calls.ticks.push(symbol);
            callbacks.tick = cb;
            return handle;
        },
        subscribeProposal: (request, cb) => {
            calls.proposal.push(request);
            if (answer.proposal === 'ok') {
                Promise.resolve().then(() =>
                    cb({ proposal: { id: `prop-${calls.proposal.length}`, ask_price: request.amount } })
                );
            } else if (answer.proposal === 'error') {
                Promise.resolve().then(() => cb({ error: { message: 'Trading is not offered for this asset.' } }));
            }
            return handle;
        },
        buy: (proposal_id, price) => {
            calls.buy.push([proposal_id, price]);
            return new Promise(resolve => {
                buy_resolve = resolve;
            });
        },
        subscribeOpenContract: (_id, cb) => {
            callbacks.contract = cb;
            return handle;
        },
        sell: () => Promise.resolve({ sell: { sold_for: 0 } }),
        emitTick: quote => callbacks.tick({ tick: { quote, pip_size: 2 } }),
        emitContract: update => callbacks.contract({ proposal_open_contract: { contract_id: 77, ...update } }),
        resolveBuy: response => buy_resolve(response),
        calls,
        answer,
    };
};

const row = (overrides: Partial<TMarketRow> & { symbol: string }): TMarketRow => ({
    name: overrides.symbol,
    group: 'synthetic',
    status: 'ready',
    price: 100,
    pip_size: 2,
    change_pct: 0.3,
    range_pct: 0.5,
    volatility: 'medium',
    is_closed: false,
    closes: [99, 101, 100],
    range_position: 0.5,
    ...overrides,
});

/** Lets the runner's promise chains settle without moving the fake clock. */
const settle = async () => {
    for (let i = 0; i < 12; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

type TSetup = {
    rows?: TMarketRow[];
    filters?: TScanFilters;
    settings?: Partial<TAutoSettings>;
    is_virtual?: boolean;
    balance?: number;
    entry_timeout_ms?: number;
};

const setup = (config: TSetup = {}) => {
    const api = createFakeApi();
    const logs: [TLevel, string][] = [];
    const states: TScanTraderState[] = [];
    let session: TScanSession = { runs: 0, won: 0, lost: 0, total_profit: 0 };
    const current = {
        rows: config.rows ?? [row({ symbol: 'R_50', change_pct: 0.6 })],
        filters: config.filters ?? { ...DEFAULT_SCAN, direction: 'up' as const },
    };
    const options: TScanTraderOptions = {
        api,
        currency: 'USD',
        is_virtual: config.is_virtual ?? true,
        getBalance: () => config.balance ?? 100,
        getRows: () => current.rows,
        getFilters: () => current.filters,
        settings: { ...DEFAULT_AUTO, ...config.settings },
        onLog: (level, message) => logs.push([level, message]),
        onState: (state, next) => {
            states.push(state);
            session = next;
        },
        entry_timeout_ms: config.entry_timeout_ms,
    };
    const trader = new ScanTrader(options);
    return { api, current, logs, session: () => session, states, trader };
};

const errors = (logs: [TLevel, string][]) => logs.filter(([level]) => level === 'error').map(([, message]) => message);

/** Runs one trade from the first tick to the contract's result. */
const playTrade = async (api: TFakeApi, profit: number) => {
    api.emitTick(100);
    await settle();
    api.resolveBuy({ buy: { contract_id: 77, buy_price: 1, payout: 1.95 } });
    await settle();
    api.emitContract({
        profit,
        sell_price: profit > 0 ? 1 + profit : 0,
        is_sold: 1,
        status: profit > 0 ? 'won' : 'lost',
    });
    await settle();
};

describe('ScanTrader', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    describe('refusing to start', () => {
        it('does nothing on a real account', () => {
            const { api, logs, trader, states } = setup({ is_virtual: false });
            trader.start();
            expect(trader.getState()).toBe('stopped');
            expect(api.calls.ticks).toHaveLength(0);
            expect(states).toEqual([]);
            expect(errors(logs)).toEqual(['Auto-trading works on demo accounts only.']);
        });

        it('does nothing with unsafe settings', () => {
            const { api, logs, trader } = setup({ settings: { max_loss: 0 } });
            trader.start();
            expect(trader.getState()).toBe('stopped');
            expect(api.calls.proposal).toHaveLength(0);
            expect(errors(logs)[0]).toMatch(/stop loss/);
        });

        it('does nothing when only "open markets only" is on', () => {
            const { api, logs, trader } = setup({ filters: { ...DEFAULT_SCAN, live_only: true } });
            trader.start();
            expect(trader.getState()).toBe('stopped');
            expect(api.calls.ticks).toHaveLength(0);
            expect(errors(logs)[0]).toMatch(/at least one scanner filter/);
        });
    });

    describe('entering a trade', () => {
        it('watches, and trades nothing while no market matches', () => {
            const { api, trader } = setup({ rows: [row({ symbol: 'R_50', change_pct: -0.6 })] });
            trader.start();
            expect(trader.getState()).toBe('watching');
            expect(api.calls.ticks).toHaveLength(0);
        });

        it('buys the matching market the moment it appears, with the chosen stake', async () => {
            const { api, current, trader } = setup({
                rows: [row({ symbol: 'R_50', change_pct: -0.6 })],
                settings: { stake: 2 },
            });
            trader.start();
            current.rows = [row({ symbol: 'R_25', change_pct: 0.2 }), row({ symbol: 'R_100', change_pct: 0.9 })];
            trader.poke();
            expect(trader.getState()).toBe('trading');
            expect(api.calls.ticks).toEqual(['R_100']);

            api.emitTick(100);
            await settle();
            expect(api.calls.proposal).toEqual([
                {
                    amount: 2,
                    basis: 'stake',
                    contract_type: 'CALL',
                    currency: 'USD',
                    duration: 5,
                    duration_unit: 't',
                    underlying_symbol: 'R_100',
                },
            ]);
            expect(api.calls.buy).toEqual([['prop-1', 2]]);
        });

        it('buys Fall on a market that fell when trading with the move, and Rise when trading against it', async () => {
            const down = [row({ symbol: 'R_50', change_pct: -0.6 })];
            const filters = { ...DEFAULT_SCAN, direction: 'down' as const };

            const first = setup({ rows: down, filters });
            first.trader.start();
            first.api.emitTick(1);
            await settle();
            expect(first.api.calls.proposal[0].contract_type).toBe('PUT');

            const second = setup({ rows: down, filters, settings: { side: 'against' } });
            second.trader.start();
            second.api.emitTick(1);
            await settle();
            expect(second.api.calls.proposal[0].contract_type).toBe('CALL');
        });

        it('never starts a second trade while one is running, however often it is poked', async () => {
            const { api, trader } = setup();
            trader.start();
            trader.poke();
            trader.poke();
            api.emitTick(1);
            await settle();
            trader.poke();
            expect(api.calls.ticks).toHaveLength(1);
            expect(api.calls.proposal).toHaveLength(1);
        });

        it('refuses a price the server raised above the stake, and stops instead of retrying', async () => {
            const { api, logs, trader, session } = setup({ settings: { stake: 1 } });
            api.subscribeProposal = (_request, cb) => {
                Promise.resolve().then(() => cb({ proposal: { id: 'p', ask_price: 3 } }));
                return { unsubscribe: () => undefined };
            };
            trader.start();
            api.emitTick(1);
            await settle();
            expect(api.calls.buy).toHaveLength(0);
            expect(trader.getState()).toBe('stopped');
            expect(session().runs).toBe(0);
            expect(errors(logs).join(' ')).toMatch(/above your maximum stake/);
        });
    });

    describe('after a trade', () => {
        it('counts a win, waits out the cooldown, then looks for the next entry', async () => {
            const { api, trader, session, states } = setup({ settings: { cooldown_seconds: 30, max_trades: 5 } });
            trader.start();
            await playTrade(api, 0.95);

            expect(session()).toEqual({ runs: 1, won: 1, lost: 0, total_profit: 0.95 });
            expect(trader.getState()).toBe('watching');
            expect(api.calls.ticks).toHaveLength(1);

            // still cooling down: a poke must not start anything
            jest.advanceTimersByTime(29_000);
            trader.poke();
            expect(api.calls.ticks).toHaveLength(1);

            jest.advanceTimersByTime(1_000);
            expect(api.calls.ticks).toHaveLength(2);
            expect(trader.getState()).toBe('trading');
            expect(states).toContain('trading');
        });

        it('adds up wins and losses across trades', async () => {
            const { api, trader, session } = setup({ settings: { cooldown_seconds: 10, max_trades: 5, max_loss: 5 } });
            trader.start();
            await playTrade(api, 0.95);
            jest.advanceTimersByTime(10_000);
            await playTrade(api, -1);
            expect(session()).toEqual({ runs: 2, won: 1, lost: 1, total_profit: -0.05 });
        });

        it('stops at the trade limit', async () => {
            const { api, trader, logs, session } = setup({ settings: { max_trades: 1 } });
            trader.start();
            await playTrade(api, 0.95);
            expect(trader.getState()).toBe('stopped');
            expect(session().runs).toBe(1);
            expect(logs.map(([, message]) => message)).toContain('Trade limit of 1 reached.');
            jest.advanceTimersByTime(120_000);
            expect(api.calls.ticks).toHaveLength(1);
        });

        it('stops at the stop loss', async () => {
            const { api, trader, logs } = setup({
                settings: { stake: 1, max_loss: 2, max_trades: 10, cooldown_seconds: 10 },
            });
            trader.start();
            await playTrade(api, -1);
            expect(trader.getState()).toBe('watching');
            jest.advanceTimersByTime(10_000);
            await playTrade(api, -1);
            expect(trader.getState()).toBe('stopped');
            expect(logs.map(([, message]) => message)).toContain('Stop loss of 2 reached.');
        });

        it('stops at the take profit', async () => {
            const { api, trader, logs } = setup({ settings: { max_profit: 0.9, max_trades: 10 } });
            trader.start();
            await playTrade(api, 0.95);
            expect(trader.getState()).toBe('stopped');
            expect(logs.map(([, message]) => message)).toContain('Take profit of 0.9 reached.');
        });
    });

    describe('stopping', () => {
        it('stops at once while only watching', () => {
            const { api, trader } = setup({ rows: [row({ symbol: 'R_50', change_pct: -1 })] });
            trader.start();
            trader.stop();
            expect(trader.getState()).toBe('stopped');
            trader.poke();
            expect(api.calls.ticks).toHaveLength(0);
        });

        it('stops during the cooldown, so no later trade starts', async () => {
            const { api, trader } = setup();
            trader.start();
            await playTrade(api, 0.95);
            trader.stop();
            expect(trader.getState()).toBe('stopped');
            jest.advanceTimersByTime(300_000);
            expect(api.calls.ticks).toHaveLength(1);
        });

        it('follows an open contract to its result before it stops, and counts it', async () => {
            const { api, trader, session } = setup();
            trader.start();
            api.emitTick(1);
            await settle();
            api.resolveBuy({ buy: { contract_id: 77, buy_price: 1, payout: 1.95 } });
            await settle();

            trader.stop();
            expect(trader.getState()).toBe('stopping');
            api.emitContract({ profit: -1, sell_price: 0, is_sold: 1, status: 'lost' });
            await settle();
            expect(trader.getState()).toBe('stopped');
            expect(session()).toEqual({ runs: 1, won: 0, lost: 1, total_profit: -1 });
            jest.advanceTimersByTime(300_000);
            expect(api.calls.ticks).toHaveLength(1);
        });

        it('stopping before the first price arrives is a stop, not a failure', async () => {
            const { api, trader, logs } = setup();
            trader.start();
            trader.stop();
            await settle();
            expect(trader.getState()).toBe('stopped');
            expect(api.calls.proposal).toHaveLength(0);
            expect(errors(logs)).toEqual([]);
        });

        it('can be started again after it stopped, with a fresh session', async () => {
            const { api, trader, session } = setup({ settings: { max_trades: 1 } });
            trader.start();
            await playTrade(api, 0.95);
            expect(trader.getState()).toBe('stopped');
            trader.start();
            expect(trader.getState()).toBe('trading');
            expect(session()).toEqual({ runs: 0, won: 0, lost: 0, total_profit: 0 });
        });
    });

    describe('failures', () => {
        it('stops, and does not retry, when the server refuses the price', async () => {
            const { api, trader, logs } = setup();
            api.answer.proposal = 'error';
            trader.start();
            api.emitTick(1);
            await settle();
            expect(trader.getState()).toBe('stopped');
            expect(api.calls.proposal).toHaveLength(1);
            expect(errors(logs).join(' ')).toMatch(/could not be placed/);
            jest.advanceTimersByTime(300_000);
            expect(api.calls.ticks).toHaveLength(1);
        });

        it('stops when the balance is below the stake', async () => {
            const { api, trader, logs } = setup({ balance: 0.5, settings: { stake: 1 } });
            trader.start();
            api.emitTick(1);
            await settle();
            expect(trader.getState()).toBe('stopped');
            expect(api.calls.proposal).toHaveLength(0);
            expect(errors(logs).join(' ')).toMatch(/balance is lower than the stake/);
        });

        it('gives up when no trade opens in time', async () => {
            const { api, trader, logs } = setup({ entry_timeout_ms: 5_000 });
            api.answer.proposal = 'never';
            trader.start();
            api.emitTick(1);
            await settle();
            jest.advanceTimersByTime(5_000);
            await settle();
            expect(trader.getState()).toBe('stopped');
            expect(errors(logs).join(' ')).toMatch(/No trade was placed in time/);
        });
    });
});
