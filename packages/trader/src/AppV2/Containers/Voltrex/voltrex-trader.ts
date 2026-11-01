import { localize } from '@deriv-com/translations';

import { BotRunner } from '../BotBuilder/Engine/runner';
import type { TBotApi, TBotStats, TLevel, TTransaction, TWatchdogOptions } from '../BotBuilder/Engine/types';
import { buildScanProgram } from '../Markets/scan-trader-logic';

import type { TScanRow } from './use-voltrex-scanner';
import { evaluateStrategy, TEntryIdea, TStrategyId } from './voltrex-analysis';
import type { TCategoryId } from './voltrex-config';
import { defaultDuration, TDurationUnit, TRiseFallSpec, validateDuration } from './voltrex-contracts';
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
    side: 'CALL' | 'PUT';
    stake: number;
    duration: number;
    duration_unit: TDurationUnit;
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
    side: 'CALL' | 'PUT';
    stake: number;
    duration: number;
    duration_unit: TDurationUnit;
    source: TOrderSource;
    strength?: number;
    why: string;
};

export type TAutoState = 'off' | 'running' | 'paused';

export type TAutoConfig = {
    strategy: TStrategyId;
    stake: number;
    /** Only markets in these categories are considered. */
    categories: TCategoryId[];
};

export type TLogEntry = { time: number; level: TLevel; message: string };

export type TTraderSnapshot = {
    trades: TTrade[];
    risk: TRiskState;
    auto: TAutoState;
    log: TLogEntry[];
};

type TRunner = { start: () => void; stop: () => void };
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
    initial_risk: TRiskState;
    onChange: (snapshot: TTraderSnapshot) => void;
    watchdog?: TWatchdogOptions;
    createRunner?: (options: TRunnerOptions) => TRunner;
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

/** `market` refusals are about that market only (no Rise/Fall, a trade already open); `account` ones apply to every market. */
export type TPlaceResult = { ok: true; trade: TTrade } | { ok: false; reason: string; scope: 'market' | 'account' };

export class VoltrexTrader {
    private trades: TTrade[] = [];
    private risk: TRiskState;
    private auto: TAutoState = 'off';
    private auto_config: TAutoConfig | null = null;
    private log: TLogEntry[] = [];
    private runners = new Map<number, TRunner>();
    private run_stats = new Map<number, TBotStats>();
    private entry_timers = new Map<number, ReturnType<typeof setTimeout>>();
    private last_closed = new Map<string, number>();
    private auto_timer: ReturnType<typeof setInterval> | null = null;
    private cycling = false;
    private next_id = 1;
    private disposed = false;

    private readonly options: TTraderOptions;

    constructor(options: TTraderOptions) {
        this.options = options;
        this.risk = rollDay(options.initial_risk);
    }

    private now = () => (this.options.now ? this.options.now() : Date.now());

    getSnapshot = (): TTraderSnapshot => ({
        trades: this.trades.map(trade => ({ ...trade })),
        risk: { ...this.risk, open_stakes: [...this.risk.open_stakes] },
        auto: this.auto,
        log: [...this.log],
    });

    private emit() {
        if (!this.disposed) this.options.onChange(this.getSnapshot());
    }

    private write(level: TLevel, message: string) {
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
    place(order: TOrder, spec: TRiseFallSpec | null): TPlaceResult {
        const refuse = (reason: string, scope: 'market' | 'account' = 'account'): TPlaceResult => {
            this.write('error', `${order.name}: ${reason}`);
            this.emit();
            return { ok: false, reason, scope };
        };
        this.risk = rollDay(this.risk);
        this.syncOpenStakes();

        if (order.source === 'auto' && !this.options.is_virtual) {
            return refuse(localize('Auto-trading works on demo accounts only.'));
        }
        if (!spec) return refuse(localize('This market does not offer Rise/Fall trades.'), 'market');
        const duration_problem = validateDuration(spec, order.duration_unit, order.duration);
        if (duration_problem) return refuse(duration_problem, 'market');
        if (order.side !== 'CALL' && order.side !== 'PUT') return refuse(localize('Choose Rise or Fall.'));

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
            side: order.side,
            stake: order.stake,
            duration: order.duration,
            duration_unit: order.duration_unit,
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
        this.start(trade);
        this.emit();
        return { ok: true, trade };
    }

    private start(trade: TTrade) {
        const { api, currency, getBalance, watchdog, entry_timeout_ms, createRunner } = this.options;
        const side_text = trade.side === 'CALL' ? localize('Rise') : localize('Fall');
        this.write(
            'info',
            localize('{{name}}: placing {{side}}, stake {{stake}} for {{duration}} {{unit}} ({{source}}).', {
                name: trade.name,
                side: side_text,
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
                    contract_type: trade.side,
                    change_pct: 0,
                    duration: trade.duration,
                    duration_unit: trade.duration_unit,
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
        this.trades.filter(trade => trade.status === 'placing').forEach(trade => this.runners.get(trade.id)?.stop());
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

    /** One look at the scanner: places at most one trade, on the strongest market that meets the strategy and the limits. */
    async cycle() {
        if (this.auto !== 'running' || this.cycling || !this.auto_config || this.risk.emergency_stop) return;
        this.cycling = true;
        try {
            const config = this.auto_config;
            const risk = this.options.getRisk();
            const cooldown = this.options.symbol_cooldown_ms ?? DEFAULT_SYMBOL_COOLDOWN_MS;
            const candidates = this.options
                .getRows()
                .filter(row => row.status === 'ready' && row.signal && config.categories.includes(row.category))
                .filter(row => {
                    const closed_at = this.last_closed.get(row.symbol);
                    return closed_at === undefined || this.now() - closed_at >= cooldown;
                })
                .map(row => ({
                    row,
                    idea: evaluateStrategy(config.strategy, row.signal as NonNullable<TScanRow['signal']>),
                }))
                .filter(item => item.idea && item.idea.strength >= risk.min_strength)
                .sort((a, b) => (b.idea?.strength ?? 0) - (a.idea?.strength ?? 0));

            await this.tryCandidates(candidates, config);
        } finally {
            this.cycling = false;
        }
    }

    /** Tries the strongest candidate first; moves to the next only when the refusal was about that one market. */
    private async tryCandidates(
        candidates: { row: TScanRow; idea: TEntryIdea | null }[],
        config: TAutoConfig
    ): Promise<void> {
        const [first, ...rest] = candidates;
        if (!first || !first.idea) return;
        // the emergency stop or a stop request may arrive while a spec is being fetched
        if (this.auto !== 'running' || this.risk.emergency_stop) return;
        const { row, idea } = first;
        const is_busy = this.trades.some(
            trade => trade.symbol === row.symbol && (trade.status === 'placing' || trade.status === 'open')
        );
        const spec = is_busy ? null : await this.options.getSpec(row.symbol).catch(() => null);
        if (this.auto !== 'running' || this.risk.emergency_stop) return;
        if (!spec) {
            await this.tryCandidates(rest, config);
            return;
        }
        const { unit, value } = defaultDuration(spec);
        const result = this.place(
            {
                symbol: row.symbol,
                name: row.name,
                side: idea.side,
                stake: config.stake,
                duration: value,
                duration_unit: unit,
                source: 'auto',
                strength: idea.strength,
                why: idea.why,
            },
            spec
        );
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
        this.trades.filter(trade => trade.status === 'placing').forEach(trade => this.runners.get(trade.id)?.stop());
    }
}
