import { MemoryRouter } from 'react-router-dom';

import { mockStore, StoreProvider } from '@deriv/stores';
import { useDevice } from '@deriv-com/ui';
import { render, screen } from '@testing-library/react';

import AppShell from '../app-shell';

jest.mock('@deriv-com/ui', () => ({ ...jest.requireActual('@deriv-com/ui'), useDevice: jest.fn() }));
jest.mock('../../../Routes/router', () => {
    const Router = () => <div>router</div>;
    return Router;
});
jest.mock('../../Assistant', () => {
    const Assistant = () => null;
    return Assistant;
});
jest.mock('AppV2/Components/Layout/Sidebar/sidebar', () => {
    const Sidebar = () => <div data-testid='dt_sidebar' />;
    return Sidebar;
});
jest.mock('AppV2/Components/Layout/TopNav', () => {
    const TopNav = ({ is_mobile }: { is_mobile?: boolean }) => (
        <div data-testid={is_mobile ? 'dt_top_nav_mobile' : 'dt_top_nav_desktop'} />
    );
    return TopNav;
});

const renderShell = (path: string, isMobile: boolean) => {
    (useDevice as jest.Mock).mockReturnValue({ isMobile });
    return render(
        <StoreProvider store={mockStore({})}>
            <MemoryRouter initialEntries={[path]}>
                <AppShell />
            </MemoryRouter>
        </StoreProvider>
    );
};

describe('<AppShell /> navigation', () => {
    it.each(['/', '/dashboard', '/bot-builder', '/learn', '/charts'])('shows the phone tab bar on %s', path => {
        renderShell(path, true);
        expect(screen.getByTestId('dt_top_nav_mobile')).toBeInTheDocument();
        expect(screen.queryByTestId('dt_top_nav_desktop')).not.toBeInTheDocument();
    });

    it('does not show the phone tab bar on pages outside the FiscoFX tabs', () => {
        renderShell('/contract/123', true);
        expect(screen.queryByTestId('dt_top_nav_mobile')).not.toBeInTheDocument();
    });

    it('shows the desktop top nav and sidebar, not the phone bar, on desktop', () => {
        renderShell('/', false);
        expect(screen.getByTestId('dt_top_nav_desktop')).toBeInTheDocument();
        expect(screen.getByTestId('dt_sidebar')).toBeInTheDocument();
        expect(screen.queryByTestId('dt_top_nav_mobile')).not.toBeInTheDocument();
    });
});
