import React from 'react';
import * as Blockly from 'blockly';
import classNames from 'classnames';

import { WS } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import { getToolbox, registerBlocks } from './blocks';
import {
    formatTime,
    getDefaultWorkspaceState,
    loadWorkspaceState,
    parseWorkspaceFile,
    readWorkspaceFromStorage,
    saveWorkspaceToStorage,
    serializeWorkspace,
    TJournalEntry,
    TJournalLevel,
    validateBot,
} from './bot-utils';
import { BotRunner, CompileError, compileProgram, createWsBotApi, TBotStats, TRunStatus } from './Engine';

import './bot-builder.scss';

const AUTOSAVE_DELAY_MS = 400;

const EMPTY_STATS: TBotStats = { runs: 0, won: 0, lost: 0, total_profit: 0, total_stake: 0 };

const parseLimit = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const BotBuilder = observer(() => {
    const { client } = useStore();
    const runner_ref = React.useRef<BotRunner | null>(null);
    const [run_status, setRunStatus] = React.useState<TRunStatus>('idle');
    const [stats, setStats] = React.useState<TBotStats>(EMPTY_STATS);
    const [max_trades, setMaxTrades] = React.useState('');
    const [max_loss, setMaxLoss] = React.useState('');
    const [needs_real_confirmation, setNeedsRealConfirmation] = React.useState(false);
    const container_ref = React.useRef<HTMLDivElement>(null);
    const workspace_ref = React.useRef<Blockly.WorkspaceSvg | null>(null);
    const file_input_ref = React.useRef<HTMLInputElement>(null);
    const entry_id_ref = React.useRef(0);
    const [journal, setJournal] = React.useState<TJournalEntry[]>([]);

    const log = React.useCallback((level: TJournalLevel, message: string) => {
        entry_id_ref.current += 1;
        const entry = { id: entry_id_ref.current, level, message, time: formatTime() };
        setJournal(previous => [entry, ...previous].slice(0, 200));
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
            zoom: { controls: true, wheel: true, startScale: 0.9, minScale: 0.4, maxScale: 1.6, scaleSpeed: 1.2 },
            grid: { spacing: 24, length: 3, colour: '#d7dbe0', snap: true },
        });
        workspace_ref.current = workspace;

        loadWorkspaceState(workspace, readWorkspaceFromStorage() ?? getDefaultWorkspaceState());

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

    const launchBot = () => {
        const workspace = workspace_ref.current;
        if (!workspace) return;
        setNeedsRealConfirmation(false);

        const errors = validateBot(workspace).filter(issue => issue.level === 'error');
        if (errors.length) {
            errors.forEach(issue => log(issue.level, issue.message));
            return;
        }
        let program;
        try {
            program = compileProgram(workspace);
        } catch (error) {
            log('error', error instanceof CompileError ? error.message : localize('The bot could not be compiled.'));
            return;
        }

        const runner = new BotRunner({
            api: createWsBotApi(WS),
            program,
            currency: client.currency,
            getBalance: () => Number(client.balance) || 0,
            limits: { max_trades: parseLimit(max_trades), max_loss: parseLimit(max_loss) },
            onLog: log,
            onStats: setStats,
            onStatus: setRunStatus,
        });
        runner_ref.current = runner;
        runner.start();
    };

    const runBot = () => {
        if (!client.is_logged_in) {
            log('error', localize('Log in to run a bot.'));
            return;
        }
        if (!client.is_virtual) {
            setNeedsRealConfirmation(true);
            return;
        }
        launchBot();
    };

    const stopBot = () => runner_ref.current?.stop(localize('Stop requested.'));

    const checkBot = () => {
        const workspace = workspace_ref.current;
        if (!workspace) return;
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

    const exportBot = () => {
        const workspace = workspace_ref.current;
        if (!workspace) return;
        const blob = new Blob([serializeWorkspace(workspace)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'my-bot.json';
        link.click();
        URL.revokeObjectURL(url);
        log('success', localize('Bot exported as my-bot.json.'));
    };

    const importBot = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        const workspace = workspace_ref.current;
        if (!file || !workspace) return;

        const state = parseWorkspaceFile(await file.text());
        if (!state) {
            log('error', localize('That file is not a valid bot.'));
            return;
        }
        try {
            loadWorkspaceState(workspace, state);
            saveWorkspaceToStorage(workspace);
            log('success', localize('Imported {{name}}.', { name: file.name }));
        } catch {
            log('error', localize('That file is not a valid bot.'));
        }
    };

    return (
        <main className='bot-builder' data-testid='dt_bot_builder'>
            <div className='bot-builder__toolbar' role='toolbar' aria-label={localize('Bot builder actions')}>
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
                <button type='button' className='bot-builder__button' onClick={checkBot}>
                    {localize('Check bot')}
                </button>
                <button
                    type='button'
                    className='bot-builder__button'
                    onClick={() => workspace_ref.current?.undo(false)}
                >
                    {localize('Undo')}
                </button>
                <button type='button' className='bot-builder__button' onClick={() => workspace_ref.current?.undo(true)}>
                    {localize('Redo')}
                </button>
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
                <button
                    type='button'
                    className='bot-builder__button'
                    disabled={is_active}
                    onClick={() => file_input_ref.current?.click()}
                >
                    {localize('Import')}
                </button>
                <button type='button' className='bot-builder__button' onClick={exportBot}>
                    {localize('Export')}
                </button>
                <button type='button' className='bot-builder__button' disabled={is_active} onClick={resetBot}>
                    {localize('Reset')}
                </button>
                <input
                    ref={file_input_ref}
                    type='file'
                    accept='application/json,.json'
                    hidden
                    data-testid='dt_bot_builder_import'
                    onChange={importBot}
                />
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
            <div className='bot-builder__body'>
                <div className='bot-builder__workspace' ref={container_ref} data-testid='dt_bot_builder_workspace' />
                <aside className='bot-builder__journal' aria-label={localize('Journal')}>
                    <h2 className='bot-builder__journal-title'>{localize('Summary')}</h2>
                    <dl className='bot-builder__stats' data-testid='dt_bot_builder_stats'>
                        <div>
                            <dt>{localize('Runs')}</dt>
                            <dd>{stats.runs}</dd>
                        </div>
                        <div>
                            <dt>{localize('Won')}</dt>
                            <dd>{stats.won}</dd>
                        </div>
                        <div>
                            <dt>{localize('Lost')}</dt>
                            <dd>{stats.lost}</dd>
                        </div>
                        <div>
                            <dt>{localize('Total profit')}</dt>
                            <dd
                                className={classNames({
                                    'bot-builder__stats-profit--up': stats.total_profit > 0,
                                    'bot-builder__stats-profit--down': stats.total_profit < 0,
                                })}
                            >
                                {stats.total_profit.toFixed(2)}
                            </dd>
                        </div>
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
                    <h2 className='bot-builder__journal-title'>{localize('Journal')}</h2>
                    {journal.length === 0 ? (
                        <p className='bot-builder__journal-empty'>
                            {localize('Build your bot, then press "Run". "Check bot" validates it without trading.')}
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
                </aside>
            </div>
        </main>
    );
});

export default BotBuilder;
