import { localize } from '@deriv-com/translations';

import { BotRunner } from '../BotBuilder/Engine/runner';
import type { TBotApi, TBotStats, TLevel, TTransaction, TWatchdogOptions } from '../BotBuilder/Engine/types';
import { buildScanProgram } from '../Markets/scan-trader-logic';

import type { TScanRow } from './use-voltrex-scanner';
import { evaluateStrategy, TStrategyId } from './voltrex-analysis';
import type { TCategoryId } from './voltrex-config';
import { defaultDuration, TDurationUnit, TRiseFallSpec, validateDuration } from './voltrex-contracts';
import { bestDigitIdea, digitStats, MIN_DIGITS } from './voltrex-digits';
import {
    accumulatorEntry,
    accumulatorStrength,
    DEFAULT_ENTRY_SETTINGS,
    multiplierEntry,
    TEntrySettings,
    TOUCH_MINUTES,
    TOUCH_TARGET_PROBABILITY,
} from './voltrex-entries';
import { ContractExecutor, TExecutorEnd, TExecutorOptions } from './voltrex-executor';
import { backOff, isRateLimit, waitTurn } from './voltrex-pacer';
import { buildProposal, isDigitProduct, productLabel, TContractChoice, TProductId } from './voltrex-products';
import {
    autoStopReason,
    checkOrder,
    recordResult,
    rollDay,
    TOrderSource,
    TRiskSettings,
    TRiskState,
    validateRisk,
} from './voltrex-risk';
import { EMPTY_SPECS, offers, TMarketSpecs } from './voltrex-specs';
import { distanceForProbability, sigmaFromAtr, strengthOfEdge, touchProbability, touchVerdict } from './voltrex-touch';

/**
 * Places and follows every trade the Voltrex page makes, the Buy button's and auto-trading's alike. Each trade is one
 * Bot Builder run (a one-trade program), so the engine's checks apply: stake cap, balance check, price check, dropped
 * connection watchdogs. This class adds what the page needs on top: the risk gate, duplicate prevention, the
 * emergency stop and the automatic loop. It is loaded on demand so the page itself does not carry the engine.
 *
 * Auto-trading works on demo accounts only.
 */

export type TTradeStatus = 'placing' | 'open' | 'won' | 'lost' | 'failed';

export type TTrade = {
    id: number;
    symbol: string;
    name: string;
    product: TProductId;
    /** The server's contract type, such as CALL or DIGITOVER. */
    contract_type: string;
    /** Short text for lists, such as "Rise" or "Over 4". */
    label: string;
    stake: number;
    duration?: number;
    duration_unit?: TDurationUnit;
    source: TOrderSource;
    why: string;
    status: TTradeStatus;
    opened_at: number;
    contract_id?: number;
    buy_price?: number;
    payout?: number;
    profit?: number;
    entry_spot?: string;
    exit_spot?: string;
};

export type TOrder = {
    symbol: string;
    name: string;
    choice: TContractChoice;
    stake: number;
    source: TOrderSource;
    strength?: number;
    why: string;
    /** Accumulators and multipliers: sell at the market price after this many minutes. Off when 0 or missing. */
    max_hold_minutes?: number;
};

export type TAutoState = 'off' | 'running' | 'paused';

export type TAutoConfig = {
    strategy: TStrategyId;
    stake: number;
    /** Only markets in these categories are considered. */
    categories: TCategoryId[];
    /** Which kinds of contract auto-trading may use. Rise/Fall only when not given. */
    products?: TProductId[];
    entry?: TEntrySettings;
};

export type TLogEntry = { time: number; level: TLevel; message: string };

/** What the last look at the scanner found, so it is clear why auto-trading did or did not trade. */
export type TScanReport = {
    at: number;
    /** Number of looks so far this session. */
    scans: number;
    /** Markets in the chosen categories, and how many of them have no analysis yet (loading, closed, no data). */
    in_scope: number;
    waiting: number;
    /** Markets with a BUY or SELL reading, and how many the strategy accepts, and how many of those pass the minimum. */
    signals: number;
    accepted: number;
    qualified: number;
    /** The analysed market with the highest strength, even if it does not qualify. */
    closest: { name: string; direction: string; strength: number } | null;
    min_strength: number;
    /** What happened last: a trade placed, or the reason none was. */
    note: string;
};

export type TTraderSnapshot = {
    /** What auto-trading is working on, or null when it is off: the page follows the digits of those markets. */
    auto_scope: { products: TProductId[]; categories: TCategoryId[] } | null;
    scan: TScanReport | null;
    trades: TTrade[];
    risk: TRiskState;
    auto: TAutoState;
    log: TLogEntry[];
};

type TRunner = { start: () => void; stop: () => void };
export type TExecutorLike = { start: () => void; cancel: () => boolean };
type TRunnerOptions = ConstructorParameters<typeof BotRunner>[0];

export type TTraderOptions = {
    api: TBotApi;
    currency: string;
    is_virtual: boolean;
    getBalance: () => number;
    getRisk: () => TRiskSettings;
    getRows: () => TScanRow[];
    /** What a market allows for Rise/Fall, from the server. Null when it is not offered. */
    getSpec: (symbol: string) => Promise<TRiseFallSpec | null>;
    /** Everything a market sells. Without it, only Rise/Fall (from `getSpec`) can be traded. */
    getSpecs?: (symbol: string) => Promise<TMarketSpecs>;
    /** The latest last digits of a market's price, oldest first. */
    getDigits?: (symbol: string) => number[];
    initial_risk: TRiskState;
    onChange: (snapshot: TTraderSnapshot) => void;
    watchdog?: TWatchdogOptions;
    createRunner?: (options: TRunnerOptions) => TRunner;
    createExecutor?: (options: TExecutorOptions) => TExecutorLike;
    now?: () => number;
    /** How long a run may go without opening a contract before it is given up. */
    entry_timeout_ms?: number;
    /** How often auto-trading looks at the scanner. */
    auto_interval_ms?: number;
    /** After auto-trading closes a trade on a market, it leaves that market alone for this long. */
    symbol_cooldown_ms?: number;
};

const MAX_TRADES_KEPT = 60;
const MAX_LOG_KEPT = 200;
const DEFAULT_ENTRY_TIMEOUT_MS = 45_000;
const DEFAULT_AUTO_INTERVAL_MS = 3000;
const DEFAULT_SYMBOL_COOLDOWN_MS = 5 * 60 * 1000;
const TOUCH_IDEA_TTL_MS = 90_000;

const productLabelText = (product: TProductId) => productLabel(product);

/** `market` refusals are about that market only (no Rise/Fall, a trade already open); `account` ones apply to every market. */
export type TPlaceResult = { ok: true; trade: TTrade } | { ok: false; reason: string; scope: 'market' | 'account' };

type TCandidate = {
    row: TScanRow;
    product: TProductId;
    strength: number;
    why: string;
    /** Completes the contract choice from what the market sells, or null when it cannot be built. */
    build: (specs: TMarketSpecs) => TContractChoice | null;
};

const inRange = (range: { min: number; max: number } | null, value: number | undefined) =>
    !!range && Number.isInteger(value) && (value as number) >= range.min && (value as number) <= range.max;

/** A message for the first thing wrong with the choice for this market, or null when it can be sent. */
export const validateChoice = (specs: TMarketSpecs, choice: TContractChoice, stake: number): string | null => {
    const digit = Number(choice.barrier);
    switch (choice.product) {
        case 'over_under':
        case 'match_differ':
        case 'even_odd': {
            if (!specs.digits || !inRange(specs.digits.ticks, choice.duration) || choice.duration_unit !== 't') {
                return localize('Choose a number of ticks the market allows.');
            }
            if (choice.contract_type === 'DIGITEVEN' || choice.contract_type === 'DIGITODD') return null;
            if (choice.barrier === undefined || !Number.isInteger(digit) || digit < 0 || digit > 9) {
                return localize('Choose a digit from 0 to 9.');
            }
            if (choice.contract_type === 'DIGITOVER' && digit > 8) return localize('Over needs a digit from 0 to 8.');
            if (choice.contract_type === 'DIGITUNDER' && digit < 1) return localize('Under needs a digit from 1 to 9.');
            return null;
        }
        case 'touch': {
            const range = choice.duration_unit === 't' ? specs.touch?.ticks : specs.touch?.minutes;
            if (!inRange(range ?? null, choice.duration)) return localize('Choose a duration the market allows.');
            return choice.barrier && /^[+-]?\d+(\.\d+)?$/.test(choice.barrier)
                ? null
                : localize('Enter a barrier, such as +0.50.');
        }
        case 'accumulator':
            return specs.accumulator?.growth_rates.includes(choice.growth_rate as number)
                ? null
                : localize('Choose a growth rate the market allows.');
        case 'multiplier': {
            if (!specs.multiplier?.multipliers.includes(choice.multiplier as number)) {
                return localize('Choose a multiplier the market allows.');
            }
            if (choice.stop_loss !== undefined && !(choice.stop_loss > 0 && choice.stop_loss <= stake)) {
                return localize('The stop loss must be above 0 and no more than the stake.');
            }
            return null;
        }
        default:
            return null;
    }
};

/**
 * Digit statistics describe the past of a random sequence, so auto-trading asks for a clearer reading than the general
 * minimum: at least two standard deviations from chance (strength 50). The person's own minimum applies if higher.
 */
export const DIGIT_AUTO_MIN_STRENGTH = 50;

const resultWord = (profit: number) => {
    if (profit > 0) return localize('won');
    return profit < 0 ? localize('lost') : localize('broke even');
};

const minimumFor = (product: TProductId) => (isDigitProduct(product) ? DIGIT_AUTO_MIN_STRENGTH : 0);

export class VoltrexTrader {
    private trades: TTrade[] = [];
    private risk: TRiskState;
    private auto: TAutoState = 'off';
    private auto_config: TAutoConfig | null = null;
    private log: TLogEntry[] = [];
    private runners = new Map<number, TRunner>();
    private executors = new Map<number, TExecutorLike>();
    private max_hold = new Map<number, number>();
    /** The latest Touch / No Touch quote comparison per market, and where the next look starts. */
    private touch_ideas = new Map<string, { at: number; idea: TCandidate | null }>();
    private touch_cursor = 0;
    private no_touch = new Set<string>();
    /** The server's last reason for refusing a Touch / No Touch price, shown when quotes fail. */
    last_quote_error = '';
    private run_stats = new Map<number, TBotStats>();
    private entry_timers = new Map<number, ReturnType<typeof setTimeout>>();
    private last_closed = new Map<string, number>();
    private auto_timer: ReturnType<typeof setInterval> | null = null;
    private cycling = false;
    private scan: TScanReport | null = null;
    private scans = 0;
    private last_scan_log = 0;
    private last_attempt = '';
    private no_spec = new Set<string>();
    private next_id = 1;
    private disposed = false;

    private readonly options: TTraderOptions;

    constructor(options: TTraderOptions) {
        this.options = options;
        this.risk = rollDay(options.initial_risk);
    }

    private now = () => (this.options.now ? this.options.now() : Date.now());

    getSnapshot = (): TTraderSnapshot => ({
        auto_scope:
            this.auto !== 'off' && this.auto_config
                ? {
                      products: this.auto_config.products?.length ? this.auto_config.products : ['rise_fall'],
                      categories: this.auto_config.categories,
                  }
                : null,
        scan: this.scan,
        trades: this.trades.map(trade => ({ ...trade })),
        risk: { ...this.risk, open_stakes: [...this.risk.open_stakes] },
        auto: this.auto,
        log: [...this.log],
    });

    private emit() {
        if (!this.disposed) this.options.onChange(this.getSnapshot());
    }

    private write(level: TLevel, message: string) {
        // the same message again within half a minute (a limit that is hit on every look) is not written twice
        const previous = this.log[this.log.length - 1];
        if (
            previous &&
            previous.message === message &&
            previous.level === level &&
            this.now() - previous.time < 30_000
        ) {
            return;
        }
        this.log = [...this.log.slice(-(MAX_LOG_KEPT - 1)), { time: this.now(), level, message }];
    }

    /** Stakes of the trades being placed or open, which the risk gate counts. */
    private syncOpenStakes() {
        this.risk = {
            ...this.risk,
            open_stakes: this.trades
                .filter(trade => trade.status === 'placing' || trade.status === 'open')
                .map(trade => trade.stake),
        };
    }

    // ---------- placing a trade ----------

    /**
     * Checks the order against the risk limits and the rules below, then starts it. Returns why it was refused, or the
     * trade that was started. The same checks run for the Buy button and for auto-trading.
     */
    place(order: TOrder, specs: TMarketSpecs | null): TPlaceResult {
        const refuse = (reason: string, scope: 'market' | 'account' = 'account'): TPlaceResult => {
            this.write('error', `${order.name}: ${reason}`);
            this.emit();
            return { ok: false, reason, scope };
        };
        this.risk = rollDay(this.risk);
        this.syncOpenStakes();
        const { choice } = order;

        if (order.source === 'auto' && !this.options.is_virtual) {
            return refuse(localize('Auto-trading works on demo accounts only.'));
        }
        if (choice.product === 'rise_fall') {
            if (!specs?.rise_fall) return refuse(localize('This market does not offer Rise/Fall trades.'), 'market');
            const duration_problem = validateDuration(
                specs.rise_fall,
                choice.duration_unit as TDurationUnit,
                choice.duration as number
            );
            if (duration_problem) return refuse(duration_problem, 'market');
            if (choice.contract_type !== 'CALL' && choice.contract_type !== 'PUT') {
                return refuse(localize('Choose Rise or Fall.'));
            }
        } else {
            if (!offers(specs, choice.product, choice.contract_type)) {
                return refuse(
                    localize('This market does not offer {{kind}} trades.', { kind: choice.label }),
                    'market'
                );
            }
            const problem = validateChoice(specs as TMarketSpecs, choice, order.stake);
            if (problem) return refuse(problem, 'market');
        }

        const duplicate = this.trades.find(
            trade => trade.symbol === order.symbol && (trade.status === 'placing' || trade.status === 'open')
        );
        if (duplicate) return refuse(localize('There is already a trade open on this market.'), 'market');

        const risk_problem = checkOrder(this.options.getRisk(), this.risk, {
            stake: order.stake,
            strength: order.strength,
            source: order.source,
        });
        if (risk_problem) return refuse(risk_problem);

        const trade: TTrade = {
            id: this.next_id,
            symbol: order.symbol,
            name: order.name,
            product: choice.product,
            contract_type: choice.contract_type,
            label: choice.label,
            stake: order.stake,
            duration: choice.duration,
            duration_unit: choice.duration_unit,
            source: order.source,
            why: order.why,
            status: 'placing',
            opened_at: this.now(),
        };
        this.next_id += 1;
        // the trade counts against the limits from this moment, before the first network call, so two quick
        // orders cannot both pass the same check
        this.trades = [trade, ...this.trades].slice(0, MAX_TRADES_KEPT);
        this.syncOpenStakes();
        if (choice.product === 'rise_fall') this.start(trade);
        else this.startExecutor(trade, choice, order.max_hold_minutes);
        this.emit();
        return { ok: true, trade };
    }

    private start(trade: TTrade) {
        const { api, currency, getBalance, watchdog, entry_timeout_ms, createRunner } = this.options;
        this.write(
            'info',
            localize('{{name}}: placing {{side}}, stake {{stake}} for {{duration}} {{unit}} ({{source}}).', {
                name: trade.name,
                side: trade.label,
                stake: trade.stake,
                duration: trade.duration,
                unit: trade.duration_unit === 't' ? localize('ticks') : localize('minutes'),
                source: trade.source === 'auto' ? localize('auto') : localize('manual'),
            })
        );

        const runner_options: TRunnerOptions = {
            api,
            program: buildScanProgram(
                {
                    symbol: trade.symbol,
                    name: trade.name,
                    group: 'synthetic',
                    contract_type: trade.contract_type as 'CALL' | 'PUT',
                    change_pct: 0,
                    duration: trade.duration as number,
                    duration_unit: trade.duration_unit as TDurationUnit,
                },
                trade.stake
            ),
            currency,
            getBalance,
            // one trade, never above the stake, and never a loss above the stake
            limits: { max_trades: 1, max_stake: trade.stake, max_loss: trade.stake },
            watchdog,
            onLog: (level, message) => {
                this.write(level, `${trade.name}: ${message}`);
                this.emit();
            },
            onStats: stats => {
                this.run_stats.set(trade.id, stats);
            },
            onStatus: status => {
                if (status === 'stopped') this.onRunEnded(trade.id);
            },
            onTransaction: (transaction: TTransaction) => this.onTransaction(trade.id, transaction),
        };
        const runner = createRunner ? createRunner(runner_options) : new BotRunner(runner_options);
        this.runners.set(trade.id, runner);
        this.entry_timers.set(
            trade.id,
            setTimeout(() => {
                this.entry_timers.delete(trade.id);
                const current = this.find(trade.id);
                if (current && current.status === 'placing') {
                    this.write(
                        'error',
                        localize('{{name}}: no trade was placed in time, so it was given up.', { name: trade.name })
                    );
                    this.runners.get(trade.id)?.stop();
                }
            }, entry_timeout_ms ?? DEFAULT_ENTRY_TIMEOUT_MS)
        );
        runner.start();
    }

    private startExecutor(trade: TTrade, choice: TContractChoice, max_hold_minutes?: number) {
        const { api, currency, createExecutor } = this.options;
        this.write(
            'info',
            localize('{{name}}: placing {{kind}}, stake {{stake}} ({{source}}).', {
                name: trade.name,
                kind: trade.label,
                stake: trade.stake,
                source: trade.source === 'auto' ? localize('auto') : localize('manual'),
            })
        );
        const executor_options: TExecutorOptions = {
            api,
            request: buildProposal(choice, { symbol: trade.symbol, stake: trade.stake, currency }),
            max_price: trade.stake,
            max_hold_ms: max_hold_minutes && max_hold_minutes > 0 ? max_hold_minutes * 60_000 : undefined,
            onLog: (level, message) => {
                this.write(level, `${trade.name}: ${message}`);
                this.emit();
            },
            onBought: info => this.onExecutorBought(trade.id, info),
            onEnd: end => this.onExecutorEnd(trade.id, end),
        };
        const executor = createExecutor ? createExecutor(executor_options) : new ContractExecutor(executor_options);
        this.executors.set(trade.id, executor);
        executor.start();
    }

    private onExecutorBought(id: number, info: { contract_id: number; buy_price: number; payout: number }) {
        const trade = this.find(id);
        if (!trade) return;
        // a purchase confirmed after the trade was given up on is still a real contract, so it counts again
        if (trade.status === 'failed') {
            this.write('warn', localize('{{name}}: the purchase went through after all.', { name: trade.name }));
        }
        this.update(id, {
            status: 'open',
            contract_id: info.contract_id,
            buy_price: info.buy_price,
            payout: info.payout || undefined,
        });
        this.syncOpenStakes();
        this.write(
            'info',
            localize('{{name}}: bought {{kind}} for {{price}}.', {
                name: trade.name,
                kind: trade.label,
                price: info.buy_price,
            })
        );
        this.emit();
    }

    private onExecutorEnd(id: number, end: TExecutorEnd) {
        this.executors.delete(id);
        const trade = this.find(id);
        if (!trade) return;
        if (end.kind === 'closed') {
            this.update(id, { entry_spot: end.entry_spot, exit_spot: end.exit_spot });
            this.finishTrade(id, end.profit);
            return;
        }
        if (end.kind === 'lost_contact') {
            // the contract may still be open on the server, so it keeps counting against the limits
            this.update(id, { status: 'open', contract_id: end.contract_id });
        } else {
            this.update(id, { status: 'failed' });
        }
        this.write('error', `${trade.name}: ${end.reason}`);
        this.syncOpenStakes();
        this.emit();
    }

    /** Records one finished trade's result and applies the limits. */
    private finishTrade(id: number, profit: number) {
        const trade = this.find(id);
        if (!trade) return;
        const rounded = Math.round(profit * 100) / 100;
        this.update(id, { status: rounded > 0 ? 'won' : 'lost', profit: rounded });
        this.risk = recordResult(rollDay(this.risk), rounded);
        this.write(
            rounded >= 0 ? 'success' : 'warn',
            localize('{{name}}: {{result}}, {{profit}}.', {
                name: trade.name,
                result: resultWord(rounded),
                profit: `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}`,
            })
        );
        if (trade.source === 'auto') this.last_closed.set(trade.symbol, this.now());
        this.syncOpenStakes();
        if (this.auto === 'running') {
            const reason = autoStopReason(this.options.getRisk(), this.risk);
            if (reason) this.stopAuto(reason);
        }
        this.emit();
    }

    private find(id: number) {
        return this.trades.find(trade => trade.id === id);
    }

    private update(id: number, change: Partial<TTrade>) {
        this.trades = this.trades.map(trade => (trade.id === id ? { ...trade, ...change } : trade));
    }

    private onTransaction(id: number, transaction: TTransaction) {
        const timer = this.entry_timers.get(id);
        if (timer) clearTimeout(timer);
        this.entry_timers.delete(id);
        const is_done = transaction.status === 'won' || transaction.status === 'lost';
        this.update(id, {
            status: is_done ? transaction.status : 'open',
            contract_id: transaction.contract_id,
            buy_price: transaction.buy_price,
            payout: transaction.payout,
            profit: is_done ? transaction.profit : undefined,
            entry_spot: transaction.entry_spot,
            exit_spot: transaction.exit_spot,
        });
        this.emit();
    }

    /** The run finished: record the result once, from the run's own totals, and apply the limits. */
    private onRunEnded(id: number) {
        const timer = this.entry_timers.get(id);
        if (timer) clearTimeout(timer);
        this.entry_timers.delete(id);
        this.runners.delete(id);
        const stats = this.run_stats.get(id);
        this.run_stats.delete(id);
        const trade = this.find(id);
        if (!trade) return;

        if (!stats || stats.runs === 0) {
            this.update(id, { status: 'failed' });
            this.write('error', localize('{{name}}: the trade was not placed.', { name: trade.name }));
        } else {
            const profit = Math.round(stats.total_profit * 100) / 100;
            this.update(id, { status: profit >= 0 && stats.won > 0 ? 'won' : 'lost', profit });
            this.risk = recordResult(rollDay(this.risk), profit);
            this.write(
                profit >= 0 ? 'success' : 'warn',
                localize('{{name}}: {{result}}, {{profit}}.', {
                    name: trade.name,
                    result: stats.won > 0 ? localize('won') : localize('lost'),
                    profit: `${profit > 0 ? '+' : ''}${profit.toFixed(2)}`,
                })
            );
            if (trade.source === 'auto') this.last_closed.set(trade.symbol, this.now());
        }
        this.syncOpenStakes();
        if (this.auto === 'running') {
            const reason = autoStopReason(this.options.getRisk(), this.risk);
            if (reason) this.stopAuto(reason);
        }
        this.emit();
    }

    // ---------- emergency stop ----------

    /**
     * Stops everything new at once: auto-trading off, every trade that has not been bought yet cancelled, and no order
     * accepted until the stop is reset. A contract that is already open is left to finish and is still followed.
     */
    emergencyStop() {
        this.risk = { ...this.risk, emergency_stop: true };
        this.auto = 'off';
        this.stopTimer();
        this.write('warn', localize('EMERGENCY STOP: no new trades will be placed.'));
        this.trades
            .filter(trade => trade.status === 'placing')
            .forEach(trade => {
                this.runners.get(trade.id)?.stop();
                this.executors.get(trade.id)?.cancel();
            });
        this.emit();
    }

    resetEmergency() {
        if (!this.risk.emergency_stop) return;
        this.risk = { ...this.risk, emergency_stop: false };
        this.write('info', localize('Emergency stop reset. Trading is allowed again.'));
        this.emit();
    }

    // ---------- auto-trading ----------

    startAuto(config: TAutoConfig): string | null {
        const fail = (message: string) => {
            this.write('error', message);
            this.emit();
            return message;
        };
        if (!this.options.is_virtual) return fail(localize('Auto-trading works on demo accounts only.'));
        if (this.risk.emergency_stop) return fail(localize('The emergency stop is on. Reset it first.'));
        const risk = this.options.getRisk();
        const invalid = validateRisk(risk);
        if (invalid) return fail(invalid);
        if (!(config.stake > 0) || config.stake > risk.max_stake) {
            return fail(localize('The auto stake must be above 0 and no more than your maximum stake.'));
        }
        if (!config.categories.length) return fail(localize('Choose at least one market category to trade.'));
        this.risk = rollDay(this.risk);
        const stop = autoStopReason(risk, this.risk);
        if (stop) return fail(stop);

        this.auto_config = config;
        this.scan = null;
        this.scans = 0;
        this.last_scan_log = 0;
        this.no_spec.clear();
        this.auto = 'running';
        this.write(
            'info',
            localize('Auto-trading started on your demo account ({{strategy}}, stake {{stake}}).', {
                strategy: config.strategy,
                stake: config.stake,
            })
        );
        this.startTimer();
        this.emit();
        this.cycle();
        return null;
    }

    pauseAuto() {
        if (this.auto !== 'running') return;
        this.auto = 'paused';
        this.write('info', localize('Auto-trading paused. Open trades continue.'));
        this.emit();
    }

    resumeAuto() {
        if (this.auto !== 'paused' || this.risk.emergency_stop) return;
        this.auto = 'running';
        this.write('info', localize('Auto-trading resumed.'));
        this.emit();
    }

    stopAuto(reason?: string) {
        if (this.auto === 'off') return;
        this.auto = 'off';
        this.stopTimer();
        this.write('info', reason ?? localize('Auto-trading stopped. Open trades continue.'));
        this.emit();
    }

    updateAutoConfig(config: TAutoConfig) {
        if (this.auto !== 'off') this.auto_config = config;
    }

    private startTimer() {
        this.stopTimer();
        this.auto_timer = setInterval(() => this.cycle(), this.options.auto_interval_ms ?? DEFAULT_AUTO_INTERVAL_MS);
    }

    private stopTimer() {
        if (this.auto_timer !== null) clearInterval(this.auto_timer);
        this.auto_timer = null;
    }

    private async specsFor(symbol: string): Promise<TMarketSpecs> {
        const { getSpecs, getSpec } = this.options;
        if (getSpecs) return getSpecs(symbol).catch(() => EMPTY_SPECS);
        return { ...EMPTY_SPECS, rise_fall: await getSpec(symbol).catch(() => null) };
    }

    /** The ideas every enabled kind of contract has for the markets in scope, strongest first. */
    private collect(config: TAutoConfig, rows: TScanRow[]): TCandidate[] {
        const products = config.products?.length ? config.products : (['rise_fall'] as TProductId[]);
        const entry = config.entry ?? DEFAULT_ENTRY_SETTINGS;
        const found: TCandidate[] = [];
        rows.forEach(row => {
            const signal = row.signal as NonNullable<TScanRow['signal']>;
            if (products.includes('rise_fall')) {
                const idea = evaluateStrategy(config.strategy, signal);
                if (idea) {
                    found.push({
                        row,
                        product: 'rise_fall',
                        strength: idea.strength,
                        why: idea.why,
                        build: specs => {
                            if (!specs.rise_fall) return null;
                            const { unit, value } = defaultDuration(specs.rise_fall);
                            return {
                                product: 'rise_fall',
                                contract_type: idea.side,
                                label: idea.side === 'CALL' ? localize('Rise') : localize('Fall'),
                                duration: value,
                                duration_unit: unit,
                            };
                        },
                    });
                }
            }
            if (products.includes('multiplier') && evaluateStrategy(config.strategy, signal)) {
                const idea = evaluateStrategy(config.strategy, signal);
                found.push({
                    row,
                    product: 'multiplier',
                    strength: idea?.strength ?? 0,
                    why: idea?.why ?? '',
                    build: specs => multiplierEntry(row, specs, config.stake, config.strategy, entry)?.choice ?? null,
                });
            }
            if (products.includes('accumulator')) {
                found.push({
                    row,
                    product: 'accumulator',
                    strength: accumulatorStrength(row),
                    why: localize('The price looks to be ranging (signal {{score}}, {{level}} volatility).', {
                        score: signal.score.toFixed(2),
                        level: row.volatility_level ?? localize('unknown'),
                    }),
                    build: specs => accumulatorEntry(row, specs, config.stake, entry)?.choice ?? null,
                });
            }
            const digits = this.options.getDigits?.(row.symbol) ?? [];
            if (digits.length >= MIN_DIGITS) {
                const stats = digitStats(digits);
                products.filter(isDigitProduct).forEach(product => {
                    const idea = bestDigitIdea(product, stats);
                    if (!idea) return;
                    found.push({
                        row,
                        product,
                        strength: idea.strength,
                        why: idea.why,
                        build: specs => {
                            if (!specs.digits?.types.includes(idea.choice.contract_type)) return null;
                            const { min, max } = specs.digits.ticks;
                            return {
                                ...idea.choice,
                                duration: Math.min(max, Math.max(min, idea.choice.duration ?? 1)),
                                duration_unit: 't',
                            };
                        },
                    });
                });
            }
            if (products.includes('touch')) {
                const verdict = this.touch_ideas.get(row.symbol);
                if (verdict?.idea && this.now() - verdict.at < TOUCH_IDEA_TTL_MS) found.push(verdict.idea);
            }
        });
        return found;
    }

    /**
     * Quotes both sides of Touch / No Touch for one market (the next in turn), compares the quotes with the model and
     * keeps the result for a minute or two. One market per look keeps the number of requests small.
     */
    private async lookAtTouch(rows: TScanRow[]) {
        const eligible = rows.filter(row => !this.no_touch.has(row.symbol) && row.signal?.primary.readings.atr_pct);
        if (!eligible.length) return;
        this.touch_cursor = (this.touch_cursor + 1) % eligible.length;
        const row = eligible[this.touch_cursor];
        const known = this.touch_ideas.get(row.symbol);
        if (known && this.now() - known.at < TOUCH_IDEA_TTL_MS) return;
        const specs = await this.specsFor(row.symbol);
        if (!specs.touch?.minutes || !inRange(specs.touch.minutes, TOUCH_MINUTES)) {
            this.no_touch.add(row.symbol);
            return;
        }
        const idea = await this.quoteTouch(row, TOUCH_MINUTES);
        this.touch_ideas.set(row.symbol, { at: this.now(), idea });
    }

    /** Asks the server for both prices at a barrier set from the recent range, and compares them with the model. */
    async quoteTouch(row: TScanRow, minutes: number, barrier?: string): Promise<TCandidate | null> {
        const readings = row.signal?.primary.readings;
        if (!readings || !readings.atr_pct || !row.price) return null;
        const sigma = sigmaFromAtr(readings.atr_pct);
        const sign = row.signal?.direction === 'SELL' ? '-' : '+';
        const distance_pct = barrier
            ? (Math.abs(Number(barrier)) / row.price) * 100
            : distanceForProbability(TOUCH_TARGET_PROBABILITY, minutes, sigma);
        const offset = barrier ?? `${sign}${((row.price * distance_pct) / 100).toFixed(row.pip_size)}`;
        const model = touchProbability(distance_pct, minutes, sigma);
        const ask = (contract_type: string) => this.quoteOnce(row.symbol, contract_type, offset, minutes);
        const touch = await ask('ONETOUCH');
        const no_touch = await ask('NOTOUCH');
        const verdict = touchVerdict(model, touch, no_touch);
        if (!verdict) return null;
        const is_touch = verdict.contract_type === 'ONETOUCH';
        const percent = (value: number) => `${Math.round(value * 100)}%`;
        return {
            row,
            product: 'touch',
            strength: strengthOfEdge(verdict.edge),
            why: localize(
                'The model puts the chance of touching {{barrier}} at {{model}}; the price implies {{implied}}.',
                {
                    barrier: offset,
                    model: percent(is_touch ? verdict.model : 1 - verdict.model),
                    implied: percent(verdict.implied),
                }
            ),
            build: specs =>
                specs.touch
                    ? {
                          product: 'touch',
                          contract_type: verdict.contract_type,
                          label: is_touch
                              ? localize('Touch {{barrier}}', { barrier: offset })
                              : localize('No Touch {{barrier}}', { barrier: offset }),
                          barrier: offset,
                          duration: minutes,
                          duration_unit: 'm',
                      }
                    : null,
        };
    }

    /** One price quote, then the subscription is dropped. Null when the server refuses or does not answer. */
    private quoteOnce(symbol: string, contract_type: string, barrier: string, minutes: number) {
        return new Promise<{ ask_price: number; payout: number } | null>(resolve => {
            const { api, currency } = this.options;
            let done = false;
            let sub: { unsubscribe: () => void } | undefined;
            const finish = (value: { ask_price: number; payout: number } | null) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                sub?.unsubscribe();
                resolve(value);
            };
            const timer = setTimeout(() => finish(null), 10_000);
            waitTurn()
                .then(() => {
                    if (done) return;
                    const request = buildProposal(
                        { product: 'touch', contract_type, label: '', barrier, duration: minutes, duration_unit: 'm' },
                        { symbol, stake: 1, currency }
                    );
                    sub = api.subscribeProposal(request as never, response => {
                        if (isRateLimit(response)) backOff();
                        const proposal = response?.proposal;
                        if (response?.error || !proposal) {
                            this.last_quote_error = response?.error?.message ?? '';
                            finish(null);
                            return;
                        }
                        finish({ ask_price: Number(proposal.ask_price), payout: Number(proposal.payout) });
                    });
                    if (done) sub?.unsubscribe();
                })
                .catch(() => finish(null));
        });
    }

    /** One look at the scanner: places at most one trade, on the strongest idea that meets the strategy and the limits. */
    async cycle() {
        if (this.auto !== 'running' || this.cycling || !this.auto_config || this.risk.emergency_stop) return;
        this.cycling = true;
        try {
            const config = this.auto_config;
            const risk = this.options.getRisk();
            const cooldown = this.options.symbol_cooldown_ms ?? DEFAULT_SYMBOL_COOLDOWN_MS;
            const in_scope = this.options.getRows().filter(row => config.categories.includes(row.category));
            const analysed = in_scope.filter(row => row.status === 'ready' && row.signal);
            const rested = analysed.filter(row => {
                const closed_at = this.last_closed.get(row.symbol);
                return closed_at === undefined || this.now() - closed_at >= cooldown;
            });
            if (config.products?.includes('touch')) await this.lookAtTouch(rested);
            const accepted = this.collect(config, rested);
            const candidates = accepted
                .filter(item => item.strength >= Math.max(risk.min_strength, minimumFor(item.product)))
                .sort((a, b) => b.strength - a.strength);
            const closest = [...analysed].sort((a, b) => (b.signal?.strength ?? 0) - (a.signal?.strength ?? 0))[0];
            this.last_attempt = '';
            await this.tryCandidates(candidates, config);

            this.scans += 1;
            let note = this.last_attempt;
            if (!note) {
                if (!in_scope.length) note = localize('No markets in the chosen categories.');
                else if (!analysed.length) note = localize('Waiting for the first analysis of these markets…');
                else if (!accepted.length) {
                    note = localize('No market fits the {{strategy}} strategy right now.', {
                        strategy: config.strategy,
                    });
                } else note = localize('Markets fit the strategy, but none reaches your minimum strength yet.');
            }
            this.scan = {
                at: this.now(),
                scans: this.scans,
                in_scope: in_scope.length,
                waiting: in_scope.length - analysed.length,
                signals: analysed.filter(row => row.signal?.direction !== 'NEUTRAL').length,
                accepted: accepted.length,
                qualified: candidates.length,
                closest: closest?.signal
                    ? { name: closest.name, direction: closest.signal.direction, strength: closest.signal.strength }
                    : null,
                min_strength: risk.min_strength,
                note,
            };
            // one line in the log a minute, so the log shows the scan is alive without filling up
            if (this.now() - this.last_scan_log >= 60_000) {
                this.last_scan_log = this.now();
                this.write(
                    'info',
                    localize(
                        'Scan: {{analysed}} markets analysed, {{signals}} with a signal, {{qualified}} meet your limits. {{note}}',
                        {
                            analysed: analysed.length,
                            signals: this.scan.signals,
                            qualified: candidates.length,
                            note,
                        }
                    )
                );
            }
            this.emit();
        } finally {
            this.cycling = false;
        }
    }

    /** Tries the strongest candidate first; moves to the next only when the refusal was about that one market. */
    private async tryCandidates(candidates: TCandidate[], config: TAutoConfig): Promise<void> {
        const [first, ...rest] = candidates;
        if (!first) return;
        // the emergency stop or a stop request may arrive while specs are being fetched
        if (this.auto !== 'running' || this.risk.emergency_stop) return;
        const { row } = first;
        const is_busy = this.trades.some(
            trade => trade.symbol === row.symbol && (trade.status === 'placing' || trade.status === 'open')
        );
        const specs = is_busy ? null : await this.specsFor(row.symbol);
        if (this.auto !== 'running' || this.risk.emergency_stop) return;
        const choice = specs ? first.build(specs) : null;
        if (!specs || !choice) {
            const key = `${row.symbol}:${first.product}`;
            if (!is_busy && !this.no_spec.has(key)) {
                this.no_spec.add(key);
                this.write(
                    'warn',
                    localize('{{name}}: {{kind}} is not offered, so it is skipped.', {
                        name: row.name,
                        kind: productLabelText(first.product),
                    })
                );
            }
            await this.tryCandidates(rest, config);
            return;
        }
        const result = this.place(
            {
                symbol: row.symbol,
                name: row.name,
                choice,
                stake: config.stake,
                source: 'auto',
                strength: first.strength,
                why: first.why,
                max_hold_minutes: (config.entry ?? DEFAULT_ENTRY_SETTINGS).max_hold_minutes,
            },
            specs
        );
        this.last_attempt = result.ok
            ? localize('Placed {{kind}} on {{name}}.', { kind: choice.label, name: row.name })
            : `${row.name}: ${result.reason}`;
        if (!result.ok && result.scope === 'market') await this.tryCandidates(rest, config);
    }

    // ---------- shutting down ----------

    /** Called when the page closes: nothing new is placed and anything not yet bought is cancelled. */
    dispose() {
        this.disposed = true;
        this.auto = 'off';
        this.stopTimer();
        this.entry_timers.forEach(timer => clearTimeout(timer));
        this.entry_timers.clear();
        this.trades
            .filter(trade => trade.status === 'placing')
            .forEach(trade => {
                this.runners.get(trade.id)?.stop();
                this.executors.get(trade.id)?.cancel();
            });
    }
}
