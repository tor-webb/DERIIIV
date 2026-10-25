import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import CopyTrading from '../copy-trading';

const mockConfig = jest.fn();
const mockRedirectToLogin = jest.fn();

jest.mock('@deriv/shared', () => ({
    ...jest.requireActual('@deriv/shared'),
    getCopyTradingConfig: () => mockConfig(),
    redirectToLogin: () => mockRedirectToLogin(),
    WS: {},
}));

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

const logged_in = { is_logged_in: true, is_virtual: true, loginid: 'VRTC1', currency: 'USD' };

const renderPage = (api: { send: jest.Mock }, client: Record<string, unknown> = logged_in) =>
    render(
        <StoreProvider store={mockStore({ client })}>
            <CopyTrading api={api} />
        </StoreProvider>
    );

describe('<CopyTrading />', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockConfig.mockReturnValue({ enabled: true, trader_name: 'Tor', trader_token: 'READONLY' });
    });

    it('says copy trading is not open when no trader token is configured', () => {
        mockConfig.mockReturnValue({ enabled: true, trader_name: 'Tor', trader_token: '' });
        renderPage({ send: jest.fn() });
        expect(screen.getByTestId('dt_copy_unavailable')).toBeInTheDocument();
    });

    it('asks logged-out visitors to log in', () => {
        renderPage({ send: jest.fn() }, { is_logged_in: false });
        fireEvent.click(screen.getByTestId('dt_copy_login'));
        expect(mockRedirectToLogin).toHaveBeenCalled();
    });

    it('needs the risk box ticked before copying can start', async () => {
        const send = jest.fn().mockResolvedValue({ copytrading_list: { traders: [] } });
        renderPage({ send });
        await waitFor(() => expect(send).toHaveBeenCalledWith({ copytrading_list: 1 }));
        const start = await screen.findByTestId('dt_copy_start');
        await waitFor(() => expect(start).toBeDisabled());
        fireEvent.click(screen.getByTestId('dt_copy_consent'));
        await waitFor(() => expect(start).toBeEnabled());
    });

    it('starts copying with the read-only token and the stake limits', async () => {
        const send = jest.fn().mockResolvedValue({ copytrading_list: { traders: [] } });
        renderPage({ send });
        await screen.findByTestId('dt_copy_start');
        fireEvent.change(screen.getByTestId('dt_copy_min'), { target: { value: '1' } });
        fireEvent.change(screen.getByTestId('dt_copy_max'), { target: { value: '20' } });
        fireEvent.click(screen.getByTestId('dt_copy_consent'));
        fireEvent.click(screen.getByTestId('dt_copy_start'));
        await waitFor(() =>
            expect(send).toHaveBeenCalledWith({ copy_start: 'READONLY', min_trade_stake: 1, max_trade_stake: 20 })
        );
        expect(await screen.findByTestId('dt_copy_active')).toHaveTextContent('Copying Tor on VRTC1');
    });

    it("shows Deriv's error and stays stopped when copy_start fails", async () => {
        const send = jest.fn((request: Record<string, unknown>) =>
            request.copytrading_list
                ? Promise.resolve({ copytrading_list: { traders: [] } })
                : Promise.reject(Object.assign(new Error('rejected'), { error: { message: 'Token is not valid.' } }))
        );
        renderPage({ send });
        await screen.findByTestId('dt_copy_start');
        fireEvent.click(screen.getByTestId('dt_copy_consent'));
        fireEvent.click(screen.getByTestId('dt_copy_start'));
        expect(await screen.findByTestId('dt_copy_message')).toHaveTextContent('Token is not valid.');
        expect(screen.queryByTestId('dt_copy_active')).not.toBeInTheDocument();
    });

    it('does not send anything when the stake limits are wrong', async () => {
        const send = jest.fn().mockResolvedValue({ copytrading_list: { traders: [] } });
        renderPage({ send });
        await screen.findByTestId('dt_copy_start');
        fireEvent.change(screen.getByTestId('dt_copy_min'), { target: { value: '10' } });
        fireEvent.change(screen.getByTestId('dt_copy_max'), { target: { value: '5' } });
        fireEvent.click(screen.getByTestId('dt_copy_consent'));
        fireEvent.click(screen.getByTestId('dt_copy_start'));
        expect(await screen.findByTestId('dt_copy_message')).toHaveTextContent('smallest stake cannot be above');
        expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ copy_start: expect.anything() }));
    });

    it('shows Stop copying for an account that is already copying, and stops', async () => {
        const send = jest.fn().mockResolvedValue({ copytrading_list: { traders: [{ token: 'READONLY' }] } });
        renderPage({ send });
        fireEvent.click(await screen.findByTestId('dt_copy_stop'));
        await waitFor(() => expect(send).toHaveBeenCalledWith({ copy_stop: 'READONLY' }));
        expect(await screen.findByTestId('dt_copy_start')).toBeInTheDocument();
    });

    it('warns that real money is at risk on a real account', async () => {
        const send = jest.fn().mockResolvedValue({ copytrading_list: { traders: [] } });
        renderPage({ send }, { ...logged_in, is_virtual: false, loginid: 'CR1' });
        expect(await screen.findByTestId('dt_copy_account')).toHaveTextContent('Real money is at risk');
    });
});
