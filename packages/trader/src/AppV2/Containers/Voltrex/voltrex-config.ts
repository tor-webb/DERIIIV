import { TCandle } from './voltrex-indicators';

export type TCategoryId =
    | 'volatility'
    | 'boom_crash'
    | 'jump'
    | 'step'
    | 'other_synthetic'
    | 'forex'
    | 'crypto'
    | 'commodities'
    | 'stock_indices'
    | 'stocks'
    | 'other';

export const CATEGORIES: { id: TCategoryId; label: string }[] = [
    { id: 'volatility', label: 'Volatility' },
    { id: 'boom_crash', label: 'Boom / Crash' },
    { id: 'jump', label: 'Jump' },
    { id: 'step', label: 'Step' },
    { id: 'other_synthetic', label: 'Other synthetics' },
    { id: 'forex', label: 'Forex' },
    { id: 'crypto', label: 'Crypto' },
    { id: 'commodities', label: 'Commodities' },
    { id: 'stock_indices', label: 'Stock indices' },
    { id: 'stocks', label: 'Stocks' },
    { id: 'other', label: 'Other' },
];

/** The market and submarket come from the server's active symbols list; the symbol code settles the synthetic ones. */
export const categoryOf = (symbol: string, market = '', submarket = ''): TCategoryId => {
    const code = symbol.toUpperCase();
    if (market === 'synthetic_index' || code.startsWith('R_') || /^1HZ/.test(code) || /^(BOOM|CRASH)/.test(code)) {
        if (/^(BOOM|CRASH)/.test(code) || submarket === 'crash_index') return 'boom_crash';
        if (/^JD/.test(code) || submarket === 'jump_index') return 'jump';
        if (/^STPRNG/.test(code) || submarket === 'step_index') return 'step';
        if (/^R_\d+$/.test(code) || /^1HZ\d+V$/.test(code) || submarket === 'random_index') return 'volatility';
        return 'other_synthetic';
    }
    if (market === 'cryptocurrency' || code.startsWith('CRY')) return 'crypto';
    if (market === 'commodities') return 'commodities';
    if (market === 'indices') return 'stock_indices';
    if (market === 'stocks') return 'stocks';
    // the symbol prefix is only a fallback for when the server gives no market
    if (market === 'forex' || (!market && code.startsWith('FRX'))) return 'forex';
    return 'other';
};

export type TFrameConfig = { id: string; label: string; granularity: number; count: number };

/** The timeframe each market is analysed on, and the higher one that confirms or contradicts it. */
export const PRIMARY_FRAME: TFrameConfig = { id: '5m', label: '5m', granularity: 300, count: 120 };
export const CONFIRM_FRAME: TFrameConfig = { id: '1h', label: '1h', granularity: 3600, count: 120 };

/** How long candles are trusted before they are loaded again, in milliseconds. */
export const REFRESH_MS = 5 * 60 * 1000;
/** How many history requests may be in flight at once. The socket is shared with the rest of the platform. */
export const LOAD_CONCURRENCY = 3;
/** How many markets (the selected one plus the strongest signals) follow live ticks at once. */
export const LIVE_TICK_LIMIT = 14;
export const HOUR_SECONDS = 3600;

export type TSymbolInfo = {
    symbol: string;
    name: string;
    category: TCategoryId;
    market_name: string;
    is_open: boolean;
    pip_size: number;
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Turns the server's active symbols into the markets the scanner lists. Entries with no usable symbol are skipped. */
export const parseActiveSymbols = (response: unknown): TSymbolInfo[] => {
    const list = (response as { active_symbols?: unknown } | undefined)?.active_symbols;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const output: TSymbolInfo[] = [];
    list.forEach((item: Record<string, unknown>) => {
        const symbol = text(item?.underlying_symbol) || text(item?.symbol);
        if (!symbol || seen.has(symbol)) return;
        seen.add(symbol);
        const pip = Number(item?.pip_size);
        // the server sends pip_size as a step (0.01) or as digits (2) depending on version; both are handled
        let pip_size = 2;
        if (Number.isInteger(pip) && pip >= 0 && pip <= 8) pip_size = pip;
        else if (pip > 0 && pip < 1) pip_size = Math.min(8, Math.round(-Math.log10(pip)));
        output.push({
            symbol,
            name: text(item?.display_name) || symbol,
            category: categoryOf(symbol, text(item?.market), text(item?.submarket)),
            market_name: text(item?.market_display_name) || text(item?.market),
            is_open: item?.exchange_is_open === 1 || item?.exchange_is_open === true,
            pip_size,
        });
    });
    return output;
};

/**
 * Adds a live tick to a series of candles: it moves the newest candle's close (and high or low), or starts a new
 * candle once the tick falls past the end of the newest one. Ticks older than the newest candle are ignored.
 */
export const applyTickToCandles = (
    candles: TCandle[],
    quote: number,
    epoch: number,
    granularity: number
): TCandle[] => {
    if (!candles.length || !Number.isFinite(quote) || quote <= 0 || !Number.isFinite(epoch)) return candles;
    const newest = candles[candles.length - 1];
    if (epoch < newest.epoch) return candles;
    if (epoch >= newest.epoch + granularity) {
        const start = epoch - (epoch % granularity);
        return [
            ...candles.slice(-(CONFIRM_FRAME.count * 2)),
            { epoch: start, open: quote, high: quote, low: quote, close: quote },
        ];
    }
    return [
        ...candles.slice(0, -1),
        { ...newest, close: quote, high: Math.max(newest.high, quote), low: Math.min(newest.low, quote) },
    ];
};

/** Percentage change from the close one day (24 hourly candles) ago to the latest price, or null with too little history. */
export const dayChangePct = (hourly: TCandle[], latest: number): number | null => {
    if (hourly.length < 2 || !(latest > 0)) return null;
    const target = hourly[hourly.length - 1].epoch - 24 * HOUR_SECONDS;
    const base = [...hourly].reverse().find(candle => candle.epoch <= target) ?? hourly[0];
    return base.close > 0 ? ((latest - base.close) / base.close) * 100 : null;
};
