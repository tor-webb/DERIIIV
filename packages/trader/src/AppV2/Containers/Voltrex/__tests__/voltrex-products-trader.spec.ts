import type { TContractChoice } from '../voltrex-products';
import { DEFAULT_RISK, emptyRiskState } from '../voltrex-risk';
import { EMPTY_SPECS, TMarketSpecs } from '../voltrex-specs';
import { TOrder, validateChoice, VoltrexTrader } from '../voltrex-trader';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const SPECS: TMarketSpecs = {
    ...EMPTY_SPECS,
    digits: { types: ['DIGITOVER', 'DIGITEVEN'], ticks: { min: 1, max: 10 } },
    touch: { ticks: null, minutes: { min: 2, max: 60 } },
    accumulator: { growth_rates: [0.01, 0.02] },
    multiplier: { multipliers: [10, 20] },
};

const digit = (contract_type: string, barrier?: string, duration = 1): TContractChoice => ({
    product: 'over_under',
    contract_type,
    label: 'x',
    barrier,
    duration,
    duration_unit: 't',
});

describe('validateChoice', () => {
    it('accepts a good digit choice and refuses bad digits and tick counts', () => {
        expect(validateChoice(SPECS, digit('DIGITOVER', '4'), 1)).toBeNull();
        expect(validateChoice(SPECS, digit('DIGITOVER', '9'), 1)).toMatch(/Over needs/);
        expect(validateChoice(SPECS, digit('DIGITUNDER', '0'), 1)).toMatch(/Under needs/);
        expect(validateChoice(SPECS, digit('DIGITOVER', '12'), 1)).toMatch(/0 to 9/);
        expect(validateChoice(SPECS, digit('DIGITOVER', '4', 50), 1)).toMatch(/ticks/);
        expect(validateChoice(SPECS, digit('DIGITEVEN'), 1)).toBeNull();
    });

    it('refuses a digit trade on a market with no digit contracts', () => {
        expect(validateChoice(EMPTY_SPECS, digit('DIGITEVEN'), 1)).toMatch(/ticks/);
    });

    it('checks the touch barrier and duration', () => {
        const touch = (barrier: string, duration: number): TContractChoice => ({
            product: 'touch',
            contract_type: 'ONETOUCH',
            label: 'x',
            barrier,
            duration,
            duration_unit: 'm',
        });
        expect(validateChoice(SPECS, touch('+0.52', 5), 1)).toBeNull();
        expect(validateChoice(SPECS, touch('abc', 5), 1)).toMatch(/barrier/);
        expect(validateChoice(SPECS, touch('+0.52', 1), 1)).toMatch(/duration/);
    });

    it('checks growth rates, multipliers and the stop loss', () => {
        const accu = (growth_rate: number): TContractChoice => ({
            product: 'accumulator',
            contract_type: 'ACCU',
            label: 'x',
            growth_rate,
        });
        expect(validateChoice(SPECS, accu(0.01), 1)).toBeNull();
        expect(validateChoice(SPECS, accu(0.05), 1)).toMatch(/growth rate/);
        const mult = (multiplier: number, stop_loss?: number): TContractChoice => ({
            product: 'multiplier',
            contract_type: 'MULTUP',
            label: 'x',
            multiplier,
            stop_loss,
        });
        expect(validateChoice(SPECS, mult(10, 0.5), 1)).toBeNull();
        expect(validateChoice(SPECS, mult(15), 1)).toMatch(/multiplier/);
        expect(validateChoice(SPECS, mult(10, 5), 1)).toMatch(/stop loss/);
    });
});

describe('placing a non-Rise/Fall trade', () => {
    const make = (is_virtual = true) => {
        const executors: { options: { request: Record<string, unknown>; max_price: number }; start: jest.Mock }[] = [];
        const trader = new VoltrexTrader({
            api: {} as never,
            currency: 'USD',
            is_virtual,
            getBalance: () => 1000,
            getRisk: () => ({ ...DEFAULT_RISK, max_open_trades: 3, max_daily_loss: 20 }),
            getRows: () => [],
            getSpec: async () => null,
            initial_risk: emptyRiskState(),
            onChange: () => undefined,
            createExecutor: options => {
                const executor = { options, start: jest.fn(), cancel: jest.fn(() => true) };
                executors.push(executor as never);
                return executor;
            },
        });
        return { trader, executors };
    };

    const order = (choice: TContractChoice): TOrder => ({
        symbol: 'R_100',
        name: 'Volatility 100 Index',
        choice,
        stake: 2,
        source: 'manual',
        why: 'test',
    });

    it('sends the right proposal, capped at the stake, through the executor', () => {
        const { trader, executors } = make();
        const result = trader.place(order(digit('DIGITOVER', '4')), SPECS);
        expect(result.ok).toBe(true);
        expect(executors).toHaveLength(1);
        expect(executors[0].start).toHaveBeenCalled();
        expect(executors[0].options.max_price).toBe(2);
        expect(executors[0].options.request).toMatchObject({
            contract_type: 'DIGITOVER',
            barrier: '4',
            amount: 2,
            underlying_symbol: 'R_100',
        });
        expect(trader.getSnapshot().trades[0]).toMatchObject({ product: 'over_under', contract_type: 'DIGITOVER' });
    });

    it('refuses an invalid choice without contacting the server', () => {
        const { trader, executors } = make();
        const result = trader.place(order(digit('DIGITOVER', '9')), SPECS);
        expect(result.ok).toBe(false);
        expect(executors).toHaveLength(0);
    });

    it('refuses a product the market does not offer', () => {
        const { trader, executors } = make();
        const result = trader.place(order(digit('DIGITEVEN')), EMPTY_SPECS);
        expect(result.ok).toBe(false);
        expect(executors).toHaveLength(0);
    });

    it('refuses auto-trading on a real account', () => {
        const { trader, executors } = make(false);
        const result = trader.place({ ...order(digit('DIGITEVEN')), source: 'auto' }, SPECS);
        expect(result.ok).toBe(false);
        expect(executors).toHaveLength(0);
    });
});
