import React from 'react';

import { WS } from '@deriv/shared';

import { digitStats, lastDigit, MAX_DIGITS, pushDigit, TDigitStats } from './voltrex-digits';
import { backOff, isRateLimit, SCANNER_PASSTHROUGH, waitTurn } from './voltrex-pacer';

const FLUSH_MS = 1000;
const HISTORY_TICKS = 500;

type TFeed = { digits: number[]; decimals: number };

/**
 * Keeps the last digits of the price for a set of markets: the recent ticks are loaded once (one request per market,
 * paced), then every live tick the scanner already receives (the `voltrex-tick` event) adds one digit. The scanner
 * is told to follow these markets live through its `extra_live` option, so no market is subscribed twice.
 */
export const useVoltrexDigits = (symbols: { symbol: string; pip_size: number }[]) => {
    const feeds = React.useRef<Record<string, TFeed>>({});
    const [version, setVersion] = React.useState(0);
    const key = symbols
        .map(item => `${item.symbol}:${item.pip_size}`)
        .sort()
        .join(',');

    React.useEffect(() => {
        if (!key) return undefined;
        let active = true;
        let is_dirty = false;
        const wanted = key.split(',').map(item => {
            const [symbol, pip] = item.split(':');
            return { symbol, decimals: Number(pip) };
        });

        const load = async (symbol: string, decimals: number) => {
            if (feeds.current[symbol]) return;
            try {
                await waitTurn();
                if (!active) return;
                const response = await WS.getTicksHistory({
                    ticks_history: symbol,
                    adjust_start_time: 1,
                    count: HISTORY_TICKS,
                    end: 'latest',
                    style: 'ticks',
                    passthrough: SCANNER_PASSTHROUGH,
                });
                if (isRateLimit(response)) backOff();
                const prices = response?.history?.prices;
                if (!active || !Array.isArray(prices)) return;
                const places = Number.isInteger(Number(response.pip_size)) ? Number(response.pip_size) : decimals;
                const digits = prices
                    .map((price: unknown) => lastDigit(Number(price), places))
                    .filter((digit: number | null): digit is number => digit !== null)
                    .slice(-MAX_DIGITS);
                // ticks that arrived while the history was loading are already in the feed; keep them after the history
                const early = (feeds.current as Record<string, TFeed | undefined>)[symbol]?.digits ?? [];
                feeds.current[symbol] = { digits: [...digits, ...early].slice(-MAX_DIGITS), decimals: places };
                is_dirty = true;
            } catch {
                // this market has no digits yet; it is tried again when the set changes
            }
        };

        // a tick that arrives before the history is kept so no digit is lost
        const onTick = (event: Event) => {
            const { symbol, quote } = (event as CustomEvent<{ symbol: string; quote: number }>).detail;
            const entry = wanted.find(item => item.symbol === symbol);
            if (!entry) return;
            const feed = feeds.current[symbol] ?? { digits: [], decimals: entry.decimals };
            const digit = lastDigit(Number(quote), feed.decimals);
            if (digit === null) return;
            feeds.current[symbol] = { ...feed, digits: pushDigit(feed.digits, digit) };
            is_dirty = true;
        };
        window.addEventListener('voltrex-tick', onTick);
        const timer = setInterval(() => {
            if (!is_dirty) return;
            is_dirty = false;
            setVersion(count => count + 1);
        }, FLUSH_MS);

        (async () => {
            await wanted.reduce(
                (chain, item) => chain.then(() => (active ? load(item.symbol, item.decimals) : undefined)),
                Promise.resolve()
            );
        })();

        return () => {
            active = false;
            clearInterval(timer);
            window.removeEventListener('voltrex-tick', onTick);
        };
    }, [key]);

    const getDigits = React.useCallback((symbol: string): number[] => feeds.current[symbol]?.digits ?? [], []);
    const getStats = React.useCallback(
        (symbol: string): TDigitStats | null => {
            const digits = feeds.current[symbol]?.digits;
            return digits && digits.length ? digitStats(digits) : null;
        },
        // `version` is the change signal for the mutable feeds
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [version]
    );

    return { getDigits, getStats, version };
};
