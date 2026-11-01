import React from 'react';
import classNames from 'classnames';

import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import { useVoltrexScanner } from './use-voltrex-scanner';
import { useVoltrexTrader } from './use-voltrex-trader';
import VoltrexActivity from './voltrex-activity';
import type { TSignalDirection } from './voltrex-analysis';
import { CONFIRM_FRAME, PRIMARY_FRAME } from './voltrex-config';
import VoltrexDetail from './voltrex-detail';
import VoltrexScannerTable from './voltrex-scanner-table';
import { performance, signalChanges, TSignalEvent } from './voltrex-stats';
import { DEFAULT_FILTERS, TSortDirection, TSortKey, TTableFilters } from './voltrex-table';
import VoltrexTradePanel from './voltrex-trade-panel';

import './voltrex.scss';

const MAX_EVENTS = 40;

const Voltrex = observer(() => {
    const { client, common } = useStore();
    const [filters, setFilters] = React.useState<TTableFilters>(DEFAULT_FILTERS);
    const [sort, setSort] = React.useState<{ key: TSortKey; direction: TSortDirection }>({
        key: 'strength',
        direction: 'desc',
    });
    const [selected, setSelected] = React.useState<string | null>(null);
    const [events, setEvents] = React.useState<TSignalEvent[]>([]);
    const last_seen = React.useRef<Record<string, TSignalDirection>>({});

    const scanner = useVoltrexScanner({ selected });
    const { rows, updated_at } = scanner;
    const trader = useVoltrexTrader(rows);

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

    return (
        <main className='voltrex' data-testid='voltrex-page'>
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

            <div className='voltrex__layout'>
                <div className='voltrex__main'>
                    <VoltrexScannerTable
                        rows={rows}
                        filters={filters}
                        onFilters={setFilters}
                        sort={sort}
                        onSort={setSort}
                        selected={selected}
                        onSelect={setSelected}
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
                    />
                </aside>
                <div className='voltrex__trade'>
                    <VoltrexTradePanel
                        rows={rows}
                        selected={selected}
                        onSelect={setSelected}
                        trader={trader}
                        is_logged_in={client.is_logged_in}
                    />
                </div>
            </div>

            <VoltrexActivity trades={trader.snapshot.trades} events={events} stats={stats} currency={client.currency} />
        </main>
    );
});

export default Voltrex;
