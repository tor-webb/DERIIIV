import { MemoryRouter, Route } from 'react-router-dom';

import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen } from '@testing-library/react';

import Dashboard from '../dashboard';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

const renderDashboard = (client: Record<string, unknown> = {}) =>
    render(
        <StoreProvider store={mockStore({ client })}>
            <MemoryRouter initialEntries={['/dashboard']}>
                <Dashboard />
                <Route path='*' render={({ location }) => <span data-testid='dt_location'>{location.pathname}</span>} />
            </MemoryRouter>
        </StoreProvider>
    );

describe('<Dashboard /> simulator cards', () => {
    it('lists the Bulk Trader simulator and the What-if calculator', () => {
        renderDashboard();
        expect(screen.getByText('Bulk Trader simulator')).toBeInTheDocument();
        expect(screen.getByText('What-if calculator')).toBeInTheDocument();
        expect(screen.getByText('Learn to trade')).toBeInTheDocument();
    });

    it('opens each tool from its card', () => {
        renderDashboard();
        fireEvent.click(screen.getByTestId('dt_dashboard_bulk_trader'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/bulk-trader');
        fireEvent.click(screen.getByTestId('dt_dashboard_what_if'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/what-if');
        fireEvent.click(screen.getByTestId('dt_dashboard_learn'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/learn');
    });
});

describe('<Dashboard /> balance', () => {
    const logged_in_client = (is_virtual: boolean) => ({
        is_logged_in: true,
        is_virtual,
        loginid: 'VRTC1',
        balance: 9987,
        currency: 'USD',
    });

    it('shows the amount with its currency symbol as plain text, with no HTML', () => {
        renderDashboard(logged_in_client(true));
        const balance = screen.getByTestId('dt_dashboard_balance');
        expect(balance).toHaveTextContent('$9,987.00');
        expect(balance).not.toHaveTextContent(/[<>]|span/);
    });

    it('labels a demo account', () => {
        renderDashboard(logged_in_client(true));
        expect(screen.getByTestId('dt_dashboard_balance')).toHaveTextContent(/demo/i);
    });
});
