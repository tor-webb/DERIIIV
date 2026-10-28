import { WS } from '@deriv/shared';
import { act, renderHook } from '@testing-library/react';

import { MARKET_SYMBOLS } from '../markets-config';
import { useMarkets } from '../use-markets';

jest.mock('@deriv/shared', () => ({
    WS: { getTicksHistory: jest.fn(), subscribeTicks: jest.fn() },
}));

const mockHistory = WS.getTicksHistory as jest.Mock;
const mockSubscribe = WS.subscribeTicks as jest.Mock;

const now = () => Math.floor(Date.now() / 1000);

const history = (open: number, close: number) => ({
    pip_size: 2,
    candles: [
        { epoch: now() - 120, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close: open },
        { epoch: now() - 60, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close },
    ],
});

/** Lets the batched history requests resolve. */
const settle = async () => {
    for (let index = 0; index < 10; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
            await Promise.resolve();
        });
    }
};

describe('useMarkets', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockSubscribe.mockReturnValue({ unsubscribe: jest.fn() });
    });

    afterEach(() => jest.useRealTimers());

    it('asks for an hour of one-minute candles for every market, five at a time', async () => {
        let in_flight = 0;
        let max_in_flight = 0;
        mockHistory.mockImplementation(async () => {
            in_flight += 1;
            max_in_flight = Math.max(max_in_flight, in_flight);
            await Promise.resolve();
            in_flight -= 1;
            return history(100, 101);
        });
        renderHook(() => useMarkets());
        await settle();

        expect(mockHistory).toHaveBeenCalledTimes(MARKET_SYMBOLS.length);
        expect(mockHistory.mock.calls[0][0]).toMatchObject({
            ticks_history: MARKET_SYMBOLS[0].symbol,
            style: 'candles',
            granularity: 60,
            count: 60,
            end: 'latest',
        });
        expect(max_in_flight).toBeLessThanOrEqual(5);
    });

    it('builds rows from the history, and follows live ticks once a second', async () => {
        mockHistory.mockImplementation(async ({ ticks_history }) =>
            ticks_history === 'R_10' ? history(100, 102) : history(50, 50)
        );
        const { result } = renderHook(() => useMarkets());
        await settle();

        const r10 = () => result.current.rows.find(row => row.symbol === 'R_10');
        expect(r10()?.price).toBe(102);
        expect(r10()?.change_pct).toBeCloseTo(2, 6);
        expect(result.current.is_loading).toBe(false);
        expect(mockSubscribe).toHaveBeenCalledTimes(MARKET_SYMBOLS.length);

        const callback = mockSubscribe.mock.calls.find(call => call[0] === 'R_10')[1];
        act(() => callback({ tick: { quote: 110, epoch: now(), pip_size: 2 } }));
        // not shown until the next flush
        expect(r10()?.price).toBe(102);
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(r10()?.price).toBe(110);
        expect(r10()?.change_pct).toBeCloseTo(10, 6);
        expect(result.current.updated_at).not.toBeNull();
    });

    it('marks a market unavailable when its history fails, and does not follow it', async () => {
        mockHistory.mockImplementation(async ({ ticks_history }) => {
            if (ticks_history === 'R_25') throw new Error('no');
            if (ticks_history === 'R_50') return { error: { message: 'not offered' } };
            return history(10, 11);
        });
        const { result } = renderHook(() => useMarkets());
        await settle();

        const status = (symbol: string) => result.current.rows.find(row => row.symbol === symbol)?.status;
        expect(status('R_25')).toBe('unavailable');
        expect(status('R_50')).toBe('unavailable');
        expect(status('R_10')).toBe('ready');
        expect(mockSubscribe.mock.calls.map(call => call[0])).not.toContain('R_25');
    });

    it('keeps showing the history when the socket refuses to subscribe', async () => {
        mockHistory.mockResolvedValue(history(10, 11));
        mockSubscribe.mockImplementation(() => {
            throw new Error('socket closed');
        });
        const { result } = renderHook(() => useMarkets());
        await settle();
        expect(result.current.rows.every(row => row.status === 'ready')).toBe(true);
    });

    it('stops listening when the page is left', async () => {
        const unsubscribe = jest.fn();
        mockSubscribe.mockReturnValue({ unsubscribe });
        mockHistory.mockResolvedValue(history(10, 11));
        const { unmount } = renderHook(() => useMarkets());
        await settle();
        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(MARKET_SYMBOLS.length);
    });

    it('loads everything again when retry is called', async () => {
        mockHistory.mockResolvedValue(history(10, 11));
        const { result } = renderHook(() => useMarkets());
        await settle();
        mockHistory.mockClear();
        act(() => result.current.retry());
        await settle();
        expect(mockHistory).toHaveBeenCalledTimes(MARKET_SYMBOLS.length);
    });
});
