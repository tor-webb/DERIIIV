import React from 'react';
import { useHistory } from 'react-router-dom';

import { formatMoney, getBrandName, routes } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import './dashboard.scss';

type TQuickAction = {
    id: string;
    title: string;
    description: string;
    path: string;
    requires_login?: boolean;
};

const Dashboard = observer(() => {
    const { client } = useStore();
    const history = useHistory();
    const { is_logged_in, loginid, balance, currency } = client;

    const actions: TQuickAction[] = [
        {
            id: 'trade',
            title: localize('Trade'),
            description: localize('Place contracts on markets'),
            path: routes.index,
        },
        {
            id: 'charts',
            title: localize('Charts'),
            description: localize('Live market charts'),
            path: routes.charts,
        },
        {
            id: 'positions',
            title: localize('Positions'),
            description: localize('Your open contracts'),
            path: routes.trader_positions,
            requires_login: true,
        },
        {
            id: 'reports',
            title: localize('Reports'),
            description: localize('Statement and trade history'),
            path: routes.reports,
            requires_login: true,
        },
    ];

    return (
        <main className='dashboard' data-testid='dt_dashboard'>
            <section className='dashboard__hero'>
                <h1 className='dashboard__title'>
                    {is_logged_in
                        ? localize('Hello {{loginid}}', { loginid })
                        : localize('Welcome to {{brand}}', { brand: getBrandName() })}
                </h1>
                <p className='dashboard__subtitle'>{localize('Trade smart. Think ahead.')}</p>
                {is_logged_in && (
                    <div className='dashboard__balance' data-testid='dt_dashboard_balance'>
                        <span className='dashboard__balance-label'>{localize('Balance')}</span>
                        <span className='dashboard__balance-value'>{formatMoney(currency, balance ?? 0, false)}</span>
                    </div>
                )}
            </section>
            <section className='dashboard__actions'>
                <h2 className='dashboard__section-title'>{localize('Quick actions')}</h2>
                <div className='dashboard__grid'>
                    {actions
                        .filter(action => is_logged_in || !action.requires_login)
                        .map(action => (
                            <button
                                key={action.id}
                                type='button'
                                className='dashboard__card'
                                data-testid={`dt_dashboard_${action.id}`}
                                onClick={() => history.push(action.path)}
                            >
                                <span className='dashboard__card-title'>{action.title}</span>
                                <span className='dashboard__card-description'>{action.description}</span>
                                <span className='dashboard__card-arrow' aria-hidden='true'>
                                    →
                                </span>
                            </button>
                        ))}
                </div>
            </section>
        </main>
    );
});

export default Dashboard;
