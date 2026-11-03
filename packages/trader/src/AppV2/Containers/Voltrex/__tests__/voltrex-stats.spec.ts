import type { TScanRow } from '../use-voltrex-scanner';
import { emptyRiskState } from '../voltrex-risk';
import { performance, signalChanges } from '../voltrex-stats';
import type { TTrade } from '../voltrex-trader';

const trade = (overrides: Partial<TTrade>): TTrade => ({
    id: 1,
    symbol: 'R_100',
    name: 'Volatility 100 Index',
    product: 'rise_fall',
    contract_type: 'CALL',
    label: 'Rise',
    stake: 1,
    duration: 5,
    duration_unit: 't',
    source: 'manual',
    why: '',
    status: 'won',
    opened_at: 0,
    ...overrides,
});

describe('performance', () => {
    it('is empty, with no win rate, before any trade has finished', () => {
        const result = performance([trade({ status: 'open' }), trade({ status: 'placing' })], emptyRiskState());
        expect(result).toMatchObject({ finished: 0, wins: 0, losses: 0, win_rate: null, net_profit: 0 });
    });

    it('counts only finished trades, and reports failed ones separately', () => {
        const result = performance(
            [
                trade({ status: 'won', profit: 0.95 }),
                trade({ status: 'won', profit: 0.95, source: 'auto' }),
                trade({ status: 'lost', profit: -1, source: 'auto' }),
                trade({ status: 'failed' }),
                trade({ status: 'open' }),
            ],
            { ...emptyRiskState(), realised_profit: 0.9, consecutive_losses: 1 }
        );
        expect(result).toMatchObject({
            finished: 3,
            wins: 2,
            losses: 1,
            failed: 1,
            win_rate: 66.7,
            net_profit: 0.9,
            today_profit: 0.9,
            losing_streak: 1,
            manual: 2,
            auto: 2,
        });
    });
});

describe('signalChanges', () => {
    const row = (symbol: string, direction: 'BUY' | 'SELL' | 'NEUTRAL' | null, strength = 60) =>
        ({
            symbol,
            name: symbol,
            signal: direction ? { direction, strength } : null,
        }) as unknown as TScanRow;

    it('remembers a market the first time it is seen without reporting it', () => {
        const { events, next } = signalChanges({}, [row('R_10', 'BUY'), row('R_25', null)], 5);
        expect(events).toEqual([]);
        expect(next).toEqual({ R_10: 'BUY' });
    });

    it('reports a change of direction with its strength and time, and nothing when it stays the same', () => {
        const first = signalChanges({ R_10: 'BUY', R_25: 'SELL' }, [row('R_10', 'SELL', 72), row('R_25', 'SELL')], 9);
        expect(first.events).toEqual([
            { symbol: 'R_10', name: 'R_10', from: 'BUY', to: 'SELL', strength: 72, time: 9 },
        ]);
        expect(first.next).toEqual({ R_10: 'SELL', R_25: 'SELL' });
    });

    it('does not change its input', () => {
        const previous = { R_10: 'BUY' as const };
        signalChanges(previous, [row('R_10', 'SELL')], 1);
        expect(previous).toEqual({ R_10: 'BUY' });
    });
});
