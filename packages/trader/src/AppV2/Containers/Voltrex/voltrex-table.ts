import type { TScanRow } from './use-voltrex-scanner';
import type { TSignalDirection } from './voltrex-analysis';
import type { TCategoryId } from './voltrex-config';

export type TTableFilters = {
    query: string;
    category: TCategoryId | 'all';
    signal: TSignalDirection | 'all';
    open_only: boolean;
};

export const DEFAULT_FILTERS: TTableFilters = { query: '', category: 'all', signal: 'all', open_only: false };

export type TSortKey = 'name' | 'change' | 'volatility' | 'strength' | 'score';
export type TSortDirection = 'asc' | 'desc';

export const filterRows = (rows: TScanRow[], filters: TTableFilters): TScanRow[] => {
    const query = filters.query.trim().toLowerCase();
    return rows.filter(row => {
        if (filters.category !== 'all' && row.category !== filters.category) return false;
        if (filters.open_only && !row.is_open) return false;
        if (filters.signal !== 'all' && row.signal?.direction !== filters.signal) return false;
        if (query && !`${row.name} ${row.symbol} ${row.market_name}`.toLowerCase().includes(query)) return false;
        return true;
    });
};

const valueOf = (row: TScanRow, key: TSortKey): number | string | null => {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'change') return row.change_pct;
    if (key === 'volatility') return row.signal?.volatility_pct ?? null;
    if (key === 'strength') return row.signal ? row.signal.strength : null;
    // signed: strongest BUY at the top when descending, strongest SELL at the top when ascending
    return row.signal ? row.signal.score : null;
};

/** Sorts a copy. Markets with no value for the column always go last, whichever way it is sorted. */
export const sortRows = (rows: TScanRow[], key: TSortKey, direction: TSortDirection): TScanRow[] =>
    [...rows].sort((a, b) => {
        const left = valueOf(a, key);
        const right = valueOf(b, key);
        if (left === null && right === null) return a.name.localeCompare(b.name);
        if (left === null) return 1;
        if (right === null) return -1;
        let order = 0;
        if (typeof left === 'string' || typeof right === 'string') order = String(left).localeCompare(String(right));
        else order = left - right;
        if (order === 0) return a.name.localeCompare(b.name);
        return direction === 'asc' ? order : -order;
    });

/** How many markets each category holds, for the filter chips. */
export const categoryCounts = (rows: TScanRow[]): Record<string, number> =>
    rows.reduce<Record<string, number>>(
        (counts, row) => ({ ...counts, [row.category]: (counts[row.category] ?? 0) + 1 }),
        {}
    );

export type TSummary = { markets: number; analysed: number; buy: number; sell: number; neutral: number };

export const summarise = (rows: TScanRow[]): TSummary => ({
    markets: rows.length,
    analysed: rows.filter(row => row.signal).length,
    buy: rows.filter(row => row.signal?.direction === 'BUY').length,
    sell: rows.filter(row => row.signal?.direction === 'SELL').length,
    neutral: rows.filter(row => row.signal?.direction === 'NEUTRAL').length,
});
