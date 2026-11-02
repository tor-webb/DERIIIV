import classNames from 'classnames';

import { localize } from '@deriv-com/translations';

import type { TScanRow } from './use-voltrex-scanner';
import VoltrexChart from './voltrex-chart';
import type { TCandle } from './voltrex-indicators';

type TProps = {
    row: TScanRow | null;
    primary: TCandle[];
    confirm: TCandle[];
    primary_label: string;
    confirm_label: string;
    /** Phones show one section at a time; this jumps to the trading section for the market shown. */
    onTrade?: () => void;
};

const digits = (value: number | null, places = 2) => (value === null ? '–' : value.toFixed(places));

export const directionClass = (direction?: string) => {
    if (direction === 'BUY') return 'voltrex__tone--buy';
    return direction === 'SELL' ? 'voltrex__tone--sell' : 'voltrex__tone--neutral';
};

const pendingText = (status: TScanRow['status']) => {
    if (status === 'closed') return localize('This market is closed.');
    if (status === 'unavailable') return localize('No candle data was available for this market.');
    return localize('Loading candles and running the analysis…');
};

const Meter = ({ label, value, testid }: { label: string; value: number; testid: string }) => (
    <div className='voltrex-detail__meter'>
        <div className='voltrex-detail__meter-top'>
            <span>{label}</span>
            <strong data-testid={testid}>{value}</strong>
        </div>
        <div className='voltrex-detail__meter-track' aria-hidden='true'>
            <div className='voltrex-detail__meter-fill' style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
        </div>
    </div>
);

const ALIGNMENT_TEXT = () => ({
    aligned: localize('Both timeframes agree'),
    conflict: localize('Timeframes disagree'),
    mixed: localize('Higher timeframe undecided'),
    unconfirmed: localize('Higher timeframe not loaded'),
});

/** The selected market: price, signal, the chart, the indicator readings and the reasons for the signal. */
const VoltrexDetail = ({ row, primary, confirm, primary_label, confirm_label, onTrade }: TProps) => {
    if (!row) {
        return (
            <section className='voltrex__panel voltrex-detail' aria-label={localize('Selected market')}>
                <h2 className='voltrex__panel-title'>{localize('Selected market')}</h2>
                <p className='voltrex__muted'>
                    {localize('Pick a market in the scanner to see its chart and analysis.')}
                </p>
            </section>
        );
    }
    const { signal } = row;
    const readings = signal?.primary.readings;
    const macd = readings?.macd ?? null;
    const confirm_readings = signal?.confirm?.readings;

    return (
        <section className='voltrex__panel voltrex-detail' aria-label={localize('Selected market')}>
            <div className='voltrex-detail__head'>
                <div>
                    <h2 className='voltrex__panel-title' data-testid='voltrex-detail-name'>
                        {row.name}
                    </h2>
                    <span className='voltrex__muted'>
                        {row.market_name} · {row.symbol}
                    </span>
                </div>
                <div className='voltrex-detail__price'>
                    <strong data-testid='voltrex-detail-price'>
                        {row.price === null ? '–' : row.price.toFixed(row.pip_size)}
                    </strong>
                    <span
                        className={classNames(
                            row.change_pct !== null && row.change_pct < 0 ? 'voltrex__tone--sell' : 'voltrex__tone--buy'
                        )}
                    >
                        {row.change_pct === null
                            ? ''
                            : `${row.change_pct > 0 ? '+' : ''}${row.change_pct.toFixed(2)}% ${localize('24h')}`}
                    </span>
                </div>
            </div>

            <VoltrexChart
                candles={primary}
                support={readings?.support ?? null}
                resistance={readings?.resistance ?? null}
            />
            <div className='voltrex-detail__legend'>
                <span className='voltrex-detail__key voltrex-detail__key--fast'>{localize('EMA 20')}</span>
                <span className='voltrex-detail__key voltrex-detail__key--slow'>{localize('EMA 50')}</span>
                <span className='voltrex-detail__key voltrex-detail__key--band'>{localize('Bollinger')}</span>
                <span className='voltrex__muted'>{primary_label}</span>
            </div>

            {onTrade && (
                <button
                    type='button'
                    className='voltrex__button voltrex__button--primary voltrex__phone-only'
                    onClick={onTrade}
                    data-testid='voltrex-go-trade'
                >
                    {localize('Trade this market')}
                </button>
            )}

            {!signal ? (
                <p className='voltrex__muted' data-testid='voltrex-detail-pending'>
                    {pendingText(row.status)}
                </p>
            ) : (
                <>
                    <div className='voltrex-detail__signal'>
                        <span
                            className={classNames('voltrex__badge', directionClass(signal.direction))}
                            data-testid='voltrex-detail-signal'
                        >
                            {signal.direction}
                        </span>
                        <span className='voltrex__muted'>
                            {ALIGNMENT_TEXT()[signal.alignment]} ({primary_label} + {confirm_label})
                        </span>
                    </div>
                    <div className='voltrex-detail__meters'>
                        <Meter label={localize('Strength')} value={signal.strength} testid='voltrex-detail-strength' />
                        <Meter
                            label={localize('Agreement')}
                            value={signal.agreement}
                            testid='voltrex-detail-agreement'
                        />
                    </div>
                    <p className='voltrex__note'>
                        {localize(
                            'Strength and agreement show how far and how widely the indicators line up. They are not the chance that a trade will win.'
                        )}
                    </p>

                    <h3 className='voltrex__subtitle'>{localize('Indicators')}</h3>
                    <dl className='voltrex-detail__readings'>
                        <dt>{localize('RSI (14)')}</dt>
                        <dd>{digits(readings?.rsi ?? null, 1)}</dd>
                        <dt>{localize('MACD histogram')}</dt>
                        <dd>{macd ? macd.histogram.toPrecision(3) : '–'}</dd>
                        <dt>{localize('EMA 20 / 50')}</dt>
                        <dd>
                            {readings
                                ? `${readings.ema_fast.toPrecision(6)} / ${readings.ema_slow.toPrecision(6)}`
                                : '–'}
                        </dd>
                        <dt>{localize('Bollinger %B')}</dt>
                        <dd>
                            {readings?.bollinger?.percent_b != null ? readings.bollinger.percent_b.toFixed(2) : '–'}
                        </dd>
                        <dt>{localize('Bollinger width')}</dt>
                        <dd>{readings?.bollinger ? `${readings.bollinger.width_pct.toFixed(2)}%` : '–'}</dd>
                        <dt>{localize('ATR (14)')}</dt>
                        <dd>{readings?.atr_pct != null ? `${readings.atr_pct.toFixed(3)}%` : '–'}</dd>
                        <dt>{localize('Momentum (10)')}</dt>
                        <dd>{readings?.roc != null ? `${readings.roc.toFixed(2)}%` : '–'}</dd>
                        <dt>{localize('Support')}</dt>
                        <dd>{readings?.support != null ? readings.support.toPrecision(6) : '–'}</dd>
                        <dt>{localize('Resistance')}</dt>
                        <dd>{readings?.resistance != null ? readings.resistance.toPrecision(6) : '–'}</dd>
                        <dt>{localize('{{frame}} trend', { frame: confirm_label })}</dt>
                        <dd>{confirm_readings ? signal.confirm?.trend : '–'}</dd>
                    </dl>

                    <h3 className='voltrex__subtitle'>{localize('Why this signal')}</h3>
                    <ul className='voltrex-detail__reasons' data-testid='voltrex-detail-reasons'>
                        {signal.reasons.map(reason => (
                            <li key={reason}>{reason}</li>
                        ))}
                    </ul>
                    {confirm.length > 0 && (
                        <p className='voltrex__muted'>
                            {localize('{{count}} candles on {{frame}} used to confirm.', {
                                count: confirm.length,
                                frame: confirm_label,
                            })}
                        </p>
                    )}
                </>
            )}
        </section>
    );
};

export default VoltrexDetail;
