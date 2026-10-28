import { MemoryRouter, Route } from 'react-router-dom';

import { fireEvent, render, screen, within } from '@testing-library/react';

import { WATCHLIST_STORAGE_KEY } from '../../Markets/markets-config';
import { TMarketRow } from '../../Markets/markets-utils';
import WatchlistPanel from '../watchlist-panel';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (text: string) => text,
}));

let mockRows: TMarketRow[] = [];
const mockUseMarkets = jest.fn((_options?: unknown) => ({ rows: mockRows }));
jest.mock('../../Markets/use-markets', () => ({
    useMarkets: (options?: unknown) => mockUseMarkets(options),
}));

const row = (overrides: Partial<TMarketRow> & { symbol: string }): TMarketRow => ({
    name: overrides.symbol,
    group: 'synthetic',
    status: 'ready',
    price: 100,
    pip_size: 2,
    change_pct: 1.5,
    range_pct: 0.5,
    volatility: 'medium',
    is_closed: false,
    closes: [98, 99, 100],
    ...overrides,
});

const renderPanel = () =>
    render(
        <MemoryRouter initialEntries={['/']}>
            <WatchlistPanel />
            <Route path='*' render={({ location }) => <span data-testid='dt_location'>{location.pathname}</span>} />
        </MemoryRouter>
    );

describe('<WatchlistPanel />', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockRows = [];
    });

    it('asks for no markets and points to the Markets page when nothing is starred', () => {
        renderPanel();
        expect(mockUseMarkets).toHaveBeenCalledWith({ symbols: [] });
        expect(screen.getByTestId('dt_dashboard_watchlist_empty')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Open Markets'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/markets');
    });

    it('loads only the starred markets', () => {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_10', 'frxEURUSD']));
        renderPanel();
        expect(mockUseMarkets).toHaveBeenCalledWith({ symbols: ['R_10', 'frxEURUSD'] });
    });

    it('ignores stored symbols that are not listed or not text', () => {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_10', 'FAKE', 7, null]));
        renderPanel();
        expect(mockUseMarkets).toHaveBeenCalledWith({ symbols: ['R_10'] });
    });

    it('shows each starred market with its price, signed change and a trend line', () => {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_10', 'frxEURUSD']));
        mockRows = [
            row({ symbol: 'R_10', name: 'Volatility 10 Index', price: 123.45, change_pct: 1.5 }),
            row({ symbol: 'frxEURUSD', name: 'EUR/USD', price: 1.0842, pip_size: 4, change_pct: -0.25 }),
        ];
        renderPanel();
        const first = within(screen.getByTestId('dt_dashboard_watch_R_10'));
        expect(first.getByText('Volatility 10 Index')).toBeInTheDocument();
        expect(first.getByText('123.45')).toBeInTheDocument();
        expect(first.getByText('+1.50%')).toBeInTheDocument();
        expect(first.getByTestId('dt_markets_spark')).toBeInTheDocument();
        const second = within(screen.getByTestId('dt_dashboard_watch_frxEURUSD'));
        expect(second.getByText('1.0842')).toBeInTheDocument();
        expect(second.getByText('−0.25%')).toBeInTheDocument();
    });

    it('shows dashes while a market loads and says so when one is unavailable', () => {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_10', 'R_25']));
        mockRows = [
            row({ symbol: 'R_10', status: 'loading', price: null, change_pct: null, closes: [] }),
            row({ symbol: 'R_25', status: 'unavailable', price: null, change_pct: null, closes: [] }),
        ];
        renderPanel();
        expect(
            within(screen.getByTestId('dt_dashboard_watch_R_10')).getByText('–', {
                selector: '.dashboard__watch-price',
            })
        ).toBeInTheDocument();
        expect(within(screen.getByTestId('dt_dashboard_watch_R_25')).getByText('Unavailable')).toBeInTheDocument();
    });

    it('opens the Markets page when a row is pressed', () => {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_10']));
        mockRows = [row({ symbol: 'R_10' })];
        renderPanel();
        fireEvent.click(screen.getByTestId('dt_dashboard_watch_R_10'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/markets');
    });
});
