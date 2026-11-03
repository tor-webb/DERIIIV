import { localize } from '@deriv-com/translations';

import { digitLabel, TContractChoice } from './voltrex-products';

/**
 * Statistics on the last digit of the price, for Over/Under, Matches/Differs and Even/Odd.
 *
 * Deriv's synthetic indices produce a random last digit, so nothing here predicts the next one. The figures show how
 * the recent digits compare with what pure chance gives, and auto-trading follows a rule built on that comparison. A
 * deviation that looks large over a hundred ticks is common by chance alone. It is a rule to follow, not an edge.
 */

/** How many of the latest digits the comparison looks at. */
export const RECENT_DIGITS = 100;
/** Most digits kept per market. */
export const MAX_DIGITS = 1000;
/** Fewest recent digits needed before any idea is offered. */
export const MIN_DIGITS = 50;

/** The last digit of a price as the server shows it, given the number of decimals the market uses. */
export const lastDigit = (quote: number, decimals: number): number | null => {
    if (!Number.isFinite(quote)) return null;
    const text = quote.toFixed(Math.max(0, Math.min(8, decimals)));
    const digit = Number(text[text.length - 1]);
    return Number.isInteger(digit) ? digit : null;
};

/** Keeps the newest digits only. */
export const pushDigit = (digits: number[], digit: number, limit = MAX_DIGITS): number[] =>
    digits.length >= limit ? [...digits.slice(digits.length - limit + 1), digit] : [...digits, digit];

export type TDigitStats = {
    count: number;
    /** How many times each digit 0..9 appeared among the recent digits. */
    counts: number[];
    /** Share (0 to 1) of each digit among the recent digits. */
    shares: number[];
    last: number | null;
    /** The digit that appeared most and least among the recent digits. */
    hottest: number;
    coldest: number;
    even_count: number;
    /** How many digits in a row, ending at the latest, were all even or all odd. */
    parity_streak: { kind: 'even' | 'odd' | null; length: number };
    /** How many times in a row the latest digit has repeated. */
    repeat_streak: number;
};

const isEven = (digit: number) => digit % 2 === 0;

export const digitStats = (digits: number[], recent = RECENT_DIGITS): TDigitStats => {
    const window = digits.slice(-recent);
    const counts = Array.from({ length: 10 }, () => 0);
    window.forEach(digit => {
        counts[digit] += 1;
    });
    const count = window.length;
    const shares = counts.map(item => (count ? item / count : 0));
    const last = window.length ? window[window.length - 1] : null;
    let hottest = 0;
    let coldest = 0;
    counts.forEach((item, digit) => {
        if (item > counts[hottest]) hottest = digit;
        if (item < counts[coldest]) coldest = digit;
    });
    let parity_length = 0;
    let repeat = 0;
    for (let index = window.length - 1; index >= 0; index -= 1) {
        if (isEven(window[index]) !== isEven(window[window.length - 1])) break;
        parity_length += 1;
    }
    for (let index = window.length - 1; index >= 0; index -= 1) {
        if (window[index] !== window[window.length - 1]) break;
        repeat += 1;
    }
    return {
        count,
        counts,
        shares,
        last,
        hottest,
        coldest,
        even_count: counts.filter((_, digit) => isEven(digit)).reduce((sum, item) => sum + item, 0),
        parity_streak: {
            kind: last === null ? null : isEven(last) ? 'even' : 'odd', // eslint-disable-line no-nested-ternary
            length: parity_length,
        },
        repeat_streak: repeat,
    };
};

/** How many standard deviations an observed count is from what chance gives: (seen - n·p) / sqrt(n·p·(1-p)). */
export const zScore = (seen: number, n: number, p: number): number => {
    if (n <= 0 || p <= 0 || p >= 1) return 0;
    return (seen - n * p) / Math.sqrt(n * p * (1 - p));
};

/** Strength on the 0 to 100 scale the risk gate uses: a deviation of one standard deviation scores 25. */
export const strengthOfZ = (z: number): number => Math.min(100, Math.round(Math.abs(z) * 25));

export type TDigitIdea = { choice: TContractChoice; strength: number; why: string };

const digitCount = (stats: TDigitStats, test: (digit: number) => boolean) =>
    stats.counts.reduce((sum, item, digit) => (test(digit) ? sum + item : sum), 0);

const pct = (value: number) => `${Math.round(value * 100)}%`;

const choice = (
    product: TContractChoice['product'],
    contract_type: string,
    barrier?: string,
    duration = 1
): TContractChoice => ({
    product,
    contract_type,
    barrier,
    label: digitLabel(contract_type, barrier),
    duration,
    duration_unit: 't',
});

/** Even / Odd: the side that has come up more often among the recent digits, when the gap is beyond chance noise. */
export const evenOddIdea = (stats: TDigitStats, duration = 1): TDigitIdea | null => {
    if (stats.count < MIN_DIGITS) return null;
    const z = zScore(stats.even_count, stats.count, 0.5);
    if (z === 0) return null;
    const is_even = z > 0;
    const seen = is_even ? stats.even_count : stats.count - stats.even_count;
    return {
        choice: choice('even_odd', is_even ? 'DIGITEVEN' : 'DIGITODD', undefined, duration),
        strength: strengthOfZ(z),
        why: localize(
            '{{side}} digits made up {{share}} of the last {{count}} (chance gives 50%). The latest {{streak}} were all {{kind}}.',
            {
                side: is_even ? localize('Even') : localize('Odd'),
                share: pct(seen / stats.count),
                count: stats.count,
                streak: stats.parity_streak.length,
                kind: stats.parity_streak.kind === 'even' ? localize('even') : localize('odd'),
            }
        ),
    };
};

/**
 * Over / Under: for every digit the server allows (Over 0 to 8, Under 1 to 9), compares how often the digits fell on
 * that side with what chance gives, and takes the side furthest above chance.
 */
export const overUnderIdea = (stats: TDigitStats, duration = 1): TDigitIdea | null => {
    if (stats.count < MIN_DIGITS) return null;
    let best: { type: string; barrier: number; z: number; share: number; chance: number } | null = null;
    for (let barrier = 0; barrier <= 9; barrier += 1) {
        if (barrier <= 8) {
            const chance = (9 - barrier) / 10;
            const seen = digitCount(stats, digit => digit > barrier);
            const z = zScore(seen, stats.count, chance);
            if (!best || z > best.z) best = { type: 'DIGITOVER', barrier, z, share: seen / stats.count, chance };
        }
        if (barrier >= 1) {
            const chance = barrier / 10;
            const seen = digitCount(stats, digit => digit < barrier);
            const z = zScore(seen, stats.count, chance);
            if (!best || z > best.z) best = { type: 'DIGITUNDER', barrier, z, share: seen / stats.count, chance };
        }
    }
    if (!best || best.z <= 0) return null;
    return {
        choice: choice('over_under', best.type, String(best.barrier), duration),
        strength: strengthOfZ(best.z),
        why: localize(
            'Digits {{side}} {{barrier}} made up {{share}} of the last {{count}} (chance gives {{chance}}).',
            {
                side: best.type === 'DIGITOVER' ? localize('above') : localize('below'),
                barrier: best.barrier,
                share: pct(best.share),
                count: stats.count,
                chance: pct(best.chance),
            }
        ),
    };
};

/**
 * Matches / Differs. Matches takes the digit that has appeared most, when it is clearly above the 10% chance level.
 * Differs takes the digit that has appeared least: it wins about 9 times in 10 but pays little, so one loss erases
 * several wins.
 */
export const matchDifferIdeas = (
    stats: TDigitStats,
    duration = 1
): { matches: TDigitIdea | null; differs: TDigitIdea | null } => {
    if (stats.count < MIN_DIGITS) return { matches: null, differs: null };
    const hot_z = zScore(stats.counts[stats.hottest], stats.count, 0.1);
    const cold_z = zScore(stats.counts[stats.coldest], stats.count, 0.1);
    const matches =
        hot_z > 0
            ? {
                  choice: choice('match_differ', 'DIGITMATCH', String(stats.hottest), duration),
                  strength: strengthOfZ(hot_z),
                  why: localize(
                      'Digit {{digit}} came up {{seen}} times in the last {{count}} (chance gives {{expected}}).',
                      {
                          digit: stats.hottest,
                          seen: stats.counts[stats.hottest],
                          count: stats.count,
                          expected: Math.round(stats.count / 10),
                      }
                  ),
              }
            : null;
    const differs =
        cold_z < 0
            ? {
                  choice: choice('match_differ', 'DIGITDIFF', String(stats.coldest), duration),
                  strength: strengthOfZ(cold_z),
                  why: localize(
                      'Digit {{digit}} came up only {{seen}} times in the last {{count}} (chance gives {{expected}}).',
                      {
                          digit: stats.coldest,
                          seen: stats.counts[stats.coldest],
                          count: stats.count,
                          expected: Math.round(stats.count / 10),
                      }
                  ),
              }
            : null;
    return { matches, differs };
};

/** The strongest idea for one digit product, or null when the recent digits show nothing beyond chance. */
export const bestDigitIdea = (product: string, stats: TDigitStats, duration = 1): TDigitIdea | null => {
    if (product === 'even_odd') return evenOddIdea(stats, duration);
    if (product === 'over_under') return overUnderIdea(stats, duration);
    if (product === 'match_differ') {
        const { matches, differs } = matchDifferIdeas(stats, duration);
        return (
            [matches, differs]
                .filter((item): item is TDigitIdea => item !== null)
                .sort((a, b) => b.strength - a.strength)[0] ?? null
        );
    }
    return null;
};
