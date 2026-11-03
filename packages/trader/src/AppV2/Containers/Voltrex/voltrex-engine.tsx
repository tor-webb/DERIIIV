import classNames from 'classnames';

import { localize } from '@deriv-com/translations';

import type { TScanRow } from './use-voltrex-scanner';
import { summarise } from './voltrex-table';
import type { TAutoState, TLogEntry, TScanReport, TTrade } from './voltrex-trader';

type TProps = {
    rows: TScanRow[];
    loaded: number;
    total: number;
    auto: TAutoState;
    scan: TScanReport | null;
    trades: TTrade[];
    log: TLogEntry[];
    emergency: boolean;
    is_virtual: boolean;
};

const MAX_BLIPS = 60;

/** A stable number from a symbol, so a market keeps its place on the radar from one update to the next. */
export const hashOf = (text: string): number => {
    let hash = 5381;
    for (let index = 0; index < text.length; index += 1) {
        hash = (hash * 33 + text.charCodeAt(index)) % 4294967296;
    }
    return hash;
};

/**
 * Where a market's blip sits, as a percentage of the radar's width and height. The angle and distance come from the
 * symbol, so the position carries no meaning: it only keeps each market in the same spot. What does carry meaning is
 * the colour (BUY or SELL), the size and brightness (strength) and the ring (a trade is open on it).
 */
export const blipPosition = (symbol: string) => {
    const hash = hashOf(symbol);
    const angle = ((hash % 3600) / 3600) * Math.PI * 2;
    const distance = 0.2 + ((Math.floor(hash / 4096) % 1000) / 1000) * 0.72;
    return { left: 50 + Math.cos(angle) * distance * 50, top: 50 + Math.sin(angle) * distance * 50 };
};

type TMode = { id: 'emergency' | 'executing' | 'auto' | 'scanning' | 'live'; label: string };

const modeOf = (props: TProps, executing: boolean): TMode => {
    if (props.emergency) return { id: 'emergency', label: localize('EMERGENCY STOP') };
    if (executing) return { id: 'executing', label: localize('EXECUTING TRADE') };
    if (props.auto === 'running') return { id: 'auto', label: localize('AUTO SCAN ACTIVE') };
    if (props.auto === 'paused') return { id: 'live', label: localize('AUTO PAUSED') };
    if (props.loaded < props.total) return { id: 'scanning', label: localize('SCANNING MARKETS') };
    return { id: 'live', label: localize('LIVE · STANDBY') };
};

const tradeLine = (trade: TTrade | undefined) => {
    if (!trade) return localize('No trade yet. Executions will appear here.');
    const base = `${trade.label} · ${trade.name} · ${trade.stake.toFixed(2)}`;
    if (trade.status === 'placing') return localize('EXECUTING {{trade}}', { trade: base });
    if (trade.status === 'open') return localize('LIVE {{trade}}', { trade: base });
    if (trade.status === 'failed') return localize('NOT PLACED {{trade}}', { trade: base });
    const profit = trade.profit === undefined ? '' : ` ${trade.profit > 0 ? '+' : ''}${trade.profit.toFixed(2)}`;
    return `${trade.status === 'won' ? localize('WON') : localize('LOST')} ${base}${profit}`;
};

/**
 * The live "engine" strip at the top of the page: a radar of the markets that currently have a BUY or SELL reading,
 * the scan progress, what auto-trading found on its last look (and why it did or did not trade), the latest
 * execution and a terminal feed. The motion runs only while something is really scanning or trading.
 */
const VoltrexEngine = (props: TProps) => {
    const { rows, loaded, total, auto, scan, trades, log, is_virtual } = props;
    const summary = summarise(rows);
    const executing = trades.some(trade => trade.status === 'placing');
    const mode = modeOf(props, executing);
    const is_active = mode.id === 'scanning' || mode.id === 'auto' || mode.id === 'executing';
    const open_symbols = new Set(
        trades.filter(trade => trade.status === 'placing' || trade.status === 'open').map(trade => trade.symbol)
    );
    const blips = rows
        .filter(row => row.signal && row.signal.direction !== 'NEUTRAL')
        .sort((a, b) => (b.signal?.strength ?? 0) - (a.signal?.strength ?? 0))
        .slice(0, MAX_BLIPS);
    const percent = total ? Math.round((loaded / total) * 100) : 0;
    const feed = log.slice(-4);

    return (
        <section
            className={classNames(
                'voltrex-engine',
                `voltrex-engine--${mode.id}`,
                is_active && 'voltrex-engine--active'
            )}
            aria-label={localize('Scanner engine')}
            data-testid='voltrex-engine'
        >
            <div
                className='voltrex-radar'
                role='img'
                aria-label={localize('Radar of {{count}} markets with a buy or sell reading', { count: blips.length })}
            >
                <div className='voltrex-radar__rings' />
                <div className='voltrex-radar__sweep' />
                {blips.map(row => {
                    const { left, top } = blipPosition(row.symbol);
                    const strength = row.signal?.strength ?? 0;
                    return (
                        <span
                            key={row.symbol}
                            data-testid={`voltrex-blip-${row.signal?.direction === 'BUY' ? 'buy' : 'sell'}${
                                open_symbols.has(row.symbol) ? '-trade' : ''
                            }`}
                            className={classNames(
                                'voltrex-radar__blip',
                                row.signal?.direction === 'BUY'
                                    ? 'voltrex-radar__blip--buy'
                                    : 'voltrex-radar__blip--sell',
                                open_symbols.has(row.symbol) && 'voltrex-radar__blip--trade'
                            )}
                            style={{
                                left: `${left.toFixed(1)}%`,
                                top: `${top.toFixed(1)}%`,
                                opacity: 0.45 + Math.min(1, strength / 100) * 0.55,
                                width: `${0.7 + (strength / 100) * 0.9}rem`,
                                height: `${0.7 + (strength / 100) * 0.9}rem`,
                            }}
                        />
                    );
                })}
                <div className='voltrex-radar__core' />
            </div>

            <div className='voltrex-engine__body'>
                <div className='voltrex-engine__mode' aria-live='polite' data-testid='voltrex-engine-mode'>
                    <span className='voltrex-engine__pulse' />
                    {mode.label}
                </div>

                <div className='voltrex-engine__progress'>
                    <div className='voltrex-engine__bar' aria-hidden='true'>
                        <div className='voltrex-engine__bar-fill' style={{ width: `${percent}%` }} />
                    </div>
                    <span data-testid='voltrex-engine-progress'>
                        {localize('{{loaded}} / {{total}} markets scanned', { loaded, total })}
                    </span>
                </div>

                <div className='voltrex-engine__chips'>
                    <span className='voltrex__tone--buy'>▲ {summary.buy} BUY</span>
                    <span className='voltrex__tone--sell'>▼ {summary.sell} SELL</span>
                    <span className='voltrex__tone--neutral'>● {summary.neutral} NEUTRAL</span>
                </div>

                <p className='voltrex-engine__line' data-testid='voltrex-engine-auto'>
                    {auto === 'off' && localize('Auto-trading is off.')}
                    {auto === 'off' && !is_virtual && ` ${localize('(Demo accounts only.)')}`}
                    {auto !== 'off' && !scan && localize('Auto-trading started. Making the first scan…')}
                    {auto !== 'off' && scan && (
                        <>
                            {localize(
                                'Scan #{{scans}}: {{scope}} markets in scope, {{signals}} with a signal, {{qualified}} meet your limits.',
                                {
                                    scans: scan.scans,
                                    scope: scan.in_scope,
                                    signals: scan.signals,
                                    qualified: scan.qualified,
                                }
                            )}{' '}
                            {scan.closest &&
                                scan.qualified === 0 &&
                                localize('Closest: {{name}} {{direction}} {{strength}} (needs {{min}}).', {
                                    name: scan.closest.name,
                                    direction: scan.closest.direction,
                                    strength: scan.closest.strength,
                                    min: scan.min_strength,
                                })}{' '}
                            {scan.note}
                        </>
                    )}
                </p>

                <p className='voltrex-engine__trade' data-testid='voltrex-engine-trade'>
                    {tradeLine(trades[0])}
                </p>

                <ul
                    className='voltrex-engine__feed'
                    aria-label={localize('Latest activity')}
                    data-testid='voltrex-engine-feed'
                >
                    {feed.length === 0 && <li className='voltrex__muted'>› {localize('Waiting for activity…')}</li>}
                    {feed.map(entry => (
                        <li key={`${entry.time}-${entry.message}`} className={`voltrex-engine__feed-${entry.level}`}>
                            › {new Date(entry.time).toLocaleTimeString()} {entry.message}
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
};

export default VoltrexEngine;
