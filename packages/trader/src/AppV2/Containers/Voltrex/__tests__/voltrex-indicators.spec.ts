import {
    atr,
    bollinger,
    bollingerSeries,
    ema,
    emaSeries,
    macd,
    roc,
    rsi,
    sma,
    smaSeries,
    supportResistance,
    TCandle,
} from '../voltrex-indicators';

const flat = (value: number, length: number) => Array.from({ length }, () => value);
const rising = (length: number, step = 1) => Array.from({ length }, (_item, index) => 100 + index * step);

const candle = (high: number, low: number, close: number, epoch = 0): TCandle => ({
    epoch,
    open: close,
    high,
    low,
    close,
});

describe('sma', () => {
    it('averages the last period prices at every index, and is null until there are enough', () => {
        expect(smaSeries([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
        expect(sma([1, 2, 3, 4, 5], 3)).toBe(4);
        expect(sma([1, 2], 3)).toBeNull();
        expect(smaSeries([], 3)).toEqual([]);
    });
});

describe('ema', () => {
    it('starts from the SMA of the first period, then moves 2 / (period + 1) of the gap', () => {
        // seed (1+2+3)/3 = 2, k = 0.5: 4 -> 3, 5 -> 4
        expect(emaSeries([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
        expect(ema([1, 2, 3, 4, 5], 3)).toBe(4);
    });

    it('is null with too few prices and equals the price for a flat series', () => {
        expect(ema([1, 2], 3)).toBeNull();
        expect(ema(flat(7, 30), 10)).toBeCloseTo(7, 10);
    });
});

describe('rsi', () => {
    it('matches a hand calculation (period 2)', () => {
        // changes +1 -1 +1; first averages gain .5 loss .5; then gain .75 loss .25 -> RS 3 -> RSI 75
        expect(rsi([1, 2, 1, 2], 2)).toBeCloseTo(75, 10);
    });

    it('is 100 when every change is up, 0 when every change is down and 50 when nothing moves', () => {
        expect(rsi(rising(30), 14)).toBe(100);
        expect(rsi(rising(30, -1), 14)).toBeCloseTo(0, 10);
        expect(rsi(flat(100, 30), 14)).toBe(50);
    });

    it('is null with fewer than period + 1 prices', () => {
        expect(rsi(rising(14), 14)).toBeNull();
        expect(rsi(rising(15), 14)).not.toBeNull();
    });

    it('stays between 0 and 100 on a noisy series', () => {
        const noisy = Array.from({ length: 80 }, (_item, index) => 100 + Math.sin(index) * 3 + (index % 7));
        const value = rsi(noisy, 14) as number;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
    });
});

describe('macd', () => {
    it('needs slow + signal - 1 prices', () => {
        expect(macd(rising(33))).toBeNull();
        expect(macd(rising(34))).not.toBeNull();
    });

    it('is zero for a flat series', () => {
        const result = macd(flat(50, 60)) as NonNullable<ReturnType<typeof macd>>;
        expect(result.macd).toBeCloseTo(0, 10);
        expect(result.signal).toBeCloseTo(0, 10);
        expect(result.histogram).toBeCloseTo(0, 10);
    });

    it('is positive in a steady rise and negative in a steady fall', () => {
        expect((macd(rising(80)) as NonNullable<ReturnType<typeof macd>>).macd).toBeGreaterThan(0);
        expect((macd(rising(80, -0.5)) as NonNullable<ReturnType<typeof macd>>).macd).toBeLessThan(0);
    });

    it('reports the histogram as macd minus signal and keeps the previous one', () => {
        const result = macd([...flat(100, 40), ...rising(15, 2)]) as NonNullable<ReturnType<typeof macd>>;
        expect(result.histogram).toBeCloseTo(result.macd - result.signal, 10);
        expect(result.previous_histogram).not.toBeNull();
    });
});

describe('bollinger', () => {
    it('uses the population standard deviation', () => {
        // mean 3, variance (4+1+0+1+4)/5 = 2, sd = sqrt(2)
        const bands = bollinger([1, 2, 3, 4, 5], 5, 2) as NonNullable<ReturnType<typeof bollinger>>;
        expect(bands.middle).toBe(3);
        expect(bands.upper).toBeCloseTo(3 + 2 * Math.SQRT2, 10);
        expect(bands.lower).toBeCloseTo(3 - 2 * Math.SQRT2, 10);
        expect(bands.percent_b).toBeCloseTo((5 - bands.lower) / (bands.upper - bands.lower), 10);
        expect(bands.width_pct).toBeCloseTo(((4 * Math.SQRT2) / 3) * 100, 8);
    });

    it('collapses to a point, with no %B, for a flat series', () => {
        const bands = bollinger(flat(10, 20), 20, 2) as NonNullable<ReturnType<typeof bollinger>>;
        expect(bands.upper).toBe(10);
        expect(bands.lower).toBe(10);
        expect(bands.percent_b).toBeNull();
        expect(bands.width_pct).toBe(0);
    });

    it('is null with too few prices and gives a series that starts at the first full window', () => {
        expect(bollinger([1, 2, 3], 5)).toBeNull();
        const series = bollingerSeries([1, 2, 3, 4, 5, 6], 5);
        expect(series.slice(0, 4)).toEqual([null, null, null, null]);
        expect(series[4]?.middle).toBe(3);
        expect(series[5]?.middle).toBe(4);
    });
});

describe('atr', () => {
    it('is the range for candles that all have the same range and no gaps', () => {
        const candles = Array.from({ length: 30 }, (_item, index) => candle(101, 99, 100, index));
        expect(atr(candles, 14)).toBeCloseTo(2, 10);
    });

    it('counts a gap from the previous close as part of the true range', () => {
        // previous close 10, next candle 14..15: true range = max(1, |15-10|, |14-10|) = 5
        expect(atr([candle(10, 10, 10), candle(15, 14, 14.5)], 1)).toBe(5);
    });

    it('is null with fewer than period + 1 candles', () => {
        expect(
            atr(
                Array.from({ length: 14 }, () => candle(2, 1, 1.5)),
                14
            )
        ).toBeNull();
    });
});

describe('roc', () => {
    it('is the percentage change over n candles', () => {
        expect(roc([100, 110], 1)).toBeCloseTo(10, 10);
        expect(roc([100, 105, 90, 99], 3)).toBeCloseTo(-1, 10);
    });

    it('is null with too little data or a zero base', () => {
        expect(roc([1, 2], 5)).toBeNull();
        expect(roc([0, 1], 1)).toBeNull();
    });
});

describe('supportResistance', () => {
    const zigzag = [5, 4, 3, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5.5].map((value, index) => candle(value, value, value, index));

    it('finds the nearest swing low below and swing high above the price', () => {
        expect(supportResistance(zigzag, 2)).toEqual({ support: 2, resistance: 8 });
    });

    it('ignores the newest k candles, which cannot be confirmed yet', () => {
        const fresh = [...zigzag, candle(20, 20, 20, 99)];
        // a spike on the very last candle is not yet a confirmed swing high, and the price is now 20
        expect(supportResistance(fresh, 2).resistance).toBeNull();
    });

    it('returns nothing when there is too little data or no swing', () => {
        expect(supportResistance(zigzag.slice(0, 4), 2)).toEqual({ support: null, resistance: null });
        const straight = rising(20).map((value, index) => candle(value, value, value, index));
        expect(supportResistance(straight, 2)).toEqual({ support: null, resistance: null });
    });

    it('picks the closest levels when there are several', () => {
        const values = [10, 8, 6, 8, 10, 12, 10, 8, 7, 8, 9, 11, 13, 11, 9, 10];
        const candles = values.map((value, index) => candle(value, value, value, index));
        // price 10; swing lows at 6 and 7 (7 is closer); swing highs at 12 and 13 (12 is closer)
        expect(supportResistance(candles, 2)).toEqual({ support: 7, resistance: 12 });
    });
});
