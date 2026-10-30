/**
 * Price alerts for starred markets. Pure functions and storage, no React.
 *
 * A person picks a threshold (a percent move) for a starred market. When the price is that far from where it was an hour
 * ago, one pop-up is shown, and no more for that market until an hour has passed. An alert describes a move that has
 * already happened. It is not a signal and not advice.
 */
import { STALE_AFTER_SECONDS } from './markets-config';
import { announceSettingsChanged, KNOWN_SYMBOLS } from './markets-utils';

export const ALERT_SETTINGS_KEY = 'markets_price_alerts';
export const ALERTS_OFF_KEY = 'markets_price_alerts_off';
export const ALERTS_LAST_KEY = 'markets_price_alerts_last';

/** The moves a person can choose, in percent of the price an hour ago. */
export const THRESHOLD_CHOICES = [0.25, 0.5, 1, 2, 5] as const;

export const WINDOW_SECONDS = 60 * 60;
/** At least this much of the hour must be known before a move is judged, so a half-loaded market never alerts. */
export const MIN_SPAN_SECONDS = 30 * 60;
export const COOLDOWN_MS = 60 * 60 * 1000;
/** Live ticks closer together than this replace the previous point, so an hour never holds more than ~720 points. */
export const POINT_GAP_SECONDS = 5;

export type TPricePoint = { epoch: number; quote: number };
export type TThresholds = Record<string, number>;

const isChoice = (value: unknown): value is number => THRESHOLD_CHOICES.some(choice => choice === value);

/* ----------------------------------------------------------------------------------------------- */
/* Storage                                                                                          */
/* ----------------------------------------------------------------------------------------------- */

/** The threshold chosen for each market. Unknown markets and unknown thresholds are dropped. */
export const readThresholds = (): TThresholds => {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(ALERT_SETTINGS_KEY) ?? '{}');
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
        const result: TThresholds = {};
        Object.entries(parsed).forEach(([symbol, value]) => {
            if (KNOWN_SYMBOLS.has(symbol) && isChoice(value)) result[symbol] = value;
        });
        return result;
    } catch {
        return {};
    }
};

export const writeThresholds = (thresholds: TThresholds) => {
    try {
        localStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify(thresholds));
    } catch {
        // storage can be unavailable (private mode, quota); the choice lasts until the page closes
    }
    announceSettingsChanged();
};

/** Sets a market's threshold, or removes it with null. Returns a new object. */
export const withThreshold = (thresholds: TThresholds, symbol: string, value: number | null): TThresholds => {
    const next = { ...thresholds };
    if (value === null || !isChoice(value) || !KNOWN_SYMBOLS.has(symbol)) delete next[symbol];
    else next[symbol] = value;
    return next;
};

/** Alerts are on unless the person switched them off. */
export const arePriceAlertsOn = () => {
    try {
        return localStorage.getItem(ALERTS_OFF_KEY) !== '1';
    } catch {
        return true;
    }
};

export const setPriceAlertsOn = (on: boolean) => {
    try {
        if (on) localStorage.removeItem(ALERTS_OFF_KEY);
        else localStorage.setItem(ALERTS_OFF_KEY, '1');
    } catch {
        // see writeThresholds
    }
    announceSettingsChanged();
};

/** When each market last alerted, in milliseconds. Kept so reloading the page does not repeat an alert. */
export const readLastAlerts = (): Record<string, number> => {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(ALERTS_LAST_KEY) ?? '{}');
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
        const result: Record<string, number> = {};
        Object.entries(parsed).forEach(([symbol, value]) => {
            if (KNOWN_SYMBOLS.has(symbol) && typeof value === 'number' && Number.isFinite(value) && value > 0) {
                result[symbol] = value;
            }
        });
        return result;
    } catch {
        return {};
    }
};

export const writeLastAlerts = (last: Record<string, number>) => {
    try {
        localStorage.setItem(ALERTS_LAST_KEY, JSON.stringify(last));
    } catch {
        // see writeThresholds
    }
};

/* ----------------------------------------------------------------------------------------------- */
/* The hour of prices                                                                               */
/* ----------------------------------------------------------------------------------------------- */

/** Adds a price, keeps only the last hour, and thins out ticks that arrive faster than `POINT_GAP_SECONDS`. */
export const addPoint = (points: TPricePoint[], point: TPricePoint): TPricePoint[] => {
    if (!Number.isFinite(point.epoch) || !Number.isFinite(point.quote) || point.quote <= 0) return points;
    const last = points[points.length - 1];
    if (last && point.epoch < last.epoch) return points; // an old tick that arrived late
    const kept = last && point.epoch - last.epoch < POINT_GAP_SECONDS ? points.slice(0, -1) : points;
    return [...kept, point].filter(item => item.epoch >= point.epoch - WINDOW_SECONDS);
};

export type TMove = {
    /** Signed percent change from the price an hour ago (or the oldest price held) to the newest. */
    percent: number;
    price: number;
};

/**
 * How far the price has moved over the last hour, or null when it cannot be judged: no prices, less than half an hour
 * of them, or a newest price that is stale because the market has closed.
 */
export const hourMove = (points: TPricePoint[], now_seconds: number): TMove | null => {
    if (points.length < 2) return null;
    const newest = points[points.length - 1];
    if (now_seconds - newest.epoch > STALE_AFTER_SECONDS) return null;
    const window = points.filter(point => point.epoch >= newest.epoch - WINDOW_SECONDS);
    const oldest = window[0];
    if (newest.epoch - oldest.epoch < MIN_SPAN_SECONDS) return null;
    return { percent: ((newest.quote - oldest.quote) / oldest.quote) * 100, price: newest.quote };
};

/** True when the move reaches the threshold (up or down) and the market has not alerted in the last hour. */
export const shouldAlert = (
    move: TMove | null,
    threshold: number | undefined,
    last_alert_ms: number | undefined,
    now_ms: number
): boolean => {
    if (!move || threshold === undefined) return false;
    if (Math.abs(move.percent) < threshold) return false;
    return last_alert_ms === undefined || now_ms - last_alert_ms >= COOLDOWN_MS;
};

export type TPriceAlert = {
    id: string;
    symbol: string;
    percent: number;
    price: number;
    at: number;
};

export const makeAlert = (symbol: string, move: TMove, now_ms: number): TPriceAlert => ({
    id: `${symbol}-${now_ms}`,
    symbol,
    percent: move.percent,
    price: move.price,
    at: now_ms,
});
