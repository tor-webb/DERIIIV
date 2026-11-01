import { defaultDuration, parseDuration, parseRiseFall, validateDuration } from '../voltrex-contracts';

const row = (contract_type: string, min: string, max: string, extra: Record<string, unknown> = {}) => ({
    contract_type,
    contract_category: 'callput',
    barrier_category: 'euro_atm',
    min_contract_duration: min,
    max_contract_duration: max,
    ...extra,
});
const response = (available: unknown[]) => ({ contracts_for: { available } });

describe('parseDuration', () => {
    it('reads the value and unit', () => {
        expect(parseDuration('5t')).toEqual({ value: 5, unit: 't' });
        expect(parseDuration('1d')).toEqual({ value: 1, unit: 'd' });
        expect(parseDuration('x')).toBeNull();
        expect(parseDuration(undefined)).toBeNull();
    });
});

describe('parseRiseFall', () => {
    it('reads tick and minute ranges from separate rows', () => {
        const spec = parseRiseFall(
            response([
                row('CALL', '1t', '10t'),
                row('PUT', '1t', '10t'),
                row('CALL', '15s', '1d'),
                row('PUT', '15s', '1d'),
            ])
        );
        expect(spec).toEqual({ ticks: { min: 1, max: 10 }, minutes: { min: 1, max: 1440 } });
    });

    it('is null when Rise/Fall is not sold (only other contract types, or only one side)', () => {
        expect(parseRiseFall(response([{ contract_type: 'ACCU', contract_category: 'accumulator' }]))).toBeNull();
        expect(parseRiseFall(response([row('CALL', '1t', '10t')]))).toBeNull();
        expect(parseRiseFall(undefined)).toBeNull();
        expect(parseRiseFall({ error: { code: 'x' } })).toBeNull();
    });

    it('does not count Higher/Lower rows, which have a barrier', () => {
        const spec = parseRiseFall(
            response([
                row('CALL', '1t', '10t'),
                row('PUT', '1t', '10t'),
                row('CALL', '1m', '1d', { barrier_category: 'euro_non_atm', barrier: '+0.5' }),
                row('PUT', '1m', '1d', { barrier_category: 'euro_non_atm', barrier: '-0.5' }),
            ])
        );
        expect(spec).toEqual({ ticks: { min: 1, max: 10 }, minutes: null });
    });
});

describe('defaultDuration and validateDuration', () => {
    const spec = { ticks: { min: 1, max: 10 }, minutes: { min: 2, max: 60 } };

    it('prefers 5 ticks, then 5 minutes, and stays inside the range', () => {
        expect(defaultDuration(spec)).toEqual({ unit: 't', value: 5 });
        expect(defaultDuration({ ticks: null, minutes: { min: 10, max: 60 } })).toEqual({ unit: 'm', value: 10 });
        expect(defaultDuration({ ticks: { min: 1, max: 3 }, minutes: null })).toEqual({ unit: 't', value: 3 });
    });

    it('accepts only whole numbers inside the range, in a unit the market sells', () => {
        expect(validateDuration(spec, 't', 5)).toBeNull();
        expect(validateDuration(spec, 't', 11)).not.toBeNull();
        expect(validateDuration(spec, 'm', 1)).not.toBeNull();
        expect(validateDuration(spec, 'm', 2.5)).not.toBeNull();
        expect(validateDuration({ ticks: null, minutes: spec.minutes }, 't', 5)).not.toBeNull();
    });
});
