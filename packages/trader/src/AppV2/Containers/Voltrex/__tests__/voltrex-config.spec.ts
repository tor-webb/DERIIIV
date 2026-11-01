import { applyTickToCandles, categoryOf, dayChangePct, parseActiveSymbols } from '../voltrex-config';

const candle = (epoch: number, close: number) => ({ epoch, open: close, high: close + 1, low: close - 1, close });

describe('categoryOf', () => {
    it.each([
        ['R_100', 'synthetic_index', 'random_index', 'volatility'],
        ['1HZ75V', 'synthetic_index', 'random_index', 'volatility'],
        ['BOOM1000', 'synthetic_index', 'crash_index', 'boom_crash'],
        ['CRASH500', 'synthetic_index', 'crash_index', 'boom_crash'],
        ['JD25', 'synthetic_index', 'jump_index', 'jump'],
        ['stpRNG', 'synthetic_index', 'step_index', 'step'],
        ['RDBULL', 'synthetic_index', 'daily_reset_index', 'other_synthetic'],
        ['frxEURUSD', 'forex', 'major_pairs', 'forex'],
        ['cryBTCUSD', 'cryptocurrency', 'non_stable_coin', 'crypto'],
        ['frxXAUUSD', 'commodities', 'metals', 'commodities'],
        ['OTC_SPC', 'indices', 'americas_OTC', 'stock_indices'],
        ['SOMETHING', 'weird', '', 'other'],
    ])('puts %s in %s/%s into %s', (symbol, market, submarket, expected) => {
        expect(categoryOf(symbol, market, submarket)).toBe(expected);
    });

    it('keeps gold and other frx commodities out of forex when the market says so', () => {
        expect(categoryOf('frxXAUUSD', 'commodities', 'metals')).toBe('commodities');
    });
});

describe('parseActiveSymbols', () => {
    it('reads the new and the old symbol fields, drops duplicates and entries without a symbol', () => {
        const list = parseActiveSymbols({
            active_symbols: [
                {
                    underlying_symbol: 'R_100',
                    display_name: 'Volatility 100 Index',
                    market: 'synthetic_index',
                    market_display_name: 'Derived',
                    submarket: 'random_index',
                    exchange_is_open: 1,
                    pip_size: 0.01,
                },
                { symbol: 'frxEURUSD', display_name: 'EUR/USD', market: 'forex', exchange_is_open: 0, pip_size: 5 },
                { symbol: 'R_100' },
                { display_name: 'no symbol' },
            ],
        });
        expect(list.map(item => item.symbol)).toEqual(['R_100', 'frxEURUSD']);
        expect(list[0]).toMatchObject({
            category: 'volatility',
            is_open: true,
            pip_size: 2,
            name: 'Volatility 100 Index',
        });
        expect(list[1]).toMatchObject({ category: 'forex', is_open: false, pip_size: 5 });
    });

    it('returns an empty list for a missing or failed response', () => {
        expect(parseActiveSymbols(undefined)).toEqual([]);
        expect(parseActiveSymbols({ error: { code: 'x' } })).toEqual([]);
    });
});

describe('applyTickToCandles', () => {
    const candles = [candle(0, 10), candle(300, 12)];

    it('moves the close, high and low of the newest candle', () => {
        const next = applyTickToCandles(candles, 14, 350, 300);
        expect(next).toHaveLength(2);
        expect(next[1]).toMatchObject({ close: 14, high: 14, low: 11 });
        expect(candles[1].close).toBe(12);
    });

    it('starts a new candle on the candle boundary once the tick is past the newest one', () => {
        const next = applyTickToCandles(candles, 9, 650, 300);
        expect(next).toHaveLength(3);
        expect(next[2]).toEqual({ epoch: 600, open: 9, high: 9, low: 9, close: 9 });
    });

    it('ignores stale ticks and invalid quotes', () => {
        expect(applyTickToCandles(candles, 15, 100, 300)).toBe(candles);
        expect(applyTickToCandles(candles, NaN, 400, 300)).toBe(candles);
        expect(applyTickToCandles([], 5, 400, 300)).toEqual([]);
    });
});

describe('dayChangePct', () => {
    it('compares with the close 24 hourly candles earlier', () => {
        const hourly = Array.from({ length: 30 }, (_item, index) => candle(index * 3600, 100 + index));
        // newest epoch 29h, base candle at 5h closes 105; latest 129
        expect(dayChangePct(hourly, 129)).toBeCloseTo(((129 - 105) / 105) * 100, 8);
    });

    it('uses the oldest candle when less than a day is loaded, and is null with no history', () => {
        const hourly = [candle(0, 100), candle(3600, 101)];
        expect(dayChangePct(hourly, 110)).toBeCloseTo(10, 8);
        expect(dayChangePct([], 110)).toBeNull();
    });
});
