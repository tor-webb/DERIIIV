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

import './app-shell.scss';

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

    return (
        <div
            className={classNames('app-shell', {
                'app-shell--has-top-nav': !isMobile,
                'app-shell--off-trade': location.pathname !== routes.index,
            })}
        >
            {!isMobile && <TopNav />}
            <div className='app-shell__body'>
                {!isMobile && <Sidebar />}
                <div className='app-shell__main-content'>
                    <Router />
                </div>
            </div>
        </div>
    );
});

export default AppShell;
