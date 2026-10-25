import { localize } from '@deriv-com/translations';

import { execute, TInterpreterContext } from './interpreter';
import type {
    TApiResponse,
    TBotApi,
    TBotStats,
    TDataKind,
    TLevel,
    TProgram,
    TRunLimits,
    TRunStatus,
    TStmt,
    TSubscription,
} from './types';

type TPhase = 'idle' | 'waiting' | 'buying' | 'in_contract' | 'restarting';

export type TRunnerOptions = {
    api: TBotApi;
    program: TProgram;
    currency: string;
    getBalance: () => number;
    limits?: TRunLimits;
    onLog: (level: TLevel, message: string) => void;
    onStats: (stats: TBotStats) => void;
    onStatus: (status: TRunStatus) => void;
};

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
    private stats: TBotStats = { runs: 0, won: 0, lost: 0, total_profit: 0, total_stake: 0 };
    private vars = new Map<string, number | boolean>();

    private last_tick = 0;
    private last_digit = 0;
    private current_profit = 0;
    private sell_available = false;
    private last_result: 'win' | 'loss' | null = null;

    private contract_id: number | null = null;
    private buy_in_flight = false;
    private sell_in_flight = false;

    private tick_sub: TSubscription | null = null;
    private proposal_sub: TSubscription | null = null;
    private contract_sub: TSubscription | null = null;

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
        this.phase = 'waiting';
        this.stats = { runs: 0, won: 0, lost: 0, total_profit: 0, total_stake: 0 };
        this.vars.clear();
        this.last_result = null;
        this.options.onStatus(this.status);
        this.options.onStats(this.getStats());
        onLog(
            'info',
            localize('Bot started: {{symbol}}, stake {{stake}} {{currency}}.', {
                symbol: program.trade.symbol,
                stake: program.trade.stake,
                currency: this.options.currency,
            })
        );

        this.tick_sub = api.subscribeTicks(program.trade.symbol, response => this.onTick(response));
    }

    /** Stops placing new trades. An open contract is followed until it closes so its result is recorded. */
    stop(reason?: string) {
        if (this.status === 'idle' || this.status === 'stopped' || this.status === 'stopping') return;
        if (reason) this.options.onLog('info', reason);

        this.tick_sub?.unsubscribe();
        this.tick_sub = null;

        if (this.phase === 'in_contract' || this.buy_in_flight) {
            this.status = 'stopping';
            this.options.onStatus(this.status);
            this.options.onLog('info', localize('Stopping once the open contract finishes.'));
            return;
        }
        this.teardown();
    }

    private teardown() {
        this.tick_sub?.unsubscribe();
        this.proposal_sub?.unsubscribe();
        this.contract_sub?.unsubscribe();
        this.tick_sub = null;
        this.proposal_sub = null;
        this.contract_sub = null;
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

    private read = (kind: TDataKind): number | boolean => {
        switch (kind) {
            case 'last_tick':
                return this.last_tick;
            case 'last_digit':
                return this.last_digit;
            case 'balance':
                return this.options.getBalance();
            case 'total_profit':
                return this.stats.total_profit;
            case 'current_profit':
                return this.current_profit;
            case 'sell_available':
                return this.sell_available;
            case 'last_result_win':
                return this.last_result === 'win';
            default:
                return this.last_result === 'loss';
        }
    };

    private runStack(statements: TStmt[]) {
        const requests = { purchase: null as string | null, sell: false, trade_again: false };
        const ctx: TInterpreterContext = {
            vars: this.vars,
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
        };
        try {
            execute(statements, ctx);
        } catch (error) {
            this.fail((error as Error).message);
            return null;
        }
        return requests;
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
        const requests = this.runStack(this.options.program.purchase);
        if (requests?.purchase && this.status === 'running') this.requestPurchase(requests.purchase);
    }

    private requestPurchase(contract_type: string) {
        const { api, program, currency, limits } = this.options;
        const { stake, symbol, duration, duration_unit } = program.trade;

        if (limits?.max_trades && this.stats.runs >= limits.max_trades) {
            this.stop(localize('Trade limit of {{count}} reached.', { count: limits.max_trades }));
            return;
        }
        if (this.options.getBalance() < stake) {
            this.fail(localize('Your balance is lower than the stake of {{stake}} {{currency}}.', { stake, currency }));
            return;
        }

        this.phase = 'buying';
        this.proposal_sub = subscribeOnce(
            cb =>
                api.subscribeProposal(
                    {
                        amount: stake,
                        basis: 'stake',
                        contract_type,
                        currency,
                        // the platform's own proposals use `underlying_symbol` and an integer duration
                        underlying_symbol: symbol,
                        duration: Math.trunc(duration),
                        duration_unit,
                    },
                    cb
                ),
            response => {
                this.proposal_sub = null;
                if (this.status !== 'running') {
                    if (this.status === 'stopping' && !this.buy_in_flight) this.teardown();
                    return;
                }
                if (response?.error || !response?.proposal) {
                    this.fail(errorMessage(response));
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
                    this.fail(errorMessage(response));
                    return;
                }
                const { contract_id, buy_price } = response.buy;
                this.contract_id = Number(contract_id);
                this.phase = 'in_contract';
                this.current_profit = 0;
                this.sell_available = false;
                this.sell_in_flight = false;
                this.stats.total_stake += Number(buy_price);
                this.options.onLog(
                    'info',
                    localize('Bought contract {{id}} for {{price}} {{currency}}.', {
                        id: contract_id,
                        price: buy_price,
                        currency: this.options.currency,
                    })
                );
                this.contract_sub = this.options.api.subscribeOpenContract(this.contract_id, update =>
                    this.onContract(update)
                );
            })
            .catch(error => {
                this.buy_in_flight = false;
                this.fail(error?.error?.message ?? error?.message ?? errorMessage(undefined));
            });
    }

    private onContract(response: TApiResponse) {
        if (response?.error) {
            this.options.onLog('warn', errorMessage(response));
            return;
        }
        const contract = response?.proposal_open_contract;
        if (!contract || Number(contract.contract_id) !== this.contract_id) return;

        this.current_profit = Number(contract.profit ?? 0);
        this.sell_available = contract.is_valid_to_sell === 1 && contract.is_sold !== 1;

        if (contract.is_sold === 1) {
            this.finishContract(contract);
            return;
        }
        if (this.status !== 'running' || this.sell_in_flight) return;

        const requests = this.runStack(this.options.program.sell);
        if (requests?.sell && this.sell_available) this.sellContract(Number(contract.bid_price));
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
        this.contract_id = null;
        // no contract is open any more, so a stop from here on can finish immediately
        this.phase = 'restarting';

        const profit = Number(contract.profit ?? 0);
        const won = contract.status === 'won' || profit > 0;
        this.last_result = won ? 'win' : 'loss';
        this.current_profit = 0;
        this.sell_available = false;
        this.stats.runs += 1;
        this.stats[won ? 'won' : 'lost'] += 1;
        this.stats.total_profit = Math.round((this.stats.total_profit + profit) * 100) / 100;
        this.options.onStats(this.getStats());
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
            this.stop(localize('Loss limit of {{amount}} reached.', { amount: limits.max_loss }));
            return;
        }
        if (limits?.max_trades && this.stats.runs >= limits.max_trades) {
            this.stop(localize('Trade limit of {{count}} reached.', { count: limits.max_trades }));
            return;
        }

        const requests = this.runStack(this.options.program.restart);
        if (!requests || this.status !== 'running') return;
        if (requests.trade_again) {
            this.phase = 'waiting';
        } else {
            this.stop(localize('Bot finished: the restart conditions did not ask to trade again.'));
        }
    }
}
