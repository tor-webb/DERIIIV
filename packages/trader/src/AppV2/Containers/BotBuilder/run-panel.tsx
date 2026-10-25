import React from 'react';
import classNames from 'classnames';

import { localize } from '@deriv-com/translations';

import type { TJournalEntry } from './bot-utils';
import type { TBotStats, TLiveContract, TTransaction } from './Engine';
import {
    formatSigned,
    getContractLabel,
    getSymbolBadge,
    getSymbolLabel,
    isUpContract,
    transactionsToCsv,
} from './panel-utils';

export type TPanelTab = 'summary' | 'transactions' | 'journal';

export type TRunLimitsInput = { max_trades: string; max_profit: string; max_loss: string };

type TRunPanelProps = {
    tab: TPanelTab;
    onTabChange: (tab: TPanelTab) => void;
    stats: TBotStats;
    live: TLiveContract | null;
    transactions: TTransaction[];
    journal: TJournalEntry[];
    currency: string;
    is_active: boolean;
    limits: TRunLimitsInput;
    onLimitsChange: (limits: TRunLimitsInput) => void;
    onReset: () => void;
};

const ContractArrow = ({ up }: { up: boolean }) => (
    <svg className='run-panel__arrow' width='22' height='22' viewBox='0 0 24 24' aria-hidden='true'>
        <path
            d={up ? 'M6 18 18 6M9 6h9v9' : 'M6 6l12 12M9 18h9V9'}
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

const MarketBadge = ({ symbol }: { symbol: string }) => (
    <span className='run-panel__market-badge' aria-hidden='true'>
        {getSymbolBadge(symbol) || '•'}
    </span>
);

const profitClass = (value: number) => ({
    'run-panel__value--up': value > 0,
    'run-panel__value--down': value < 0,
});

const RunPanel = ({
    tab,
    onTabChange,
    stats,
    live,
    transactions,
    journal,
    currency,
    is_active,
    limits,
    onLimitsChange,
    onReset,
}: TRunPanelProps) => {
    const [selected_id, setSelectedId] = React.useState<number | null>(null);
    const [show_detail, setShowDetail] = React.useState(false);
    const selected = transactions.find(item => item.contract_id === selected_id) ?? null;

    const setLimit = (key: keyof TRunLimitsInput) => (event: React.ChangeEvent<HTMLInputElement>) =>
        onLimitsChange({ ...limits, [key]: event.target.value });

    const downloadTransactions = () => {
        const blob = new Blob([transactionsToCsv(transactions)], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'bot-transactions.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    const statTiles = [
        { key: 'stake', label: localize('Total stake'), value: stats.total_stake.toFixed(2) },
        { key: 'payout', label: localize('Total payout'), value: stats.total_payout.toFixed(2) },
        { key: 'runs', label: localize('No. of runs'), value: String(stats.runs) },
        { key: 'lost', label: localize('Contracts lost'), value: String(stats.lost) },
        { key: 'won', label: localize('Contracts won'), value: String(stats.won) },
        { key: 'profit', label: localize('Total profit/loss'), value: stats.total_profit.toFixed(2) },
    ];

    return (
        <aside className='run-panel' aria-label={localize('Run panel')}>
            <div className='run-panel__tabs' role='tablist'>
                {(['summary', 'transactions', 'journal'] as TPanelTab[]).map(name => (
                    <button
                        key={name}
                        type='button'
                        role='tab'
                        aria-selected={tab === name}
                        className={classNames('run-panel__tab', { 'run-panel__tab--active': tab === name })}
                        onClick={() => onTabChange(name)}
                    >
                        {name === 'summary' && localize('Summary')}
                        {name === 'transactions' && localize('Transactions')}
                        {name === 'journal' && localize('Journal')}
                    </button>
                ))}
            </div>

            {tab === 'summary' && (
                <div className='run-panel__body' data-testid='dt_bot_builder_summary'>
                    {live ? (
                        <section className='run-panel__live' data-testid='dt_bot_builder_live'>
                            <header className='run-panel__live-head'>
                                <MarketBadge symbol={live.symbol} />
                                <span className='run-panel__live-market'>{getSymbolLabel(live.symbol)}</span>
                                <span className='run-panel__live-type'>
                                    <ContractArrow up={isUpContract(live.contract_type)} />
                                    {getContractLabel(live.contract_type)}
                                </span>
                            </header>
                            {live.tick_total > 0 && (
                                <div className='run-panel__ticks'>
                                    <span>
                                        {localize('Tick {{count}}', {
                                            count: Math.min(live.tick_current, live.tick_total),
                                        })}
                                    </span>
                                    <div
                                        className='run-panel__progress'
                                        role='progressbar'
                                        aria-valuemin={0}
                                        aria-valuemax={live.tick_total}
                                        aria-valuenow={Math.min(live.tick_current, live.tick_total)}
                                    >
                                        <span
                                            style={{
                                                width: `${Math.min(100, (live.tick_current / live.tick_total) * 100)}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                            <span className='run-panel__currency'>{currency}</span>
                            <dl className='run-panel__live-grid'>
                                <div>
                                    <dt>{localize('Total profit/loss:')}</dt>
                                    <dd className={classNames('run-panel__value', profitClass(live.profit))}>
                                        {formatSigned(live.profit)}
                                    </dd>
                                </div>
                                <div>
                                    <dt>{localize('Contract value:')}</dt>
                                    <dd className={classNames('run-panel__value', profitClass(live.profit))}>
                                        {live.current_value.toFixed(2)}
                                    </dd>
                                </div>
                                <div>
                                    <dt>{localize('Stake:')}</dt>
                                    <dd>{live.buy_price.toFixed(2)}</dd>
                                </div>
                                <div>
                                    <dt>{localize('Potential payout:')}</dt>
                                    <dd>{live.payout.toFixed(2)}</dd>
                                </div>
                            </dl>
                            <p className='run-panel__resale'>
                                {live.resale_offered ? localize('Resale offered') : localize('Resale not offered')}
                            </p>
                        </section>
                    ) : (
                        <p className='run-panel__empty'>
                            {is_active
                                ? localize('Waiting for the next trade…')
                                : localize('Press "Run" to start the bot. The contract it buys is shown here.')}
                        </p>
                    )}

                    <div className='run-panel__limits'>
                        <label>
                            {localize('Take profit')}
                            <input
                                type='number'
                                min='0'
                                value={limits.max_profit}
                                disabled={is_active}
                                placeholder={localize('No limit')}
                                onChange={setLimit('max_profit')}
                            />
                        </label>
                        <label>
                            {localize('Stop loss')}
                            <input
                                type='number'
                                min='0'
                                value={limits.max_loss}
                                disabled={is_active}
                                placeholder={localize('No limit')}
                                onChange={setLimit('max_loss')}
                            />
                        </label>
                        <label>
                            {localize('Stop after trades')}
                            <input
                                type='number'
                                min='1'
                                value={limits.max_trades}
                                disabled={is_active}
                                placeholder={localize('No limit')}
                                onChange={setLimit('max_trades')}
                            />
                        </label>
                    </div>
                    <p className='run-panel__hint'>
                        {localize(
                            'With a take profit or stop loss set, the bot keeps trading until one of them is reached or you press Stop.'
                        )}
                    </p>

                    <div className='run-panel__totals'>
                        <dl className='run-panel__stats' data-testid='dt_bot_builder_stats'>
                            {statTiles.map(({ key, label, value }) => (
                                <div key={key} className='run-panel__stat'>
                                    <dt>{label}</dt>
                                    <dd
                                        className={classNames({
                                            'run-panel__value--up': key === 'profit' && stats.total_profit > 0,
                                            'run-panel__value--down': key === 'profit' && stats.total_profit < 0,
                                        })}
                                    >
                                        {value}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                    <button type='button' className='run-panel__reset' disabled={is_active} onClick={onReset}>
                        {localize('Reset')}
                    </button>
                </div>
            )}

            {tab === 'transactions' && (
                <div className='run-panel__body' data-testid='dt_bot_builder_transactions'>
                    <div className='run-panel__actions'>
                        <button
                            type='button'
                            className='run-panel__action'
                            disabled={transactions.length === 0}
                            onClick={downloadTransactions}
                        >
                            {localize('Download')}
                        </button>
                        <button
                            type='button'
                            className='run-panel__action'
                            disabled={!selected}
                            aria-pressed={show_detail}
                            onClick={() => setShowDetail(previous => !previous)}
                        >
                            {localize('View Detail')}
                        </button>
                    </div>

                    {show_detail && selected && (
                        <dl className='run-panel__detail' data-testid='dt_bot_builder_detail'>
                            <div>
                                <dt>{localize('Contract ID')}</dt>
                                <dd>{selected.contract_id}</dd>
                            </div>
                            <div>
                                <dt>{localize('Market')}</dt>
                                <dd>{getSymbolLabel(selected.symbol)}</dd>
                            </div>
                            <div>
                                <dt>{localize('Time')}</dt>
                                <dd>{selected.time}</dd>
                            </div>
                            <div>
                                <dt>{localize('Potential payout')}</dt>
                                <dd>{selected.payout.toFixed(2)}</dd>
                            </div>
                        </dl>
                    )}

                    <div className='run-panel__table-head' role='row'>
                        <span>{localize('Type')}</span>
                        <span>{localize('Entry/Exit spot')}</span>
                        <span>{localize('Buy price and P/L')}</span>
                    </div>
                    {transactions.length === 0 ? (
                        <p className='run-panel__empty'>{localize('Contracts the bot buys appear here.')}</p>
                    ) : (
                        <ul className='run-panel__rows'>
                            {transactions.map(item => (
                                <li key={item.contract_id}>
                                    <button
                                        type='button'
                                        className={classNames('run-panel__row', {
                                            'run-panel__row--selected': item.contract_id === selected_id,
                                        })}
                                        aria-pressed={item.contract_id === selected_id}
                                        onClick={() =>
                                            setSelectedId(item.contract_id === selected_id ? null : item.contract_id)
                                        }
                                    >
                                        <span
                                            className='run-panel__row-type'
                                            title={getContractLabel(item.contract_type)}
                                        >
                                            <MarketBadge symbol={item.symbol} />
                                            <ContractArrow up={isUpContract(item.contract_type)} />
                                        </span>
                                        <span className='run-panel__row-spots'>
                                            <span>
                                                <i className='run-panel__dot run-panel__dot--entry' />
                                                {item.entry_spot || '—'}
                                            </span>
                                            <span>
                                                <i className='run-panel__dot run-panel__dot--exit' />
                                                {item.exit_spot || '—'}
                                            </span>
                                        </span>
                                        <span className='run-panel__row-money'>
                                            <span>
                                                {item.buy_price.toFixed(2)} {currency}
                                            </span>
                                            <span
                                                className={classNames({
                                                    'run-panel__value--up': item.status === 'won',
                                                    'run-panel__value--down': item.status === 'lost',
                                                })}
                                            >
                                                {item.status === 'open'
                                                    ? localize('Open')
                                                    : `${formatSigned(item.profit)} ${currency}`}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {tab === 'journal' && (
                <div className='run-panel__body'>
                    {journal.length === 0 ? (
                        <p className='run-panel__empty'>
                            {localize('Build your bot, then press "Run". "Check bot" validates it without trading.')}
                        </p>
                    ) : (
                        <ul className='run-panel__journal'>
                            {journal.map(entry => (
                                <li
                                    key={entry.id}
                                    className={classNames(
                                        'run-panel__journal-entry',
                                        `run-panel__journal-entry--${entry.level}`
                                    )}
                                >
                                    <span className='run-panel__journal-time'>{entry.time}</span>
                                    <span>{entry.message}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </aside>
    );
};

export default RunPanel;
