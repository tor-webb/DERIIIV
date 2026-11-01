import {
    autoStopReason,
    checkOrder,
    DEFAULT_RISK,
    emptyRiskState,
    recordResult,
    rollDay,
    today,
    TRiskSettings,
    validateRisk,
} from '../voltrex-risk';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const settings: TRiskSettings = { ...DEFAULT_RISK, max_stake: 5, max_daily_loss: 10, max_open_trades: 2 };
const auto = { stake: 1, strength: 80, source: 'auto' as const };

describe('validateRisk', () => {
    it('accepts the defaults', () => {
        expect(validateRisk(DEFAULT_RISK)).toBeNull();
    });

    it.each([
        { max_stake: 0 },
        { max_stake: NaN },
        { max_daily_loss: -1 },
        { max_open_trades: 0 },
        { max_open_trades: 1.5 },
        { max_open_trades: 99 },
        { max_consecutive_losses: 0 },
        { daily_profit_target: -5 },
        { min_strength: 101 },
        { min_strength: -1 },
    ])('rejects %p', change => {
        expect(validateRisk({ ...DEFAULT_RISK, ...change })).not.toBeNull();
    });
});

describe('checkOrder', () => {
    it('allows an order inside every limit', () => {
        expect(checkOrder(settings, emptyRiskState(), auto)).toBeNull();
        expect(checkOrder(settings, emptyRiskState(), { stake: 5, source: 'manual' })).toBeNull();
    });

    it('blocks everything, manual and auto, while the emergency stop is on', () => {
        const state = { ...emptyRiskState(), emergency_stop: true };
        expect(checkOrder(settings, state, auto)).toMatch(/emergency/i);
        expect(checkOrder(settings, state, { stake: 1, source: 'manual' })).toMatch(/emergency/i);
    });

    it('blocks a stake above the maximum and a stake that is not a positive number', () => {
        expect(checkOrder(settings, emptyRiskState(), { ...auto, stake: 5.01 })).toMatch(/maximum stake/);
        [0, -1, NaN].forEach(stake =>
            expect(checkOrder(settings, emptyRiskState(), { ...auto, stake })).not.toBeNull()
        );
    });

    it('blocks when the open-trade limit is reached', () => {
        const state = { ...emptyRiskState(), open_stakes: [1, 1] };
        expect(checkOrder(settings, state, auto)).toMatch(/open trades/);
        expect(checkOrder(settings, { ...state, open_stakes: [1] }, auto)).toBeNull();
    });

    it('counts realised loss and the stake at risk in open trades against the daily loss limit', () => {
        const state = { ...emptyRiskState(), realised_profit: -6, open_stakes: [2] };
        // 6 lost + 2 at risk + 2 new = 10, exactly the limit: allowed
        expect(checkOrder(settings, state, { ...auto, stake: 2 })).toBeNull();
        // one more cent of risk is over
        expect(checkOrder(settings, state, { ...auto, stake: 2.01 })).toMatch(/daily limit/);
    });

    it('does not let a profit reduce the loss that one stake could cause', () => {
        const state = { ...emptyRiskState(), realised_profit: 50 };
        expect(checkOrder({ ...settings, max_stake: 20 }, state, { ...auto, stake: 11 })).toMatch(/daily limit/);
    });

    it('applies the auto-only limits to auto orders but not to manual ones', () => {
        const streak = { ...emptyRiskState(), consecutive_losses: 3 };
        expect(checkOrder(settings, streak, auto)).toMatch(/in a row/);
        expect(checkOrder(settings, streak, { stake: 1, source: 'manual' })).toBeNull();

        const target = { ...settings, daily_profit_target: 5 };
        const won = { ...emptyRiskState(), realised_profit: 5 };
        expect(checkOrder(target, won, auto)).toMatch(/profit target/);
        expect(checkOrder(target, won, { stake: 1, source: 'manual' })).toBeNull();
    });

    it('requires an auto order to carry a signal strength at or above the minimum', () => {
        expect(checkOrder(settings, emptyRiskState(), { ...auto, strength: 49 })).toMatch(/minimum/);
        expect(checkOrder(settings, emptyRiskState(), { ...auto, strength: 50 })).toBeNull();
        expect(checkOrder(settings, emptyRiskState(), { stake: 1, source: 'auto' })).toMatch(/minimum/);
    });

    it('refuses invalid settings rather than guessing', () => {
        expect(checkOrder({ ...settings, max_stake: 0 }, emptyRiskState(), auto)).not.toBeNull();
    });
});

describe('recordResult and autoStopReason', () => {
    it('tracks profit and the losing streak, and a win clears the streak', () => {
        let state = emptyRiskState();
        state = recordResult(state, -1);
        state = recordResult(state, -1);
        expect(state).toMatchObject({ realised_profit: -2, consecutive_losses: 2 });
        state = recordResult(state, 0.95);
        expect(state).toMatchObject({ realised_profit: -1.05, consecutive_losses: 0 });
    });

    it('does not accumulate floating point error', () => {
        let state = emptyRiskState();
        for (let count = 0; count < 10; count += 1) state = recordResult(state, 0.1);
        expect(state.realised_profit).toBe(1);
    });

    it('says why auto-trading should stop, and stays quiet otherwise', () => {
        const base = emptyRiskState();
        expect(autoStopReason(settings, base)).toBeNull();
        expect(autoStopReason(settings, { ...base, consecutive_losses: 3 })).toMatch(/in a row/);
        expect(autoStopReason(settings, { ...base, realised_profit: -10 })).toMatch(/daily loss/);
        expect(autoStopReason({ ...settings, daily_profit_target: 4 }, { ...base, realised_profit: 4 })).toMatch(
            /profit target/
        );
    });
});

describe('rollDay', () => {
    it('resets the day figures on a new day but keeps open trades and the emergency stop', () => {
        const state = {
            day: '2026-01-01',
            realised_profit: -9,
            consecutive_losses: 2,
            open_stakes: [1],
            emergency_stop: true,
        };
        expect(rollDay(state, '2026-01-02')).toEqual({
            day: '2026-01-02',
            realised_profit: 0,
            consecutive_losses: 0,
            open_stakes: [1],
            emergency_stop: true,
        });
        expect(rollDay(state, '2026-01-01')).toBe(state);
    });

    it('formats today as a local date', () => {
        expect(today(new Date(2026, 10, 1))).toBe('2026-11-01');
    });
});
