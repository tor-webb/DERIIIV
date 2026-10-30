/**
 * Technical indicators for bots, as plain functions over a list of prices (oldest first). Each returns the latest
 * value. They throw `NotEnoughData` rather than guess when the list is too short.
 *
 * Formulas (the usual textbook ones):
 * - SMA: the average of the last `period` prices.
 * - EMA: starts from the SMA of the first `period` prices, then each price moves it by 2 / (period + 1) of the gap.
 * - RSI: Wilder's smoothing. The first average gain and loss are plain averages of the first `period` changes, and
 *   every later one is (previous x (period - 1) + current) / period.
 * - Bollinger Bands: the SMA, plus or minus a multiple of the population standard deviation of the last `period` prices.
 */

export class NotEnoughData extends Error {
    needed: number;

    have: number;

    constructor(needed: number, have: number) {
        super(`needs ${needed} prices, has ${have}`);
        this.needed = needed;
        this.have = have;
    }
}

const requireLength = (values: number[], needed: number) => {
    if (values.length < needed) throw new NotEnoughData(needed, values.length);
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export const sma = (values: number[], period: number): number => {
    requireLength(values, period);
    return mean(values.slice(-period));
};

export const ema = (values: number[], period: number): number => {
    requireLength(values, period);
    const k = 2 / (period + 1);
    let current = mean(values.slice(0, period));
    for (let index = period; index < values.length; index += 1) {
        current = values[index] * k + current * (1 - k);
    }
    return current;
};

export const rsi = (values: number[], period: number): number => {
    requireLength(values, period + 1);
    let gain = 0;
    let loss = 0;
    for (let index = 1; index <= period; index += 1) {
        const change = values[index] - values[index - 1];
        if (change > 0) gain += change;
        else loss -= change;
    }
    gain /= period;
    loss /= period;
    for (let index = period + 1; index < values.length; index += 1) {
        const change = values[index] - values[index - 1];
        gain = (gain * (period - 1) + Math.max(change, 0)) / period;
        loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    }
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
};

export type TBand = 'upper' | 'middle' | 'lower';

export const bollinger = (values: number[], period: number, band: TBand, up = 2, down = 2): number => {
    requireLength(values, period);
    const window = values.slice(-period);
    const middle = mean(window);
    if (band === 'middle') return middle;
    const deviation = Math.sqrt(mean(window.map(value => (value - middle) ** 2)));
    return band === 'upper' ? middle + up * deviation : middle - down * deviation;
};

export type TDirection = 'rise' | 'fall' | 'no_change';

/** Which way the newest price moved compared with the one before it. Null with fewer than two prices. */
export const direction = (values: number[]): TDirection | null => {
    if (values.length < 2) return null;
    const change = values[values.length - 1] - values[values.length - 2];
    if (change > 0) return 'rise';
    return change < 0 ? 'fall' : 'no_change';
};
