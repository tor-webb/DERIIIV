import React from 'react';

import { WS } from '@deriv/shared';

import { SETTINGS_CHANGED_EVENT } from './markets-config';
import { parseCandles, readWatchlist } from './markets-utils';
import {
    addPoint,
    arePriceAlertsOn,
    hourMove,
    makeAlert,
    readLastAlerts,
    readThresholds,
    shouldAlert,
    TPriceAlert,
    TPricePoint,
    writeLastAlerts,
} from './price-alerts';

/** Markets that are both starred and given a threshold, or none when alerts are switched off. */
const readWatched = () => {
    if (!arePriceAlertsOn()) return { symbols: [] as string[], thresholds: {} as Record<string, number> };
    const thresholds = readThresholds();
    const starred = readWatchlist();
    return { symbols: starred.filter(symbol => thresholds[symbol] !== undefined), thresholds };
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Watches the starred markets that have an alert threshold and reports a pop-up when one has moved that far in an hour.
 * It loads an hour of one-minute prices for each watched market, then follows live ticks. Nothing runs when no market
 * has a threshold or alerts are off, and it starts over whenever the settings change.
 */
export const usePriceAlerts = () => {
    const [watched, setWatched] = React.useState(readWatched);
    const [alerts, setAlerts] = React.useState<TPriceAlert[]>([]);
    const thresholds_ref = React.useRef(watched.thresholds);
    thresholds_ref.current = watched.thresholds;

    React.useEffect(() => {
        const refresh = () => setWatched(readWatched());
        window.addEventListener(SETTINGS_CHANGED_EVENT, refresh);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener(SETTINGS_CHANGED_EVENT, refresh);
            window.removeEventListener('storage', refresh);
        };
    }, []);

    const symbols_key = watched.symbols.join(',');

    React.useEffect(() => {
        if (!symbols_key) return undefined;
        let active = true;
        const subscriptions: { unsubscribe: () => void }[] = [];
        const last = readLastAlerts();

        const check = (symbol: string, points: TPricePoint[]) => {
            const now_ms = Date.now();
            const move = hourMove(points, nowSeconds());
            if (!shouldAlert(move, thresholds_ref.current[symbol], last[symbol], now_ms) || !move) return;
            last[symbol] = now_ms;
            writeLastAlerts(last);
            setAlerts(current => [...current.filter(item => item.symbol !== symbol), makeAlert(symbol, move, now_ms)]);
        };

        symbols_key.split(',').forEach(async symbol => {
            let points: TPricePoint[] = [];
            try {
                const parsed = parseCandles(
                    await WS.getTicksHistory({
                        ticks_history: symbol,
                        adjust_start_time: 1,
                        count: 60,
                        end: 'latest',
                        style: 'candles',
                        granularity: 60,
                    })
                );
                if (!active) return;
                points = (parsed?.candles ?? []).map(candle => ({ epoch: candle.epoch, quote: candle.close }));
                check(symbol, points);
                const subscription = WS.subscribeTicks(symbol, (response: Record<string, unknown>) => {
                    const tick = response?.tick as { quote?: unknown; epoch?: unknown } | undefined;
                    if (!active || !tick) return;
                    points = addPoint(points, { epoch: Number(tick.epoch), quote: Number(tick.quote) });
                    check(symbol, points);
                });
                if (subscription) subscriptions.push(subscription);
            } catch {
                // this market is skipped until the settings change or the page reloads
            }
        });

        return () => {
            active = false;
            subscriptions.forEach(subscription => {
                try {
                    subscription.unsubscribe();
                } catch {
                    // already closed
                }
            });
        };
    }, [symbols_key]);

    const dismiss = React.useCallback((id: string) => setAlerts(current => current.filter(item => item.id !== id)), []);
    const clear = React.useCallback(() => setAlerts([]), []);

    return { alerts, dismiss, clear };
};
