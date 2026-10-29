import React from 'react';
import { useHistory } from 'react-router-dom';
import classNames from 'classnames';

import { formatMoneyText, redirectToLogin, routes } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import Sparkline from 'AppV2/Containers/Markets/sparkline';

import {
    breakEvenComparison,
    lastTrades,
    profitSeries,
    stakeSeries,
    summariseTrades,
    TJournalSummary,
    TJournalTrade,
} from './journal-utils';
import { useJournal } from './use-journal';

import './journal.scss';

export const RANGES = [
    { id: 'last_20', count: 20, label: () => localize('Last 20') },
    { id: 'last_50', count: 50, label: () => localize('Last 50') },
    { id: 'all', count: 0, label: () => localize('All loaded') },
] as const;

const percent = (value: number) => `${value.toFixed(1)}%`;
const wayOf = (values: number[]): 'up' | 'down' | 'flat' => {
    if (values.length < 2) return 'flat';
    const change = values[values.length - 1] - values[0];
    if (change > 0) return 'up';
    return change < 0 ? 'down' : 'flat';
};

type TStatProps = { label: string; value: string; tone?: 'good' | 'bad'; testid: string };

const Stat = ({ label, value, tone, testid }: TStatProps) => (
    <div className='journal__stat'>
        <span className='journal__stat-label'>{label}</span>
        <span
            className={classNames('journal__stat-value', tone && `journal__stat-value--${tone}`)}
            data-testid={testid}
        >
            {value}
        </span>
    </div>
);

const toneOf = (value: number) => {
    if (value > 0) return 'good';
    return value < 0 ? 'bad' : undefined;
};

type TResultsProps = { trades: TJournalTrade[]; summary: TJournalSummary; currency: string };

const Results = ({ trades, summary, currency }: TResultsProps) => {
    const money = (value: number) => formatMoneyText(currency, value);
    const comparison = breakEvenComparison(summary);
    const profits = profitSeries(trades);
    const stakes = stakeSeries(trades);

    return (
        <>
            <div className='journal__stats'>
                <Stat label={localize('Trades')} value={String(summary.trades)} testid='dt_journal_trades' />
                <Stat
                    label={localize('Won / lost')}
                    value={`${summary.wins} / ${summary.losses}`}
                    testid='dt_journal_won_lost'
                />
                <Stat label={localize('Win rate')} value={percent(summary.win_rate)} testid='dt_journal_win_rate' />
                <Stat
                    label={localize('Net result')}
                    value={money(summary.net_profit)}
                    tone={toneOf(summary.net_profit)}
                    testid='dt_journal_net'
                />
                <Stat label={localize('Total staked')} value={money(summary.total_staked)} testid='dt_journal_staked' />
                <Stat label={localize('Average stake')} value={money(summary.average_stake)} testid='dt_journal_avg' />
            </div>

            <section className='journal__panel' data-testid='dt_journal_break_even'>
                <h2 className='journal__panel-title'>{localize('Win rate against break-even')}</h2>
                {comparison === 'unknown' ? (
                    <p className='journal__text'>
                        {localize('These trades did not report a payout, so a break-even rate cannot be worked out.')}
                    </p>
                ) : (
                    <>
                        <p className='journal__text'>
                            {localize(
                                'With an average return of {{payout}} on a winning trade, you need to win {{rate}} of trades just to break even. Your win rate over these trades was {{win_rate}}, which is {{side}} that line.',
                                {
                                    payout: percent(summary.average_payout_percent ?? 0),
                                    rate: percent(summary.break_even_rate ?? 0),
                                    win_rate: percent(summary.win_rate),
                                    side: comparison === 'above' ? localize('above') : localize('below'),
                                }
                            )}
                        </p>
                        <div className='journal__meter' aria-hidden='true'>
                            <span
                                className='journal__meter-fill'
                                style={{ width: `${Math.min(summary.win_rate, 100)}%` }}
                            />
                            <span
                                className='journal__meter-mark'
                                style={{ left: `${Math.min(summary.break_even_rate ?? 0, 100)}%` }}
                            />
                        </div>
                    </>
                )}
            </section>

            <div className='journal__charts'>
                <section className='journal__panel'>
                    <h2 className='journal__panel-title'>{localize('Running result')}</h2>
                    <Sparkline values={profits} way={wayOf(profits)} width={320} height={64} />
                    <p className='journal__hint'>
                        {localize('Profit and loss added up after each trade, oldest to newest.')}
                    </p>
                </section>
                <section className='journal__panel'>
                    <h2 className='journal__panel-title'>{localize('Stake over time')}</h2>
                    <Sparkline values={stakes} way='flat' width={320} height={64} />
                    <p className='journal__hint'>
                        {localize(
                            'The stake of each trade, oldest to newest. A line that climbs after losses is worth noticing.'
                        )}
                    </p>
                </section>
            </div>

            <section className='journal__panel'>
                <h2 className='journal__panel-title'>{localize('Biggest win and loss')}</h2>
                <p className='journal__text' data-testid='dt_journal_extremes'>
                    {summary.biggest_win
                        ? localize('Biggest win: {{amount}} on {{market}}.', {
                              amount: money(summary.biggest_win.profit),
                              market: summary.biggest_win.symbol,
                          })
                        : localize('No winning trade yet.')}{' '}
                    {summary.biggest_loss
                        ? localize('Biggest loss: {{amount}} on {{market}}.', {
                              amount: money(summary.biggest_loss.profit),
                              market: summary.biggest_loss.symbol,
                          })
                        : localize('No losing trade yet.')}
                </p>
            </section>

            <section className='journal__panel'>
                <h2 className='journal__panel-title'>{localize('By market')}</h2>
                <table className='journal__table'>
                    <thead>
                        <tr>
                            <th scope='col'>{localize('Market')}</th>
                            <th scope='col'>{localize('Trades')}</th>
                            <th scope='col'>{localize('Win rate')}</th>
                            <th scope='col'>{localize('Result')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {summary.markets.map(market => (
                            <tr key={market.symbol} data-testid='dt_journal_market_row'>
                                <th scope='row'>{market.symbol}</th>
                                <td>{market.trades}</td>
                                <td>{percent(market.win_rate)}</td>
                                <td
                                    className={classNames(
                                        'journal__cell-result',
                                        toneOf(market.profit) && `journal__cell-result--${toneOf(market.profit)}`
                                    )}
                                >
                                    {money(market.profit)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        </>
    );
};

const Journal = observer(() => {
    const { client, common } = useStore();
    const history = useHistory();
    const { is_logged_in, currency, loginid, is_virtual } = client;
    const { state, reload } = useJournal(loginid, Boolean(is_logged_in));
    const [range_id, setRangeId] = React.useState<(typeof RANGES)[number]['id']>('all');

    const range = RANGES.find(item => item.id === range_id) ?? RANGES[2];
    const trades = state.status === 'ready' ? lastTrades(state.trades, range.count) : [];
    const summary = summariseTrades(trades);

    let body: React.ReactNode;
    if (!is_logged_in) {
        body = (
            <section className='journal__panel journal__state' data-testid='dt_journal_logged_out'>
                <p className='journal__text'>{localize('Log in to see the results of your own trades.')}</p>
                <button
                    type='button'
                    className='journal__button'
                    onClick={() => redirectToLogin(common.current_language)}
                >
                    {localize('Log in')}
                </button>
            </section>
        );
    } else if (state.status === 'idle' || state.status === 'loading') {
        body = (
            <p className='journal__text' role='status' data-testid='dt_journal_loading'>
                {localize('Loading your trades…')}
            </p>
        );
    } else if (state.status === 'error') {
        body = (
            <section className='journal__panel journal__state' role='alert' data-testid='dt_journal_error'>
                <p className='journal__text'>{state.message || localize('Your trades could not be loaded.')}</p>
                <button type='button' className='journal__button' onClick={reload}>
                    {localize('Try again')}
                </button>
            </section>
        );
    } else if (!summary) {
        body = (
            <section className='journal__panel journal__state' data-testid='dt_journal_empty'>
                <p className='journal__text'>
                    {localize(
                        'There are no finished trades on this account yet. Once you close a trade it shows up here.'
                    )}
                </p>
                <button type='button' className='journal__button' onClick={() => history.push(routes.index)}>
                    {localize('Go to Trade')}
                </button>
            </section>
        );
    } else {
        body = (
            <>
                <div className='journal__ranges' role='group' aria-label={localize('Which trades to include')}>
                    {RANGES.map(item => (
                        <button
                            key={item.id}
                            type='button'
                            aria-pressed={item.id === range_id}
                            className={classNames('journal__range', { 'journal__range--active': item.id === range_id })}
                            onClick={() => setRangeId(item.id)}
                        >
                            {item.label()}
                        </button>
                    ))}
                </div>
                <Results trades={trades} summary={summary} currency={currency} />
            </>
        );
    }

    return (
        <div className='journal' data-testid='dt_journal'>
            <header className='journal__header'>
                <h1 className='journal__title'>{localize('Trade journal')}</h1>
                <p className='journal__subtitle'>
                    {is_logged_in
                        ? localize('Your finished trades on account {{loginid}} ({{kind}}), up to the latest 500.', {
                              loginid: loginid ?? '',
                              kind: is_virtual ? localize('demo') : localize('real'),
                          })
                        : localize('Your own results, in plain numbers.')}
                </p>
            </header>
            {body}
            <p className='journal__disclaimer'>
                {localize(
                    'These numbers describe trades that already closed. Past results do not predict future ones, and trading can lose money.'
                )}
            </p>
        </div>
    );
});

export default Journal;
