import type { TScanRow } from '../use-voltrex-scanner';
import { analyseMarket } from '../voltrex-analysis';
import { accumulatorEntry, accumulatorStrength, DEFAULT_ENTRY_SETTINGS, multiplierEntry } from '../voltrex-entries';
import { EMPTY_SPECS, TMarketSpecs } from '../voltrex-specs';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const candles = (up: boolean) =>
    Array.from({ length: 120 }, (_item, index) => {
        const close = up ? 100 + index + 0.03 * index ** 2 : 400 - index - 0.03 * index ** 2;
        return { epoch: index * 300, open: close, high: close + 0.2, low: close - 0.2, close };
    });

const flat = Array.from({ length: 120 }, (_item, index) => {
    const close = 100 + Math.sin(index) * 0.01;
    return { epoch: index * 300, open: close, high: close + 0.01, low: close - 0.01, close };
});

const row = (up: boolean, level: TScanRow['volatility_level'] = 'medium', sideways = false): TScanRow =>
    ({
        symbol: 'R_100',
        name: 'R_100',
        category: 'volatility',
        status: 'ready',
        signal: sideways ? analyseMarket(flat, flat) : analyseMarket(candles(up), candles(up)),
        volatility_level: level,
    }) as TScanRow;

const specs: TMarketSpecs = {
    ...EMPTY_SPECS,
    accumulator: { growth_rates: [0.01, 0.02, 0.03] },
    multiplier: { multipliers: [5, 10, 20] },
};

describe('accumulatorStrength', () => {
    it('is zero for a trending market and for high volatility', () => {
        expect(accumulatorStrength(row(true, 'low'))).toBe(0);
        expect(accumulatorStrength(row(true, 'high', true))).toBe(0);
    });

    it('is highest for a calm, sideways market', () => {
        const neutral = (level: TScanRow['volatility_level']) => {
            const base = row(true, level);
            return { ...base, signal: { ...base.signal, score: 0 } } as TScanRow;
        };
        expect(accumulatorStrength(neutral('low'))).toBe(100);
        expect(accumulatorStrength(neutral('medium'))).toBe(50);
        expect(accumulatorStrength(neutral('high'))).toBe(0);
    });

    it('is zero with no signal', () => {
        expect(accumulatorStrength({ ...row(true), signal: null })).toBe(0);
    });
});

describe('accumulatorEntry', () => {
    it('uses the lowest growth rate unless a setting picks another the market offers', () => {
        expect(accumulatorEntry(row(true, 'low', true), specs, 10, DEFAULT_ENTRY_SETTINGS)?.choice.growth_rate).toBe(
            0.01
        );
        const picked = accumulatorEntry(row(true, 'low', true), specs, 10, {
            ...DEFAULT_ENTRY_SETTINGS,
            accu_growth: 0.03,
        });
        expect(picked?.choice.growth_rate).toBe(0.03);
        const missing = accumulatorEntry(row(true, 'low', true), specs, 10, {
            ...DEFAULT_ENTRY_SETTINGS,
            accu_growth: 0.04,
        });
        expect(missing?.choice.growth_rate).toBe(0.01);
    });

    it('sets take profit as a share of the stake', () => {
        expect(accumulatorEntry(row(true, 'low', true), specs, 10, DEFAULT_ENTRY_SETTINGS)?.choice.take_profit).toBe(5);
    });

    it('gives nothing when the market has no accumulators', () => {
        expect(accumulatorEntry(row(true), EMPTY_SPECS, 10, DEFAULT_ENTRY_SETTINGS)).toBeNull();
    });
});

describe('multiplierEntry', () => {
    it('goes up on a buy idea and down on a sell idea', () => {
        expect(multiplierEntry(row(true), specs, 10, 'confluence', DEFAULT_ENTRY_SETTINGS)?.choice.contract_type).toBe(
            'MULTUP'
        );
        expect(multiplierEntry(row(false), specs, 10, 'confluence', DEFAULT_ENTRY_SETTINGS)?.choice.contract_type).toBe(
            'MULTDOWN'
        );
    });

    it('picks the smallest multiplier of 10 or more, and caps the stop loss at the stake', () => {
        const entry = multiplierEntry(row(true), specs, 10, 'confluence', {
            ...DEFAULT_ENTRY_SETTINGS,
            stop_loss_pct: 300,
        });
        expect(entry?.choice.multiplier).toBe(10);
        expect(entry?.choice.stop_loss).toBe(10);
    });

    it('gives nothing without multipliers or without an idea', () => {
        expect(multiplierEntry(row(true), EMPTY_SPECS, 10, 'confluence', DEFAULT_ENTRY_SETTINGS)).toBeNull();
        expect(multiplierEntry(row(true, 'medium', true), specs, 10, 'confluence', DEFAULT_ENTRY_SETTINGS)).toBeNull();
    });
});
