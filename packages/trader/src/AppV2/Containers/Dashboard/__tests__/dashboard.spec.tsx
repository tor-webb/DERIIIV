import { MemoryRouter, Route } from 'react-router-dom';

import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen } from '@testing-library/react';

import Dashboard from '../dashboard';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

const renderDashboard = () =>
    render(
        <StoreProvider store={mockStore({})}>
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
