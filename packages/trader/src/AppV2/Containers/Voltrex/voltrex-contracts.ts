/**
 * What a market allows for a Rise/Fall trade, read from the server's own contract list (`contracts_for`). The scanner
 * only offers a duration the server says is valid for that market, and offers no trade at all where Rise/Fall is not
 * sold (for example on Boom and Crash).
 */

export type TDurationUnit = 't' | 'm';

type TRange = { min: number; max: number };

export type TRiseFallSpec = {
    /** Allowed range per unit. Null when the market does not sell that kind of duration. */
    ticks: TRange | null;
    minutes: TRange | null;
};

type TDuration = { value: number; unit: 't' | 's' | 'm' | 'h' | 'd' };

export const parseDuration = (text: unknown): TDuration | null => {
    const match = /^(\d+)([tsmhd])$/.exec(typeof text === 'string' ? text : '');
    return match ? { value: Number(match[1]), unit: match[2] as TDuration['unit'] } : null;
};

const MINUTES_PER: Record<string, number> = { s: 1 / 60, m: 1, h: 60, d: 1440 };

const widen = (current: TRange | null, next: TRange): TRange =>
    current ? { min: Math.min(current.min, next.min), max: Math.max(current.max, next.max) } : next;

/**
 * Reads the Rise/Fall rows (CALL and PUT, at the money, no barrier) of a `contracts_for` response. A market lists tick
 * durations and minute-or-longer durations as separate rows, so the ranges are merged by unit. Null when Rise/Fall is
 * not offered.
 */
export const parseRiseFall = (response: unknown): TRiseFallSpec | null => {
    const available = (response as { contracts_for?: { available?: unknown } } | undefined)?.contracts_for?.available;
    if (!Array.isArray(available)) return null;

    const rows = available.filter(
        (item: Record<string, unknown>) =>
            item?.contract_category === 'callput' &&
            (item?.barrier_category === 'euro_atm' || item?.barrier_category === undefined) &&
            !item?.barrier &&
            (item?.contract_type === 'CALL' || item?.contract_type === 'PUT')
    ) as Record<string, unknown>[];
    // Rise needs CALL and Fall needs PUT; selling only one side is not offered here
    if (!rows.some(row => row.contract_type === 'CALL') || !rows.some(row => row.contract_type === 'PUT')) return null;

    let ticks: TRange | null = null;
    let minutes: TRange | null = null;
    rows.filter(row => row.contract_type === 'CALL').forEach(row => {
        const min = parseDuration(row.min_contract_duration);
        const max = parseDuration(row.max_contract_duration);
        if (!min || !max) return;
        if (min.unit === 't' && max.unit === 't') {
            ticks = widen(ticks, { min: min.value, max: max.value });
        } else if (min.unit !== 't' && max.unit !== 't') {
            const low = Math.ceil(min.value * MINUTES_PER[min.unit]);
            const high = Math.floor(max.value * MINUTES_PER[max.unit]);
            if (low <= high) minutes = widen(minutes, { min: low, max: high });
        }
    });
    return ticks || minutes ? { ticks, minutes } : null;
};

/** The duration used when the person has not chosen one: 5 ticks if sold, otherwise 5 minutes, kept inside the range. */
export const defaultDuration = (spec: TRiseFallSpec): { unit: TDurationUnit; value: number } => {
    const range = spec.ticks ?? (spec.minutes as TRange);
    return { unit: spec.ticks ? 't' : 'm', value: Math.min(range.max, Math.max(range.min, 5)) };
};

/** A message when the duration is not allowed for the market, or null when it is. */
export const validateDuration = (spec: TRiseFallSpec, unit: TDurationUnit, value: number): string | null => {
    const range = unit === 't' ? spec.ticks : spec.minutes;
    const name = unit === 't' ? 'ticks' : 'minutes';
    if (!range) return `This market does not sell ${name} durations.`;
    if (!Number.isInteger(value)) return 'The duration must be a whole number.';
    if (value < range.min || value > range.max) return `The duration must be ${range.min} to ${range.max} ${name}.`;
    return null;
};
