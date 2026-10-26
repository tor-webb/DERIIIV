import { WS } from '@deriv/shared';

import { fetchQuote, fetchTicks } from '../bulk-api';

jest.mock('@deriv/shared', () => ({
    WS: { getTicksHistory: jest.fn(), subscribeProposal: jest.fn() },
}));

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string) => text,
}));

const mockGetTicks = WS.getTicksHistory as jest.Mock;
const mockSubscribe = WS.subscribeProposal as jest.Mock;

const quote_request = {
    contract_type: 'DIGITEVEN' as const,
    symbol: '1HZ100V',
    duration: 1,
    stake: 10,
    currency: 'USD',
};

describe('fetchTicks', () => {
    beforeEach(() => jest.clearAllMocks());

    it('asks for the latest ticks and returns them with the market decimals', async () => {
        mockGetTicks.mockResolvedValue({ history: { prices: [1.5, '2.25'], times: [10, 11] }, pip_size: 2 });
        await expect(fetchTicks('R_100', 300)).resolves.toEqual({ prices: [1.5, 2.25], times: [10, 11], pip_size: 2 });
        expect(mockGetTicks).toHaveBeenCalledWith({
            ticks_history: 'R_100',
            adjust_start_time: 1,
            count: 300,
            end: 'latest',
            style: 'ticks',
        });
    });

    it('never asks for more than the API allows', async () => {
        mockGetTicks.mockResolvedValue({ history: { prices: [1], times: [1] }, pip_size: 2 });
        await fetchTicks('R_100', 99999);
        expect(mockGetTicks.mock.calls[0][0].count).toBe(5000);
    });

    it('turns an API error into a readable message', async () => {
        mockGetTicks.mockResolvedValue({ error: { message: 'Symbol is not offered.' } });
        await expect(fetchTicks('NOPE', 100)).rejects.toThrow('Symbol is not offered.');
        mockGetTicks.mockRejectedValue({ error: { message: 'Rate limit.' } });
        await expect(fetchTicks('R_100', 100)).rejects.toThrow('Rate limit.');
    });

    it('refuses a response it cannot read', async () => {
        mockGetTicks.mockResolvedValue({ history: { prices: [1, 2], times: [1] }, pip_size: 2 });
        await expect(fetchTicks('R_100', 100)).rejects.toThrow('could not read');
        mockGetTicks.mockResolvedValue({ history: { prices: [1], times: [1] } });
        await expect(fetchTicks('R_100', 100)).rejects.toThrow('could not read');
    });
});

describe('fetchQuote', () => {
    beforeEach(() => jest.clearAllMocks());

    it('works out the profit on a win from the quoted ask price and payout', async () => {
        const unsubscribe = jest.fn();
        mockSubscribe.mockImplementation((_request, cb) => {
            setTimeout(() => cb({ proposal: { ask_price: 10, payout: 19.54 } }), 0);
            return { unsubscribe };
        });
        const quote = await fetchQuote(quote_request);
        expect(quote.payout_percent).toBeCloseTo(95.4, 6);
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        // even/odd need no prediction, so none is sent
        expect(mockSubscribe.mock.calls[0][0]).toEqual({
            amount: 10,
            basis: 'stake',
            contract_type: 'DIGITEVEN',
            currency: 'USD',
            underlying_symbol: '1HZ100V',
            duration: 1,
            duration_unit: 't',
        });
    });

    it('sends the digit prediction as a string barrier', async () => {
        mockSubscribe.mockImplementation((_request, cb) => {
            setTimeout(() => cb({ proposal: { ask_price: 10, payout: 11 } }), 0);
            return { unsubscribe: jest.fn() };
        });
        await fetchQuote({ ...quote_request, contract_type: 'DIGITOVER', barrier: 4 });
        expect(mockSubscribe.mock.calls[0][0].barrier).toBe('4');
    });

    it('copes with a response that arrives before the subscription is returned', async () => {
        const unsubscribe = jest.fn();
        mockSubscribe.mockImplementation((_request, cb) => {
            cb({ proposal: { ask_price: 10, payout: 19 } });
            return { unsubscribe };
        });
        await expect(fetchQuote(quote_request)).resolves.toMatchObject({ payout_percent: 90 });
        expect(unsubscribe).toHaveBeenCalled();
    });

    it('rejects with the server message when the quote is refused', async () => {
        mockSubscribe.mockImplementation((_request, cb) => {
            setTimeout(() => cb({ error: { message: 'Trading is not offered for this duration.' } }), 0);
            return { unsubscribe: jest.fn() };
        });
        await expect(fetchQuote(quote_request)).rejects.toThrow('Trading is not offered for this duration.');
    });

    it('gives up if the server never answers', async () => {
        jest.useFakeTimers();
        const unsubscribe = jest.fn();
        mockSubscribe.mockReturnValue({ unsubscribe });
        const pending = fetchQuote(quote_request);
        const assertion = expect(pending).rejects.toThrow('took too long');
        jest.advanceTimersByTime(10001);
        await assertion;
        expect(unsubscribe).toHaveBeenCalled();
        jest.useRealTimers();
    });
});
