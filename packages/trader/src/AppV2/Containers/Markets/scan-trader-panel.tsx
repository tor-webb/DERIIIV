import React from 'react';
import classNames from 'classnames';

import { WS } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import type { TLevel } from '../BotBuilder/Engine/types';
import { createWsBotApi } from '../BotBuilder/Engine/ws-adapter';

import type { TScanFilters } from './markets-scanner';
import type { TMarketRow } from './markets-utils';
import type { ScanTrader, TScanTraderState } from './scan-trader';
import {
    DEFAULT_AUTO,
    emptySession,
    hasSignalFilter,
    MAX_TRADES_ALLOWED,
    MIN_COOLDOWN_SECONDS,
    pickEntry,
    TAutoSettings,
    TScanSession,
    TTradeSide,
    validateAuto,
} from './scan-trader-logic';

import './scan-trader-panel.scss';

type TScanTraderPanelProps = {
    rows: TMarketRow[];
    filters: TScanFilters;
    window_text: string;
    /** Opens the Trade page on a market, for placing a trade by hand. */
    onTrade: (symbol: string) => void;
};

type TLogLine = { id: number; level: TLevel; text: string };

const MAX_LOG_LINES = 30;
const SHOWN_LOG_LINES = 8;

const numberOf = (text: string) => (text.trim() === '' ? NaN : Number(text));

const ScanTraderPanel = observer(({ rows, filters, window_text, onTrade }: TScanTraderPanelProps) => {
    const { client } = useStore();
    const { is_logged_in, is_virtual, currency } = client;

    const [side, setSide] = React.useState<TTradeSide>(DEFAULT_AUTO.side);
    const [stake, setStake] = React.useState(String(DEFAULT_AUTO.stake));
    const [max_trades, setMaxTrades] = React.useState(String(DEFAULT_AUTO.max_trades));
    const [max_loss, setMaxLoss] = React.useState(String(DEFAULT_AUTO.max_loss));
    const [max_profit, setMaxProfit] = React.useState('');
    const [cooldown, setCooldown] = React.useState(String(DEFAULT_AUTO.cooldown_seconds));
    const [run_state, setRunState] = React.useState<TScanTraderState>('stopped');
    const [session, setSession] = React.useState<TScanSession>(emptySession);
    const [lines, setLines] = React.useState<TLogLine[]>([]);

    const trader_ref = React.useRef<ScanTrader | null>(null);
    const rows_ref = React.useRef(rows);
    const filters_ref = React.useRef(filters);
    const line_id = React.useRef(0);
    rows_ref.current = rows;
    filters_ref.current = filters;

    const settings: TAutoSettings = {
        side,
        stake: numberOf(stake),
        max_trades: numberOf(max_trades),
        max_loss: numberOf(max_loss),
        max_profit: max_profit.trim() === '' ? 0 : numberOf(max_profit),
        cooldown_seconds: numberOf(cooldown),
    };
    const problem = validateAuto(settings);
    const has_signal = hasSignalFilter(filters);
    const top = React.useMemo(() => pickEntry(rows, filters, side), [rows, filters, side]);
    const is_running = run_state !== 'stopped';

    const addLine = React.useCallback((level: TLevel, text: string) => {
        line_id.current += 1;
        const id = line_id.current;
        setLines(previous => [...previous.slice(-(MAX_LOG_LINES - 1)), { id, level, text }]);
    }, []);

    // every new set of prices is a chance for the running trader to act
    React.useEffect(() => {
        trader_ref.current?.poke();
    }, [rows, filters]);

    // leaving the page, or switching to a real account, must never leave a trader running
    React.useEffect(() => {
        if (is_running && (!is_logged_in || !is_virtual)) trader_ref.current?.stop();
    }, [is_running, is_logged_in, is_virtual]);
    React.useEffect(
        () => () => {
            trader_ref.current?.stop();
        },
        []
    );

    const startAuto = async () => {
        if (is_running || problem || !is_virtual) return;
        const { ScanTrader: Trader } = await import('./scan-trader');
        const trader = new Trader({
            api: createWsBotApi(WS),
            currency,
            is_virtual: Boolean(is_virtual),
            getBalance: () => Number(client.balance) || 0,
            getRows: () => rows_ref.current,
            getFilters: () => filters_ref.current,
            settings,
            onLog: addLine,
            onState: (state, current) => {
                setRunState(state);
                setSession(current);
            },
        });
        trader_ref.current = trader;
        trader.start();
    };

    const stopAuto = () => trader_ref.current?.stop(localize('Stop requested.'));

    let status_text = localize('Auto-trading is off.');
    if (run_state === 'watching') status_text = localize('Watching the scanner for a match…');
    else if (run_state === 'trading') status_text = localize('A trade is open or being placed.');
    else if (run_state === 'stopping') status_text = localize('Stopping once the open trade finishes.');

    const top_text = top
        ? localize('{{name}}: {{change}}% over the last {{window}}', {
              name: top.name,
              change: `${top.change_pct > 0 ? '+' : '−'}${Math.abs(top.change_pct).toFixed(2)}`,
              window: window_text,
          })
        : '';

    return (
        <section className='scan-trader' aria-label={localize('Trade from the scan')} data-testid='dt_scan_trader'>
            <h3 className='scan-trader__title'>{localize('Trade from the scan')}</h3>

            <div className='scan-trader__top' data-testid='dt_scan_trader_top'>
                {!has_signal && (
                    <p className='scan-trader__text'>
                        {localize('Switch on a filter above (other than open markets only) to see the top match.')}
                    </p>
                )}
                {has_signal && !top && (
                    <p className='scan-trader__text'>
                        {localize('No market that Bot Builder can trade matches the filters right now.')}
                    </p>
                )}
                {top && (
                    <>
                        <p className='scan-trader__text'>
                            <strong>{localize('Top match')}</strong> · {top_text}
                        </p>
                        <button
                            type='button'
                            className='scan-trader__button'
                            data-testid='dt_scan_trader_trade'
                            onClick={() => onTrade(top.symbol)}
                        >
                            {localize('Trade {{name}} yourself', { name: top.name })}
                        </button>
                    </>
                )}
            </div>

            <h4 className='scan-trader__subtitle'>{localize('Auto-trade (demo accounts only)')}</h4>
            <p className='scan-trader__text'>
                {localize(
                    'When a market matches your filters, this places one demo trade of your stake on it, waits, and repeats until a limit below is reached. You choose whether to trade with the move or against it. The scan shows what a market already did, not what it will do, so either choice can lose the stake. Real-money auto-trading is switched off.'
                )}
            </p>

            {!is_logged_in && (
                <p className='scan-trader__notice' data-testid='dt_scan_trader_login'>
                    {localize('Log in with a demo account to use auto-trade.')}
                </p>
            )}
            {is_logged_in && !is_virtual && (
                <p className='scan-trader__notice' role='alert' data-testid='dt_scan_trader_real'>
                    {localize(
                        'You are on a real account, so auto-trade is off. Switch to a demo account to use it, or place a trade yourself with the Trade button.'
                    )}
                </p>
            )}

            {is_logged_in && is_virtual && (
                <>
                    <div className='scan-trader__fields'>
                        <div className='scan-trader__group' role='group' aria-label={localize('Trade direction')}>
                            <span className='scan-trader__label'>{localize('Trade')}</span>
                            {(['with', 'against'] as TTradeSide[]).map(option => (
                                <button
                                    key={option}
                                    type='button'
                                    disabled={is_running}
                                    className={classNames('scan-trader__pill', {
                                        'scan-trader__pill--active': side === option,
                                    })}
                                    aria-pressed={side === option}
                                    data-testid={`dt_scan_trader_side_${option}`}
                                    onClick={() => setSide(option)}
                                >
                                    {option === 'with' ? localize('With the move') : localize('Against the move')}
                                </button>
                            ))}
                        </div>
                        {[
                            ['stake', localize('Stake ({{currency}})', { currency }), stake, setStake, '0.01'],
                            ['trades', localize('Max trades'), max_trades, setMaxTrades, '1'],
                            ['loss', localize('Stop loss ({{currency}})', { currency }), max_loss, setMaxLoss, '0.01'],
                            [
                                'profit',
                                localize('Take profit ({{currency}}, optional)', { currency }),
                                max_profit,
                                setMaxProfit,
                                '0.01',
                            ],
                            ['wait', localize('Seconds between trades'), cooldown, setCooldown, '1'],
                        ].map(([id, label, value, setValue, step]) => (
                            <label key={id as string} className='scan-trader__field'>
                                <span>{label as string}</span>
                                <input
                                    type='number'
                                    inputMode='decimal'
                                    min={0}
                                    step={step as string}
                                    value={value as string}
                                    disabled={is_running}
                                    data-testid={`dt_scan_trader_${id}`}
                                    onChange={event => (setValue as (text: string) => void)(event.target.value)}
                                />
                            </label>
                        ))}
                    </div>
                    <p className='scan-trader__hint'>
                        {localize(
                            'Each trade is a Rise/Fall contract: 5 ticks on Derived indices, 5 minutes on forex. Up to {{max}} trades, at least {{seconds}} seconds apart. The stake is also the most any single trade can cost.',
                            { max: MAX_TRADES_ALLOWED, seconds: MIN_COOLDOWN_SECONDS }
                        )}
                    </p>
                    {problem && !is_running && (
                        <p className='scan-trader__notice' data-testid='dt_scan_trader_problem'>
                            {problem}
                        </p>
                    )}

                    <div className='scan-trader__actions'>
                        {!is_running ? (
                            <button
                                type='button'
                                className='scan-trader__button'
                                disabled={Boolean(problem) || !has_signal}
                                data-testid='dt_scan_trader_start'
                                onClick={startAuto}
                            >
                                {localize('Start auto-trade')}
                            </button>
                        ) : (
                            <button
                                type='button'
                                className='scan-trader__button scan-trader__button--stop'
                                disabled={run_state === 'stopping'}
                                data-testid='dt_scan_trader_stop'
                                onClick={stopAuto}
                            >
                                {localize('Stop')}
                            </button>
                        )}
                        <span className='scan-trader__status' role='status' data-testid='dt_scan_trader_status'>
                            {status_text}
                        </span>
                    </div>

                    <p className='scan-trader__session' data-testid='dt_scan_trader_session'>
                        {localize(
                            'This session: {{runs}} trades, {{won}} won, {{lost}} lost, {{profit}} {{currency}}',
                            {
                                runs: session.runs,
                                won: session.won,
                                lost: session.lost,
                                profit: session.total_profit.toFixed(2),
                                currency,
                            }
                        )}
                    </p>

                    {lines.length > 0 && (
                        <ul
                            className='scan-trader__log'
                            aria-label={localize('Auto-trade messages')}
                            data-testid='dt_scan_trader_log'
                        >
                            {lines.slice(-SHOWN_LOG_LINES).map(line => (
                                <li key={line.id} className={`scan-trader__line scan-trader__line--${line.level}`}>
                                    {line.text}
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </section>
    );
});

export default ScanTraderPanel;
