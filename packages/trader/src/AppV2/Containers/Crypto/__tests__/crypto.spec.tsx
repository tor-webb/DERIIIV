import React from 'react';

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import Crypto from '../crypto';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const ticker = (instId: string, last: string) => ({
    instId,
    last,
    open24h: '100',
    high24h: '120',
    low24h: '90',
    volCcy24h: '5000',
});

const reply = (url: string) => {
    if (url.includes('/market/tickers')) {
        const swap = url.includes('SWAP');
        return {
            code: '0',
            data: [
                ticker(swap ? 'BTC-USDT-SWAP' : 'BTC-USDT', '110'),
                ticker(swap ? 'ETH-USDT-SWAP' : 'ETH-USDT', '90'),
            ],
        };
    }
    if (url.includes('/market/candles')) {
        return {
            code: '0',
            data: [
                ['2000', '2', '3', '1', '2.5'],
                ['1000', '1', '2', '0.5', '1.5'],
            ],
        };
    }
    return { code: '0', data: [{ fundingRate: '0.0001', nextFundingTime: '1700000000000' }] };
};

const mockFetch = (fail = false) => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string) =>
        fail
            ? Promise.reject(new Error('Failed to fetch'))
            : Promise.resolve({ ok: true, json: async () => reply(url) })
    );
};

beforeEach(() => {
    localStorage.clear();
    mockFetch();
});

describe('Crypto page', () => {
    it('lists the prices, with the 24 hour change coloured by direction, and says it is read-only', async () => {
        render(<Crypto />);
        expect(await screen.findByTestId('crypto-row-BTC')).toHaveTextContent('110.0000');
        expect(screen.getByTestId('crypto-row-BTC')).toHaveTextContent('+10.00%');
        expect(screen.getByTestId('crypto-row-ETH')).toHaveTextContent('−10.00%');
        expect(screen.getByTestId('crypto-note')).toHaveTextContent(/no orders can be placed/);
    });

    it('draws the chart for the picked coin', async () => {
        render(<Crypto />);
        await userEvent.click(await screen.findByTestId('crypto-pick-ETH'));
        expect(await screen.findByTestId('crypto-chart')).toBeInTheDocument();
        await waitFor(() =>
            expect(
                (global.fetch as jest.Mock).mock.calls.some(call => String(call[0]).includes('instId=ETH-USDT&'))
            ).toBe(true)
        );
    });

    it('shows the funding rate on perpetual futures only', async () => {
        render(<Crypto />);
        await screen.findByTestId('crypto-row-BTC');
        expect(screen.queryByTestId('crypto-funding')).not.toBeInTheDocument();
        await userEvent.click(screen.getByTestId('crypto-kind-SWAP'));
        expect(await screen.findByTestId('crypto-funding')).toHaveTextContent('0.0100%');
    });

    it('searches and filters to the watchlist, and remembers the stars', async () => {
        const { unmount } = render(<Crypto />);
        await screen.findByTestId('crypto-row-BTC');
        await userEvent.type(screen.getByTestId('crypto-search'), 'eth');
        expect(screen.queryByTestId('crypto-row-BTC')).not.toBeInTheDocument();
        expect(screen.getByTestId('crypto-row-ETH')).toBeInTheDocument();
        await userEvent.clear(screen.getByTestId('crypto-search'));
        await userEvent.click(screen.getByTestId('crypto-star-ETH'));
        await userEvent.click(screen.getByTestId('crypto-watchlist-filter'));
        expect(screen.queryByTestId('crypto-row-BTC')).not.toBeInTheDocument();
        unmount();
        render(<Crypto />);
        expect(await screen.findByTestId('crypto-star-ETH')).toHaveAttribute('aria-pressed', 'true');
    });

    it('says plainly when OKX cannot be reached, and tries again on request', async () => {
        mockFetch(true);
        render(<Crypto />);
        expect(await screen.findByTestId('crypto-error')).toHaveTextContent(/Failed to fetch/);
        mockFetch();
        await act(async () => {
            await userEvent.click(screen.getByTestId('crypto-retry'));
        });
        expect(await screen.findByTestId('crypto-row-BTC')).toBeInTheDocument();
        expect(screen.queryByTestId('crypto-error')).not.toBeInTheDocument();
    });
});
