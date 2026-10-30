/** Pure risk maths for the Risk Calculator page. Every function returns `null` when an input is not usable. */

const isPositive = (value: number) => Number.isFinite(value) && value > 0;

export type TPositionSizeInput = {
    balance: number;
    /** % of the balance you accept to lose if the stop loss is hit */
    risk_percent: number;
    stop_loss_pips: number;
    /** What one pip is worth for one lot, in account currency */
    pip_value_per_lot: number;
};

export type TPositionSize = {
    risk_amount: number;
    lots: number;
};

export const calcPositionSize = ({
    balance,
    risk_percent,
    stop_loss_pips,
    pip_value_per_lot,
}: TPositionSizeInput): TPositionSize | null => {
    if (![balance, risk_percent, stop_loss_pips, pip_value_per_lot].every(isPositive) || risk_percent > 100) {
        return null;
    }
    const risk_amount = (balance * risk_percent) / 100;
    return { risk_amount, lots: risk_amount / (stop_loss_pips * pip_value_per_lot) };
};

export type TRewardRisk = {
    reward_amount: number;
    /** The share of trades you must win just to break even, in % */
    breakeven_win_rate: number;
};

export const calcRewardRisk = (risk_amount: number, reward_ratio: number): TRewardRisk | null => {
    if (!isPositive(risk_amount) || !isPositive(reward_ratio)) return null;
    return { reward_amount: risk_amount * reward_ratio, breakeven_win_rate: 100 / (1 + reward_ratio) };
};

export type TStakePlanInput = {
    balance: number;
    risk_percent: number;
    /** Profit as % of the stake when a contract wins, for example 85 */
    payout_percent: number;
    /** Your expected win rate in % */
    win_rate: number;
};

export type TLosingStreak = {
    losses: number;
    /** Chance of that many losses in a row, in % */
    probability: number;
    /** Share of the starting balance lost, in %, with a fixed stake */
    drawdown: number;
};

export type TStakePlan = {
    stake: number;
    profit_if_win: number;
    expected_value: number;
    breakeven_win_rate: number;
    streaks: TLosingStreak[];
    /** How many trades in a row you can fund when the stake doubles after every loss, starting from the first stake */
    doubling_steps_affordable: number;
};

export const STREAK_LENGTHS = [3, 5, 10];

export const calcStakePlan = ({
    balance,
    risk_percent,
    payout_percent,
    win_rate,
}: TStakePlanInput): TStakePlan | null => {
    if (![balance, risk_percent, payout_percent].every(isPositive) || risk_percent > 100) return null;
    if (!Number.isFinite(win_rate) || win_rate < 0 || win_rate > 100) return null;

    const stake = (balance * risk_percent) / 100;
    const profit_if_win = (stake * payout_percent) / 100;
    const win_chance = win_rate / 100;
    const expected_value = win_chance * profit_if_win - (1 - win_chance) * stake;

    let doubling_steps_affordable = 0;
    // n trades in a row cost stake * (2^n - 1) in total; count the trades whose total cost the balance still covers
    while (stake * (2 ** (doubling_steps_affordable + 1) - 1) <= balance && doubling_steps_affordable < 60) {
        doubling_steps_affordable += 1;
    }

    return {
        stake,
        profit_if_win,
        expected_value,
        breakeven_win_rate: 100 / (1 + payout_percent / 100),
        streaks: STREAK_LENGTHS.map(losses => ({
            losses,
            probability: (1 - win_chance) ** losses * 100,
            drawdown: Math.min(100, losses * risk_percent),
        })),
        doubling_steps_affordable,
    };
};

export type TRiskBand = 'cautious' | 'common' | 'high' | 'very_high';

/**
 * Where a risk-per-trade percentage sits against the 1% to 2% many traders keep to. A description, not advice:
 * it says nothing about whether any trade is a good one. Null for anything that is not a positive number.
 */
export const riskBand = (risk_percent: number): TRiskBand | null => {
    if (!Number.isFinite(risk_percent) || risk_percent <= 0) return null;
    if (risk_percent <= 1) return 'cautious';
    if (risk_percent <= 2) return 'common';
    if (risk_percent <= 5) return 'high';
    return 'very_high';
};

/** How full the gauge is, from 0 to 100, on a scale where 10% of the balance at risk fills it. */
export const riskGaugeFill = (risk_percent: number): number =>
    Number.isFinite(risk_percent) && risk_percent > 0 ? Math.min(100, (risk_percent / 10) * 100) : 0;
