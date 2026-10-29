import { STALE_AFTER_SECONDS, WATCHLIST_STORAGE_KEY } from '../markets-config';
import {
    applyTick,
    buildRow,
    buildSparklinePoints,
    entryFromCandles,
    formatPercent,
    formatPrice,
    getTopMovers,
    matchesSearch,
    parseCandles,
    readWatchlist,
    sortRows,
    TMarketEntry,
    TMarketRow,
    toggleSymbol,
    withVolatilityLevels,
    writeWatchlist,
} from '../markets-utils';

const NOW = 1_700_000_000;

const candle = (epoch: number, open: number, high: number, low: number, close: number) => ({
    epoch,
    open,
    high,
    low,
    close,
});

describe('parseCandles', () => {
    it('reads candles and the number of decimals', () => {
        const parsed = parseCandles({
            candles: [{ epoch: 1, open: '10', high: '12', low: '9', close: '11' }],
            pip_size: 3,
        });
        expect(parsed).toEqual({ candles: [candle(1, 10, 12, 9, 11)], pip_size: 3 });
    });

    it('drops broken candles and refuses an empty or errored response', () => {
        const parsed = parseCandles({
            candles: [
                candle(1, 10, 12, 9, 11),
                { epoch: 2, open: 'x', high: 1, low: 1, close: 1 },
                candle(3, 0, 1, 1, 1),
            ],
            pip_size: 2,
        });
        expect(parsed?.candles).toHaveLength(1);
        expect(parseCandles({ candles: [] })).toBeNull();
        expect(parseCandles({ error: { message: 'no' } })).toBeNull();
        expect(parseCandles(undefined)).toBeNull();
        expect(parseCandles({ candles: 'nope' })).toBeNull();
    });

    it('falls back to 2 decimals when the market sends something unusable', () => {
        expect(parseCandles({ candles: [candle(1, 1, 1, 1, 1)], pip_size: -4 })?.pip_size).toBe(2);
        expect(parseCandles({ candles: [candle(1, 1, 1, 1, 1)] })?.pip_size).toBe(2);
    });
});

describe('entries and rows', () => {
    const entry = entryFromCandles(
        [candle(NOW - 120, 100, 103, 99, 102), candle(NOW - 60, 102, 106, 101, 105)],
        2,
        60,
        NOW
    );

    it('keeps the hour open, the hour high and low, and the newest close', () => {
        expect(entry).toEqual({
            status: 'ready',
            open: 100,
            high: 106,
            low: 99,
            last: 105,
            pip_size: 2,
            updated: NOW,
            closes: [102, 105],
        });
    });

    it('works out the change and range as percentages', () => {
        const row = buildRow({ symbol: 'R_10', name: 'Vol 10', group: 'synthetic' }, entry, NOW);
        expect(row.price).toBe(105);
        expect(row.change_pct).toBeCloseTo(5, 6);
        expect(row.range_pct).toBeCloseTo((7 / 99) * 100, 6);
        expect(row.is_closed).toBe(false);
    });

    it('places the price between the window low (0) and high (1)', () => {
        const market = { symbol: 'R_10', name: 'Vol 10', group: 'synthetic' as const };
        expect(buildRow(market, entry, NOW).range_position).toBeCloseTo(6 / 7, 6);
        expect(buildRow(market, { ...entry, last: 99 }, NOW).range_position).toBe(0);
        expect(buildRow(market, { ...entry, last: 106 }, NOW).range_position).toBe(1);
        // a tick outside the stored range is clamped, never above 1 or below 0
        expect(buildRow(market, { ...entry, last: 200 }, NOW).range_position).toBe(1);
        expect(buildRow(market, { ...entry, last: 50 }, NOW).range_position).toBe(0);
    });

    it('has no position when the range is flat or the market has not loaded', () => {
        const market = { symbol: 'R_10', name: 'Vol 10', group: 'synthetic' as const };
        expect(buildRow(market, { ...entry, high: 100, low: 100, last: 100 }, NOW).range_position).toBeNull();
        expect(buildRow(market, undefined, NOW).range_position).toBeNull();
        expect(buildRow(market, { status: 'unavailable' }, NOW).range_position).toBeNull();
    });

    it('marks a market closed when nothing has ticked for a while', () => {
        const old = { ...entry, updated: NOW - STALE_AFTER_SECONDS - 1 };
        expect(buildRow({ symbol: 'frxEURUSD', name: 'EUR/USD', group: 'forex' }, old, NOW).is_closed).toBe(true);
    });

    it('gives a loading or unavailable market no numbers', () => {
        const market = { symbol: 'R_10', name: 'Vol 10', group: 'synthetic' as const };
        expect(buildRow(market, undefined, NOW)).toMatchObject({ status: 'loading', price: null, change_pct: null });
        expect(buildRow(market, { status: 'unavailable' }, NOW)).toMatchObject({
            status: 'unavailable',
            price: null,
            range_pct: null,
        });
    });
});

describe('applyTick', () => {
    const ready: TMarketEntry = { status: 'ready', open: 100, high: 105, low: 98, last: 102, pip_size: 2, updated: 1 };

    it('moves the price but not the hour open, and widens the range when it is broken', () => {
        expect(applyTick(ready, 110, 2)).toMatchObject({ open: 100, last: 110, high: 110, low: 98, updated: 2 });
        expect(applyTick(ready, 90, 3)).toMatchObject({ open: 100, last: 90, high: 105, low: 90 });
        expect(applyTick(ready, 101, 4)).toMatchObject({ high: 105, low: 98 });
    });

    it('starts an entry that had no history from the first tick', () => {
        expect(applyTick({ status: 'unavailable' }, 50, 9)).toMatchObject({
            status: 'ready',
            open: 50,
            high: 50,
            low: 50,
            last: 50,
        });
    });

    it('ignores a tick that is not a positive number', () => {
        expect(applyTick(ready, NaN, 5)).toBe(ready);
        expect(applyTick(ready, 0, 5)).toBe(ready);
    });
});

const row = (overrides: Partial<TMarketRow> & { symbol: string }): TMarketRow => ({
    name: overrides.symbol,
    group: 'synthetic',
    status: 'ready',
    price: 1,
    pip_size: 2,
    change_pct: 0,
    range_pct: 1,
    volatility: null,
    is_closed: false,
    closes: [],
    ...overrides,
});

describe('withVolatilityLevels', () => {
    it('splits each group into low, medium and high by range, ranking synthetic and forex separately', () => {
        const rows = withVolatilityLevels([
            row({ symbol: 'S1', range_pct: 0.9 }),
            row({ symbol: 'S2', range_pct: 0.3 }),
            row({ symbol: 'S3', range_pct: 0.6 }),
            row({ symbol: 'F1', group: 'forex', range_pct: 0.03 }),
            row({ symbol: 'F2', group: 'forex', range_pct: 0.01 }),
            row({ symbol: 'F3', group: 'forex', range_pct: 0.02 }),
        ]);
        const level = (symbol: string) => rows.find(item => item.symbol === symbol)?.volatility;
        expect([level('S2'), level('S3'), level('S1')]).toEqual(['low', 'medium', 'high']);
        // a tiny forex range is still "high" for forex
        expect([level('F2'), level('F3'), level('F1')]).toEqual(['low', 'medium', 'high']);
    });

    it('calls a group Medium when there is too little to compare, and skips closed or unloaded markets', () => {
        const rows = withVolatilityLevels([
            row({ symbol: 'A', range_pct: 1 }),
            row({ symbol: 'B', range_pct: 2 }),
            row({ symbol: 'C', range_pct: null, price: null, status: 'loading' }),
            row({ symbol: 'D', range_pct: 3, is_closed: true }),
        ]);
        expect(rows.map(item => item.volatility)).toEqual(['medium', 'medium', null, null]);
    });
});

describe('getTopMovers', () => {
    const rows = [
        row({ symbol: 'UP1', change_pct: 0.4 }),
        row({ symbol: 'UP2', change_pct: 1.2 }),
        row({ symbol: 'UP3', change_pct: 0.1 }),
        row({ symbol: 'UP4', change_pct: 0.9 }),
        row({ symbol: 'DN1', change_pct: -0.3 }),
        row({ symbol: 'DN2', change_pct: -2 }),
        row({ symbol: 'FLAT', change_pct: 0 }),
        row({ symbol: 'SHUT', change_pct: 5, is_closed: true }),
        row({ symbol: 'LOAD', change_pct: null, price: null, status: 'loading' }),
    ];

    it('lists the biggest risers and fallers, biggest first, at most three each', () => {
        const { gainers, losers } = getTopMovers(rows);
        expect(gainers.map(item => item.symbol)).toEqual(['UP2', 'UP4', 'UP1']);
        expect(losers.map(item => item.symbol)).toEqual(['DN2', 'DN1']);
    });
});

describe('sortRows', () => {
    const rows = [
        row({ symbol: 'A', change_pct: 0.2, range_pct: 0.5 }),
        row({ symbol: 'B', change_pct: -1.5, range_pct: 0.1 }),
        row({ symbol: 'C', change_pct: null, range_pct: null, price: null, status: 'loading' }),
        row({ symbol: 'D', change_pct: 0.9, range_pct: 0.9 }),
    ];

    it('keeps the listed order for name', () => {
        expect(sortRows(rows, 'name').map(item => item.symbol)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('puts the biggest move (up or down) first and unloaded markets last', () => {
        expect(sortRows(rows, 'change').map(item => item.symbol)).toEqual(['B', 'D', 'A', 'C']);
    });

    it('puts the widest range first and unloaded markets last', () => {
        expect(sortRows(rows, 'volatility').map(item => item.symbol)).toEqual(['D', 'A', 'B', 'C']);
    });

    it('does not change the list it was given', () => {
        sortRows(rows, 'change');
        expect(rows.map(item => item.symbol)).toEqual(['A', 'B', 'C', 'D']);
    });
});

describe('formatting', () => {
    it('shows prices with the market decimals and a dash when there is none', () => {
        expect(formatPrice(1234.5, 3)).toBe('1234.500');
        expect(formatPrice(null, 2)).toBe('–');
    });

    it('shows percentages with a sign when asked, and no sign for zero', () => {
        expect(formatPercent(1.234, true)).toBe('+1.23%');
        expect(formatPercent(-0.5, true)).toBe('−0.50%');
        expect(formatPercent(0.001, true)).toBe('0.00%');
        expect(formatPercent(0.4567)).toBe('0.46%');
        expect(formatPercent(null)).toBe('–');
    });
});

describe('watchlist storage', () => {
    beforeEach(() => localStorage.clear());

    it('saves and reads back the starred markets', () => {
        writeWatchlist(['R_10', 'frxEURUSD']);
        expect(readWatchlist()).toEqual(['R_10', 'frxEURUSD']);
    });

    it('drops unknown markets, duplicates and anything that is not a list', () => {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_10', 'R_10', 'NOPE', 5, null]));
        expect(readWatchlist()).toEqual(['R_10']);
        localStorage.setItem(WATCHLIST_STORAGE_KEY, '{"a":1}');
        expect(readWatchlist()).toEqual([]);
        localStorage.setItem(WATCHLIST_STORAGE_KEY, 'not json');
        expect(readWatchlist()).toEqual([]);
    });

    it('adds a market that is not starred and removes one that is', () => {
        expect(toggleSymbol(['R_10'], 'R_25')).toEqual(['R_10', 'R_25']);
        expect(toggleSymbol(['R_10', 'R_25'], 'R_10')).toEqual(['R_25']);
    });
});

describe('entries for larger candles', () => {
    it('does not count a market as stale just because an hourly candle opened up to an hour ago', () => {
        const hourly = entryFromCandles([candle(NOW - 1800, 100, 101, 99, 100)], 2, 3600, NOW);
        expect(hourly.updated).toBe(NOW);
        expect(buildRow({ symbol: 'R_10', name: 'Vol 10', group: 'synthetic' }, hourly, NOW).is_closed).toBe(false);
    });

    it('still marks a market closed when the newest candle ended long ago', () => {
        const old = entryFromCandles([candle(NOW - 86_400, 100, 101, 99, 100)], 2, 3600, NOW);
        expect(old.updated).toBe(NOW - 86_400 + 3600);
        expect(buildRow({ symbol: 'frxEURUSD', name: 'EUR/USD', group: 'forex' }, old, NOW).is_closed).toBe(true);
    });

    it('never reports a time after now', () => {
        expect(entryFromCandles([candle(NOW - 10, 1, 1, 1, 1)], 2, 3600, NOW).updated).toBe(NOW);
    });
});

describe('sparkline data', () => {
    const base: TMarketEntry = {
        status: 'ready',
        open: 1,
        high: 3,
        low: 1,
        last: 2,
        pip_size: 2,
        updated: 1,
        closes: [1, 3, 2],
    };

    it('keeps the closes of every candle, oldest first', () => {
        const entry = entryFromCandles([candle(1, 1, 2, 1, 2), candle(2, 2, 3, 2, 3)], 2, 60, 100);
        expect(entry.closes).toEqual([2, 3]);
    });

    it('moves the last point with each live tick and leaves the rest alone', () => {
        expect(applyTick(base, 5, 2).closes).toEqual([1, 3, 5]);
        expect(base.closes).toEqual([1, 3, 2]);
    });

    it('starts the line from the first tick when there was no history', () => {
        expect(applyTick({ status: 'unavailable' }, 7, 2).closes).toEqual([7]);
    });

    it('passes the closes to the row, and gives none to a market that has not loaded', () => {
        const market = { symbol: 'R_10', name: 'Vol 10', group: 'synthetic' as const };
        expect(buildRow(market, base, 5).closes).toEqual([1, 3, 2]);
        expect(buildRow(market, undefined, 5).closes).toEqual([]);
    });

    it('draws the lowest price at the bottom and the highest at the top', () => {
        const points = buildSparklinePoints([1, 3, 2], 100, 20, 2).split(' ');
        expect(points).toEqual(['0.0,18.0', '50.0,2.0', '100.0,10.0']);
    });

    it('draws a flat line through the middle, and nothing for fewer than two prices', () => {
        expect(buildSparklinePoints([5, 5, 5], 100, 20)).toBe('0.0,10.0 50.0,10.0 100.0,10.0');
        expect(buildSparklinePoints([5], 100, 20)).toBe('');
        expect(buildSparklinePoints([], 100, 20)).toBe('');
    });
});

describe('matchesSearch', () => {
    const eurusd = { symbol: 'frxEURUSD', name: 'EUR/USD' };
    const vol = { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index' };

    it('matches everything when the box is empty or only spaces', () => {
        expect(matchesSearch(eurusd, '')).toBe(true);
        expect(matchesSearch(eurusd, '   ')).toBe(true);
    });

    it('ignores case, spaces and slashes, so "eur usd", "EUR/USD" and "eurusd" all find the pair', () => {
        ['eur usd', 'EUR/USD', 'eurusd', 'Eur'].forEach(query => expect(matchesSearch(eurusd, query)).toBe(true));
    });

    it('matches the symbol as well as the name', () => {
        expect(matchesSearch(vol, '1hz100v')).toBe(true);
        expect(matchesSearch(vol, 'volatility 100')).toBe(true);
        expect(matchesSearch(eurusd, 'frx')).toBe(true);
    });

    it('does not match something else, and a query of only punctuation matches everything', () => {
        expect(matchesSearch(eurusd, 'gbp')).toBe(false);
        expect(matchesSearch(vol, 'eurusd')).toBe(false);
        expect(matchesSearch(eurusd, '/ /')).toBe(true);
    });
});
