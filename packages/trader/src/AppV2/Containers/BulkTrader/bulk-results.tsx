import React from 'react';

import { localize } from '@deriv-com/translations';

import { breakEvenWinRate, TStopReason, TSummary } from '../StakeTools/stake-math';
import { EquityChart, money, percent, Result, WinRateGauge } from '../StakeTools/stake-tools-ui';

import type { TBulkResult } from './bulk-utils';

const TABLE_ROWS = 25;

export type TOutcome = {
    /** The settings the run used, so the page can tell when they have changed since. */
    key: string;
    symbol_label: string;
    contract_label: string;
    is_digits: boolean;
    currency: string;
    payout_percent: number;
    payout_source: 'quote' | 'input';
    /** Why the live quote was not used, when the user asked for one. */
    quote_error: string | null;
    ticks: { count: number; from: number; to: number };
    result: TBulkResult;
    summary: TSummary;
    series: number[];
    start_balance: number;
    bulk_size: number;
};

const stopText = (reason: TStopReason) => {
    switch (reason) {
        case 'balance':
            return localize('The balance could not cover the next stake.');
        case 'stake_cap':
            return localize('The next stake was above your maximum stake.');
        case 'take_profit':
            return localize('Take profit reached.');
        case 'stop_loss':
            return localize('Stop loss reached.');
        case 'finished':
            return localize('Reached the limit of contracts.');
        default:
            return localize('All the ticks were used.');
    }
};

const formatTime = (epoch_seconds: number) => new Date(epoch_seconds * 1000).toLocaleString();

const Spot = ({ spot, emphasise_last }: { spot: string; emphasise_last: boolean }) =>
    emphasise_last ? (
        <React.Fragment>
            {spot.slice(0, -1)}
            <strong>{spot.slice(-1)}</strong>
        </React.Fragment>
    ) : (
        <React.Fragment>{spot}</React.Fragment>
    );

type TBulkResultsProps = {
    outcome: TOutcome;
    /** The settings have changed since this run. */
    is_stale: boolean;
};

const BulkResults = ({ outcome, is_stale }: TBulkResultsProps) => {
    const { summary, result, payout_percent, currency, is_digits, bulk_size } = outcome;
    const break_even = breakEvenWinRate(payout_percent);

    return (
        <React.Fragment>
            {is_stale && (
                <p className='stake-tool__warning' data-testid='dt_bulk_stale'>
                    {localize(
                        'You changed the settings. These results are from the last run. Run again to update them.'
                    )}
                </p>
            )}

            <p className='stake-tool__note' data-testid='dt_bulk_source'>
                {localize('{{contract}} on {{market}}, settled on {{count}} real ticks from {{from}} to {{to}}.', {
                    contract: outcome.contract_label,
                    market: outcome.symbol_label,
                    count: outcome.ticks.count,
                    from: formatTime(outcome.ticks.from),
                    to: formatTime(outcome.ticks.to),
                })}{' '}
                {outcome.payout_source === 'quote'
                    ? localize('Payout from a live quote: {{payout}} profit on a win.', {
                          payout: percent(payout_percent, 2),
                      })
                    : localize('Payout you entered: {{payout}} profit on a win.', {
                          payout: percent(payout_percent, 2),
                      })}
            </p>

            {outcome.quote_error && (
                <p className='stake-tool__warning' data-testid='dt_bulk_quote_error'>
                    {localize('The live payout was not available ({{reason}}), so the payout you entered was used.', {
                        reason: outcome.quote_error,
                    })}
                </p>
            )}

            {summary.trades === 0 ? (
                <p className='stake-tool__empty' data-testid='dt_bulk_no_trades'>
                    {localize('No contract was bought. {{reason}}', { reason: stopText(result.stop_reason) })}
                </p>
            ) : (
                <React.Fragment>
                    <WinRateGauge
                        win_rate={summary.win_rate ?? 0}
                        break_even={break_even}
                        rate_label={localize('Win rate')}
                    />
                    <VerdictText outcome={outcome} break_even={break_even} />

                    <Result
                        label={localize('Profit or loss')}
                        value={money(currency, summary.profit)}
                        tone={summary.profit >= 0 ? 'good' : 'bad'}
                        testid='dt_bulk_profit'
                    />
                    <Result
                        label={localize('Purchases won')}
                        value={`${summary.wins} / ${summary.trades}`}
                        testid='dt_bulk_wins'
                    />
                    <Result label={localize('Final balance')} value={money(currency, summary.final_balance)} />
                    <Result label={localize('Total staked')} value={money(currency, summary.staked)} />
                    <Result
                        label={localize('Biggest drop from a peak')}
                        value={`${money(currency, summary.max_drawdown)} (${percent(summary.max_drawdown_percent)})`}
                        tone={summary.max_drawdown > 0 ? 'bad' : undefined}
                        testid='dt_bulk_drawdown'
                    />
                    <Result label={localize('Longest losing streak')} value={String(summary.longest_losing_streak)} />
                    <Result label={localize('Stopped because')} value={stopText(result.stop_reason)} />

                    <EquityChart
                        series={outcome.series}
                        baseline={outcome.start_balance}
                        label={localize('Balance after each purchase, from {{start}} to {{end}}', {
                            start: money(currency, outcome.start_balance),
                            end: money(currency, summary.final_balance),
                        })}
                    />

                    <div className='stake-tool__table-wrap'>
                        <table className='stake-tool__table' data-testid='dt_bulk_table'>
                            <caption>
                                {summary.trades > TABLE_ROWS
                                    ? localize('Latest {{shown}} of {{total}} purchases', {
                                          shown: TABLE_ROWS,
                                          total: summary.trades,
                                      })
                                    : localize('All {{total}} purchases', { total: summary.trades })}
                            </caption>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>{localize('Entry to exit')}</th>
                                    <th>{localize('Stake')}</th>
                                    <th>{localize('Result')}</th>
                                    <th>{localize('Profit')}</th>
                                    <th>{localize('Balance')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...result.trades]
                                    .reverse()
                                    .slice(0, TABLE_ROWS)
                                    .map(trade => (
                                        <tr key={trade.number}>
                                            <td>{trade.number}</td>
                                            <td>
                                                {trade.detail.entry_spot} to{' '}
                                                <Spot spot={trade.detail.exit_spot} emphasise_last={is_digits} />
                                            </td>
                                            <td>
                                                {money(currency, trade.stake)}
                                                {bulk_size > 1 ? ` x ${bulk_size}` : ''}
                                            </td>
                                            <td className={trade.won ? 'stake-tool__won' : 'stake-tool__lost'}>
                                                {trade.won ? localize('Won') : localize('Lost')}
                                            </td>
                                            <td>{money(currency, trade.profit)}</td>
                                            <td>{money(currency, trade.balance)}</td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    </div>
                </React.Fragment>
            )}
        </React.Fragment>
    );
};

const VerdictText = ({ outcome, break_even }: { outcome: TOutcome; break_even: number }) => {
    const { summary } = outcome;
    const win_rate = summary.win_rate ?? 0;
    const gap = win_rate - break_even;
    // if the true win rate were exactly break-even, this is how far luck alone could move the result (about 95% of the time)
    const be_chance = break_even / 100;
    const luck = 2 * Math.sqrt((be_chance * (1 - be_chance)) / summary.trades) * 100;
    const is_above = gap >= 0;

    return (
        <React.Fragment>
            <p
                className={`stake-tool__verdict stake-tool__verdict--${is_above ? 'good' : 'bad'}`}
                data-testid='dt_bulk_verdict'
            >
                {is_above
                    ? localize('{{gap}} points above break-even', { gap: gap.toFixed(1) })
                    : localize('{{gap}} points short of break-even', { gap: Math.abs(gap).toFixed(1) })}
            </p>
            <p className='stake-tool__note' data-testid='dt_bulk_luck'>
                {localize(
                    'Break-even is the win rate where this payout neither makes nor loses money, whatever the stake plan. With {{count}} purchases, luck alone can move a win rate by about {{luck}} points either way, so a short run proves little.',
                    { count: summary.trades, luck: luck.toFixed(1) }
                )}
            </p>
        </React.Fragment>
    );
};

export default BulkResults;
