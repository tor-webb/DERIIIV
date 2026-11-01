import { localize } from '@deriv-com/translations';

import { BotRunner } from '../BotBuilder/Engine/runner';
import type { TBotApi, TBotStats, TLevel, TWatchdogOptions } from '../BotBuilder/Engine/types';

import type { TScanFilters } from './markets-scanner';
import type { TMarketRow } from './markets-utils';
import {
    buildScanProgram,
    emptySession,
    hasSignalFilter,
    pickEntry,
    sessionStopReason,
    TAutoSettings,
    TEntry,
    TScanSession,
    validateAuto,
} from './scan-trader-logic';

/**
 * Watches the scanner and, when a market matches, buys one contract on it through the Bot Builder engine, so the
 * engine's protections apply to every trade (stake cap, price check, dropped-connection watchdogs). It places one trade
 * at a time, waits between trades, and stops on a stop loss, a take profit, a trade limit or any failure.
 *
 * It trades on demo accounts only. This file is loaded on demand so the Markets page does not carry the engine.
 */

export type TScanTraderState = 'stopped' | 'watching' | 'trading' | 'stopping';

export type TScanTraderOptions = {
    api: TBotApi;
    currency: string;
    is_virtual: boolean;
    getBalance: () => number;
    getRows: () => TMarketRow[];
    getFilters: () => TScanFilters;
    settings: TAutoSettings;
    onLog: (level: TLevel, message: string) => void;
    onState: (state: TScanTraderState, session: TScanSession) => void;
    watchdog?: TWatchdogOptions;
    /** How long a run may go without opening a contract before it is given up. */
    entry_timeout_ms?: number;
};

const DEFAULT_ENTRY_TIMEOUT_MS = 45_000;

const round2 = (value: number) => Math.round(value * 100) / 100;

export class ScanTrader {
    private state: TScanTraderState = 'stopped';
    private session: TScanSession = emptySession();
    private runner: BotRunner | null = null;
    private run_stats: TBotStats | null = null;
    private contract_opened = false;
    private cooling = false;
    private stop_requested = false;
    private cooldown_timer: ReturnType<typeof setTimeout> | null = null;
    private entry_timer: ReturnType<typeof setTimeout> | null = null;

    private readonly options: TScanTraderOptions;

    constructor(options: TScanTraderOptions) {
        this.options = options;
    }

    getState = () => this.state;

    getSession = (): TScanSession => ({ ...this.session });

    /** Starts watching. Refuses, with a message, on a real account or with settings that are not safe. */
    start() {
        if (this.state !== 'stopped') return;
        const { is_virtual, settings, onLog } = this.options;
        if (!is_virtual) {
            onLog('error', localize('Auto-trading works on demo accounts only.'));
            return;
        }
        const problem = validateAuto(settings);
        if (problem) {
            onLog('error', problem);
            return;
        }
        if (!hasSignalFilter(this.options.getFilters())) {
            onLog('error', localize('Switch on at least one scanner filter (other than open markets only) first.'));
            return;
        }
        this.session = emptySession();
        this.stop_requested = false;
        this.cooling = false;
        onLog('info', localize('Auto-trading started on your demo account. Watching the scanner.'));
        this.setState('watching');
        this.poke();
    }

    /** Stops placing trades. A contract that is already open is followed until it finishes. */
    stop(reason?: string) {
        if (this.state === 'stopped' || this.state === 'stopping') return;
        if (reason) this.options.onLog('info', reason);
        this.stop_requested = true;
        this.clearCooldown();
        if (this.runner) {
            this.setState('stopping');
            this.runner.stop();
            return;
        }
        this.finish();
    }

    /** Call when the rows have changed. Starts a trade if the scan has a match and nothing is in the way. */
    poke() {
        if (this.state !== 'watching' || this.cooling || this.stop_requested) return;
        if (!hasSignalFilter(this.options.getFilters())) return;
        const entry = pickEntry(this.options.getRows(), this.options.getFilters(), this.options.settings.side);
        if (entry) this.startRun(entry);
    }

    private setState(state: TScanTraderState) {
        this.state = state;
        this.options.onState(state, this.getSession());
    }

    private clearCooldown() {
        if (this.cooldown_timer !== null) clearTimeout(this.cooldown_timer);
        this.cooldown_timer = null;
        this.cooling = false;
    }

    private clearEntryTimer() {
        if (this.entry_timer !== null) clearTimeout(this.entry_timer);
        this.entry_timer = null;
    }

    private startRun(entry: TEntry) {
        const { api, currency, getBalance, settings, watchdog, onLog } = this.options;
        const direction = entry.contract_type === 'CALL' ? localize('Rise') : localize('Fall');
        onLog(
            'info',
            localize('{{name}} matched the scan ({{change}}% over the window). Buying {{type}}.', {
                name: entry.name,
                change: entry.change_pct.toFixed(2),
                type: direction,
            })
        );

        this.run_stats = null;
        this.contract_opened = false;
        this.setState('trading');
        this.runner = new BotRunner({
            api,
            program: buildScanProgram(entry, settings.stake),
            currency,
            getBalance,
            // one trade per run, never above the chosen stake; the session limits are kept here
            limits: { max_trades: 1, max_stake: settings.stake },
            watchdog,
            onLog: (level, message) => onLog(level, `${entry.name}: ${message}`),
            onStats: stats => {
                this.run_stats = stats;
            },
            onStatus: status => {
                if (status === 'stopped') this.onRunEnded();
            },
            onTransaction: () => {
                this.contract_opened = true;
                this.clearEntryTimer();
            },
        });
        this.entry_timer = setTimeout(() => {
            this.entry_timer = null;
            if (this.runner && !this.contract_opened) {
                onLog('error', localize('No trade was placed in time, so the attempt was given up.'));
                this.runner.stop();
            }
        }, this.options.entry_timeout_ms ?? DEFAULT_ENTRY_TIMEOUT_MS);
        this.runner.start();
    }

    private onRunEnded() {
        this.clearEntryTimer();
        const stats = this.run_stats;
        this.runner = null;
        this.run_stats = null;

        if (stats && stats.runs > 0) {
            this.session = {
                runs: this.session.runs + stats.runs,
                won: this.session.won + stats.won,
                lost: this.session.lost + stats.lost,
                total_profit: round2(this.session.total_profit + stats.total_profit),
            };
        }
        if (this.stop_requested) {
            this.finish();
            return;
        }
        if (!stats || stats.runs === 0) {
            // an attempt that placed nothing means something is wrong (price, balance, connection); do not retry blindly
            this.options.onLog('error', localize('The trade could not be placed, so auto-trading stopped.'));
            this.finish();
            return;
        }
        const reason = sessionStopReason(this.session, this.options.settings);
        if (reason) {
            this.options.onLog('info', reason);
            this.finish();
            return;
        }
        this.cooling = true;
        this.setState('watching');
        this.cooldown_timer = setTimeout(() => {
            this.cooldown_timer = null;
            this.cooling = false;
            this.poke();
        }, this.options.settings.cooldown_seconds * 1000);
    }

    private finish() {
        this.clearCooldown();
        this.clearEntryTimer();
        this.runner = null;
        this.setState('stopped');
        this.options.onLog('info', localize('Auto-trading stopped.'));
    }
}
