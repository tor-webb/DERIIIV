import React from 'react';
import classNames from 'classnames';

import { localize } from '@deriv-com/translations';

import { formatPercent } from '../Markets/markets-utils';

import {
    BARS,
    COINS,
    formatCoinPrice,
    formatVolume,
    instrumentId,
    readCoinWatchlist,
    TBarId,
    TCandle,
    TMarketKind,
    TTicker,
    writeCoinWatchlist,
} from './okx';
import { useOkxChart, useOkxTickers } from './use-okx';

import './crypto.scss';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;

const CandleChart = ({ candles }: { candles: TCandle[] }) => {
    if (candles.length < 2) return null;
    const low = Math.min(...candles.map(item => item.low));
    const high = Math.max(...candles.map(item => item.high));
    const span = high - low || 1;
    const y = (value: number) => CHART_HEIGHT - 6 - ((value - low) / span) * (CHART_HEIGHT - 12);
    const step = CHART_WIDTH / candles.length;
    return (
        <svg
            className='crypto__chart-svg'
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            preserveAspectRatio='none'
            role='img'
            aria-label={localize('Price chart')}
            data-testid='crypto-chart'
        >
            {candles.map((item, index) => {
                const x = index * step + step / 2;
                const up = item.close >= item.open;
                const top = y(Math.max(item.open, item.close));
                const bottom = y(Math.min(item.open, item.close));
                return (
                    <g key={item.time} className={up ? 'crypto__candle--up' : 'crypto__candle--down'}>
                        <line x1={x} x2={x} y1={y(item.high)} y2={y(item.low)} strokeWidth='1' />
                        <rect x={x - step * 0.3} y={top} width={step * 0.6} height={Math.max(1, bottom - top)} />
                    </g>
                );
            })}
        </svg>
    );
};

const Crypto = () => {
    const [kind, setKind] = React.useState<TMarketKind>('SPOT');
    const [only_watchlist, setOnlyWatchlist] = React.useState(false);
    const [search, setSearch] = React.useState('');
    const [watchlist, setWatchlist] = React.useState<string[]>(readCoinWatchlist);
    const [coin, setCoin] = React.useState<string>(COINS[0]);
    const [bar, setBar] = React.useState<TBarId>('5m');

    const { tickers, error, loading, retry } = useOkxTickers(kind);
    const inst_id = instrumentId(coin, kind);
    const chart = useOkxChart(inst_id, bar);

    const toggle = (item: string) => {
        const next = watchlist.includes(item) ? watchlist.filter(entry => entry !== item) : [...watchlist, item];
        setWatchlist(next);
        writeCoinWatchlist(next);
    };

    const shown = tickers.filter(
        item =>
            (!only_watchlist || watchlist.includes(item.coin)) &&
            item.coin.toLowerCase().includes(search.trim().toLowerCase())
    );
    const selected: TTicker | undefined = tickers.find(item => item.coin === coin);

    return (
        <main className='crypto' data-testid='crypto-page'>
            <header className='crypto__header'>
                <h1 className='crypto__title'>{localize('Crypto')}</h1>
                <p className='crypto__subtitle'>
                    {localize('Live prices for spot coins and perpetual futures, straight from OKX.')}
                </p>
                <p className='crypto__note' data-testid='crypto-note'>
                    {localize(
                        'This page only shows prices. Trading on OKX needs your own API keys and a secure server, which this site does not have, so no orders can be placed here.'
                    )}
                </p>
            </header>

            <div className='crypto__controls'>
                <div className='crypto__tabs' role='tablist' aria-label={localize('Market type')}>
                    {(['SPOT', 'SWAP'] as TMarketKind[]).map(item => (
                        <button
                            key={item}
                            type='button'
                            role='tab'
                            aria-selected={kind === item}
                            data-testid={`crypto-kind-${item}`}
                            className={classNames('crypto__pill', kind === item && 'crypto__pill--active')}
                            onClick={() => setKind(item)}
                        >
                            {item === 'SPOT' ? localize('Spot') : localize('Perpetual futures')}
                        </button>
                    ))}
                </div>
                <input
                    type='search'
                    className='crypto__search'
                    placeholder={localize('Search a coin')}
                    aria-label={localize('Search a coin')}
                    data-testid='crypto-search'
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                />
                <button
                    type='button'
                    aria-pressed={only_watchlist}
                    data-testid='crypto-watchlist-filter'
                    className={classNames('crypto__pill', only_watchlist && 'crypto__pill--active')}
                    onClick={() => setOnlyWatchlist(value => !value)}
                >
                    {localize('Watchlist')}
                </button>
            </div>

            {error && (
                <div className='crypto__error' role='alert' data-testid='crypto-error'>
                    <span>{localize('Could not load prices from OKX: {{error}}', { error })}</span>
                    <button type='button' className='crypto__pill' data-testid='crypto-retry' onClick={retry}>
                        {localize('Try again')}
                    </button>
                </div>
            )}

            <div className='crypto__layout'>
                <section className='crypto__table' aria-label={localize('Prices')}>
                    {loading && !tickers.length && !error && (
                        <p className='crypto__muted' data-testid='crypto-loading'>
                            {localize('Loading prices…')}
                        </p>
                    )}
                    {!!tickers.length && !shown.length && (
                        <p className='crypto__muted' data-testid='crypto-empty'>
                            {localize('No coins match.')}
                        </p>
                    )}
                    {shown.length > 0 && (
                        <table>
                            <thead>
                                <tr>
                                    <th aria-label={localize('Watchlist')} />
                                    <th>{localize('Coin')}</th>
                                    <th>{localize('Price (USDT)')}</th>
                                    <th>{localize('24h')}</th>
                                    <th className='crypto__hide-small'>{localize('High')}</th>
                                    <th className='crypto__hide-small'>{localize('Low')}</th>
                                    <th className='crypto__hide-small'>{localize('Volume')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map(item => {
                                    const way = (item.change_pct ?? 0) >= 0 ? 'up' : 'down';
                                    return (
                                        <tr
                                            key={item.inst_id}
                                            data-testid={`crypto-row-${item.coin}`}
                                            className={classNames(item.coin === coin && 'crypto__row--selected')}
                                        >
                                            <td>
                                                <button
                                                    type='button'
                                                    className={classNames(
                                                        'crypto__star',
                                                        watchlist.includes(item.coin) && 'crypto__star--on'
                                                    )}
                                                    aria-pressed={watchlist.includes(item.coin)}
                                                    aria-label={localize('Watch {{coin}}', { coin: item.coin })}
                                                    data-testid={`crypto-star-${item.coin}`}
                                                    onClick={() => toggle(item.coin)}
                                                >
                                                    {watchlist.includes(item.coin) ? '★' : '☆'}
                                                </button>
                                            </td>
                                            <td>
                                                <button
                                                    type='button'
                                                    className='crypto__coin'
                                                    data-testid={`crypto-pick-${item.coin}`}
                                                    onClick={() => setCoin(item.coin)}
                                                >
                                                    {item.coin}
                                                </button>
                                            </td>
                                            <td>{formatCoinPrice(item.last)}</td>
                                            <td className={`crypto__change--${way}`}>
                                                {formatPercent(item.change_pct, true)}
                                            </td>
                                            <td className='crypto__hide-small'>{formatCoinPrice(item.high_24h)}</td>
                                            <td className='crypto__hide-small'>{formatCoinPrice(item.low_24h)}</td>
                                            <td className='crypto__hide-small'>{formatVolume(item.volume_24h)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </section>

                <aside className='crypto__detail' aria-label={localize('Chart')}>
                    <h2 className='crypto__detail-title'>
                        {coin} {kind === 'SPOT' ? localize('spot') : localize('perpetual')}
                        {selected && <strong> {formatCoinPrice(selected.last)}</strong>}
                    </h2>
                    <div className='crypto__tabs' role='group' aria-label={localize('Candle size')}>
                        {BARS.map(item => (
                            <button
                                key={item.id}
                                type='button'
                                aria-pressed={bar === item.id}
                                data-testid={`crypto-bar-${item.id}`}
                                className={classNames(
                                    'crypto__pill crypto__pill--small',
                                    bar === item.id && 'crypto__pill--active'
                                )}
                                onClick={() => setBar(item.id)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <CandleChart candles={chart.candles} />
                    {!chart.candles.length && !chart.error && (
                        <p className='crypto__muted'>{localize('Loading the chart…')}</p>
                    )}
                    {chart.error && (
                        <p className='crypto__muted' role='alert' data-testid='crypto-chart-error'>
                            {localize('Could not load the chart: {{error}}', { error: chart.error })}
                        </p>
                    )}
                    {kind === 'SWAP' && chart.funding && (
                        <p className='crypto__funding' data-testid='crypto-funding'>
                            {localize('Funding rate: {{rate}} per 8 hours. Longs pay shorts when it is positive.', {
                                rate: `${(chart.funding.rate * 100).toFixed(4)}%`,
                            })}
                        </p>
                    )}
                    {kind === 'SWAP' && (
                        <p className='crypto__muted'>
                            {localize(
                                'Perpetual futures are leveraged and can lose more than you expect, quickly. Treat this page as information, not advice.'
                            )}
                        </p>
                    )}
                </aside>
            </div>
        </main>
    );
};

export default Crypto;
