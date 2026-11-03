import {
    bestDigitIdea,
    digitStats,
    evenOddIdea,
    lastDigit,
    matchDifferIdeas,
    overUnderIdea,
    pushDigit,
    strengthOfZ,
    zScore,
} from '../voltrex-digits';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

/** A hundred digits where each of 0..9 appears ten times, so no idea can stand out. */
const even_spread = Array.from({ length: 100 }, (_, index) => index % 10);

describe('lastDigit', () => {
    it('reads the last digit as the server shows the price, trailing zeros included', () => {
        expect(lastDigit(1234.5, 2)).toBe(0);
        expect(lastDigit(1234.56, 2)).toBe(6);
        expect(lastDigit(99, 0)).toBe(9);
        expect(lastDigit(0.00123, 5)).toBe(3);
    });

    it('gives null for a price that is not a number', () => {
        expect(lastDigit(Number.NaN, 2)).toBeNull();
    });
});

describe('pushDigit', () => {
    it('keeps only the newest digits', () => {
        expect(pushDigit([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
        expect(pushDigit([1], 2, 3)).toEqual([1, 2]);
    });
});

describe('digitStats', () => {
    it('counts each digit, the most and least common, and the latest streaks', () => {
        const stats = digitStats([1, 1, 2, 4, 6, 6, 6]);
        expect(stats.count).toBe(7);
        expect(stats.counts[6]).toBe(3);
        expect(stats.hottest).toBe(6);
        expect(stats.last).toBe(6);
        expect(stats.repeat_streak).toBe(3);
        expect(stats.parity_streak).toEqual({ kind: 'even', length: 5 });
        expect(stats.even_count).toBe(5);
    });

    it('looks only at the recent window', () => {
        const stats = digitStats([9, 9, 9, 9, 0, 0], 2);
        expect(stats.count).toBe(2);
        expect(stats.hottest).toBe(0);
    });

    it('copes with no digits at all', () => {
        const stats = digitStats([]);
        expect(stats).toMatchObject({ count: 0, last: null, repeat_streak: 0 });
        expect(stats.parity_streak.kind).toBeNull();
    });
});

describe('zScore and strength', () => {
    it('is zero at chance, and a standard deviation scores 25', () => {
        expect(zScore(50, 100, 0.5)).toBe(0);
        expect(zScore(55, 100, 0.5)).toBeCloseTo(1, 5);
        expect(strengthOfZ(1)).toBe(25);
        expect(strengthOfZ(-2)).toBe(50);
        expect(strengthOfZ(10)).toBe(100);
    });

    it('is safe for impossible inputs', () => {
        expect(zScore(1, 0, 0.5)).toBe(0);
        expect(zScore(1, 10, 0)).toBe(0);
    });
});

describe('ideas', () => {
    it('offers nothing before enough digits have been collected', () => {
        const stats = digitStats([2, 4, 6, 8, 0]);
        expect(evenOddIdea(stats)).toBeNull();
        expect(overUnderIdea(stats)).toBeNull();
        expect(matchDifferIdeas(stats)).toEqual({ matches: null, differs: null });
    });

    it('takes the even side when even digits have been coming up more', () => {
        const digits = Array.from({ length: 100 }, (_, index) => (index < 65 ? (index % 5) * 2 : (index % 5) * 2 + 1));
        const idea = evenOddIdea(digitStats(digits));
        expect(idea?.choice).toMatchObject({ product: 'even_odd', contract_type: 'DIGITEVEN', duration: 1 });
        expect(idea?.strength).toBeGreaterThanOrEqual(25);
        expect(idea?.why).toContain('65%');
    });

    it('takes the odd side when odd digits lead', () => {
        const digits = Array.from({ length: 100 }, (_, index) => (index < 70 ? (index % 5) * 2 + 1 : (index % 5) * 2));
        expect(evenOddIdea(digitStats(digits))?.choice.contract_type).toBe('DIGITODD');
    });

    it('finds the Over / Under side furthest above chance', () => {
        // mostly high digits: Over a low digit is the most over-represented side
        const digits = Array.from({ length: 100 }, (_, index) => (index < 80 ? 7 + (index % 3) : index % 10));
        const idea = overUnderIdea(digitStats(digits));
        expect(idea?.choice.contract_type).toBe('DIGITOVER');
        expect(Number(idea?.choice.barrier)).toBeLessThanOrEqual(8);
        expect(idea?.strength).toBeGreaterThan(25);
    });

    it('never builds an Over 9 or an Under 0, which the server does not sell', () => {
        [Array.from({ length: 100 }, () => 9), Array.from({ length: 100 }, () => 0)].forEach(digits => {
            const idea = overUnderIdea(digitStats(digits));
            const barrier = Number(idea?.choice.barrier);
            if (idea?.choice.contract_type === 'DIGITOVER') expect(barrier).toBeLessThanOrEqual(8);
            if (idea?.choice.contract_type === 'DIGITUNDER') expect(barrier).toBeGreaterThanOrEqual(1);
        });
    });

    it('matches the hottest digit and differs from the coldest', () => {
        const digits = [
            ...Array.from({ length: 30 }, () => 4),
            ...even_spread.filter(digit => digit !== 8).slice(0, 70),
        ];
        const { matches, differs } = matchDifferIdeas(digitStats(digits));
        expect(matches?.choice).toMatchObject({ contract_type: 'DIGITMATCH', barrier: '4' });
        expect(differs?.choice).toMatchObject({ contract_type: 'DIGITDIFF', barrier: '8' });
    });

    it('finds nothing in a perfectly even spread', () => {
        const stats = digitStats(even_spread);
        expect(evenOddIdea(stats)).toBeNull();
        expect(bestDigitIdea('over_under', stats)?.strength ?? 0).toBeLessThan(25);
        expect(matchDifferIdeas(stats).matches).toBeNull();
        expect(matchDifferIdeas(stats).differs).toBeNull();
    });

    it('picks the stronger of Matches and Differs for the combined product', () => {
        const digits = [...Array.from({ length: 40 }, () => 3), ...even_spread.slice(0, 60)];
        expect(bestDigitIdea('match_differ', digitStats(digits))?.choice.contract_type).toBe('DIGITMATCH');
        expect(bestDigitIdea('touch', digitStats(digits))).toBeNull();
    });
});
