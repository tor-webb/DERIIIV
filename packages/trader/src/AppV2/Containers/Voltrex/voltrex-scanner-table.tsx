import classNames from 'classnames';

import { localize } from '@deriv-com/translations';

import type { TScanRow } from './use-voltrex-scanner';
import { CATEGORIES } from './voltrex-config';
import { directionClass } from './voltrex-detail';
import {
    categoryCounts,
    filterRows,
    sortRows,
    summarise,
    TSortDirection,
    TSortKey,
    TTableFilters,
} from './voltrex-table';

type TProps = {
    rows: TScanRow[];
    filters: TTableFilters;
    onFilters: (filters: TTableFilters) => void;
    sort: { key: TSortKey; direction: TSortDirection };
    onSort: (sort: { key: TSortKey; direction: TSortDirection }) => void;
    selected: string | null;
    onSelect: (symbol: string) => void;
    primary_label: string;
    loaded: number;
    total: number;
    symbols_error: boolean;
    onRetry: () => void;
};

const COLUMNS: { key: TSortKey | null; label: () => string }[] = [
    { key: 'name', label: () => localize('Market') },
    { key: null, label: () => localize('Price') },
    { key: 'change', label: () => localize('24h') },
    { key: 'volatility', label: () => localize('Volatility') },
    { key: null, label: () => localize('Trend') },
    { key: null, label: () => localize('Momentum') },
    { key: 'score', label: () => localize('Signal') },
    { key: 'strength', label: () => localize('Strength') },
    { key: null, label: () => localize('TF') },
];

const LEVEL_TEXT = () => ({ low: localize('Low'), medium: localize('Medium'), high: localize('High') });
const TREND_TEXT = () => ({ up: localize('Up'), down: localize('Down'), sideways: localize('Sideways') });
const MOMENTUM_TEXT = () => ({ strong: localize('Strong'), moderate: localize('Moderate'), weak: localize('Weak') });

const arrow = (direction: TSortDirection) => (direction === 'asc' ? ' ▲' : ' ▼');

const statusText = (row: TScanRow) => {
    if (row.status === 'closed') return localize('Closed');
    if (row.status === 'unavailable') return localize('No data');
    return localize('Loading…');
};

const VoltrexScannerTable = ({
    rows,
    filters,
    onFilters,
    sort,
    onSort,
    selected,
    onSelect,
    primary_label,
    loaded,
    total,
    symbols_error,
    onRetry,
}: TProps) => {
    const counts = categoryCounts(rows);
    const summary = summarise(rows);
    const visible = sortRows(filterRows(rows, filters), sort.key, sort.direction);
    const level_text = LEVEL_TEXT();
    const trend_text = TREND_TEXT();
    const momentum_text = MOMENTUM_TEXT();

    const sortBy = (key: TSortKey) =>
        onSort({ key, direction: sort.key === key && sort.direction === 'desc' ? 'asc' : 'desc' });

    return (
        <section className='voltrex__panel voltrex-scanner' aria-label={localize('Market scanner')}>
            <div className='voltrex-scanner__top'>
                <h2 className='voltrex__panel-title'>{localize('Market scanner')}</h2>
                <span className='voltrex__muted' data-testid='voltrex-progress'>
                    {localize(
                        '{{loaded}} of {{total}} markets analysed · {{buy}} buy · {{sell}} sell · {{neutral}} neutral',
                        {
                            loaded: summary.analysed,
                            total,
                            buy: summary.buy,
                            sell: summary.sell,
                            neutral: summary.neutral,
                        }
                    )}
                    {loaded < total ? ` · ${localize('loading')}` : ''}
                </span>
            </div>

            {symbols_error && (
                <div className='voltrex__alert' role='alert'>
                    {localize('The list of markets could not be loaded.')}{' '}
                    <button type='button' className='voltrex__link' onClick={onRetry}>
                        {localize('Try again')}
                    </button>
                </div>
            )}

            <div className='voltrex-scanner__chips' role='group' aria-label={localize('Market category')}>
                <button
                    type='button'
                    className={classNames('voltrex__chip', filters.category === 'all' && 'voltrex__chip--on')}
                    aria-pressed={filters.category === 'all'}
                    onClick={() => onFilters({ ...filters, category: 'all' })}
                >
                    {localize('All')} ({rows.length})
                </button>
                {CATEGORIES.filter(category => counts[category.id]).map(category => (
                    <button
                        key={category.id}
                        type='button'
                        className={classNames('voltrex__chip', filters.category === category.id && 'voltrex__chip--on')}
                        aria-pressed={filters.category === category.id}
                        onClick={() => onFilters({ ...filters, category: category.id })}
                    >
                        {category.label} ({counts[category.id]})
                    </button>
                ))}
            </div>

            <div className='voltrex-scanner__tools'>
                <input
                    type='search'
                    className='voltrex__input'
                    placeholder={localize('Search markets')}
                    aria-label={localize('Search markets')}
                    value={filters.query}
                    onChange={event => onFilters({ ...filters, query: event.target.value })}
                />
                <select
                    className='voltrex__input'
                    aria-label={localize('Signal filter')}
                    value={filters.signal}
                    onChange={event => onFilters({ ...filters, signal: event.target.value as TTableFilters['signal'] })}
                >
                    <option value='all'>{localize('All signals')}</option>
                    <option value='BUY'>{localize('Buy')}</option>
                    <option value='SELL'>{localize('Sell')}</option>
                    <option value='NEUTRAL'>{localize('Neutral')}</option>
                </select>
                <label className='voltrex__check'>
                    <input
                        type='checkbox'
                        checked={filters.open_only}
                        onChange={event => onFilters({ ...filters, open_only: event.target.checked })}
                    />
                    {localize('Open only')}
                </label>
                <div className='voltrex-scanner__rank' role='group' aria-label={localize('Rankings')}>
                    <button
                        type='button'
                        className={classNames('voltrex__chip', sort.key === 'strength' && 'voltrex__chip--on')}
                        onClick={() => onSort({ key: 'strength', direction: 'desc' })}
                    >
                        {localize('Signal ranking')}
                    </button>
                    <button
                        type='button'
                        className={classNames('voltrex__chip', sort.key === 'volatility' && 'voltrex__chip--on')}
                        onClick={() => onSort({ key: 'volatility', direction: 'desc' })}
                    >
                        {localize('Volatility ranking')}
                    </button>
                </div>
            </div>

            <div className='voltrex-scanner__scroll'>
                <table className='voltrex-table'>
                    <thead>
                        <tr>
                            {COLUMNS.map(column => {
                                const sorted = column.key !== null && sort.key === column.key;
                                let aria: 'ascending' | 'descending' | 'none' = 'none';
                                if (sorted) aria = sort.direction === 'asc' ? 'ascending' : 'descending';
                                return (
                                    <th key={column.label()} scope='col' aria-sort={column.key ? aria : undefined}>
                                        {column.key ? (
                                            <button
                                                type='button'
                                                className='voltrex-table__sort'
                                                onClick={() => sortBy(column.key as TSortKey)}
                                            >
                                                {column.label()}
                                                {sorted ? arrow(sort.direction) : ''}
                                            </button>
                                        ) : (
                                            column.label()
                                        )}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map(row => {
                            const { signal } = row;
                            return (
                                <tr
                                    key={row.symbol}
                                    className={classNames(
                                        'voltrex-table__row',
                                        selected === row.symbol && 'voltrex-table__row--selected'
                                    )}
                                    data-testid={`voltrex-row-${row.symbol}`}
                                >
                                    <td data-label={localize('Market')}>
                                        <button
                                            type='button'
                                            className='voltrex-table__name'
                                            aria-pressed={selected === row.symbol}
                                            onClick={() => onSelect(row.symbol)}
                                        >
                                            <strong>{row.name}</strong>
                                            <span className='voltrex__muted'>{row.market_name}</span>
                                        </button>
                                    </td>
                                    <td data-label={localize('Price')} className='voltrex-table__num'>
                                        {row.price === null ? '–' : row.price.toFixed(row.pip_size)}
                                        {row.is_live && (
                                            <span className='voltrex__live' title={localize('Live ticks')} />
                                        )}
                                    </td>
                                    <td
                                        data-label={localize('24h')}
                                        className={classNames(
                                            'voltrex-table__num',
                                            row.change_pct !== null &&
                                                (row.change_pct < 0 ? 'voltrex__tone--sell' : 'voltrex__tone--buy')
                                        )}
                                    >
                                        {row.change_pct === null
                                            ? '–'
                                            : `${row.change_pct > 0 ? '+' : ''}${row.change_pct.toFixed(2)}%`}
                                    </td>
                                    <td data-label={localize('Volatility')}>
                                        {row.volatility_level ? (
                                            <span className={`voltrex__level voltrex__level--${row.volatility_level}`}>
                                                {level_text[row.volatility_level]}
                                            </span>
                                        ) : (
                                            '–'
                                        )}
                                    </td>
                                    <td data-label={localize('Trend')}>{signal ? trend_text[signal.trend] : '–'}</td>
                                    <td data-label={localize('Momentum')}>
                                        {signal ? momentum_text[signal.momentum] : '–'}
                                    </td>
                                    <td data-label={localize('Signal')}>
                                        {signal ? (
                                            <span
                                                className={classNames(
                                                    'voltrex__badge',
                                                    directionClass(signal.direction)
                                                )}
                                            >
                                                {signal.direction}
                                            </span>
                                        ) : (
                                            <span className='voltrex__muted'>{statusText(row)}</span>
                                        )}
                                    </td>
                                    <td data-label={localize('Strength')} className='voltrex-table__num'>
                                        {signal ? signal.strength : '–'}
                                    </td>
                                    <td data-label={localize('TF')}>{signal ? primary_label : '–'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {!visible.length && (
                    <p className='voltrex__muted voltrex-scanner__empty' data-testid='voltrex-empty'>
                        {rows.length
                            ? localize('No markets match these filters.')
                            : localize('Waiting for the market list…')}
                    </p>
                )}
            </div>
        </section>
    );
};

export default VoltrexScannerTable;
