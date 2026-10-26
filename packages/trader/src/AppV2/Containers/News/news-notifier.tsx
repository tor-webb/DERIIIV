import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';

import { routes } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

import { areAlertsOn, pickAlerts, readSeen, timeAgo, TNewsItem, writeSeen } from './news-utils';
import { useNews } from './use-news';

import './news-notifier.scss';

const SHOW_FOR_MS = 14000;

/**
 * Small pop-up for new headlines about things that tend to move markets (rates, inflation, jobs, oil, world events).
 * At most two at a time, never on the News page itself, and it can be switched off from the News page.
 */
const NewsNotifier = () => {
    const { feed } = useNews();
    const history = useHistory();
    const location = useLocation();
    const [alerts, setAlerts] = React.useState<TNewsItem[]>([]);

    React.useEffect(() => {
        if (!feed) return;
        const seen = readSeen();
        const fresh = areAlertsOn() && location.pathname !== routes.news ? pickAlerts(feed, seen) : [];
        writeSeen(
            [...fresh.map(item => item.id), ...(seen ?? []), ...feed.items.map(item => item.id)].filter(
                (id, i, all) => all.indexOf(id) === i
            )
        );
        if (fresh.length) setAlerts(fresh);
    }, [feed]); // eslint-disable-line react-hooks/exhaustive-deps

    React.useEffect(() => {
        if (location.pathname === routes.news) setAlerts([]);
    }, [location.pathname]);

    React.useEffect(() => {
        if (!alerts.length) return undefined;
        const timer = window.setTimeout(() => setAlerts([]), SHOW_FOR_MS);
        return () => window.clearTimeout(timer);
    }, [alerts]);

    if (!alerts.length) return null;

    return (
        <div className='news-notifier' role='status' aria-live='polite' data-testid='dt_news_notifier'>
            {alerts.map(item => (
                <div key={item.id} className='news-notifier__card'>
                    <button
                        type='button'
                        className='news-notifier__body'
                        data-testid='dt_news_notifier_open'
                        onClick={() => {
                            setAlerts([]);
                            history.push(routes.news);
                        }}
                    >
                        <span className='news-notifier__label'>
                            {localize('News')} · {item.source} · {timeAgo(item.published)}
                        </span>
                        <span className='news-notifier__title'>{item.title}</span>
                    </button>
                    <button
                        type='button'
                        className='news-notifier__close'
                        aria-label={localize('Dismiss')}
                        data-testid='dt_news_notifier_close'
                        onClick={() => setAlerts(current => current.filter(entry => entry.id !== item.id))}
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
};

export default NewsNotifier;
