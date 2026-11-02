import { backOff, isRateLimit, pacing, resetPacer, waitTurn } from '../voltrex-pacer';

describe('voltrex pacer', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        resetPacer();
        pacing.gap_ms = 400;
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it('starts requests at least one gap apart, in the order asked', async () => {
        const started: number[] = [];
        const t0 = Date.now();
        const turns = [1, 2, 3].map(async () => {
            await waitTurn();
            started.push(Date.now() - t0);
        });
        await jest.advanceTimersByTimeAsync(1000);
        await Promise.all(turns);
        expect(started).toEqual([0, 400, 800]);
    });

    it('holds every later request back after a back-off', async () => {
        backOff(5000);
        let done = false;
        waitTurn().then(() => {
            done = true;
        });
        await jest.advanceTimersByTimeAsync(4900);
        expect(done).toBe(false);
        await jest.advanceTimersByTimeAsync(200);
        expect(done).toBe(true);
    });

    it('recognises a rate-limit reply and nothing else', () => {
        expect(isRateLimit({ error: { code: 'RateLimit' } })).toBe(true);
        expect(isRateLimit({ error: { code: 'InvalidSymbol' } })).toBe(false);
        expect(isRateLimit({ candles: [] })).toBe(false);
        expect(isRateLimit(undefined)).toBe(false);
    });
});
