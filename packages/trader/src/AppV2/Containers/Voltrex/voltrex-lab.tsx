import classNames from 'classnames';

import { localize } from '@deriv-com/translations';

import type { TScanRow } from './use-voltrex-scanner';
import { bestDigitIdea, MIN_DIGITS, TDigitStats } from './voltrex-digits';
import { accumulatorStrength } from './voltrex-entries';
import { DIGIT_PRODUCTS, productLabel } from './voltrex-products';
import { sigmaFromAtr, touchProbability } from './voltrex-touch';

type TProps = { row: TScanRow | null; stats: TDigitStats | null; min_strength: number };

const Bar = ({ strength, min }: { strength: number; min: number }) => (
    <span className='voltrex-lab__bar' aria-hidden='true'>
        <span
            className={classNames('voltrex-lab__bar-fill', strength >= min && 'voltrex-lab__bar-fill--on')}
            style={{ width: `${Math.min(100, strength)}%` }}
        />
    </span>
);

/**
 * What each contract type sees in the selected market. Digit contracts use the last digits of the price (statistics,
 * not a forecast: the digits of Deriv's synthetic indices are random); Accumulators want a calm, ranging market; the
 * rest follow the scanner's signal. Every strength is on the same 0 to 100 scale as the signal, and a bar turns on when
 * it reaches the minimum strength set for auto-trading.
 */
const VoltrexLab = ({ row, stats, min_strength }: TProps) => {
    const directionText = { NEUTRAL: localize('no direction'), BUY: localize('up'), SELL: localize('down') };
    if (!row?.signal) {
        return (
            <section className='voltrex__panel voltrex-lab' aria-label={localize('Contract analysis')}>
                <h2 className='voltrex__panel-title'>{localize('Contract analysis')}</h2>
                <p className='voltrex__muted'>{localize('Pick a market with a signal to see each contract type.')}</p>
            </section>
        );
    }
    const readings = row.signal.primary.readings;
    const calm = accumulatorStrength(row);
    const touch_chance =
        readings.atr_pct && row.price
            ? touchProbability(readings.atr_pct * 1.2, 5, sigmaFromAtr(readings.atr_pct))
            : null;
    const digits_ready = !!stats && stats.count >= MIN_DIGITS;
    return (
        <section
            className='voltrex__panel voltrex-lab'
            aria-label={localize('Contract analysis')}
            data-testid='voltrex-lab'
        >
            <h2 className='voltrex__panel-title'>{localize('Contract analysis')}</h2>

            <h3 className='voltrex__subtitle'>{localize('Digits (last digit of the price)')}</h3>
            {!digits_ready && (
                <p className='voltrex__muted' data-testid='voltrex-lab-digits-pending'>
                    {stats
                        ? localize('{{count}} of {{need}} digits collected…', { count: stats.count, need: MIN_DIGITS })
                        : localize('Digits are collected for synthetic markets only, from the market you pick.')}
                </p>
            )}
            {digits_ready && stats && (
                <>
                    <div className='voltrex-lab__digits' data-testid='voltrex-lab-digits'>
                        {stats.counts.map((count, digit) => (
                            <div
                                key={digit}
                                className={classNames(
                                    'voltrex-lab__digit',
                                    digit === stats.hottest && 'voltrex-lab__digit--hot',
                                    digit === stats.coldest && 'voltrex-lab__digit--cold'
                                )}
                            >
                                <span
                                    className='voltrex-lab__digit-bar'
                                    style={{ height: `${Math.min(100, count * 5)}%` }}
                                />
                                <strong>{digit}</strong>
                                <small>{Math.round(stats.shares[digit] * 100)}%</small>
                            </div>
                        ))}
                    </div>
                    <p className='voltrex__muted'>
                        {localize(
                            'Last {{count}} digits. Latest {{last}}; {{streak}} {{kind}} in a row. Chance gives 10% for each digit.',
                            {
                                count: stats.count,
                                last: stats.last,
                                streak: stats.parity_streak.length,
                                kind: stats.parity_streak.kind === 'even' ? localize('even') : localize('odd'),
                            }
                        )}
                    </p>
                    <ul className='voltrex-lab__list'>
                        {DIGIT_PRODUCTS.map(product => {
                            const idea = bestDigitIdea(product, stats);
                            return (
                                <li key={product} data-testid={`voltrex-lab-${product}`}>
                                    <span>
                                        <strong>{productLabel(product)}</strong>{' '}
                                        {idea ? idea.choice.label : localize('nothing beyond chance')}
                                    </span>
                                    <Bar strength={idea?.strength ?? 0} min={min_strength} />
                                    <em>{idea?.strength ?? 0}</em>
                                </li>
                            );
                        })}
                    </ul>
                    <p className='voltrex__note'>
                        {localize(
                            'These figures compare recent digits with chance. They do not predict the next digit, and a gap this size appears by chance often.'
                        )}
                    </p>
                </>
            )}

            <h3 className='voltrex__subtitle'>{localize('Other contracts')}</h3>
            <ul className='voltrex-lab__list'>
                <li data-testid='voltrex-lab-accumulator'>
                    <span>
                        <strong>{productLabel('accumulator')}</strong>{' '}
                        {localize('calm score ({{level}} volatility)', {
                            level: row.volatility_level ?? localize('unknown'),
                        })}
                    </span>
                    <Bar strength={calm} min={min_strength} />
                    <em>{calm}</em>
                </li>
                <li data-testid='voltrex-lab-multiplier'>
                    <span>
                        <strong>{productLabel('multiplier')}</strong> {directionText[row.signal.direction]}
                    </span>
                    <Bar strength={row.signal.strength} min={min_strength} />
                    <em>{row.signal.strength}</em>
                </li>
                <li data-testid='voltrex-lab-touch'>
                    <span>
                        <strong>{productLabel('touch')}</strong>{' '}
                        {touch_chance === null
                            ? localize('needs volatility data')
                            : localize(
                                  'model: about {{percent}}% to touch a level 1.2 candle ranges away in 5 minutes',
                                  {
                                      percent: Math.round(touch_chance * 100),
                                  }
                              )}
                    </span>
                </li>
            </ul>
            <p className='voltrex__muted'>
                {localize(
                    'Touch / No Touch is compared with the server price on the Trade tab (Analyse this barrier).'
                )}
            </p>
        </section>
    );
};

export default VoltrexLab;
