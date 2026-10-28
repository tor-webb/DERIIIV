import { MemoryRouter, Route } from 'react-router-dom';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import Markets from '../markets';
import { WATCHLIST_STORAGE_KEY } from '../markets-config';
import { TMarketRow } from '../markets-utils';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const mockOnChange = jest.fn();
const mockProcessContracts = jest.fn();
let mockStoreSymbol = 'R_100';
jest.mock('Stores/useTraderStores', () => ({
    useTraderStore: () => ({
        onChange: mockOnChange,
        processContractsForV2: mockProcessContracts,
        symbol: mockStoreSymbol,
    }),
}));

let mockState: { rows: TMarketRow[]; is_loading: boolean; updated_at: number | null; retry: jest.Mock },
    mockUseMarketsOptions: unknown;
jest.mock('../use-markets', () => ({
    useMarkets: (options: unknown) => {
        mockUseMarketsOptions = options;
        return mockState;
    },
}));

const row = (overrides: Partial<TMarketRow> & { symbol: string }): TMarketRow => ({
    name: overrides.symbol,
    group: 'synthetic',
    status: 'ready',
    price: 100,
    pip_size: 2,
    change_pct: 0,
    range_pct: 0.5,
    volatility: 'medium',
    is_closed: false,
    closes: [99, 101, 100],
    ...overrides,
});

const ROWS: TMarketRow[] = [
    row({ symbol: 'R_10', name: 'Volatility 10 Index', change_pct: 0.4, range_pct: 0.2, volatility: 'low' }),
    row({ symbol: 'R_100', name: 'Volatility 100 Index', change_pct: 1.8, range_pct: 1.1, volatility: 'high' }),
    row({ symbol: 'frxEURUSD', name: 'EUR/USD', group: 'forex', price: 1.0842, pip_size: 4, change_pct: -0.2 }),
    row({ symbol: 'frxGBPUSD', name: 'GBP/USD', group: 'forex', status: 'unavailable', price: null, change_pct: null }),
];

const renderPage = () =>
    render(
        <MemoryRouter initialEntries={['/markets']}>
            <Markets />
            <Route
                path='*'
                render={({ location }) => (
                    <span data-testid='dt_location'>
                        {location.pathname}
                        {location.search}
                    </span>
                )}
            />
        </MemoryRouter>
    );

describe('<Markets />', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockStoreSymbol = 'R_100';
        mockOnChange.mockResolvedValue(undefined);
        mockState = { rows: ROWS, is_loading: false, updated_at: Date.now(), retry: jest.fn() };
    });

    it('shows each market with its price, change, range and volatility', () => {
        renderPage();
        const r100 = within(screen.getByTestId('dt_markets_row_R_100'));
        expect(r100.getByText('Volatility 100 Index')).toBeInTheDocument();
        expect(r100.getByText('100.00')).toBeInTheDocument();
        expect(r100.getByText(/\+1\.80%/)).toBeInTheDocument();
        expect(r100.getByText('1.10%')).toBeInTheDocument();
        expect(r100.getByText('High')).toBeInTheDocument();
        expect(within(screen.getByTestId('dt_markets_row_frxEURUSD')).getByText('1.0842')).toBeInTheDocument();
        expect(within(screen.getByTestId('dt_markets_row_frxGBPUSD')).getByText('Unavailable')).toBeInTheDocument();
    });

    it('shows the direction with an arrow as well as colour', () => {
        renderPage();
        expect(within(screen.getByTestId('dt_markets_row_R_100')).getByText(/▲/)).toBeInTheDocument();
        expect(within(screen.getByTestId('dt_markets_row_frxEURUSD')).getByText(/▼/)).toBeInTheDocument();
    });

    it('lists the top gainers and losers', () => {
        renderPage();
        const gainers = within(screen.getByTestId('dt_markets_gainers'));
        expect(gainers.getAllByRole('button').map(button => button.textContent)).toEqual([
            expect.stringContaining('Volatility 100 Index'),
            expect.stringContaining('Volatility 10 Index'),
        ]);
        expect(within(screen.getByTestId('dt_markets_losers')).getByText('EUR/USD')).toBeInTheDocument();
    });

    it('says so when nobody is up or down', () => {
        mockState = { ...mockState, rows: [row({ symbol: 'R_10', change_pct: 0 })] };
        renderPage();
        expect(screen.getByText('No market is up right now.')).toBeInTheDocument();
        expect(screen.getByText('No market is down right now.')).toBeInTheDocument();
    });

    it('filters by Derived and Forex', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('dt_markets_filter_forex'));
        expect(screen.queryByTestId('dt_markets_row_R_10')).not.toBeInTheDocument();
        expect(screen.getByTestId('dt_markets_row_frxEURUSD')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('dt_markets_filter_synthetic'));
        expect(screen.getByTestId('dt_markets_row_R_10')).toBeInTheDocument();
        expect(screen.queryByTestId('dt_markets_row_frxEURUSD')).not.toBeInTheDocument();
    });

    it('sorts by the biggest move', () => {
        renderPage();
        fireEvent.change(screen.getByTestId('dt_markets_sort'), { target: { value: 'change' } });
        const order = within(screen.getByTestId('dt_markets_list'))
            .getAllByTestId(/dt_markets_row_/)
            .map(item => item.getAttribute('data-testid'));
        expect(order).toEqual([
            'dt_markets_row_R_100',
            'dt_markets_row_R_10',
            'dt_markets_row_frxEURUSD',
            'dt_markets_row_frxGBPUSD',
        ]);
    });

    describe('watchlist', () => {
        it('starts empty and explains how to add a market', () => {
            renderPage();
            fireEvent.click(screen.getByTestId('dt_markets_filter_watchlist'));
            expect(screen.getByTestId('dt_markets_empty')).toHaveTextContent('Your watchlist is empty');
        });

        it('stars a market, keeps it in storage and shows it under Watchlist', () => {
            renderPage();
            const star = screen.getByTestId('dt_markets_star_frxEURUSD');
            expect(star).toHaveAttribute('aria-pressed', 'false');
            fireEvent.click(star);
            expect(star).toHaveAttribute('aria-pressed', 'true');
            expect(JSON.parse(localStorage.getItem(WATCHLIST_STORAGE_KEY) ?? '[]')).toEqual(['frxEURUSD']);

            fireEvent.click(screen.getByTestId('dt_markets_filter_watchlist'));
            expect(screen.getByTestId('dt_markets_row_frxEURUSD')).toBeInTheDocument();
            expect(screen.queryByTestId('dt_markets_row_R_10')).not.toBeInTheDocument();
        });

        it('remembers the stars the next time the page opens', () => {
            localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_10']));
            renderPage();
            expect(screen.getByTestId('dt_markets_star_R_10')).toHaveAttribute('aria-pressed', 'true');
        });

        it('removes a market when its star is tapped again', () => {
            localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_10']));
            renderPage();
            fireEvent.click(screen.getByTestId('dt_markets_star_R_10'));
            expect(JSON.parse(localStorage.getItem(WATCHLIST_STORAGE_KEY) ?? '[]')).toEqual([]);
        });
    });

    describe('opening the Trade page', () => {
        it('switches the Trade page to the market and goes there', async () => {
            renderPage();
            fireEvent.click(screen.getByTestId('dt_markets_trade_frxEURUSD'));
            await waitFor(() => expect(screen.getByTestId('dt_location')).toHaveTextContent('/?symbol=frxEURUSD'));
            expect(mockOnChange).toHaveBeenCalledWith({ target: { name: 'symbol', value: 'frxEURUSD' } });
            expect(mockProcessContracts).toHaveBeenCalledTimes(1);
        });

        it('does not reload the market when the Trade page already has it', async () => {
            renderPage();
            fireEvent.click(screen.getByTestId('dt_markets_trade_R_100'));
            await waitFor(() => expect(screen.getByTestId('dt_location')).toHaveTextContent('/?symbol=R_100'));
            expect(mockOnChange).not.toHaveBeenCalled();
        });

        it('still goes to the Trade page if switching the symbol fails', async () => {
            mockOnChange.mockRejectedValue(new Error('not offered'));
            renderPage();
            fireEvent.click(screen.getByTestId('dt_markets_trade_R_10'));
            await waitFor(() => expect(screen.getByTestId('dt_location')).toHaveTextContent('/?symbol=R_10'));
        });

        it('opens a top mover too, and cannot open an unavailable market', async () => {
            renderPage();
            expect(screen.getByTestId('dt_markets_trade_frxGBPUSD')).toBeDisabled();
            fireEvent.click(within(screen.getByTestId('dt_markets_losers')).getByText('EUR/USD'));
            await waitFor(() => expect(screen.getByTestId('dt_location')).toHaveTextContent('/?symbol=frxEURUSD'));
        });
    });

    describe('building a bot for a market', () => {
        it('opens Bot Builder with the market in the address', async () => {
            renderPage();
            fireEvent.click(screen.getByTestId('dt_markets_bot_R_10'));
            await waitFor(() =>
                expect(screen.getByTestId('dt_location')).toHaveTextContent('/bot-builder?market=R_10')
            );
            expect(mockOnChange).not.toHaveBeenCalled();
        });

        it('works for a forex pair that Bot Builder trades', async () => {
            renderPage();
            fireEvent.click(screen.getByTestId('dt_markets_bot_frxEURUSD'));
            await waitFor(() =>
                expect(screen.getByTestId('dt_location')).toHaveTextContent('/bot-builder?market=frxEURUSD')
            );
        });

        it('is switched off, with a reason, for a market Bot Builder cannot trade yet', () => {
            mockState = { ...mockState, rows: [row({ symbol: 'frxNZDUSD', name: 'NZD/USD', group: 'forex' })] };
            renderPage();
            const button = screen.getByTestId('dt_markets_bot_frxNZDUSD');
            expect(button).toBeDisabled();
            expect(button).toHaveAttribute('title', 'Bot Builder cannot trade this market yet');
            // Trade still works for it
            expect(screen.getByTestId('dt_markets_trade_frxNZDUSD')).toBeEnabled();
        });

        it('is switched off for a market that is unavailable', () => {
            renderPage();
            expect(screen.getByTestId('dt_markets_bot_frxGBPUSD')).toBeDisabled();
        });
    });

    describe('loading and errors', () => {
        it('says it is loading until the first prices arrive', () => {
            mockState = {
                ...mockState,
                is_loading: true,
                updated_at: null,
                rows: ROWS.map(item => ({
                    ...item,
                    status: 'loading' as const,
                    price: null,
                    change_pct: null,
                    range_pct: null,
                    volatility: null,
                })),
            };
            renderPage();
            expect(screen.getByTestId('dt_markets_status')).toHaveTextContent('Loading markets…');
        });

        it('offers to try again when no market could be loaded', () => {
            mockState = { ...mockState, rows: ROWS.map(item => ({ ...item, status: 'unavailable' as const })) };
            renderPage();
            expect(screen.getByTestId('dt_markets_error')).toBeInTheDocument();
            fireEvent.click(within(screen.getByTestId('dt_markets_error')).getByText('Try again'));
            expect(mockState.retry).toHaveBeenCalledTimes(1);
        });

        it('mentions markets that are unavailable when others loaded', () => {
            renderPage();
            expect(screen.getByText(/Some markets are unavailable/)).toBeInTheDocument();
            expect(screen.queryByTestId('dt_markets_error')).not.toBeInTheDocument();
        });

        it('shows a Closed tag and no volatility badge for a market that stopped ticking', () => {
            mockState = {
                ...mockState,
                rows: [
                    row({ symbol: 'frxEURUSD', name: 'EUR/USD', group: 'forex', is_closed: true, volatility: null }),
                ],
            };
            renderPage();
            const eurusd = within(screen.getByTestId('dt_markets_row_frxEURUSD'));
            expect(eurusd.getByText('Closed')).toBeInTheDocument();
            expect(eurusd.queryByText('Medium')).not.toBeInTheDocument();
        });
    });

    it('reminds the reader that volatility is not a forecast', () => {
        renderPage();
        expect(screen.getByText(/not which way it will go next/)).toBeInTheDocument();
    });
});

describe('<Markets /> search, window, trend and charts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockStoreSymbol = 'R_100';
        mockOnChange.mockResolvedValue(undefined);
        mockState = { rows: ROWS, is_loading: false, updated_at: Date.now(), retry: jest.fn() };
    });

    const shownSymbols = () =>
        within(screen.getByTestId('dt_markets_list'))
            .getAllByTestId(/dt_markets_row_/)
            .map(item => item.getAttribute('data-testid'));

    it('filters the list as the reader types, by name or symbol, ignoring case and slashes', () => {
        renderPage();
        const box = screen.getByTestId('dt_markets_search');
        fireEvent.change(box, { target: { value: 'eur/usd' } });
        expect(shownSymbols()).toEqual(['dt_markets_row_frxEURUSD']);
        fireEvent.change(box, { target: { value: 'VOLATILITY' } });
        expect(shownSymbols()).toEqual(['dt_markets_row_R_10', 'dt_markets_row_R_100']);
        fireEvent.change(box, { target: { value: 'r_100' } });
        expect(shownSymbols()).toEqual(['dt_markets_row_R_100']);
    });

    it('works together with the Derived and Forex pills', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('dt_markets_filter_forex'));
        fireEvent.change(screen.getByTestId('dt_markets_search'), { target: { value: 'usd' } });
        expect(shownSymbols()).toEqual(['dt_markets_row_frxEURUSD', 'dt_markets_row_frxGBPUSD']);
        fireEvent.change(screen.getByTestId('dt_markets_search'), { target: { value: 'r_10' } });
        expect(screen.getByTestId('dt_markets_empty')).toBeInTheDocument();
    });

    it('says which search found nothing, and brings the list back when the box is cleared', () => {
        renderPage();
        const box = screen.getByTestId('dt_markets_search');
        fireEvent.change(box, { target: { value: 'zzz' } });
        expect(screen.getByTestId('dt_markets_empty')).toHaveTextContent('No market matches "zzz".');
        fireEvent.change(box, { target: { value: '' } });
        expect(shownSymbols()).toHaveLength(4);
    });

    it('starts on 1h and asks for another window when a pill is pressed', () => {
        renderPage();
        expect(mockUseMarketsOptions).toEqual({ window_id: '1h' });
        expect(screen.getByTestId('dt_markets_window_1h')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('dt_markets_window_4h'));
        expect(mockUseMarketsOptions).toEqual({ window_id: '4h' });
        expect(screen.getByTestId('dt_markets_window_4h')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('dt_markets_window_1h')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByTestId('dt_markets_window_1d'));
        expect(mockUseMarketsOptions).toEqual({ window_id: '1d' });
    });

    it('relabels the columns and the movers from the window', () => {
        renderPage();
        expect(screen.getByText('1h change')).toBeInTheDocument();
        expect(screen.getByText('Top gainers (1h)')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('dt_markets_window_1d'));
        expect(screen.getByText('1d change')).toBeInTheDocument();
        expect(screen.getByText('1d range')).toBeInTheDocument();
        expect(screen.getByText('Top losers (1d)')).toBeInTheDocument();
        expect(screen.queryByText('1h change')).not.toBeInTheDocument();
    });

    it('draws a trend line for a market with prices, coloured by direction, and a dash when it has none', () => {
        mockState = {
            ...mockState,
            rows: [
                row({ symbol: 'R_10', change_pct: 1, closes: [1, 2, 3] }),
                row({ symbol: 'R_25', change_pct: -1, closes: [3, 2, 1] }),
                row({ symbol: 'R_50', change_pct: null, price: null, closes: [] }),
            ],
        };
        renderPage();
        const up = within(screen.getByTestId('dt_markets_row_R_10')).getByTestId('dt_markets_spark');
        const down = within(screen.getByTestId('dt_markets_row_R_25')).getByTestId('dt_markets_spark');
        expect(up).toHaveClass('markets__spark--up');
        expect(down).toHaveClass('markets__spark--down');
        expect(within(up).getByTestId('dt_markets_spark_line')).toHaveAttribute('points');
        expect(
            within(screen.getByTestId('dt_markets_row_R_50')).queryByTestId('dt_markets_spark')
        ).not.toBeInTheDocument();
    });

    it('opens Charts for the market, switching the symbol first', async () => {
        renderPage();
        fireEvent.click(screen.getByTestId('dt_markets_chart_frxEURUSD'));
        await waitFor(() => expect(screen.getByTestId('dt_location')).toHaveTextContent('/charts?symbol=frxEURUSD'));
        expect(mockOnChange).toHaveBeenCalledWith({ target: { name: 'symbol', value: 'frxEURUSD' } });
        expect(mockProcessContracts).toHaveBeenCalledTimes(1);
    });

    it('does not switch the symbol again when Charts is opened for the current market', async () => {
        renderPage();
        fireEvent.click(screen.getByTestId('dt_markets_chart_R_100'));
        await waitFor(() => expect(screen.getByTestId('dt_location')).toHaveTextContent('/charts?symbol=R_100'));
        expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('still opens Charts when switching the symbol fails', async () => {
        mockOnChange.mockRejectedValue(new Error('no'));
        renderPage();
        fireEvent.click(screen.getByTestId('dt_markets_chart_frxEURUSD'));
        await waitFor(() => expect(screen.getByTestId('dt_location')).toHaveTextContent('/charts?symbol=frxEURUSD'));
    });

    it('turns the Charts button off for an unavailable market', () => {
        renderPage();
        expect(screen.getByTestId('dt_markets_chart_frxGBPUSD')).toBeDisabled();
    });
});
