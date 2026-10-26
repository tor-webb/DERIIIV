import React from 'react';

import { getBrandName } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import {
    breakEvenWinRate,
    isValidPlan,
    lossesAffordable,
    simulateShortfalls,
    TWhatIfInput,
} from '../StakeTools/stake-math';
import {
    DEFAULT_PLAN_FORM,
    EquityChart,
    Field,
    money,
    percent,
    planFromForm,
    Result,
    SectionTitle,
    StakePlanFields,
    toLimit,
    toNumber,
    TPlanForm,
    WinRateGauge,
} from '../StakeTools/stake-tools-ui';

/** Simulated runs behind every figure. Enough for steady percentages, small enough to recalculate as you type. */
export const RUNS = 500;
export const MAX_TRADES = 500;

const WhatIfCalculator = observer(() => {
    const { client } = useStore();
    const currency = client.currency || 'USD';
    const account_balance = client.is_logged_in ? Number(client.balance) : NaN;

    const [balance, setBalance] = React.useState(Number.isFinite(account_balance) ? String(account_balance) : '1000');
    const [payout, setPayout] = React.useState('95');
    const [win_rate, setWinRate] = React.useState('55');
    const [trades, setTrades] = React.useState('100');
    const [plan_form, setPlanForm] = React.useState<TPlanForm>(DEFAULT_PLAN_FORM);
    const [take_profit, setTakeProfit] = React.useState('');
    const [stop_loss, setStopLoss] = React.useState('');

    const input: TWhatIfInput = React.useMemo(
        () => ({
            plan: planFromForm(plan_form),
            start_balance: toNumber(balance),
            payout_percent: toNumber(payout),
            win_rate: toNumber(win_rate),
            trades: toNumber(trades),
            runs: RUNS,
            take_profit: toLimit(take_profit),
            stop_loss: toLimit(stop_loss),
        }),
        [plan_form, balance, payout, win_rate, trades, take_profit, stop_loss]
    );
    // the simulation is the slow part, so let typing stay responsive and catch up a moment later
    const deferred_input = React.useDeferredValue(input);

    const rows = React.useMemo(
        () => (deferred_input.trades <= MAX_TRADES ? simulateShortfalls(deferred_input) : []),
        [deferred_input]
    );
    const assumed = rows[0] ?? null;
    const survives = React.useMemo(
        () =>
            isValidPlan(deferred_input.plan) && deferred_input.start_balance > 0
                ? lossesAffordable(deferred_input.plan, deferred_input.start_balance)
                : null,
        [deferred_input]
    );

    const break_even =
        Number.isFinite(input.payout_percent) && input.payout_percent > 0
            ? breakEvenWinRate(input.payout_percent)
            : NaN;
    const gap = assumed ? assumed.win_rate - assumed.break_even_win_rate : 0;

    return (
        <main className='stake-tool' data-testid='dt_whatif'>
            <section className='stake-tool__header'>
                <h1 className='stake-tool__title'>{localize('What-if calculator')}</h1>
                <p className='stake-tool__subtitle'>
                    {localize(
                        'Type a win rate and see what a stake plan would do with it: profit, loss and drawdown. Nothing is bought on {{brand}}.',
                        { brand: getBrandName() }
                    )}
                </p>
            </section>

            <section className='stake-tool__panel'>
                <div className='stake-tool__form'>
                    <SectionTitle>{localize('Your assumption')}</SectionTitle>
                    <Field
                        id='whatif_win_rate'
                        testid='dt_whatif_win_rate'
                        label={localize('Assumed win rate')}
                        value={win_rate}
                        onChange={setWinRate}
                        suffix='%'
                        hint={localize('An input you choose, not a forecast of how often you will win.')}
                    />
                    <Field
                        id='whatif_payout'
                        testid='dt_whatif_payout'
                        label={localize('Profit when a contract wins')}
                        value={payout}
                        onChange={setPayout}
                        suffix='%'
                        hint={
                            Number.isFinite(break_even)
                                ? localize('Of your stake, shown on the trade page. Break-even win rate: {{rate}}.', {
                                      rate: percent(break_even),
                                  })
                                : localize('Of your stake, shown on the trade page.')
                        }
                    />

                    <SectionTitle>{localize('Stake plan')}</SectionTitle>
                    <Field
                        id='whatif_balance'
                        testid='dt_whatif_balance'
                        label={localize('Starting balance')}
                        value={balance}
                        onChange={setBalance}
                        suffix={currency}
                        hint={Number.isFinite(account_balance) ? localize('Filled in from your account.') : undefined}
                    />
                    <StakePlanFields
                        prefix='whatif'
                        currency={currency}
                        form={plan_form}
                        onChange={patch => setPlanForm(previous => ({ ...previous, ...patch }))}
                    />

                    <SectionTitle>{localize('How long')}</SectionTitle>
                    <Field
                        id='whatif_trades'
                        testid='dt_whatif_trades'
                        label={localize('Number of purchases')}
                        value={trades}
                        onChange={setTrades}
                        step='1'
                        min='1'
                        hint={localize('From 1 to {{max}}.', { max: MAX_TRADES })}
                    />
                    <div className='stake-tool__row'>
                        <Field
                            id='whatif_take_profit'
                            testid='dt_whatif_take_profit'
                            label={localize('Take profit')}
                            value={take_profit}
                            onChange={setTakeProfit}
                            suffix={currency}
                        />
                        <Field
                            id='whatif_stop_loss'
                            testid='dt_whatif_stop_loss'
                            label={localize('Stop loss')}
                            value={stop_loss}
                            onChange={setStopLoss}
                            suffix={currency}
                        />
                    </div>
                </div>

                <div className='stake-tool__results' aria-live='polite'>
                    {assumed ? (
                        <React.Fragment>
                            <p className='stake-tool__assumption' data-testid='dt_whatif_assumption'>
                                {localize(
                                    'Assumption, not a prediction. You typed a win rate of {{rate}}. This page shows what would follow if you won that often. It does not say you will.',
                                    { rate: percent(assumed.win_rate) }
                                )}
                            </p>

                            <WinRateGauge
                                win_rate={assumed.win_rate}
                                break_even={assumed.break_even_win_rate}
                                rate_label={localize('Assumed win rate')}
                            />
                            <p
                                className={`stake-tool__verdict stake-tool__verdict--${gap >= 0 ? 'good' : 'bad'}`}
                                data-testid='dt_whatif_verdict'
                            >
                                {gap >= 0
                                    ? localize('{{gap}} points above break-even', { gap: gap.toFixed(1) })
                                    : localize('{{gap}} points short of break-even', { gap: Math.abs(gap).toFixed(1) })}
                            </p>
                            {gap < 0 && (
                                <p className='stake-tool__warning' data-testid='dt_whatif_below'>
                                    {localize(
                                        'At this payout an assumed win rate below break-even loses money on average, whatever the stake plan.'
                                    )}
                                </p>
                            )}

                            <Result
                                label={localize('Expected result per contract')}
                                value={money(currency, assumed.expected_per_trade)}
                                tone={assumed.expected_per_trade >= 0 ? 'good' : 'bad'}
                                testid='dt_whatif_ev'
                            />
                            <Result
                                label={localize('Typical result after {{count}} purchases', {
                                    count: deferred_input.trades,
                                })}
                                value={money(currency, assumed.median_profit)}
                                tone={assumed.median_profit >= 0 ? 'good' : 'bad'}
                                testid='dt_whatif_median'
                            />
                            <Result
                                label={localize('Range (9 in 10 runs)')}
                                value={`${money(currency, assumed.p5_profit)} to ${money(currency, assumed.p95_profit)}`}
                                testid='dt_whatif_range'
                            />
                            <Result
                                label={localize('Chance of ending in profit')}
                                value={percent(assumed.chance_of_profit)}
                                testid='dt_whatif_chance'
                            />
                            <Result
                                label={localize('Chance of running out of balance')}
                                value={percent(assumed.chance_out_of_balance)}
                                tone={assumed.chance_out_of_balance > 0 ? 'bad' : undefined}
                                testid='dt_whatif_ruin'
                            />
                            <Result
                                label={localize('Typical biggest drop from a peak')}
                                value={`${money(currency, assumed.median_max_drawdown)} (${percent(assumed.median_max_drawdown_percent)})`}
                                testid='dt_whatif_drawdown'
                            />
                            <Result
                                label={localize('Deeper drop in 1 of 20 runs')}
                                value={percent(assumed.p95_max_drawdown_percent)}
                            />

                            {survives && (
                                <p className='stake-tool__note' data-testid='dt_whatif_survives'>
                                    {localize(
                                        'If every purchase lost, this balance could pay for {{count}} before the next stake of {{next}} could not be placed.',
                                        { count: survives.count, next: money(currency, survives.next_stake) }
                                    )}
                                </p>
                            )}
                            {deferred_input.plan.kind !== 'fixed' && (
                                <p className='stake-tool__note' data-testid='dt_whatif_plan_note'>
                                    {localize(
                                        'A stake plan changes how bumpy the ride is, not the break-even win rate. The odds only turn when the win rate does.'
                                    )}
                                </p>
                            )}

                            <EquityChart
                                series={assumed.sample_path}
                                baseline={deferred_input.start_balance}
                                label={localize('Balance over one typical run at the assumed win rate')}
                            />
                            <p className='stake-tool__hint'>
                                {localize(
                                    'One run that ended near the typical result. Runs are random: yours would look different.'
                                )}
                            </p>

                            <div className='stake-tool__table-wrap'>
                                <table
                                    className='stake-tool__table stake-tool__table--highlight'
                                    data-testid='dt_whatif_table'
                                >
                                    <caption>{localize('If the win rate falls short of what you assumed')}</caption>
                                    <thead>
                                        <tr>
                                            <th>{localize('Win rate')}</th>
                                            <th>{localize('Typical result')}</th>
                                            <th>{localize('Chance of profit')}</th>
                                            <th>{localize('Out of balance')}</th>
                                            <th>{localize('Typical drop')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map(row => (
                                            <tr key={row.win_rate} data-testid='dt_whatif_row'>
                                                <td>
                                                    {percent(row.win_rate)}{' '}
                                                    {row.shortfall === 0
                                                        ? localize('(assumed)')
                                                        : localize('({{points}} lower)', { points: row.shortfall })}
                                                </td>
                                                <td>{money(currency, row.median_profit)}</td>
                                                <td>{percent(row.chance_of_profit, 0)}</td>
                                                <td>{percent(row.chance_out_of_balance, 0)}</td>
                                                <td>{percent(row.median_max_drawdown_percent, 0)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className='stake-tool__hint'>
                                {localize(
                                    'Each figure comes from {{runs}} simulated runs of {{count}} purchases, with the same random draws at every win rate so the rows compare fairly.',
                                    { runs: RUNS, count: deferred_input.trades }
                                )}
                            </p>
                        </React.Fragment>
                    ) : (
                        <p className='stake-tool__empty' data-testid='dt_whatif_empty'>
                            {input.trades > MAX_TRADES
                                ? localize('Use {{max}} purchases or fewer.', { max: MAX_TRADES })
                                : localize(
                                      'Enter values above zero to see results. The win rate must be from 0 to 100.'
                                  )}
                        </p>
                    )}
                </div>
            </section>

            <p className='stake-tool__disclaimer'>
                {localize(
                    'This is a planning tool, not advice. The win rate is a number you chose, real results depend on the market, and you can lose money on every trade.'
                )}
            </p>
        </main>
    );
});

export default WhatIfCalculator;
