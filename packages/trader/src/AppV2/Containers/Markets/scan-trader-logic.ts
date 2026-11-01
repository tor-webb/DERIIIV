import { localize } from '@deriv-com/translations';

import { findBotMarket } from '../BotBuilder/bot-markets';
import type { TProgram } from '../BotBuilder/Engine/types';

import { countActiveScanFilters, scanRows, TScanFilters } from './markets-scanner';
import type { TMarketRow } from './markets-utils';

/**
 * The decisions behind scanner trading, with no React and no Blockly so the Markets page can import it without cost.
 * Nothing here predicts a market. A scan picks a market that moved a certain way, and the person chooses whether to
 * trade with that move or against it; either can lose the stake.
 */

export type TTradeSide = 'with' | 'against';

export type TAutoSettings = {
    side: TTradeSide;
    stake: number;
    /** Stop after this many finished trades. */
    max_trades: number;
    /** Stop once the session's total loss reaches this amount. Required. */
    max_loss: number;
    /** Stop once the session's total profit reaches this amount. 0 means no take profit. */
    max_profit: number;
    /** Seconds to wait after a trade finishes before the next one. */
    cooldown_seconds: number;
};

export const DEFAULT_AUTO: TAutoSettings = {
    side: 'with',
    stake: 1,
    max_trades: 5,
    max_loss: 5,
    max_profit: 0,
    cooldown_seconds: 30,
};

export const MIN_COOLDOWN_SECONDS = 10;
export const MAX_TRADES_ALLOWED = 50;

/** Same durations as the Bot Builder templates: Derived indices trade ticks, forex has no tick contracts. */
export const SYNTHETIC_TICKS = 5;
export const FOREX_MINUTES = 5;

export type TEntry = {
    symbol: string;
    name: string;
    group: 'synthetic' | 'forex';
    contract_type: 'CALL' | 'PUT';
    /** The market's move over the scan window that made it match, in percent. */
    change_pct: number;
    duration: number;
    duration_unit: 't' | 'm';
};

/** True when at least one filter other than "open markets only" is on, so the scan says something about movement. */
export const hasSignalFilter = (filters: TScanFilters): boolean =>
    countActiveScanFilters({ ...filters, live_only: false }) > 0;

/**
 * The market that matches the scan with the biggest move (ties go to the symbol that sorts first, so the choice is
 * stable). Only markets Bot Builder can trade, that are open and have moved, are considered. With no movement filter
 * on, nothing is picked: "everything" is not a signal.
 */
export const pickEntry = (rows: TMarketRow[], filters: TScanFilters, side: TTradeSide): TEntry | null => {
    if (!hasSignalFilter(filters)) return null;
    const candidates = scanRows(rows, filters)
        .filter(
            row =>
                row.status === 'ready' &&
                !row.is_closed &&
                row.change_pct !== null &&
                row.change_pct !== 0 &&
                findBotMarket(row.symbol) !== null
        )
        .sort(
            (a, b) =>
                Math.abs(b.change_pct as number) - Math.abs(a.change_pct as number) || a.symbol.localeCompare(b.symbol)
        );
    const best = candidates[0];
    if (!best) return null;

    const change = best.change_pct as number;
    const rose = change > 0;
    const is_forex = best.group === 'forex';
    return {
        symbol: best.symbol,
        name: best.name,
        group: best.group,
        contract_type: (side === 'with' ? rose : !rose) ? 'CALL' : 'PUT',
        change_pct: change,
        duration: is_forex ? FOREX_MINUTES : SYNTHETIC_TICKS,
        duration_unit: is_forex ? 'm' : 't',
    };
};

const isMoney = (value: number) =>
    Number.isFinite(value) && value > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/** The first thing wrong with the settings, in words, or null when they are fine. */
export const validateAuto = (settings: TAutoSettings): string | null => {
    if (!isMoney(settings.stake)) return localize('Enter a stake above zero, with at most two decimals.');
    if (!Number.isInteger(settings.max_trades) || settings.max_trades < 1 || settings.max_trades > MAX_TRADES_ALLOWED) {
        return localize('Max trades must be a whole number from 1 to {{max}}.', { max: MAX_TRADES_ALLOWED });
    }
    if (!isMoney(settings.max_loss)) return localize('Set a stop loss above zero.');
    if (settings.max_loss < settings.stake) {
        return localize('The stop loss must be at least one stake, or the first loss would pass it.');
    }
    if (!(Number.isFinite(settings.max_profit) && settings.max_profit >= 0)) {
        return localize('Take profit must be zero (off) or more.');
    }
    if (!Number.isFinite(settings.cooldown_seconds) || settings.cooldown_seconds < MIN_COOLDOWN_SECONDS) {
        return localize('Wait at least {{seconds}} seconds between trades.', { seconds: MIN_COOLDOWN_SECONDS });
    }
    return null;
};

/**
 * A bot that buys one contract on the market right away and then ends. The controller starts one of these per entry
 * and keeps the session limits itself. `contract_type` is fixed, so the runner refuses any other.
 */
export const buildScanProgram = (entry: TEntry, stake: number): TProgram => ({
    setup: {
        symbol: entry.symbol,
        trade_type: 'risefall',
        contract_type: entry.contract_type,
        candle_interval: 60,
        restart_buy_sell: false,
        restart_on_error: false,
    },
    options: {
        duration_unit: entry.duration_unit,
        duration: { t: 'num', v: entry.duration },
        amount: { t: 'num', v: stake },
        prediction: null,
    },
    init: [],
    before_purchase: [{ t: 'purchase', contract_type: entry.contract_type }],
    during_purchase: [],
    after_purchase: [],
    procedures: {},
});

export type TScanSession = { runs: number; won: number; lost: number; total_profit: number };

export const emptySession = (): TScanSession => ({ runs: 0, won: 0, lost: 0, total_profit: 0 });

/** Why the session must stop now, or null to carry on. Checked after every finished trade. */
export const sessionStopReason = (session: TScanSession, settings: TAutoSettings): string | null => {
    if (-session.total_profit >= settings.max_loss) {
        return localize('Stop loss of {{amount}} reached.', { amount: settings.max_loss });
    }
    if (settings.max_profit > 0 && session.total_profit >= settings.max_profit) {
        return localize('Take profit of {{amount}} reached.', { amount: settings.max_profit });
    }
    if (session.runs >= settings.max_trades) {
        return localize('Trade limit of {{count}} reached.', { count: settings.max_trades });
    }
    return null;
};
