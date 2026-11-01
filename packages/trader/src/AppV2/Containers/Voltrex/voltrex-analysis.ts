import { localize } from '@deriv-com/translations';

import {
    atr,
    bollinger,
    ema,
    macd,
    roc,
    rsi,
    sma,
    supportResistance,
    TBollinger,
    TCandle,
    TMacd,
} from './voltrex-indicators';

/**
 * Turns candles into a BUY, SELL or NEUTRAL reading, with the reason for every vote.
 *
 * Seven indicator "votes" between -1 (bearish) and +1 (bullish) are combined with fixed weights into a score from
 * -1 to +1 for one timeframe. A second, higher timeframe confirms or contradicts it. Strength is how far the final
 * score is from zero, and agreement is the share of the vote weight that points the same way. Both are measures of
 * how well the indicators line up. They are NOT a probability that a trade will win, and no market, signal or
 * timeframe has been shown to predict the next price.
 */

export type TSignalDirection = 'BUY' | 'SELL' | 'NEUTRAL';
export type TTrend = 'up' | 'down' | 'sideways';
export type TVoteName = 'trend' | 'macd' | 'rsi' | 'bollinger' | 'momentum' | 'price_action' | 'levels';

export type TVote = {
    name: TVoteName;
    label: string;
    /** -1 (bearish) to +1 (bullish). */
    vote: number;
    weight: number;
    reason: string;
};

export type TReadings = {
    price: number;
    ema_fast: number;
    ema_slow: number;
    sma: number | null;
    rsi: number | null;
    macd: TMacd | null;
    bollinger: TBollinger | null;
    atr: number | null;
    /** ATR as a percentage of the price: how far one candle typically moves. */
    atr_pct: number | null;
    roc: number | null;
    support: number | null;
    resistance: number | null;
};

export type TFrameAnalysis = {
    /** -1 to +1. */
    score: number;
    votes: TVote[];
    readings: TReadings;
    trend: TTrend;
    candle_count: number;
};

export type TAlignment = 'aligned' | 'conflict' | 'mixed' | 'unconfirmed';

export type TSignal = {
    direction: TSignalDirection;
    /** 0 to 100: how far the final score is from neutral. */
    strength: number;
    /** 0 to 100: the share of the vote weight (primary timeframe) pointing the same way as the signal. */
    agreement: number;
    /** -1 to +1, after combining the timeframes. */
    score: number;
    alignment: TAlignment;
    trend: TTrend;
    momentum: 'strong' | 'moderate' | 'weak';
    volatility_pct: number | null;
    reasons: string[];
    primary: TFrameAnalysis;
    confirm: TFrameAnalysis | null;
};

/** Fewest candles an analysis is run on: the 50-period average needs 50, and MACD needs 34. */
export const MIN_CANDLES = 50;
export const EMA_FAST = 20;
export const EMA_SLOW = 50;
/** A final score at or beyond this (either way) is a BUY or SELL; anything between is NEUTRAL. */
export const SIGNAL_THRESHOLD = 0.25;
/** How much of the final score comes from the primary timeframe; the confirming one gets the rest. */
export const PRIMARY_WEIGHT = 0.65;
/** A timeframe score smaller than this counts as undecided when checking alignment. */
const DECIDED = 0.15;

const WEIGHTS: Record<TVoteName, number> = {
    trend: 2,
    macd: 2,
    momentum: 1.5,
    rsi: 1,
    bollinger: 1,
    price_action: 1,
    levels: 1,
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const fmt = (value: number, digits = 2) => value.toFixed(digits);

/** More decimals for small prices, so a 0.0042 move is not shown as 0.00. */
const price = (value: number) => (Math.abs(value) >= 100 ? value.toFixed(2) : value.toPrecision(5));

const word = (vote: number) => {
    if (vote > 0.15) return localize('bullish');
    if (vote < -0.15) return localize('bearish');
    return localize('neutral');
};

/** Gaps smaller than this share of a normal candle range are noise, not direction. */
const DEAD_ZONE = 0.25;
const MACD_DEAD_ZONE = 0.02;

const sign = (value: number) => Math.sign(value) || 0;

const lean = (gap: number, noise: number) => (Math.abs(gap) <= noise ? 0 : sign(gap));

const trendVote = (p: number, fast: number, slow: number, atr_value: number | null): TVote => {
    const noise = (atr_value ?? 0) * DEAD_ZONE;
    const vote = (lean(fast - slow, noise) + lean(p - fast, noise)) / 2;
    let reason = localize('The {{fast}} and {{slow}} averages and the price disagree, so there is no clear trend.', {
        fast: EMA_FAST,
        slow: EMA_SLOW,
    });
    if (vote === 1) {
        reason = localize(
            'The {{fast}} average is above the {{slow}} average and the price is above both: an uptrend.',
            {
                fast: EMA_FAST,
                slow: EMA_SLOW,
            }
        );
    } else if (vote === -1) {
        reason = localize(
            'The {{fast}} average is below the {{slow}} average and the price is below both: a downtrend.',
            {
                fast: EMA_FAST,
                slow: EMA_SLOW,
            }
        );
    }
    return { name: 'trend', label: localize('Trend'), vote, weight: WEIGHTS.trend, reason };
};

const macdVote = (value: TMacd | null, atr_value: number | null): TVote => {
    const base = { name: 'macd' as const, label: localize('MACD'), weight: WEIGHTS.macd };
    if (!value) return { ...base, vote: 0, reason: localize('MACD needs more history.') };
    // a histogram this small next to a normal candle is rounding noise, not momentum
    const dir = lean(value.histogram, (atr_value ?? 0) * MACD_DEAD_ZONE);
    const growing = value.previous_histogram !== null && Math.abs(value.histogram) > Math.abs(value.previous_histogram);
    const vote = dir === 0 ? 0 : dir * (0.6 + (growing ? 0.4 : 0));
    let reason = localize('The MACD histogram is flat.');
    if (dir > 0) {
        reason = growing
            ? localize('The MACD histogram is positive and growing: upward momentum is building.')
            : localize('The MACD histogram is positive but shrinking: upward momentum is fading.');
    } else if (dir < 0) {
        reason = growing
            ? localize('The MACD histogram is negative and growing: downward momentum is building.')
            : localize('The MACD histogram is negative but shrinking: downward momentum is fading.');
    }
    return { ...base, vote, reason };
};

const rsiVote = (value: number | null): TVote => {
    const base = { name: 'rsi' as const, label: localize('RSI'), weight: WEIGHTS.rsi };
    if (value === null) return { ...base, vote: 0, reason: localize('RSI needs more history.') };
    let vote: number, reason: string;
    if (value > 70) {
        vote = Math.max(0.2, 1 - ((value - 70) / 10) * 0.8);
        reason = localize('RSI is {{value}}, overbought: strong, but the move may be stretched.', {
            value: fmt(value, 1),
        });
    } else if (value < 30) {
        vote = -Math.max(0.2, 1 - ((30 - value) / 10) * 0.8);
        reason = localize('RSI is {{value}}, oversold: weak, but the move may be stretched.', { value: fmt(value, 1) });
    } else {
        vote = clamp((value - 50) / 20, -1, 1);
        reason = localize('RSI is {{value}} ({{word}} side of 50).', { value: fmt(value, 1), word: word(vote) });
    }
    return { ...base, vote, reason };
};

const bollingerVote = (bands: TBollinger | null): TVote => {
    const base = { name: 'bollinger' as const, label: localize('Bollinger'), weight: WEIGHTS.bollinger };
    if (!bands || bands.percent_b === null) {
        return { ...base, vote: 0, reason: localize('Bollinger Bands need more history, or the price has not moved.') };
    }
    const vote = clamp((bands.percent_b - 0.5) * 2, -1, 1) * 0.6;
    let reason = localize('The price is {{percent}}% of the way up the Bollinger Bands.', {
        percent: fmt(bands.percent_b * 100, 0),
    });
    if (bands.percent_b > 1) reason = localize('The price is above the upper Bollinger Band: stretched upward.');
    else if (bands.percent_b < 0) reason = localize('The price is below the lower Bollinger Band: stretched downward.');
    return { ...base, vote, reason };
};

const momentumVote = (change: number | null, atr_pct: number | null): TVote => {
    const base = { name: 'momentum' as const, label: localize('Momentum'), weight: WEIGHTS.momentum };
    if (change === null || !atr_pct) return { ...base, vote: 0, reason: localize('Momentum needs more history.') };
    // ten candles of steady movement is about three typical candle ranges, so that counts as full strength
    const vote = clamp(change / (atr_pct * 3), -1, 1);
    return {
        ...base,
        vote,
        reason: localize('The price moved {{change}}% over the last 10 candles ({{word}}).', {
            change: `${change > 0 ? '+' : ''}${fmt(change)}`,
            word: word(vote),
        }),
    };
};

const priceActionVote = (candles: TCandle[]): TVote => {
    const base = { name: 'price_action' as const, label: localize('Price action'), weight: WEIGHTS.price_action };
    const recent = candles.slice(-4);
    if (recent.length < 4) return { ...base, vote: 0, reason: localize('Price action needs more history.') };
    let up = 0;
    let down = 0;
    for (let index = 1; index < recent.length; index += 1) {
        if (recent[index].close > recent[index - 1].close) up += 1;
        else if (recent[index].close < recent[index - 1].close) down += 1;
    }
    return {
        ...base,
        vote: (up - down) / 3,
        reason: localize('Of the last 3 candles, {{up}} closed higher and {{down}} closed lower.', { up, down }),
    };
};

const levelsVote = (p: number, support: number | null, resistance: number | null, atr_value: number | null): TVote => {
    const base = { name: 'levels' as const, label: localize('Support / resistance'), weight: WEIGHTS.levels };
    if (!atr_value || (support === null && resistance === null)) {
        return {
            ...base,
            vote: 0,
            reason: localize('No recent swing support or resistance was found near the price.'),
        };
    }
    if (resistance !== null && resistance - p <= 0.5 * atr_value) {
        return {
            ...base,
            vote: -0.6,
            reason: localize('The price is close to resistance at {{level}}, which may cap a rise.', {
                level: price(resistance),
            }),
        };
    }
    if (support !== null && p - support <= 0.5 * atr_value) {
        return {
            ...base,
            vote: 0.6,
            reason: localize('The price is close to support at {{level}}, which may hold a fall.', {
                level: price(support),
            }),
        };
    }
    return {
        ...base,
        vote: 0,
        reason: localize('The price is between support ({{support}}) and resistance ({{resistance}}).', {
            support: support === null ? '–' : price(support),
            resistance: resistance === null ? '–' : price(resistance),
        }),
    };
};

/** Analyses one timeframe. Null when there are fewer than MIN_CANDLES candles. */
export const analyseFrame = (candles: TCandle[]): TFrameAnalysis | null => {
    if (candles.length < MIN_CANDLES) return null;
    const closes = candles.map(candle => candle.close);
    const p = closes[closes.length - 1];
    const fast = ema(closes, EMA_FAST);
    const slow = ema(closes, EMA_SLOW);
    if (fast === null || slow === null) return null;

    const atr_value = atr(candles, 14);
    const atr_pct = atr_value === null || p === 0 ? null : (atr_value / p) * 100;
    const levels = supportResistance(candles);
    const readings: TReadings = {
        price: p,
        ema_fast: fast,
        ema_slow: slow,
        sma: sma(closes, 20),
        rsi: rsi(closes, 14),
        macd: macd(closes),
        bollinger: bollinger(closes, 20, 2),
        atr: atr_value,
        atr_pct,
        roc: roc(closes, 10),
        support: levels.support,
        resistance: levels.resistance,
    };

    const votes = [
        trendVote(p, fast, slow, atr_value),
        macdVote(readings.macd, atr_value),
        momentumVote(readings.roc, atr_pct),
        rsiVote(readings.rsi),
        bollingerVote(readings.bollinger),
        priceActionVote(candles),
        levelsVote(p, levels.support, levels.resistance, atr_value),
    ];
    const total_weight = votes.reduce((sum, item) => sum + item.weight, 0);
    const score = votes.reduce((sum, item) => sum + item.vote * item.weight, 0) / total_weight;
    const trend_vote = votes[0].vote;
    let trend: TTrend = 'sideways';
    if (trend_vote > 0.5) trend = 'up';
    else if (trend_vote < -0.5) trend = 'down';

    return { score, votes, readings, trend, candle_count: candles.length };
};

/** Combines the main timeframe with a higher one that confirms or contradicts it. */
export const analyseMarket = (primary_candles: TCandle[], confirm_candles: TCandle[] | null): TSignal | null => {
    const primary = analyseFrame(primary_candles);
    if (!primary) return null;
    const confirm = confirm_candles ? analyseFrame(confirm_candles) : null;

    let alignment: TAlignment = 'unconfirmed';
    let score = primary.score;
    if (confirm) {
        const both_decided = Math.abs(primary.score) >= DECIDED && Math.abs(confirm.score) >= DECIDED;
        if (both_decided && sign(primary.score) === sign(confirm.score)) alignment = 'aligned';
        else if (both_decided) alignment = 'conflict';
        else alignment = 'mixed';
        score = PRIMARY_WEIGHT * primary.score + (1 - PRIMARY_WEIGHT) * confirm.score;
        // a higher timeframe pointing the other way halves the conviction
        if (alignment === 'conflict') score *= 0.5;
    }

    let direction: TSignalDirection = 'NEUTRAL';
    if (score >= SIGNAL_THRESHOLD) direction = 'BUY';
    else if (score <= -SIGNAL_THRESHOLD) direction = 'SELL';

    const total_weight = primary.votes.reduce((sum, item) => sum + item.weight, 0);
    const side = sign(score);
    const agreeing = primary.votes
        .filter(item => side !== 0 && sign(item.vote) === side && Math.abs(item.vote) >= 0.1)
        .reduce((sum, item) => sum + item.weight, 0);
    const agreement = Math.round((agreeing / total_weight) * 100);

    const momentum_size = Math.abs(primary.votes.find(item => item.name === 'momentum')?.vote ?? 0);
    let momentum: TSignal['momentum'] = 'weak';
    if (momentum_size >= 0.6) momentum = 'strong';
    else if (momentum_size >= 0.3) momentum = 'moderate';

    const reasons = [...primary.votes]
        .filter(item => Math.abs(item.vote) >= 0.2 || item.name === 'levels' || item.name === 'rsi')
        .sort((a, b) => Math.abs(b.vote) * b.weight - Math.abs(a.vote) * a.weight)
        .map(item => item.reason);
    if (alignment === 'aligned') reasons.push(localize('The higher timeframe points the same way.'));
    if (alignment === 'conflict')
        reasons.push(localize('The higher timeframe points the other way, so the signal is halved.'));
    if (alignment === 'mixed') reasons.push(localize('The higher timeframe has no clear direction.'));
    if (alignment === 'unconfirmed') reasons.push(localize('The higher timeframe has not loaded yet.'));

    return {
        direction,
        strength: Math.round(Math.min(100, Math.abs(score) * 100)),
        agreement,
        score,
        alignment,
        trend: primary.trend,
        momentum,
        volatility_pct: primary.readings.atr_pct,
        reasons,
        primary,
        confirm,
    };
};

export type TVolatilityLevel = 'low' | 'medium' | 'high';

/**
 * Ranks markets by how far a candle typically moves (ATR %), within their own category: a Volatility 100 index and
 * EUR/USD move on very different scales, so each category is split into thirds on its own. Categories with fewer
 * than three markets are all medium.
 */
export const volatilityLevels = (
    items: { symbol: string; category: string; volatility_pct: number | null }[]
): Map<string, TVolatilityLevel> => {
    const levels = new Map<string, TVolatilityLevel>();
    const categories = Array.from(new Set(items.map(item => item.category)));
    categories.forEach(category => {
        const ranked = items
            .filter(item => item.category === category && item.volatility_pct !== null)
            .sort((a, b) => (a.volatility_pct as number) - (b.volatility_pct as number));
        ranked.forEach((item, index) => {
            if (ranked.length < 3) levels.set(item.symbol, 'medium');
            else if (index < ranked.length / 3) levels.set(item.symbol, 'low');
            else if (index >= (ranked.length * 2) / 3) levels.set(item.symbol, 'high');
            else levels.set(item.symbol, 'medium');
        });
    });
    return levels;
};

export type TStrategyId = 'confluence' | 'trend' | 'reversion';

export type TEntryIdea = {
    side: 'CALL' | 'PUT';
    /** 0 to 100, on the same footing as a signal's strength. */
    strength: number;
    why: string;
};

/**
 * What each automatic strategy requires before it will place a trade. Returns null when the market does not qualify.
 * - confluence: any BUY or SELL signal whose higher timeframe does not contradict it.
 * - trend: a signal that the higher timeframe confirms, in a trend that points the same way, with MACD agreeing.
 * - reversion: RSI at an extreme with the price at the edge of the Bollinger Bands, betting on a pull back.
 */
export const evaluateStrategy = (strategy: TStrategyId, signal: TSignal): TEntryIdea | null => {
    const frame = signal.primary;
    if (strategy === 'reversion') {
        const { rsi: value, bollinger: bands } = frame.readings;
        if (value === null || !bands || bands.percent_b === null) return null;
        const strength = Math.round(clamp(((Math.abs(value - 50) - 20) / 20) * 100, 0, 100));
        if (value >= 70 && bands.percent_b >= 0.95) {
            return {
                side: 'PUT',
                strength,
                why: localize('RSI {{value}} with the price at the top of the bands: betting on a pull back.', {
                    value: fmt(value, 1),
                }),
            };
        }
        if (value <= 30 && bands.percent_b <= 0.05) {
            return {
                side: 'CALL',
                strength,
                why: localize('RSI {{value}} with the price at the bottom of the bands: betting on a bounce.', {
                    value: fmt(value, 1),
                }),
            };
        }
        return null;
    }

    if (signal.direction === 'NEUTRAL' || signal.alignment === 'conflict') return null;
    const side = signal.direction === 'BUY' ? 'CALL' : 'PUT';
    if (strategy === 'trend') {
        const wanted: TTrend = signal.direction === 'BUY' ? 'up' : 'down';
        const macd_vote = frame.votes.find(item => item.name === 'macd')?.vote ?? 0;
        const same_way = sign(macd_vote) === (signal.direction === 'BUY' ? 1 : -1);
        if (signal.alignment !== 'aligned' || frame.trend !== wanted || !same_way) return null;
    }
    return {
        side,
        strength: signal.strength,
        why: localize('{{direction}} signal, strength {{strength}}, {{agreement}}% of the indicators agree.', {
            direction: signal.direction,
            strength: signal.strength,
            agreement: signal.agreement,
        }),
    };
};
