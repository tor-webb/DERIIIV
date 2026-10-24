import React from 'react';
import * as Blockly from 'blockly';
import classNames from 'classnames';

import { observer } from '@deriv/stores';
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

import './bot-builder.scss';

const AUTOSAVE_DELAY_MS = 400;

const BotBuilder = observer(() => {
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
                <button type='button' className='bot-builder__button bot-builder__button--primary' onClick={checkBot}>
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
                <button type='button' className='bot-builder__button' onClick={() => file_input_ref.current?.click()}>
                    {localize('Import')}
                </button>
                <button type='button' className='bot-builder__button' onClick={exportBot}>
                    {localize('Export')}
                </button>
                <button type='button' className='bot-builder__button' onClick={resetBot}>
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
            <div className='bot-builder__body'>
                <div className='bot-builder__workspace' ref={container_ref} data-testid='dt_bot_builder_workspace' />
                <aside className='bot-builder__journal' aria-label={localize('Journal')}>
                    <h2 className='bot-builder__journal-title'>{localize('Journal')}</h2>
                    {journal.length === 0 ? (
                        <p className='bot-builder__journal-empty'>
                            {localize('Build your bot, then press "Check bot" to validate it.')}
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
