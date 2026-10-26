/**
 * Settles tick contracts against a list of real ticks. Pure functions: the ticks come from `bulk-api.ts`.
 *
 * Timing convention (the same one Deriv uses for tick contracts): a contract bought after tick `i` has its entry spot
 * at tick `i + 1` (the first tick after the purchase) and its exit spot at tick `i + duration`. A 5-tick contract
 * therefore covers ticks 1 to 5 after the purchase, and Rise/Fall compares the 1st with the 5th.
 * This convention is NOT yet confirmed against a live contract: see "Not verified" in docs/HANDOFF.md.
 *
 * Rise and Fall lose on a tie (exit equal to entry). Digit contracts look only at the last digit of the exit spot,
 * read with the market's own number of decimals, so a trailing zero counts.
 */

import { runPlan, TRunOptions, TStopReason, TTrade } from '../StakeTools/stake-math';

export type TContractType =
    | 'CALL'
    | 'PUT'
    | 'DIGITEVEN'
    | 'DIGITODD'
    | 'DIGITOVER'
    | 'DIGITUNDER'
    | 'DIGITMATCH'
    | 'DIGITDIFF';

export type TContractRule = {
    value: TContractType;
    /** Digit contracts that need a prediction (0 to 9). */
    needs_barrier: boolean;
    /** Lowest and highest prediction the platform accepts. */
    barrier_range: [number, number];
    /** Shortest duration in ticks the platform offers. */
    min_ticks: number;
};

export const CONTRACT_RULES: TContractRule[] = [
    { value: 'CALL', needs_barrier: false, barrier_range: [0, 0], min_ticks: 5 },
    { value: 'PUT', needs_barrier: false, barrier_range: [0, 0], min_ticks: 5 },
    { value: 'DIGITEVEN', needs_barrier: false, barrier_range: [0, 0], min_ticks: 1 },
    { value: 'DIGITODD', needs_barrier: false, barrier_range: [0, 0], min_ticks: 1 },
    { value: 'DIGITOVER', needs_barrier: true, barrier_range: [0, 8], min_ticks: 1 },
    { value: 'DIGITUNDER', needs_barrier: true, barrier_range: [1, 9], min_ticks: 1 },
    { value: 'DIGITMATCH', needs_barrier: true, barrier_range: [0, 9], min_ticks: 1 },
    { value: 'DIGITDIFF', needs_barrier: true, barrier_range: [0, 9], min_ticks: 1 },
];

export const getContractRule = (type: TContractType) => CONTRACT_RULES.find(rule => rule.value === type)!;

export const MAX_DURATION_TICKS = 10;

/** `true` when the duration and prediction are ones the platform would accept for this contract. */
export const isValidContractSetup = (type: TContractType, duration: number, barrier: number) => {
    const rule = getContractRule(type);
    if (!Number.isInteger(duration) || duration < rule.min_ticks || duration > MAX_DURATION_TICKS) return false;
    if (!rule.needs_barrier) return true;
    return Number.isInteger(barrier) && barrier >= rule.barrier_range[0] && barrier <= rule.barrier_range[1];
};

export type TTicks = {
    prices: number[];
    /** Epoch seconds, one per price. */
    times: number[];
    /** Decimals the market quotes, so 100.1 on a 2-decimal market reads as 100.10. */
    pip_size: number;
};

export const lastDigit = (price: number, pip_size: number) => Number(price.toFixed(pip_size).slice(-1));

const spot = (ticks: TTicks, index: number) => ticks.prices[index].toFixed(ticks.pip_size);

const digitWins = (type: TContractType, digit: number, barrier: number) => {
    switch (type) {
        case 'DIGITEVEN':
            return digit % 2 === 0;
        case 'DIGITODD':
            return digit % 2 === 1;
        case 'DIGITOVER':
            return digit > barrier;
        case 'DIGITUNDER':
            return digit < barrier;
        case 'DIGITMATCH':
            return digit === barrier;
        case 'DIGITDIFF':
            return digit !== barrier;
        default:
            return false;
    }
};

export type TSettledContract = {
    won: boolean;
    entry_index: number;
    exit_index: number;
    entry_spot: string;
    exit_spot: string;
    exit_digit: number;
    /** Epoch seconds of the exit tick. */
    exit_time: number;
};

/** Settles one contract bought after tick `purchase_index`. Returns `null` if the ticks run out before it ends. */
export const settleContract = (
    type: TContractType,
    ticks: TTicks,
    purchase_index: number,
    duration: number,
    barrier: number
): TSettledContract | null => {
    const entry_index = purchase_index + 1;
    const exit_index = purchase_index + duration;
    if (purchase_index < 0 || exit_index >= ticks.prices.length) return null;

    const entry = ticks.prices[entry_index];
    const exit = ticks.prices[exit_index];
    const exit_digit = lastDigit(exit, ticks.pip_size);

    let won: boolean;
    if (type === 'CALL') won = exit > entry;
    else if (type === 'PUT') won = exit < entry;
    else won = digitWins(type, exit_digit, barrier);

    return {
        won,
        entry_index,
        exit_index,
        entry_spot: spot(ticks, entry_index),
        exit_spot: spot(ticks, exit_index),
        exit_digit,
        exit_time: ticks.times[exit_index],
    };
};

/**
 * Whether tick `index` on its own would have satisfied the contract: a rise for Rise, an even last digit for Even,
 * and so on. The entry rules below use this to count runs of ticks.
 */
export const tickSatisfies = (type: TContractType, ticks: TTicks, index: number, barrier: number) => {
    if (type === 'CALL') return index >= 1 && ticks.prices[index] > ticks.prices[index - 1];
    if (type === 'PUT') return index >= 1 && ticks.prices[index] < ticks.prices[index - 1];
    return digitWins(type, lastDigit(ticks.prices[index], ticks.pip_size), barrier);
};

export type TEntryRule = {
    /** `always`: buy as soon as the last contract has ended. `after_hits` / `after_misses`: wait for a run of ticks. */
    kind: 'always' | 'after_hits' | 'after_misses';
    /** How many ticks in a row the run must last. */
    length: number;
};

export const entryRuleMet = (rule: TEntryRule, type: TContractType, ticks: TTicks, index: number, barrier: number) => {
    if (rule.kind === 'always') return true;
    if (index < rule.length) return false;
    const wanted = rule.kind === 'after_hits';
    for (let tick = index - rule.length + 1; tick <= index; tick += 1) {
        if (tickSatisfies(type, ticks, tick, barrier) !== wanted) return false;
    }
    return true;
};

export type TBulkInput = {
    ticks: TTicks;
    type: TContractType;
    /** Digit prediction. Ignored for Rise and Fall, Even and Odd. */
    barrier: number;
    /** Contract length in ticks. */
    duration: number;
    entry: TEntryRule;
    /** Stake plan, balance, payout and stop rules. `contracts` is the bulk size. */
    run: TRunOptions;
};

export type TBulkResult = {
    trades: TTrade<TSettledContract>[];
    stop_reason: TStopReason;
    /** How many of the ticks the run got through, up to the exit of the last contract. */
    ticks_used: number;
};

/** Buys when the entry rule fires, waits for the contract to end, then looks for the next entry, until the ticks end. */
export const simulateBulk = ({ ticks, type, barrier, duration, entry, run }: TBulkInput): TBulkResult => {
    // the index of the last tick seen. A new contract can be bought as soon as the last one has ended.
    let cursor = 0;

    const result = runPlan<TSettledContract>(run, () => {
        for (let index = cursor; index + duration < ticks.prices.length; index += 1) {
            if (entryRuleMet(entry, type, ticks, index, barrier)) {
                const settled = settleContract(type, ticks, index, duration, barrier);
                if (!settled) return null;
                cursor = settled.exit_index;
                return { won: settled.won, detail: settled };
            }
        }
        return null;
    });

    const last = result.trades[result.trades.length - 1];
    return { ...result, ticks_used: last ? last.detail.exit_index + 1 : 0 };
};
