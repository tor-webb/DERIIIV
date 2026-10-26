import React from 'react';

import { formatMoneyText } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

import { TPlanKind, TStakePlan } from './stake-math';

import './stake-tools.scss';

/* ------------------------------ helpers ------------------------------ */

export const toNumber = (value: string) => (value.trim() === '' ? NaN : Number(value));
export const money = (currency: string, value: number) => formatMoneyText(currency, value);
export const percent = (value: number, digits = 1) => `${value.toFixed(digits)}%`;

/** Reads a limit field: empty means off (0). */
export const toLimit = (value: string) => (value.trim() === '' ? 0 : Number(value));

/* ------------------------------ form parts ------------------------------ */

type TFieldProps = {
    id: string;
    testid: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    suffix?: string;
    hint?: string;
    disabled?: boolean;
    step?: string;
    min?: string;
};

export const Field = ({
    id,
    testid,
    label,
    value,
    onChange,
    suffix,
    hint,
    disabled,
    step = 'any',
    min = '0',
}: TFieldProps) => (
    <label className='stake-tool__field' htmlFor={id}>
        <span className='stake-tool__label'>{label}</span>
        <span className='stake-tool__input-wrap'>
            <input
                id={id}
                data-testid={testid}
                className='stake-tool__input'
                type='number'
                inputMode='decimal'
                min={min}
                step={step}
                value={value}
                disabled={disabled}
                onChange={event => onChange(event.target.value)}
            />
            {suffix && <span className='stake-tool__suffix'>{suffix}</span>}
        </span>
        {hint && <span className='stake-tool__hint'>{hint}</span>}
    </label>
);

type TSelectFieldProps = {
    id: string;
    testid: string;
    label: string;
    value: string;
    options: [string, string][];
    onChange: (value: string) => void;
    hint?: string;
};

export const SelectField = ({ id, testid, label, value, options, onChange, hint }: TSelectFieldProps) => (
    <label className='stake-tool__field' htmlFor={id}>
        <span className='stake-tool__label'>{label}</span>
        <select
            id={id}
            data-testid={testid}
            className='stake-tool__input stake-tool__select'
            value={value}
            onChange={event => onChange(event.target.value)}
        >
            {options.map(([text, option_value]) => (
                <option key={option_value} value={option_value}>
                    {text}
                </option>
            ))}
        </select>
        {hint && <span className='stake-tool__hint'>{hint}</span>}
    </label>
);

export const Result = ({
    label,
    value,
    tone,
    testid,
}: {
    label: string;
    value: string;
    tone?: 'good' | 'bad';
    testid?: string;
}) => (
    <div className='stake-tool__result'>
        <span className='stake-tool__result-label'>{label}</span>
        <span
            className={`stake-tool__result-value${tone ? ` stake-tool__result-value--${tone}` : ''}`}
            data-testid={testid}
        >
            {value}
        </span>
    </div>
);

export const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h2 className='stake-tool__section-title'>{children}</h2>
);

/* ------------------------------ stake plan form ------------------------------ */

export type TPlanForm = {
    kind: TPlanKind;
    base_stake: string;
    multiplier: string;
    step: string;
    max_stake: string;
};

export const DEFAULT_PLAN_FORM: TPlanForm = {
    kind: 'fixed',
    base_stake: '10',
    multiplier: '2',
    step: '1',
    max_stake: '',
};

export const planFromForm = (form: TPlanForm): TStakePlan => ({
    kind: form.kind,
    base_stake: toNumber(form.base_stake),
    multiplier: toNumber(form.multiplier),
    step: toNumber(form.step),
    max_stake: toLimit(form.max_stake),
});

type TStakePlanFieldsProps = {
    prefix: string;
    currency: string;
    form: TPlanForm;
    onChange: (patch: Partial<TPlanForm>) => void;
};

export const StakePlanFields = ({ prefix, currency, form, onChange }: TStakePlanFieldsProps) => (
    <React.Fragment>
        <SelectField
            id={`${prefix}_plan`}
            testid={`dt_${prefix}_plan`}
            label={localize('Stake plan')}
            value={form.kind}
            options={[
                [localize('Fixed stake'), 'fixed'],
                [localize('Martingale: multiply after a loss'), 'martingale'],
                [localize("D'Alembert: add after a loss, take off after a win"), 'dalembert'],
            ]}
            onChange={kind => onChange({ kind: kind as TPlanKind })}
        />
        <Field
            id={`${prefix}_base_stake`}
            testid={`dt_${prefix}_base_stake`}
            label={localize('Stake per contract')}
            value={form.base_stake}
            onChange={base_stake => onChange({ base_stake })}
            suffix={currency}
        />
        {form.kind === 'martingale' && (
            <Field
                id={`${prefix}_multiplier`}
                testid={`dt_${prefix}_multiplier`}
                label={localize('Multiply the stake after a loss by')}
                value={form.multiplier}
                onChange={multiplier => onChange({ multiplier })}
                suffix='x'
                step='0.1'
                min='1'
            />
        )}
        {form.kind === 'dalembert' && (
            <Field
                id={`${prefix}_step`}
                testid={`dt_${prefix}_step`}
                label={localize('Step')}
                value={form.step}
                onChange={step => onChange({ step })}
                suffix={currency}
            />
        )}
        {form.kind !== 'fixed' && (
            <Field
                id={`${prefix}_max_stake`}
                testid={`dt_${prefix}_max_stake`}
                label={localize('Maximum stake')}
                value={form.max_stake}
                onChange={max_stake => onChange({ max_stake })}
                suffix={currency}
                hint={localize('The plan stops instead of staking more than this. Leave empty for no cap.')}
            />
        )}
    </React.Fragment>
);

/* ------------------------------ win rate against break-even ------------------------------ */

type TWinRateGaugeProps = {
    win_rate: number;
    break_even: number;
    /** What the win rate is called, so the page can say "Assumed" or leave it as "Win rate". */
    rate_label: string;
};

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** A bar from 0 to 100% with the win rate filled in and a marker where the win rate breaks even. */
export const WinRateGauge = ({ win_rate, break_even, rate_label }: TWinRateGaugeProps) => {
    const above = win_rate >= break_even;
    return (
        <div
            className='stake-tool__gauge'
            role='img'
            data-testid='dt_stake_gauge'
            aria-label={localize('{{label}} {{rate}}, break-even {{break_even}}', {
                label: rate_label,
                rate: percent(win_rate),
                break_even: percent(break_even),
            })}
        >
            <div className='stake-tool__gauge-track'>
                <div
                    className={`stake-tool__gauge-fill stake-tool__gauge-fill--${above ? 'good' : 'bad'}`}
                    style={{ width: `${clamp(win_rate)}%` }}
                />
                <div className='stake-tool__gauge-marker' style={{ left: `${clamp(break_even)}%` }} />
            </div>
            <div className='stake-tool__gauge-legend'>
                <span>
                    {rate_label} <strong>{percent(win_rate)}</strong>
                </span>
                <span>
                    {localize('Break-even')} <strong>{percent(break_even)}</strong>
                </span>
            </div>
        </div>
    );
};

/* ------------------------------ balance chart ------------------------------ */

const CHART_WIDTH = 600;
const CHART_HEIGHT = 200;
const CHART_PADDING = 10;
const MAX_CHART_POINTS = 400;

type TEquityChartProps = {
    /** Balance after every trade, starting with the opening balance. */
    series: number[];
    baseline: number;
    label: string;
};

/** A plain SVG line of the balance, with a dashed line at the opening balance. */
export const EquityChart = ({ series, baseline, label }: TEquityChartProps) => {
    if (series.length < 2 || !Number.isFinite(baseline) || !series.every(Number.isFinite)) return null;

    const stride = Math.max(1, Math.ceil(series.length / MAX_CHART_POINTS));
    const points = series.filter((_value, index) => index % stride === 0 || index === series.length - 1);
    const low = Math.min(baseline, ...points);
    const high = Math.max(baseline, ...points);
    const span = high - low || 1;
    const x = (index: number) => (index / (points.length - 1)) * CHART_WIDTH;
    const y = (value: number) =>
        CHART_HEIGHT - CHART_PADDING - ((value - low) / span) * (CHART_HEIGHT - 2 * CHART_PADDING);
    const path = points
        .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
        .join(' ');

    return (
        <svg
            className='stake-tool__chart'
            data-testid='dt_stake_chart'
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            preserveAspectRatio='none'
            role='img'
            aria-label={label}
        >
            <line className='stake-tool__chart-baseline' x1='0' x2={CHART_WIDTH} y1={y(baseline)} y2={y(baseline)} />
            <path className='stake-tool__chart-line' d={path} />
        </svg>
    );
};
