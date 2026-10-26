import React from 'react';
import { useLocation } from 'react-router-dom';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';

import { routes } from '@deriv/shared';
import { useStore } from '@deriv/stores';
import { useDevice } from '@deriv-com/ui';

import Sidebar from 'AppV2/Components/Layout/Sidebar/sidebar';
import TopNav from 'AppV2/Components/Layout/TopNav';

import Router from '../../Routes/router';
import Assistant from '../Assistant';

import './app-shell.scss';

// Pages that get the phone tab bar (the Trade page is matched exactly, below, because '/' prefixes every path).
const MOBILE_NAV_ROUTES = [
    routes.dashboard,
    routes.charts,
    routes.bot_builder,
    routes.bulk_trader,
    routes.risk_calculator,
    routes.what_if,
    routes.learn,
    routes.copy_trading,
];

const AppShell = observer(() => {
    const { ui } = useStore();
    const { active_sidebar_flyout } = ui;
    const { isMobile } = useDevice();
    const location = useLocation();

    React.useEffect(() => {
        if (active_sidebar_flyout && location.pathname !== routes.index) {
            ui.closeSidebarFlyout();
        }
    }, [location.pathname]);

    const has_mobile_nav =
        isMobile &&
        (location.pathname === routes.index || MOBILE_NAV_ROUTES.some(route => location.pathname.startsWith(route)));

    return (
        <div
            className={classNames('app-shell', {
                'app-shell--has-top-nav': !isMobile,
                'app-shell--has-mobile-nav': has_mobile_nav,
                'app-shell--off-trade': location.pathname !== routes.index,
            })}
        >
            {!isMobile && <TopNav />}
            {has_mobile_nav && <TopNav is_mobile />}
            <div className='app-shell__body'>
                {!isMobile && <Sidebar />}
                <div className='app-shell__main-content'>
                    <Router />
                </div>
            </div>
            <Assistant />
        </div>
    );
});

export default AppShell;
