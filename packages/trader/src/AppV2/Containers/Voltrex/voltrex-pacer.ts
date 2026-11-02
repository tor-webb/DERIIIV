/**
 * The platform has one socket and the server limits how many requests it accepts each second. When the limit is hit,
 * the platform shows a full-screen "rate limit" error. Everything the scanner asks for therefore waits for a turn:
 * requests start at least `gap_ms` apart, and after a rate-limit reply the whole queue pauses for a while.
 */
export const pacing = { gap_ms: 400, backoff_ms: 20000, symbols_retry_ms: 5000 };

/** The request the scanner tags its history calls with, so the platform can tell they back off by themselves. */
export const SCANNER_PASSTHROUGH = { scanner: 'voltrex' };

let next_at = 0;

const sleep = (ms: number) =>
    new Promise<void>(resolve => {
        setTimeout(resolve, ms);
    });

/** Resolves when it is this request's turn to be sent. Turns are handed out in the order they were asked for. */
export const waitTurn = async (): Promise<void> => {
    const now = Date.now();
    const start = Math.max(now, next_at);
    next_at = start + pacing.gap_ms;
    if (start > now) await sleep(start - now);
};

/** Holds back every later request for a while (after the server said "too many requests"). */
export const backOff = (ms: number = pacing.backoff_ms) => {
    next_at = Math.max(next_at, Date.now() + ms);
};

export const resetPacer = () => {
    next_at = 0;
};

export const isRateLimit = (response: unknown): boolean =>
    (response as { error?: { code?: unknown } } | undefined)?.error?.code === 'RateLimit';
