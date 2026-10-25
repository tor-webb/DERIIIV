import { formatBalance, formatBalanceWithCurrency } from '../format-balance';

describe('formatBalance', () => {
    it('returns plain text with no HTML', () => {
        expect(formatBalance('USD', 9987)).toBe('9,987.00');
        expect(formatBalance('USD', 9987)).not.toMatch(/[<>]/);
    });

    it('treats a missing balance as zero', () => {
        expect(formatBalance('USD', undefined)).toBe('0.00');
        expect(formatBalance('USD', null)).toBe('0.00');
    });

    it('keeps the sign of a negative amount', () => {
        expect(formatBalance('USD', -12.5)).toBe('-12.50');
    });

    it('can append the currency code', () => {
        expect(formatBalanceWithCurrency('USD', 9987)).toBe('9,987.00 USD');
    });
});
