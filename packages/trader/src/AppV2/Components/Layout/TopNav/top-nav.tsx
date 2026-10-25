import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import classNames from 'classnames';

import { formatMoney, getBrandLogo, getBrandLogoDark, getBrandName, getUrlBase, routes } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import './top-nav.scss';

type TNavItem = {
    id: string;
    label: string;
    path: string;
    exact?: boolean;
};

const TopNav = observer(() => {
    const { client, ui } = useStore();
    const history = useHistory();
    const location = useLocation();
    const { is_logged_in, balance, currency, loginid } = client;
    const { is_dark_mode_on, closeSidebarFlyout } = ui;

    const items: TNavItem[] = [
        { id: 'dashboard', label: localize('Dashboard'), path: routes.dashboard },
        { id: 'trade', label: localize('Trade'), path: routes.index, exact: true },
        { id: 'charts', label: localize('Charts'), path: routes.charts },
        { id: 'bot_builder', label: localize('Bot Builder'), path: routes.bot_builder },
        ...(is_logged_in ? [{ id: 'reports', label: localize('Reports'), path: routes.reports }] : []),
    ];

    const isActive = (item: TNavItem) =>
        item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

    const go = (path: string) => {
        closeSidebarFlyout();
        history.push(path);
    };

    return (
        <header className='top-nav' data-testid='dt_top_nav'>
            <button type='button' className='top-nav__brand' onClick={() => go(routes.dashboard)}>
                <img
                    className='top-nav__logo'
                    src={getUrlBase(`/${is_dark_mode_on ? getBrandLogoDark() : getBrandLogo()}`)}
                    alt={getBrandName()}
                />
            </button>
            <nav className='top-nav__items' aria-label={localize('Main navigation')}>
                {items.map(item => (
                    <button
                        key={item.id}
                        type='button'
                        className={classNames('top-nav__item', { 'top-nav__item--active': isActive(item) })}
                        aria-current={isActive(item) ? 'page' : undefined}
                        data-testid={`dt_top_nav_${item.id}`}
                        onClick={() => go(item.path)}
                    >
                        {item.label}
                    </button>
                ))}
            </nav>
            <div className='top-nav__account'>
                {is_logged_in ? (
                    <div className='top-nav__balance' data-testid='dt_top_nav_account'>
                        <span className='top-nav__loginid'>{loginid}</span>
                        <span className='top-nav__amount'>{formatMoney(currency, balance ?? 0, false)}</span>
                    </div>
                ) : (
                    <span className='top-nav__guest'>{localize('Not logged in')}</span>
                )}
            </div>
        </header>
    );
});

export default TopNav;
