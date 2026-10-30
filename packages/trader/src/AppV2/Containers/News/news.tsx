import React from 'react';
import { createPortal } from 'react-dom';
import { useHistory } from 'react-router-dom';

import { observer } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import HandoutSheet from './handout-sheet';
import {
    areAlertsOn,
    getCategories,
    getRecommendations,
    getTagLabel,
    getTags,
    isHighImpact,
    isNewSince,
    matchesNewsSearch,
    readStore,
    STALE_AFTER_MS,
    STORAGE_ALERTS_OFF,
    STORAGE_VIEWED,
    timeAgo,
    writeStore,
} from './news-utils';
import { useNews } from './use-news';

import './news.scss';

const TOP_FOR_HANDOUT = 5;

const News = observer(() => {
    const history = useHistory();
    const { feed, is_loading, refresh } = useNews();
    const [category, setCategory] = React.useState('all');
    const [alerts_on, setAlertsOn] = React.useState(areAlertsOn);
    const [search, setSearch] = React.useState('');
    // when the page was last opened, read once before this visit overwrites it
    const viewed_at = React.useRef(Number(readStore(STORAGE_VIEWED)) || 0);

    React.useEffect(() => {
        writeStore(STORAGE_VIEWED, String(Date.now()));
    }, [feed]);

    const categories = React.useMemo(getCategories, []);
    const searching = search.trim() !== '';
    const items = (feed?.items ?? []).filter(
        item => (category === 'all' || item.category === category) && matchesNewsSearch(item, search)
    );
    const recommendations = React.useMemo(() => getRecommendations(feed), [feed]);
    const is_stale = feed?.updated ? Date.now() - Date.parse(feed.updated) > STALE_AFTER_MS : false;
    const top = (feed?.items ?? []).filter(isHighImpact).slice(0, TOP_FOR_HANDOUT);
    const handout_items = top.length ? top : (feed?.items ?? []).slice(0, TOP_FOR_HANDOUT);

    const toggleAlerts = () => {
        const next = !alerts_on;
        setAlertsOn(next);
        writeStore(STORAGE_ALERTS_OFF, next ? null : '1');
    };

    return (
        <main className='news' data-testid='dt_news'>
            <section className='news__header'>
                <h1 className='news__title'>{localize('Market news')}</h1>
                <p className='news__subtitle'>
                    {localize(
                        'Headlines from public news sources, refreshed through the day, with ideas on how to stay safe around them.'
                    )}
                </p>
                <div className='news__status' data-testid='dt_news_status'>
                    {feed?.updated ? (
                        <span>{localize('Updated {{time}}', { time: timeAgo(feed.updated) })}</span>
                    ) : (
                        <span>
                            {is_loading
                                ? localize('Loading headlines…')
                                : localize('Headlines are not available right now.')}
                        </span>
                    )}
                    <button
                        type='button'
                        className='news__link-button'
                        data-testid='dt_news_refresh'
                        onClick={() => refresh(true)}
                    >
                        {localize('Refresh')}
                    </button>
                </div>
            </section>

            <p className='news__notice' data-testid='dt_news_notice'>
                {localize(
                    'News is information, not advice. Nobody can tell you where a price will go, and prices often jump the moment news lands. You can lose money on every trade.'
                )}
            </p>

            {is_stale && (
                <p className='news__warning' data-testid='dt_news_stale'>
                    {localize('These headlines may be out of date. The feed has not refreshed for a while.')}
                </p>
            )}

            <div className='news__layout'>
                <section className='news__feed' aria-label={localize('Headlines')}>
                    <div className='news__tabs' role='tablist' aria-label={localize('News categories')}>
                        {categories.map(item => (
                            <button
                                key={item.id}
                                type='button'
                                role='tab'
                                aria-selected={category === item.id}
                                data-testid={`dt_news_tab_${item.id}`}
                                className={`news__tab${category === item.id ? ' news__tab--active' : ''}`}
                                onClick={() => setCategory(item.id)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <input
                        type='search'
                        className='news__search'
                        value={search}
                        placeholder={localize('Search headlines')}
                        aria-label={localize('Search headlines')}
                        data-testid='dt_news_search'
                        onChange={event => setSearch(event.target.value)}
                    />

                    {items.length === 0 ? (
                        <p className='news__empty' data-testid='dt_news_empty'>
                            {feed && searching
                                ? localize('No headlines match "{{search}}".', { search: search.trim() })
                                : feed
                                  ? localize('No headlines in this category yet.')
                                  : localize(
                                        'We could not load the news feed. Check your connection and press Refresh. The tips and handout below still work.'
                                    )}
                        </p>
                    ) : (
                        <ul className='news__list'>
                            {items.map(item => (
                                <li key={item.id} className='news__item' data-testid='dt_news_item'>
                                    <a
                                        className='news__item-title'
                                        href={item.link}
                                        target='_blank'
                                        rel='noopener noreferrer'
                                    >
                                        {item.title}
                                    </a>
                                    <span className='news__item-meta'>
                                        {item.source} · {timeAgo(item.published)}
                                    </span>
                                    {item.summary && <p className='news__item-summary'>{item.summary}</p>}
                                    <span className='news__chips'>
                                        {isNewSince(item, viewed_at.current) && (
                                            <span className='news__chip news__chip--new' data-testid='dt_news_new'>
                                                {localize('New')}
                                            </span>
                                        )}
                                        {isHighImpact(item) && (
                                            <span className='news__chip news__chip--impact'>
                                                {localize('Can move markets')}
                                            </span>
                                        )}
                                        {getTags(item)
                                            .slice(0, 3)
                                            .map(tag => (
                                                <span key={tag} className='news__chip'>
                                                    {getTagLabel(tag)}
                                                </span>
                                            ))}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <aside className='news__side'>
                    <section className='news__card' data-testid='dt_news_alerts'>
                        <h2 className='news__card-title'>{localize('Alerts')}</h2>
                        <p className='news__text'>
                            {localize(
                                'Get a small pop-up when a new headline about interest rates, inflation, jobs, oil or world events appears. Never more than two at once.'
                            )}
                        </p>
                        <button
                            type='button'
                            role='switch'
                            aria-checked={alerts_on}
                            data-testid='dt_news_alerts_toggle'
                            className='news__button'
                            onClick={toggleAlerts}
                        >
                            {alerts_on ? localize('Alerts are on. Turn off') : localize('Alerts are off. Turn on')}
                        </button>
                    </section>

                    <section className='news__card' data-testid='dt_news_recommendations'>
                        <h2 className='news__card-title'>{localize('Recommendations')}</h2>
                        <ul className='news__recs'>
                            {recommendations.map(rec => (
                                <li key={rec.id} className='news__rec' data-testid={`dt_news_rec_${rec.id}`}>
                                    <h3 className='news__rec-title'>{rec.title}</h3>
                                    <p className='news__text'>{rec.text}</p>
                                    {rec.because && (
                                        <span className='news__because'>
                                            {localize('Because of: {{title}}', { title: rec.because.title })}
                                        </span>
                                    )}
                                    <button
                                        type='button'
                                        className='news__try'
                                        onClick={() => history.push(rec.action.path)}
                                    >
                                        {rec.action.label}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                </aside>
            </div>

            <section className='news__handout' data-testid='dt_news_handout'>
                <div className='news__handout-bar'>
                    <h2 className='news__card-title'>{localize('Trader handout')}</h2>
                    <button
                        type='button'
                        className='news__button'
                        data-testid='dt_news_print'
                        onClick={() => window.print()}
                    >
                        {localize('Print or save as PDF')}
                    </button>
                </div>

                <HandoutSheet items={handout_items} recommendations={recommendations} />
            </section>
            {createPortal(
                <div className='news-print-root' data-testid='dt_news_print_root'>
                    <HandoutSheet items={handout_items} recommendations={recommendations} />
                </div>,
                document.body
            )}
        </main>
    );
});

export default News;
