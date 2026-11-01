/**
 * Technical indicators for the Voltrex scanner: plain functions over prices (oldest first), no React, no network.
 * Each returns null when there is not enough data rather than guessing. Formulas are the usual textbook ones:
 *
 * - SMA: the average of the last `period` prices.
 * - EMA: seeded with the SMA of the first `period` prices, then each price moves it by 2 / (period + 1) of the gap.
 * - RSI: Wilder's smoothing (first averages are plain means of the first `period` changes).
 * - MACD: EMA(fast) minus EMA(slow); the signal line is an EMA of the MACD line; the histogram is MACD minus signal.
 * - Bollinger Bands: SMA plus or minus a multiple of the population standard deviation. %B is where the price sits
 *   between the bands (0 = lower band, 1 = upper band).
 * - ATR: Wilder's smoothing of the true range (the largest of high - low, |high - previous close|, |low - previous close|).
 * - ROC (momentum): percentage change over `n` candles.
 * - Support and resistance: swing lows and highs, a price that is the lowest (highest) within `k` candles each side.
 */

export type TCandle = { epoch: number; open: number; high: number; low: number; close: number };

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export const last = <T>(items: (T | null)[]): T | null => (items.length ? items[items.length - 1] : null);

/** Simple moving average at every index; null until `period` prices exist. */
export const smaSeries = (values: number[], period: number): (number | null)[] => {
    const output: (number | null)[] = [];
    let sum = 0;
    values.forEach((value, index) => {
        sum += value;
        if (index >= period) sum -= values[index - period];
        output.push(index >= period - 1 ? sum / period : null);
    });
    return output;
};

/** Exponential moving average at every index; null until `period` prices exist. */
export const emaSeries = (values: number[], period: number): (number | null)[] => {
    const output: (number | null)[] = values.map(() => null);
    if (values.length < period || period < 1) return output;
    const k = 2 / (period + 1);
    let current = mean(values.slice(0, period));
    output[period - 1] = current;
    for (let index = period; index < values.length; index += 1) {
        current = values[index] * k + current * (1 - k);
        output[index] = current;
    }
    return output;
};

export const sma = (values: number[], period: number): number | null => last(smaSeries(values, period));

export const ema = (values: number[], period: number): number | null => last(emaSeries(values, period));

/** Relative strength index (Wilder). 100 when every change is up, 0 when every change is down, 50 when flat. */
export const rsi = (values: number[], period = 14): number | null => {
    if (values.length < period + 1) return null;
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

export type TMacd = { macd: number; signal: number; histogram: number; previous_histogram: number | null };

/** MACD with the standard 12, 26, 9 settings. Needs `slow + signal - 1` prices (34 by default). */
export const macd = (values: number[], fast = 12, slow = 26, signal_period = 9): TMacd | null => {
    const fast_line = emaSeries(values, fast);
    const slow_line = emaSeries(values, slow);
    const macd_line: number[] = [];
    values.forEach((_value, index) => {
        const quick = fast_line[index];
        const steady = slow_line[index];
        if (quick !== null && steady !== null) macd_line.push(quick - steady);
    });
    if (macd_line.length < signal_period) return null;
    const signal_line = emaSeries(macd_line, signal_period);
    const latest = signal_line[signal_line.length - 1];
    const before = signal_line.length >= 2 ? signal_line[signal_line.length - 2] : null;
    if (latest === null) return null;
    const line = macd_line[macd_line.length - 1];
    return {
        macd: line,
        signal: latest,
        histogram: line - latest,
        previous_histogram: before === null ? null : macd_line[macd_line.length - 2] - before,
    };
};

export type TBollinger = { upper: number; middle: number; lower: number; width_pct: number; percent_b: number | null };

const bollingerAt = (window: number[], multiple: number, price: number): TBollinger => {
    const middle = mean(window);
    const deviation = Math.sqrt(mean(window.map(value => (value - middle) ** 2)));
    const upper = middle + multiple * deviation;
    const lower = middle - multiple * deviation;
    return {
        upper,
        middle,
        lower,
        width_pct: middle === 0 ? 0 : ((upper - lower) / middle) * 100,
        percent_b: upper === lower ? null : (price - lower) / (upper - lower),
    };
};

export const bollinger = (values: number[], period = 20, multiple = 2): TBollinger | null => {
    if (values.length < period) return null;
    return bollingerAt(values.slice(-period), multiple, values[values.length - 1]);
};

/** The bands at every index, for drawing on the chart. */
export const bollingerSeries = (values: number[], period = 20, multiple = 2): (TBollinger | null)[] =>
    values.map((value, index) =>
        index + 1 < period ? null : bollingerAt(values.slice(index + 1 - period, index + 1), multiple, value)
    );

/** Average true range (Wilder). Needs `period + 1` candles. */
export const atr = (candles: TCandle[], period = 14): number | null => {
    if (candles.length < period + 1) return null;
    const ranges = candles.slice(1).map((candle, index) => {
        const previous_close = candles[index].close;
        return Math.max(
            candle.high - candle.low,
            Math.abs(candle.high - previous_close),
            Math.abs(candle.low - previous_close)
        );
    });
    let current = mean(ranges.slice(0, period));
    for (let index = period; index < ranges.length; index += 1) {
        current = (current * (period - 1) + ranges[index]) / period;
    }
    return current;
};

/** Percentage change over `n` candles (rate of change). */
export const roc = (values: number[], n = 10): number | null => {
    if (values.length < n + 1) return null;
    const base = values[values.length - 1 - n];
    return base === 0 ? null : ((values[values.length - 1] - base) / base) * 100;
};

export type TLevels = { support: number | null; resistance: number | null };

/**
 * The nearest swing low below the price and swing high above it. A swing point must be confirmed by `k` candles on
 * each side, so the newest `k` candles never count. Only the last `lookback` candles are searched.
 */
export const supportResistance = (candles: TCandle[], k = 3, lookback = 120): TLevels => {
    if (candles.length < 2 * k + 1) return { support: null, resistance: null };
    const price = candles[candles.length - 1].close;
    const start = Math.max(k, candles.length - lookback);
    let support: number | null = null;
    let resistance: number | null = null;
    for (let index = start; index < candles.length - k; index += 1) {
        const candle = candles[index];
        const around = candles.slice(index - k, index + k + 1).filter((_other, offset) => offset !== k);
        if (around.every(other => candle.high > other.high) && candle.high > price) {
            if (resistance === null || candle.high < resistance) resistance = candle.high;
        }
        if (around.every(other => candle.low < other.low) && candle.low < price) {
            if (support === null || candle.low > support) support = candle.low;
        }
    }
    return { support, resistance };
};
