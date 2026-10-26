import React from 'react';

import { getBrandName } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import { balanceSeries, isValidPlan, summarise } from '../StakeTools/stake-math';
import {
    DEFAULT_PLAN_FORM,
    Field,
    planFromForm,
    SectionTitle,
    SelectField,
    StakePlanFields,
    toLimit,
    toNumber,
    TPlanForm,
} from '../StakeTools/stake-tools-ui';

import { errorMessage, fetchQuote, fetchTicks, MAX_TICKS } from './bulk-api';
import BulkResults, { TOutcome } from './bulk-results';
import {
    getContractRule,
    isValidContractSetup,
    MAX_DURATION_TICKS,
    simulateBulk,
    TContractType,
    TEntryRule,
} from './bulk-utils';

const MARKETS: [string, string][] = [
    ['Volatility 10 Index', 'R_10'],
    ['Volatility 25 Index', 'R_25'],
    ['Volatility 50 Index', 'R_50'],
    ['Volatility 75 Index', 'R_75'],
    ['Volatility 100 Index', 'R_100'],
    ['Volatility 10 (1s) Index', '1HZ10V'],
    ['Volatility 25 (1s) Index', '1HZ25V'],
    ['Volatility 50 (1s) Index', '1HZ50V'],
    ['Volatility 75 (1s) Index', '1HZ75V'],
    ['Volatility 100 (1s) Index', '1HZ100V'],
];

const TICK_COUNTS = ['300', '1000', '2500', String(MAX_TICKS)];
const MAX_BULK_SIZE = 100;

const getContractOptions = (): [string, string][] => [
    [localize('Rise'), 'CALL'],
    [localize('Fall'), 'PUT'],
    [localize('Even'), 'DIGITEVEN'],
    [localize('Odd'), 'DIGITODD'],
    [localize('Over'), 'DIGITOVER'],
    [localize('Under'), 'DIGITUNDER'],
    [localize('Matches'), 'DIGITMATCH'],
    [localize('Differs'), 'DIGITDIFF'],
];

const BulkTrader = observer(() => {
    const { client } = useStore();
    const currency = client.currency || 'USD';
    const account_balance = client.is_logged_in ? Number(client.balance) : NaN;

    const [symbol, setSymbol] = React.useState('1HZ100V');
    const [contract, setContract] = React.useState<TContractType>('DIGITEVEN');
    const [barrier, setBarrier] = React.useState('5');
    const [duration, setDuration] = React.useState('1');
    const [bulk_size, setBulkSize] = React.useState('1');
    const [tick_count, setTickCount] = React.useState('1000');
    const [entry_kind, setEntryKind] = React.useState<TEntryRule['kind']>('always');
    const [entry_length, setEntryLength] = React.useState('3');
    const [balance, setBalance] = React.useState(Number.isFinite(account_balance) ? String(account_balance) : '1000');
    const [plan_form, setPlanForm] = React.useState<TPlanForm>(DEFAULT_PLAN_FORM);
    const [take_profit, setTakeProfit] = React.useState('');
    const [stop_loss, setStopLoss] = React.useState('');
    const [max_contracts, setMaxContracts] = React.useState('');
    const [use_live_payout, setUseLivePayout] = React.useState(true);
    const [payout, setPayout] = React.useState('95');

    const [is_running, setIsRunning] = React.useState(false);
    const [error, setError] = React.useState('');
    const [outcome, setOutcome] = React.useState<TOutcome | null>(null);
    const run_id = React.useRef(0);

    const rule = getContractRule(contract);
    const settings_key = JSON.stringify([
        symbol,
        contract,
        barrier,
        duration,
        bulk_size,
        tick_count,
        entry_kind,
        entry_length,
        balance,
        plan_form,
        take_profit,
        stop_loss,
        max_contracts,
        use_live_payout ? 'live' : payout,
    ]);

    const changeContract = (value: string) => {
        const next = value as TContractType;
        setContract(next);
        // each contract has its own shortest duration
        const min_ticks = getContractRule(next).min_ticks;
        if (toNumber(duration) < min_ticks) setDuration(String(min_ticks));
    };

    const validate = (): string | null => {
        const plan = planFromForm(plan_form);
        const size = toNumber(bulk_size);
        const length = toNumber(entry_length);
        if (!(toNumber(balance) > 0) || !isValidPlan(plan)) return localize('Enter a balance and a stake above zero.');
        if (!isValidContractSetup(contract, toNumber(duration), toNumber(barrier))) {
            return rule.needs_barrier
                ? localize(
                      'Check the duration (whole ticks, {{min}} to {{max}}) and the prediction ({{low}} to {{high}}).',
                      {
                          min: rule.min_ticks,
                          max: MAX_DURATION_TICKS,
                          low: rule.barrier_range[0],
                          high: rule.barrier_range[1],
                      }
                  )
                : localize('Check the duration: whole ticks, {{min}} to {{max}}.', {
                      min: rule.min_ticks,
                      max: MAX_DURATION_TICKS,
                  });
        }
        if (!Number.isInteger(size) || size < 1 || size > MAX_BULK_SIZE) {
            return localize('Contracts per purchase must be a whole number from 1 to {{max}}.', { max: MAX_BULK_SIZE });
        }
        if (entry_kind !== 'always' && (!Number.isInteger(length) || length < 1 || length > 20)) {
            return localize('The run of ticks must be a whole number from 1 to 20.');
        }
        if (!use_live_payout && !(toNumber(payout) > 0)) return localize('Enter the profit on a win, above zero.');
        return null;
    };

    const run = async () => {
        const problem = validate();
        if (problem) {
            setError(problem);
            return;
        }
        const this_run = run_id.current + 1;
        run_id.current = this_run;
        setError('');
        setIsRunning(true);

        try {
            const plan = planFromForm(plan_form);
            const duration_ticks = toNumber(duration);
            const barrier_value = rule.needs_barrier ? toNumber(barrier) : 0;

            const [ticks, quote_result] = await Promise.all([
                fetchTicks(symbol, toNumber(tick_count)),
                use_live_payout
                    ? fetchQuote({
                          contract_type: contract,
                          symbol,
                          duration: duration_ticks,
                          barrier: rule.needs_barrier ? barrier_value : undefined,
                          stake: plan.base_stake,
                          currency,
                      }).then(
                          quote => ({ quote, reason: null }),
                          (reason: unknown) => ({ quote: null, reason: errorMessage(reason) })
                      )
                    : Promise.resolve(null),
            ]);
            if (run_id.current !== this_run) return;

            const quote = quote_result?.quote ?? null;
            const quote_error = quote_result?.reason ?? null;
            const manual_payout = toNumber(payout);
            if (!quote && !(manual_payout > 0)) {
                throw new Error(
                    localize(
                        'The live payout was not available ({{reason}}). Turn off "Use the live payout" and enter one.',
                        {
                            reason: quote_error ?? '',
                        }
                    )
                );
            }
            const payout_percent = quote ? quote.payout_percent : manual_payout;
            if (quote) setPayout(quote.payout_percent.toFixed(2));

            const start_balance = toNumber(balance);
            const size = toNumber(bulk_size);
            const result = simulateBulk({
                ticks,
                type: contract,
                barrier: barrier_value,
                duration: duration_ticks,
                entry: { kind: entry_kind, length: toNumber(entry_length) },
                run: {
                    plan,
                    start_balance,
                    payout_percent,
                    contracts: size,
                    take_profit: toLimit(take_profit),
                    stop_loss: toLimit(stop_loss),
                    max_trades: toLimit(max_contracts),
                },
            });

            setOutcome({
                key: settings_key,
                symbol_label: MARKETS.find(([, value]) => value === symbol)?.[0] ?? symbol,
                contract_label: getContractOptions().find(([, value]) => value === contract)?.[0] ?? contract,
                is_digits: contract.startsWith('DIGIT'),
                currency,
                payout_percent,
                payout_source: quote ? 'quote' : 'input',
                quote_error: use_live_payout && !quote ? quote_error : null,
                ticks: { count: ticks.prices.length, from: ticks.times[0], to: ticks.times[ticks.times.length - 1] },
                result,
                summary: summarise(result.trades, start_balance),
                series: balanceSeries(result.trades, start_balance),
                start_balance,
                bulk_size: size,
            });
        } catch (caught) {
            if (run_id.current === this_run) setError(errorMessage(caught));
        } finally {
            if (run_id.current === this_run) setIsRunning(false);
        }
    };

    return (
        <main className='stake-tool' data-testid='dt_bulk_trader'>
            <section className='stake-tool__header'>
                <h1 className='stake-tool__title'>{localize('Bulk Trader simulator')}</h1>
                <p className='stake-tool__subtitle'>
                    {localize(
                        'Settle every contract against real ticks with the real payout, and see how far the result is from break-even. Nothing is bought on {{brand}}.',
                        { brand: getBrandName() }
                    )}
                </p>
            </section>

            <section className='stake-tool__panel'>
                <div className='stake-tool__form'>
                    <SectionTitle>{localize('Market and contract')}</SectionTitle>
                    <SelectField
                        id='bulk_symbol'
                        testid='dt_bulk_symbol'
                        label={localize('Market')}
                        value={symbol}
                        options={MARKETS.map(([label, value]) => [localize(label), value])}
                        onChange={setSymbol}
                    />
                    <SelectField
                        id='bulk_contract'
                        testid='dt_bulk_contract'
                        label={localize('Contract')}
                        value={contract}
                        options={getContractOptions()}
                        onChange={changeContract}
                    />
                    <div className='stake-tool__row'>
                        <Field
                            id='bulk_duration'
                            testid='dt_bulk_duration'
                            label={localize('Duration')}
                            value={duration}
                            onChange={setDuration}
                            suffix={localize('ticks')}
                            step='1'
                            min='1'
                        />
                        {rule.needs_barrier && (
                            <Field
                                id='bulk_barrier'
                                testid='dt_bulk_barrier'
                                label={localize('Prediction (last digit)')}
                                value={barrier}
                                onChange={setBarrier}
                                step='1'
                            />
                        )}
                    </div>
                    <Field
                        id='bulk_size'
                        testid='dt_bulk_size'
                        label={localize('Contracts per purchase')}
                        value={bulk_size}
                        onChange={setBulkSize}
                        step='1'
                        min='1'
                        hint={localize('They are bought together on the same ticks, so they all win or all lose.')}
                    />

                    <SectionTitle>{localize('When to buy')}</SectionTitle>
                    <SelectField
                        id='bulk_entry'
                        testid='dt_bulk_entry'
                        label={localize('Entry rule')}
                        value={entry_kind}
                        options={[
                            [localize('Buy as soon as the last contract ends'), 'always'],
                            [localize('Wait for a run of ticks that would not have won'), 'after_misses'],
                            [localize('Wait for a run of ticks that would have won'), 'after_hits'],
                        ]}
                        onChange={value => setEntryKind(value as TEntryRule['kind'])}
                    />
                    {entry_kind !== 'always' && (
                        <Field
                            id='bulk_entry_length'
                            testid='dt_bulk_entry_length'
                            label={localize('Length of the run')}
                            value={entry_length}
                            onChange={setEntryLength}
                            suffix={localize('ticks')}
                            step='1'
                            min='1'
                        />
                    )}

                    <SectionTitle>{localize('Stake and limits')}</SectionTitle>
                    <Field
                        id='bulk_balance'
                        testid='dt_bulk_balance'
                        label={localize('Starting balance')}
                        value={balance}
                        onChange={setBalance}
                        suffix={currency}
                        hint={Number.isFinite(account_balance) ? localize('Filled in from your account.') : undefined}
                    />
                    <StakePlanFields
                        prefix='bulk'
                        currency={currency}
                        form={plan_form}
                        onChange={patch => setPlanForm(previous => ({ ...previous, ...patch }))}
                    />
                    <div className='stake-tool__row'>
                        <Field
                            id='bulk_take_profit'
                            testid='dt_bulk_take_profit'
                            label={localize('Take profit')}
                            value={take_profit}
                            onChange={setTakeProfit}
                            suffix={currency}
                        />
                        <Field
                            id='bulk_stop_loss'
                            testid='dt_bulk_stop_loss'
                            label={localize('Stop loss')}
                            value={stop_loss}
                            onChange={setStopLoss}
                            suffix={currency}
                        />
                    </div>
                    <Field
                        id='bulk_max_contracts'
                        testid='dt_bulk_max_contracts'
                        label={localize('Stop after this many purchases')}
                        value={max_contracts}
                        onChange={setMaxContracts}
                        step='1'
                        hint={localize('Leave empty to use every tick.')}
                    />

                    <SectionTitle>{localize('Data and payout')}</SectionTitle>
                    <SelectField
                        id='bulk_tick_count'
                        testid='dt_bulk_tick_count'
                        label={localize('Real ticks to use')}
                        value={tick_count}
                        options={TICK_COUNTS.map(count => [count, count])}
                        onChange={setTickCount}
                        hint={localize('The latest ticks of the market, oldest first.')}
                    />
                    <label className='stake-tool__check' htmlFor='bulk_live_payout'>
                        <input
                            id='bulk_live_payout'
                            data-testid='dt_bulk_live_payout'
                            type='checkbox'
                            checked={use_live_payout}
                            onChange={event => setUseLivePayout(event.target.checked)}
                        />
                        {localize('Use the live payout for this contract')}
                    </label>
                    <Field
                        id='bulk_payout'
                        testid='dt_bulk_payout'
                        label={localize('Profit when a contract wins')}
                        value={payout}
                        onChange={setPayout}
                        suffix='%'
                        disabled={use_live_payout}
                        hint={
                            use_live_payout
                                ? localize('Quoted by the server when you run the simulation.')
                                : localize('Of your stake. Use the figure shown on the trade page.')
                        }
                    />

                    {error && (
                        <p className='stake-tool__error' role='alert' data-testid='dt_bulk_error'>
                            {error}
                        </p>
                    )}
                    <button
                        type='button'
                        className='stake-tool__button'
                        data-testid='dt_bulk_run'
                        disabled={is_running}
                        onClick={run}
                    >
                        {is_running ? localize('Settling contracts...') : localize('Run on real ticks')}
                    </button>
                </div>

                <div className='stake-tool__results' aria-live='polite'>
                    {outcome ? (
                        <BulkResults outcome={outcome} is_stale={outcome.key !== settings_key} />
                    ) : (
                        <p className='stake-tool__empty'>
                            {localize(
                                'Choose a contract and a stake plan, then run it. Every contract is settled against the latest real ticks of the market, so the win rate and profit are whatever the strategy actually produced.'
                            )}
                        </p>
                    )}
                </div>
            </section>

            <p className='stake-tool__disclaimer'>
                {localize(
                    'This is a simulation on past ticks, not advice and not a promise. Future ticks will differ, and you can lose money on every trade.'
                )}
            </p>
        </main>
    );
});

export default BulkTrader;
