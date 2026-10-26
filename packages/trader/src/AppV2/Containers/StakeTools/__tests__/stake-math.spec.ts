import {
    balanceSeries,
    breakEvenWinRate,
    isValidPlan,
    lossesAffordable,
    nextStake,
    percentile,
    round2,
    runPlan,
    seededRandom,
    simulateShortfalls,
    simulateWhatIf,
    summarise,
    TStakePlan,
    winProfit,
} from '../stake-math';

const fixed: TStakePlan = { kind: 'fixed', base_stake: 10, multiplier: 2, step: 1, max_stake: 0 };
const martingale: TStakePlan = { ...fixed, kind: 'martingale' };
const dalembert: TStakePlan = { ...fixed, kind: 'dalembert' };

/** Settles trade n from a fixed list of results. */
const fromList = (results: boolean[]) => (n: number) =>
    n <= results.length ? { won: results[n - 1], detail: undefined } : null;

describe('payout maths', () => {
    it('finds the break-even win rate from the profit on a win', () => {
        expect(breakEvenWinRate(100)).toBe(50);
        expect(breakEvenWinRate(95)).toBeCloseTo(51.282, 3);
        expect(breakEvenWinRate(900)).toBe(10);
    });

    it('rounds payouts to cents the way the platform does', () => {
        expect(winProfit(10, 95)).toBe(9.5);
        expect(winProfit(0.35, 95)).toBe(0.33);
        expect(round2(1.005)).toBe(1.01);
    });
});

describe('nextStake', () => {
    it('keeps a fixed stake', () => {
        expect(nextStake(fixed, 10, null)).toBe(10);
        expect(nextStake(fixed, 10, false)).toBe(10);
    });

    it('multiplies after a loss and resets after a win (martingale)', () => {
        expect(nextStake(martingale, 10, false)).toBe(20);
        expect(nextStake(martingale, 20, false)).toBe(40);
        expect(nextStake(martingale, 40, true)).toBe(10);
    });

    it("steps up after a loss and down after a win, never below the base stake (d'Alembert)", () => {
        expect(nextStake(dalembert, 10, false)).toBe(11);
        expect(nextStake(dalembert, 11, true)).toBe(10);
        expect(nextStake(dalembert, 10, true)).toBe(10);
    });

    it('rounds martingale stakes to two decimals', () => {
        expect(nextStake({ ...martingale, multiplier: 2.1 }, 0.35, false)).toBe(0.74);
    });
});

describe('isValidPlan', () => {
    it('needs a positive stake and the numbers of its own kind', () => {
        expect(isValidPlan(fixed)).toBe(true);
        expect(isValidPlan({ ...fixed, base_stake: 0 })).toBe(false);
        expect(isValidPlan({ ...martingale, multiplier: 0.5 })).toBe(false);
        expect(isValidPlan({ ...dalembert, step: NaN })).toBe(false);
        expect(isValidPlan({ ...fixed, max_stake: -1 })).toBe(false);
    });
});

describe('runPlan', () => {
    const options = { plan: fixed, start_balance: 100, payout_percent: 95 };

    it('settles each purchase and tracks the balance', () => {
        const run = runPlan(options, fromList([true, false, false]));
        expect(run.trades.map(trade => trade.balance)).toEqual([109.5, 99.5, 89.5]);
        expect(run.trades.map(trade => trade.profit)).toEqual([9.5, -10, -10]);
        expect(run.stop_reason).toBe('no_data');
    });

    it('stops at max_trades', () => {
        const run = runPlan({ ...options, max_trades: 2 }, fromList([true, true, true]));
        expect(run.trades).toHaveLength(2);
        expect(run.stop_reason).toBe('finished');
    });

    it('stops when the balance cannot fund the next stake', () => {
        const run = runPlan({ ...options, plan: martingale, start_balance: 25 }, fromList([false, false, false]));
        // stake 10 loses (15 left); the doubled stake of 20 is more than that
        expect(run.trades).toHaveLength(1);
        expect(run.stop_reason).toBe('balance');
    });

    it('stops instead of passing the stake cap', () => {
        const run = runPlan({ ...options, plan: { ...martingale, max_stake: 15 } }, fromList([false, false]));
        expect(run.trades).toHaveLength(1);
        expect(run.stop_reason).toBe('stake_cap');
    });

    it('stops at take profit and at stop loss', () => {
        expect(runPlan({ ...options, take_profit: 9 }, fromList([true, true])).stop_reason).toBe('take_profit');
        const stopped = runPlan({ ...options, stop_loss: 20 }, fromList([false, false, false]));
        expect(stopped.stop_reason).toBe('stop_loss');
        expect(stopped.trades).toHaveLength(2);
    });

    it('treats an empty or zero limit as off', () => {
        const run = runPlan({ ...options, take_profit: 0, stop_loss: NaN }, fromList([true, false]));
        expect(run.stop_reason).toBe('no_data');
    });

    it('multiplies the cost and the profit by the number of contracts', () => {
        const run = runPlan({ ...options, plan: { ...fixed, base_stake: 1 }, contracts: 3 }, fromList([true, false]));
        expect(run.trades.map(trade => trade.cost)).toEqual([3, 3]);
        expect(run.trades.map(trade => trade.profit)).toEqual([2.85, -3]);
    });

    it('passes the detail from settle through to the trade', () => {
        const run = runPlan(options, n => (n === 1 ? { won: true, detail: { exit: '123.45' } } : null));
        expect(run.trades[0].detail).toEqual({ exit: '123.45' });
    });
});

describe('summarise', () => {
    it('reports win rate, profit, drawdown and streaks', () => {
        const run = runPlan(
            { plan: fixed, start_balance: 100, payout_percent: 95 },
            fromList([true, false, false, true, true, true])
        );
        const summary = summarise(run.trades, 100);
        expect(summary.trades).toBe(6);
        expect(summary.wins).toBe(4);
        expect(summary.win_rate).toBeCloseTo(66.67, 1);
        expect(summary.staked).toBe(60);
        expect(summary.profit).toBe(18);
        expect(summary.final_balance).toBe(118);
        // peak 109.5, trough 89.5
        expect(summary.max_drawdown).toBe(20);
        expect(summary.max_drawdown_percent).toBeCloseTo(18.26, 2);
        expect(summary.longest_losing_streak).toBe(2);
        expect(summary.longest_winning_streak).toBe(3);
    });

    it('copes with no trades', () => {
        const summary = summarise([], 100);
        expect(summary.win_rate).toBeNull();
        expect(summary.final_balance).toBe(100);
        expect(balanceSeries([], 100)).toEqual([100]);
    });
});

describe('seededRandom and percentile', () => {
    it('repeats for the same seed and stays inside 0 to 1', () => {
        const a = seededRandom(7);
        const b = seededRandom(7);
        const values = Array.from({ length: 200 }, () => a());
        expect(values).toEqual(Array.from({ length: 200 }, () => b()));
        expect(values.every(value => value >= 0 && value < 1)).toBe(true);
        expect(seededRandom(8)()).not.toBe(seededRandom(7)());
    });

    it('picks a value at a quantile', () => {
        expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
        expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
        expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
        expect(percentile([], 0.5)).toBeNaN();
    });
});

describe('simulateWhatIf', () => {
    const input = { plan: fixed, start_balance: 100, payout_percent: 95, win_rate: 55, trades: 50, runs: 200 };

    it('gives every contract a win at 100%', () => {
        const result = simulateWhatIf({ ...input, win_rate: 100, plan: { ...fixed, base_stake: 1 } });
        expect(result?.median_profit).toBe(47.5);
        expect(result?.chance_of_profit).toBe(100);
        expect(result?.median_max_drawdown).toBe(0);
        expect(result?.sample_path).toHaveLength(51);
    });

    it('loses every contract at 0% and runs out of balance after ten stakes of 10', () => {
        const result = simulateWhatIf({ ...input, win_rate: 0 });
        expect(result?.median_profit).toBe(-100);
        expect(result?.chance_out_of_balance).toBe(100);
        expect(result?.median_trades_before_out_of_balance).toBe(10);
        expect(result?.median_max_drawdown_percent).toBe(100);
    });

    it('works out the expected result of one contract', () => {
        // 0.55 * 9.5 - 0.45 * 10
        expect(simulateWhatIf(input)?.expected_per_trade).toBeCloseTo(0.725, 6);
        expect(simulateWhatIf(input)?.break_even_win_rate).toBeCloseTo(51.282, 3);
    });

    it('gives the same numbers for the same inputs', () => {
        expect(simulateWhatIf(input)).toEqual(simulateWhatIf(input));
    });

    it('does worse as the win rate falls (same random numbers at each rate)', () => {
        const rows = simulateShortfalls({ ...input, runs: 300 });
        expect(rows.map(row => row.win_rate)).toEqual([55, 53, 50, 45, 35]);
        const medians = rows.map(row => row.median_profit);
        expect([...medians].sort((a, b) => b - a)).toEqual(medians);
        expect(rows[rows.length - 1].chance_of_profit).toBeLessThan(rows[0].chance_of_profit);
    });

    it('does not repeat rows when lower win rates are clipped at zero', () => {
        const rows = simulateShortfalls({ ...input, win_rate: 3 });
        expect(rows.map(row => row.win_rate)).toEqual([3, 1, 0]);
    });

    it('gives no rows at all when the assumed win rate itself is not valid', () => {
        expect(simulateShortfalls({ ...input, win_rate: 101 })).toEqual([]);
        expect(simulateShortfalls({ ...input, win_rate: -1 })).toEqual([]);
        expect(simulateShortfalls({ ...input, win_rate: NaN })).toEqual([]);
    });

    it('shows a martingale running out of balance on a bad streak', () => {
        const result = simulateWhatIf({ ...input, plan: martingale, win_rate: 40, trades: 100, runs: 300 });
        expect(result?.chance_out_of_balance).toBeGreaterThan(50);
    });

    it('counts runs that stop at the stake cap', () => {
        const capped = { ...martingale, max_stake: 40 };
        const result = simulateWhatIf({ ...input, plan: capped, win_rate: 50, trades: 100, runs: 300 });
        expect(result?.chance_hit_cap).toBeGreaterThan(0);
    });

    it('returns null for inputs that cannot be simulated', () => {
        expect(simulateWhatIf({ ...input, win_rate: 101 })).toBeNull();
        expect(simulateWhatIf({ ...input, win_rate: NaN })).toBeNull();
        expect(simulateWhatIf({ ...input, start_balance: 0 })).toBeNull();
        expect(simulateWhatIf({ ...input, payout_percent: 0 })).toBeNull();
        expect(simulateWhatIf({ ...input, trades: 0 })).toBeNull();
        expect(simulateWhatIf({ ...input, plan: { ...fixed, base_stake: 0 } })).toBeNull();
    });
});

describe('lossesAffordable', () => {
    it('counts the purchases a balance can pay for if every one loses', () => {
        // 10 + 20 + 40 + 80 = 150 fits in 200, the next 160 does not
        expect(lossesAffordable(martingale, 200)).toEqual({ count: 4, next_stake: 160 });
        expect(lossesAffordable(fixed, 100)).toEqual({ count: 10, next_stake: 10 });
        // 10 + 11 + 12 = 33 fits in 40, the next 13 would bring it to 46
        expect(lossesAffordable(dalembert, 40)).toEqual({ count: 3, next_stake: 13 });
    });

    it('stops at the stake cap', () => {
        expect(lossesAffordable({ ...martingale, max_stake: 30 }, 1000)).toEqual({ count: 2, next_stake: 40 });
    });

    it('multiplies the cost by the contracts bought together', () => {
        expect(lossesAffordable(fixed, 100, 5).count).toBe(2);
    });
});
