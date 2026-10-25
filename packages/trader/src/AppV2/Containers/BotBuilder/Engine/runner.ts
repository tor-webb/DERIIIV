import { localize } from '@deriv-com/translations';

import { PREDICTION_CONTRACTS } from '../blocks';

import { evaluate, execute, TInterpreterContext } from './interpreter';
import type {
    TApiResponse,
    TBotApi,
    TBotStats,
    TDataKind,
    TLevel,
    TLiveContract,
    TProgram,
    TRunLimits,
    TRunStatus,
    TExpr,
    TStmt,
    TSubscription,
    TTradeRequest,
    TTransaction,
    TValue,
} from './types';

type TPhase = 'idle' | 'starting' | 'preparing' | 'waiting' | 'buying' | 'in_contract' | 'restarting';

export type TRunnerOptions = {
    api: TBotApi;
    program: TProgram;
    currency: string;
    getBalance: () => number;
    limits?: TRunLimits;
    onLog: (level: TLevel, message: string) => void;
    onStats: (stats: TBotStats) => void;
    onStatus: (status: TRunStatus) => void;
    onTransaction?: (transaction: TTransaction) => void;
    /** The contract being followed, or null once it has closed. Feeds the live card in the Summary tab. */
    onLiveContract?: (contract: TLiveContract | null) => void;
    /** Answers the bot's "prompt for" questions. It may throw (for example when the person cancels) to stop the bot. */
    prompt?: (message: string, kind: 'NUMBER' | 'TEXT') => TValue;
};

/** The trade options a bot picked at run time (see `TProgram.options_stack`), worked out but not yet checked. */
type TPickedOptions = { duration_unit: string; duration: TValue; amount: TValue; prediction: TValue | null };

type TRequests = { purchase: string | null; sell: boolean; trade_again: boolean };

type TContractInfo = {
    buy_price: number;
    payout: number;
    profit: number;
    sell_price: number;
    entry_spot: string;
    exit_spot: string;
    current_value: number;
    tick_current: number;
    tick_total: number;
};

const MAX_TIMERS = 100;
const MAX_CONSECUTIVE_TRADE_ERRORS = 5;

const emptyStats = (): TBotStats => ({ runs: 0, won: 0, lost: 0, total_profit: 0, total_stake: 0, total_payout: 0 });

const emptyContract = (): TContractInfo => ({
    buy_price: 0,
    payout: 0,
    profit: 0,
    sell_price: 0,
    entry_spot: '',
    exit_spot: '',
    current_value: 0,
    tick_current: 0,
    tick_total: 0,
});

const spotText = (value: unknown) => (value === undefined || value === null ? '' : String(value));

const round2 = (value: number) => Math.round(value * 100) / 100;

const errorMessage = (response: TApiResponse | undefined) =>
    response?.error?.message ?? localize('Something went wrong while talking to the server.');

/**
 * Subscribes and runs `handler` for the first response only. Copes with a response arriving before the
 * subscription handle has been returned.
 */
const subscribeOnce = (
    subscribe: (cb: (response: TApiResponse) => void) => TSubscription,
    handler: (response: TApiResponse) => void
): TSubscription => {
    let done = false;
    const handle: { subscription?: TSubscription } = {};
    handle.subscription = subscribe(response => {
        if (done) return;
        done = true;
        handle.subscription?.unsubscribe();
        handler(response);
    });
    if (done) handle.subscription.unsubscribe();
    return handle.subscription;
};

export class BotRunner {
    private status: TRunStatus = 'idle';
    private phase: TPhase = 'idle';
    private stats: TBotStats = emptyStats();
    private vars = new Map<string, TValue>();

    private last_tick = 0;
    private last_digit = 0;
    private contract: TContractInfo = emptyContract();
    private sell_available = false;
    private last_result: 'win' | 'loss' | null = null;
    private consecutive_trade_errors = 0;

    private contract_id: number | null = null;
    private last_contract_id = 0;
    private contract_type = '';
    private last_request: TTradeRequest | null = null;
    private picked_options: TPickedOptions | null = null;
    private buy_in_flight = false;
    private sell_in_flight = false;

    private tick_sub: TSubscription | null = null;
    private proposal_sub: TSubscription | null = null;
    private contract_sub: TSubscription | null = null;
    private timers = new Set<ReturnType<typeof setTimeout>>();

    private readonly options: TRunnerOptions;

    constructor(options: TRunnerOptions) {
        this.options = options;
    }

    getStatus = () => this.status;

    getStats = () => ({ ...this.stats });

    start() {
        if (this.status === 'running' || this.status === 'stopping') return;
        const { api, program, onLog } = this.options;

        this.status = 'running';
        this.phase = 'starting';
        this.stats = emptyStats();
        this.vars.clear();
        this.contract = emptyContract();
        this.last_result = null;
        this.consecutive_trade_errors = 0;
        this.options.onStatus(this.status);
        this.options.onStats(this.getStats());
        onLog(
            'info',
            localize('Bot started: {{symbol}}, {{currency}} account.', {
                symbol: program.setup.symbol,
                currency: this.options.currency,
            })
        );

        // the "run once at start" blocks come first, then the bot starts listening to ticks
        this.runStack(program.init);
        if (this.status !== 'running') return;

        this.picked_options = null;
        this.phase = program.options_stack ? 'preparing' : 'waiting';
        this.tick_sub = api.subscribeTicks(program.setup.symbol, response => this.onTick(response));
        if (program.options_stack) this.runOptionsStack();
    }

    /** With run-time trade options, the trade parameters script runs before every trade and picks the options. */
    private beginNextTrade() {
        if (!this.options.program.options_stack) {
            this.phase = 'waiting';
            return;
        }
        this.picked_options = null;
        this.phase = 'preparing';
        this.runOptionsStack();
    }

    private runOptionsStack() {
        const { options_stack } = this.options.program;
        if (!options_stack) return;
        const requests = this.runStack(options_stack);
        if (requests) this.applyRequests(requests);
        this.checkOptionsStalled();
    }

    /** The script finished (and no timeout is pending) without ever saying what to trade. */
    private checkOptionsStalled() {
        if (this.status === 'running' && this.phase === 'preparing' && this.timers.size === 0) {
            this.fail(localize('The trade parameters did not set any trade options.'));
        }
    }

    /** Stops placing new trades. An open contract is followed until it closes so its result is recorded. */
    stop(reason?: string) {
        if (this.status === 'idle' || this.status === 'stopped' || this.status === 'stopping') return;
        if (reason) this.options.onLog('info', reason);

        this.tick_sub?.unsubscribe();
        this.tick_sub = null;
        this.clearTimers();

        if (this.phase === 'in_contract' || this.buy_in_flight) {
            this.status = 'stopping';
            this.options.onStatus(this.status);
            this.options.onLog('info', localize('Stopping once the open contract finishes.'));
            return;
        }
        this.teardown();
    }

    private clearTimers() {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
    }

    private teardown() {
        this.tick_sub?.unsubscribe();
        this.proposal_sub?.unsubscribe();
        this.contract_sub?.unsubscribe();
        this.tick_sub = null;
        this.proposal_sub = null;
        this.contract_sub = null;
        this.clearTimers();
        this.emitLiveContract(false);
        this.phase = 'idle';
        this.status = 'stopped';
        this.options.onStatus(this.status);
        this.options.onLog('info', localize('Bot stopped.'));
    }

    private fail(message: string) {
        this.options.onLog('error', message);
        // a failed purchase while stopping leaves no contract to wait for
        if (this.status === 'stopping' && !this.buy_in_flight && this.phase !== 'in_contract') {
            this.teardown();
            return;
        }
        this.stop();
    }

    /** A failed proposal or purchase. With "restart on error" the bot skips that trade and tries the next one. */
    private failTrade(message: string) {
        const { restart_on_error } = this.options.program.setup;
        this.consecutive_trade_errors += 1;
        if (
            restart_on_error &&
            this.status === 'running' &&
            this.consecutive_trade_errors < MAX_CONSECUTIVE_TRADE_ERRORS
        ) {
            this.options.onLog('warn', localize('Trade skipped: {{message}}', { message }));
            this.phase = 'waiting';
            return;
        }
        this.fail(message);
    }

    private read = (kind: TDataKind): TValue => {
        switch (kind) {
            case 'tick':
                return this.last_tick;
            case 'last_digit':
                return this.last_digit;
            case 'balance':
                return this.options.getBalance();
            case 'balance_text':
                return String(this.options.getBalance());
            case 'total_profit':
                return this.stats.total_profit;
            case 'total_runs':
                return this.stats.runs;
            case 'sell_available':
                return this.sell_available;
            case 'result_win':
                return this.last_result === 'win';
            case 'result_loss':
                return this.last_result === 'loss';
            case 'detail_contract_id':
                return this.contract_id ?? this.last_contract_id;
            case 'detail_contract_type':
                return this.contract_type;
            case 'detail_buy_price':
                return this.contract.buy_price;
            case 'detail_payout':
                return this.contract.payout;
            case 'detail_profit':
                return this.contract.profit;
            default:
                return this.contract.sell_price;
        }
    };

    private makeContext(requests: TRequests): TInterpreterContext {
        return {
            vars: this.vars,
            procedures: this.options.program.procedures,
            read: this.read,
            notify: (level, message) => this.options.onLog(level, message),
            purchase: contract_type => {
                requests.purchase = requests.purchase ?? contract_type;
            },
            sell: () => {
                requests.sell = true;
            },
            tradeAgain: () => {
                requests.trade_again = true;
            },
            schedule: (seconds, body) => this.scheduleTimer(seconds, body),
            prompt: this.options.prompt,
            setOptions: picked => {
                if (!this.options.program.options_stack) return;
                this.picked_options = picked;
                if (this.phase === 'preparing') this.phase = 'waiting';
            },
        };
    }

    private runStack(statements: TStmt[]): TRequests | null {
        const requests: TRequests = { purchase: null, sell: false, trade_again: false };
        try {
            execute(statements, this.makeContext(requests));
        } catch (error) {
            this.fail((error as Error).message);
            return null;
        }
        return requests;
    }

    private scheduleTimer(seconds: number, body: TStmt[]) {
        if (this.timers.size >= MAX_TIMERS) {
            throw new Error(localize('The bot scheduled too many timeouts at once.'));
        }
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            if (this.status !== 'running') return;
            const requests = this.runStack(body);
            if (requests) this.applyRequests(requests);
            this.finishIfStalled();
            this.checkOptionsStalled();
        }, seconds * 1000);
        this.timers.add(timer);
    }

    /** After the restart conditions, the bot may be waiting on a timeout that will say "trade again". */
    private finishIfStalled() {
        if (this.status === 'running' && this.phase === 'restarting' && this.timers.size === 0) {
            if (this.options.limits?.keep_running) {
                this.beginNextTrade();
                return;
            }
            this.stop(localize('Bot finished: the restart conditions did not ask to trade again.'));
        }
    }

    private applyRequests(requests: TRequests) {
        if (this.status !== 'running') return;
        if (requests.purchase && this.phase === 'waiting') {
            this.requestPurchase(requests.purchase);
            return;
        }
        if (requests.sell && this.phase === 'in_contract' && this.sell_available && !this.sell_in_flight) {
            this.sellContract(this.contract.sell_price);
            return;
        }
        if (requests.trade_again && this.phase === 'restarting') this.beginNextTrade();
    }

    private onTick(response: TApiResponse) {
        if (this.status !== 'running') return;
        if (response?.error || !response?.tick) {
            this.fail(errorMessage(response));
            return;
        }
        const { quote, pip_size } = response.tick;
        this.last_tick = Number(quote);
        const digits = Number(quote).toFixed(Number.isInteger(pip_size) ? pip_size : 2);
        this.last_digit = Number(digits[digits.length - 1]);

        if (this.phase !== 'waiting') return;
        const requests = this.runStack(this.options.program.before_purchase);
        if (requests) this.applyRequests(requests);
    }

    /** Works out this trade's request from the trade options. They are re-evaluated for every trade. */
    private buildRequest(contract_type: string): TTradeRequest | null {
        const { program, currency } = this.options;
        const { setup, options } = program;

        if (setup.contract_type !== 'both' && setup.contract_type !== contract_type) {
            this.fail(
                localize('The bot may only buy {{allowed}} contracts, but a purchase block asked for {{asked}}.', {
                    allowed: setup.contract_type,
                    asked: contract_type,
                })
            );
            return null;
        }

        let amount: number, duration: number;
        let duration_unit = options.duration_unit;
        let prediction: number | null = null;
        try {
            const ctx = this.makeContext({ purchase: null, sell: false, trade_again: false });
            // options picked by the bot's own script, or the fixed ones re-evaluated for every trade
            const picked = program.options_stack ? this.picked_options : null;
            if (program.options_stack && !picked) {
                this.fail(localize('The trade parameters did not set any trade options.'));
                return null;
            }
            const read = (expr: TExpr | null, value: TValue | null | undefined) =>
                picked ? value : expr && evaluate(expr, ctx);
            // the API takes at most two decimals; a martingale stake such as 0.3642 must be rounded first
            amount = round2(Number(read(options.amount, picked?.amount)));
            duration = Math.trunc(Number(read(options.duration, picked?.duration)));
            if (picked) duration_unit = picked.duration_unit;
            if (PREDICTION_CONTRACTS.has(contract_type)) {
                const prediction_value = read(options.prediction, picked?.prediction);
                if (prediction_value === null || prediction_value === undefined) {
                    this.fail(
                        localize('{{type}} needs a digit prediction, but the trade type has no prediction.', {
                            type: contract_type,
                        })
                    );
                    return null;
                }
                prediction = Math.trunc(Number(prediction_value));
            }
        } catch (error) {
            this.fail((error as Error).message);
            return null;
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            this.fail(localize('The stake must be greater than zero.'));
            return null;
        }
        if (!Number.isFinite(duration) || duration < 1) {
            this.fail(localize('The duration must be at least 1.'));
            return null;
        }
        if (prediction !== null && !(prediction >= 0 && prediction <= 9)) {
            this.fail(localize('The prediction must be a digit from 0 to 9.'));
            return null;
        }

        const request: TTradeRequest = {
            amount,
            basis: 'stake',
            contract_type,
            currency,
            // the platform's own proposals use `underlying_symbol` and an integer duration
            underlying_symbol: setup.symbol,
            duration,
            duration_unit,
        };
        // the platform sends the digit prediction as `barrier`
        if (prediction !== null) request.barrier = String(prediction);
        this.last_request = request;
        return request;
    }

    private requestPurchase(contract_type: string) {
        const { api, limits, currency } = this.options;

        if (limits?.max_trades && this.stats.runs >= limits.max_trades) {
            this.stop(localize('Trade limit of {{count}} reached.', { count: limits.max_trades }));
            return;
        }
        const request = this.buildRequest(contract_type);
        if (!request) return;
        if (this.options.getBalance() < request.amount) {
            this.fail(
                localize('Your balance is lower than the stake of {{stake}} {{currency}}.', {
                    stake: request.amount,
                    currency,
                })
            );
            return;
        }

        this.phase = 'buying';
        this.contract_type = contract_type;
        this.proposal_sub = subscribeOnce(
            cb => api.subscribeProposal(request, cb),
            response => {
                this.proposal_sub = null;
                if (this.status !== 'running') {
                    if (this.status === 'stopping' && !this.buy_in_flight) this.teardown();
                    return;
                }
                if (response?.error || !response?.proposal) {
                    this.failTrade(errorMessage(response));
                    return;
                }
                this.buy(response.proposal.id, Number(response.proposal.ask_price));
            }
        );
    }

    private buy(proposal_id: string, price: number) {
        this.buy_in_flight = true;
        this.options.api
            .buy(proposal_id, price)
            .then(response => {
                this.buy_in_flight = false;
                if (response?.error || !response?.buy) {
                    this.failTrade(errorMessage(response));
                    return;
                }
                const { contract_id, buy_price, payout } = response.buy;
                this.consecutive_trade_errors = 0;
                this.contract_id = Number(contract_id);
                this.phase = 'in_contract';
                const { duration, duration_unit } = this.last_request ?? { duration: 0, duration_unit: '' };
                this.contract = {
                    ...emptyContract(),
                    buy_price: Number(buy_price),
                    payout: Number(payout ?? 0),
                    tick_total: duration_unit === 't' ? duration : 0,
                };
                this.sell_available = false;
                this.sell_in_flight = false;
                this.stats.total_stake = round2(this.stats.total_stake + Number(buy_price));
                this.options.onStats(this.getStats());
                this.options.onLog(
                    'info',
                    localize('Bought contract {{id}} for {{price}} {{currency}}.', {
                        id: contract_id,
                        price: buy_price,
                        currency: this.options.currency,
                    })
                );
                this.emitTransaction('open');
                this.emitLiveContract();
                this.contract_sub = this.options.api.subscribeOpenContract(this.contract_id, update =>
                    this.onContract(update)
                );
            })
            .catch(error => {
                this.buy_in_flight = false;
                this.failTrade(error?.error?.message ?? error?.message ?? errorMessage(undefined));
            });
    }

    private emitTransaction(status: TTransaction['status']) {
        if (this.contract_id === null) return;
        this.options.onTransaction?.({
            contract_id: this.contract_id,
            contract_type: this.contract_type,
            symbol: this.options.program.setup.symbol,
            buy_price: this.contract.buy_price,
            payout: this.contract.payout,
            profit: this.contract.profit,
            entry_spot: this.contract.entry_spot,
            exit_spot: this.contract.exit_spot,
            status,
            time: new Date().toLocaleTimeString(),
        });
    }

    private emitLiveContract(open = true) {
        const { onLiveContract } = this.options;
        if (!onLiveContract) return;
        if (!open || this.contract_id === null) {
            onLiveContract(null);
            return;
        }
        onLiveContract({
            contract_id: this.contract_id,
            contract_type: this.contract_type,
            symbol: this.options.program.setup.symbol,
            buy_price: this.contract.buy_price,
            profit: this.contract.profit,
            current_value: this.contract.current_value,
            payout: this.contract.payout,
            resale_offered: this.sell_available,
            tick_current: this.contract.tick_current,
            tick_total: this.contract.tick_total,
        });
    }

    /** Copies what an open-contract update says about the spots and the tick count. */
    private readSpots(contract: TApiResponse) {
        const entry = contract.entry_spot_display_value ?? contract.entry_tick_display_value ?? contract.entry_tick;
        const exit = contract.exit_tick_display_value ?? contract.exit_tick ?? contract.sell_spot_display_value;
        if (entry !== undefined && entry !== null) this.contract.entry_spot = spotText(entry);
        if (exit !== undefined && exit !== null) this.contract.exit_spot = spotText(exit);
        if (Array.isArray(contract.tick_stream)) this.contract.tick_current = contract.tick_stream.length;
        else if (contract.tick_count !== undefined && this.contract.tick_total === 0) {
            this.contract.tick_total = Number(contract.tick_count);
        }
    }

    private onContract(response: TApiResponse) {
        if (response?.error) {
            this.options.onLog('warn', errorMessage(response));
            return;
        }
        const contract = response?.proposal_open_contract;
        if (!contract || Number(contract.contract_id) !== this.contract_id) return;

        this.contract.profit = Number(contract.profit ?? 0);
        this.contract.sell_price = Number(contract.bid_price ?? contract.sell_price ?? 0);
        this.contract.current_value = Number(contract.bid_price ?? contract.sell_price ?? 0);
        if (contract.payout !== undefined) this.contract.payout = Number(contract.payout);
        this.sell_available = contract.is_valid_to_sell === 1 && contract.is_sold !== 1;
        this.readSpots(contract);

        if (contract.is_sold === 1) {
            this.finishContract(contract);
            return;
        }
        this.emitLiveContract();
        if (this.status !== 'running' || this.sell_in_flight) return;

        const requests = this.runStack(this.options.program.during_purchase);
        if (requests) this.applyRequests(requests);
    }

    private sellContract(bid_price: number) {
        if (this.contract_id === null) return;
        this.sell_in_flight = true;
        this.options.api
            .sell(this.contract_id, bid_price)
            .then(response => {
                if (response?.error) {
                    this.options.onLog('warn', errorMessage(response));
                    this.sell_in_flight = false; // try again on the next update
                    return;
                }
                this.options.onLog('info', localize('Sold the contract at market price.'));
            })
            .catch(() => {
                this.sell_in_flight = false;
            });
    }

    private finishContract(contract: TApiResponse) {
        this.contract_sub?.unsubscribe();
        this.contract_sub = null;
        // no contract is open any more, so a stop from here on can finish immediately
        this.phase = 'restarting';

        const profit = Number(contract.profit ?? 0);
        const won = contract.status === 'won' || profit > 0;
        this.contract.profit = profit;
        this.contract.sell_price = Number(contract.sell_price ?? this.contract.sell_price);
        this.readSpots(contract);
        this.last_result = won ? 'win' : 'loss';
        this.sell_available = false;
        this.stats.runs += 1;
        this.stats[won ? 'won' : 'lost'] += 1;
        this.stats.total_profit = round2(this.stats.total_profit + profit);
        this.stats.total_payout = round2(this.stats.total_payout + this.contract.sell_price);
        this.options.onStats(this.getStats());
        this.emitTransaction(won ? 'won' : 'lost');
        this.emitLiveContract(false);
        this.last_contract_id = this.contract_id ?? this.last_contract_id;
        this.contract_id = null;
        this.options.onLog(
            won ? 'success' : 'warn',
            won
                ? localize('Contract won: +{{profit}} {{currency}}.', { profit, currency: this.options.currency })
                : localize('Contract lost: {{profit}} {{currency}}.', { profit, currency: this.options.currency })
        );

        if (this.status !== 'running') {
            this.teardown();
            return;
        }

        const { limits } = this.options;
        if (limits?.max_loss && -this.stats.total_profit >= limits.max_loss) {
            this.stop(localize('Stop loss of {{amount}} reached.', { amount: limits.max_loss }));
            return;
        }
        if (limits?.max_profit && this.stats.total_profit >= limits.max_profit) {
            this.stop(localize('Take profit of {{amount}} reached.', { amount: limits.max_profit }));
            return;
        }
        if (limits?.max_trades && this.stats.runs >= limits.max_trades) {
            this.stop(localize('Trade limit of {{count}} reached.', { count: limits.max_trades }));
            return;
        }

        const requests = this.runStack(this.options.program.after_purchase);
        if (!requests || this.status !== 'running') return;
        if (requests.trade_again || (limits?.keep_running && this.timers.size === 0)) {
            this.beginNextTrade();
            return;
        }
        // a timeout in the restart conditions may still ask to trade again
        this.finishIfStalled();
    }
}
