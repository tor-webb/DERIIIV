import type { TStakePlan } from '../../StakeTools/stake-math';
import {
    entryRuleMet,
    isValidContractSetup,
    lastDigit,
    settleContract,
    simulateBulk,
    tickSatisfies,
    TTicks,
} from '../bulk-utils';

/** Two-decimal ticks. The last digits are 1, 2, 7, 0, 5, 5, 8, 3 */
const digits_ticks: TTicks = {
    prices: [100.01, 100.12, 100.37, 100.4, 100.55, 100.65, 100.78, 100.83],
    times: [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007],
    pip_size: 2,
};

/** Prices that move: up, down, up, up, flat, down */
const moving_ticks: TTicks = {
    prices: [10, 11, 10.5, 12, 13, 13, 12],
    times: [0, 1, 2, 3, 4, 5, 6],
    pip_size: 2,
};

const fixed_plan: TStakePlan = { kind: 'fixed', base_stake: 10, multiplier: 2, step: 1, max_stake: 0 };
const run_options = { plan: fixed_plan, start_balance: 100, payout_percent: 95 };

describe('lastDigit', () => {
    it('reads the last digit with the market decimals, trailing zero included', () => {
        expect(lastDigit(100.4, 2)).toBe(0);
        expect(lastDigit(1234.5, 2)).toBe(0);
        expect(lastDigit(0.4567, 4)).toBe(7);
        expect(lastDigit(9123, 0)).toBe(3);
    });
});

describe('settleContract: digits', () => {
    // bought after tick 0 with a 1-tick duration, the exit spot is tick 1: 100.12, last digit 2
    const settle = (type: Parameters<typeof settleContract>[0], barrier = 0) =>
        settleContract(type, digits_ticks, 0, 1, barrier)?.won;

    it('settles even and odd on the exit digit', () => {
        expect(settle('DIGITEVEN')).toBe(true);
        expect(settle('DIGITODD')).toBe(false);
    });

    it('settles over and under against the prediction', () => {
        expect(settle('DIGITOVER', 1)).toBe(true);
        expect(settle('DIGITOVER', 2)).toBe(false);
        expect(settle('DIGITUNDER', 3)).toBe(true);
        expect(settle('DIGITUNDER', 2)).toBe(false);
    });

    it('settles matches and differs', () => {
        expect(settle('DIGITMATCH', 2)).toBe(true);
        expect(settle('DIGITMATCH', 3)).toBe(false);
        expect(settle('DIGITDIFF', 2)).toBe(false);
        expect(settle('DIGITDIFF', 9)).toBe(true);
    });

    it('uses the exit tick of a longer contract and reports the spots', () => {
        // bought after tick 0, 3 ticks: entry is tick 1 (100.12), exit is tick 3 (100.40, digit 0)
        const settled = settleContract('DIGITEVEN', digits_ticks, 0, 3, 0);
        expect(settled).toMatchObject({
            won: true,
            entry_index: 1,
            exit_index: 3,
            entry_spot: '100.12',
            exit_spot: '100.40',
            exit_digit: 0,
            exit_time: 1003,
        });
    });

    it('returns null when the ticks run out before the contract ends', () => {
        expect(settleContract('DIGITEVEN', digits_ticks, 6, 2, 0)).toBeNull();
        expect(settleContract('DIGITEVEN', digits_ticks, 6, 1, 0)).not.toBeNull();
        expect(settleContract('DIGITEVEN', digits_ticks, -1, 1, 0)).toBeNull();
    });
});

describe('settleContract: rise and fall', () => {
    it('compares the first tick after the purchase with the exit tick', () => {
        // bought after tick 0, 2 ticks: entry tick 1 = 11, exit tick 2 = 10.5, so Fall wins
        expect(settleContract('CALL', moving_ticks, 0, 2, 0)?.won).toBe(false);
        expect(settleContract('PUT', moving_ticks, 0, 2, 0)?.won).toBe(true);
        // bought after tick 1, 2 ticks: entry 10.5, exit 12, so Rise wins
        expect(settleContract('CALL', moving_ticks, 1, 2, 0)?.won).toBe(true);
    });

    it('loses on a tie, both ways', () => {
        // bought after tick 3, 2 ticks: entry 13, exit 13
        expect(settleContract('CALL', moving_ticks, 3, 2, 0)?.won).toBe(false);
        expect(settleContract('PUT', moving_ticks, 3, 2, 0)?.won).toBe(false);
    });
});

describe('isValidContractSetup', () => {
    it('applies the platform minimums and prediction ranges', () => {
        expect(isValidContractSetup('CALL', 5, 0)).toBe(true);
        expect(isValidContractSetup('CALL', 4, 0)).toBe(false);
        expect(isValidContractSetup('DIGITEVEN', 1, 0)).toBe(true);
        expect(isValidContractSetup('DIGITEVEN', 11, 0)).toBe(false);
        expect(isValidContractSetup('DIGITEVEN', 1.5, 0)).toBe(false);
        expect(isValidContractSetup('DIGITOVER', 1, 9)).toBe(false);
        expect(isValidContractSetup('DIGITOVER', 1, 8)).toBe(true);
        expect(isValidContractSetup('DIGITUNDER', 1, 0)).toBe(false);
        expect(isValidContractSetup('DIGITMATCH', 1, NaN)).toBe(false);
    });
});

describe('entry rules', () => {
    // digits 1 2 7 0 5 5 8 3 -> even? F T F T F F T F
    it('counts ticks that satisfy the contract', () => {
        expect(tickSatisfies('DIGITEVEN', digits_ticks, 1, 0)).toBe(true);
        expect(tickSatisfies('DIGITEVEN', digits_ticks, 2, 0)).toBe(false);
        expect(tickSatisfies('CALL', moving_ticks, 1, 0)).toBe(true);
        expect(tickSatisfies('CALL', moving_ticks, 0, 0)).toBe(false);
        expect(tickSatisfies('PUT', moving_ticks, 2, 0)).toBe(true);
    });

    it('always fires for "always"', () => {
        expect(entryRuleMet({ kind: 'always', length: 3 }, 'DIGITEVEN', digits_ticks, 0, 0)).toBe(true);
    });

    it('waits for a run of misses or hits', () => {
        const misses = { kind: 'after_misses' as const, length: 2 };
        // Even misses at ticks 4 and 5 (digits 5, 5)
        expect(entryRuleMet(misses, 'DIGITEVEN', digits_ticks, 5, 0)).toBe(true);
        expect(entryRuleMet(misses, 'DIGITEVEN', digits_ticks, 4, 0)).toBe(false);
        // not enough ticks yet
        expect(entryRuleMet(misses, 'DIGITEVEN', digits_ticks, 1, 0)).toBe(false);

        const hits = { kind: 'after_hits' as const, length: 2 };
        expect(entryRuleMet(hits, 'DIGITEVEN', digits_ticks, 3, 0)).toBe(false);
        expect(entryRuleMet({ kind: 'after_hits', length: 1 }, 'DIGITEVEN', digits_ticks, 3, 0)).toBe(true);
    });
});

describe('simulateBulk', () => {
    it('buys again as soon as each contract ends and settles every one on real ticks', () => {
        const result = simulateBulk({
            ticks: digits_ticks,
            type: 'DIGITEVEN',
            barrier: 0,
            duration: 1,
            entry: { kind: 'always', length: 1 },
            run: run_options,
        });
        // exit ticks 1..7 have digits 2 7 0 5 5 8 3 -> win loss win loss loss win loss
        expect(result.trades.map(trade => trade.won)).toEqual([true, false, true, false, false, true, false]);
        expect(result.trades.map(trade => trade.detail.exit_index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(result.stop_reason).toBe('no_data');
        expect(result.ticks_used).toBe(8);
        // 3 wins of 9.5 and 4 losses of 10
        expect(result.trades[result.trades.length - 1].balance).toBe(88.5);
    });

    it('spaces purchases by the contract length', () => {
        const result = simulateBulk({
            ticks: digits_ticks,
            type: 'DIGITEVEN',
            barrier: 0,
            duration: 3,
            entry: { kind: 'always', length: 1 },
            run: run_options,
        });
        // bought after tick 0 -> exit 3; after tick 3 -> exit 6; after tick 6 there is no exit tick 9
        expect(result.trades.map(trade => trade.detail.exit_index)).toEqual([3, 6]);
    });

    it('skips ticks until the entry rule fires', () => {
        const result = simulateBulk({
            ticks: digits_ticks,
            type: 'DIGITEVEN',
            barrier: 0,
            duration: 1,
            entry: { kind: 'after_misses', length: 2 },
            run: { ...run_options, max_trades: 1 },
        });
        // first run of two odd digits ends at tick 5, so the contract is bought after tick 5 and exits on tick 6 (8)
        expect(result.trades).toHaveLength(1);
        expect(result.trades[0].detail.entry_index).toBe(6);
        expect(result.trades[0].won).toBe(true);
        expect(result.stop_reason).toBe('finished');
    });

    it('settles bulk-size contracts together', () => {
        const result = simulateBulk({
            ticks: digits_ticks,
            type: 'DIGITEVEN',
            barrier: 0,
            duration: 1,
            entry: { kind: 'always', length: 1 },
            run: { ...run_options, contracts: 5, max_trades: 2 },
        });
        expect(result.trades.map(trade => trade.cost)).toEqual([50, 50]);
        // first wins 5 x 9.5, second loses 5 x 10
        expect(result.trades.map(trade => trade.profit)).toEqual([47.5, -50]);
    });

    it('stops when the stake plan runs out of balance', () => {
        const result = simulateBulk({
            ticks: digits_ticks,
            type: 'DIGITODD',
            barrier: 0,
            duration: 1,
            entry: { kind: 'always', length: 1 },
            run: { ...run_options, start_balance: 15 },
        });
        // first odd bet loses on digit 2 (balance 5), then the next stake of 10 cannot be paid
        expect(result.trades).toHaveLength(1);
        expect(result.stop_reason).toBe('balance');
    });

    it('returns no trades when the entry rule never fires', () => {
        const result = simulateBulk({
            ticks: digits_ticks,
            type: 'DIGITEVEN',
            barrier: 0,
            duration: 1,
            entry: { kind: 'after_hits', length: 5 },
            run: run_options,
        });
        expect(result.trades).toHaveLength(0);
        expect(result.stop_reason).toBe('no_data');
        expect(result.ticks_used).toBe(0);
    });
});
