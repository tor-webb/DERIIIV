export type TMarketGroup = 'synthetic' | 'forex';

export type TWatchSymbol = { symbol: string; name: string; group: TMarketGroup };

/** The markets listed on the Markets page. A market the server does not offer is shown as unavailable. */
export const MARKET_SYMBOLS: TWatchSymbol[] = [
    { symbol: 'R_10', name: 'Volatility 10 Index', group: 'synthetic' },
    { symbol: 'R_25', name: 'Volatility 25 Index', group: 'synthetic' },
    { symbol: 'R_50', name: 'Volatility 50 Index', group: 'synthetic' },
    { symbol: 'R_75', name: 'Volatility 75 Index', group: 'synthetic' },
    { symbol: 'R_100', name: 'Volatility 100 Index', group: 'synthetic' },
    { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', group: 'synthetic' },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', group: 'synthetic' },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', group: 'synthetic' },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', group: 'synthetic' },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', group: 'synthetic' },
    { symbol: 'frxEURUSD', name: 'EUR/USD', group: 'forex' },
    { symbol: 'frxGBPUSD', name: 'GBP/USD', group: 'forex' },
    { symbol: 'frxUSDJPY', name: 'USD/JPY', group: 'forex' },
    { symbol: 'frxAUDUSD', name: 'AUD/USD', group: 'forex' },
    { symbol: 'frxUSDCAD', name: 'USD/CAD', group: 'forex' },
    { symbol: 'frxUSDCHF', name: 'USD/CHF', group: 'forex' },
    { symbol: 'frxNZDUSD', name: 'NZD/USD', group: 'forex' },
    { symbol: 'frxEURGBP', name: 'EUR/GBP', group: 'forex' },
    { symbol: 'frxEURJPY', name: 'EUR/JPY', group: 'forex' },
    { symbol: 'frxGBPJPY', name: 'GBP/JPY', group: 'forex' },
];

export type TWindowId = '1h' | '4h' | '1d';

export type TWindow = {
    id: TWindowId;
    /** Candle size in seconds, one of the sizes the API accepts. */
    granularity: number;
    /** How many candles are loaded, so granularity x count is the span the page measures over. */
    count: number;
};

/** The spans the page can measure change and volatility over. 4h and 1d are untested against the live server. */
export const WINDOWS: TWindow[] = [
    { id: '1h', granularity: 60, count: 60 },
    { id: '4h', granularity: 300, count: 48 },
    { id: '1d', granularity: 3600, count: 24 },
];

export const DEFAULT_WINDOW: TWindowId = '1h';

export const getWindow = (id: TWindowId): TWindow => WINDOWS.find(item => item.id === id) ?? WINDOWS[0];

/** A market whose last candle is older than this has stopped ticking (closed for the weekend, or paused). */
export const STALE_AFTER_SECONDS = 10 * 60;

export const WATCHLIST_STORAGE_KEY = 'markets_watchlist';

/** Fired on `window` when the watchlist or the price-alert settings change, so a mounted watcher can pick them up. */
export const SETTINGS_CHANGED_EVENT = 'markets-settings-changed';
