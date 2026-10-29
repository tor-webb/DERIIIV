import { lazy } from 'react';

import { routes } from '@deriv/shared';

import { TRouteConfig } from 'Types';

import ContractDetailsSwitch from './ContractDetailsSwitch';

// Lazy load route components for better code splitting
const Trade = lazy(() => import(/* webpackChunkName: "trader-trade" */ 'AppV2/Containers/Trade'));
const Dashboard = lazy(() => import(/* webpackChunkName: "trader-dashboard" */ 'AppV2/Containers/Dashboard'));
const ChartsPage = lazy(() => import(/* webpackChunkName: "trader-charts" */ 'AppV2/Containers/ChartsPage'));
const Markets = lazy(() => import(/* webpackChunkName: "trader-markets" */ 'AppV2/Containers/Markets'));
const BotBuilder = lazy(() => import(/* webpackChunkName: "trader-bot-builder" */ 'AppV2/Containers/BotBuilder'));
const Journal = lazy(() => import(/* webpackChunkName: "trader-journal" */ 'AppV2/Containers/Journal'));
const RiskCalculator = lazy(
    () => import(/* webpackChunkName: "trader-risk-calculator" */ 'AppV2/Containers/RiskCalculator')
);
const BulkTrader = lazy(() => import(/* webpackChunkName: "trader-bulk-trader" */ 'AppV2/Containers/BulkTrader'));
const WhatIfCalculator = lazy(
    () => import(/* webpackChunkName: "trader-what-if" */ 'AppV2/Containers/WhatIfCalculator')
);
const Learn = lazy(() => import(/* webpackChunkName: "trader-learn" */ 'AppV2/Containers/Learn'));
const News = lazy(() => import(/* webpackChunkName: "trader-news" */ 'AppV2/Containers/News'));
const CopyTrading = lazy(() => import(/* webpackChunkName: "trader-copy-trading" */ 'AppV2/Containers/CopyTrading'));
const Positions = lazy(() => import(/* webpackChunkName: "trader-positions" */ 'AppV2/Containers/Positions'));

type TRouteConfigExtended = Omit<TRouteConfig, 'routes'> & {
    path: string;
    component: React.ComponentType;
    default: boolean;
};

const traderRoutes: TRouteConfigExtended[] = [
    {
        path: routes.index,
        component: Trade,
        exact: true,
        default: false,
    },
    {
        path: routes.dashboard,
        component: Dashboard,
        exact: true,
        default: false,
    },
    {
        path: routes.charts,
        component: ChartsPage,
        exact: true,
        default: false,
    },
    {
        path: routes.markets,
        component: Markets,
        exact: true,
        default: false,
    },
    {
        path: routes.bot_builder,
        component: BotBuilder,
        exact: true,
        default: false,
    },
    {
        path: routes.journal,
        component: Journal,
        exact: true,
        default: false,
    },
    {
        path: routes.risk_calculator,
        component: RiskCalculator,
        exact: true,
        default: false,
    },
    {
        path: routes.bulk_trader,
        component: BulkTrader,
        exact: true,
        default: false,
    },
    {
        path: routes.what_if,
        component: WhatIfCalculator,
        exact: true,
        default: false,
    },
    {
        path: routes.learn,
        component: Learn,
        exact: true,
        default: false,
    },
    {
        path: routes.news,
        component: News,
        exact: true,
        default: false,
    },
    {
        path: routes.copy_trading,
        component: CopyTrading,
        exact: true,
        default: false,
    },
    {
        path: routes.trader_positions,
        component: Positions,
        is_authenticated: true,
        default: false,
    },
    {
        path: routes.contract,
        component: ContractDetailsSwitch,
        is_authenticated: true,
        default: false,
    },
    {
        // default route
        path: '/*',
        component: lazy(() => import('Modules/Page404')),
        default: false,
    },
];

export default traderRoutes;
