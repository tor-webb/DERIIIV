import React from 'react';
import * as Blockly from 'blockly';
import classNames from 'classnames';

import { WS } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import { getToolbox, registerBlocks } from './blocks';
import {
    exportWorkspaceXml,
    formatTime,
    getDefaultWorkspaceState,
    loadParsedBot,
    loadWorkspaceState,
    parseBotFile,
    restoreWorkspace,
    saveWorkspaceToStorage,
    TJournalEntry,
    TJournalLevel,
    validateBot,
} from './bot-utils';
import { BotRunner, CompileError, compileProgram, createWsBotApi, TBotStats, TRunStatus, TTransaction } from './Engine';

import './bot-builder.scss';

const AUTOSAVE_DELAY_MS = 400;
const MAX_JOURNAL_ENTRIES = 200;
const MAX_TRANSACTIONS = 100;

type TPanelTab = 'summary' | 'transactions' | 'journal';

const EMPTY_STATS: TBotStats = { runs: 0, won: 0, lost: 0, total_profit: 0, total_stake: 0, total_payout: 0 };

const parseLimit = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const STATUS_TEXT: Record<TRunStatus, () => string> = {
    idle: () => localize('Bot is not running'),
    running: () => localize('Bot is running'),
    stopping: () => localize('Bot is stopping'),
    stopped: () => localize('Bot has stopped'),
};

const BotBuilder = observer(() => {
    const { client } = useStore();
    const runner_ref = React.useRef<BotRunner | null>(null);
    const container_ref = React.useRef<HTMLDivElement>(null);
    const workspace_ref = React.useRef<Blockly.WorkspaceSvg | null>(null);
    const file_input_ref = React.useRef<HTMLInputElement>(null);
    const entry_id_ref = React.useRef(0);

    const [run_status, setRunStatus] = React.useState<TRunStatus>('idle');
    const [stats, setStats] = React.useState<TBotStats>(EMPTY_STATS);
    const [max_trades, setMaxTrades] = React.useState('');
    const [max_loss, setMaxLoss] = React.useState('');
    const [needs_real_confirmation, setNeedsRealConfirmation] = React.useState(false);
    const [tab, setTab] = React.useState<TPanelTab>('summary');
    const [journal, setJournal] = React.useState<TJournalEntry[]>([]);
    const [transactions, setTransactions] = React.useState<TTransaction[]>([]);

    const log = React.useCallback((level: TJournalLevel, message: string) => {
        entry_id_ref.current += 1;
        const entry = { id: entry_id_ref.current, level, message, time: formatTime() };
        setJournal(previous => [entry, ...previous].slice(0, MAX_JOURNAL_ENTRIES));
    }, []);

    React.useEffect(() => {
        const container = container_ref.current;
        if (!container) return undefined;

        registerBlocks();
        const workspace = Blockly.inject(container, {
            toolbox: getToolbox(),
            trashcan: true,
            sounds: false,
            move: { scrollbars: true, drag: true, wheel: true },
            zoom: { controls: false, wheel: true, startScale: 0.9, minScale: 0.4, maxScale: 1.6, scaleSpeed: 1.2 },
            grid: { spacing: 24, length: 3, colour: '#d7dbe0', snap: true },
        });
        workspace_ref.current = workspace;

        Blockly.Events.disable();
        try {
            restoreWorkspace(workspace);
        } finally {
            Blockly.Events.enable();
        }

        let save_timeout: ReturnType<typeof setTimeout> | undefined;
        workspace.addChangeListener((event: Blockly.Events.Abstract) => {
            if (event.isUiEvent) return;
            clearTimeout(save_timeout);
            save_timeout = setTimeout(() => saveWorkspaceToStorage(workspace), AUTOSAVE_DELAY_MS);
        });

        const resize_observer =
            typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => Blockly.svgResize(workspace)) : null;
        resize_observer?.observe(container);

        return () => {
            clearTimeout(save_timeout);
            resize_observer?.disconnect();
            workspace.dispose();
            workspace_ref.current = null;
        };
    }, []);

    React.useEffect(() => () => runner_ref.current?.stop(), []);

    const is_active = run_status === 'running' || run_status === 'stopping';

    const upsertTransaction = React.useCallback((transaction: TTransaction) => {
        setTransactions(previous => {
            const index = previous.findIndex(item => item.contract_id === transaction.contract_id);
            if (index === -1) return [transaction, ...previous].slice(0, MAX_TRANSACTIONS);
            const next = [...previous];
            next[index] = transaction;
            return next;
        });
    }, []);

    const launchBot = () => {
        const workspace = workspace_ref.current;
        if (!workspace) return;
        setNeedsRealConfirmation(false);

        const issues = validateBot(workspace);
        issues.forEach(issue => issue.level === 'warn' && log(issue.level, issue.message));
        const errors = issues.filter(issue => issue.level === 'error');
        if (errors.length) {
            errors.forEach(issue => log(issue.level, issue.message));
            setTab('journal');
            return;
        }
        let program;
        try {
            program = compileProgram(workspace);
        } catch (error) {
            log('error', error instanceof CompileError ? error.message : localize('The bot could not be compiled.'));
            setTab('journal');
            return;
        }

        setTransactions([]);
        const runner = new BotRunner({
            api: createWsBotApi(WS),
            program,
            currency: client.currency,
            getBalance: () => Number(client.balance) || 0,
            limits: { max_trades: parseLimit(max_trades), max_loss: parseLimit(max_loss) },
            onLog: log,
            onStats: setStats,
            onStatus: setRunStatus,
            onTransaction: upsertTransaction,
        });
        runner_ref.current = runner;
        runner.start();
    };

    const runBot = () => {
        if (!client.is_logged_in) {
            log('error', localize('Log in to run a bot.'));
            setTab('journal');
            return;
        }
        if (!client.is_virtual) {
            // a real account needs a loss limit so a bad bot cannot keep trading
            if (!parseLimit(max_loss)) {
                log('error', localize('Set a "Stop at total loss" limit before running a bot on a real account.'));
                setTab('summary');
                return;
            }
            setNeedsRealConfirmation(true);
            return;
        }
        launchBot();
    };

    const stopBot = () => runner_ref.current?.stop(localize('Stop requested.'));

    const checkBot = () => {
        const workspace = workspace_ref.current;
        if (!workspace) return;
        setTab('journal');
        const issues = validateBot(workspace);
        if (!issues.length) {
            log('success', localize('Bot structure looks good.'));
            return;
        }
        issues.forEach(issue => log(issue.level, issue.message));
    };

    const resetBot = () => {
        const workspace = workspace_ref.current;
        if (!workspace) return;
        loadWorkspaceState(workspace, getDefaultWorkspaceState());
        saveWorkspaceToStorage(workspace);
        log('info', localize('Workspace reset to the starter bot.'));
    };

    const saveBot = () => {
        const workspace = workspace_ref.current;
        if (!workspace) return;
        const blob = new Blob([exportWorkspaceXml(workspace)], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'my-bot.xml';
        link.click();
        URL.revokeObjectURL(url);
        log('success', localize('Bot saved as my-bot.xml.'));
    };

    const importBot = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        const workspace = workspace_ref.current;
        if (!file || !workspace) return;

        setTab('journal');
        const parsed = parseBotFile(await file.text());
        if (!parsed.ok) {
            parsed.errors.forEach(message => log('error', message));
            return;
        }
        if (!loadParsedBot(workspace, parsed)) {
            log('error', localize('That file is not a valid bot.'));
            return;
        }
        saveWorkspaceToStorage(workspace);
        log('success', localize('Imported {{name}}.', { name: file.name }));
        validateBot(workspace).forEach(issue => log(issue.level, issue.message));
    };

    const sortBlocks = () => workspace_ref.current?.cleanUp();
    const setAllCollapsed = (collapsed: boolean) =>
        workspace_ref.current?.getTopBlocks(false).forEach(block => block.setCollapsed(collapsed));

    const statTiles = [
        { key: 'stake', label: localize('Total stake'), value: stats.total_stake.toFixed(2) },
        { key: 'payout', label: localize('Total payout'), value: stats.total_payout.toFixed(2) },
        { key: 'runs', label: localize('No. of runs'), value: String(stats.runs) },
        { key: 'lost', label: localize('Contracts lost'), value: String(stats.lost) },
        { key: 'won', label: localize('Contracts won'), value: String(stats.won) },
        { key: 'profit', label: localize('Total profit/loss'), value: stats.total_profit.toFixed(2) },
    ];

    return (
        <main className='bot-builder' data-testid='dt_bot_builder'>
            <div className='bot-builder__body'>
                <section className='bot-builder__stage'>
                    <div className='bot-builder__toolbar' role='toolbar' aria-label={localize('Bot builder actions')}>
                        <button type='button' className='bot-builder__tool' disabled={is_active} onClick={resetBot}>
                            {localize('Reset')}
                        </button>
                        <button
                            type='button'
                            className='bot-builder__tool'
                            disabled={is_active}
                            onClick={() => file_input_ref.current?.click()}
                        >
                            {localize('Import')}
                        </button>
                        <button type='button' className='bot-builder__tool' onClick={saveBot}>
                            {localize('Save')}
                        </button>
                        <span className='bot-builder__tool-divider' />
                        <button
                            type='button'
                            className='bot-builder__tool'
                            aria-label={localize('Undo')}
                            onClick={() => workspace_ref.current?.undo(false)}
                        >
                            {localize('Undo')}
                        </button>
                        <button
                            type='button'
                            className='bot-builder__tool'
                            aria-label={localize('Redo')}
                            onClick={() => workspace_ref.current?.undo(true)}
                        >
                            {localize('Redo')}
                        </button>
                        <span className='bot-builder__tool-divider' />
                        <button
                            type='button'
                            className='bot-builder__tool bot-builder__tool--icon'
                            aria-label={localize('Zoom out')}
                            onClick={() => workspace_ref.current?.zoomCenter(-1)}
                        >
                            −
                        </button>
                        <button
                            type='button'
                            className='bot-builder__tool bot-builder__tool--icon'
                            aria-label={localize('Zoom in')}
                            onClick={() => workspace_ref.current?.zoomCenter(1)}
                        >
                            +
                        </button>
                        <button type='button' className='bot-builder__tool' onClick={sortBlocks}>
                            {localize('Sort blocks')}
                        </button>
                        <button type='button' className='bot-builder__tool' onClick={() => setAllCollapsed(true)}>
                            {localize('Collapse')}
                        </button>
                        <button type='button' className='bot-builder__tool' onClick={() => setAllCollapsed(false)}>
                            {localize('Expand')}
                        </button>
                        <span className='bot-builder__spacer' />
                        <button type='button' className='bot-builder__tool' onClick={checkBot}>
                            {localize('Check bot')}
                        </button>
                        <input
                            ref={file_input_ref}
                            type='file'
                            accept='.xml,.json,application/xml,text/xml,application/json'
                            hidden
                            data-testid='dt_bot_builder_import'
                            onChange={importBot}
                        />
                    </div>
                    <div
                        className='bot-builder__workspace'
                        ref={container_ref}
                        data-testid='dt_bot_builder_workspace'
                    />
                </section>

                <aside className='bot-builder__panel' aria-label={localize('Run panel')}>
                    <div className='bot-builder__tabs' role='tablist'>
                        {(['summary', 'transactions', 'journal'] as TPanelTab[]).map(name => (
                            <button
                                key={name}
                                type='button'
                                role='tab'
                                aria-selected={tab === name}
                                className={classNames('bot-builder__tab', { 'bot-builder__tab--active': tab === name })}
                                onClick={() => setTab(name)}
                            >
                                {name === 'summary' && localize('Summary')}
                                {name === 'transactions' && localize('Transactions')}
                                {name === 'journal' && localize('Journal')}
                            </button>
                        ))}
                    </div>

                    {tab === 'summary' && (
                        <div className='bot-builder__tab-body'>
                            <dl className='bot-builder__stats' data-testid='dt_bot_builder_stats'>
                                {statTiles.map(({ key, label, value }) => (
                                    <div key={key} className='bot-builder__stat'>
                                        <dt>{label}</dt>
                                        <dd
                                            className={classNames({
                                                'bot-builder__stat--up': key === 'profit' && stats.total_profit > 0,
                                                'bot-builder__stat--down': key === 'profit' && stats.total_profit < 0,
                                            })}
                                        >
                                            {value}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                            <div className='bot-builder__limits'>
                                <label>
                                    {localize('Stop after trades')}
                                    <input
                                        type='number'
                                        min='1'
                                        value={max_trades}
                                        disabled={is_active}
                                        placeholder={localize('No limit')}
                                        onChange={event => setMaxTrades(event.target.value)}
                                    />
                                </label>
                                <label>
                                    {localize('Stop at total loss')}
                                    <input
                                        type='number'
                                        min='0'
                                        value={max_loss}
                                        disabled={is_active}
                                        placeholder={localize('No limit')}
                                        onChange={event => setMaxLoss(event.target.value)}
                                    />
                                </label>
                            </div>
                        </div>
                    )}

                    {tab === 'transactions' && (
                        <div className='bot-builder__tab-body' data-testid='dt_bot_builder_transactions'>
                            {transactions.length === 0 ? (
                                <p className='bot-builder__empty'>{localize('Contracts the bot buys appear here.')}</p>
                            ) : (
                                <table className='bot-builder__table'>
                                    <thead>
                                        <tr>
                                            <th>{localize('Contract')}</th>
                                            <th>{localize('Stake')}</th>
                                            <th>{localize('Profit/loss')}</th>
                                            <th>{localize('Status')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {transactions.map(item => (
                                            <tr key={item.contract_id}>
                                                <td>{item.contract_type}</td>
                                                <td>{item.buy_price.toFixed(2)}</td>
                                                <td
                                                    className={classNames({
                                                        'bot-builder__stat--up': item.status === 'won',
                                                        'bot-builder__stat--down': item.status === 'lost',
                                                    })}
                                                >
                                                    {item.status === 'open' ? '—' : item.profit.toFixed(2)}
                                                </td>
                                                <td>
                                                    {item.status === 'open' && localize('Open')}
                                                    {item.status === 'won' && localize('Won')}
                                                    {item.status === 'lost' && localize('Lost')}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}

                    {tab === 'journal' && (
                        <div className='bot-builder__tab-body'>
                            {journal.length === 0 ? (
                                <p className='bot-builder__empty'>
                                    {localize(
                                        'Build your bot, then press "Run". "Check bot" validates it without trading.'
                                    )}
                                </p>
                            ) : (
                                <ul className='bot-builder__journal-list'>
                                    {journal.map(entry => (
                                        <li
                                            key={entry.id}
                                            className={classNames(
                                                'bot-builder__journal-entry',
                                                `bot-builder__journal-entry--${entry.level}`
                                            )}
                                        >
                                            <span className='bot-builder__journal-time'>{entry.time}</span>
                                            <span>{entry.message}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </aside>
            </div>

            {needs_real_confirmation && (
                <div className='bot-builder__confirm' role='alertdialog' data-testid='dt_bot_builder_confirm'>
                    <p className='bot-builder__confirm-text'>
                        {localize(
                            'This bot will trade with real money on account {{loginid}} (balance {{balance}} {{currency}}). You can lose your stake on every trade.',
                            { loginid: client.loginid, balance: client.balance, currency: client.currency }
                        )}
                    </p>
                    <div className='bot-builder__confirm-actions'>
                        <button
                            type='button'
                            className='bot-builder__button bot-builder__button--danger'
                            onClick={launchBot}
                        >
                            {localize('Run with real money')}
                        </button>
                        <button
                            type='button'
                            className='bot-builder__button'
                            onClick={() => setNeedsRealConfirmation(false)}
                        >
                            {localize('Cancel')}
                        </button>
                    </div>
                </div>
            )}

            <footer className='bot-builder__footer'>
                <span className='bot-builder__status' data-testid='dt_bot_builder_status'>
                    <span
                        className={classNames('bot-builder__dot', { 'bot-builder__dot--on': run_status === 'running' })}
                    />
                    {STATUS_TEXT[run_status]()}
                </span>
                <span className='bot-builder__spacer' />
                {client.is_logged_in && (
                    <span
                        className={classNames('bot-builder__account', {
                            'bot-builder__account--real': !client.is_virtual,
                        })}
                        data-testid='dt_bot_builder_account'
                    >
                        {client.is_virtual ? localize('Demo account') : localize('Real account')} · {client.loginid}
                    </span>
                )}
                {is_active ? (
                    <button
                        type='button'
                        className='bot-builder__button bot-builder__button--danger'
                        onClick={stopBot}
                        disabled={run_status === 'stopping'}
                    >
                        {run_status === 'stopping' ? localize('Stopping…') : localize('Stop')}
                    </button>
                ) : (
                    <button type='button' className='bot-builder__button bot-builder__button--primary' onClick={runBot}>
                        {localize('Run')}
                    </button>
                )}
            </footer>
        </main>
    );
});

export default BotBuilder;
