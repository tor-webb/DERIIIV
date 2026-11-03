import {
    distanceForProbability,
    normalCdf,
    sigmaFromAtr,
    strengthOfEdge,
    touchProbability,
    touchVerdict,
} from '../voltrex-touch';

describe('normalCdf', () => {
    it('matches known values', () => {
        expect(normalCdf(0)).toBeCloseTo(0.5, 5);
        expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
        expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    });
});

describe('touchProbability', () => {
    it('is the double of the chance of finishing beyond the level', () => {
        // one standard deviation away: 2 * (1 - 0.8413)
        expect(touchProbability(0.5, 5, 0.5, 5)).toBeCloseTo(0.3173, 3);
    });

    it('falls with distance and rises with time', () => {
        expect(touchProbability(1, 5, 0.5)).toBeLessThan(touchProbability(0.5, 5, 0.5));
        expect(touchProbability(0.5, 20, 0.5)).toBeGreaterThan(touchProbability(0.5, 5, 0.5));
    });

    it('is zero for nonsense inputs', () => {
        expect(touchProbability(0, 5, 0.5)).toBe(0);
        expect(touchProbability(1, 0, 0.5)).toBe(0);
        expect(touchProbability(1, 5, 0)).toBe(0);
    });
});

describe('distanceForProbability', () => {
    it('finds the distance that gives the wanted chance', () => {
        const distance = distanceForProbability(0.3, 5, 0.4);
        expect(touchProbability(distance, 5, 0.4)).toBeCloseTo(0.3, 3);
    });

    it('turns an average candle range into a standard deviation', () => {
        expect(sigmaFromAtr(1.6)).toBeCloseTo(1, 5);
    });
});

describe('touchVerdict', () => {
    it('takes Touch when the model finds it under-priced', () => {
        const verdict = touchVerdict(0.4, { ask_price: 1, payout: 3.3 }, { ask_price: 1, payout: 1.5 });
        expect(verdict?.contract_type).toBe('ONETOUCH');
        expect(verdict?.edge).toBeCloseTo(0.4 - 1 / 3.3, 5);
    });

    it('takes No Touch when the model finds that side under-priced', () => {
        const verdict = touchVerdict(0.1, { ask_price: 1, payout: 5 }, { ask_price: 1, payout: 1.2 });
        expect(verdict?.contract_type).toBe('NOTOUCH');
        expect(verdict?.model).toBeCloseTo(0.9, 5);
    });

    it('gives null with no quote, and ignores a quote with no payout', () => {
        expect(touchVerdict(0.3, null, null)).toBeNull();
        expect(touchVerdict(0.3, { ask_price: 1, payout: 0 }, null)).toBeNull();
    });

    it('scores a 5-point gap as 25, and never below zero', () => {
        expect(strengthOfEdge(0.05)).toBe(25);
        expect(strengthOfEdge(-0.2)).toBe(0);
        expect(strengthOfEdge(0.5)).toBe(100);
    });
});
