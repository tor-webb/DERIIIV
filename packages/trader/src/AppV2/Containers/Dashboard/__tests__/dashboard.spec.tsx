import { MemoryRouter } from 'react-router-dom';

import { mockStore, StoreProvider } from '@deriv/stores';
import { render, screen } from '@testing-library/react';

import Dashboard from '../dashboard';

jest.mock('@deriv-com/translations', () => ({
    localize: (key: string) => key,
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
}));

const renderDashboard = (is_virtual: boolean) => {
    const store = mockStore({
        client: { is_logged_in: true, is_virtual, loginid: 'VRTC1', balance: 9987, currency: 'USD' },
    });
    render(
        <StoreProvider store={store}>
            <MemoryRouter>
                <Dashboard />
            </MemoryRouter>
        </StoreProvider>
    );
};

describe('Dashboard balance', () => {
    it('shows the amount and currency as plain text, with no HTML', () => {
        renderDashboard(true);
        const balance = screen.getByTestId('dt_dashboard_balance');
        expect(balance).toHaveTextContent('9,987.00');
        expect(balance).toHaveTextContent('USD');
        expect(balance.textContent).not.toMatch(/[<>]|span/);
    });

    it('labels a demo account', () => {
        renderDashboard(true);
        expect(screen.getByTestId('dt_dashboard_balance')).toHaveTextContent(/demo/i);
    });
});
