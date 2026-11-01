import type { TScanRow } from '../use-voltrex-scanner';
import { categoryCounts, DEFAULT_FILTERS, filterRows, sortRows, summarise } from '../voltrex-table';

const signal = (direction: 'BUY' | 'SELL' | 'NEUTRAL', strength: number, volatility_pct: number | null = 0.1) =>
    ({
        direction,
        strength,
        score: (direction === 'SELL' ? -1 : 1) * (strength / 100),
        volatility_pct,
    }) as unknown as TScanRow['signal'];

const make = (symbol: string, overrides: Partial<TScanRow> = {}): TScanRow =>
    ({
        symbol,
        name: symbol,
        category: 'volatility',
        market_name: 'Derived',
        is_open: true,
        status: 'ready',
        change_pct: 0,
        signal: null,
        ...overrides,
    }) as TScanRow;

const rows = [
    make('R_100', { name: 'Volatility 100 Index', change_pct: 1.5, signal: signal('BUY', 70, 0.3) }),
    make('R_10', { name: 'Volatility 10 Index', change_pct: -0.5, signal: signal('SELL', 40, 0.05) }),
    make('frxEURUSD', {
        name: 'EUR/USD',
        category: 'forex',
        market_name: 'Forex',
        change_pct: 0.1,
        signal: signal('NEUTRAL', 10),
    }),
    make('frxGBPUSD', { name: 'GBP/USD', category: 'forex', market_name: 'Forex', is_open: false, status: 'closed' }),
    make('BOOM1000', {
        name: 'Boom 1000 Index',
        category: 'boom_crash',
        change_pct: null,
        signal: signal('BUY', 90, null),
    }),
];

describe('filterRows', () => {
    it('keeps everything with the default filters', () => {
        expect(filterRows(rows, DEFAULT_FILTERS)).toHaveLength(5);
    });

    it('filters by category, by signal, by open markets and by search text on name, symbol and market', () => {
        expect(filterRows(rows, { ...DEFAULT_FILTERS, category: 'forex' }).map(row => row.symbol)).toEqual([
            'frxEURUSD',
            'frxGBPUSD',
        ]);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, signal: 'BUY' }).map(row => row.symbol)).toEqual([
            'R_100',
            'BOOM1000',
        ]);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, open_only: true })).toHaveLength(4);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, query: ' eur' }).map(row => row.symbol)).toEqual(['frxEURUSD']);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, query: 'r_10' })).toHaveLength(2);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, query: 'forex' })).toHaveLength(2);
    });

    it('combines filters, and a signal filter hides markets that have no signal yet', () => {
        expect(filterRows(rows, { ...DEFAULT_FILTERS, category: 'forex', signal: 'NEUTRAL' })).toHaveLength(1);
        expect(filterRows(rows, { ...DEFAULT_FILTERS, signal: 'SELL', category: 'forex' })).toHaveLength(0);
    });
});

describe('sortRows', () => {
    it('sorts by strength either way and does not change the original', () => {
        const before = rows.map(row => row.symbol);
        expect(
            sortRows(rows, 'strength', 'desc')
                .map(row => row.symbol)
                .slice(0, 3)
        ).toEqual(['BOOM1000', 'R_100', 'R_10']);
        expect(
            sortRows(rows, 'strength', 'asc')
                .map(row => row.symbol)
                .slice(0, 3)
        ).toEqual(['frxEURUSD', 'R_10', 'R_100']);
        expect(rows.map(row => row.symbol)).toEqual(before);
    });

    it('always puts markets with no value last, in both directions', () => {
        expect(
            sortRows(rows, 'change', 'desc')
                .map(row => row.symbol)
                .pop()
        ).toBe('BOOM1000');
        expect(
            sortRows(rows, 'change', 'asc')
                .map(row => row.symbol)
                .pop()
        ).toBe('BOOM1000');
        expect(
            sortRows(rows, 'strength', 'desc')
                .map(row => row.symbol)
                .pop()
        ).toBe('frxGBPUSD');
        expect(
            sortRows(rows, 'volatility', 'desc')
                .map(row => row.symbol)
                .slice(0, 2)
        ).toEqual(['R_100', 'frxEURUSD']);
    });

    it('sorts names alphabetically and the signed score from strongest buy to strongest sell', () => {
        expect(sortRows(rows, 'name', 'asc').map(row => row.name)[0]).toBe('Boom 1000 Index');
        expect(
            sortRows(rows, 'score', 'desc')
                .map(row => row.symbol)
                .slice(0, 2)
        ).toEqual(['BOOM1000', 'R_100']);
        expect(sortRows(rows, 'score', 'asc')[0].symbol).toBe('R_10');
    });
});

describe('categoryCounts and summarise', () => {
    it('counts markets per category', () => {
        expect(categoryCounts(rows)).toEqual({ volatility: 2, forex: 2, boom_crash: 1 });
    });

    it('counts signals', () => {
        expect(summarise(rows)).toEqual({ markets: 5, analysed: 4, buy: 2, sell: 1, neutral: 1 });
    });
});
