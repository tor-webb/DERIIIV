import { parseDuration, parseRiseFall, TRiseFallSpec } from './voltrex-contracts';

/**
 * What a market sells, read from the server's own contract list (`contracts_for`): which of the contract kinds the
 * Voltrex page can trade are offered there and with which limits. Anything the server does not list is not offered.
 */

type TRange = { min: number; max: number };

export type TMarketSpecs = {
    rise_fall: TRiseFallSpec | null;
    /** Contract types sold among DIGITOVER, DIGITUNDER, DIGITMATCH, DIGITDIFF, DIGITEVEN, DIGITODD, with the tick range. */
    digits: { types: string[]; ticks: TRange } | null;
    touch: { ticks: TRange | null; minutes: TRange | null } | null;
    accumulator: { growth_rates: number[] } | null;
    multiplier: { multipliers: number[] } | null;
};

export const EMPTY_SPECS: TMarketSpecs = {
    rise_fall: null,
    digits: null,
    touch: null,
    accumulator: null,
    multiplier: null,
};

const DIGIT_TYPES = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF', 'DIGITEVEN', 'DIGITODD'];
const MINUTES_PER: Record<string, number> = { s: 1 / 60, m: 1, h: 60, d: 1440 };

const widen = (current: TRange | null, next: TRange): TRange =>
    current ? { min: Math.min(current.min, next.min), max: Math.max(current.max, next.max) } : next;

const numbers = (value: unknown): number[] =>
    Array.isArray(value) ? value.map(Number).filter(item => Number.isFinite(item) && item > 0) : [];

/** Reads the tick and minute ranges of a set of rows. */
const durationRanges = (rows: Record<string, unknown>[]) => {
    let ticks: TRange | null = null;
    let minutes: TRange | null = null;
    rows.forEach(row => {
        const min = parseDuration(row.min_contract_duration);
        const max = parseDuration(row.max_contract_duration);
        if (!min || !max) return;
        if (min.unit === 't' && max.unit === 't') ticks = widen(ticks, { min: min.value, max: max.value });
        else if (min.unit !== 't' && max.unit !== 't') {
            const low = Math.ceil(min.value * MINUTES_PER[min.unit]);
            const high = Math.floor(max.value * MINUTES_PER[max.unit]);
            if (low <= high) minutes = widen(minutes, { min: low, max: high });
        }
    });
    return { ticks, minutes };
};

export const parseSpecs = (response: unknown): TMarketSpecs => {
    const available = (response as { contracts_for?: { available?: unknown } } | undefined)?.contracts_for?.available;
    if (!Array.isArray(available)) return EMPTY_SPECS;
    const rows = available.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
    const of = (types: string[]) => rows.filter(row => types.includes(String(row.contract_type)));

    const digit_rows = of(DIGIT_TYPES);
    const digit_types = DIGIT_TYPES.filter(type => digit_rows.some(row => row.contract_type === type));
    const digit_ticks = durationRanges(digit_rows).ticks;

    const touch_rows = of(['ONETOUCH', 'NOTOUCH']);
    const has_touch =
        touch_rows.some(row => row.contract_type === 'ONETOUCH') &&
        touch_rows.some(row => row.contract_type === 'NOTOUCH');
    const touch_ranges = durationRanges(touch_rows.filter(row => row.contract_type === 'ONETOUCH'));

    const accu_rows = of(['ACCU']);
    const mult_rows = of(['MULTUP', 'MULTDOWN']);
    const growth = accu_rows.flatMap(row => numbers(row.growth_rate_range ?? row.growth_rate));
    const multipliers = mult_rows.flatMap(row => numbers(row.multiplier_range ?? row.multiplier));

    return {
        rise_fall: parseRiseFall(response),
        digits: digit_types.length && digit_ticks ? { types: digit_types, ticks: digit_ticks } : null,
        touch: has_touch && (touch_ranges.ticks || touch_ranges.minutes) ? touch_ranges : null,
        accumulator: accu_rows.length ? { growth_rates: Array.from(new Set(growth)).sort((a, b) => a - b) } : null,
        multiplier:
            mult_rows.some(row => row.contract_type === 'MULTUP') &&
            mult_rows.some(row => row.contract_type === 'MULTDOWN')
                ? { multipliers: Array.from(new Set(multipliers)).sort((a, b) => a - b) }
                : null,
    };
};

/** True when the market sells what the product needs. */
export const offers = (specs: TMarketSpecs | null, product: string, contract_type?: string): boolean => {
    if (!specs) return false;
    switch (product) {
        case 'rise_fall':
            return !!specs.rise_fall;
        case 'over_under':
        case 'match_differ':
        case 'even_odd':
            return !!specs.digits && (!contract_type || specs.digits.types.includes(contract_type));
        case 'touch':
            return !!specs.touch;
        case 'accumulator':
            return !!specs.accumulator && specs.accumulator.growth_rates.length > 0;
        case 'multiplier':
            return !!specs.multiplier && specs.multiplier.multipliers.length > 0;
        default:
            return false;
    }
};
