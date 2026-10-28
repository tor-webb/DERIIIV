import React from 'react';
import { useHistory } from 'react-router-dom';
import classNames from 'classnames';

import { routes } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

import { useTraderStore } from 'Stores/useTraderStores';

import { findBotMarket } from '../BotBuilder/bot-markets';

import { DEFAULT_WINDOW, TWindowId, WINDOWS } from './markets-config';
import {
    formatPercent,
    formatPrice,
    getTopMovers,
    matchesSearch,
    readWatchlist,
    sortRows,
    TMarketRow,
    toggleSymbol,
    TSortKey,
    TVolatilityLevel,
    writeWatchlist,
} from './markets-utils';
import Sparkline from './sparkline';
import { useMarkets } from './use-markets';

import './markets.scss';

type TFilter = 'all' | 'watchlist' | 'synthetic' | 'forex';

const FILTERS: { id: TFilter; label: () => string }[] = [
    { id: 'all', label: () => localize('All') },
    { id: 'watchlist', label: () => localize('Watchlist') },
    { id: 'synthetic', label: () => localize('Derived') },
    { id: 'forex', label: () => localize('Forex') },
];

const SORTS: { id: TSortKey; label: () => string }[] = [
    { id: 'name', label: () => localize('Name') },
    { id: 'change', label: () => localize('Biggest move') },
    { id: 'volatility', label: () => localize('Most volatile') },
];

const WINDOW_LABEL: Record<TWindowId, () => string> = {
    '1h': () => localize('1h'),
    '4h': () => localize('4h'),
    '1d': () => localize('1d'),
};

const VOLATILITY_TEXT: Record<TVolatilityLevel, () => string> = {
    low: () => localize('Low'),
    medium: () => localize('Medium'),
    high: () => localize('High'),
};

const direction = (change_pct: number | null) => {
    if (change_pct === null || change_pct === 0) return 'flat';
    return change_pct > 0 ? 'up' : 'down';
};

const ARROW = { up: '▲', down: '▼', flat: '' };

const ChangeText = ({ row }: { row: TMarketRow }) => {
    const way = direction(row.change_pct);
    return (
        <span className={classNames('markets__change', `markets__change--${way}`)}>
            {ARROW[way]} {formatPercent(row.change_pct, true)}
        </span>
    );
};

type TMoverListProps = {
    title: string;
    empty: string;
    rows: TMarketRow[];
    testid: string;
    onOpen: (symbol: string) => void;
};

const MoverList = ({ title, empty, rows, testid, onOpen }: TMoverListProps) => (
    <section className='markets__movers-group' data-testid={testid}>
        <h2 className='markets__section-title'>{title}</h2>
        {rows.length === 0 ? (
            <p className='markets__muted'>{empty}</p>
        ) : (
            <ul className='markets__movers'>
                {rows.map(row => (
                    <li key={row.symbol}>
                        <button type='button' className='markets__mover' onClick={() => onOpen(row.symbol)}>
                            <span className='markets__mover-name'>{row.name}</span>
                            <span className='markets__mover-price'>{formatPrice(row.price, row.pip_size)}</span>
                            <ChangeText row={row} />
                        </button>
                    </li>
                ))}
            </ul>
        )}
    </section>
);

const Markets = () => {
    const history = useHistory();
    const { onChange, processContractsForV2, symbol: current_symbol } = useTraderStore();
    const [window_id, setWindowId] = React.useState<TWindowId>(DEFAULT_WINDOW);
    const { rows, is_loading, updated_at, retry } = useMarkets({ window_id });
    const window_text = WINDOW_LABEL[window_id]();
    const [search, setSearch] = React.useState('');
    const [filter, setFilter] = React.useState<TFilter>('all');
    const [sort, setSort] = React.useState<TSortKey>('name');
    const [watchlist, setWatchlist] = React.useState<string[]>(readWatchlist);

    const toggleWatch = (symbol: string) =>
        setWatchlist(previous => {
            const next = toggleSymbol(previous, symbol);
            writeWatchlist(next);
            return next;
        });

    /** Makes the market the Trade store's symbol, then opens a page that reads it (Trade or Charts). */
    const openWith = async (pathname: string, symbol: string) => {
        try {
            if (symbol !== current_symbol) {
                await onChange({ target: { name: 'symbol', value: symbol } });
                processContractsForV2();
            }
        } catch {
            // the page also reads the symbol from the address, so go there either way
        }
        history.push({ pathname, search: `?symbol=${encodeURIComponent(symbol)}` });
    };

    const openTrade = (symbol: string) => openWith(routes.index, symbol);
    const openChart = (symbol: string) => openWith(routes.charts, symbol);

    const openBot = (symbol: string) =>
        history.push({ pathname: routes.bot_builder, search: `?market=${encodeURIComponent(symbol)}` });

    const movers = React.useMemo(() => getTopMovers(rows), [rows]);

    const visible = React.useMemo(() => {
        const filtered = rows.filter(row => {
            if (filter === 'watchlist') return watchlist.includes(row.symbol);
            if (filter === 'all') return true;
            return row.group === filter;
        });
        return sortRows(
            filtered.filter(row => matchesSearch(row, search)),
            sort
        );
    }, [rows, filter, sort, watchlist, search]);

    let statusText = '';
    if (updated_at !== null) {
        statusText = localize('Live · updated {{time}}', { time: new Date(updated_at).toLocaleTimeString() });
    } else if (is_loading) {
        statusText = localize('Loading markets…');
    }

    let emptyText = localize('No markets to show.');
    if (search.trim()) emptyText = localize('No market matches "{{search}}".', { search: search.trim() });
    else if (filter === 'watchlist')
        emptyText = localize('Your watchlist is empty. Tap the star next to a market to add it.');

    const has_unavailable = rows.some(row => row.status === 'unavailable');
    const all_unavailable = rows.length > 0 && rows.every(row => row.status === 'unavailable');

    return (
        <main className='markets' data-testid='dt_markets'>
            <header className='markets__header'>
                <h1 className='markets__title'>{localize('Markets')}</h1>
                <p className='markets__subtitle'>
                    {localize(
                        'Live prices, the biggest moves and how volatile each market has been over the last hour. Pick one, then open it on the Trade page.'
                    )}
                </p>
                <p className='markets__status' role='status' data-testid='dt_markets_status'>
                    {statusText}
                </p>
            </header>

            {all_unavailable && (
                <div className='markets__error' role='alert' data-testid='dt_markets_error'>
                    <span>{localize('Market data could not be loaded. Check your connection and try again.')}</span>
                    <button type='button' className='markets__button' onClick={retry}>
                        {localize('Try again')}
                    </button>
                </div>
            )}

            <div className='markets__movers-row'>
                <MoverList
                    title={localize('Top gainers ({{window}})', { window: window_text })}
                    empty={localize('No market is up right now.')}
                    rows={movers.gainers}
                    testid='dt_markets_gainers'
                    onOpen={openTrade}
                />
                <MoverList
                    title={localize('Top losers ({{window}})', { window: window_text })}
                    empty={localize('No market is down right now.')}
                    rows={movers.losers}
                    testid='dt_markets_losers'
                    onOpen={openTrade}
                />
            </div>

            <div className='markets__controls'>
                <div className='markets__filters' role='group' aria-label={localize('Show')}>
                    {FILTERS.map(item => (
                        <button
                            key={item.id}
                            type='button'
                            className={classNames('markets__pill', { 'markets__pill--active': filter === item.id })}
                            aria-pressed={filter === item.id}
                            data-testid={`dt_markets_filter_${item.id}`}
                            onClick={() => setFilter(item.id)}
                        >
                            {item.label()}
                        </button>
                    ))}
                </div>
                <input
                    type='search'
                    className='markets__search'
                    value={search}
                    placeholder={localize('Search markets')}
                    aria-label={localize('Search markets')}
                    data-testid='dt_markets_search'
                    onChange={event => setSearch(event.target.value)}
                />
                <div className='markets__filters' role='group' aria-label={localize('Time window')}>
                    {WINDOWS.map(item => (
                        <button
                            key={item.id}
                            type='button'
                            className={classNames('markets__pill', { 'markets__pill--active': window_id === item.id })}
                            aria-pressed={window_id === item.id}
                            data-testid={`dt_markets_window_${item.id}`}
                            onClick={() => setWindowId(item.id)}
                        >
                            {WINDOW_LABEL[item.id]()}
                        </button>
                    ))}
                </div>
                <label className='markets__sort'>
                    <span>{localize('Sort by')}</span>
                    <select
                        value={sort}
                        data-testid='dt_markets_sort'
                        onChange={event => setSort(event.target.value as TSortKey)}
                    >
                        {SORTS.map(item => (
                            <option key={item.id} value={item.id}>
                                {item.label()}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {visible.length === 0 ? (
                <p className='markets__empty' data-testid='dt_markets_empty'>
                    {emptyText}
                </p>
            ) : (
                <ul className='markets__list' data-testid='dt_markets_list'>
                    <li className='markets__row markets__row--head' aria-hidden='true'>
                        <span />
                        <span>{localize('Market')}</span>
                        <span className='markets__num'>{localize('Price')}</span>
                        <span className='markets__num'>{localize('{{window}} change', { window: window_text })}</span>
                        <span className='markets__num'>{localize('{{window}} range', { window: window_text })}</span>
                        <span>{localize('Trend')}</span>
                        <span>{localize('Volatility')}</span>
                        <span />
                    </li>
                    {visible.map(row => {
                        const is_watched = watchlist.includes(row.symbol);
                        return (
                            <li key={row.symbol} className='markets__row' data-testid={`dt_markets_row_${row.symbol}`}>
                                <button
                                    type='button'
                                    className={classNames('markets__star', { 'markets__star--on': is_watched })}
                                    aria-pressed={is_watched}
                                    aria-label={
                                        is_watched
                                            ? localize('Remove {{name}} from watchlist', { name: row.name })
                                            : localize('Add {{name}} to watchlist', { name: row.name })
                                    }
                                    data-testid={`dt_markets_star_${row.symbol}`}
                                    onClick={() => toggleWatch(row.symbol)}
                                >
                                    {is_watched ? '★' : '☆'}
                                </button>
                                <span className='markets__name'>
                                    {row.name}
                                    {row.is_closed && <span className='markets__closed'>{localize('Closed')}</span>}
                                </span>
                                {row.status === 'unavailable' ? (
                                    <span className='markets__unavailable'>{localize('Unavailable')}</span>
                                ) : (
                                    <>
                                        <span className='markets__num markets__price'>
                                            {formatPrice(row.price, row.pip_size)}
                                        </span>
                                        <span className='markets__num'>
                                            <ChangeText row={row} />
                                        </span>
                                        <span className='markets__num'>{formatPercent(row.range_pct)}</span>
                                        <span>
                                            <Sparkline values={row.closes} way={direction(row.change_pct)} />
                                        </span>
                                        <span>
                                            {row.volatility && !row.is_closed ? (
                                                <span
                                                    className={classNames(
                                                        'markets__badge',
                                                        `markets__badge--${row.volatility}`
                                                    )}
                                                >
                                                    {VOLATILITY_TEXT[row.volatility]()}
                                                </span>
                                            ) : (
                                                '–'
                                            )}
                                        </span>
                                    </>
                                )}
                                <span className='markets__actions'>
                                    <button
                                        type='button'
                                        className='markets__button markets__button--small markets__button--ghost'
                                        disabled={row.status === 'unavailable' || !findBotMarket(row.symbol)}
                                        title={
                                            findBotMarket(row.symbol)
                                                ? undefined
                                                : localize('Bot Builder cannot trade this market yet')
                                        }
                                        aria-label={localize('Build a bot for {{name}}', { name: row.name })}
                                        data-testid={`dt_markets_bot_${row.symbol}`}
                                        onClick={() => openBot(row.symbol)}
                                    >
                                        {localize('Bot')}
                                    </button>
                                    <button
                                        type='button'
                                        className='markets__button markets__button--small markets__button--ghost'
                                        disabled={row.status === 'unavailable'}
                                        aria-label={localize('Open {{name}} in Charts', { name: row.name })}
                                        data-testid={`dt_markets_chart_${row.symbol}`}
                                        onClick={() => openChart(row.symbol)}
                                    >
                                        {localize('Chart')}
                                    </button>
                                    <button
                                        type='button'
                                        className='markets__button markets__button--small'
                                        disabled={row.status === 'unavailable'}
                                        data-testid={`dt_markets_trade_${row.symbol}`}
                                        onClick={() => openTrade(row.symbol)}
                                    >
                                        {localize('Trade')}
                                    </button>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}

            {has_unavailable && !all_unavailable && (
                <p className='markets__muted'>
                    {localize('Some markets are unavailable right now.')}{' '}
                    <button type='button' className='markets__link' onClick={retry}>
                        {localize('Try again')}
                    </button>
                </p>
            )}

            <p className='markets__note'>
                {localize(
                    'Volatility shows how far a market moved up and down over the chosen window, not which way it will go next. Past moves do not predict future prices, and every trade can lose its stake.'
                )}
            </p>
        </main>
    );
};

export default Markets;
