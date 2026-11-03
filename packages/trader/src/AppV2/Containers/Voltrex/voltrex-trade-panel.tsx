import React from 'react';
import classNames from 'classnames';

import { WS } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

import { createWsBotApi } from '../BotBuilder/Engine/ws-adapter';

import type { TScanRow } from './use-voltrex-scanner';
import type { useVoltrexTrader } from './use-voltrex-trader';
import type { TStrategyId } from './voltrex-analysis';
import { CATEGORIES, TCategoryId } from './voltrex-config';
import { defaultDuration, TDurationUnit, TRiseFallSpec, validateDuration } from './voltrex-contracts';
import type { TDigitStats } from './voltrex-digits';
import { DEFAULT_ENTRY_SETTINGS } from './voltrex-entries';
import VoltrexProductTrade from './voltrex-product-trade';
import { PRODUCT_IDS, productLabel, TProductId } from './voltrex-products';
import { checkOrder, LIMITS, TRiskSettings, validateRisk } from './voltrex-risk';
import { EMPTY_SPECS } from './voltrex-specs';

type TTrader = ReturnType<typeof useVoltrexTrader>;

type TProps = {
    rows: TScanRow[];
    selected: string | null;
    onSelect: (symbol: string) => void;
    trader: TTrader;
    is_logged_in: boolean;
    /** Digit statistics for a market, when they are being followed. */
    getStats?: (symbol: string) => TDigitStats | null;
};

const money = (value: number, currency: string) => `${value.toFixed(2)} ${currency}`;

const STRATEGIES: { id: TStrategyId; label: () => string; text: () => string }[] = [
    {
        id: 'confluence',
        label: () => localize('Signal confluence'),
        text: () =>
            localize(
                'Takes a BUY or SELL signal whenever the higher timeframe does not contradict it, on the side the signal points.'
            ),
    },
    {
        id: 'trend',
        label: () => localize('Trend following'),
        text: () =>
            localize(
                'Only takes a signal that both timeframes confirm, when the trend and the MACD histogram point the same way.'
            ),
    },
    {
        id: 'reversion',
        label: () => localize('Mean reversion'),
        text: () =>
            localize(
                'Bets against an extreme: RSI above 70 or below 30 with the price at the edge of the Bollinger Bands.'
            ),
    },
];

// ---------- emergency stop ----------

const EmergencyBar = ({ trader }: { trader: TTrader }) => {
    const is_on = trader.snapshot.risk.emergency_stop;
    return (
        <div className={classNames('voltrex-emergency', is_on && 'voltrex-emergency--on')}>
            {is_on ? (
                <>
                    <span data-testid='voltrex-emergency-state'>
                        {localize('Emergency stop is ON. New orders are blocked.')}
                    </span>
                    <button type='button' className='voltrex__button' onClick={() => trader.control('reset')}>
                        {localize('Reset')}
                    </button>
                </>
            ) : (
                <button
                    type='button'
                    className='voltrex__button voltrex__button--danger voltrex-emergency__button'
                    onClick={() => trader.control('emergency')}
                >
                    {localize('EMERGENCY STOP')}
                </button>
            )}
        </div>
    );
};

// ---------- manual trade ----------

type TQuote = { status: 'idle' | 'loading' | 'ready' | 'error'; ask_price?: number; payout?: number; message?: string };

const useQuote = (
    symbol: string | null,
    side: 'CALL' | 'PUT',
    stake: number,
    unit: TDurationUnit,
    duration: number,
    currency: string,
    enabled: boolean
): TQuote => {
    const [quote, setQuote] = React.useState<TQuote>({ status: 'idle' });
    React.useEffect(() => {
        if (!enabled || !symbol || !(stake > 0) || !Number.isInteger(duration)) {
            setQuote({ status: 'idle' });
            return undefined;
        }
        setQuote({ status: 'loading' });
        let subscription: { unsubscribe: () => void } | null = null;
        let active = true;
        // a short wait, so typing a stake does not send a request for every key press
        const timer = setTimeout(() => {
            try {
                subscription = createWsBotApi(WS).subscribeProposal(
                    {
                        amount: stake,
                        basis: 'stake',
                        contract_type: side,
                        currency,
                        underlying_symbol: symbol,
                        duration,
                        duration_unit: unit,
                    },
                    response => {
                        if (!active) return;
                        if (response?.error || !response?.proposal) {
                            setQuote({
                                status: 'error',
                                message: response?.error?.message ?? localize('No price was returned.'),
                            });
                            return;
                        }
                        setQuote({
                            status: 'ready',
                            ask_price: Number(response.proposal.ask_price),
                            payout: Number(response.proposal.payout),
                        });
                    }
                );
            } catch {
                if (active) setQuote({ status: 'error', message: localize('The price could not be requested.') });
            }
        }, 500);
        return () => {
            active = false;
            clearTimeout(timer);
            try {
                subscription?.unsubscribe();
            } catch {
                // already closed
            }
        };
    }, [symbol, side, stake, unit, duration, currency, enabled]);
    return quote;
};

const ManualTrade = ({ rows, selected, onSelect, trader, is_logged_in, getStats }: TProps) => {
    const { snapshot, risk, currency, is_virtual, getSpec } = trader;
    const [product, setProduct] = React.useState<TProductId>('rise_fall');
    const [stake_text, setStakeText] = React.useState('1');
    const [unit, setUnit] = React.useState<TDurationUnit>('t');
    const [duration_text, setDurationText] = React.useState('5');
    const [spec, setSpec] = React.useState<TRiseFallSpec | null | undefined>(undefined);
    const [confirming, setConfirming] = React.useState<'CALL' | 'PUT' | null>(null);
    const [message, setMessage] = React.useState('');
    const [busy, setBusy] = React.useState(false);

    const row = rows.find(item => item.symbol === selected) ?? null;
    const stake = Number(stake_text);
    const duration = Number(duration_text);

    // what the selected market allows, from the server
    React.useEffect(() => {
        setConfirming(null);
        setMessage('');
        if (!selected) {
            setSpec(undefined);
            return undefined;
        }
        let active = true;
        setSpec(undefined);
        getSpec(selected).then(next => {
            if (!active) return;
            setSpec(next);
            if (next) {
                const fallback = defaultDuration(next);
                setUnit(fallback.unit);
                setDurationText(String(fallback.value));
            }
        });
        return () => {
            active = false;
        };
    }, [selected, getSpec]);

    const duration_problem = spec ? validateDuration(spec, unit, duration) : null;
    const risk_problem = checkOrder(risk, snapshot.risk, { stake, source: 'manual' });
    const can_quote = !!spec && !duration_problem && stake > 0 && stake <= risk.max_stake && !!row?.is_open;
    const rise = useQuote(selected, 'CALL', stake, unit, duration, currency, can_quote);
    const fall = useQuote(selected, 'PUT', stake, unit, duration, currency, can_quote);

    const last_manual = snapshot.trades.find(trade => trade.source === 'manual');
    const ready = is_logged_in && !!row && !!spec && !duration_problem && !risk_problem && row.is_open;

    const confirm = async () => {
        if (!row || !spec || !confirming) return;
        setBusy(true);
        const result = await trader.place(
            {
                symbol: row.symbol,
                name: row.name,
                choice: {
                    product: 'rise_fall',
                    contract_type: confirming,
                    label: confirming === 'CALL' ? localize('Rise') : localize('Fall'),
                    duration,
                    duration_unit: unit,
                },
                stake,
                source: 'manual',
                why: localize('Placed by hand from the scanner.'),
            },
            { ...EMPTY_SPECS, rise_fall: spec }
        );
        setBusy(false);
        setConfirming(null);
        setMessage(result.ok ? localize('Trade sent. Following it below.') : result.reason);
    };

    const quote_text = (quote: TQuote) => {
        if (quote.status === 'ready' && quote.payout !== undefined) {
            return localize('Payout {{payout}}', { payout: money(quote.payout, currency) });
        }
        if (quote.status === 'loading') return localize('Getting price…');
        return quote.status === 'error' ? quote.message : '';
    };

    return (
        <div className='voltrex-trade__section' data-testid='voltrex-manual'>
            <h3 className='voltrex__subtitle'>{localize('Manual trade')}</h3>
            <div className='voltrex__field'>
                <span>{localize('Contract type')}</span>
                <div className='voltrex-scanner__chips' role='group' aria-label={localize('Contract type')}>
                    {PRODUCT_IDS.map(id => (
                        <button
                            key={id}
                            type='button'
                            className={classNames('voltrex__chip', product === id && 'voltrex__chip--on')}
                            aria-pressed={product === id}
                            onClick={() => setProduct(id)}
                            data-testid={`voltrex-product-${id}`}
                        >
                            {productLabel(id)}
                        </button>
                    ))}
                </div>
            </div>
            <label className='voltrex__field'>
                <span>{localize('Market')}</span>
                <select
                    className='voltrex__input'
                    value={selected ?? ''}
                    onChange={event => onSelect(event.target.value)}
                    data-testid='voltrex-market-select'
                >
                    <option value=''>{localize('Choose a market')}</option>
                    {rows
                        .filter(item => item.is_open)
                        .map(item => (
                            <option key={item.symbol} value={item.symbol}>
                                {item.name}
                            </option>
                        ))}
                </select>
            </label>

            {product !== 'rise_fall' && (
                <VoltrexProductTrade
                    product={product}
                    row={row}
                    trader={trader}
                    is_logged_in={is_logged_in}
                    stats={selected && getStats ? getStats(selected) : null}
                />
            )}

            {product === 'rise_fall' && (
                <>
                    <p className='voltrex__muted' data-testid='voltrex-spec-state'>
                        {!selected && localize('Choose a market to see what it offers.')}
                        {selected && spec === undefined && localize('Checking what this market offers…')}
                        {selected && spec === null && localize('Rise/Fall trades are not offered on this market.')}
                        {selected && spec && localize('Contract: Rise/Fall.')}
                    </p>

                    <div className='voltrex__row'>
                        <label className='voltrex__field'>
                            <span>{localize('Stake ({{currency}})', { currency })}</span>
                            <input
                                className='voltrex__input'
                                type='number'
                                inputMode='decimal'
                                min='0'
                                step='0.01'
                                value={stake_text}
                                onChange={event => setStakeText(event.target.value)}
                                data-testid='voltrex-stake'
                            />
                        </label>
                        <label className='voltrex__field'>
                            <span>{localize('Duration')}</span>
                            <div className='voltrex__row'>
                                <input
                                    className='voltrex__input'
                                    type='number'
                                    min='1'
                                    step='1'
                                    value={duration_text}
                                    onChange={event => setDurationText(event.target.value)}
                                    data-testid='voltrex-duration'
                                />
                                <select
                                    className='voltrex__input'
                                    aria-label={localize('Duration unit')}
                                    value={unit}
                                    onChange={event => setUnit(event.target.value as TDurationUnit)}
                                >
                                    {(!spec || spec.ticks) && <option value='t'>{localize('ticks')}</option>}
                                    {(!spec || spec.minutes) && <option value='m'>{localize('minutes')}</option>}
                                </select>
                            </div>
                        </label>
                    </div>
                    {spec && (
                        <p className='voltrex__muted'>
                            {unit === 't' && spec.ticks && localize('Allowed: {{min}} to {{max}} ticks.', spec.ticks)}
                            {unit === 'm' &&
                                spec.minutes &&
                                localize('Allowed: {{min}} to {{max}} minutes.', spec.minutes)}
                        </p>
                    )}
                    {(duration_problem || (stake > 0 && risk_problem)) && (
                        <p className='voltrex__error' role='alert' data-testid='voltrex-manual-problem'>
                            {duration_problem ?? risk_problem}
                        </p>
                    )}

                    {confirming ? (
                        <div className='voltrex-confirm' role='alertdialog' aria-label={localize('Confirm trade')}>
                            <p>
                                <strong>{confirming === 'CALL' ? localize('Rise') : localize('Fall')}</strong>{' '}
                                {localize('on {{name}} for {{duration}} {{unit}}, stake {{stake}}.', {
                                    name: row?.name,
                                    duration,
                                    unit: unit === 't' ? localize('ticks') : localize('minutes'),
                                    stake: money(stake, currency),
                                })}
                            </p>
                            <p className='voltrex__muted'>
                                {localize('The most you can lose on this trade is the stake. Account: {{type}}.', {
                                    type: is_virtual ? localize('DEMO') : localize('REAL MONEY'),
                                })}
                            </p>
                            <div className='voltrex__row'>
                                <button
                                    type='button'
                                    className='voltrex__button voltrex__button--primary'
                                    disabled={busy}
                                    onClick={confirm}
                                    data-testid='voltrex-confirm'
                                >
                                    {localize('Confirm and place trade')}
                                </button>
                                <button
                                    type='button'
                                    className='voltrex__button'
                                    disabled={busy}
                                    onClick={() => setConfirming(null)}
                                >
                                    {localize('Cancel')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className='voltrex__row voltrex-trade__sides'>
                            <button
                                type='button'
                                className='voltrex__button voltrex__button--buy'
                                disabled={!ready}
                                onClick={() => setConfirming('CALL')}
                                data-testid='voltrex-rise'
                            >
                                {localize('Rise ▲ (BUY)')}
                                <small>{quote_text(rise)}</small>
                            </button>
                            <button
                                type='button'
                                className='voltrex__button voltrex__button--sell'
                                disabled={!ready}
                                onClick={() => setConfirming('PUT')}
                                data-testid='voltrex-fall'
                            >
                                {localize('Fall ▼ (SELL)')}
                                <small>{quote_text(fall)}</small>
                            </button>
                        </div>
                    )}
                    {!is_logged_in && <p className='voltrex__muted'>{localize('Log in to place trades.')}</p>}
                    {message && (
                        <p className='voltrex__muted' role='status' data-testid='voltrex-manual-message'>
                            {message}
                        </p>
                    )}
                </>
            )}
            {last_manual && (
                <p className='voltrex__muted' data-testid='voltrex-manual-status'>
                    {localize('Latest manual trade: {{name}}, {{status}}', {
                        name: last_manual.name,
                        status: last_manual.status,
                    })}
                </p>
            )}
        </div>
    );
};

// ---------- auto trading ----------

const AutoTrade = ({ rows, trader }: TProps) => {
    const { snapshot, risk, is_virtual, updateAuto } = trader;
    const [strategy, setStrategy] = React.useState<TStrategyId>('confluence');
    const [stake_text, setStakeText] = React.useState('1');
    const [categories, setCategories] = React.useState<TCategoryId[]>(['volatility']);
    const [products, setProducts] = React.useState<TProductId[]>(['rise_fall']);
    const [take_profit_pct, setTakeProfitPct] = React.useState(String(DEFAULT_ENTRY_SETTINGS.take_profit_pct));
    const [stop_loss_pct, setStopLossPct] = React.useState(String(DEFAULT_ENTRY_SETTINGS.stop_loss_pct));
    const [max_hold, setMaxHold] = React.useState(String(DEFAULT_ENTRY_SETTINGS.max_hold_minutes));
    const [problem, setProblem] = React.useState('');

    const available = CATEGORIES.filter(category => rows.some(row => row.category === category.id));
    const stake = Number(stake_text);
    const entry = {
        ...DEFAULT_ENTRY_SETTINGS,
        take_profit_pct: Number(take_profit_pct) > 0 ? Number(take_profit_pct) : DEFAULT_ENTRY_SETTINGS.take_profit_pct,
        stop_loss_pct:
            Number(stop_loss_pct) > 0 ? Math.min(100, Number(stop_loss_pct)) : DEFAULT_ENTRY_SETTINGS.stop_loss_pct,
        max_hold_minutes: Number(max_hold) >= 0 ? Number(max_hold) : DEFAULT_ENTRY_SETTINGS.max_hold_minutes,
    };
    const config = { strategy, stake, categories, products, entry };
    const state = snapshot.auto;

    React.useEffect(() => {
        updateAuto({ strategy, stake, categories, products, entry });
        // `entry` is rebuilt from the three text fields on every render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [strategy, stake, categories, products, take_profit_pct, stop_loss_pct, max_hold, updateAuto]);

    const toggleProduct = (id: TProductId) =>
        setProducts(current => {
            const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
            return next.length ? next : current;
        });

    const toggle = (id: TCategoryId) =>
        setCategories(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));

    const start = async () => {
        const result = await trader.startAuto(config);
        setProblem(result ?? '');
    };

    return (
        <div className='voltrex-trade__section' data-testid='voltrex-auto'>
            <h3 className='voltrex__subtitle'>
                {localize('Auto trading')}{' '}
                <span
                    className={classNames('voltrex__badge', `voltrex__badge--${state}`)}
                    data-testid='voltrex-auto-state'
                >
                    {state === 'off' && localize('OFF')}
                    {state === 'running' && localize('RUNNING')}
                    {state === 'paused' && localize('PAUSED')}
                </span>
            </h3>
            {!is_virtual && (
                <p className='voltrex__alert' data-testid='voltrex-auto-demo-only'>
                    {localize(
                        'Auto-trading works on demo accounts only. Switch to a demo account to use it. Manual trading is not affected.'
                    )}
                </p>
            )}
            <label className='voltrex__field'>
                <span>{localize('Strategy')}</span>
                <select
                    className='voltrex__input'
                    value={strategy}
                    onChange={event => setStrategy(event.target.value as TStrategyId)}
                    data-testid='voltrex-strategy'
                >
                    {STRATEGIES.map(item => (
                        <option key={item.id} value={item.id}>
                            {item.label()}
                        </option>
                    ))}
                </select>
            </label>
            <p className='voltrex__muted'>{STRATEGIES.find(item => item.id === strategy)?.text()}</p>

            <div className='voltrex__field'>
                <span>{localize('Contract types to trade')}</span>
                <div className='voltrex-scanner__chips' role='group' aria-label={localize('Contract types to trade')}>
                    {PRODUCT_IDS.map(id => (
                        <button
                            key={id}
                            type='button'
                            className={classNames('voltrex__chip', products.includes(id) && 'voltrex__chip--on')}
                            aria-pressed={products.includes(id)}
                            onClick={() => toggleProduct(id)}
                            data-testid={`voltrex-auto-product-${id}`}
                        >
                            {productLabel(id)}
                        </button>
                    ))}
                </div>
            </div>
            {(products.includes('accumulator') || products.includes('multiplier')) && (
                <div className='voltrex__row'>
                    <label className='voltrex__field'>
                        <span>{localize('Take profit (% of stake)')}</span>
                        <input
                            className='voltrex__input'
                            type='number'
                            min='1'
                            step='1'
                            value={take_profit_pct}
                            onChange={event => setTakeProfitPct(event.target.value)}
                            data-testid='voltrex-auto-take-profit'
                        />
                    </label>
                    {products.includes('multiplier') && (
                        <label className='voltrex__field'>
                            <span>{localize('Stop loss (% of stake)')}</span>
                            <input
                                className='voltrex__input'
                                type='number'
                                min='1'
                                max='100'
                                step='1'
                                value={stop_loss_pct}
                                onChange={event => setStopLossPct(event.target.value)}
                                data-testid='voltrex-auto-stop-loss'
                            />
                        </label>
                    )}
                    <label className='voltrex__field'>
                        <span>{localize('Longest hold (minutes, 0 = none)')}</span>
                        <input
                            className='voltrex__input'
                            type='number'
                            min='0'
                            step='1'
                            value={max_hold}
                            onChange={event => setMaxHold(event.target.value)}
                            data-testid='voltrex-auto-max-hold'
                        />
                    </label>
                </div>
            )}

            <div className='voltrex__field'>
                <span>{localize('Markets to trade')}</span>
                <div className='voltrex-scanner__chips' role='group' aria-label={localize('Markets to trade')}>
                    {available.map(category => (
                        <button
                            key={category.id}
                            type='button'
                            className={classNames(
                                'voltrex__chip',
                                categories.includes(category.id) && 'voltrex__chip--on'
                            )}
                            aria-pressed={categories.includes(category.id)}
                            onClick={() => toggle(category.id)}
                        >
                            {category.label}
                        </button>
                    ))}
                </div>
            </div>

            <label className='voltrex__field'>
                <span>{localize('Stake per trade ({{currency}})', { currency: trader.currency })}</span>
                <input
                    className='voltrex__input'
                    type='number'
                    min='0'
                    step='0.01'
                    value={stake_text}
                    onChange={event => setStakeText(event.target.value)}
                    data-testid='voltrex-auto-stake'
                />
            </label>
            <p className='voltrex__muted'>
                {localize(
                    'Limits from your risk settings apply to every automatic trade: max {{open}} open, stop after {{losses}} losses in a row, daily loss {{loss}}, signal strength at least {{strength}}.',
                    {
                        open: risk.max_open_trades,
                        losses: risk.max_consecutive_losses,
                        loss: money(risk.max_daily_loss, trader.currency),
                        strength: risk.min_strength,
                    }
                )}
            </p>

            <div className='voltrex__row'>
                {state === 'off' && (
                    <button
                        type='button'
                        className='voltrex__button voltrex__button--primary'
                        disabled={!is_virtual || snapshot.risk.emergency_stop}
                        onClick={start}
                        data-testid='voltrex-auto-start'
                    >
                        {localize('Start')}
                    </button>
                )}
                {state === 'running' && (
                    <button type='button' className='voltrex__button' onClick={() => trader.control('pause')}>
                        {localize('Pause')}
                    </button>
                )}
                {state === 'paused' && (
                    <button type='button' className='voltrex__button' onClick={() => trader.control('resume')}>
                        {localize('Resume')}
                    </button>
                )}
                {state !== 'off' && (
                    <button
                        type='button'
                        className='voltrex__button'
                        onClick={() => trader.control('stop')}
                        data-testid='voltrex-auto-stop'
                    >
                        {localize('Stop')}
                    </button>
                )}
            </div>
            {problem && (
                <p className='voltrex__error' role='alert' data-testid='voltrex-auto-problem'>
                    {problem}
                </p>
            )}
            <p className='voltrex__muted'>
                {localize(
                    'Auto-trading only runs while this page is open, and looks at the scanner every few seconds. Closing the page stops it; contracts already open keep running.'
                )}
            </p>

            <h4 className='voltrex__subtitle'>{localize('Execution log')}</h4>
            <ul className='voltrex-log' data-testid='voltrex-log' aria-live='polite'>
                {snapshot.log.length === 0 && <li className='voltrex__muted'>{localize('Nothing yet.')}</li>}
                {[...snapshot.log]
                    .reverse()
                    .slice(0, 14)
                    .map(entry => (
                        <li
                            key={`${entry.time}-${entry.message}`}
                            className={`voltrex-log__item voltrex-log__item--${entry.level}`}
                        >
                            <time>{new Date(entry.time).toLocaleTimeString()}</time> {entry.message}
                        </li>
                    ))}
            </ul>
        </div>
    );
};

// ---------- risk settings ----------

const FIELDS: { key: keyof TRiskSettings; label: () => string; step: string }[] = [
    { key: 'max_stake', label: () => localize('Maximum stake'), step: '0.01' },
    { key: 'max_daily_loss', label: () => localize('Maximum daily loss'), step: '0.01' },
    { key: 'max_open_trades', label: () => localize('Maximum open trades'), step: '1' },
    { key: 'max_consecutive_losses', label: () => localize('Maximum losses in a row'), step: '1' },
    { key: 'daily_profit_target', label: () => localize('Daily profit target (0 = none)'), step: '0.01' },
    { key: 'min_strength', label: () => localize('Minimum signal strength'), step: '1' },
];

const RiskSettings = ({ trader }: { trader: TTrader }) => {
    const { risk, updateRisk, snapshot, currency } = trader;
    const [draft, setDraft] = React.useState<Record<string, string>>(() =>
        Object.fromEntries(FIELDS.map(field => [field.key, String(risk[field.key])]))
    );
    const next = Object.fromEntries(FIELDS.map(field => [field.key, Number(draft[field.key])])) as TRiskSettings;
    const problem = validateRisk(next);

    const change = (key: keyof TRiskSettings, value: string) => {
        const updated = { ...draft, [key]: value };
        setDraft(updated);
        const candidate = Object.fromEntries(
            FIELDS.map(field => [field.key, Number(updated[field.key])])
        ) as TRiskSettings;
        if (!validateRisk(candidate)) updateRisk(candidate);
    };

    return (
        <div className='voltrex-trade__section' data-testid='voltrex-risk'>
            <h3 className='voltrex__subtitle'>{localize('Risk controls')}</h3>
            <div className='voltrex-risk__grid'>
                {FIELDS.map(field => (
                    <label key={field.key} className='voltrex__field'>
                        <span>{field.label()}</span>
                        <input
                            className='voltrex__input'
                            type='number'
                            min='0'
                            step={field.step}
                            value={draft[field.key]}
                            onChange={event => change(field.key, event.target.value)}
                            data-testid={`voltrex-risk-${field.key}`}
                        />
                    </label>
                ))}
            </div>
            {problem ? (
                <p className='voltrex__error' role='alert' data-testid='voltrex-risk-problem'>
                    {problem} {localize('The last valid settings stay in force.')}
                </p>
            ) : (
                <p className='voltrex__muted'>
                    {localize(
                        'Today: {{profit}} realised, {{losses}} losses in a row, {{open}} of {{max}} trades open. Open trades up to {{limit}} open trades.',
                        {
                            profit: money(snapshot.risk.realised_profit, currency),
                            losses: snapshot.risk.consecutive_losses,
                            open: snapshot.risk.open_stakes.length,
                            max: risk.max_open_trades,
                            limit: LIMITS.max_open_trades,
                        }
                    )}
                </p>
            )}
        </div>
    );
};

const VoltrexTradePanel = (props: TProps) => (
    <section className='voltrex__panel voltrex-trade' aria-label={localize('Trading panel')}>
        <h2 className='voltrex__panel-title'>{localize('Trading panel')}</h2>
        <EmergencyBar trader={props.trader} />
        <ManualTrade {...props} />
        <AutoTrade {...props} />
        <RiskSettings trader={props.trader} />
    </section>
);

export default VoltrexTradePanel;
