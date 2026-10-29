import { MemoryRouter } from 'react-router-dom';

import { redirectToLogin, WS } from '@deriv/shared';
import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import Journal from '../journal';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

jest.mock('@deriv/shared', () => ({
    ...jest.requireActual('@deriv/shared'),
    redirectToLogin: jest.fn(),
    WS: { profitTable: jest.fn() },
}));

const profitTable = WS.profitTable as jest.Mock;

const row = (overrides: Record<string, unknown> = {}) => ({
    contract_id: 1,
    underlying_symbol: 'R_100',
    buy_price: 10,
    sell_price: 19,
    payout: 19,
    purchase_time: 100,
    sell_time: 200,
    ...overrides,
});

// +9, -10, +18, -10: 2 of 4 won, net +7
const ROWS = [
    row({ contract_id: 1, sell_time: 200 }),
    row({ contract_id: 2, sell_price: 0, sell_time: 300 }),
    row({ contract_id: 3, underlying_symbol: '1HZ100V', buy_price: 20, sell_price: 38, payout: 38, sell_time: 400 }),
    row({ contract_id: 4, underlying_symbol: '1HZ100V', sell_price: 0, sell_time: 500 }),
];

const renderPage = (client: Record<string, unknown> = {}) =>
    render(
        <MemoryRouter>
            <StoreProvider
                store={mockStore({
                    client: { is_logged_in: true, loginid: 'VRTC1', is_virtual: true, currency: 'USD', ...client },
                })}
            >
                <Journal />
            </StoreProvider>
        </MemoryRouter>
    );

describe('<Journal />', () => {
    beforeEach(() => profitTable.mockReset());

    it('asks a logged-out visitor to log in, and does not call the server', () => {
        renderPage({ is_logged_in: false });
        expect(screen.getByTestId('dt_journal_logged_out')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
        expect(redirectToLogin).toHaveBeenCalled();
        expect(profitTable).not.toHaveBeenCalled();
    });

    it('shows loading, then the numbers worked out from the trades', async () => {
        profitTable.mockResolvedValue({ profit_table: { transactions: ROWS } });
        renderPage();
        expect(screen.getByTestId('dt_journal_loading')).toBeInTheDocument();
        expect(await screen.findByTestId('dt_journal_trades')).toHaveTextContent('4');
        expect(screen.getByTestId('dt_journal_won_lost')).toHaveTextContent('2 / 2');
        expect(screen.getByTestId('dt_journal_win_rate')).toHaveTextContent('50.0%');
        expect(screen.getByTestId('dt_journal_net')).toHaveTextContent('7.00');
        expect(profitTable).toHaveBeenCalledWith(500, 0, {});
    });

    it('compares the win rate with the break-even rate, in words', async () => {
        profitTable.mockResolvedValue({ profit_table: { transactions: ROWS } });
        renderPage();
        const panel = await screen.findByTestId('dt_journal_break_even');
        expect(panel).toHaveTextContent('you need to win 52.6% of trades just to break even');
        expect(panel).toHaveTextContent('below that line');
    });

    it('says so when no payout was reported', async () => {
        profitTable.mockResolvedValue({ profit_table: { transactions: [row({ payout: undefined })] } });
        renderPage();
        expect(await screen.findByTestId('dt_journal_break_even')).toHaveTextContent('cannot be worked out');
    });

    it('lists each market with its result, best first', async () => {
        profitTable.mockResolvedValue({ profit_table: { transactions: ROWS } });
        renderPage();
        await screen.findByTestId('dt_journal_trades');
        const rows = screen.getAllByTestId('dt_journal_market_row');
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText('1HZ100V')).toBeInTheDocument();
        expect(rows[0]).toHaveTextContent('8.00');
        expect(rows[1]).toHaveTextContent('-$1.00');
        expect(screen.getByTestId('dt_journal_extremes')).toHaveTextContent('Biggest win: $18.00 on 1HZ100V.');
    });

    it('narrows to the latest trades with the range buttons', async () => {
        profitTable.mockResolvedValue({ profit_table: { transactions: ROWS } });
        renderPage();
        await screen.findByTestId('dt_journal_trades');
        fireEvent.click(screen.getByRole('button', { name: 'Last 20' }));
        expect(screen.getByTestId('dt_journal_trades')).toHaveTextContent('4');
        expect(screen.getByRole('button', { name: 'Last 20' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows an empty state when there are no finished trades', async () => {
        profitTable.mockResolvedValue({ profit_table: { transactions: [] } });
        renderPage();
        expect(await screen.findByTestId('dt_journal_empty')).toBeInTheDocument();
    });

    it('shows the server error and tries again on request', async () => {
        profitTable.mockResolvedValueOnce({ error: { message: 'Something went wrong' } });
        profitTable.mockResolvedValueOnce({ profit_table: { transactions: ROWS } });
        renderPage();
        expect(await screen.findByTestId('dt_journal_error')).toHaveTextContent('Something went wrong');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByTestId('dt_journal_trades')).toBeInTheDocument();
        expect(profitTable).toHaveBeenCalledTimes(2);
    });

    it('shows an error when the request itself fails', async () => {
        profitTable.mockRejectedValue(new Error('socket closed'));
        renderPage();
        expect(await screen.findByTestId('dt_journal_error')).toHaveTextContent('socket closed');
    });

    it('always says past results do not predict future ones, and never ranks or praises', async () => {
        profitTable.mockResolvedValue({ profit_table: { transactions: ROWS } });
        const { container } = renderPage();
        await screen.findByTestId('dt_journal_trades');
        expect(container).toHaveTextContent('Past results do not predict future ones');
        expect(container).not.toHaveTextContent(/hot streak|on fire|top trader|leaderboard|guarantee/i);
    });
});
