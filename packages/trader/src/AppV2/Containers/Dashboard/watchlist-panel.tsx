import React from 'react';
import { useHistory } from 'react-router-dom';
import classNames from 'classnames';

import { routes } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

import { formatPercent, formatPrice, readWatchlist } from '../Markets/markets-utils';
import Sparkline from '../Markets/sparkline';
import { useMarkets } from '../Markets/use-markets';

const direction = (change_pct: number | null) => {
    if (change_pct === null || change_pct === 0) return 'flat';
    return change_pct > 0 ? 'up' : 'down';
};

/**
 * The markets starred on the Markets page, with live price, 1h change and a small trend line. It loads only the starred
 * markets, so a Dashboard visit does not open twenty subscriptions, and nothing at all when the list is empty.
 */
const WatchlistPanel = () => {
    const history = useHistory();
    const [watchlist] = React.useState<string[]>(readWatchlist);
    const { rows } = useMarkets({ symbols: watchlist });

    return (
        <section className='dashboard__section' data-testid='dt_dashboard_watchlist'>
            <h2 className='dashboard__section-title'>{localize('Your watchlist')}</h2>
            {watchlist.length === 0 ? (
                <p className='dashboard__watch-empty' data-testid='dt_dashboard_watchlist_empty'>
                    {localize('Star a market on the Markets page and it will show up here with its live price.')}{' '}
                    <button
                        type='button'
                        className='dashboard__watch-link'
                        onClick={() => history.push(routes.markets)}
                    >
                        {localize('Open Markets')}
                    </button>
                </p>
            ) : (
                <ul className='dashboard__watch-list'>
                    {rows.map(row => {
                        const way = direction(row.change_pct);
                        return (
                            <li key={row.symbol}>
                                <button
                                    type='button'
                                    className='dashboard__watch-row'
                                    data-testid={`dt_dashboard_watch_${row.symbol}`}
                                    onClick={() => history.push(routes.markets)}
                                >
                                    <span className='dashboard__watch-name'>{row.name}</span>
                                    {row.status === 'unavailable' ? (
                                        <span className='dashboard__watch-muted'>{localize('Unavailable')}</span>
                                    ) : (
                                        <>
                                            <span className='dashboard__watch-price'>
                                                {formatPrice(row.price, row.pip_size)}
                                            </span>
                                            <span
                                                className={classNames(
                                                    'dashboard__watch-change',
                                                    `dashboard__watch-change--${way}`
                                                )}
                                            >
                                                {formatPercent(row.change_pct, true)}
                                            </span>
                                            <Sparkline values={row.closes} way={way} width={72} height={24} />
                                        </>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
};

export default WatchlistPanel;
