import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import classNames from 'classnames';

import { formatMoneyText, getBrandLogo, getBrandLogoDark, getBrandName, getUrlBase, routes } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import { countUnread } from 'AppV2/Containers/News/news-utils';
import { useNews } from 'AppV2/Containers/News/use-news';

import './top-nav.scss';

type TNavItem = {
    id: string;
    label: string;
    path: string;
    exact?: boolean;
};

type TTopNavProps = {
    /** Compact phone layout: slim top bar plus a scrollable tab bar fixed to the bottom of the screen. */
    is_mobile?: boolean;
};

const TopNav = observer(({ is_mobile = false }: TTopNavProps) => {
    const { client, ui } = useStore();
    const nav_ref = React.useRef<HTMLElement>(null);
    const history = useHistory();
    const location = useLocation();
    const { is_logged_in, balance, currency, loginid } = client;
    const { is_dark_mode_on, closeSidebarFlyout } = ui;
    const { feed } = useNews();
    const news_unread = location.pathname === routes.news ? 0 : countUnread(feed);

    const items: TNavItem[] = [
        { id: 'dashboard', label: localize('Dashboard'), path: routes.dashboard },
        { id: 'trade', label: localize('Trade'), path: routes.index, exact: true },
        { id: 'charts', label: localize('Charts'), path: routes.charts },
        { id: 'bot_builder', label: localize('Bot Builder'), path: routes.bot_builder },
        { id: 'bulk_trader', label: localize('Bulk Trader'), path: routes.bulk_trader },
        { id: 'risk_calculator', label: localize('Risk'), path: routes.risk_calculator },
        { id: 'what_if', label: localize('What-if'), path: routes.what_if },
        { id: 'news', label: localize('News'), path: routes.news },
        { id: 'learn', label: localize('Learn'), path: routes.learn },
        { id: 'copy_trading', label: localize('Copy trading'), path: routes.copy_trading },
        ...(is_logged_in ? [{ id: 'reports', label: localize('Reports'), path: routes.reports }] : []),
    ];

    const isActive = (item: TNavItem) =>
        item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

    // On phones the tab bar scrolls sideways, so keep the current tab in view
    React.useEffect(() => {
        if (!is_mobile) return;
        const active = nav_ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
        active?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
    }, [is_mobile, location.pathname]);

    const go = (path: string) => {
        closeSidebarFlyout();
        history.push(path);
    };

    return (
        <header className={classNames('top-nav', { 'top-nav--mobile': is_mobile })} data-testid='dt_top_nav'>
            <button type='button' className='top-nav__brand' onClick={() => go(routes.dashboard)}>
                <img
                    className='top-nav__logo'
                    src={getUrlBase(`/${is_dark_mode_on ? getBrandLogoDark() : getBrandLogo()}`)}
                    alt={getBrandName()}
                />
            </button>
            <nav ref={nav_ref} className='top-nav__items' aria-label={localize('Main navigation')}>
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
                        {item.id === 'news' && news_unread > 0 && (
                            <span className='top-nav__badge' data-testid='dt_top_nav_news_badge'>
                                {news_unread > 9 ? '9+' : news_unread}
                            </span>
                        )}
                    </button>
                ))}
            </nav>
            <div className='top-nav__account'>
                {is_logged_in ? (
                    <div className='top-nav__balance' data-testid='dt_top_nav_account'>
                        <span className='top-nav__loginid'>{loginid}</span>
                        <span className='top-nav__amount'>{formatMoneyText(currency, balance ?? 0)}</span>
                    </div>
                ) : (
                    <span className='top-nav__guest'>{localize('Not logged in')}</span>
                )}
            </div>
        </header>
    );
});

export default TopNav;
