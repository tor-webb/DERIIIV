import {
    countActiveScanFilters,
    DEFAULT_SCAN,
    matchesScan,
    MIN_MOVE_STEPS,
    NEAR_EDGE,
    scanRows,
    TScanFilters,
} from '../markets-scanner';
import { TMarketRow } from '../markets-utils';

const row = (overrides: Partial<TMarketRow> & { symbol: string }): TMarketRow => ({
    name: overrides.symbol,
    group: 'synthetic',
    status: 'ready',
    price: 100,
    pip_size: 2,
    change_pct: 0.2,
    range_pct: 0.5,
    volatility: 'medium',
    is_closed: false,
    closes: [99, 101, 100],
    range_position: 0.5,
    ...overrides,
});

const scan = (changes: Partial<TScanFilters>): TScanFilters => ({ ...DEFAULT_SCAN, ...changes });

const symbols = (rows: TMarketRow[]) => rows.map(item => item.symbol);

describe('countActiveScanFilters', () => {
    it('is 0 for the default and counts each switched-on filter', () => {
        expect(countActiveScanFilters(DEFAULT_SCAN)).toBe(0);
        expect(countActiveScanFilters(scan({ direction: 'up' }))).toBe(1);
        expect(countActiveScanFilters(scan({ direction: 'down', volatility: 'high', min_move: 0.1 }))).toBe(3);
        expect(
            countActiveScanFilters(
                scan({ direction: 'up', volatility: 'low', min_move: 0.5, position: 'high', live_only: true })
            )
        ).toBe(5);
    });

    it('offers "any" first in the minimum-move steps, then ascending', () => {
        expect(MIN_MOVE_STEPS[0]).toBe(0);
        expect([...MIN_MOVE_STEPS].sort((a, b) => a - b)).toEqual(MIN_MOVE_STEPS);
    });
});

describe('matchesScan', () => {
    it('lets every market through when nothing is switched on, even one with no figures', () => {
        expect(matchesScan(row({ symbol: 'A' }), DEFAULT_SCAN)).toBe(true);
        expect(
            matchesScan(row({ symbol: 'B', status: 'unavailable', price: null, change_pct: null }), DEFAULT_SCAN)
        ).toBe(true);
    });

    it('filters by direction and treats a flat market as neither rising nor falling', () => {
        const up = row({ symbol: 'UP', change_pct: 0.3 });
        const down = row({ symbol: 'DN', change_pct: -0.3 });
        const flat = row({ symbol: 'FL', change_pct: 0 });
        expect(symbols([up, down, flat].filter(item => matchesScan(item, scan({ direction: 'up' }))))).toEqual(['UP']);
        expect(symbols([up, down, flat].filter(item => matchesScan(item, scan({ direction: 'down' }))))).toEqual([
            'DN',
        ]);
    });

    it('applies the minimum move to the size of the change, up or down, and includes the boundary', () => {
        const filters = scan({ min_move: 0.25 });
        expect(matchesScan(row({ symbol: 'A', change_pct: 0.25 }), filters)).toBe(true);
        expect(matchesScan(row({ symbol: 'B', change_pct: -0.4 }), filters)).toBe(true);
        expect(matchesScan(row({ symbol: 'C', change_pct: 0.24 }), filters)).toBe(false);
        expect(matchesScan(row({ symbol: 'D', change_pct: -0.1 }), filters)).toBe(false);
    });

    it('filters by volatility level', () => {
        const filters = scan({ volatility: 'high' });
        expect(matchesScan(row({ symbol: 'A', volatility: 'high' }), filters)).toBe(true);
        expect(matchesScan(row({ symbol: 'B', volatility: 'low' }), filters)).toBe(false);
        expect(matchesScan(row({ symbol: 'C', volatility: null }), filters)).toBe(false);
    });

    it('finds prices near the top or bottom fifth of the range, edges included', () => {
        const high = scan({ position: 'high' });
        const low = scan({ position: 'low' });
        expect(matchesScan(row({ symbol: 'A', range_position: 1 }), high)).toBe(true);
        expect(matchesScan(row({ symbol: 'B', range_position: 1 - NEAR_EDGE }), high)).toBe(true);
        expect(matchesScan(row({ symbol: 'C', range_position: 0.79 }), high)).toBe(false);
        expect(matchesScan(row({ symbol: 'D', range_position: 0 }), low)).toBe(true);
        expect(matchesScan(row({ symbol: 'E', range_position: NEAR_EDGE }), low)).toBe(true);
        expect(matchesScan(row({ symbol: 'F', range_position: 0.21 }), low)).toBe(false);
    });

    it('leaves out a market whose position is unknown rather than guessing', () => {
        expect(matchesScan(row({ symbol: 'A', range_position: null }), scan({ position: 'high' }))).toBe(false);
        expect(matchesScan(row({ symbol: 'B', range_position: undefined }), scan({ position: 'low' }))).toBe(false);
    });

    it('needs every switched-on filter to pass', () => {
        const filters = scan({ direction: 'up', volatility: 'high', min_move: 0.1, position: 'high' });
        const good = row({ symbol: 'A', change_pct: 0.5, volatility: 'high', range_position: 0.95 });
        expect(matchesScan(good, filters)).toBe(true);
        expect(matchesScan({ ...good, change_pct: -0.5 }, filters)).toBe(false);
        expect(matchesScan({ ...good, volatility: 'medium' }, filters)).toBe(false);
        expect(matchesScan({ ...good, change_pct: 0.05 }, filters)).toBe(false);
        expect(matchesScan({ ...good, range_position: 0.5 }, filters)).toBe(false);
    });

    it('never passes a closed, loading or unavailable market through a filter that needs its figures', () => {
        const closed = row({ symbol: 'C', is_closed: true, change_pct: 0.9, volatility: null });
        const loading = row({ symbol: 'L', status: 'loading', price: null, change_pct: null });
        const unavailable = row({ symbol: 'U', status: 'unavailable', price: null, change_pct: null });
        [scan({ direction: 'up' }), scan({ min_move: 0.05 }), scan({ volatility: 'low' }), scan({ position: 'low' })]
            .flatMap(filters => [closed, loading, unavailable].map(item => matchesScan(item, filters)))
            .forEach(result => expect(result).toBe(false));
    });

    it('"open markets only" drops closed, loading and unavailable markets and keeps the rest', () => {
        const filters = scan({ live_only: true });
        expect(matchesScan(row({ symbol: 'A' }), filters)).toBe(true);
        expect(matchesScan(row({ symbol: 'B', is_closed: true }), filters)).toBe(false);
        expect(matchesScan(row({ symbol: 'C', status: 'loading', price: null, change_pct: null }), filters)).toBe(
            false
        );
        expect(matchesScan(row({ symbol: 'D', status: 'unavailable', price: null, change_pct: null }), filters)).toBe(
            false
        );
    });
});

describe('scanRows', () => {
    const rows = [
        row({ symbol: 'A', change_pct: 0.6, volatility: 'high', range_position: 0.9 }),
        row({ symbol: 'B', change_pct: -0.2, volatility: 'low', range_position: 0.1 }),
        row({ symbol: 'C', change_pct: 0.1, volatility: 'medium', range_position: 0.5 }),
    ];

    it('returns the same list when no filter is on', () => {
        expect(scanRows(rows, DEFAULT_SCAN)).toBe(rows);
    });

    it('keeps the order and does not change the input', () => {
        expect(symbols(scanRows(rows, scan({ direction: 'up' })))).toEqual(['A', 'C']);
        expect(symbols(scanRows(rows, scan({ direction: 'up', min_move: 0.5 })))).toEqual(['A']);
        expect(symbols(scanRows(rows, scan({ position: 'low' })))).toEqual(['B']);
        expect(symbols(rows)).toEqual(['A', 'B', 'C']);
    });

    it('can return nothing', () => {
        expect(scanRows(rows, scan({ direction: 'down', volatility: 'high' }))).toEqual([]);
    });
});
