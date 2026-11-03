import { buildProposal, digitLabel, isDigitProduct } from '../voltrex-products';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const base = { symbol: 'R_100', stake: 2, currency: 'USD' };

describe('buildProposal', () => {
    it('asks for a duration and a digit for digit contracts', () => {
        expect(
            buildProposal(
                {
                    product: 'over_under',
                    contract_type: 'DIGITOVER',
                    label: 'Over 4',
                    barrier: '4',
                    duration: 1,
                    duration_unit: 't',
                },
                base
            )
        ).toEqual({
            amount: 2,
            basis: 'stake',
            contract_type: 'DIGITOVER',
            currency: 'USD',
            underlying_symbol: 'R_100',
            duration: 1,
            duration_unit: 't',
            barrier: '4',
        });
    });

    it('sends no barrier for Rise / Fall and Even / Odd', () => {
        const request = buildProposal(
            { product: 'even_odd', contract_type: 'DIGITEVEN', label: 'Even', duration: 1, duration_unit: 't' },
            base
        );
        expect('barrier' in request).toBe(false);
    });

    it('sends the growth rate and take profit for accumulators, with no duration', () => {
        const request = buildProposal(
            {
                product: 'accumulator',
                contract_type: 'ACCU',
                label: 'Accumulator 1%',
                growth_rate: 0.01,
                take_profit: 1,
            },
            base
        );
        expect(request).toMatchObject({ growth_rate: 0.01, limit_order: { take_profit: 1 } });
        expect('duration' in request).toBe(false);
    });

    it('sends the multiplier with take profit and stop loss', () => {
        const request = buildProposal(
            {
                product: 'multiplier',
                contract_type: 'MULTUP',
                label: 'x',
                multiplier: 20,
                take_profit: 1,
                stop_loss: 0.5,
            },
            base
        );
        expect(request).toMatchObject({ multiplier: 20, limit_order: { take_profit: 1, stop_loss: 0.5 } });
    });

    it('sends the relative barrier and minutes for Touch', () => {
        expect(
            buildProposal(
                {
                    product: 'touch',
                    contract_type: 'ONETOUCH',
                    label: 'Touch',
                    barrier: '+0.52',
                    duration: 5,
                    duration_unit: 'm',
                },
                base
            )
        ).toMatchObject({ barrier: '+0.52', duration: 5, duration_unit: 'm' });
    });
});

describe('labels', () => {
    it('words each digit contract', () => {
        expect(digitLabel('DIGITOVER', '4')).toBe('Over 4');
        expect(digitLabel('DIGITUNDER', '7')).toBe('Under 7');
        expect(digitLabel('DIGITMATCH', '2')).toBe('Matches 2');
        expect(digitLabel('DIGITDIFF', '2')).toBe('Differs 2');
        expect(digitLabel('DIGITEVEN')).toBe('Even');
        expect(digitLabel('DIGITODD')).toBe('Odd');
    });

    it('knows which products are digit products', () => {
        expect(isDigitProduct('over_under')).toBe(true);
        expect(isDigitProduct('touch')).toBe(false);
    });
});
