import React from 'react';

import { WS } from '@deriv/shared';

import { JOURNAL_TRADE_LIMIT, normaliseTrades, TJournalTrade } from './journal-utils';

export type TJournalState =
    | { status: 'idle' | 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; trades: TJournalTrade[] };

/**
 * Loads the person's most recent finished trades once, and again when the account changes or `reload` is called.
 * An answer that arrives after the page left or the account changed is ignored.
 */
export const useJournal = (account: string | undefined, enabled: boolean) => {
    const [state, setState] = React.useState<TJournalState>({ status: 'idle' });
    const [attempt, setAttempt] = React.useState(0);

    React.useEffect(() => {
        if (!enabled) {
            setState({ status: 'idle' });
            return undefined;
        }
        let current = true;
        setState({ status: 'loading' });
        (async () => {
            try {
                const response = await WS.profitTable(JOURNAL_TRADE_LIMIT, 0, {});
                if (!current) return;
                if (response?.error) {
                    setState({ status: 'error', message: String(response.error.message ?? '') });
                    return;
                }
                setState({ status: 'ready', trades: normaliseTrades(response?.profit_table?.transactions ?? []) });
            } catch (error) {
                if (current) setState({ status: 'error', message: error instanceof Error ? error.message : '' });
            }
        })();
        return () => {
            current = false;
        };
    }, [account, enabled, attempt]);

    const reload = React.useCallback(() => setAttempt(count => count + 1), []);
    return { state, reload };
};
