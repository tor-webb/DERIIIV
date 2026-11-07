import React from 'react';

import { fetchCandles, fetchFunding, fetchTickers, TBarId, TCandle, TFunding, TMarketKind, TTicker } from './okx';

export const REFRESH_MS = 5000;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Could not reach OKX.');

/** Prices for the listed coins, refreshed every few seconds while the page is open and visible. */
export const useOkxTickers = (kind: TMarketKind) => {
    const [tickers, setTickers] = React.useState<TTicker[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [attempt, setAttempt] = React.useState(0);

    React.useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        setLoading(true);
        const load = async () => {
            if (document.hidden) {
                timer = setTimeout(load, REFRESH_MS);
                return;
            }
            try {
                const next = await fetchTickers(kind, controller.signal);
                setTickers(next);
                setError(null);
            } catch (caught) {
                if (controller.signal.aborted) return;
                setError(messageOf(caught));
            }
            setLoading(false);
            if (!controller.signal.aborted) timer = setTimeout(load, REFRESH_MS);
        };
        load();
        return () => {
            controller.abort();
            if (timer) clearTimeout(timer);
        };
    }, [kind, attempt]);

    const retry = React.useCallback(() => setAttempt(value => value + 1), []);
    return { tickers, error, loading, retry };
};

/** Candles for one instrument, and its funding rate when it is a perpetual future. */
export const useOkxChart = (inst_id: string | null, bar: TBarId) => {
    const [candles, setCandles] = React.useState<TCandle[]>([]);
    const [funding, setFunding] = React.useState<TFunding | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!inst_id) return undefined;
        const controller = new AbortController();
        setCandles([]);
        setFunding(null);
        setError(null);
        fetchCandles(inst_id, bar, controller.signal)
            .then(setCandles)
            .catch(caught => {
                if (!controller.signal.aborted) setError(messageOf(caught));
            });
        if (inst_id.endsWith('-SWAP')) {
            fetchFunding(inst_id, controller.signal)
                .then(setFunding)
                .catch(() => undefined);
        }
        return () => controller.abort();
    }, [inst_id, bar]);

    return { candles, funding, error };
};
