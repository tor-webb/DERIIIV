import { bollinger, direction, ema, NotEnoughData, rsi, sma } from '../Engine/indicators';

/** The closing prices of the worked 14-period RSI example in Wilder's method (as the StockCharts RSI article gives them, to 4 decimals: rounding them changes the result). */
const WILDER = [
    44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614,
    46.282, 46.282, 46.0028, 46.0343, 46.4129, 46.223, 45.6415,
];

describe('sma', () => {
    it('averages the last `period` prices', () => {
        expect(sma([1, 2, 3, 4, 5, 6], 3)).toBe(5);
        expect(sma([10, 20], 2)).toBe(15);
        expect(sma([7], 1)).toBe(7);
    });

    it('ignores everything before the window', () => {
        expect(sma([1000, 1, 2, 3], 3)).toBe(2);
    });

    it('refuses a list that is too short instead of guessing', () => {
        expect(() => sma([1, 2], 3)).toThrow(NotEnoughData);
        expect(() => sma([], 1)).toThrow(NotEnoughData);
        expect(() => sma([1, 2], 3)).toThrow('needs 3 prices, has 2');
    });
});

describe('ema', () => {
    it('starts from the SMA of the first `period` prices and then follows the prices', () => {
        // seed (2+4)/2 = 3, k = 2/3: 8 -> 6.3333, 16 -> 12.7778
        expect(ema([2, 4], 2)).toBe(3);
        expect(ema([2, 4, 8], 2)).toBeCloseTo(6.33333333, 6);
        expect(ema([2, 4, 8, 16], 2)).toBeCloseTo(12.77777778, 6);
    });

    it('equals the SMA when there are exactly `period` prices', () => {
        expect(ema([1, 2, 3, 4, 5], 5)).toBe(3);
    });

    it('stays at the price when the price never moves', () => {
        expect(ema([5, 5, 5, 5, 5, 5], 3)).toBe(5);
    });

    it('reacts faster than the SMA to a recent jump', () => {
        const prices = [10, 10, 10, 10, 10, 20];
        expect(ema(prices, 4)).toBeGreaterThan(sma(prices, 4) - 1);
        expect(ema(prices, 4)).toBeCloseTo(14, 6);
    });

    it('refuses a list that is too short', () => {
        expect(() => ema([1], 2)).toThrow(NotEnoughData);
    });
});

describe('rsi', () => {
    it('matches the published 14-period example, first value', () => {
        // 15 prices give the first RSI value, 70.53
        expect(rsi(WILDER.slice(0, 15), 14)).toBeCloseTo(70.53, 2);
    });

    it('matches the next published values as the smoothing carries on', () => {
        expect(rsi(WILDER.slice(0, 16), 14)).toBeCloseTo(66.32, 2);
        expect(rsi(WILDER.slice(0, 17), 14)).toBeCloseTo(66.55, 1);
        expect(rsi(WILDER.slice(0, 18), 14)).toBeCloseTo(69.41, 2);
        expect(rsi(WILDER.slice(0, 19), 14)).toBeCloseTo(66.36, 2);
    });

    it('is 100 when the price only ever rose, and 0 when it only ever fell', () => {
        expect(rsi([1, 2, 3, 4, 5, 6], 5)).toBe(100);
        expect(rsi([6, 5, 4, 3, 2, 1], 5)).toBe(0);
    });

    it('is 50 when the price never moved', () => {
        expect(rsi([3, 3, 3, 3, 3, 3], 5)).toBe(50);
    });

    it('stays between 0 and 100', () => {
        const noisy = Array.from({ length: 200 }, (_unused, index) => 100 + Math.sin(index) * 7 + (index % 5));
        const value = rsi(noisy, 14);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
    });

    it('needs period + 1 prices', () => {
        expect(() => rsi(WILDER.slice(0, 14), 14)).toThrow('needs 15 prices, has 14');
    });
});

describe('bollinger', () => {
    // mean 5, population standard deviation exactly 2
    const prices = [2, 4, 4, 4, 5, 5, 7, 9];

    it('gives the SMA in the middle and the multiples of the deviation either side', () => {
        expect(bollinger(prices, 8, 'middle')).toBe(5);
        expect(bollinger(prices, 8, 'upper', 2, 2)).toBe(9);
        expect(bollinger(prices, 8, 'lower', 2, 2)).toBe(1);
    });

    it('uses the up and down multipliers separately', () => {
        expect(bollinger(prices, 8, 'upper', 1, 3)).toBe(7);
        expect(bollinger(prices, 8, 'lower', 1, 3)).toBe(-1);
    });

    it('collapses to the price when it never moves', () => {
        expect(bollinger([4, 4, 4, 4], 4, 'upper')).toBe(4);
        expect(bollinger([4, 4, 4, 4], 4, 'lower')).toBe(4);
    });

    it('uses only the last `period` prices', () => {
        expect(bollinger([100, ...prices], 8, 'middle')).toBe(5);
    });

    it('refuses a list that is too short', () => {
        expect(() => bollinger([1, 2, 3], 4, 'middle')).toThrow(NotEnoughData);
    });
});

describe('direction', () => {
    it('compares the newest price with the one before it', () => {
        expect(direction([1, 2])).toBe('rise');
        expect(direction([5, 3, 4, 2])).toBe('fall');
        expect(direction([1, 2, 2])).toBe('no_change');
    });

    it('says nothing until there are two prices', () => {
        expect(direction([])).toBeNull();
        expect(direction([1])).toBeNull();
    });
});
