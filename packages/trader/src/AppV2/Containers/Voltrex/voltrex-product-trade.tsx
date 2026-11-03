import React from 'react';
import classNames from 'classnames';

import { WS } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

import { createWsBotApi } from '../BotBuilder/Engine/ws-adapter';

import type { TScanRow } from './use-voltrex-scanner';
import type { useVoltrexTrader } from './use-voltrex-trader';
import { bestDigitIdea, TDigitStats } from './voltrex-digits';
import {
    buildProposal,
    digitLabel,
    isDigitProduct,
    productNote,
    TContractChoice,
    TProductId,
} from './voltrex-products';
import { checkOrder } from './voltrex-risk';
import { EMPTY_SPECS, offers, TMarketSpecs } from './voltrex-specs';
import { validateChoice } from './voltrex-trader';

type TTrader = ReturnType<typeof useVoltrexTrader>;

type TProps = {
    product: Exclude<TProductId, 'rise_fall'>;
    row: TScanRow | null;
    trader: TTrader;
    is_logged_in: boolean;
    stats: TDigitStats | null;
};

const money = (value: number, currency: string) => `${value.toFixed(2)} ${currency}`;

type TQuote = { status: 'idle' | 'loading' | 'ready' | 'error'; ask_price?: number; payout?: number; message?: string };

/** The server's price for the contract as filled in, refreshed when any part of it changes. */
const useProposal = (request: Record<string, unknown> | null): TQuote => {
    const [quote, setQuote] = React.useState<TQuote>({ status: 'idle' });
    const key = request ? JSON.stringify(request) : '';
    React.useEffect(() => {
        if (!key) {
            setQuote({ status: 'idle' });
            return undefined;
        }
        setQuote({ status: 'loading' });
        let active = true;
        let subscription: { unsubscribe: () => void } | null = null;
        const timer = setTimeout(() => {
            try {
                subscription = createWsBotApi(WS).subscribeProposal(JSON.parse(key), response => {
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
                });
            } catch {
                if (active) setQuote({ status: 'error', message: localize('The price could not be requested.') });
            }
        }, 600);
        return () => {
            active = false;
            clearTimeout(timer);
            try {
                subscription?.unsubscribe();
            } catch {
                // already closed
            }
        };
    }, [key]);
    return quote;
};

const OPTIONS: Record<string, { value: string; label: () => string; needs_digit: boolean }[]> = {
    over_under: [
        { value: 'DIGITOVER', label: () => localize('Over'), needs_digit: true },
        { value: 'DIGITUNDER', label: () => localize('Under'), needs_digit: true },
    ],
    match_differ: [
        { value: 'DIGITMATCH', label: () => localize('Matches'), needs_digit: true },
        { value: 'DIGITDIFF', label: () => localize('Differs'), needs_digit: true },
    ],
    even_odd: [
        { value: 'DIGITEVEN', label: () => localize('Even'), needs_digit: false },
        { value: 'DIGITODD', label: () => localize('Odd'), needs_digit: false },
    ],
    touch: [
        { value: 'ONETOUCH', label: () => localize('Touch'), needs_digit: false },
        { value: 'NOTOUCH', label: () => localize('No Touch'), needs_digit: false },
    ],
    multiplier: [
        { value: 'MULTUP', label: () => localize('Up'), needs_digit: false },
        { value: 'MULTDOWN', label: () => localize('Down'), needs_digit: false },
    ],
};

const VoltrexProductTrade = ({ product, row, trader, is_logged_in, stats }: TProps) => {
    const { snapshot, risk, currency, is_virtual, getSpecs } = trader;
    const symbol = row?.symbol ?? null;
    const [specs, setSpecs] = React.useState<TMarketSpecs | undefined>(undefined);
    const [stake_text, setStakeText] = React.useState('1');
    const [type, setType] = React.useState('');
    const [digit, setDigit] = React.useState('5');
    const [ticks_text, setTicksText] = React.useState('1');
    const [minutes_text, setMinutesText] = React.useState('5');
    const [barrier, setBarrier] = React.useState('');
    const [growth, setGrowth] = React.useState('');
    const [multiplier, setMultiplier] = React.useState('');
    const [take_profit_text, setTakeProfitText] = React.useState('0.5');
    const [stop_loss_text, setStopLossText] = React.useState('0.5');
    const [analysis, setAnalysis] = React.useState('');
    const [confirming, setConfirming] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [busy, setBusy] = React.useState(false);

    const options = OPTIONS[product] ?? [];
    const stake = Number(stake_text);

    // what the selected market sells, from the server
    React.useEffect(() => {
        setConfirming(false);
        setMessage('');
        setAnalysis('');
        setSpecs(undefined);
        if (!symbol) return undefined;
        let active = true;
        getSpecs(symbol).then(next => {
            if (!active) return;
            setSpecs(next);
            if (next.accumulator?.growth_rates.length) setGrowth(String(next.accumulator.growth_rates[0]));
            if (next.multiplier?.multipliers.length) {
                const list = next.multiplier.multipliers;
                setMultiplier(String(list.find(item => item >= 10) ?? list[0]));
            }
        });
        return () => {
            active = false;
        };
    }, [symbol, getSpecs]);

    React.useEffect(() => {
        setType(OPTIONS[product]?.[0]?.value ?? '');
        setConfirming(false);
        setMessage('');
        setAnalysis('');
    }, [product]);

    const current = options.find(item => item.value === type);
    const choice: TContractChoice | null = React.useMemo(() => {
        if (!current && product !== 'accumulator') return null;
        const base = { product, contract_type: type, label: '' } as TContractChoice;
        if (isDigitProduct(product)) {
            return {
                ...base,
                label: digitLabel(type, current?.needs_digit ? digit : undefined),
                barrier: current?.needs_digit ? digit : undefined,
                duration: Number(ticks_text),
                duration_unit: 't',
            };
        }
        if (product === 'touch') {
            const text = current?.label() ?? '';
            return {
                ...base,
                label: `${text} ${barrier}`.trim(),
                barrier,
                duration: Number(minutes_text),
                duration_unit: 'm',
            };
        }
        if (product === 'accumulator') {
            return {
                ...base,
                contract_type: 'ACCU',
                label: localize('Accumulator {{rate}}%', { rate: Math.round(Number(growth) * 1000) / 10 }),
                growth_rate: Number(growth),
                take_profit: Number(take_profit_text) > 0 ? Number(take_profit_text) : undefined,
            };
        }
        return {
            ...base,
            label: localize('Multiplier ×{{value}} {{way}}', {
                value: multiplier,
                way: type === 'MULTUP' ? localize('up') : localize('down'),
            }),
            multiplier: Number(multiplier),
            take_profit: Number(take_profit_text) > 0 ? Number(take_profit_text) : undefined,
            stop_loss: Number(stop_loss_text) > 0 ? Number(stop_loss_text) : undefined,
        };
    }, [
        product,
        type,
        current,
        digit,
        ticks_text,
        minutes_text,
        barrier,
        growth,
        multiplier,
        take_profit_text,
        stop_loss_text,
    ]);

    const offered = offers(specs ?? null, product, type === 'ACCU' ? undefined : type);
    const problem = choice && specs && offered ? validateChoice(specs, choice, stake) : null;
    const risk_problem = checkOrder(risk, snapshot.risk, { stake, source: 'manual' });
    const can_quote =
        !!choice && !!symbol && !!row?.is_open && offered && !problem && stake > 0 && stake <= risk.max_stake;
    const quote = useProposal(
        can_quote && choice ? buildProposal(choice, { symbol: symbol as string, stake, currency }) : null
    );
    const ready = is_logged_in && can_quote && !risk_problem;

    const suggestion = isDigitProduct(product) && stats ? bestDigitIdea(product, stats) : null;
    const useSuggestion = () => {
        if (!suggestion) return;
        setType(suggestion.choice.contract_type);
        if (suggestion.choice.barrier !== undefined) setDigit(suggestion.choice.barrier);
    };

    const analyseTouch = async () => {
        if (!row) return;
        setAnalysis(localize('Getting prices…'));
        const result = await trader.quoteTouch(row, Number(minutes_text), barrier || undefined);
        if ('error' in result) {
            setAnalysis(result.error || localize('The server gave no price for this barrier.'));
            return;
        }
        if (result.choice?.barrier && !barrier) setBarrier(result.choice.barrier);
        if (result.choice) setType(result.choice.contract_type);
        setAnalysis(
            `${result.choice?.label ?? ''}: ${result.why} ${localize('Strength {{strength}} of 100.', { strength: result.strength })}`
        );
    };

    const confirm = async () => {
        if (!row || !choice || !specs) return;
        setBusy(true);
        const result = await trader.place(
            {
                symbol: row.symbol,
                name: row.name,
                choice,
                stake,
                source: 'manual',
                why: localize('Placed by hand from the scanner.'),
                max_hold_minutes: undefined,
            },
            specs ?? EMPTY_SPECS
        );
        setBusy(false);
        setConfirming(false);
        setMessage(result.ok ? localize('Trade sent. Following it below.') : result.reason);
    };

    const growth_list = specs?.accumulator?.growth_rates ?? [];
    const multiplier_list = specs?.multiplier?.multipliers ?? [];
    const tick_range = specs?.digits?.ticks;

    return (
        <div data-testid='voltrex-product-trade'>
            <p className='voltrex__muted'>{productNote(product)}</p>
            <p className='voltrex__muted' data-testid='voltrex-spec-state'>
                {!row && localize('Choose a market to see what it offers.')}
                {row && specs === undefined && localize('Checking what this market offers…')}
                {row && specs && !offered && localize('This market does not sell this kind of contract.')}
            </p>

            {offered && (
                <>
                    {options.length > 0 && (
                        <div className='voltrex__field'>
                            <span>{localize('Contract')}</span>
                            <div className='voltrex-scanner__chips' role='group' aria-label={localize('Contract')}>
                                {options
                                    .filter(
                                        item =>
                                            offers(specs ?? null, product, item.value) ||
                                            product === 'touch' ||
                                            product === 'multiplier'
                                    )
                                    .map(item => (
                                        <button
                                            key={item.value}
                                            type='button'
                                            className={classNames(
                                                'voltrex__chip',
                                                type === item.value && 'voltrex__chip--on'
                                            )}
                                            aria-pressed={type === item.value}
                                            onClick={() => setType(item.value)}
                                            data-testid={`voltrex-type-${item.value}`}
                                        >
                                            {item.label()}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    )}

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
                        {current?.needs_digit && isDigitProduct(product) && (
                            <label className='voltrex__field'>
                                <span>{localize('Digit')}</span>
                                <select
                                    className='voltrex__input'
                                    value={digit}
                                    onChange={event => setDigit(event.target.value)}
                                    data-testid='voltrex-digit'
                                >
                                    {Array.from({ length: 10 }, (_, index) => index).map(item => (
                                        <option key={item} value={String(item)}>
                                            {item}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        {isDigitProduct(product) && (
                            <label className='voltrex__field'>
                                <span>{localize('Ticks')}</span>
                                <input
                                    className='voltrex__input'
                                    type='number'
                                    min={tick_range?.min ?? 1}
                                    max={tick_range?.max}
                                    step='1'
                                    value={ticks_text}
                                    onChange={event => setTicksText(event.target.value)}
                                    data-testid='voltrex-ticks'
                                />
                            </label>
                        )}
                    </div>

                    {isDigitProduct(product) && (
                        <div className='voltrex-digits__suggest'>
                            {suggestion ? (
                                <button
                                    type='button'
                                    className='voltrex__button'
                                    onClick={useSuggestion}
                                    data-testid='voltrex-use-suggestion'
                                >
                                    {localize('Use the digit statistics: {{label}} (strength {{strength}})', {
                                        label: suggestion.choice.label,
                                        strength: suggestion.strength,
                                    })}
                                </button>
                            ) : (
                                <span className='voltrex__muted'>
                                    {localize('The recent digits show nothing beyond chance, or are still loading.')}
                                </span>
                            )}
                        </div>
                    )}

                    {product === 'touch' && (
                        <>
                            <div className='voltrex__row'>
                                <label className='voltrex__field'>
                                    <span>{localize('Barrier (offset from the price, such as +0.50)')}</span>
                                    <input
                                        className='voltrex__input'
                                        type='text'
                                        inputMode='decimal'
                                        value={barrier}
                                        onChange={event => setBarrier(event.target.value)}
                                        placeholder='+0.50'
                                        data-testid='voltrex-barrier'
                                    />
                                </label>
                                <label className='voltrex__field'>
                                    <span>{localize('Minutes')}</span>
                                    <input
                                        className='voltrex__input'
                                        type='number'
                                        min={specs?.touch?.minutes?.min ?? 1}
                                        max={specs?.touch?.minutes?.max}
                                        step='1'
                                        value={minutes_text}
                                        onChange={event => setMinutesText(event.target.value)}
                                        data-testid='voltrex-minutes'
                                    />
                                </label>
                            </div>
                            <button
                                type='button'
                                className='voltrex__button'
                                onClick={analyseTouch}
                                data-testid='voltrex-touch-analyse'
                            >
                                {localize('Analyse this barrier (compares both prices with a range model)')}
                            </button>
                            {analysis && (
                                <p className='voltrex__note' role='status' data-testid='voltrex-touch-analysis'>
                                    {analysis}
                                </p>
                            )}
                        </>
                    )}

                    {product === 'accumulator' && (
                        <div className='voltrex__row'>
                            <label className='voltrex__field'>
                                <span>{localize('Growth rate')}</span>
                                <select
                                    className='voltrex__input'
                                    value={growth}
                                    onChange={event => setGrowth(event.target.value)}
                                    data-testid='voltrex-growth'
                                >
                                    {growth_list.map(item => (
                                        <option key={item} value={String(item)}>
                                            {Math.round(item * 1000) / 10}%
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className='voltrex__field'>
                                <span>{localize('Take profit ({{currency}})', { currency })}</span>
                                <input
                                    className='voltrex__input'
                                    type='number'
                                    min='0'
                                    step='0.01'
                                    value={take_profit_text}
                                    onChange={event => setTakeProfitText(event.target.value)}
                                    data-testid='voltrex-take-profit'
                                />
                            </label>
                        </div>
                    )}

                    {product === 'multiplier' && (
                        <div className='voltrex__row'>
                            <label className='voltrex__field'>
                                <span>{localize('Multiplier')}</span>
                                <select
                                    className='voltrex__input'
                                    value={multiplier}
                                    onChange={event => setMultiplier(event.target.value)}
                                    data-testid='voltrex-multiplier'
                                >
                                    {multiplier_list.map(item => (
                                        <option key={item} value={String(item)}>
                                            ×{item}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className='voltrex__field'>
                                <span>{localize('Take profit ({{currency}})', { currency })}</span>
                                <input
                                    className='voltrex__input'
                                    type='number'
                                    min='0'
                                    step='0.01'
                                    value={take_profit_text}
                                    onChange={event => setTakeProfitText(event.target.value)}
                                    data-testid='voltrex-take-profit'
                                />
                            </label>
                            <label className='voltrex__field'>
                                <span>{localize('Stop loss ({{currency}})', { currency })}</span>
                                <input
                                    className='voltrex__input'
                                    type='number'
                                    min='0'
                                    step='0.01'
                                    value={stop_loss_text}
                                    onChange={event => setStopLossText(event.target.value)}
                                    data-testid='voltrex-stop-loss'
                                />
                            </label>
                        </div>
                    )}

                    {(problem || (stake > 0 && risk_problem)) && (
                        <p className='voltrex__error' role='alert' data-testid='voltrex-manual-problem'>
                            {problem ?? risk_problem}
                        </p>
                    )}

                    <p className='voltrex__muted' data-testid='voltrex-product-quote'>
                        {quote.status === 'loading' && localize('Getting price…')}
                        {quote.status === 'ready' &&
                            quote.payout !== undefined &&
                            localize('Price {{price}}, payout {{payout}}', {
                                price: money(quote.ask_price ?? 0, currency),
                                payout: money(quote.payout, currency),
                            })}
                        {quote.status === 'error' && quote.message}
                    </p>

                    {confirming ? (
                        <div className='voltrex-confirm' role='alertdialog' aria-label={localize('Confirm trade')}>
                            <p>
                                <strong>{choice?.label}</strong>{' '}
                                {localize('on {{name}}, stake {{stake}}.', {
                                    name: row?.name,
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
                                    onClick={() => setConfirming(false)}
                                >
                                    {localize('Cancel')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            type='button'
                            className='voltrex__button voltrex__button--primary'
                            disabled={!ready}
                            onClick={() => setConfirming(true)}
                            data-testid='voltrex-product-buy'
                        >
                            {localize('Buy {{label}}', { label: choice?.label ?? '' })}
                        </button>
                    )}
                </>
            )}
            {!is_logged_in && <p className='voltrex__muted'>{localize('Log in to place trades.')}</p>}
            {message && (
                <p className='voltrex__muted' role='status' data-testid='voltrex-manual-message'>
                    {message}
                </p>
            )}
        </div>
    );
};

export default VoltrexProductTrade;
