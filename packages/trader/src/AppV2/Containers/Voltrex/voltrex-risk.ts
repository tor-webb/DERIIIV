import { localize } from '@deriv-com/translations';

/**
 * The risk limits every order passes through before it is sent. `checkOrder` is a pure function of the settings and the
 * current state, so the same rules apply whether the order comes from the Buy button or from auto-trading.
 */

export type TRiskSettings = {
    /** The largest stake allowed on any one trade. */
    max_stake: number;
    /** Stop opening trades once today's realised loss, plus the stake at risk in open trades and the new one, would pass this. */
    max_daily_loss: number;
    max_open_trades: number;
    /** Auto-trading stops after this many losses in a row. */
    max_consecutive_losses: number;
    /** Auto-trading stops once today's profit reaches this. 0 means no target. */
    daily_profit_target: number;
    /** Auto-trading only takes signals at least this strong (0 to 100). */
    min_strength: number;
};

export const DEFAULT_RISK: TRiskSettings = {
    max_stake: 5,
    max_daily_loss: 10,
    max_open_trades: 2,
    max_consecutive_losses: 3,
    daily_profit_target: 0,
    min_strength: 50,
};

export const LIMITS = { max_open_trades: 10, min_strength: 100 };

export type TRiskState = {
    /** Local calendar day the figures belong to (YYYY-MM-DD). They start again on a new day. */
    day: string;
    realised_profit: number;
    consecutive_losses: number;
    /** Trades being placed or open, with the stake of each. */
    open_stakes: number[];
    emergency_stop: boolean;
};

export const today = (date = new Date()) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const emptyRiskState = (day = today()): TRiskState => ({
    day,
    realised_profit: 0,
    consecutive_losses: 0,
    open_stakes: [],
    emergency_stop: false,
});

const round2 = (value: number) => Math.round(value * 100) / 100;

const isPositive = (value: number) => Number.isFinite(value) && value > 0;

/** A message for the first setting that cannot be used, or null when they are all fine. */
export const validateRisk = (settings: TRiskSettings): string | null => {
    if (!isPositive(settings.max_stake)) return localize('Enter a maximum stake above 0.');
    if (!isPositive(settings.max_daily_loss)) return localize('Enter a daily loss limit above 0.');
    if (!Number.isInteger(settings.max_open_trades) || settings.max_open_trades < 1) {
        return localize('Maximum open trades must be a whole number of at least 1.');
    }
    if (settings.max_open_trades > LIMITS.max_open_trades) {
        return localize('Maximum open trades cannot be more than {{max}}.', { max: LIMITS.max_open_trades });
    }
    if (!Number.isInteger(settings.max_consecutive_losses) || settings.max_consecutive_losses < 1) {
        return localize('Maximum consecutive losses must be a whole number of at least 1.');
    }
    if (!Number.isFinite(settings.daily_profit_target) || settings.daily_profit_target < 0) {
        return localize('The daily profit target cannot be negative. Use 0 for no target.');
    }
    if (!Number.isFinite(settings.min_strength) || settings.min_strength < 0 || settings.min_strength > 100) {
        return localize('Minimum signal strength must be between 0 and 100.');
    }
    return null;
};

export type TOrderSource = 'manual' | 'auto';

/**
 * Whether one more order may be placed right now. Returns the reason it may not, or null when it may.
 * - Both kinds: the emergency stop, a valid stake within the maximum, the open-trade limit, and the daily loss limit.
 * - Auto only: the consecutive-loss limit, the daily profit target and the minimum signal strength. A person pressing
 *   Buy has chosen to trade on purpose; a bot has not.
 */
export const checkOrder = (
    settings: TRiskSettings,
    state: TRiskState,
    order: { stake: number; strength?: number; source: TOrderSource }
): string | null => {
    if (state.emergency_stop) return localize('The emergency stop is on. Reset it to place trades.');
    const invalid = validateRisk(settings);
    if (invalid) return invalid;
    if (!isPositive(order.stake)) return localize('Enter a stake above 0.');
    if (order.stake > settings.max_stake) {
        return localize('The stake {{stake}} is above your maximum stake of {{max}}.', {
            stake: order.stake,
            max: settings.max_stake,
        });
    }
    if (state.open_stakes.length >= settings.max_open_trades) {
        return localize('You already have {{count}} open trades, the most you allow.', {
            count: state.open_stakes.length,
        });
    }
    const loss_so_far = Math.max(0, -state.realised_profit);
    const at_risk = state.open_stakes.reduce((sum, stake) => sum + stake, 0);
    if (round2(loss_so_far + at_risk + order.stake) > settings.max_daily_loss) {
        return localize("This trade could take today's loss past your daily limit of {{max}}.", {
            max: settings.max_daily_loss,
        });
    }
    if (order.source === 'auto') {
        if (state.consecutive_losses >= settings.max_consecutive_losses) {
            return localize('{{count}} losses in a row: auto-trading is paused by your limit.', {
                count: state.consecutive_losses,
            });
        }
        if (settings.daily_profit_target > 0 && state.realised_profit >= settings.daily_profit_target) {
            return localize("Today's profit target of {{target}} has been reached.", {
                target: settings.daily_profit_target,
            });
        }
        if (order.strength === undefined || order.strength < settings.min_strength) {
            return localize('The signal strength is below your minimum of {{min}}.', { min: settings.min_strength });
        }
    }
    return null;
};

/** Starts the day's figures again when the date has changed. Open trades and the emergency stop carry over. */
export const rollDay = (state: TRiskState, day = today()): TRiskState =>
    state.day === day ? state : { ...state, day, realised_profit: 0, consecutive_losses: 0 };

const nextStreak = (streak: number, profit: number) => {
    if (profit < 0) return streak + 1;
    return profit > 0 ? 0 : streak;
};

/** Records a finished trade: adds its profit and counts or clears the losing streak. */
export const recordResult = (state: TRiskState, profit: number): TRiskState => ({
    ...state,
    realised_profit: round2(state.realised_profit + profit),
    consecutive_losses: nextStreak(state.consecutive_losses, profit),
});

/** Why auto-trading should stop on its own now, or null when it may carry on. Used after every finished trade. */
export const autoStopReason = (settings: TRiskSettings, state: TRiskState): string | null => {
    if (state.consecutive_losses >= settings.max_consecutive_losses) {
        return localize('Auto-trading stopped: {{count}} losses in a row.', { count: state.consecutive_losses });
    }
    if (round2(Math.max(0, -state.realised_profit)) >= settings.max_daily_loss) {
        return localize('Auto-trading stopped: the daily loss limit of {{max}} was reached.', {
            max: settings.max_daily_loss,
        });
    }
    if (settings.daily_profit_target > 0 && state.realised_profit >= settings.daily_profit_target) {
        return localize('Auto-trading stopped: the daily profit target of {{target}} was reached.', {
            target: settings.daily_profit_target,
        });
    }
    return null;
};
