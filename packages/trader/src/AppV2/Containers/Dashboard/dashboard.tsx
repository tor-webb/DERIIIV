import React from 'react';
import { useHistory } from 'react-router-dom';

import { formatMoneyText, getBrandName, routes } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import WatchlistPanel from './watchlist-panel';

import './dashboard.scss';

type TIconName =
    | 'trade'
    | 'markets'
    | 'chart'
    | 'bot'
    | 'bulk'
    | 'risk'
    | 'whatif'
    | 'learn'
    | 'copy'
    | 'positions'
    | 'reports';

type TTool = {
    id: string;
    title: string;
    description: string;
    path: string;
    icon: TIconName;
    tag?: string;
    requires_login?: boolean;
};

const ICON_PATHS: Record<TIconName, string> = {
    trade: 'M4 17l5-5 4 4 7-8M15 8h5v5',
    markets: 'M4 19h16M6 15l3-4 3 2 4-6 2 3M6 15v4M12 13v6M16 7v12',
    chart: 'M5 20V10M12 20V4M19 20v-7',
    bot: 'M7 9h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM12 9V5M9 14h.01M15 14h.01M3 14v2M21 14v2',
    bulk: 'M4 7h4v4H4zM10 7h4v4h-4zM16 7h4v4h-4zM4 14h16M4 18h10',
    risk: 'M12 3l9 16H3L12 3zM12 10v4M12 17h.01',
    learn: 'M4 5h7a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4zM20 5h-7a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h8z',
    whatif: 'M12 4a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9zM10 19h4M11 22h2',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    positions: 'M4 6h16M4 12h16M4 18h10',
    reports: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
};

const ToolIcon = ({ name }: { name: TIconName }) => (
    <svg width='24' height='24' viewBox='0 0 24 24' aria-hidden='true'>
        <path
            d={ICON_PATHS[name]}
            fill='none'
            stroke='currentColor'
            strokeWidth='1.8'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

const Dashboard = observer(() => {
    const { client } = useStore();
    const history = useHistory();
    const { is_logged_in, is_virtual, loginid, balance, currency } = client;

    const tools: TTool[] = [
        {
            id: 'trade',
            title: localize('Trade'),
            description: localize('Place Rise/Fall, Even/Odd and other contracts on live markets.'),
            path: routes.index,
            icon: 'trade',
        },
        {
            id: 'markets',
            title: localize('Markets'),
            description: localize('Live prices, top movers and volatility, so you can pick a market before you trade.'),
            path: routes.markets,
            icon: 'markets',
        },
        {
            id: 'charts',
            title: localize('Charts'),
            description: localize('Live market charts with indicators and drawing tools.'),
            path: routes.charts,
            icon: 'chart',
        },
        {
            id: 'bot_builder',
            title: localize('Bot Builder'),
            description: localize('Build a trading bot with blocks, or import a Deriv bot XML.'),
            path: routes.bot_builder,
            icon: 'bot',
            tag: localize('Automation'),
        },
        {
            id: 'bulk_trader',
            title: localize('Bulk Trader simulator'),
            description: localize('Settle every contract on real ticks and compare the win rate with break-even.'),
            path: routes.bulk_trader,
            icon: 'bulk',
            tag: localize('Simulator'),
        },
        {
            id: 'risk_calculator',
            title: localize('Risk calculator'),
            description: localize('Work out your position size and stake before you trade.'),
            path: routes.risk_calculator,
            icon: 'risk',
        },
        {
            id: 'what_if',
            title: localize('What-if calculator'),
            description: localize('Try a win rate of your own and see the profit, loss and drawdown it would bring.'),
            path: routes.what_if,
            icon: 'whatif',
        },
        {
            id: 'learn',
            title: localize('Learn to trade'),
            description: localize('Beginner lessons on charts, news, crypto and risk, plus our Telegram community.'),
            path: routes.learn,
            icon: 'learn',
            tag: localize('Beginners'),
        },
        {
            id: 'copy_trading',
            title: localize('Copy trading'),
            description: localize('Mirror our trades on your account.'),
            path: routes.copy_trading,
            icon: 'copy',
        },
    ];

    const account_links: TTool[] = [
        {
            id: 'positions',
            title: localize('Positions'),
            description: localize('Your open contracts.'),
            path: routes.trader_positions,
            icon: 'positions',
            requires_login: true,
        },
        {
            id: 'reports',
            title: localize('Reports'),
            description: localize('Statement and trade history.'),
            path: routes.reports,
            icon: 'reports',
            requires_login: true,
        },
    ];

    const renderCard = (tool: TTool) => (
        <button
            key={tool.id}
            type='button'
            className='dashboard__card'
            data-testid={`dt_dashboard_${tool.id}`}
            onClick={() => history.push(tool.path)}
        >
            <span className='dashboard__card-icon'>
                <ToolIcon name={tool.icon} />
            </span>
            <span className='dashboard__card-body'>
                <span className='dashboard__card-title'>
                    {tool.title}
                    {tool.tag && <span className='dashboard__card-tag'>{tool.tag}</span>}
                </span>
                <span className='dashboard__card-description'>{tool.description}</span>
            </span>
            <span className='dashboard__card-arrow' aria-hidden='true'>
                →
            </span>
        </button>
    );

    return (
        <main className='dashboard' data-testid='dt_dashboard'>
            <div className='dashboard__inner'>
                <section className='dashboard__hero'>
                    <div className='dashboard__hero-text'>
                        <span className='dashboard__eyebrow'>{getBrandName()}</span>
                        <h1 className='dashboard__title'>
                            {is_logged_in
                                ? localize('Welcome back, {{loginid}}', { loginid })
                                : localize('Trade smarter with {{brand}}', { brand: getBrandName() })}
                        </h1>
                        <p className='dashboard__subtitle'>
                            {localize('Trade, automate and manage your risk from one platform.')}
                        </p>
                        <div className='dashboard__hero-actions'>
                            <button
                                type='button'
                                className='dashboard__cta dashboard__cta--primary'
                                onClick={() => history.push(routes.index)}
                            >
                                {localize('Start trading')}
                            </button>
                            <button
                                type='button'
                                className='dashboard__cta'
                                onClick={() => history.push(routes.bot_builder)}
                            >
                                {localize('Open Bot Builder')}
                            </button>
                        </div>
                    </div>
                    {is_logged_in && (
                        <div className='dashboard__balance' data-testid='dt_dashboard_balance'>
                            <span className='dashboard__balance-label'>{localize('Balance')}</span>
                            <span className='dashboard__balance-value'>
                                {formatMoneyText(currency, balance ?? 0)}
                                <small>{currency}</small>
                            </span>
                            <span
                                className={
                                    is_virtual
                                        ? 'dashboard__badge dashboard__badge--demo'
                                        : 'dashboard__badge dashboard__badge--real'
                                }
                            >
                                {is_virtual ? localize('Demo account') : localize('Real account')} · {loginid}
                            </span>
                        </div>
                    )}
                </section>

                <WatchlistPanel />

                <section className='dashboard__section'>
                    <h2 className='dashboard__section-title'>{localize('Trading tools')}</h2>
                    <div className='dashboard__grid'>{tools.map(renderCard)}</div>
                </section>

                {is_logged_in && (
                    <section className='dashboard__section'>
                        <h2 className='dashboard__section-title'>{localize('Your account')}</h2>
                        <div className='dashboard__grid dashboard__grid--compact'>{account_links.map(renderCard)}</div>
                    </section>
                )}

                <p className='dashboard__risk'>
                    {localize(
                        'Trading derivatives carries a high level of risk and you can lose your entire stake. Only trade with money you can afford to lose.'
                    )}
                </p>
            </div>
        </main>
    );
});

export default Dashboard;
