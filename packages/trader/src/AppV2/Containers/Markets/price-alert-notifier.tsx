import React from 'react';
import { useHistory } from 'react-router-dom';

import { routes } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

import { MARKET_SYMBOLS } from './markets-config';
import { TPriceAlert } from './price-alerts';
import { usePriceAlerts } from './use-price-alerts';

import './price-alert-notifier.scss';

const SHOW_FOR_MS = 14000;

const nameOf = (symbol: string) => MARKET_SYMBOLS.find(market => market.symbol === symbol)?.name ?? symbol;

export const alertText = (alert: TPriceAlert) =>
    (alert.percent >= 0
        ? localize('Up {{percent}} in the last hour. Now {{price}}.', {
              percent: `${Math.abs(alert.percent).toFixed(2)}%`,
              price: Number(alert.price.toPrecision(7)),
          })
        : localize('Down {{percent}} in the last hour. Now {{price}}.', {
              percent: `${Math.abs(alert.percent).toFixed(2)}%`,
              price: Number(alert.price.toPrecision(7)),
          })) as string;

/**
 * Small pop-up when a starred market with an alert set has moved that far in the last hour. One per market per hour.
 * It reports a move that already happened. It is not a signal to trade.
 */
const PriceAlertNotifier = () => {
    const { alerts, dismiss, clear } = usePriceAlerts();
    const history = useHistory();

    React.useEffect(() => {
        if (!alerts.length) return undefined;
        const timer = window.setTimeout(clear, SHOW_FOR_MS);
        return () => window.clearTimeout(timer);
    }, [alerts, clear]);

    if (!alerts.length) return null;

    return (
        <div className='price-alert-notifier' role='status' aria-live='polite' data-testid='dt_price_alerts'>
            {alerts.map(alert => (
                <div key={alert.id} className='price-alert-notifier__card'>
                    <button
                        type='button'
                        className='price-alert-notifier__body'
                        data-testid='dt_price_alert_open'
                        onClick={() => {
                            clear();
                            history.push(routes.markets);
                        }}
                    >
                        <span className='price-alert-notifier__label'>
                            {localize('Price alert')} · {nameOf(alert.symbol)}
                        </span>
                        <span className='price-alert-notifier__title'>{alertText(alert)}</span>
                    </button>
                    <button
                        type='button'
                        className='price-alert-notifier__close'
                        aria-label={localize('Dismiss')}
                        data-testid='dt_price_alert_close'
                        onClick={() => dismiss(alert.id)}
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
};

export default PriceAlertNotifier;
