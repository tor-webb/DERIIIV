import React from 'react';

import { localize } from '@deriv-com/translations';

import { MARKET_SYMBOLS } from './markets-config';
import {
    arePriceAlertsOn,
    readThresholds,
    setPriceAlertsOn,
    THRESHOLD_CHOICES,
    TThresholds,
    withThreshold,
    writeThresholds,
} from './price-alerts';

import './price-alerts-panel.scss';

type TPriceAlertsPanelProps = { watchlist: string[] };

/** Lets a person pick, for each starred market, how big an hourly move should pop up an alert. */
const PriceAlertsPanel = ({ watchlist }: TPriceAlertsPanelProps) => {
    const [thresholds, setThresholds] = React.useState<TThresholds>(readThresholds);
    const [is_on, setIsOn] = React.useState(arePriceAlertsOn);
    const markets = MARKET_SYMBOLS.filter(market => watchlist.includes(market.symbol));

    const choose = (symbol: string, value: string) => {
        const next = withThreshold(thresholds, symbol, value === '' ? null : Number(value));
        setThresholds(next);
        writeThresholds(next);
    };

    const toggle = () => {
        setPriceAlertsOn(!is_on);
        setIsOn(!is_on);
    };

    return (
        <section
            className='price-alerts-panel'
            aria-labelledby='price-alerts-title'
            data-testid='dt_price_alerts_panel'
        >
            <div className='price-alerts-panel__head'>
                <h2 id='price-alerts-title' className='price-alerts-panel__title'>
                    {localize('Price alerts')}
                </h2>
                <button
                    type='button'
                    className='price-alerts-panel__switch'
                    role='switch'
                    aria-checked={is_on}
                    data-testid='dt_price_alerts_switch'
                    onClick={toggle}
                >
                    {is_on ? localize('Alerts on') : localize('Alerts off')}
                </button>
            </div>
            <p className='price-alerts-panel__text'>
                {localize(
                    'Get one pop-up when a starred market is up or down by the amount you choose over the last hour, at most once an hour per market. Alerts only work while this site is open, and they describe a move that already happened. They are not advice to trade.'
                )}
            </p>
            {markets.length === 0 ? (
                <p className='price-alerts-panel__text' data-testid='dt_price_alerts_empty'>
                    {localize('Tap the star next to a market to add it, then choose an alert here.')}
                </p>
            ) : (
                <ul className='price-alerts-panel__list'>
                    {markets.map(market => (
                        <li key={market.symbol} className='price-alerts-panel__item'>
                            <label htmlFor={`alert_${market.symbol}`}>{market.name}</label>
                            <select
                                id={`alert_${market.symbol}`}
                                value={thresholds[market.symbol] === undefined ? '' : String(thresholds[market.symbol])}
                                disabled={!is_on}
                                data-testid={`dt_price_alert_${market.symbol}`}
                                onChange={event => choose(market.symbol, event.target.value)}
                            >
                                <option value=''>{localize('No alert')}</option>
                                {THRESHOLD_CHOICES.map(choice => (
                                    <option key={choice} value={String(choice)}>
                                        {localize('Move of {{percent}} or more', { percent: `${choice}%` })}
                                    </option>
                                ))}
                            </select>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

export default PriceAlertsPanel;
