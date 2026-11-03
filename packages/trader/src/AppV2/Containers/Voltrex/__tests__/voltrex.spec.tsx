import { MemoryRouter } from 'react-router-dom';

import { WS } from '@deriv/shared';
import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import Voltrex from '../voltrex';
import { pacing, resetPacer } from '../voltrex-pacer';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

jest.mock('@deriv/shared', () => ({
    ...jest.requireActual('@deriv/shared'),
    WS: {
        activeSymbols: jest.fn(),
        getTicksHistory: jest.fn(),
        subscribeTicks: jest.fn(),
        subscribeProposal: jest.fn(),
        subscribeProposalOpenContract: jest.fn(),
        buy: jest.fn(),
        sell: jest.fn(),
        storage: { contractsFor: jest.fn() },
    },
}));

const ws = WS as unknown as Record<string, jest.Mock> & { storage: { contractsFor: jest.Mock } };

const SYMBOLS = {
    active_symbols: [
        {
            underlying_symbol: 'R_100',
            display_name: 'Volatility 100 Index',
            market: 'synthetic_index',
            market_display_name: 'Derived',
            submarket: 'random_index',
            exchange_is_open: 1,
            pip_size: 2,
        },
        {
            underlying_symbol: 'frxEURUSD',
            display_name: 'EUR/USD',
            market: 'forex',
            market_display_name: 'Forex',
            submarket: 'major_pairs',
            exchange_is_open: 1,
            pip_size: 5,
        },
        {
            underlying_symbol: 'CRASH500',
            display_name: 'Crash 500 Index',
            market: 'synthetic_index',
            market_display_name: 'Derived',
            submarket: 'crash_index',
            exchange_is_open: 0,
            pip_size: 2,
        },
    ],
};

const candlesFor = (granularity: number) => ({
    pip_size: 2,
    candles: Array.from({ length: 120 }, (_item, index) => {
        const close = 100 + index + 0.03 * index ** 2;
        return { epoch: 1_700_000_000 + index * granularity, open: close, high: close + 0.2, low: close - 0.2, close };
    }),
});

const CONTRACTS = {
    contracts_for: {
        available: ['CALL', 'PUT'].map(contract_type => ({
            contract_type,
            contract_category: 'callput',
            barrier_category: 'euro_atm',
            min_contract_duration: '1t',
            max_contract_duration: '10t',
        })),
    },
};

const renderPage = (client: Record<string, unknown> = {}) =>
    render(
        <MemoryRouter>
            <StoreProvider
                store={mockStore({
                    client: {
                        is_logged_in: true,
                        loginid: 'VRTC1',
                        is_virtual: true,
                        currency: 'USD',
                        balance: '1000.00',
                        ...client,
                    },
                    common: { is_socket_opened: true },
                })}
            >
                <Voltrex />
            </StoreProvider>
        </MemoryRouter>
    );

const SLOW = { timeout: 5000 };

describe('<Voltrex />', () => {
    beforeEach(() => {
        pacing.gap_ms = 0;
        pacing.backoff_ms = 0;
        pacing.symbols_retry_ms = 0;
        resetPacer();
        Object.values(ws).forEach(fn => typeof fn === 'function' && fn.mockReset());
        ws.storage.contractsFor.mockReset();
        ws.activeSymbols.mockResolvedValue(SYMBOLS);
        ws.getTicksHistory.mockImplementation(async (request: { granularity: number }) =>
            candlesFor(request.granularity)
        );
        ws.subscribeTicks.mockReturnValue({ unsubscribe: jest.fn() });
        ws.subscribeProposal.mockImplementation((_request: unknown, cb: (response: unknown) => void) => {
            cb({ proposal: { id: 'p1', ask_price: 1, payout: 1.95 } });
            return { unsubscribe: jest.fn() };
        });
        ws.storage.contractsFor.mockResolvedValue(CONTRACTS);
    });

    it('shows the title, connection, account, balance and how many markets are open', async () => {
        renderPage();
        expect(screen.getByRole('heading', { name: 'VOLTREX SCANNER' })).toBeInTheDocument();
        const status = screen.getByTestId('voltrex-status');
        expect(within(status).getByText('Connected to Deriv')).toBeInTheDocument();
        expect(within(status).getByText('DEMO VRTC1')).toBeInTheDocument();
        expect(screen.getByTestId('voltrex-balance')).toHaveTextContent('1000.00 USD');
        await waitFor(() => expect(screen.getByTestId('voltrex-market-status')).toHaveTextContent('2 of 3 open'), SLOW);
    });

    it('lists every market the server returns, with closed markets marked and no candles asked for them', async () => {
        renderPage();
        await screen.findByTestId('voltrex-row-CRASH500', undefined, SLOW);
        expect(screen.getByTestId('voltrex-row-R_100')).toBeInTheDocument();
        expect(screen.getByTestId('voltrex-row-frxEURUSD')).toBeInTheDocument();
        expect(within(screen.getByTestId('voltrex-row-CRASH500')).getByText('Closed')).toBeInTheDocument();
        await waitFor(() => expect(ws.getTicksHistory).toHaveBeenCalled(), SLOW);
        const asked = ws.getTicksHistory.mock.calls.map(([request]) => request.ticks_history);
        expect(asked).not.toContain('CRASH500');
        expect(ws.activeSymbols).toHaveBeenCalledWith('brief');
    });

    it('analyses the loaded candles and shows a signal with its strength', async () => {
        renderPage();
        const row = await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        await waitFor(() => expect(within(row).getByText('BUY')).toBeInTheDocument(), SLOW);
        expect(screen.getByTestId('voltrex-progress')).toHaveTextContent(/2 of 3 markets analysed/);
    });

    it('shows the chart, indicators and the reasons for the selected market', async () => {
        renderPage();
        const row = await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        await waitFor(() => expect(within(row).getByText('BUY')).toBeInTheDocument(), SLOW);
        fireEvent.click(within(row).getByRole('button', { name: /Volatility 100 Index/ }));
        expect(screen.getByTestId('voltrex-detail-name')).toHaveTextContent('Volatility 100 Index');
        expect(screen.getByTestId('voltrex-detail-signal')).toHaveTextContent('BUY');
        expect(screen.getByRole('img', { name: /Candlestick chart/ })).toBeInTheDocument();
        expect(within(screen.getByTestId('voltrex-detail-reasons')).getAllByRole('listitem').length).toBeGreaterThan(0);
        expect(screen.getByText(/They are not the chance that a trade will win/)).toBeInTheDocument();
    });

    it('filters by category and by search text', async () => {
        renderPage();
        await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        fireEvent.click(screen.getByRole('button', { name: /^Forex \(1\)/ }));
        expect(screen.queryByTestId('voltrex-row-R_100')).not.toBeInTheDocument();
        expect(screen.getByTestId('voltrex-row-frxEURUSD')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^All \(3\)/ }));
        fireEvent.change(screen.getByLabelText('Search markets'), { target: { value: 'crash' } });
        expect(screen.getAllByTestId(/voltrex-row-/)).toHaveLength(1);
        fireEvent.change(screen.getByLabelText('Search markets'), { target: { value: 'nothing like this' } });
        expect(screen.getByTestId('voltrex-empty')).toBeInTheDocument();
    });

    it('asks for confirmation before a manual trade, and sends nothing when it is cancelled', async () => {
        renderPage();
        const row = await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        fireEvent.click(within(row).getByRole('button', { name: /Volatility 100 Index/ }));
        await waitFor(() => expect(screen.getByTestId('voltrex-spec-state')).toHaveTextContent(/Rise\/Fall/), SLOW);
        await waitFor(() => expect(screen.getByTestId('voltrex-rise')).toBeEnabled(), SLOW);
        await waitFor(() => expect(screen.getByTestId('voltrex-rise')).toHaveTextContent('Payout 1.95 USD'), SLOW);

        fireEvent.click(screen.getByTestId('voltrex-rise'));
        const dialog = screen.getByRole('alertdialog');
        expect(dialog).toHaveTextContent('Rise');
        expect(dialog).toHaveTextContent('DEMO');
        expect(dialog).toHaveTextContent('The most you can lose on this trade is the stake');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(ws.buy).not.toHaveBeenCalled();
    });

    it('sends a confirmed manual trade through the shared socket, and follows it', async () => {
        // the engine decides to buy when a tick arrives, as it does on the real socket
        ws.subscribeTicks.mockImplementation((symbol: string, cb: (response: unknown) => void) => {
            const timer = setTimeout(() => cb({ tick: { symbol, quote: 150, epoch: 1_700_000_000, pip_size: 2 } }), 20);
            return { unsubscribe: () => clearTimeout(timer) };
        });
        ws.buy.mockResolvedValue({
            buy: { contract_id: 77, buy_price: 1, payout: 1.95, longcode: 'x', start_time: 1 },
        });
        ws.subscribeProposalOpenContract.mockImplementation((_id: number, cb: (response: unknown) => void) => {
            cb({
                proposal_open_contract: {
                    contract_id: 77,
                    is_sold: 1,
                    status: 'won',
                    buy_price: 1,
                    sell_price: 1.95,
                    profit: 0.95,
                    payout: 1.95,
                    underlying_symbol: 'R_100',
                    contract_type: 'CALL',
                    entry_spot_display_value: '100',
                    exit_spot_display_value: '101',
                },
            });
            return { unsubscribe: jest.fn() };
        });
        renderPage();
        const row = await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        fireEvent.click(within(row).getByRole('button', { name: /Volatility 100 Index/ }));
        await waitFor(() => expect(screen.getByTestId('voltrex-rise')).toBeEnabled(), SLOW);
        fireEvent.click(screen.getByTestId('voltrex-rise'));
        fireEvent.click(screen.getByTestId('voltrex-confirm'));

        await waitFor(() => expect(ws.buy).toHaveBeenCalledWith({ proposal_id: 'p1', price: 1 }), SLOW);
        expect(ws.buy).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.getByTestId('voltrex-manual-status')).toHaveTextContent(/won/), SLOW);
        expect(screen.getByTestId('voltrex-stat-finished')).toHaveTextContent('1');
    }, 15000);

    it('refuses a stake above the maximum stake and keeps the buttons off', async () => {
        renderPage();
        const row = await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        fireEvent.click(within(row).getByRole('button', { name: /Volatility 100 Index/ }));
        await waitFor(() => expect(screen.getByTestId('voltrex-rise')).toBeEnabled(), SLOW);
        fireEvent.change(screen.getByTestId('voltrex-stake'), { target: { value: '50' } });
        expect(screen.getByTestId('voltrex-manual-problem')).toHaveTextContent(/above your maximum stake/);
        expect(screen.getByTestId('voltrex-rise')).toBeDisabled();
        expect(screen.getByTestId('voltrex-fall')).toBeDisabled();
    });

    it('stops new orders at once when the emergency stop is pressed, until it is reset', async () => {
        renderPage();
        const row = await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        fireEvent.click(within(row).getByRole('button', { name: /Volatility 100 Index/ }));
        await waitFor(() => expect(screen.getByTestId('voltrex-rise')).toBeEnabled(), SLOW);

        fireEvent.click(screen.getByRole('button', { name: 'EMERGENCY STOP' }));
        expect(await screen.findByTestId('voltrex-emergency-state', undefined, SLOW)).toBeInTheDocument();
        expect(screen.getByTestId('voltrex-rise')).toBeDisabled();
        expect(screen.getByTestId('voltrex-auto-start')).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
        await waitFor(() => expect(screen.getByTestId('voltrex-rise')).toBeEnabled(), SLOW);
    });

    it('does not offer trading when logged out', async () => {
        renderPage({ is_logged_in: false });
        const row = await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        fireEvent.click(within(row).getByRole('button', { name: /Volatility 100 Index/ }));
        expect(screen.getByText('Log in to place trades.')).toBeInTheDocument();
        expect(screen.getByTestId('voltrex-rise')).toBeDisabled();
    });

    it('keeps auto-trading off on a real account and says why', async () => {
        renderPage({ is_virtual: false, loginid: 'CR1' });
        await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        expect(screen.getByTestId('voltrex-auto-demo-only')).toHaveTextContent(/demo accounts only/);
        expect(screen.getByTestId('voltrex-auto-start')).toBeDisabled();
        expect(screen.getByTestId('voltrex-status')).toHaveTextContent('REAL CR1');
    });

    it('shows the scanning engine, and one section at a time through the tabs', async () => {
        renderPage();
        expect(screen.getByTestId('voltrex-engine')).toBeInTheDocument();
        const page = screen.getByTestId('voltrex-page');
        expect(page).toHaveAttribute('data-view', 'scan');
        fireEvent.click(screen.getByTestId('voltrex-tab-trade'));
        expect(page).toHaveAttribute('data-view', 'trade');
        expect(screen.getByTestId('voltrex-tab-trade')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('voltrex-tab-scan')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByTestId('voltrex-tab-activity'));
        expect(page).toHaveAttribute('data-view', 'activity');
        await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
    });

    it('opens the market view when a market is chosen on a phone, and stays put on a wide screen', async () => {
        const original = window.matchMedia;
        window.matchMedia = jest.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
        renderPage();
        const row = await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        fireEvent.click(within(row).getByRole('button', { name: /Volatility 100 Index/ }));
        expect(screen.getByTestId('voltrex-page')).toHaveAttribute('data-view', 'market');
        fireEvent.click(screen.getByTestId('voltrex-go-trade'));
        expect(screen.getByTestId('voltrex-page')).toHaveAttribute('data-view', 'trade');
        window.matchMedia = original;
    });

    it('stays on the scanner view when a market is chosen on a wide screen', async () => {
        renderPage();
        const row = await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        fireEvent.click(within(row).getByRole('button', { name: /Volatility 100 Index/ }));
        expect(screen.getByTestId('voltrex-page')).toHaveAttribute('data-view', 'scan');
    });

    it('shows a retry when the list of markets cannot be loaded', async () => {
        ws.activeSymbols.mockRejectedValue(new Error('offline'));
        renderPage();
        expect(await screen.findByText(/list of markets could not be loaded/, undefined, SLOW)).toBeInTheDocument();
        ws.activeSymbols.mockResolvedValue(SYMBOLS);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
    });

    it('asks again, instead of marking a market unavailable, when the server says it is being asked too often', async () => {
        let calls = 0;
        ws.getTicksHistory.mockImplementation(async (request: { granularity: number }) => {
            calls += 1;
            return calls <= 2
                ? { error: { code: 'RateLimit', message: 'slow down' } }
                : candlesFor(request.granularity);
        });
        renderPage();
        const row = await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        await waitFor(() => expect(within(row).getByText('BUY')).toBeInTheDocument(), SLOW);
        expect(ws.getTicksHistory.mock.calls[0][0].passthrough).toEqual({ scanner: 'voltrex' });
    });

    it('asks for the list of markets again when the first answer is empty', async () => {
        ws.activeSymbols.mockResolvedValueOnce({ active_symbols: [] }).mockResolvedValue(SYMBOLS);
        renderPage();
        await screen.findByTestId('voltrex-row-R_100', undefined, SLOW);
        expect(ws.activeSymbols.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});
