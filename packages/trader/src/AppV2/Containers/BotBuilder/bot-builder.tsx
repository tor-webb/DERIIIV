import React from 'react';
import * as Blockly from 'blockly';
import classNames from 'classnames';

import { WS } from '@deriv/shared';
import { observer, useStore } from '@deriv/stores';
import { localize } from '@deriv-com/translations';

import { getBlocklyTheme, getToolbox, registerBlocks } from './blocks';
import { findBotMarket } from './bot-markets';
import {
    exportWorkspaceXml,
    formatTime,
    getDefaultWorkspaceState,
    loadParsedBot,
    loadWorkspaceState,
    parseBotFile,
    restoreWorkspace,
    saveWorkspaceToStorage,
    scanState,
    TJournalEntry,
    TJournalLevel,
    validateBot,
} from './bot-utils';
import {
    BotRunner,
    CompileError,
    compileProgram,
    createWsBotApi,
    TBotStats,
    TLiveContract,
    TRunStatus,
    TTransaction,
} from './Engine';
import RunPanel, { TPanelTab, TRunLimitsInput } from './run-panel';
import SaveTemplateDialog from './save-template-dialog';
import {
    cleanSavedBotName,
    deleteSavedBot,
    MAX_SAVED_BOTS,
    readPreviousBot,
    readSavedBots,
    saveBotAsTemplate,
    TSavedBot,
    writePreviousBot,
} from './saved-bots';
import { TBotTemplate } from './templates';
import TemplatesPanel from './templates-panel';

import './bot-builder.scss';

const AUTOSAVE_DELAY_MS = 400;
const MAX_JOURNAL_ENTRIES = 200;
const MAX_TRANSACTIONS = 100;

const EMPTY_STATS: TBotStats = { runs: 0, won: 0, lost: 0, total_profit: 0, total_stake: 0, total_payout: 0 };

const EMPTY_LIMITS: TRunLimitsInput = { max_trades: '', max_profit: '', max_loss: '', max_stake: '' };

/**
 * The bot's "prompt for number/text" blocks. A browser prompt is the simplest thing that works and is what Deriv Bot
 * does. Cancelling stops the bot. A number question is asked again, up to three times, until the answer is a number.
 */
const askUser = (message: string, kind: 'NUMBER' | 'TEXT'): number | string => {
    const attempts = kind === 'NUMBER' ? 3 : 1;
    let question = message;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const answer = window.prompt(question);
        if (answer === null) throw new Error(localize('The bot stopped because a question was cancelled.'));
        if (kind === 'TEXT') return answer;
        if (answer.trim() !== '' && Number.isFinite(Number(answer))) return Number(answer);
        question = localize('Please enter a number. {{question}}', { question: message });
    }
    throw new Error(localize('The bot stopped because no number was entered.'));
};

/** The Markets page opens Bot Builder with `?market=SYMBOL`. Only a market that Bot Builder can trade is accepted. */
const readMarketParam = () => findBotMarket(new URLSearchParams(window.location.search).get('market'));

const dropMarketParam = () => {
    try {
        const url = new URL(window.location.href);
        if (!url.searchParams.has('market')) return;
        url.searchParams.delete('market');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
        // the address bar is only cosmetic here
    }
};

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
    /** The bot that a template replaced, kept so the person can bring it back. */
    const previous_bot_ref = React.useRef<Record<string, unknown> | null>(null);

    const [run_status, setRunStatus] = React.useState<TRunStatus>('idle');
    const [stats, setStats] = React.useState<TBotStats>(EMPTY_STATS);
    const [limits, setLimits] = React.useState<TRunLimitsInput>(EMPTY_LIMITS);
    const [live, setLive] = React.useState<TLiveContract | null>(null);
    const [needs_real_confirmation, setNeedsRealConfirmation] = React.useState(false);
    const [tab, setTab] = React.useState<TPanelTab>('summary');
    const [journal, setJournal] = React.useState<TJournalEntry[]>([]);
    const [transactions, setTransactions] = React.useState<TTransaction[]>([]);
    const [initial_market] = React.useState(readMarketParam);
    const [chosen_market, setChosenMarket] = React.useState(initial_market);
    const [is_templates_open, setIsTemplatesOpen] = React.useState(Boolean(initial_market));
    const [can_restore, setCanRestore] = React.useState(false);
    const [saved_bots, setSavedBots] = React.useState<TSavedBot[]>(readSavedBots);
    const [is_save_open, setIsSaveOpen] = React.useState(false);

    // A bot that a template replaced before the page was reloaded can still be brought back.
    React.useEffect(() => {
        const previous = readPreviousBot();
        if (!previous) return;
        previous_bot_ref.current = previous;
        setCanRestore(true);
    }, []);

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
            theme: getBlocklyTheme(),
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
        setLive(null);
        const max_loss = parseLimit(limits.max_loss);
        const max_profit = parseLimit(limits.max_profit);
        const runner = new BotRunner({
            api: createWsBotApi(WS),
            program,
            currency: client.currency,
            getBalance: () => Number(client.balance) || 0,
            limits: {
                max_trades: parseLimit(limits.max_trades),
                max_stake: parseLimit(limits.max_stake),
                max_loss,
                max_profit,
                // with a take profit or stop loss the bot keeps trading until one of them is hit
                keep_running: Boolean(max_loss || max_profit),
            },
            onLog: log,
            onStats: setStats,
            onStatus: setRunStatus,
            onTransaction: upsertTransaction,
            onLiveContract: setLive,
            prompt: askUser,
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
            if (!parseLimit(limits.max_loss)) {
                log('error', localize('Set a "Stop loss" limit before running a bot on a real account.'));
                setTab('summary');
                return;
            }
            // and a stake cap, so a growing stake or a typo in a block cannot size a trade past what was chosen
            if (!parseLimit(limits.max_stake)) {
                log('error', localize('Set a "Max stake per trade" limit before running a bot on a real account.'));
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

    /**
     * Replaces the bot on the workspace with one from a template or the saved list. The text goes through the same
     * scan and loader as a file, and the bot it replaces is kept (also across a reload) so it can be brought back.
     */
    const replaceBotWith = (xml: string, name: string, failure: string) => {
        const workspace = workspace_ref.current;
        if (!workspace || is_active) return;

        setTab('journal');
        const parsed = parseBotFile(xml);
        if (!parsed.ok) {
            parsed.errors.forEach(message => log('error', message));
            return;
        }
        const backup = Blockly.serialization.workspaces.save(workspace);
        if (!loadParsedBot(workspace, parsed)) {
            log('error', failure);
            return;
        }
        previous_bot_ref.current = backup;
        writePreviousBot(backup);
        setCanRestore(true);
        setIsTemplatesOpen(false);
        dropMarketParam();
        saveWorkspaceToStorage(workspace);
        log(
            'success',
            localize('Loaded the "{{name}}" template. Open Templates to bring your old bot back.', { name })
        );
        validateBot(workspace).forEach(issue => log(issue.level, issue.message));
    };

    const importTemplate = (template: TBotTemplate) =>
        replaceBotWith(template.xml, template.name, localize('That template could not be loaded.'));

    const importSavedBot = (bot: TSavedBot) =>
        replaceBotWith(bot.xml, bot.name, localize('That saved bot could not be loaded.'));

    const deleteSaved = (id: string) => {
        const name = saved_bots.find(bot => bot.id === id)?.name ?? '';
        setSavedBots(deleteSavedBot(id));
        setTab('journal');
        log('info', localize('Deleted "{{name}}" from your saved bots.', { name }));
    };

    const saveAsTemplate = (name: string) => {
        const workspace = workspace_ref.current;
        if (!workspace) return;

        setTab('journal');
        const xml = exportWorkspaceXml(workspace);
        // a bot that the importer would refuse is not worth keeping: it could never be loaded again
        const check = parseBotFile(xml);
        if (!check.ok) {
            check.errors.forEach(message => log('error', message));
            return;
        }
        const result = saveBotAsTemplate(name, xml);
        if (!result.ok) {
            const reasons = {
                empty_name: localize('Give the bot a name first.'),
                too_large: localize('This bot is too large to keep as a template.'),
                full: localize('You can keep up to {{max}} bots. Delete one in Templates to make room.', {
                    max: MAX_SAVED_BOTS,
                }),
                storage: localize('This browser would not store the bot (private mode or no space left).'),
            };
            log('error', reasons[result.reason]);
            return;
        }
        setSavedBots(result.bots);
        setIsSaveOpen(false);
        log(
            'success',
            result.replaced
                ? localize('Replaced "{{name}}" in your saved bots.', { name: cleanSavedBotName(name) })
                : localize('Saved "{{name}}" to your templates.', { name: cleanSavedBotName(name) })
        );
    };

    const restorePreviousBot = () => {
        const workspace = workspace_ref.current;
        const previous = previous_bot_ref.current;
        if (!workspace || !previous || is_active) return;
        setTab('journal');
        // it may have been read back from storage, so it is scanned like any other bot before it is loaded
        if (scanState(previous).errors.length) {
            previous_bot_ref.current = null;
            writePreviousBot(null);
            setCanRestore(false);
            log('error', localize('Your previous bot could not be restored.'));
            return;
        }
        loadWorkspaceState(workspace, previous);
        saveWorkspaceToStorage(workspace);
        previous_bot_ref.current = null;
        writePreviousBot(null);
        setCanRestore(false);
        setIsTemplatesOpen(false);
        log('info', localize('Your previous bot is back.'));
    };

    const resetStats = () => {
        setStats(EMPTY_STATS);
        setTransactions([]);
        setLive(null);
    };

    const sortBlocks = () => workspace_ref.current?.cleanUp();
    const setAllCollapsed = (collapsed: boolean) =>
        workspace_ref.current?.getTopBlocks(false).forEach(block => block.setCollapsed(collapsed));

    return (
        <main className='bot-builder' data-testid='dt_bot_builder'>
            {is_active && client.is_logged_in && !client.is_virtual && (
                <p className='bot-builder__real-banner' role='alert' data-testid='dt_bot_builder_real_banner'>
                    {run_status === 'stopping'
                        ? localize(
                              'REAL MONEY: the bot is stopping on account {{loginid}}. An open contract is still running.',
                              { loginid: client.loginid }
                          )
                        : localize('REAL MONEY: this bot is trading on account {{loginid}}. Press Stop to end it.', {
                              loginid: client.loginid,
                          })}
                </p>
            )}
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
                        <button
                            type='button'
                            className='bot-builder__tool'
                            aria-expanded={is_templates_open}
                            data-testid='dt_bot_builder_templates_toggle'
                            onClick={() => setIsTemplatesOpen(open => !open)}
                        >
                            {localize('Templates')}
                        </button>
                        <button
                            type='button'
                            className='bot-builder__tool'
                            aria-expanded={is_save_open}
                            data-testid='dt_bot_builder_save_template'
                            onClick={() => setIsSaveOpen(open => !open)}
                        >
                            {localize('Save as template')}
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
                    {is_save_open && (
                        <SaveTemplateDialog onSave={saveAsTemplate} onCancel={() => setIsSaveOpen(false)} />
                    )}
                    <div
                        className='bot-builder__workspace'
                        ref={container_ref}
                        data-testid='dt_bot_builder_workspace'
                    />
                </section>

                <RunPanel
                    tab={tab}
                    onTabChange={setTab}
                    stats={stats}
                    live={live}
                    transactions={transactions}
                    journal={journal}
                    currency={client.currency}
                    is_active={is_active}
                    limits={limits}
                    onLimitsChange={setLimits}
                    onReset={resetStats}
                />

                {is_templates_open && (
                    <TemplatesPanel
                        is_disabled={is_active}
                        can_restore={can_restore}
                        market={chosen_market}
                        onClearMarket={() => {
                            setChosenMarket(null);
                            dropMarketParam();
                        }}
                        onImport={importTemplate}
                        saved_bots={saved_bots}
                        onImportSaved={importSavedBot}
                        onDeleteSaved={deleteSaved}
                        onRestore={restorePreviousBot}
                        onClose={() => {
                            setIsTemplatesOpen(false);
                            dropMarketParam();
                        }}
                    />
                )}
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
                <div className='bot-builder__runbar'>
                    {is_active ? (
                        <button
                            type='button'
                            className='bot-builder__runbar-button bot-builder__runbar-button--stop'
                            onClick={stopBot}
                            disabled={run_status === 'stopping'}
                        >
                            <span className='bot-builder__runbar-icon bot-builder__runbar-icon--stop' aria-hidden />
                            {run_status === 'stopping' ? localize('Stopping…') : localize('Stop')}
                        </button>
                    ) : (
                        <button
                            type='button'
                            className='bot-builder__runbar-button bot-builder__runbar-button--run'
                            onClick={runBot}
                        >
                            <span className='bot-builder__runbar-icon bot-builder__runbar-icon--run' aria-hidden />
                            {localize('Run')}
                        </button>
                    )}
                    <div className='bot-builder__runbar-status' data-testid='dt_bot_builder_status'>
                        <span className='bot-builder__runbar-text'>
                            {live && run_status === 'running' ? localize('Contract bought') : STATUS_TEXT[run_status]()}
                        </span>
                        <span
                            className={classNames('bot-builder__runbar-progress', {
                                'bot-builder__runbar-progress--on': run_status === 'running',
                            })}
                            aria-hidden
                        />
                    </div>
                </div>
            </footer>
        </main>
    );
});

export default BotBuilder;
