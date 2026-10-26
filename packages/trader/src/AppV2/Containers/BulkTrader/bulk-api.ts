import { WS } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

import type { TContractType, TTicks } from './bulk-utils';

/** The most ticks one `ticks_history` request returns. */
export const MAX_TICKS = 5000;

const QUOTE_TIMEOUT_MS = 10000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TApiResponse = Record<string, any>;

/** The API rejects with the response (`{ error: { message } }`) or an Error, depending on the call. */
export const errorMessage = (error: unknown): string => {
    const source = error as TApiResponse | undefined;
    return source?.error?.message ?? source?.message ?? localize('Something went wrong while talking to the server.');
};

/** The latest `count` real ticks of a market, oldest first. */
export const fetchTicks = async (symbol: string, count: number): Promise<TTicks> => {
    let response: TApiResponse;
    try {
        response = await WS.getTicksHistory({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: Math.min(count, MAX_TICKS),
            end: 'latest',
            style: 'ticks',
        });
    } catch (error) {
        throw new Error(errorMessage(error));
    }
    if (response?.error) throw new Error(errorMessage(response));

    const prices: unknown = response?.history?.prices;
    const times: unknown = response?.history?.times;
    const pip_size = Number(response?.pip_size);
    if (
        !Array.isArray(prices) ||
        !Array.isArray(times) ||
        prices.length !== times.length ||
        !prices.every(price => Number.isFinite(Number(price))) ||
        !Number.isInteger(pip_size) ||
        pip_size < 0
    ) {
        throw new Error(localize('The market sent ticks in a format we could not read.'));
    }
    return { prices: prices.map(Number), times: times.map(Number), pip_size };
};

export type TQuoteRequest = {
    contract_type: TContractType;
    symbol: string;
    /** Duration in ticks. */
    duration: number;
    /** Digit prediction, only sent for contracts that need one. */
    barrier?: number;
    stake: number;
    currency: string;
};

export type TQuote = {
    ask_price: number;
    payout: number;
    /** Profit on a win as a % of the stake, worked out from the quote. */
    payout_percent: number;
};

/** Asks the platform what a contract would pay right now. The quote is read once and the subscription dropped. */
export const fetchQuote = (request: TQuoteRequest): Promise<TQuote> =>
    new Promise((resolve, reject) => {
        let done = false;
        const handle: { subscription?: { unsubscribe: () => void }; timer?: ReturnType<typeof setTimeout> } = {};

        const finish = (action: () => void) => {
            if (done) return;
            done = true;
            if (handle.timer) clearTimeout(handle.timer);
            handle.subscription?.unsubscribe();
            action();
        };

        handle.timer = setTimeout(
            () => finish(() => reject(new Error(localize('The server took too long to quote a payout.')))),
            QUOTE_TIMEOUT_MS
        );

        try {
            handle.subscription = WS.subscribeProposal(
                {
                    amount: request.stake,
                    basis: 'stake',
                    contract_type: request.contract_type,
                    currency: request.currency,
                    underlying_symbol: request.symbol,
                    duration: request.duration,
                    duration_unit: 't',
                    // the platform's own proposals send the digit prediction as a string `barrier`
                    ...(request.barrier !== undefined && { barrier: String(request.barrier) }),
                },
                (response: TApiResponse) => {
                    const proposal = response?.proposal;
                    const ask_price = Number(proposal?.ask_price);
                    const payout = Number(proposal?.payout);
                    if (response?.error || !(ask_price > 0) || !Number.isFinite(payout)) {
                        finish(() => reject(new Error(errorMessage(response))));
                        return;
                    }
                    finish(() =>
                        resolve({ ask_price, payout, payout_percent: ((payout - ask_price) / ask_price) * 100 })
                    );
                }
            );
            // the response can arrive before the handle is returned
            if (done) handle.subscription?.unsubscribe();
        } catch (error) {
            finish(() => reject(new Error(errorMessage(error))));
        }
    });
