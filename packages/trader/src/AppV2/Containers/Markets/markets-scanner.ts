import type { TMarketRow, TVolatilityLevel } from './markets-utils';

/**
 * Market scanner: narrows the Markets list by how each market has moved over the chosen window.
 * Every filter describes the past (what the market already did), never what it will do next.
 * No Blockly or React import here, so any page can use it.
 */

export type TScanDirection = 'any' | 'up' | 'down';
export type TScanPosition = 'any' | 'high' | 'low';

export type TScanFilters = {
    direction: TScanDirection;
    volatility: TVolatilityLevel | 'any';
    /** Smallest move, up or down, in percent over the window. 0 means no minimum. */
    min_move: number;
    /** Where the price sits in the window's range: near the high, near the low, or anywhere. */
    position: TScanPosition;
    /** Leave out markets that are closed, still loading or unavailable. */
    live_only: boolean;
};

export const DEFAULT_SCAN: TScanFilters = {
    direction: 'any',
    volatility: 'any',
    min_move: 0,
    position: 'any',
    live_only: false,
};

/** The "minimum move" choices, in percent. 0 is "any". */
export const MIN_MOVE_STEPS = [0, 0.05, 0.1, 0.25, 0.5];

/** "Near the high" means the top fifth of the range, "near the low" the bottom fifth. */
export const NEAR_EDGE = 0.2;

/** How many filters are switched on. */
export const countActiveScanFilters = (filters: TScanFilters): number =>
    [
        filters.direction !== 'any',
        filters.volatility !== 'any',
        filters.min_move > 0,
        filters.position !== 'any',
        filters.live_only,
    ].filter(Boolean).length;

const isLive = (row: TMarketRow) => row.status === 'ready' && !row.is_closed;

/**
 * True when the market passes every switched-on filter. A market with no usable figures (loading, unavailable or
 * closed) can never pass a filter that depends on those figures, so it is left out rather than guessed at.
 */
export const matchesScan = (row: TMarketRow, filters: TScanFilters): boolean => {
    if (filters.live_only && !isLive(row)) return false;

    const needs_figures =
        filters.direction !== 'any' ||
        filters.volatility !== 'any' ||
        filters.min_move > 0 ||
        filters.position !== 'any';
    if (!needs_figures) return true;
    if (!isLive(row) || row.change_pct === null) return false;

    const change = row.change_pct;
    if (filters.direction === 'up' && !(change > 0)) return false;
    if (filters.direction === 'down' && !(change < 0)) return false;
    if (filters.min_move > 0 && Math.abs(change) < filters.min_move) return false;
    if (filters.volatility !== 'any' && row.volatility !== filters.volatility) return false;

    if (filters.position !== 'any') {
        const position = row.range_position;
        if (position === null || position === undefined) return false;
        if (filters.position === 'high' && position < 1 - NEAR_EDGE) return false;
        if (filters.position === 'low' && position > NEAR_EDGE) return false;
    }
    return true;
};

export const scanRows = (rows: TMarketRow[], filters: TScanFilters): TMarketRow[] =>
    countActiveScanFilters(filters) === 0 ? rows : rows.filter(row => matchesScan(row, filters));
