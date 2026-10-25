import React from 'react';

import { getBrandName } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import { formatBalanceWithCurrency } from 'AppV2/Utils/format-balance';

import { calcPositionSize, calcRewardRisk, calcStakePlan } from './risk-utils';

import './risk-calculator.scss';

type TMode = 'position' | 'stake';

const toNumber = (value: string) => (value.trim() === '' ? NaN : Number(value));
const money = (currency: string, value: number) => formatBalanceWithCurrency(currency, value);
const lotsText = (lots: number) => (lots > 0 && lots < 0.01 ? '<0.01' : lots.toFixed(2));
const percent = (value: number) => `${value.toFixed(value < 1 && value > 0 ? 3 : 1)}%`;

type TFieldProps = {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    suffix?: string;
    hint?: string;
};

const Field = ({ id, label, value, onChange, suffix, hint }: TFieldProps) => (
    <label className='risk-calculator__field' htmlFor={id}>
        <span className='risk-calculator__label'>{label}</span>
        <span className='risk-calculator__input-wrap'>
            <input
                id={id}
                data-testid={`dt_risk_${id}`}
                className='risk-calculator__input'
                type='number'
                inputMode='decimal'
                min='0'
                step='any'
                value={value}
                onChange={event => onChange(event.target.value)}
            />
            {suffix && <span className='risk-calculator__suffix'>{suffix}</span>}
        </span>
        {hint && <span className='risk-calculator__hint'>{hint}</span>}
    </label>
);

const Result = ({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) => (
    <div className='risk-calculator__result'>
        <span className='risk-calculator__result-label'>{label}</span>
        <span
            className={`risk-calculator__result-value${tone ? ` risk-calculator__result-value--${tone}` : ''}`}
            data-testid='dt_risk_result'
        >
            {value}
        </span>
    </div>
);

const RiskCalculator = observer(() => {
    const { client } = useStore();
    const currency = client.currency || 'USD';
    const account_balance = client.is_logged_in ? Number(client.balance) : NaN;

    const [mode, setMode] = React.useState<TMode>('position');
    const [balance, setBalance] = React.useState(Number.isFinite(account_balance) ? String(account_balance) : '1000');
    const [risk_percent, setRiskPercent] = React.useState('1');
    const [stop_loss_pips, setStopLossPips] = React.useState('20');
    const [pip_value, setPipValue] = React.useState('10');
    const [reward_ratio, setRewardRatio] = React.useState('2');
    const [payout_percent, setPayoutPercent] = React.useState('85');
    const [win_rate, setWinRate] = React.useState('55');

    const position = calcPositionSize({
        balance: toNumber(balance),
        risk_percent: toNumber(risk_percent),
        stop_loss_pips: toNumber(stop_loss_pips),
        pip_value_per_lot: toNumber(pip_value),
    });
    const reward = position ? calcRewardRisk(position.risk_amount, toNumber(reward_ratio)) : null;
    const plan = calcStakePlan({
        balance: toNumber(balance),
        risk_percent: toNumber(risk_percent),
        payout_percent: toNumber(payout_percent),
        win_rate: toNumber(win_rate),
    });
    const risk_is_high = toNumber(risk_percent) > 2;

    return (
        <main className='risk-calculator' data-testid='dt_risk_calculator'>
            <section className='risk-calculator__header'>
                <h1 className='risk-calculator__title'>{localize('Risk calculator')}</h1>
                <p className='risk-calculator__subtitle'>
                    {localize('Decide how much to risk before you place a trade on {{brand}}.', {
                        brand: getBrandName(),
                    })}
                </p>
            </section>

            <div className='risk-calculator__tabs' role='tablist'>
                {(
                    [
                        ['position', localize('Position size')],
                        ['stake', localize('Stake and streaks')],
                    ] as [TMode, string][]
                ).map(([id, label]) => (
                    <button
                        key={id}
                        type='button'
                        role='tab'
                        aria-selected={mode === id}
                        data-testid={`dt_risk_tab_${id}`}
                        className={`risk-calculator__tab${mode === id ? ' risk-calculator__tab--active' : ''}`}
                        onClick={() => setMode(id)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <section className='risk-calculator__panel'>
                <div className='risk-calculator__form'>
                    <Field
                        id='balance'
                        label={localize('Account balance')}
                        value={balance}
                        onChange={setBalance}
                        suffix={currency}
                        hint={Number.isFinite(account_balance) ? localize('Filled in from your account.') : undefined}
                    />
                    <Field
                        id='risk_percent'
                        label={localize('Risk per trade')}
                        value={risk_percent}
                        onChange={setRiskPercent}
                        suffix='%'
                        hint={localize('Many traders keep this at 1% to 2%.')}
                    />
                    {mode === 'position' ? (
                        <React.Fragment>
                            <Field
                                id='stop_loss_pips'
                                label={localize('Stop loss')}
                                value={stop_loss_pips}
                                onChange={setStopLossPips}
                                suffix={localize('pips')}
                            />
                            <Field
                                id='pip_value'
                                label={localize('Value of one pip, per lot')}
                                value={pip_value}
                                onChange={setPipValue}
                                suffix={currency}
                                hint={localize('Check this for your instrument. 10 is common for EUR/USD.')}
                            />
                            <Field
                                id='reward_ratio'
                                label={localize('Reward to risk')}
                                value={reward_ratio}
                                onChange={setRewardRatio}
                                suffix={localize('to 1')}
                            />
                        </React.Fragment>
                    ) : (
                        <React.Fragment>
                            <Field
                                id='payout_percent'
                                label={localize('Profit when a contract wins')}
                                value={payout_percent}
                                onChange={setPayoutPercent}
                                suffix='%'
                                hint={localize('Of your stake, shown on the trade page.')}
                            />
                            <Field
                                id='win_rate'
                                label={localize('Your win rate')}
                                value={win_rate}
                                onChange={setWinRate}
                                suffix='%'
                                hint={localize('Use your own results, not a hope.')}
                            />
                        </React.Fragment>
                    )}
                </div>

                <div className='risk-calculator__results' aria-live='polite'>
                    {risk_is_high && (
                        <p className='risk-calculator__warning' data-testid='dt_risk_warning'>
                            {localize('Risking more than 2% per trade can empty an account after a short losing run.')}
                        </p>
                    )}

                    {mode === 'position' &&
                        (position ? (
                            <React.Fragment>
                                <Result
                                    label={localize('Amount at risk')}
                                    value={money(currency, position.risk_amount)}
                                />
                                <Result
                                    label={localize('Position size')}
                                    value={`${lotsText(position.lots)} ${localize('lots')}`}
                                />
                                {reward && (
                                    <React.Fragment>
                                        <Result
                                            label={localize('Target profit')}
                                            value={money(currency, reward.reward_amount)}
                                            tone='good'
                                        />
                                        <Result
                                            label={localize('Win rate needed to break even')}
                                            value={percent(reward.breakeven_win_rate)}
                                        />
                                    </React.Fragment>
                                )}
                            </React.Fragment>
                        ) : (
                            <p className='risk-calculator__empty'>
                                {localize('Enter values above zero to see results.')}
                            </p>
                        ))}

                    {mode === 'stake' &&
                        (plan ? (
                            <React.Fragment>
                                <Result label={localize('Stake per trade')} value={money(currency, plan.stake)} />
                                <Result
                                    label={localize('Profit if it wins')}
                                    value={money(currency, plan.profit_if_win)}
                                    tone='good'
                                />
                                <Result
                                    label={localize('Expected result per trade')}
                                    value={money(currency, plan.expected_value)}
                                    tone={plan.expected_value >= 0 ? 'good' : 'bad'}
                                />
                                <Result
                                    label={localize('Win rate needed to break even')}
                                    value={percent(plan.breakeven_win_rate)}
                                />
                                <table className='risk-calculator__table'>
                                    <caption>{localize('If you lose in a row (fixed stake)')}</caption>
                                    <thead>
                                        <tr>
                                            <th>{localize('Losses')}</th>
                                            <th>{localize('Chance')}</th>
                                            <th>{localize('Balance lost')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {plan.streaks.map(streak => (
                                            <tr key={streak.losses}>
                                                <td>{streak.losses}</td>
                                                <td>{percent(streak.probability)}</td>
                                                <td>{percent(streak.drawdown)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <p className='risk-calculator__note' data-testid='dt_risk_martingale'>
                                    {localize(
                                        'If a bot doubles the stake after every loss, this balance can fund {{count}} trades in a row. After {{count}} straight losses the next doubled stake is more than you would have left.',
                                        { count: plan.doubling_steps_affordable }
                                    )}
                                </p>
                            </React.Fragment>
                        ) : (
                            <p className='risk-calculator__empty'>
                                {localize('Enter values above zero to see results.')}
                            </p>
                        ))}
                </div>
            </section>

            <p className='risk-calculator__disclaimer'>
                {localize(
                    'This is a planning tool, not advice. Results depend on the numbers you enter, and you can lose money on every trade.'
                )}
            </p>
        </main>
    );
});

export default RiskCalculator;
