import { calcPositionSize, calcRewardRisk, calcStakePlan, riskBand, riskGaugeFill } from '../risk-utils';

describe('calcPositionSize', () => {
    it('sizes a position from balance, risk %, stop loss and pip value', () => {
        const result = calcPositionSize({ balance: 1000, risk_percent: 1, stop_loss_pips: 20, pip_value_per_lot: 10 });
        expect(result?.risk_amount).toBeCloseTo(10);
        expect(result?.lots).toBeCloseTo(0.05);
    });

    it('returns null for zero, negative, missing or impossible inputs', () => {
        const ok = { balance: 1000, risk_percent: 1, stop_loss_pips: 20, pip_value_per_lot: 10 };
        expect(calcPositionSize({ ...ok, stop_loss_pips: 0 })).toBeNull();
        expect(calcPositionSize({ ...ok, balance: -5 })).toBeNull();
        expect(calcPositionSize({ ...ok, pip_value_per_lot: NaN })).toBeNull();
        expect(calcPositionSize({ ...ok, risk_percent: 101 })).toBeNull();
    });
});

describe('calcRewardRisk', () => {
    it('gives the target profit and the break-even win rate', () => {
        const result = calcRewardRisk(10, 2);
        expect(result?.reward_amount).toBe(20);
        expect(result?.breakeven_win_rate).toBeCloseTo(33.333, 2);
    });

    it('returns null for unusable input', () => {
        expect(calcRewardRisk(0, 2)).toBeNull();
        expect(calcRewardRisk(10, -1)).toBeNull();
    });
});

describe('calcStakePlan', () => {
    const input = { balance: 1000, risk_percent: 1, payout_percent: 85, win_rate: 55 };

    it('computes stake, profit and expected result', () => {
        const plan = calcStakePlan(input);
        expect(plan?.stake).toBeCloseTo(10);
        expect(plan?.profit_if_win).toBeCloseTo(8.5);
        // 0.55 * 8.5 - 0.45 * 10 = 0.175
        expect(plan?.expected_value).toBeCloseTo(0.175);
        expect(plan?.breakeven_win_rate).toBeCloseTo(54.054, 2);
    });

    it('shows a negative expected result when the win rate is below break-even', () => {
        expect(calcStakePlan({ ...input, win_rate: 40 })?.expected_value).toBeLessThan(0);
    });

    it('works out losing streak chance and drawdown', () => {
        const streak = calcStakePlan(input)?.streaks.find(item => item.losses === 5);
        expect(streak?.probability).toBeCloseTo(0.45 ** 5 * 100);
        expect(streak?.drawdown).toBe(5);
    });

    it('caps drawdown at 100%', () => {
        const streak = calcStakePlan({ ...input, risk_percent: 20 })?.streaks.find(item => item.losses === 10);
        expect(streak?.drawdown).toBe(100);
    });

    it('counts how many doubling trades the balance can fund', () => {
        // 10 + 20 + 40 + 80 + 160 + 320 = 630 <= 1000, adding 640 makes 1270 > 1000
        expect(calcStakePlan(input)?.doubling_steps_affordable).toBe(6);
        // stake equals the whole balance: only one trade can be funded
        expect(calcStakePlan({ ...input, risk_percent: 100 })?.doubling_steps_affordable).toBe(1);
    });

    it('returns null for a win rate outside 0 to 100 or empty inputs', () => {
        expect(calcStakePlan({ ...input, win_rate: 120 })).toBeNull();
        expect(calcStakePlan({ ...input, balance: NaN })).toBeNull();
    });
});

describe('riskBand', () => {
    it.each([
        [0.5, 'cautious'],
        [1, 'cautious'],
        [1.01, 'common'],
        [2, 'common'],
        [2.01, 'high'],
        [5, 'high'],
        [5.01, 'very_high'],
        [50, 'very_high'],
    ])('puts %s%% in the %s band', (percent, band) => {
        expect(riskBand(percent)).toBe(band);
    });

    it('has no band for zero, negative or missing numbers', () => {
        [0, -1, NaN, Infinity].forEach(value => expect(riskBand(value)).toBeNull());
    });
});

describe('riskGaugeFill', () => {
    it('fills in proportion up to 10% and stops there', () => {
        expect(riskGaugeFill(1)).toBe(10);
        expect(riskGaugeFill(2.5)).toBe(25);
        expect(riskGaugeFill(10)).toBe(100);
        expect(riskGaugeFill(40)).toBe(100);
    });

    it('is empty for anything that is not a positive number', () => {
        [0, -3, NaN].forEach(value => expect(riskGaugeFill(value)).toBe(0));
    });
});
