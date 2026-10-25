import { MemoryRouter, Route } from 'react-router-dom';

import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen } from '@testing-library/react';

import TopNav from '../top-nav';

jest.mock('@deriv-com/translations', () => ({
    localize: (key: string) => key,
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
}));

const renderTopNav = (path = '/', is_logged_in = false) => {
    const store = mockStore({ client: { is_logged_in, loginid: 'CR123', balance: '10', currency: 'USD' } });
    render(
        <StoreProvider store={store}>
            <MemoryRouter initialEntries={[path]}>
                <TopNav />
                <Route path='*' render={({ location }) => <div data-testid='dt_location'>{location.pathname}</div>} />
            </MemoryRouter>
        </StoreProvider>
    );
};

describe('TopNav', () => {
    it('shows Dashboard, Trade, Charts and Bot Builder, and hides Reports when logged out', () => {
        renderTopNav();
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Trade')).toBeInTheDocument();
        expect(screen.getByText('Charts')).toBeInTheDocument();
        expect(screen.getByText('Bot Builder')).toBeInTheDocument();
        expect(screen.queryByText('Reports')).not.toBeInTheDocument();
    });

    it('shows Reports and the account balance when logged in', () => {
        renderTopNav('/', true);
        expect(screen.getByText('Reports')).toBeInTheDocument();
        expect(screen.getByText('CR123')).toBeInTheDocument();
    });

    it('marks the current page as active', () => {
        renderTopNav('/charts');
        expect(screen.getByTestId('dt_top_nav_charts')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByTestId('dt_top_nav_trade')).not.toHaveAttribute('aria-current');
    });

    it('navigates when a tab is clicked', () => {
        renderTopNav('/');
        fireEvent.click(screen.getByTestId('dt_top_nav_dashboard'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/dashboard');
        fireEvent.click(screen.getByTestId('dt_top_nav_charts'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/charts');
        fireEvent.click(screen.getByTestId('dt_top_nav_bot_builder'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/bot-builder');
    });
});
