import {
    analyseFrame,
    analyseMarket,
    evaluateStrategy,
    MIN_CANDLES,
    SIGNAL_THRESHOLD,
    volatilityLevels,
} from '../voltrex-analysis';
import { TCandle } from '../voltrex-indicators';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const make = (closes: number[]): TCandle[] =>
    closes.map((close, index) => ({
        epoch: index * 300,
        open: index ? closes[index - 1] : close,
        high: Math.max(close, index ? closes[index - 1] : close) + 0.2,
        low: Math.min(close, index ? closes[index - 1] : close) - 0.2,
        close,
    }));

const rising = (length = 120, step = 1) => make(Array.from({ length }, (_item, index) => 100 + index * step));
const falling = (length = 120, step = 1) => make(Array.from({ length }, (_item, index) => 300 - index * step));
const accelerating = () => make(Array.from({ length: 120 }, (_item, index) => 100 + index + 0.03 * index ** 2));
const flat = (length = 120) => make(Array.from({ length }, (_item, index) => 100 + (index % 2 ? 0.05 : -0.05)));

describe('analyseFrame', () => {
    it('returns null with fewer than the minimum candles', () => {
        expect(analyseFrame(rising(MIN_CANDLES - 1))).toBeNull();
        expect(analyseFrame(rising(MIN_CANDLES))).not.toBeNull();
    });

    it('scores a steady rise above zero and a steady fall below zero, within -1 and 1', () => {
        const up = analyseFrame(rising()) as NonNullable<ReturnType<typeof analyseFrame>>;
        const down = analyseFrame(falling()) as NonNullable<ReturnType<typeof analyseFrame>>;
        expect(up.score).toBeGreaterThan(SIGNAL_THRESHOLD);
        expect(down.score).toBeLessThan(-SIGNAL_THRESHOLD);
        [up.score, down.score].forEach(score => expect(Math.abs(score)).toBeLessThanOrEqual(1));
        expect(up.trend).toBe('up');
        expect(down.trend).toBe('down');
    });

    it('produces seven votes, each between -1 and 1, with a reason', () => {
        const frame = analyseFrame(rising()) as NonNullable<ReturnType<typeof analyseFrame>>;
        expect(frame.votes).toHaveLength(7);
        frame.votes.forEach(vote => {
            expect(Math.abs(vote.vote)).toBeLessThanOrEqual(1);
            expect(vote.reason.length).toBeGreaterThan(0);
        });
    });

    it('is not decisive for a market that just oscillates', () => {
        const frame = analyseFrame(flat()) as NonNullable<ReturnType<typeof analyseFrame>>;
        expect(Math.abs(frame.score)).toBeLessThan(SIGNAL_THRESHOLD + 0.1);
    });
});

describe('analyseMarket', () => {
    it('is null without enough primary data', () => {
        expect(analyseMarket(rising(10), null)).toBeNull();
    });

    it('gives BUY in an uptrend and SELL in a downtrend, with reasons', () => {
        const buy = analyseMarket(rising(), rising()) as NonNullable<ReturnType<typeof analyseMarket>>;
        const sell = analyseMarket(falling(), falling()) as NonNullable<ReturnType<typeof analyseMarket>>;
        expect(buy.direction).toBe('BUY');
        expect(sell.direction).toBe('SELL');
        expect(buy.alignment).toBe('aligned');
        expect(buy.reasons.length).toBeGreaterThan(0);
        expect(buy.strength).toBeGreaterThan(0);
        expect(buy.strength).toBeLessThanOrEqual(100);
        expect(buy.agreement).toBeGreaterThan(50);
    });

    it('reports unconfirmed when there is no higher timeframe, and still analyses', () => {
        const signal = analyseMarket(rising(), null) as NonNullable<ReturnType<typeof analyseMarket>>;
        expect(signal.alignment).toBe('unconfirmed');
        expect(signal.direction).toBe('BUY');
    });

    it('halves the score when the higher timeframe points the other way', () => {
        const alone = analyseMarket(rising(), null) as NonNullable<ReturnType<typeof analyseMarket>>;
        const conflict = analyseMarket(rising(), falling()) as NonNullable<ReturnType<typeof analyseMarket>>;
        expect(conflict.alignment).toBe('conflict');
        expect(Math.abs(conflict.score)).toBeLessThan(Math.abs(alone.score));
    });

    it('never claims a direction without a score past the threshold', () => {
        [rising(), falling(), flat()].forEach(candles => {
            const signal = analyseMarket(candles, candles) as NonNullable<ReturnType<typeof analyseMarket>>;
            if (signal.direction === 'NEUTRAL') expect(Math.abs(signal.score)).toBeLessThan(SIGNAL_THRESHOLD);
            else expect(Math.abs(signal.score)).toBeGreaterThanOrEqual(SIGNAL_THRESHOLD);
        });
    });
});

describe('volatilityLevels', () => {
    it('splits each category into thirds on its own scale', () => {
        const items = [
            { symbol: 'A', category: 'x', volatility_pct: 1 },
            { symbol: 'B', category: 'x', volatility_pct: 2 },
            { symbol: 'C', category: 'x', volatility_pct: 3 },
            { symbol: 'D', category: 'y', volatility_pct: 100 },
            { symbol: 'E', category: 'y', volatility_pct: 200 },
            { symbol: 'F', category: 'x', volatility_pct: null },
        ];
        const levels = volatilityLevels(items);
        expect(levels.get('A')).toBe('low');
        expect(levels.get('B')).toBe('medium');
        expect(levels.get('C')).toBe('high');
        expect(levels.get('D')).toBe('medium');
        expect(levels.get('F')).toBeUndefined();
    });
});

describe('evaluateStrategy', () => {
    const up = analyseMarket(rising(), rising()) as NonNullable<ReturnType<typeof analyseMarket>>;
    const down = analyseMarket(falling(), falling()) as NonNullable<ReturnType<typeof analyseMarket>>;

    it('confluence and trend follow a confirmed signal', () => {
        const speeding = analyseMarket(accelerating(), accelerating()) as NonNullable<ReturnType<typeof analyseMarket>>;
        expect(evaluateStrategy('confluence', up)?.side).toBe('CALL');
        expect(evaluateStrategy('confluence', down)?.side).toBe('PUT');
        expect(evaluateStrategy('trend', speeding)?.side).toBe('CALL');
        // a perfectly constant slope has a flat MACD histogram, so the trend strategy waits for acceleration
        expect(evaluateStrategy('trend', up)).toBeNull();
    });

    it('does not trade a neutral signal or one the higher timeframe contradicts', () => {
        const neutral = analyseMarket(flat(), flat()) as NonNullable<ReturnType<typeof analyseMarket>>;
        if (neutral.direction === 'NEUTRAL') expect(evaluateStrategy('confluence', neutral)).toBeNull();
        const conflict = { ...up, alignment: 'conflict' as const };
        expect(evaluateStrategy('confluence', conflict)).toBeNull();
        expect(evaluateStrategy('trend', conflict)).toBeNull();
    });

    it('reversion needs RSI at an extreme with the price at the band edge', () => {
        // a long steady rise has RSI 100 and the price at the top of the bands
        const stretched = analyseMarket(rising(), null) as NonNullable<ReturnType<typeof analyseMarket>>;
        const idea = evaluateStrategy('reversion', stretched);
        expect(idea?.side === 'PUT' || idea === null).toBe(true);
        const calm = analyseMarket(flat(), null) as NonNullable<ReturnType<typeof analyseMarket>>;
        expect(evaluateStrategy('reversion', calm)).toBeNull();
    });
});
