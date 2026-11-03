import React from 'react';
import classNames from 'classnames';

import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import { useVoltrexDigits } from './use-voltrex-digits';
import { useVoltrexScanner } from './use-voltrex-scanner';
import { useVoltrexTrader } from './use-voltrex-trader';
import VoltrexActivity from './voltrex-activity';
import type { TSignalDirection } from './voltrex-analysis';
import { CONFIRM_FRAME, PRIMARY_FRAME } from './voltrex-config';
import VoltrexDetail from './voltrex-detail';
import VoltrexEngine from './voltrex-engine';
import VoltrexLab from './voltrex-lab';
import { isDigitProduct } from './voltrex-products';
import VoltrexScannerTable from './voltrex-scanner-table';
import { performance, signalChanges, TSignalEvent } from './voltrex-stats';
import { DEFAULT_FILTERS, TSortDirection, TSortKey, TTableFilters } from './voltrex-table';
import VoltrexTradePanel from './voltrex-trade-panel';

import './voltrex.scss';

const MAX_EVENTS = 40;
const MAX_DIGIT_MARKETS = 30;
const DIGIT_CATEGORIES = ['volatility', 'jump', 'step', 'other_synthetic'];

type TView = 'scan' | 'market' | 'trade' | 'activity';

const VIEWS: { id: TView; label: () => string }[] = [
    { id: 'scan', label: () => localize('Scanner') },
    { id: 'market', label: () => localize('Market') },
    { id: 'trade', label: () => localize('Trade') },
    { id: 'activity', label: () => localize('Activity') },
];

const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 768px)').matches;

const Voltrex = observer(() => {
    const { client, common } = useStore();
    const [filters, setFilters] = React.useState<TTableFilters>(DEFAULT_FILTERS);
    const [sort, setSort] = React.useState<{ key: TSortKey; direction: TSortDirection }>({
        key: 'strength',
        direction: 'desc',
    });
    const [selected, setSelected] = React.useState<string | null>(null);
    const [events, setEvents] = React.useState<TSignalEvent[]>([]);
    const [view, setView] = React.useState<TView>('scan');
    const top = React.useRef<HTMLElement>(null);
    const last_seen = React.useRef<Record<string, TSignalDirection>>({});

    // markets whose last digits are followed: the selected one, and (while auto-trading uses a digit contract) every
    // open synthetic market in its categories
    const [digit_markets, setDigitMarkets] = React.useState<{ symbol: string; pip_size: number }[]>([]);
    const digit_key = digit_markets.map(item => item.symbol).join(',');
    const digits = useVoltrexDigits(digit_markets);
    const scanner = useVoltrexScanner({ selected, extra_live: digit_markets.map(item => item.symbol) });
    const { rows, updated_at } = scanner;
    const trader = useVoltrexTrader(rows, digits.getDigits);
    const auto_scope = trader.snapshot.auto_scope;
    const wants_digits = !!auto_scope?.products.some(isDigitProduct);
    const scope_key = auto_scope ? auto_scope.categories.join(',') : '';

    React.useEffect(() => {
        const next = rows
            .filter(
                item =>
                    item.is_open &&
                    DIGIT_CATEGORIES.includes(item.category) &&
                    (item.symbol === selected || (wants_digits && auto_scope?.categories.includes(item.category)))
            )
            .slice(0, MAX_DIGIT_MARKETS)
            .map(item => ({ symbol: item.symbol, pip_size: item.pip_size }));
        if (next.map(item => item.symbol).join(',') !== digit_key) setDigitMarkets(next);
        // the auto-trading scope is read through its key
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows.length, selected, wants_digits, scope_key, digit_key]);

    // open the strongest signal once, so the side panel is not empty while the first markets load
    React.useEffect(() => {
        if (selected || !rows.length) return;
        const best = rows
            .filter(row => row.signal && row.status === 'ready')
            .sort((a, b) => (b.signal?.strength ?? 0) - (a.signal?.strength ?? 0))[0];
        if (best) setSelected(best.symbol);
    }, [rows, selected]);

    // note every change of signal, for the activity feed
    React.useEffect(() => {
        if (!updated_at) return;
        const { events: found, next } = signalChanges(last_seen.current, rows, updated_at);
        last_seen.current = next;
        if (found.length) setEvents(previous => [...found, ...previous].slice(0, MAX_EVENTS));
    }, [rows, updated_at]);

    const row = rows.find(item => item.symbol === selected) ?? null;
    const candles = selected ? scanner.getCandles(selected) : null;
    const open_markets = rows.filter(item => item.is_open).length;
    const is_connected = common.is_socket_opened;
    const stats = performance(trader.snapshot.trades, trader.snapshot.risk);
    const balance = Number(client.balance);
    const { snapshot } = trader;
    const open_trades = snapshot.trades.filter(trade => trade.status === 'placing' || trade.status === 'open').length;

    // on a phone only one section shows at a time, so move to the top of the one that was chosen
    const show = (next: TView) => {
        setView(next);
        top.current?.scrollIntoView?.({ block: 'start' });
    };

    // choosing a market in the table opens its chart and analysis on a phone
    const pick = (symbol: string) => {
        setSelected(symbol);
        if (isPhone()) show('market');
    };

    return (
        <main className='voltrex' data-testid='voltrex-page' data-view={view} ref={top}>
            <header className='voltrex__header'>
                <div>
                    <h1 className='voltrex__title'>{localize('VOLTREX SCANNER')}</h1>
                    <p className='voltrex__muted'>
                        {localize(
                            'Live analysis of every market Deriv offers. Signals come from standard indicators and do not predict price or promise profit. Trading can lose money.'
                        )}
                    </p>
                </div>
                <dl className='voltrex__status' data-testid='voltrex-status'>
                    <div>
                        <dt>{localize('Connection')}</dt>
                        <dd className={classNames(is_connected ? 'voltrex__tone--buy' : 'voltrex__tone--sell')}>
                            <span className={classNames('voltrex__dot', is_connected && 'voltrex__dot--on')} />
                            {is_connected ? localize('Connected to Deriv') : localize('Disconnected')}
                        </dd>
                    </div>
                    <div>
                        <dt>{localize('Account')}</dt>
                        <dd>
                            {client.is_logged_in
                                ? `${client.is_virtual ? localize('DEMO') : localize('REAL')} ${client.loginid ?? ''}`
                                : localize('Not logged in')}
                        </dd>
                    </div>
                    <div>
                        <dt>{localize('Balance')}</dt>
                        <dd data-testid='voltrex-balance'>
                            {client.is_logged_in && Number.isFinite(balance)
                                ? `${balance.toFixed(2)} ${client.currency}`
                                : '–'}
                        </dd>
                    </div>
                    <div>
                        <dt>{localize('Markets')}</dt>
                        <dd data-testid='voltrex-market-status'>
                            {localize('{{open}} of {{total}} open', { open: open_markets, total: scanner.total })}
                        </dd>
                    </div>
                </dl>
            </header>

            <VoltrexEngine
                rows={rows}
                loaded={scanner.loaded}
                total={scanner.total}
                auto={snapshot.auto}
                scan={snapshot.scan}
                trades={snapshot.trades}
                log={snapshot.log}
                emergency={snapshot.risk.emergency_stop}
                is_virtual={client.is_virtual}
            />

            <nav className='voltrex__tabs' aria-label={localize('Sections')}>
                {VIEWS.map(item => (
                    <button
                        key={item.id}
                        type='button'
                        className={classNames('voltrex__tab', view === item.id && 'voltrex__tab--on')}
                        aria-pressed={view === item.id}
                        onClick={() => show(item.id)}
                        data-testid={`voltrex-tab-${item.id}`}
                    >
                        {item.label()}
                        {item.id === 'trade' && snapshot.auto === 'running' && <span className='voltrex__tab-dot' />}
                        {item.id === 'activity' && open_trades > 0 && (
                            <span className='voltrex__tab-count'>{open_trades}</span>
                        )}
                    </button>
                ))}
            </nav>

            <div className='voltrex__layout'>
                <div className='voltrex__main'>
                    <VoltrexScannerTable
                        rows={rows}
                        filters={filters}
                        onFilters={setFilters}
                        sort={sort}
                        onSort={setSort}
                        selected={selected}
                        onSelect={pick}
                        primary_label={PRIMARY_FRAME.label}
                        loaded={scanner.loaded}
                        total={scanner.total}
                        symbols_error={scanner.symbols_error}
                        onRetry={scanner.retry}
                    />
                </div>
                <aside className='voltrex__side'>
                    <VoltrexDetail
                        row={row}
                        primary={candles?.primary ?? []}
                        confirm={candles?.confirm ?? []}
                        primary_label={PRIMARY_FRAME.label}
                        confirm_label={CONFIRM_FRAME.label}
                        onTrade={() => show('trade')}
                    />
                    <VoltrexLab
                        row={row}
                        stats={selected ? digits.getStats(selected) : null}
                        min_strength={trader.risk.min_strength}
                    />
                </aside>
                <div className='voltrex__trade'>
                    <VoltrexTradePanel
                        rows={rows}
                        selected={selected}
                        onSelect={setSelected}
                        trader={trader}
                        is_logged_in={client.is_logged_in}
                        getStats={digits.getStats}
                    />
                </div>
            </div>

            <VoltrexActivity trades={snapshot.trades} events={events} stats={stats} currency={client.currency} />
        </main>
    );
});

export default Voltrex;
