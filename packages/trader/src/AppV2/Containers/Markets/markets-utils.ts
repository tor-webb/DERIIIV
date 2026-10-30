import {
    MARKET_SYMBOLS,
    SETTINGS_CHANGED_EVENT,
    STALE_AFTER_SECONDS,
    TMarketGroup,
    WATCHLIST_STORAGE_KEY,
} from './markets-config';

export type TCandle = { epoch: number; open: number; high: number; low: number; close: number };

export type TVolatilityLevel = 'low' | 'medium' | 'high';

/** What is known about one market. Prices are filled in by the one-hour history, then kept fresh by live ticks. */
export type TMarketEntry = {
    status: 'loading' | 'ready' | 'unavailable';
    /** Price one hour ago (the open of the first candle). */
    open?: number;
    high?: number;
    low?: number;
    last?: number;
    pip_size?: number;
    /** Epoch of the newest candle or tick. */
    updated?: number;
    /** Closing price of each candle in the window, oldest first. The last one follows live ticks. Drives the sparkline. */
    closes?: number[];
};

export type TMarketRow = {
    symbol: string;
    name: string;
    group: TMarketGroup;
    status: TMarketEntry['status'];
    price: number | null;
    pip_size: number;
    change_pct: number | null;
    /** High minus low over the hour, as a percentage of the low. The page's measure of volatility. */
    range_pct: number | null;
    volatility: TVolatilityLevel | null;
    is_closed: boolean;
    /** Prices across the window, oldest first, for the sparkline. Empty until loaded. */
    closes: number[];
    /**
     * Where the price sits between the window's low (0) and high (1). Null when the range is flat or the market has not
     * loaded. Optional so rows built by hand (tests, other pages) need not set it. Used by the scanner.
     */
    range_position?: number | null;
};

const isPositive = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Reads the candles of a `ticks_history` response, dropping anything that is not a usable candle. */
export const parseCandles = (response: unknown): { candles: TCandle[]; pip_size: number } | null => {
    const source = response as { candles?: unknown; pip_size?: unknown; error?: unknown } | undefined;
    if (!source || source.error || !Array.isArray(source.candles)) return null;
    const candles = source.candles
        .map(candle => ({
            epoch: Number(candle?.epoch),
            open: Number(candle?.open),
            high: Number(candle?.high),
            low: Number(candle?.low),
            close: Number(candle?.close),
        }))
        .filter(
            candle =>
                Number.isFinite(candle.epoch) &&
                isPositive(candle.open) &&
                isPositive(candle.high) &&
                isPositive(candle.low) &&
                isPositive(candle.close)
        );
    if (!candles.length) return null;
    const pip_size = Number(source.pip_size);
    return { candles, pip_size: Number.isInteger(pip_size) && pip_size >= 0 && pip_size <= 8 ? pip_size : 2 };
};

/**
 * `granularity` is the candle size. A candle's epoch is when it opened, so for large candles the market may have ticked
 * up to `granularity` seconds after it. Counting that time (but never beyond now) stops a live market on hourly candles
 * from looking closed before its first tick arrives.
 */
export const entryFromCandles = (
    candles: TCandle[],
    pip_size: number,
    granularity = 60,
    now_seconds = Math.floor(Date.now() / 1000)
): TMarketEntry => {
    const last_candle = candles[candles.length - 1];
    return {
        status: 'ready',
        open: candles[0].open,
        high: Math.max(...candles.map(candle => candle.high)),
        low: Math.min(...candles.map(candle => candle.low)),
        last: last_candle.close,
        pip_size,
        updated: Math.min(last_candle.epoch + granularity, Math.max(last_candle.epoch, now_seconds)),
        closes: candles.map(candle => candle.close),
    };
};

/** Folds a live tick into an entry. The hour's open stays where it was, the high and low widen if the tick breaks them. */
export const applyTick = (entry: TMarketEntry, quote: number, epoch: number): TMarketEntry => {
    if (!isPositive(quote)) return entry;
    if (entry.status !== 'ready') {
        return {
            ...entry,
            status: 'ready',
            open: quote,
            high: quote,
            low: quote,
            last: quote,
            updated: epoch,
            closes: [quote],
        };
    }
    return {
        ...entry,
        last: quote,
        high: Math.max(entry.high ?? quote, quote),
        low: Math.min(entry.low ?? quote, quote),
        updated: epoch,
        closes: entry.closes?.length ? [...entry.closes.slice(0, -1), quote] : [quote],
    };
};

export const buildRow = (
    market: { symbol: string; name: string; group: TMarketGroup },
    entry: TMarketEntry | undefined,
    now_seconds: number
): TMarketRow => {
    const status = entry?.status ?? 'loading';
    const base = {
        ...market,
        status,
        price: null,
        pip_size: entry?.pip_size ?? 2,
        change_pct: null,
        range_pct: null,
        volatility: null,
        is_closed: false,
        closes: [] as number[],
        range_position: null as number | null,
    };
    if (!entry || status !== 'ready' || !isPositive(entry.last) || !isPositive(entry.open)) return base;

    const change_pct = ((entry.last - entry.open) / entry.open) * 100;
    const range_pct =
        isPositive(entry.high) && isPositive(entry.low) ? ((entry.high - entry.low) / entry.low) * 100 : null;
    const range_position =
        isPositive(entry.high) && isPositive(entry.low) && entry.high > entry.low
            ? Math.min(1, Math.max(0, (entry.last - entry.low) / (entry.high - entry.low)))
            : null;
    return {
        ...base,
        price: entry.last,
        change_pct,
        range_pct,
        range_position,
        closes: entry.closes ?? [],
        is_closed: entry.updated !== undefined && now_seconds - entry.updated > STALE_AFTER_SECONDS,
    };
};

/**
 * Labels each market Low, Medium or High volatility by where its range sits among markets of the same kind. Synthetic
 * indices and forex pairs move on very different scales, so they are ranked separately. With fewer than three markets
 * in a group there is nothing to compare against, so they are all Medium.
 */
export const withVolatilityLevels = (rows: TMarketRow[]): TMarketRow[] => {
    const levels = new Map<string, TVolatilityLevel>();
    (['synthetic', 'forex'] as TMarketGroup[]).forEach(group => {
        const ranked = rows
            .filter(row => row.group === group && row.range_pct !== null && !row.is_closed)
            .sort((a, b) => (a.range_pct as number) - (b.range_pct as number));
        ranked.forEach((row, index) => {
            if (ranked.length < 3) levels.set(row.symbol, 'medium');
            else if (index < ranked.length / 3) levels.set(row.symbol, 'low');
            else if (index >= (ranked.length * 2) / 3) levels.set(row.symbol, 'high');
            else levels.set(row.symbol, 'medium');
        });
    });
    return rows.map(row => ({ ...row, volatility: levels.get(row.symbol) ?? null }));
};

/** The biggest risers and fallers over the hour. Markets that are closed or have not loaded are left out. */
export const getTopMovers = (rows: TMarketRow[], count = 3) => {
    const live = rows.filter(row => row.change_pct !== null && !row.is_closed);
    return {
        gainers: live
            .filter(row => (row.change_pct as number) > 0)
            .sort((a, b) => (b.change_pct as number) - (a.change_pct as number))
            .slice(0, count),
        losers: live
            .filter(row => (row.change_pct as number) < 0)
            .sort((a, b) => (a.change_pct as number) - (b.change_pct as number))
            .slice(0, count),
    };
};

export type TSortKey = 'name' | 'change' | 'volatility';

/** Rows that have no value for the sort go last, so a market that is still loading never jumps to the top. */
export const sortRows = (rows: TMarketRow[], key: TSortKey): TMarketRow[] => {
    const list = [...rows];
    if (key === 'name') return list;
    const value = (row: TMarketRow) => {
        if (key === 'change') return row.change_pct === null ? null : -Math.abs(row.change_pct);
        return row.range_pct === null ? null : -row.range_pct;
    };
    return list.sort((a, b) => {
        const first = value(a);
        const second = value(b);
        if (first === null && second === null) return 0;
        if (first === null) return 1;
        if (second === null) return -1;
        return first - second;
    });
};

export const formatPrice = (price: number | null, pip_size: number) => (price === null ? '–' : price.toFixed(pip_size));

export const formatPercent = (value: number | null, with_sign = false) => {
    if (value === null) return '–';
    const text = Math.abs(value).toFixed(2);
    if (!with_sign || Number(text) === 0) return `${text}%`;
    return `${value > 0 ? '+' : '−'}${text}%`;
};

/** Lower case with spaces, slashes and punctuation removed, so "eur usd", "EUR/USD" and "eurusd" all match. */
const normalizeSearch = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** True when the query is empty or appears in the market's name or symbol. */
export const matchesSearch = (row: Pick<TMarketRow, 'name' | 'symbol'>, query: string): boolean => {
    const needle = normalizeSearch(query);
    if (!needle) return true;
    return normalizeSearch(row.name).includes(needle) || normalizeSearch(row.symbol).includes(needle);
};

/**
 * Turns prices into the `points` of an SVG polyline that fills a width x height box, with the lowest price at the
 * bottom. A flat line sits in the middle. Fewer than two prices give no line.
 */
export const buildSparklinePoints = (values: number[], width: number, height: number, padding = 2): string => {
    if (values.length < 2) return '';
    const low = Math.min(...values);
    const high = Math.max(...values);
    const span = high - low;
    const inner_height = height - padding * 2;
    return values
        .map((value, index) => {
            const x = (index / (values.length - 1)) * width;
            const y = span === 0 ? height / 2 : padding + (1 - (value - low) / span) * inner_height;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
};

/* ----------------------------------------------------------------------------------------------- */
/* Watchlist storage                                                                                */
/* ----------------------------------------------------------------------------------------------- */

export const KNOWN_SYMBOLS = new Set(MARKET_SYMBOLS.map(market => market.symbol));

/** The starred markets. Anything unreadable or no longer listed is dropped rather than trusted. */
export const readWatchlist = (): string[] => {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(WATCHLIST_STORAGE_KEY) ?? '[]');
        return Array.isArray(parsed)
            ? Array.from(new Set(parsed.filter((symbol): symbol is string => KNOWN_SYMBOLS.has(symbol))))
            : [];
    } catch {
        return [];
    }
};

/** Tells a mounted price-alert watcher that the watchlist or the alert settings changed. */
export const announceSettingsChanged = () => {
    try {
        window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
    } catch {
        // no window (tests of pure code)
    }
};

export const writeWatchlist = (symbols: string[]) => {
    try {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(symbols));
    } catch {
        // storage can be unavailable (private mode, quota); the stars still work until the page is closed
    }
    announceSettingsChanged();
};

export const toggleSymbol = (symbols: string[], symbol: string): string[] =>
    symbols.includes(symbol) ? symbols.filter(item => item !== symbol) : [...symbols, symbol];
