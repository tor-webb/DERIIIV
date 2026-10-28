import React from 'react';

import { WS } from '@deriv/shared';

import { DEFAULT_WINDOW, getWindow, MARKET_SYMBOLS, TWindowId } from './markets-config';
import {
    applyTick,
    buildRow,
    entryFromCandles,
    parseCandles,
    TMarketEntry,
    TMarketRow,
    withVolatilityLevels,
} from './markets-utils';

/** How many markets are asked for their history at once. The socket handles a handful of requests at a time comfortably. */
const BATCH_SIZE = 5;
const FLUSH_MS = 1000;
/** The "closed" check depends on the clock, so it is re-run now and then even when no tick arrives. */
const CLOCK_EVERY_FLUSHES = 30;

const loadHistory = async (symbol: string, window_id: TWindowId) => {
    const { count, granularity } = getWindow(window_id);
    return parseCandles(
        await WS.getTicksHistory({
            ticks_history: symbol,
            adjust_start_time: 1,
            count,
            end: 'latest',
            style: 'candles',
            granularity,
        })
    );
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

type TUseMarketsOptions = {
    /** Only load these markets (the Dashboard watchlist). Leave out for every listed market. */
    symbols?: string[];
    window_id?: TWindowId;
};

/**
 * Loads the chosen window of candles (the last hour by default) for every market asked for, then follows live ticks.
 * Ticks are gathered as they arrive and shown once a second, so twenty busy markets do not cause twenty re-renders
 * a second. Changing the window or the symbols starts the load again.
 */
export const useMarkets = ({ symbols, window_id = DEFAULT_WINDOW }: TUseMarketsOptions = {}) => {
    const symbols_key = symbols ? symbols.join(',') : null;
    const markets = React.useMemo(
        () =>
            symbols_key === null
                ? MARKET_SYMBOLS
                : MARKET_SYMBOLS.filter(({ symbol }) => symbols_key.split(',').includes(symbol)),
        [symbols_key]
    );
    const [entries, setEntries] = React.useState<Record<string, TMarketEntry>>({});
    const [now, setNow] = React.useState(nowSeconds);
    const [updated_at, setUpdatedAt] = React.useState<number | null>(null);
    const [attempt, setAttempt] = React.useState(0);

    React.useEffect(() => {
        let active = true;
        let is_dirty = false;
        let flushes = 0;
        const live: Record<string, TMarketEntry> = {};
        const subscriptions: { unsubscribe: () => void }[] = [];

        setEntries({});

        const flush = () => {
            if (!active) return;
            flushes += 1;
            if (flushes % CLOCK_EVERY_FLUSHES === 0) setNow(nowSeconds());
            if (!is_dirty) return;
            is_dirty = false;
            setEntries({ ...live });
            setNow(nowSeconds());
            setUpdatedAt(Date.now());
        };
        const timer = setInterval(flush, FLUSH_MS);

        const follow = (symbol: string) => {
            try {
                const subscription = WS.subscribeTicks(symbol, (response: Record<string, unknown>) => {
                    const tick = response?.tick as { quote?: unknown; epoch?: unknown; pip_size?: unknown } | undefined;
                    if (!active || !tick) return;
                    const current = live[symbol] ?? { status: 'loading' as const };
                    const next = applyTick(current, Number(tick.quote), Number(tick.epoch));
                    const pip_size = Number(tick.pip_size);
                    live[symbol] = Number.isInteger(pip_size) && pip_size >= 0 ? { ...next, pip_size } : next;
                    is_dirty = true;
                });
                if (subscription) subscriptions.push(subscription);
            } catch {
                // this market just stays at its last price
            }
        };

        const run = async () => {
            for (let start = 0; start < markets.length; start += BATCH_SIZE) {
                const batch = markets.slice(start, start + BATCH_SIZE);
                // eslint-disable-next-line no-await-in-loop
                await Promise.all(
                    batch.map(async ({ symbol }) => {
                        try {
                            const parsed = await loadHistory(symbol, window_id);
                            live[symbol] = parsed
                                ? entryFromCandles(parsed.candles, parsed.pip_size, getWindow(window_id).granularity)
                                : { status: 'unavailable' };
                        } catch {
                            live[symbol] = { status: 'unavailable' };
                        }
                    })
                );
                if (!active) return;
                is_dirty = true;
                flush();
            }
            markets.filter(({ symbol }) => live[symbol]?.status === 'ready').forEach(({ symbol }) => follow(symbol));
        };
        run();

        return () => {
            active = false;
            clearInterval(timer);
            subscriptions.forEach(subscription => {
                try {
                    subscription.unsubscribe();
                } catch {
                    // already closed
                }
            });
        };
    }, [attempt, markets, window_id]);

    const rows: TMarketRow[] = React.useMemo(
        () => withVolatilityLevels(markets.map(market => buildRow(market, entries[market.symbol], now))),
        [markets, entries, now]
    );

    return {
        rows,
        is_loading: rows.some(row => row.status === 'loading'),
        updated_at,
        retry: () => setAttempt(count => count + 1),
    };
};
