import { DEFAULT_SCAN, TScanFilters } from '../markets-scanner';
import { TMarketRow } from '../markets-utils';
import {
    buildScanProgram,
    DEFAULT_AUTO,
    emptySession,
    FOREX_MINUTES,
    hasSignalFilter,
    pickEntry,
    sessionStopReason,
    SYNTHETIC_TICKS,
    TAutoSettings,
    validateAuto,
} from '../scan-trader-logic';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

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

const scan = (changes: Partial<TScanFilters>): TScanFilters => ({ ...DEFAULT_SCAN, ...changes });
const auto = (changes: Partial<TAutoSettings> = {}): TAutoSettings => ({ ...DEFAULT_AUTO, ...changes });

describe('hasSignalFilter', () => {
    it('ignores "open markets only", which says nothing about movement', () => {
        expect(hasSignalFilter(DEFAULT_SCAN)).toBe(false);
        expect(hasSignalFilter(scan({ live_only: true }))).toBe(false);
        expect(hasSignalFilter(scan({ direction: 'up' }))).toBe(true);
        expect(hasSignalFilter(scan({ min_move: 0.1 }))).toBe(true);
        expect(hasSignalFilter(scan({ volatility: 'high' }))).toBe(true);
        expect(hasSignalFilter(scan({ position: 'low' }))).toBe(true);
    });
});

describe('pickEntry', () => {
    const rows = [
        row({ symbol: 'R_10', change_pct: 0.2 }),
        row({ symbol: 'R_50', change_pct: -0.7 }),
        row({ symbol: 'R_100', change_pct: 0.5 }),
    ];

    it('picks nothing when no movement filter is on, however many markets there are', () => {
        expect(pickEntry(rows, DEFAULT_SCAN, 'with')).toBeNull();
        expect(pickEntry(rows, scan({ live_only: true }), 'with')).toBeNull();
    });

    it('picks the market with the biggest move that passes the filters, up or down', () => {
        expect(pickEntry(rows, scan({ min_move: 0.05 }), 'with')?.symbol).toBe('R_50');
        expect(pickEntry(rows, scan({ direction: 'up' }), 'with')?.symbol).toBe('R_100');
        expect(pickEntry(rows, scan({ direction: 'down' }), 'with')?.symbol).toBe('R_50');
    });

    it('breaks a tie by symbol, so the choice is stable', () => {
        const tied = [row({ symbol: 'R_75', change_pct: 0.4 }), row({ symbol: 'R_25', change_pct: -0.4 })];
        expect(pickEntry(tied, scan({ min_move: 0.1 }), 'with')?.symbol).toBe('R_25');
        expect(pickEntry([...tied].reverse(), scan({ min_move: 0.1 }), 'with')?.symbol).toBe('R_25');
    });

    it('buys Rise on a market that rose and Fall on one that fell when trading with the move', () => {
        expect(pickEntry(rows, scan({ direction: 'up' }), 'with')?.contract_type).toBe('CALL');
        expect(pickEntry(rows, scan({ direction: 'down' }), 'with')?.contract_type).toBe('PUT');
    });

    it('does the opposite when trading against the move', () => {
        expect(pickEntry(rows, scan({ direction: 'up' }), 'against')?.contract_type).toBe('PUT');
        expect(pickEntry(rows, scan({ direction: 'down' }), 'against')?.contract_type).toBe('CALL');
    });

    it('reports the move that made the market match', () => {
        expect(pickEntry(rows, scan({ direction: 'down' }), 'with')).toMatchObject({
            symbol: 'R_50',
            change_pct: -0.7,
        });
    });

    it('uses ticks on Derived indices and minutes on forex', () => {
        const mixed = [
            row({ symbol: 'R_10', change_pct: 0.1 }),
            row({ symbol: 'frxEURUSD', name: 'EUR/USD', group: 'forex', change_pct: 0.2 }),
        ];
        expect(pickEntry(mixed.slice(0, 1), scan({ min_move: 0.05 }), 'with')).toMatchObject({
            duration: SYNTHETIC_TICKS,
            duration_unit: 't',
        });
        expect(pickEntry(mixed, scan({ min_move: 0.05 }), 'with')).toMatchObject({
            symbol: 'frxEURUSD',
            duration: FOREX_MINUTES,
            duration_unit: 'm',
        });
    });

    it('never picks a closed, loading, unavailable, flat or untradeable market', () => {
        const unsafe = [
            row({ symbol: 'R_10', change_pct: 0.9, is_closed: true }),
            row({ symbol: 'R_25', status: 'loading', price: null, change_pct: null }),
            row({ symbol: 'R_50', status: 'unavailable', price: null, change_pct: null }),
            row({ symbol: 'R_75', change_pct: 0 }),
            // a forex pair the Bot Builder cannot trade yet
            row({ symbol: 'frxNZDUSD', name: 'NZD/USD', group: 'forex', change_pct: 1.5 }),
        ];
        expect(pickEntry(unsafe, scan({ min_move: 0.05 }), 'with')).toBeNull();
        expect(pickEntry(unsafe, scan({ position: 'any', live_only: true, direction: 'up' }), 'with')).toBeNull();
    });

    it('respects the other scanner filters', () => {
        const filtered = [
            row({ symbol: 'R_10', change_pct: 0.9, volatility: 'low', range_position: 0.95 }),
            row({ symbol: 'R_100', change_pct: 0.6, volatility: 'high', range_position: 0.1 }),
        ];
        expect(pickEntry(filtered, scan({ volatility: 'high' }), 'with')?.symbol).toBe('R_100');
        expect(pickEntry(filtered, scan({ position: 'high' }), 'with')?.symbol).toBe('R_10');
        expect(pickEntry(filtered, scan({ volatility: 'medium' }), 'with')).toBeNull();
    });
});

describe('validateAuto', () => {
    it('accepts the defaults', () => {
        expect(validateAuto(DEFAULT_AUTO)).toBeNull();
    });

    it('needs a stake above zero with at most two decimals', () => {
        expect(validateAuto(auto({ stake: 0 }))).toMatch(/stake above zero/);
        expect(validateAuto(auto({ stake: -1 }))).toMatch(/stake above zero/);
        expect(validateAuto(auto({ stake: NaN }))).toMatch(/stake above zero/);
        expect(validateAuto(auto({ stake: 1.005 }))).toMatch(/stake above zero/);
        expect(validateAuto(auto({ stake: 0.35, max_loss: 5 }))).toBeNull();
    });

    it('needs a whole number of trades from 1 to 50', () => {
        expect(validateAuto(auto({ max_trades: 0 }))).toMatch(/Max trades/);
        expect(validateAuto(auto({ max_trades: 2.5 }))).toMatch(/Max trades/);
        expect(validateAuto(auto({ max_trades: 51 }))).toMatch(/Max trades/);
        expect(validateAuto(auto({ max_trades: 1 }))).toBeNull();
        expect(validateAuto(auto({ max_trades: 50 }))).toBeNull();
    });

    it('requires a stop loss, and one at least as big as the stake', () => {
        expect(validateAuto(auto({ max_loss: 0 }))).toMatch(/stop loss/);
        expect(validateAuto(auto({ max_loss: NaN }))).toMatch(/stop loss/);
        expect(validateAuto(auto({ stake: 2, max_loss: 1 }))).toMatch(/at least one stake/);
        expect(validateAuto(auto({ stake: 2, max_loss: 2 }))).toBeNull();
    });

    it('allows no take profit, but not a negative one', () => {
        expect(validateAuto(auto({ max_profit: 0 }))).toBeNull();
        expect(validateAuto(auto({ max_profit: 3 }))).toBeNull();
        expect(validateAuto(auto({ max_profit: -1 }))).toMatch(/Take profit/);
        expect(validateAuto(auto({ max_profit: NaN }))).toMatch(/Take profit/);
    });

    it('makes the person wait between trades', () => {
        expect(validateAuto(auto({ cooldown_seconds: 9 }))).toMatch(/at least 10 seconds/);
        expect(validateAuto(auto({ cooldown_seconds: NaN }))).toMatch(/at least 10 seconds/);
        expect(validateAuto(auto({ cooldown_seconds: 10 }))).toBeNull();
    });
});

describe('buildScanProgram', () => {
    const entry = {
        symbol: 'R_50',
        name: 'Volatility 50 Index',
        group: 'synthetic' as const,
        contract_type: 'PUT' as const,
        change_pct: -0.4,
        duration: 5,
        duration_unit: 't' as const,
    };

    it('buys the one contract on the one market right away, with the chosen stake and duration', () => {
        const program = buildScanProgram(entry, 2.5);
        expect(program.setup).toMatchObject({ symbol: 'R_50', contract_type: 'PUT', trade_type: 'risefall' });
        expect(program.options).toEqual({
            duration_unit: 't',
            duration: { t: 'num', v: 5 },
            amount: { t: 'num', v: 2.5 },
            prediction: null,
        });
        expect(program.before_purchase).toEqual([{ t: 'purchase', contract_type: 'PUT' }]);
    });

    it('never asks to trade again, so one run is one trade', () => {
        const program = buildScanProgram(entry, 1);
        expect(program.after_purchase).toEqual([]);
        expect(program.setup.restart_buy_sell).toBe(false);
        expect(program.setup.restart_on_error).toBe(false);
    });
});

describe('sessionStopReason', () => {
    const settings = auto({ max_trades: 3, max_loss: 4, max_profit: 6 });
    const session = (changes: Partial<ReturnType<typeof emptySession>>) => ({ ...emptySession(), ...changes });

    it('carries on while every limit has room', () => {
        expect(sessionStopReason(session({ runs: 2, total_profit: -3.5 }), settings)).toBeNull();
    });

    it('stops at the stop loss, boundary included', () => {
        expect(sessionStopReason(session({ runs: 1, total_profit: -4 }), settings)).toBe('Stop loss of 4 reached.');
        expect(sessionStopReason(session({ runs: 1, total_profit: -9 }), settings)).toBe('Stop loss of 4 reached.');
    });

    it('stops at the take profit, boundary included, and ignores it when it is 0', () => {
        expect(sessionStopReason(session({ runs: 1, total_profit: 6 }), settings)).toBe('Take profit of 6 reached.');
        expect(
            sessionStopReason(session({ runs: 1, total_profit: 99 }), auto({ max_loss: 4, max_profit: 0 }))
        ).toBeNull();
    });

    it('stops at the trade limit', () => {
        expect(sessionStopReason(session({ runs: 3, total_profit: 0 }), settings)).toBe('Trade limit of 3 reached.');
    });

    it('reports the stop loss first when several limits are hit at once', () => {
        expect(sessionStopReason(session({ runs: 3, total_profit: -5 }), settings)).toBe('Stop loss of 4 reached.');
    });
});
