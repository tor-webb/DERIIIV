import { EMPTY_SPECS, offers, parseSpecs } from '../voltrex-specs';

const response = (available: Record<string, unknown>[]) => ({ contracts_for: { available } });

const row = (contract_type: string, extra: Record<string, unknown> = {}) => ({
    contract_type,
    min_contract_duration: '1t',
    max_contract_duration: '10t',
    ...extra,
});

describe('parseSpecs', () => {
    it('is empty for a reply with no contract list', () => {
        expect(parseSpecs(undefined)).toEqual(EMPTY_SPECS);
        expect(parseSpecs({ error: { code: 'x' } })).toEqual(EMPTY_SPECS);
    });

    it('reads which digit contracts are sold, and the tick range', () => {
        const specs = parseSpecs(
            response([
                row('DIGITOVER', { contract_category: 'digits' }),
                row('DIGITUNDER', { contract_category: 'digits' }),
                row('DIGITEVEN', { min_contract_duration: '1t', max_contract_duration: '5t' }),
            ])
        );
        expect(specs.digits).toEqual({ types: ['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN'], ticks: { min: 1, max: 10 } });
        expect(offers(specs, 'over_under', 'DIGITOVER')).toBe(true);
        expect(offers(specs, 'match_differ', 'DIGITMATCH')).toBe(false);
        expect(offers(specs, 'even_odd', 'DIGITODD')).toBe(false);
    });

    it('needs both sides of Touch / No Touch, and reads minute ranges', () => {
        const one = parseSpecs(
            response([row('ONETOUCH', { min_contract_duration: '2m', max_contract_duration: '1h' })])
        );
        expect(one.touch).toBeNull();
        const both = parseSpecs(
            response([
                row('ONETOUCH', { min_contract_duration: '2m', max_contract_duration: '1h' }),
                row('NOTOUCH', { min_contract_duration: '2m', max_contract_duration: '1h' }),
            ])
        );
        expect(both.touch).toEqual({ ticks: null, minutes: { min: 2, max: 60 } });
    });

    it('reads accumulator growth rates and multiplier values', () => {
        const specs = parseSpecs(
            response([
                { contract_type: 'ACCU', growth_rate_range: [0.03, 0.01, 0.02, 0.01] },
                { contract_type: 'MULTUP', multiplier_range: [20, 10] },
                { contract_type: 'MULTDOWN', multiplier_range: [10, 20, 50] },
            ])
        );
        expect(specs.accumulator).toEqual({ growth_rates: [0.01, 0.02, 0.03] });
        expect(specs.multiplier).toEqual({ multipliers: [10, 20, 50] });
        expect(offers(specs, 'accumulator')).toBe(true);
        expect(offers(specs, 'multiplier')).toBe(true);
    });

    it('does not offer multipliers when only one direction is sold, or accumulators with no rates', () => {
        const specs = parseSpecs(
            response([{ contract_type: 'MULTUP', multiplier_range: [10] }, { contract_type: 'ACCU' }])
        );
        expect(specs.multiplier).toBeNull();
        expect(offers(specs, 'accumulator')).toBe(false);
    });

    it('keeps Rise/Fall as parsed before, and offers nothing for no specs', () => {
        const specs = parseSpecs(
            response([
                row('CALL', { contract_category: 'callput', barrier_category: 'euro_atm' }),
                row('PUT', { contract_category: 'callput', barrier_category: 'euro_atm' }),
            ])
        );
        expect(specs.rise_fall).toEqual({ ticks: { min: 1, max: 10 }, minutes: null });
        expect(offers(specs, 'rise_fall')).toBe(true);
        expect(offers(null, 'rise_fall')).toBe(false);
        expect(offers(specs, 'unknown')).toBe(false);
    });
});
