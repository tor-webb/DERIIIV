import classNames from 'classnames';

import { localize } from '@deriv-com/translations';

import { directionClass } from './voltrex-detail';
import type { TPerformance, TSignalEvent } from './voltrex-stats';
import type { TTrade } from './voltrex-trader';

type TProps = {
    trades: TTrade[];
    events: TSignalEvent[];
    stats: TPerformance;
    currency: string;
};

const money = (value: number, currency: string) => `${value > 0 ? '+' : ''}${value.toFixed(2)} ${currency}`;
const clock = (time: number) => new Date(time).toLocaleTimeString();

const STATUS_TEXT = () => ({
    placing: localize('Placing'),
    open: localize('Open'),
    won: localize('Won'),
    lost: localize('Lost'),
    failed: localize('Not placed'),
});

const sideText = (side: 'CALL' | 'PUT') => (side === 'CALL' ? localize('Rise') : localize('Fall'));

const tone = (value: number) => {
    if (value > 0) return 'voltrex__tone--buy';
    return value < 0 ? 'voltrex__tone--sell' : undefined;
};

const VoltrexActivity = ({ trades, events, stats, currency }: TProps) => {
    const status_text = STATUS_TEXT();
    const active = trades.filter(trade => trade.status === 'placing' || trade.status === 'open');
    const recent = trades.filter(trade => trade.status !== 'placing' && trade.status !== 'open').slice(0, 12);

    return (
        <div className='voltrex__bottom'>
            <section className='voltrex__panel' aria-label={localize('Active trades')}>
                <h2 className='voltrex__panel-title'>{localize('Active trades')}</h2>
                {active.length === 0 ? (
                    <p className='voltrex__muted' data-testid='voltrex-no-active'>
                        {localize('No trades are open.')}
                    </p>
                ) : (
                    <ul className='voltrex-list' data-testid='voltrex-active'>
                        {active.map(trade => (
                            <li key={trade.id} className='voltrex-list__item'>
                                <strong>{trade.name}</strong>
                                <span>
                                    {sideText(trade.side)} · {trade.stake.toFixed(2)} ·{' '}
                                    {trade.source === 'auto' ? localize('auto') : localize('manual')}
                                </span>
                                <span className='voltrex__badge voltrex__badge--running'>
                                    {status_text[trade.status]}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className='voltrex__panel' aria-label={localize('Recent executions')}>
                <h2 className='voltrex__panel-title'>{localize('Recent executions')}</h2>
                {recent.length === 0 ? (
                    <p className='voltrex__muted'>{localize('Nothing has finished yet.')}</p>
                ) : (
                    <ul className='voltrex-list' data-testid='voltrex-recent'>
                        {recent.map(trade => (
                            <li key={trade.id} className='voltrex-list__item'>
                                <strong>{trade.name}</strong>
                                <span>
                                    {sideText(trade.side)} ·{' '}
                                    {trade.source === 'auto' ? localize('auto') : localize('manual')}
                                </span>
                                <span
                                    className={classNames(
                                        'voltrex__badge',
                                        trade.status === 'won' && 'voltrex__tone--buy',
                                        trade.status === 'lost' && 'voltrex__tone--sell'
                                    )}
                                >
                                    {status_text[trade.status]}
                                    {trade.profit !== undefined && ` ${money(trade.profit, currency)}`}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className='voltrex__panel' aria-label={localize('Scanner activity')}>
                <h2 className='voltrex__panel-title'>{localize('Scanner activity')}</h2>
                {events.length === 0 ? (
                    <p className='voltrex__muted'>{localize('Signal changes will appear here as markets update.')}</p>
                ) : (
                    <ul className='voltrex-list' data-testid='voltrex-events'>
                        {events.slice(0, 12).map(event => (
                            <li key={`${event.symbol}-${event.time}-${event.to}`} className='voltrex-list__item'>
                                <strong>{event.name}</strong>
                                <span>
                                    <span className={directionClass(event.from)}>{event.from}</span> →{' '}
                                    <span className={directionClass(event.to)}>{event.to}</span> ({event.strength})
                                </span>
                                <time className='voltrex__muted'>{clock(event.time)}</time>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className='voltrex__panel' aria-label={localize('Performance')}>
                <h2 className='voltrex__panel-title'>{localize('Performance')}</h2>
                <p className='voltrex__muted'>
                    {localize("Trades placed from this page in this visit, and today's saved total.")}
                </p>
                <dl className='voltrex-detail__readings' data-testid='voltrex-performance'>
                    <dt>{localize('Finished trades')}</dt>
                    <dd data-testid='voltrex-stat-finished'>{stats.finished}</dd>
                    <dt>{localize('Won / lost')}</dt>
                    <dd>
                        {stats.wins} / {stats.losses}
                    </dd>
                    <dt>{localize('Win rate')}</dt>
                    <dd data-testid='voltrex-stat-winrate'>{stats.win_rate === null ? '–' : `${stats.win_rate}%`}</dd>
                    <dt>{localize('Net result (this visit)')}</dt>
                    <dd className={tone(stats.net_profit)}>{money(stats.net_profit, currency)}</dd>
                    <dt>{localize('Result today')}</dt>
                    <dd className={tone(stats.today_profit)}>{money(stats.today_profit, currency)}</dd>
                    <dt>{localize('Losses in a row')}</dt>
                    <dd>{stats.losing_streak}</dd>
                    <dt>{localize('Manual / auto trades')}</dt>
                    <dd>
                        {stats.manual} / {stats.auto}
                    </dd>
                    <dt>{localize('Not placed')}</dt>
                    <dd>{stats.failed}</dd>
                </dl>
            </section>
        </div>
    );
};

export default VoltrexActivity;
