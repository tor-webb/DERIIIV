import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { fetchQuote, fetchTicks } from '../bulk-api';
import BulkTrader from '../bulk-trader';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

jest.mock('../bulk-api', () => ({
    ...jest.requireActual('../bulk-api'),
    fetchTicks: jest.fn(),
    fetchQuote: jest.fn(),
}));

const mockFetchTicks = fetchTicks as jest.Mock;
const mockFetchQuote = fetchQuote as jest.Mock;

/** Last digits 1 2 7 0 5 5 8 3: bought on every tick, Even settles win loss win loss loss win loss (3 wins of 7). */
const ticks = {
    prices: [100.01, 100.12, 100.37, 100.4, 100.55, 100.65, 100.78, 100.83],
    times: [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007],
    pip_size: 2,
};

const renderPage = (client = {}) =>
    render(
        <StoreProvider store={mockStore({ client })}>
            <BulkTrader />
        </StoreProvider>
    );

const run = async () => {
    fireEvent.click(screen.getByTestId('dt_bulk_run'));
    await waitFor(() => expect(screen.getByTestId('dt_bulk_run')).toBeEnabled());
};

describe('<BulkTrader />', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchTicks.mockResolvedValue(ticks);
        mockFetchQuote.mockResolvedValue({ ask_price: 10, payout: 19.5, payout_percent: 95 });
    });

    it('explains itself and shows no result before a run', () => {
        renderPage();
        expect(screen.getByText('Bulk Trader simulator')).toBeInTheDocument();
        expect(screen.queryByTestId('dt_bulk_verdict')).not.toBeInTheDocument();
        expect(mockFetchTicks).not.toHaveBeenCalled();
    });

    it('settles every contract on the ticks and shows the win rate next to break-even', async () => {
        renderPage();
        await run();

        expect(mockFetchTicks).toHaveBeenCalledWith('1HZ100V', 1000);
        expect(mockFetchQuote).toHaveBeenCalledWith(
            expect.objectContaining({ contract_type: 'DIGITEVEN', symbol: '1HZ100V', duration: 1, stake: 10 })
        );
        expect(screen.getByTestId('dt_bulk_wins')).toHaveTextContent('3 / 7');
        // 3 wins of 9.50 and 4 losses of 10
        expect(screen.getByTestId('dt_bulk_profit')).toHaveTextContent(/11\.50/);
        // 3/7 = 42.9% against 100 / 1.95 = 51.3%
        expect(screen.getByTestId('dt_stake_gauge')).toHaveTextContent('Win rate 42.9%');
        expect(screen.getByTestId('dt_stake_gauge')).toHaveTextContent('Break-even 51.3%');
        expect(screen.getByTestId('dt_bulk_verdict')).toHaveTextContent('8.4 points short of break-even');
        expect(screen.getByTestId('dt_bulk_source')).toHaveTextContent('Payout from a live quote: 95.00%');
        expect(screen.getByTestId('dt_bulk_table')).toBeInTheDocument();
    });

    it('uses the payout the user typed when the live quote fails, and says so', async () => {
        mockFetchQuote.mockRejectedValue(new Error('No quote for this duration.'));
        renderPage();
        await run();

        expect(screen.getByTestId('dt_bulk_quote_error')).toHaveTextContent('No quote for this duration.');
        expect(screen.getByTestId('dt_bulk_source')).toHaveTextContent('Payout you entered: 95.00%');
        expect(screen.getByTestId('dt_bulk_wins')).toHaveTextContent('3 / 7');
    });

    it('does not ask for a quote when the live payout is turned off', async () => {
        renderPage();
        fireEvent.click(screen.getByTestId('dt_bulk_live_payout'));
        fireEvent.change(screen.getByTestId('dt_bulk_payout'), { target: { value: '100' } });
        await run();

        expect(mockFetchQuote).not.toHaveBeenCalled();
        // 100% payout breaks even at 50%
        expect(screen.getByTestId('dt_stake_gauge')).toHaveTextContent('Break-even 50.0%');
        // 3 wins of 10 and 4 losses of 10
        expect(screen.getByTestId('dt_bulk_profit')).toHaveTextContent(/10\.00/);
    });

    it('shows the server message when the ticks cannot be fetched', async () => {
        mockFetchTicks.mockRejectedValue(new Error('Market is closed.'));
        renderPage();
        await run();

        expect(screen.getByTestId('dt_bulk_error')).toHaveTextContent('Market is closed.');
        expect(screen.queryByTestId('dt_bulk_verdict')).not.toBeInTheDocument();
    });

    it('checks the inputs before it asks the server for anything', async () => {
        renderPage();
        fireEvent.change(screen.getByTestId('dt_bulk_duration'), { target: { value: '0' } });
        fireEvent.click(screen.getByTestId('dt_bulk_run'));

        expect(screen.getByTestId('dt_bulk_error')).toHaveTextContent('Check the duration');
        expect(mockFetchTicks).not.toHaveBeenCalled();
    });

    it('moves the duration up to the shortest one the platform offers for Rise', () => {
        renderPage();
        fireEvent.change(screen.getByTestId('dt_bulk_contract'), { target: { value: 'CALL' } });
        expect(screen.getByTestId('dt_bulk_duration')).toHaveValue(5);
    });

    it('asks for a prediction only on contracts that need one', () => {
        renderPage();
        expect(screen.queryByTestId('dt_bulk_barrier')).not.toBeInTheDocument();
        fireEvent.change(screen.getByTestId('dt_bulk_contract'), { target: { value: 'DIGITOVER' } });
        expect(screen.getByTestId('dt_bulk_barrier')).toBeInTheDocument();
    });

    it('sends the prediction with the quote request', async () => {
        renderPage();
        fireEvent.change(screen.getByTestId('dt_bulk_contract'), { target: { value: 'DIGITOVER' } });
        fireEvent.change(screen.getByTestId('dt_bulk_barrier'), { target: { value: '3' } });
        await run();
        expect(mockFetchQuote).toHaveBeenCalledWith(
            expect.objectContaining({ contract_type: 'DIGITOVER', barrier: 3 })
        );
    });

    it('warns that the results are out of date when a setting changes after a run', async () => {
        renderPage();
        await run();
        expect(screen.queryByTestId('dt_bulk_stale')).not.toBeInTheDocument();
        fireEvent.change(screen.getByTestId('dt_bulk_base_stake'), { target: { value: '20' } });
        expect(screen.getByTestId('dt_bulk_stale')).toBeInTheDocument();
    });

    it('stops a martingale that cannot fund the next stake', async () => {
        renderPage();
        fireEvent.change(screen.getByTestId('dt_bulk_balance'), { target: { value: '25' } });
        fireEvent.change(screen.getByTestId('dt_bulk_plan'), { target: { value: 'martingale' } });
        fireEvent.change(screen.getByTestId('dt_bulk_contract'), { target: { value: 'DIGITODD' } });
        await run();
        // Odd loses on the first exit digit (2): balance 15, the doubled stake of 20 cannot be paid
        expect(screen.getByTestId('dt_bulk_wins')).toHaveTextContent('0 / 1');
        expect(screen.getByText('The balance could not cover the next stake.')).toBeInTheDocument();
    });

    it('starts from the account balance when logged in', () => {
        renderPage({ is_logged_in: true, balance: '2500', currency: 'USD' });
        expect(screen.getByTestId('dt_bulk_balance')).toHaveValue(2500);
    });
});
