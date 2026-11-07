import React from 'react';

import { localize } from '@deriv-com/translations';

import type { useVoltrexAlerts } from './use-voltrex-alerts';
import type { TScanRow } from './use-voltrex-scanner';
import { ALERT_PRODUCTS, ANY_MARKET, newRuleId, TAlertProduct } from './voltrex-alerts';
import { productLabel } from './voltrex-products';

type TAlerts = ReturnType<typeof useVoltrexAlerts>;

type TProps = {
    alerts: TAlerts;
    rows: TScanRow[];
    onSelect: (symbol: string) => void;
};

const DEFAULT_STRENGTH = 50;

const timeText = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Smart alerts: pick a contract type, a market (or any) and a minimum strength, and the page tells you when an idea
 * reaches it. Alerts only watch. They never place a trade.
 */
const VoltrexAlertsPanel = ({ alerts, rows, onSelect }: TProps) => {
    const [product, setProduct] = React.useState<TAlertProduct>('rise_fall');
    const [symbol, setSymbol] = React.useState(ANY_MARKET);
    const [strength, setStrength] = React.useState(String(DEFAULT_STRENGTH));
    const [error, setError] = React.useState('');

    const markets = React.useMemo(
        () => [...rows].filter(row => row.is_open).sort((a, b) => a.name.localeCompare(b.name)),
        [rows]
    );
    const nameOf = (value: string) =>
        value === ANY_MARKET ? localize('any market') : (rows.find(row => row.symbol === value)?.name ?? value);

    const add = () => {
        const problem = alerts.addRule({ id: newRuleId(), product, symbol, min_strength: Number(strength) });
        setError(problem ?? '');
    };

    return (
        <section
            className='voltrex__panel voltrex-alerts'
            aria-label={localize('Smart alerts')}
            data-testid='voltrex-alerts'
        >
            <h2 className='voltrex__panel-title'>{localize('Smart alerts')}</h2>
            <p className='voltrex__muted'>
                {localize(
                    'Get told when an idea reaches the strength you choose. Alerts only watch, they never trade, and they work while this page is open. Digit ideas describe past digits and do not predict the next one.'
                )}
            </p>

            <div className='voltrex-alerts__form'>
                <label>
                    <span>{localize('Contract')}</span>
                    <select
                        value={product}
                        data-testid='voltrex-alert-product'
                        onChange={event => setProduct(event.target.value as TAlertProduct)}
                    >
                        {ALERT_PRODUCTS.map(item => (
                            <option key={item} value={item}>
                                {productLabel(item)}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>{localize('Market')}</span>
                    <select
                        value={symbol}
                        data-testid='voltrex-alert-symbol'
                        onChange={event => setSymbol(event.target.value)}
                    >
                        <option value={ANY_MARKET}>{localize('Any market')}</option>
                        {markets.map(row => (
                            <option key={row.symbol} value={row.symbol}>
                                {row.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    <span>{localize('Minimum strength')}</span>
                    <input
                        type='number'
                        min={1}
                        max={100}
                        value={strength}
                        data-testid='voltrex-alert-strength'
                        onChange={event => setStrength(event.target.value)}
                    />
                </label>
                <button type='button' className='voltrex__button' data-testid='voltrex-alert-add' onClick={add}>
                    {localize('Add alert')}
                </button>
            </div>
            {error && (
                <p className='voltrex__error' role='alert' data-testid='voltrex-alert-error'>
                    {error}
                </p>
            )}

            {alerts.rules.length > 0 && (
                <ul className='voltrex-alerts__rules' data-testid='voltrex-alert-rules'>
                    {alerts.rules.map(rule => (
                        <li key={rule.id}>
                            <span>
                                <strong>{productLabel(rule.product)}</strong> · {nameOf(rule.symbol)} ·{' '}
                                {localize('strength {{value}}+', { value: rule.min_strength })}
                            </span>
                            <button
                                type='button'
                                data-testid={`voltrex-alert-remove-${rule.id}`}
                                onClick={() => alerts.removeRule(rule.id)}
                            >
                                {localize('Remove')}
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <label className='voltrex-alerts__sound'>
                <input
                    type='checkbox'
                    checked={alerts.sound}
                    data-testid='voltrex-alert-sound'
                    onChange={event => alerts.setSound(event.target.checked)}
                />
                {localize('Play a sound')}
            </label>

            {alerts.fired.length > 0 && (
                <>
                    <h3 className='voltrex__subtitle'>{localize('Recent alerts')}</h3>
                    <ul className='voltrex-alerts__fired' data-testid='voltrex-alert-fired'>
                        {alerts.fired.map(item => (
                            <li key={`${item.rule_id}:${item.symbol}:${item.at}`}>
                                <button type='button' onClick={() => onSelect(item.symbol)}>
                                    <strong>{item.name}</strong> · {item.label} ·{' '}
                                    {localize('strength {{value}}', { value: item.strength })}
                                    <small>
                                        {timeText(item.at)} · {item.why}
                                    </small>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <button type='button' className='voltrex-alerts__clear' onClick={alerts.clearFired}>
                        {localize('Clear')}
                    </button>
                </>
            )}
        </section>
    );
};

export default VoltrexAlertsPanel;
