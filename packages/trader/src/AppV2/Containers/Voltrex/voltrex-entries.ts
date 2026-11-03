import { localize } from '@deriv-com/translations';

import type { TScanRow } from './use-voltrex-scanner';
import { evaluateStrategy, TStrategyId } from './voltrex-analysis';
import type { TContractChoice } from './voltrex-products';
import type { TMarketSpecs } from './voltrex-specs';

/**
 * Entry ideas for the contract kinds that follow the scanner's signal: Accumulators (best in a calm, sideways market),
 * Multipliers (a direction, like Rise/Fall) and Touch / No Touch (a barrier set from the recent range). Each idea has a
 * strength from 0 to 100 on the same scale as a signal, so the minimum strength setting applies to all of them.
 */

export type TEntry = { choice: TContractChoice; strength: number; why: string };

export type TEntrySettings = {
    /** Accumulators: the growth rate to use, or null for the lowest the market offers (the widest band). */
    accu_growth: number | null;
    /** Multipliers: the multiplier to use, or null for the smallest the market offers at 10 or more. */
    multiplier: number | null;
    /** Take profit and stop loss, as a percentage of the stake. */
    take_profit_pct: number;
    stop_loss_pct: number;
    /** Longest time to hold an accumulator or multiplier before selling it, in minutes. 0 means no limit. */
    max_hold_minutes: number;
};

export const DEFAULT_ENTRY_SETTINGS: TEntrySettings = {
    accu_growth: null,
    multiplier: null,
    take_profit_pct: 50,
    stop_loss_pct: 50,
    max_hold_minutes: 10,
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const pctText = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

/**
 * Accumulators lose everything when the price leaves a narrow band, so they suit a calm market that is going nowhere:
 * the strength is high when the signal is neutral and the market's volatility is low among its category.
 */
export const accumulatorStrength = (row: TScanRow): number => {
    const signal = row.signal;
    if (!signal) return 0;
    const sideways = 1 - Math.min(1, Math.abs(signal.score) / 0.25);
    const calm = row.volatility_level === 'low' ? 1 : row.volatility_level === 'medium' ? 0.5 : 0; // eslint-disable-line no-nested-ternary
    return Math.round(100 * sideways * calm);
};

export const accumulatorEntry = (
    row: TScanRow,
    specs: TMarketSpecs,
    stake: number,
    settings: TEntrySettings
): TEntry | null => {
    const signal = row.signal;
    if (!signal || !specs.accumulator || !specs.accumulator.growth_rates.length) return null;
    const rates = specs.accumulator.growth_rates;
    const growth =
        settings.accu_growth !== null && rates.includes(settings.accu_growth) ? settings.accu_growth : rates[0];
    const strength = accumulatorStrength(row);
    return {
        choice: {
            product: 'accumulator',
            contract_type: 'ACCU',
            label: localize('Accumulator {{rate}}', { rate: pctText(growth) }),
            growth_rate: growth,
            take_profit: round2((stake * settings.take_profit_pct) / 100),
        },
        strength,
        why: localize('Signal {{direction}} ({{score}}) and {{level}} volatility: the price looks to be ranging.', {
            direction: signal.direction,
            score: signal.score.toFixed(2),
            level: row.volatility_level ?? localize('unknown'),
        }),
    };
};

/** Multipliers follow the strategy's direction like Rise/Fall does: up for a BUY idea, down for a SELL idea. */
export const multiplierEntry = (
    row: TScanRow,
    specs: TMarketSpecs,
    stake: number,
    strategy: TStrategyId,
    settings: TEntrySettings
): TEntry | null => {
    const signal = row.signal;
    if (!signal || !specs.multiplier || !specs.multiplier.multipliers.length) return null;
    const idea = evaluateStrategy(strategy, signal);
    if (!idea) return null;
    const options = specs.multiplier.multipliers;
    const value =
        settings.multiplier !== null && options.includes(settings.multiplier)
            ? settings.multiplier
            : (options.find(item => item >= 10) ?? options[0]);
    const is_up = idea.side === 'CALL';
    return {
        choice: {
            product: 'multiplier',
            contract_type: is_up ? 'MULTUP' : 'MULTDOWN',
            label: is_up
                ? localize('Multiplier ×{{value}} up', { value })
                : localize('Multiplier ×{{value}} down', { value }),
            multiplier: value,
            take_profit: round2((stake * settings.take_profit_pct) / 100),
            stop_loss: round2(Math.min(stake, (stake * settings.stop_loss_pct) / 100)),
        },
        strength: idea.strength,
        why: idea.why,
    };
};

/** The barrier distance a Touch / No Touch trade aims for: where the model puts the chance of a touch at about 30%. */
export const TOUCH_TARGET_PROBABILITY = 0.3;
export const TOUCH_MINUTES = 5;
