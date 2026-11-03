import { localize } from '@deriv-com/translations';

import type { TApiResponse, TBotApi, TSubscription } from '../BotBuilder/Engine/types';

/**
 * Buys one contract of any kind the server sells and follows it to its end: asks for the price, buys at that price,
 * then watches the open contract until the server reports it sold. Used for every kind except Rise/Fall (which runs
 * through the Bot Builder engine).
 *
 * Safety rules built in: the price the server quotes may not exceed the stake cap, nothing is bought if the quote does
 * not arrive in time, a contract that stops reporting is asked about again and then given up on loudly (it may still be
 * open), and an optional maximum hold sells a contract that has stayed open too long.
 */

export type TExecutorEnd =
    | { kind: 'closed'; profit: number; entry_spot: string; exit_spot: string; contract_id: number }
    | { kind: 'failed'; reason: string }
    | { kind: 'lost_contact'; reason: string; contract_id: number };

export type TExecutorOptions = {
    api: TBotApi;
    /** The proposal request, built from the choice. */
    request: Record<string, unknown>;
    /** The most the server may quote; a higher price is refused. */
    max_price: number;
    proposal_timeout_ms?: number;
    buy_timeout_ms?: number;
    /** No update for this long: ask again, up to `max_resubscribes` times, then give up. */
    contract_stall_ms?: number;
    max_resubscribes?: number;
    /** Sell at the market price after this long. Off when not set. */
    max_hold_ms?: number;
    onBought: (info: { contract_id: number; buy_price: number; payout: number }) => void;
    onProgress?: (info: { profit: number; bid_price: number; entry_spot: string }) => void;
    onEnd: (end: TExecutorEnd) => void;
    onLog: (level: 'info' | 'success' | 'warn' | 'error', message: string) => void;
};

const DEFAULTS = {
    proposal_timeout_ms: 20_000,
    buy_timeout_ms: 20_000,
    contract_stall_ms: 60_000,
    max_resubscribes: 3,
};

const errorText = (response: TApiResponse | undefined) =>
    response?.error?.message ?? localize('Something went wrong while talking to the server.');

const spot = (value: unknown) => (value === undefined || value === null ? '' : String(value));

export class ContractExecutor {
    private proposal_sub: TSubscription | null = null;
    private contract_sub: TSubscription | null = null;
    private timers = new Set<ReturnType<typeof setTimeout>>();
    private stall_timer: ReturnType<typeof setTimeout> | null = null;
    private contract_id: number | null = null;
    private buy_price = 0;
    private resubscribes = 0;
    private done = false;
    private buy_sent = false;
    private cancelled = false;
    private sell_sent = false;
    private last_profit = 0;
    private last_valid_to_sell = false;
    private proposal_token = 0;

    private readonly options: TExecutorOptions;

    constructor(options: TExecutorOptions) {
        this.options = options;
    }

    private setting<K extends keyof typeof DEFAULTS>(key: K): number {
        return (this.options[key] as number | undefined) ?? DEFAULTS[key];
    }

    private after(ms: number, action: () => void) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            action();
        }, ms);
        this.timers.add(timer);
        return timer;
    }

    start() {
        const { api, request } = this.options;
        this.proposal_token += 1;
        const token = this.proposal_token;
        let answered = false;
        const timeout = this.after(this.setting('proposal_timeout_ms'), () => {
            if (answered) return;
            answered = true;
            this.proposal_sub?.unsubscribe();
            this.end({
                kind: 'failed',
                reason: localize('The server did not send a price in time. No trade was placed.'),
            });
        });
        try {
            this.proposal_sub = api.subscribeProposal(request as never, response => {
                if (answered || token !== this.proposal_token) return;
                answered = true;
                clearTimeout(timeout);
                this.timers.delete(timeout);
                this.proposal_sub?.unsubscribe();
                this.proposal_sub = null;
                this.onProposal(response);
            });
        } catch (error) {
            answered = true;
            this.end({ kind: 'failed', reason: (error as Error).message });
        }
        // a response that arrived before the handle was returned must not leave the subscription open
        if (answered) this.proposal_sub?.unsubscribe();
    }

    /** Cancels a trade that has not been bought yet. A contract that is already bought is left to finish. */
    cancel(): boolean {
        if (this.done || this.buy_sent) return false;
        this.cancelled = true;
        this.proposal_sub?.unsubscribe();
        this.end({ kind: 'failed', reason: localize('The trade was cancelled before it was bought.') });
        return true;
    }

    private onProposal(response: TApiResponse) {
        if (this.done || this.cancelled) return;
        if (response?.error || !response?.proposal) {
            this.end({ kind: 'failed', reason: errorText(response) });
            return;
        }
        const ask_price = Number(response.proposal.ask_price);
        if (!(ask_price > 0)) {
            this.end({ kind: 'failed', reason: localize('The server sent no usable price. No trade was placed.') });
            return;
        }
        if (ask_price > this.options.max_price) {
            this.end({
                kind: 'failed',
                reason: localize(
                    'The server priced this trade at {{price}}, above your maximum stake of {{max}}. No trade was placed.',
                    { price: ask_price, max: this.options.max_price }
                ),
            });
            return;
        }
        this.buy_sent = true;
        const buy_timer = this.after(this.setting('buy_timeout_ms'), () => {
            if (this.contract_id !== null || this.done) return;
            this.end({
                kind: 'failed',
                reason: localize(
                    'The server did not confirm the purchase in time. Check Positions: the contract may still have been bought.'
                ),
            });
        });
        this.options.api
            .buy(response.proposal.id, ask_price)
            .then(bought => {
                clearTimeout(buy_timer);
                this.timers.delete(buy_timer);
                if (bought?.error || !bought?.buy) {
                    if (!this.done) this.end({ kind: 'failed', reason: errorText(bought) });
                    return;
                }
                this.onBought(bought.buy);
            })
            .catch(error => {
                clearTimeout(buy_timer);
                this.timers.delete(buy_timer);
                if (!this.done) this.end({ kind: 'failed', reason: (error as Error).message });
            });
    }

    private onBought(buy: Record<string, unknown>) {
        // a purchase confirmed after the trade was given up on is still followed: the contract exists
        this.done = false;
        this.contract_id = Number(buy.contract_id);
        this.buy_price = Number(buy.buy_price);
        this.options.onBought({
            contract_id: this.contract_id,
            buy_price: this.buy_price,
            payout: Number(buy.payout ?? 0),
        });
        this.watch();
        if (this.options.max_hold_ms) {
            this.after(this.options.max_hold_ms, () => this.sellNow(localize('The longest time to hold was reached.')));
        }
    }

    private watch() {
        const id = this.contract_id;
        if (id === null) return;
        this.contract_sub?.unsubscribe();
        this.contract_sub = this.options.api.subscribeOpenContract(id, update => this.onContract(update));
        this.armStall();
    }

    private armStall() {
        if (this.stall_timer) clearTimeout(this.stall_timer);
        this.stall_timer = setTimeout(() => this.onStall(), this.setting('contract_stall_ms'));
    }

    private onStall() {
        const id = this.contract_id;
        if (this.done || id === null) return;
        if (this.resubscribes >= this.setting('max_resubscribes')) {
            this.contract_sub?.unsubscribe();
            this.end({
                kind: 'lost_contact',
                contract_id: id,
                reason: localize(
                    'Lost contact with contract {{id}}. It may still be open and its result is not known. Check Positions.',
                    { id }
                ),
            });
            return;
        }
        this.resubscribes += 1;
        this.options.onLog(
            'warn',
            localize('No update on contract {{id}}. Asking the server again (try {{attempt}}).', {
                id,
                attempt: this.resubscribes,
            })
        );
        try {
            this.watch();
        } catch {
            this.armStall();
        }
    }

    private onContract(response: TApiResponse) {
        if (response?.error) {
            this.options.onLog('warn', errorText(response));
            return;
        }
        const contract = response?.proposal_open_contract;
        if (!contract || Number(contract.contract_id) !== this.contract_id || this.done) return;
        this.resubscribes = 0;
        this.armStall();
        this.last_profit = Number(contract.profit ?? 0);
        this.last_valid_to_sell = contract.is_valid_to_sell === 1 && contract.is_sold !== 1;
        if (contract.is_sold === 1) {
            this.end({
                kind: 'closed',
                profit: Math.round(this.last_profit * 100) / 100,
                entry_spot: spot(contract.entry_tick_display_value ?? contract.entry_spot_display_value),
                exit_spot: spot(contract.exit_tick_display_value ?? contract.exit_spot_display_value),
                contract_id: this.contract_id as number,
            });
            return;
        }
        this.options.onProgress?.({
            profit: this.last_profit,
            bid_price: Number(contract.bid_price ?? 0),
            entry_spot: spot(contract.entry_tick_display_value ?? contract.entry_spot_display_value),
        });
    }

    /** Sells the open contract at the market price. Does nothing if it is not open or cannot be sold right now. */
    sellNow(reason: string) {
        if (this.done || this.contract_id === null || this.sell_sent) return;
        if (!this.last_valid_to_sell) {
            this.options.onLog('warn', localize('The contract cannot be sold right now. Trying again shortly.'));
            this.after(5000, () => this.sellNow(reason));
            return;
        }
        this.sell_sent = true;
        this.options.onLog('info', localize('Selling the contract: {{reason}}', { reason }));
        this.options.api
            .sell(this.contract_id, 0)
            .then(response => {
                if (response?.error) {
                    this.sell_sent = false;
                    this.options.onLog('warn', errorText(response));
                }
            })
            .catch(() => {
                this.sell_sent = false;
            });
    }

    private end(result: TExecutorEnd) {
        if (this.done) return;
        this.done = true;
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        if (this.stall_timer) clearTimeout(this.stall_timer);
        this.proposal_sub?.unsubscribe();
        if (result.kind !== 'lost_contact') this.contract_sub?.unsubscribe();
        this.options.onEnd(result);
    }
}
