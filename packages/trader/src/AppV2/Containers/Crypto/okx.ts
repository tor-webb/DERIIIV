/**
 * OKX public market data (no account, no keys): tickers for spot and perpetual futures, candles, and the funding rate.
 * This page only reads prices. Placing orders on OKX would need API keys, which must never sit in a public web page.
 */

export const OKX_BASE = 'https://www.okx.com';

export type TMarketKind = 'SPOT' | 'SWAP';

export type TTicker = {
    inst_id: string;
    /** The coin, e.g. BTC. */
    coin: string;
    last: number;
    open_24h: number;
    high_24h: number;
    low_24h: number;
    /** Traded amount in the quote currency (USDT) over 24 hours. */
    volume_24h: number;
    change_pct: number | null;
};

export type TCandle = { time: number; open: number; high: number; low: number; close: number };

export type TFunding = { rate: number; next_time: number | null };

export const BARS = [
    { id: '1m', label: '1m' },
    { id: '5m', label: '5m' },
    { id: '1H', label: '1h' },
    { id: '1D', label: '1d' },
] as const;

export type TBarId = (typeof BARS)[number]['id'];

/** The coins listed, so the table stays short and quick. */
export const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'LTC', 'TRX', 'AVAX', 'LINK', 'DOT'];

export const instrumentId = (coin: string, kind: TMarketKind) =>
    kind === 'SPOT' ? `${coin}-USDT` : `${coin}-USDT-SWAP`;

const num = (value: unknown): number => {
    // Number('') is 0, which would pass for a real price
    if (value === '' || value === null || value === undefined) return Number.NaN;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const coinOf = (inst_id: string) => inst_id.split('-')[0];

/** One row of OKX's tickers reply. Returns null for a row that has no usable last price. */
export const parseTicker = (row: Record<string, unknown>): TTicker | null => {
    const last = num(row.last);
    const open_24h = num(row.open24h);
    if (!row.instId || !Number.isFinite(last) || last <= 0) return null;
    const change_pct = Number.isFinite(open_24h) && open_24h > 0 ? ((last - open_24h) / open_24h) * 100 : null;
    const volume = num(row.volCcy24h);
    return {
        inst_id: String(row.instId),
        coin: coinOf(String(row.instId)),
        last,
        open_24h: Number.isFinite(open_24h) ? open_24h : last,
        high_24h: num(row.high24h),
        low_24h: num(row.low24h),
        // for swaps volCcy24h is in coins, so it is turned into USDT with the last price
        volume_24h: String(row.instId).endsWith('-SWAP') ? volume * last : num(row.volCcy24h),
        change_pct,
    };
};

/** The reply of /market/tickers, keeping only the listed coins quoted in USDT. */
export const parseTickers = (body: unknown, kind: TMarketKind): TTicker[] => {
    const data = (body as { data?: Record<string, unknown>[] } | null)?.data;
    if (!Array.isArray(data)) return [];
    const wanted = new Set(COINS.map(coin => instrumentId(coin, kind)));
    return data
        .filter(row => wanted.has(String(row.instId)))
        .map(parseTicker)
        .filter((item): item is TTicker => item !== null)
        .sort((a, b) => COINS.indexOf(a.coin) - COINS.indexOf(b.coin));
};

/** OKX sends candles newest first as arrays of strings: [time, open, high, low, close, ...]. Oldest first here. */
export const parseCandles = (body: unknown): TCandle[] => {
    const data = (body as { data?: string[][] } | null)?.data;
    if (!Array.isArray(data)) return [];
    return data
        .map(item => ({
            time: num(item[0]),
            open: num(item[1]),
            high: num(item[2]),
            low: num(item[3]),
            close: num(item[4]),
        }))
        .filter(item => [item.time, item.open, item.high, item.low, item.close].every(Number.isFinite))
        .sort((a, b) => a.time - b.time);
};

export const parseFunding = (body: unknown): TFunding | null => {
    const row = (body as { data?: Record<string, unknown>[] } | null)?.data?.[0];
    if (!row) return null;
    const rate = num(row.fundingRate);
    if (!Number.isFinite(rate)) return null;
    const next = num(row.nextFundingTime);
    return { rate, next_time: Number.isFinite(next) ? next : null };
};

/** OKX answers HTTP 200 with a non-zero `code` for a refused request. */
export const okxError = (body: unknown): string | null => {
    const reply = body as { code?: string; msg?: string } | null;
    if (!reply || (reply.code !== undefined && reply.code !== '0')) return reply?.msg || 'OKX refused the request.';
    return null;
};

const getJson = async (path: string, signal?: AbortSignal): Promise<unknown> => {
    const response = await fetch(`${OKX_BASE}${path}`, { signal });
    if (!response.ok) throw new Error(`OKX answered ${response.status}.`);
    const body = await response.json();
    const problem = okxError(body);
    if (problem) throw new Error(problem);
    return body;
};

export const fetchTickers = async (kind: TMarketKind, signal?: AbortSignal) =>
    parseTickers(await getJson(`/api/v5/market/tickers?instType=${kind}`, signal), kind);

export const fetchCandles = async (inst_id: string, bar: TBarId, signal?: AbortSignal) =>
    parseCandles(await getJson(`/api/v5/market/candles?instId=${inst_id}&bar=${bar}&limit=100`, signal));

export const fetchFunding = async (inst_id: string, signal?: AbortSignal) =>
    parseFunding(await getJson(`/api/v5/public/funding-rate?instId=${inst_id}`, signal));

/** More decimals for cheap coins, fewer for expensive ones. */
export const formatCoinPrice = (value: number) => {
    if (!Number.isFinite(value)) return '–';
    if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    if (value >= 1) return value.toFixed(4);
    return value.toPrecision(4);
};

export const formatVolume = (value: number) => {
    if (!Number.isFinite(value)) return '–';
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    return `${Math.round(value / 1e3)}K`;
};

export const WATCHLIST_KEY = 'crypto_watchlist';

export const readCoinWatchlist = (): string[] => {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? '[]');
        return Array.isArray(parsed) ? parsed.filter((coin): coin is string => COINS.includes(coin)) : [];
    } catch {
        return [];
    }
};

export const writeCoinWatchlist = (coins: string[]) => {
    try {
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(coins));
    } catch {
        // storage can be blocked; the stars then last until the page is closed
    }
};
