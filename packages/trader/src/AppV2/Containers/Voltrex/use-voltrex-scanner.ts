import React from 'react';

import { WS } from '@deriv/shared';

import { parseCandles } from '../Markets/markets-utils';

import { analyseMarket, TSignal, TVolatilityLevel, volatilityLevels } from './voltrex-analysis';
import {
    applyTickToCandles,
    CATEGORIES,
    CONFIRM_FRAME,
    dayChangePct,
    LIVE_TICK_LIMIT,
    LOAD_CONCURRENCY,
    parseActiveSymbols,
    PRIMARY_FRAME,
    REFRESH_MS,
    TFrameConfig,
    TSymbolInfo,
} from './voltrex-config';
import { TCandle } from './voltrex-indicators';

export type TScanStatus = 'loading' | 'ready' | 'unavailable' | 'closed';

export type TScanRow = TSymbolInfo & {
    status: TScanStatus;
    price: number | null;
    change_pct: number | null;
    signal: TSignal | null;
    volatility_level: TVolatilityLevel | null;
    /** True while this market is following live ticks; others show the close of their last loaded candle. */
    is_live: boolean;
};

type TEntry = {
    status: TScanStatus;
    primary: TCandle[];
    confirm: TCandle[];
    signal: TSignal | null;
    pip_size?: number;
};

const FLUSH_MS = 1000;

const loadFrame = async (symbol: string, frame: TFrameConfig) =>
    parseCandles(
        await WS.getTicksHistory({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: frame.count,
            end: 'latest',
            style: 'candles',
            granularity: frame.granularity,
        })
    );

type TOptions = { selected: string | null };

/**
 * Finds every market the server offers, loads candles for the open ones (a few at a time, over the platform's one
 * shared socket), analyses them, and follows live ticks for the selected market and the strongest signals. Markets
 * without a live subscription show the close of their last loaded candle and are reloaded every few minutes.
 */
export const useVoltrexScanner = ({ selected }: TOptions) => {
    const [symbols, setSymbols] = React.useState<TSymbolInfo[]>([]);
    const [symbols_error, setSymbolsError] = React.useState(false);
    const [version, setVersion] = React.useState(0);
    const [updated_at, setUpdatedAt] = React.useState<number | null>(null);
    const [attempt, setAttempt] = React.useState(0);
    const [live_key, setLiveKey] = React.useState('');
    const entries = React.useRef<Record<string, TEntry>>({});
    const live_symbols = React.useRef<Set<string>>(new Set());
    const selected_ref = React.useRef(selected);
    selected_ref.current = selected;

    // 1. discover the markets
    React.useEffect(() => {
        let active = true;
        setSymbolsError(false);
        (async () => {
            try {
                const list = parseActiveSymbols(await WS.activeSymbols('brief'));
                if (!active) return;
                if (!list.length) setSymbolsError(true);
                setSymbols(list);
            } catch {
                if (active) setSymbolsError(true);
            }
        })();
        return () => {
            active = false;
        };
    }, [attempt]);

    // 2. load candles and keep them fresh
    React.useEffect(() => {
        if (!symbols.length) return undefined;
        let active = true;
        let is_dirty = false;
        const dirty = new Set<string>();
        const current = entries.current;

        symbols.forEach(({ symbol, is_open }) => {
            if (!current[symbol]) {
                current[symbol] = { status: is_open ? 'loading' : 'closed', primary: [], confirm: [], signal: null };
            }
        });
        setVersion(count => count + 1);

        const analyse = (symbol: string) => {
            const entry = current[symbol];
            entry.signal = analyseMarket(entry.primary, entry.confirm.length ? entry.confirm : null);
        };

        const flush = () => {
            if (!active) return;
            if (is_dirty) {
                dirty.forEach(analyse);
                dirty.clear();
                is_dirty = false;
                // the strongest signals follow live ticks, so the table keeps its best candidates fresh
                const ranked = Object.entries(current)
                    .filter(([, item]) => item.signal)
                    .sort(([, a], [, b]) => (b.signal?.strength ?? 0) - (a.signal?.strength ?? 0))
                    .map(([symbol]) => symbol);
                const wanted = new Set(ranked.slice(0, LIVE_TICK_LIMIT));
                if (selected_ref.current) wanted.add(selected_ref.current);
                setLiveKey(Array.from(wanted).sort().join(','));
                setVersion(count => count + 1);
                setUpdatedAt(Date.now());
            }
        };
        const timer = setInterval(flush, FLUSH_MS);

        const loadOne = async (symbol: string) => {
            try {
                const [primary, confirm] = await Promise.all([
                    loadFrame(symbol, PRIMARY_FRAME),
                    loadFrame(symbol, CONFIRM_FRAME),
                ]);
                if (!active) return;
                if (!primary) {
                    current[symbol] = { ...current[symbol], status: 'unavailable', signal: null };
                } else {
                    current[symbol] = {
                        status: 'ready',
                        primary: primary.candles,
                        confirm: confirm?.candles ?? [],
                        signal: null,
                        pip_size: primary.pip_size,
                    };
                    dirty.add(symbol);
                }
            } catch {
                if (active) current[symbol] = { ...current[symbol], status: 'unavailable', signal: null };
            }
            is_dirty = true;
        };

        const runQueue = async () => {
            // the main categories first, so the first markets to appear (and to trade) are the ones people use most
            const order = (category: string) => CATEGORIES.findIndex(item => item.id === category);
            const queue = symbols
                .filter(item => item.is_open)
                .sort((a, b) => order(a.category) - order(b.category))
                .map(item => item.symbol);
            const worker = async () => {
                while (active && queue.length) {
                    const symbol = queue.shift() as string;
                    // eslint-disable-next-line no-await-in-loop
                    await loadOne(symbol);
                }
            };
            await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
        };

        let reload: ReturnType<typeof setTimeout>;
        const cycle = async () => {
            await runQueue();
            if (active) reload = setTimeout(cycle, REFRESH_MS);
        };
        cycle();

        // ticks reach this handler from the live subscriptions below
        const onTick = (event: Event) => {
            const { symbol, quote, epoch } = (event as CustomEvent<{ symbol: string; quote: number; epoch: number }>)
                .detail;
            const entry = current[symbol];
            if (!entry || entry.status !== 'ready') return;
            entry.primary = applyTickToCandles(entry.primary, quote, epoch, PRIMARY_FRAME.granularity);
            if (entry.confirm.length) {
                entry.confirm = applyTickToCandles(entry.confirm, quote, epoch, CONFIRM_FRAME.granularity);
            }
            dirty.add(symbol);
            is_dirty = true;
        };
        window.addEventListener('voltrex-tick', onTick);

        return () => {
            active = false;
            clearInterval(timer);
            clearTimeout(reload);
            window.removeEventListener('voltrex-tick', onTick);
        };
    }, [symbols]);

    // 3. follow live ticks for the chosen set (one subscription per market, shared with the rest of the platform)
    React.useEffect(() => {
        const wanted = new Set(live_key ? live_key.split(',') : []);
        const subscriptions: Record<string, { unsubscribe: () => void }> = {};
        wanted.forEach(symbol => {
            try {
                const subscription = WS.subscribeTicks(symbol, (response: Record<string, unknown>) => {
                    const tick = response?.tick as { quote?: unknown; epoch?: unknown } | undefined;
                    if (!tick) return;
                    window.dispatchEvent(
                        new CustomEvent('voltrex-tick', {
                            detail: { symbol, quote: Number(tick.quote), epoch: Number(tick.epoch) },
                        })
                    );
                });
                if (subscription) subscriptions[symbol] = subscription;
            } catch {
                // this market keeps its last loaded price
            }
        });
        live_symbols.current = new Set(Object.keys(subscriptions));
        return () => {
            Object.values(subscriptions).forEach(subscription => {
                try {
                    subscription.unsubscribe();
                } catch {
                    // already closed
                }
            });
        };
    }, [live_key]);

    const rows: TScanRow[] = React.useMemo(() => {
        const base = symbols.map(info => {
            const entry = entries.current[info.symbol];
            const status = entry?.status ?? (info.is_open ? 'loading' : 'closed');
            const latest = entry?.primary.length ? entry.primary[entry.primary.length - 1].close : null;
            return {
                ...info,
                status,
                price: latest,
                change_pct: latest === null || !entry?.confirm.length ? null : dayChangePct(entry.confirm, latest),
                signal: entry?.signal ?? null,
                volatility_level: null as TVolatilityLevel | null,
                is_live: live_symbols.current.has(info.symbol),
            } as TScanRow;
        });
        const levels = volatilityLevels(
            base.map(row => ({
                symbol: row.symbol,
                category: row.category,
                volatility_pct: row.signal?.volatility_pct ?? null,
            }))
        );
        return base.map(row => ({ ...row, volatility_level: levels.get(row.symbol) ?? null }));
        // `version` is the change signal for the mutable entries
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbols, version, live_key]);

    const getCandles = React.useCallback(
        (symbol: string) => {
            const entry = entries.current[symbol];
            return entry ? { primary: entry.primary, confirm: entry.confirm, pip_size: entry.pip_size ?? 2 } : null;
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [version]
    );

    const loaded = rows.filter(row => row.status !== 'loading').length;

    return {
        rows,
        total: rows.length,
        loaded,
        is_loading: rows.some(row => row.status === 'loading'),
        symbols_error,
        updated_at,
        getCandles,
        retry: () => setAttempt(count => count + 1),
    };
};
