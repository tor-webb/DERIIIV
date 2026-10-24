import { lazy } from 'react';

import { routes } from '@deriv/shared';

import { TRouteConfig } from 'Types';

import ContractDetailsSwitch from './ContractDetailsSwitch';

// Lazy load route components for better code splitting
const Trade = lazy(() => import(/* webpackChunkName: "trader-trade" */ 'AppV2/Containers/Trade'));
const Dashboard = lazy(() => import(/* webpackChunkName: "trader-dashboard" */ 'AppV2/Containers/Dashboard'));
const ChartsPage = lazy(() => import(/* webpackChunkName: "trader-charts" */ 'AppV2/Containers/ChartsPage'));
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
