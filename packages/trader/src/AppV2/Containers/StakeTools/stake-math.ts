/**
 * Stake-plan maths shared by the Bulk Trader simulator and the What-if calculator.
 *
 * Pure functions only: no network, no React. Randomness only enters through a random source that the caller passes in,
 * so every result can be reproduced from a seed.
 *
 * Both tools settle trades through `runPlan`, so a stake plan, a stop rule or a payout is treated the same way in the
 * simulator (outcomes come from real ticks) and in the calculator (outcomes come from a win rate the user typed).
 */

export type TPlanKind = 'fixed' | 'martingale' | 'dalembert';

export type TStakePlan = {
    kind: TPlanKind;
    base_stake: number;
    /** Martingale: the stake is multiplied by this after a loss. */
    multiplier: number;
    /** D'Alembert: the stake goes up by this after a loss and down by this after a win (never below the base stake). */
    step: number;
    /** The plan stops instead of staking more than this. 0 means no cap. */
    max_stake: number;
};

export type TRunOptions = {
    plan: TStakePlan;
    start_balance: number;
    /** Profit as a % of the stake when a contract wins, for example 95. */
    payout_percent: number;
    /** Contracts bought together at each purchase. They settle on the same ticks, so they win or lose together. */
    contracts?: number;
    /** Stop once the total profit reaches this. 0 or empty means off. */
    take_profit?: number;
    /** Stop once the total loss reaches this. 0 or empty means off. */
    stop_loss?: number;
    /** Stop after this many purchases. Empty means no limit (the data source decides when it ends). */
    max_trades?: number;
};

export type TTrade<T = undefined> = {
    /** 1 for the first purchase. */
    number: number;
    /** Stake per contract. */
    stake: number;
    contracts: number;
    /** What the purchase cost: stake times contracts. */
    cost: number;
    won: boolean;
    /** Money made (positive) or lost (negative) on this purchase. */
    profit: number;
    /** Account balance after this purchase. */
    balance: number;
    detail: T;
};

export type TStopReason = 'finished' | 'no_data' | 'balance' | 'stake_cap' | 'take_profit' | 'stop_loss';

export type TRun<T = undefined> = {
    trades: TTrade<T>[];
    stop_reason: TStopReason;
};

export type TSettled<T> = { won: boolean; detail: T };

/** Rounds to cents. The platform rejects stakes with more than two decimals, and payouts are paid in cents. */
export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** The share of contracts you must win just to break even, in %. It is the same for every stake plan. */
export const breakEvenWinRate = (payout_percent: number) => 100 / (1 + payout_percent / 100);

/** Profit when a purchase of `cost` wins. The payout is rounded to cents, as it is on the platform. */
export const winProfit = (cost: number, payout_percent: number) =>
    round2(round2(cost * (1 + payout_percent / 100)) - cost);

/** The stake for the next purchase. `last_won` is `null` before the first purchase. */
export const nextStake = (plan: TStakePlan, current_stake: number, last_won: boolean | null): number => {
    if (last_won === null) return round2(plan.base_stake);
    if (plan.kind === 'martingale') return last_won ? round2(plan.base_stake) : round2(current_stake * plan.multiplier);
    if (plan.kind === 'dalembert') {
        return last_won
            ? round2(Math.max(plan.base_stake, current_stake - plan.step))
            : round2(current_stake + plan.step);
    }
    return round2(plan.base_stake);
};

const isPositive = (value: number) => Number.isFinite(value) && value > 0;

/** `true` when the plan has every number it needs. */
export const isValidPlan = (plan: TStakePlan) => {
    if (!isPositive(plan.base_stake) || !Number.isFinite(plan.max_stake) || plan.max_stake < 0) return false;
    if (plan.kind === 'martingale') return isPositive(plan.multiplier) && plan.multiplier >= 1;
    if (plan.kind === 'dalembert') return isPositive(plan.step);
    return true;
};

const limitIsOn = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value > 0;

/**
 * Runs a stake plan one purchase at a time. `settle` says whether purchase number `n` wins, or returns `null` when
 * there is no data left. The run stops on the first of: no data, not enough balance for the next stake, the stake cap,
 * take profit, stop loss, or `max_trades`.
 */
export const runPlan = <T>(options: TRunOptions, settle: (trade_number: number) => TSettled<T> | null): TRun<T> => {
    const { plan, start_balance, payout_percent, contracts = 1, take_profit, stop_loss, max_trades } = options;
    const trades: TTrade<T>[] = [];
    const trade_limit = limitIsOn(max_trades) ? max_trades : Infinity;

    let balance = start_balance;
    let stake = nextStake(plan, 0, null);
    let stop_reason: TStopReason = 'finished';

    while (trades.length < trade_limit) {
        if (plan.max_stake > 0 && stake > plan.max_stake) {
            stop_reason = 'stake_cap';
            break;
        }
        const cost = round2(stake * contracts);
        if (!(stake > 0) || cost > balance) {
            stop_reason = 'balance';
            break;
        }
        const outcome = settle(trades.length + 1);
        if (!outcome) {
            stop_reason = 'no_data';
            break;
        }

        const profit = outcome.won ? winProfit(cost, payout_percent) : -cost;
        balance = round2(balance + profit);
        trades.push({
            number: trades.length + 1,
            stake,
            contracts,
            cost,
            won: outcome.won,
            profit,
            balance,
            detail: outcome.detail,
        });

        const total = round2(balance - start_balance);
        if (limitIsOn(take_profit) && total >= take_profit) {
            stop_reason = 'take_profit';
            break;
        }
        if (limitIsOn(stop_loss) && -total >= stop_loss) {
            stop_reason = 'stop_loss';
            break;
        }
        stake = nextStake(plan, stake, outcome.won);
    }

    return { trades, stop_reason };
};

export type TSummary = {
    trades: number;
    wins: number;
    losses: number;
    /** In %. `null` when nothing was traded. */
    win_rate: number | null;
    /** The sum of everything the purchases cost. */
    staked: number;
    profit: number;
    final_balance: number;
    peak_balance: number;
    /** The biggest fall from a peak, in money. */
    max_drawdown: number;
    /** That same fall as a % of the peak it fell from. */
    max_drawdown_percent: number;
    longest_losing_streak: number;
    longest_winning_streak: number;
};

export const summarise = (trades: TTrade<unknown>[], start_balance: number): TSummary => {
    let wins = 0;
    let staked = 0;
    let peak = start_balance;
    let max_drawdown = 0;
    let max_drawdown_percent = 0;
    let losing_streak = 0;
    let winning_streak = 0;
    let longest_losing_streak = 0;
    let longest_winning_streak = 0;

    trades.forEach(trade => {
        staked += trade.cost;
        if (trade.won) {
            wins += 1;
            winning_streak += 1;
            losing_streak = 0;
        } else {
            losing_streak += 1;
            winning_streak = 0;
        }
        longest_losing_streak = Math.max(longest_losing_streak, losing_streak);
        longest_winning_streak = Math.max(longest_winning_streak, winning_streak);

        peak = Math.max(peak, trade.balance);
        const drawdown = peak - trade.balance;
        if (drawdown > max_drawdown) {
            max_drawdown = drawdown;
            max_drawdown_percent = peak > 0 ? (drawdown / peak) * 100 : 0;
        }
    });

    const final_balance = trades.length ? trades[trades.length - 1].balance : start_balance;
    return {
        trades: trades.length,
        wins,
        losses: trades.length - wins,
        win_rate: trades.length ? (wins / trades.length) * 100 : null,
        staked: round2(staked),
        profit: round2(final_balance - start_balance),
        final_balance,
        peak_balance: peak,
        max_drawdown: round2(max_drawdown),
        max_drawdown_percent,
        longest_losing_streak,
        longest_winning_streak,
    };
};

/** Balance after every purchase, starting with the opening balance. */
export const balanceSeries = (trades: TTrade<unknown>[], start_balance: number) => [
    start_balance,
    ...trades.map(trade => trade.balance),
];

export type TLossesAffordable = {
    /** How many purchases in a row the balance can pay for if every one loses. */
    count: number;
    /** What the stake would be on the purchase after those, which the plan cannot afford or is capped from placing. */
    next_stake: number;
};

const MAX_COUNTED_LOSSES = 1000;

/** How long a run of losses the plan can survive, from the opening balance. Exact: no randomness. */
export const lossesAffordable = (plan: TStakePlan, balance: number, contracts = 1): TLossesAffordable => {
    let stake = nextStake(plan, 0, null);
    let spent = 0;
    let count = 0;
    while (count < MAX_COUNTED_LOSSES) {
        if (plan.max_stake > 0 && stake > plan.max_stake) break;
        const cost = round2(stake * contracts);
        if (round2(spent + cost) > balance) break;
        spent = round2(spent + cost);
        count += 1;
        stake = nextStake(plan, stake, false);
    }
    return { count, next_stake: stake };
};

/* ------------------------------ What-if (win rate as an input) ------------------------------ */

/** A small seeded random source (mulberry32), so the same inputs always give the same numbers. */
export const seededRandom = (seed: number) => {
    let state = seed >>> 0; // eslint-disable-line no-bitwise
    return () => {
        /* eslint-disable no-bitwise */
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        /* eslint-enable no-bitwise */
    };
};

/** The value at quantile `q` (0 to 1) of an ascending list. */
export const percentile = (sorted: number[], q: number) => {
    if (!sorted.length) return NaN;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
};

export type TWhatIfInput = {
    plan: TStakePlan;
    start_balance: number;
    payout_percent: number;
    /** The win rate the user typed, in %. An assumption, never a forecast. */
    win_rate: number;
    /** Purchases per simulated run. */
    trades: number;
    /** Simulated runs. */
    runs: number;
    contracts?: number;
    take_profit?: number;
    stop_loss?: number;
    seed?: number;
};

export type TWhatIf = {
    win_rate: number;
    break_even_win_rate: number;
    /** Expected result of one contract at the base stake: win chance times the win, minus loss chance times the stake. */
    expected_per_trade: number;
    median_profit: number;
    /** 5 in 100 runs ended worse than this. */
    p5_profit: number;
    /** 5 in 100 runs ended better than this. */
    p95_profit: number;
    /** % of runs that ended above the opening balance. */
    chance_of_profit: number;
    /** % of runs that could no longer fund the next stake. */
    chance_out_of_balance: number;
    /** % of runs that stopped because the next stake was above the cap. */
    chance_hit_cap: number;
    median_max_drawdown: number;
    median_max_drawdown_percent: number;
    /** 5 in 100 runs had a deeper fall than this, in % of the peak. */
    p95_max_drawdown_percent: number;
    /** Among runs that ran out of balance, the middle number of purchases made before it. `null` if none did. */
    median_trades_before_out_of_balance: number | null;
    /** Balance after every purchase of the run that ended closest to the median profit. */
    sample_path: number[];
};

const DEFAULT_SEED = 20261026;

const simulateRun = (input: TWhatIfInput, run_index: number) => {
    const random = seededRandom((input.seed ?? DEFAULT_SEED) + run_index * 7919);
    const win_chance = input.win_rate / 100;
    return runPlan(
        {
            plan: input.plan,
            start_balance: input.start_balance,
            payout_percent: input.payout_percent,
            contracts: input.contracts,
            take_profit: input.take_profit,
            stop_loss: input.stop_loss,
            max_trades: input.trades,
        },
        () => ({ won: random() < win_chance, detail: undefined })
    );
};

/**
 * Plays the stake plan `runs` times at the win rate the user typed. Each run uses the same random numbers whatever the
 * win rate, so a table of lower win rates compares like with like.
 */
export const simulateWhatIf = (input: TWhatIfInput): TWhatIf | null => {
    const { plan, start_balance, payout_percent, win_rate, trades, runs, contracts = 1 } = input;
    if (!isValidPlan(plan) || !isPositive(start_balance) || !isPositive(payout_percent)) return null;
    if (!Number.isFinite(win_rate) || win_rate < 0 || win_rate > 100) return null;
    if (!Number.isInteger(trades) || trades < 1 || !Number.isInteger(runs) || runs < 1 || !isPositive(contracts)) {
        return null;
    }

    const profits: { profit: number; run: number }[] = [];
    const drawdowns: number[] = [];
    const drawdown_percents: number[] = [];
    const trades_before_out_of_balance: number[] = [];
    let out_of_balance = 0;
    let hit_cap = 0;
    let in_profit = 0;

    for (let run = 0; run < runs; run += 1) {
        const result = simulateRun(input, run);
        const summary = summarise(result.trades, start_balance);
        profits.push({ profit: summary.profit, run });
        drawdowns.push(summary.max_drawdown);
        drawdown_percents.push(summary.max_drawdown_percent);
        if (summary.profit > 0) in_profit += 1;
        if (result.stop_reason === 'balance') {
            out_of_balance += 1;
            trades_before_out_of_balance.push(summary.trades);
        }
        if (result.stop_reason === 'stake_cap') hit_cap += 1;
    }

    const sorted_profits = profits.map(item => item.profit).sort((a, b) => a - b);
    const median_profit = percentile(sorted_profits, 0.5);
    const median_run = profits.reduce((best, item) =>
        Math.abs(item.profit - median_profit) < Math.abs(best.profit - median_profit) ? item : best
    );
    const sample = simulateRun(input, median_run.run);

    const win_chance = win_rate / 100;
    const profit_if_win = winProfit(plan.base_stake, payout_percent);
    const sorted_percents = [...drawdown_percents].sort((a, b) => a - b);

    return {
        win_rate,
        break_even_win_rate: breakEvenWinRate(payout_percent),
        expected_per_trade: win_chance * profit_if_win - (1 - win_chance) * plan.base_stake,
        median_profit,
        p5_profit: percentile(sorted_profits, 0.05),
        p95_profit: percentile(sorted_profits, 0.95),
        chance_of_profit: (in_profit / runs) * 100,
        chance_out_of_balance: (out_of_balance / runs) * 100,
        chance_hit_cap: (hit_cap / runs) * 100,
        median_max_drawdown: percentile(
            [...drawdowns].sort((a, b) => a - b),
            0.5
        ),
        median_max_drawdown_percent: percentile(sorted_percents, 0.5),
        p95_max_drawdown_percent: percentile(sorted_percents, 0.95),
        median_trades_before_out_of_balance: trades_before_out_of_balance.length
            ? percentile(
                  [...trades_before_out_of_balance].sort((a, b) => a - b),
                  0.5
              )
            : null,
        sample_path: balanceSeries(sample.trades, start_balance),
    };
};

/** How many points below the assumed win rate the table checks. */
export const SHORTFALLS = [0, 2, 5, 10, 20];

/** The same plan played at the assumed win rate and at lower ones, to show how fast it loses when the rate falls short. */
export const simulateShortfalls = (input: TWhatIfInput, shortfalls: number[] = SHORTFALLS) => {
    const seen = new Set<number>();
    const rows: (TWhatIf & { shortfall: number })[] = [];
    // lower rates can be valid while the one the user typed is not, and a row must never pass for the assumed rate
    if (!Number.isFinite(input.win_rate) || input.win_rate < 0 || input.win_rate > 100) return rows;
    shortfalls.forEach(shortfall => {
        const win_rate = Math.max(0, Math.round((input.win_rate - shortfall) * 100) / 100);
        if (seen.has(win_rate)) return;
        seen.add(win_rate);
        const result = simulateWhatIf({ ...input, win_rate });
        if (result) rows.push({ ...result, shortfall: Math.round((input.win_rate - win_rate) * 100) / 100 });
    });
    return rows;
};
