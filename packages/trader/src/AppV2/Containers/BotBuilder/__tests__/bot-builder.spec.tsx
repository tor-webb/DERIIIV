import { mockStore, StoreProvider } from '@deriv/stores';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import BotBuilder from '../bot-builder';
import {
    PREVIOUS_BOT_STORAGE_KEY,
    readPreviousBot,
    readSavedBots,
    saveBotAsTemplate,
    SAVED_BOTS_STORAGE_KEY,
} from '../saved-bots';

const mockWorkspace = {
    addChangeListener: jest.fn(),
    dispose: jest.fn(),
    undo: jest.fn(),
    zoomCenter: jest.fn(),
    cleanUp: jest.fn(),
    getTopBlocks: jest.fn(() => []),
};

jest.mock('blockly', () => ({
    inject: jest.fn(() => mockWorkspace),
    svgResize: jest.fn(),
    Events: { disable: jest.fn(), enable: jest.fn() },
    serialization: { workspaces: { save: jest.fn(() => ({ marker: 'old bot', blocks: { blocks: [] } })) } },
}));

jest.mock('../blocks', () => ({
    ...jest.requireActual('../blocks'),
    registerBlocks: jest.fn(),
    getToolbox: jest.fn(() => ({})),
    getBlocklyTheme: jest.fn(() => ({})),
}));

const mockValidate = jest.fn();
const mockLoadParsedBot = jest.fn(() => true);
const GOOD_XML = '<xml is_dbot="true"><block type="trade_definition"></block></xml>';
const mockExportXml = jest.fn(() => GOOD_XML);
jest.mock('../bot-utils', () => ({
    ...jest.requireActual('../bot-utils'),
    loadParsedBot: (...args: unknown[]) => (mockLoadParsedBot as (...a: unknown[]) => boolean)(...args),
    exportWorkspaceXml: () => mockExportXml(),
    loadWorkspaceState: jest.fn(),
    saveWorkspaceToStorage: jest.fn(),
    restoreWorkspace: jest.fn(),
    validateBot: (...args: unknown[]) => mockValidate(...args),
}));

jest.mock('@deriv-com/translations', () => ({
    // `@deriv/shared` renders <Localize> while it loads, so the mock has to provide it too
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const mockStart = jest.fn();
const mockStop = jest.fn();
const mockRunnerOptions = jest.fn();

jest.mock('../Engine', () => ({
    CompileError: class CompileError extends Error {},
    compileProgram: jest.fn(() => ({})),
    createWsBotApi: jest.fn(() => ({})),
    BotRunner: jest.fn().mockImplementation(options => {
        mockRunnerOptions(options);
        return { start: mockStart, stop: mockStop };
    }),
}));

const renderPage = (client: Record<string, unknown> = {}) =>
    render(
        <StoreProvider store={mockStore({ client })}>
            <BotBuilder />
        </StoreProvider>
    );

describe('BotBuilder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // saved bots and the replaced bot live in localStorage, so every test starts without them
        localStorage.clear();
        mockExportXml.mockReturnValue(GOOD_XML);
    });

    it('injects the Blockly workspace and disposes it on unmount', () => {
        const { unmount } = renderPage();
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        expect(require('blockly').inject).toHaveBeenCalledTimes(1);
        unmount();
        expect(mockWorkspace.dispose).toHaveBeenCalledTimes(1);
    });

    it('writes a success entry to the journal when the bot is valid', () => {
        mockValidate.mockReturnValue([]);
        renderPage();
        fireEvent.click(screen.getByText('Check bot'));
        expect(screen.getByText('Bot structure looks good.')).toBeInTheDocument();
    });

    it('shows whether the bot is running in the footer', () => {
        renderPage({ is_logged_in: true, is_virtual: true, loginid: 'VRTC1', balance: '10', currency: 'USD' });
        expect(screen.getByTestId('dt_bot_builder_status')).toHaveTextContent('Bot is not running');
        fireEvent.click(screen.getByText('Run'));
        act(() => mockRunnerOptions.mock.calls[0][0].onStatus('running'));
        expect(screen.getByTestId('dt_bot_builder_status')).toHaveTextContent('Bot is running');
    });

    it('lists every validation issue in the journal', () => {
        mockValidate.mockReturnValue([
            { level: 'error', message: 'Missing block: Trade parameters.' },
            { level: 'warn', message: 'A disabled block was ignored.' },
        ]);
        renderPage();
        fireEvent.click(screen.getByText('Check bot'));
        expect(screen.getByText('Missing block: Trade parameters.')).toBeInTheDocument();
        expect(screen.getByText('A disabled block was ignored.')).toBeInTheDocument();
    });

    it('undoes and redoes through the workspace', () => {
        renderPage();
        fireEvent.click(screen.getByText('Undo'));
        fireEvent.click(screen.getByText('Redo'));
        expect(mockWorkspace.undo).toHaveBeenNthCalledWith(1, false);
        expect(mockWorkspace.undo).toHaveBeenNthCalledWith(2, true);
    });

    describe('running a bot', () => {
        const demo = { is_logged_in: true, is_virtual: true, loginid: 'VRTC1', balance: '10000', currency: 'USD' };
        const real = { is_logged_in: true, is_virtual: false, loginid: 'CR1', balance: '50', currency: 'USD' };

        beforeEach(() => mockValidate.mockReturnValue([]));

        it('asks the user to log in first', () => {
            renderPage({ is_logged_in: false });
            fireEvent.click(screen.getByText('Run'));
            fireEvent.click(screen.getByText('Journal'));
            expect(screen.getByText('Log in to run a bot.')).toBeInTheDocument();
            expect(mockStart).not.toHaveBeenCalled();
        });

        it('starts straight away on a demo account and shows the account badge', () => {
            renderPage(demo);
            expect(screen.getByTestId('dt_bot_builder_account')).toHaveTextContent('Demo account · VRTC1');
            fireEvent.click(screen.getByText('Run'));
            expect(mockStart).toHaveBeenCalledTimes(1);
            expect(mockRunnerOptions.mock.calls[0][0]).toMatchObject({ currency: 'USD' });
            expect(mockRunnerOptions.mock.calls[0][0].getBalance()).toBe(10000);
        });

        it('asks for a loss limit before trading real money', () => {
            renderPage(real);
            fireEvent.click(screen.getByText('Run'));
            expect(mockStart).not.toHaveBeenCalled();
            expect(screen.queryByTestId('dt_bot_builder_confirm')).not.toBeInTheDocument();
            fireEvent.click(screen.getByText('Journal'));
            expect(screen.getByText(/Set a "Stop loss" limit/)).toBeInTheDocument();
        });

        it('asks for a stake cap before trading real money', () => {
            renderPage(real);
            fireEvent.change(screen.getByLabelText('Stop loss'), { target: { value: '10' } });
            fireEvent.click(screen.getByText('Run'));
            expect(mockStart).not.toHaveBeenCalled();
            expect(screen.queryByTestId('dt_bot_builder_confirm')).not.toBeInTheDocument();
            fireEvent.click(screen.getByText('Journal'));
            expect(screen.getByText(/Set a "Max stake per trade" limit/)).toBeInTheDocument();
        });

        it('does not ask for a stake cap on a demo account', () => {
            renderPage(demo);
            fireEvent.click(screen.getByText('Run'));
            expect(mockStart).toHaveBeenCalledTimes(1);
            expect(mockRunnerOptions.mock.calls[0][0].limits.max_stake).toBeUndefined();
        });

        it('requires explicit confirmation before trading real money', () => {
            renderPage(real);
            expect(screen.getByTestId('dt_bot_builder_account')).toHaveTextContent('Real account · CR1');
            fireEvent.change(screen.getByLabelText('Stop loss'), { target: { value: '10' } });
            fireEvent.change(screen.getByLabelText('Max stake per trade'), { target: { value: '2' } });
            fireEvent.click(screen.getByText('Run'));
            expect(mockStart).not.toHaveBeenCalled();
            expect(screen.getByTestId('dt_bot_builder_confirm')).toHaveTextContent('real money on account CR1');

            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.queryByTestId('dt_bot_builder_confirm')).not.toBeInTheDocument();
            expect(mockStart).not.toHaveBeenCalled();

            fireEvent.click(screen.getByText('Run'));
            fireEvent.click(screen.getByText('Run with real money'));
            expect(mockStart).toHaveBeenCalledTimes(1);
            expect(screen.queryByTestId('dt_bot_builder_confirm')).not.toBeInTheDocument();
        });

        it('does not start a bot that has structure errors', () => {
            mockValidate.mockReturnValue([{ level: 'error', message: 'Missing block: Trade parameters.' }]);
            renderPage(demo);
            fireEvent.click(screen.getByText('Run'));
            expect(mockStart).not.toHaveBeenCalled();
            // the page switches to the journal so the errors are visible
            expect(screen.getByText('Missing block: Trade parameters.')).toBeInTheDocument();
        });

        it('passes the optional limits to the runner and shows Stop while running', () => {
            renderPage(demo);
            fireEvent.change(screen.getByLabelText('Stop after trades'), { target: { value: '5' } });
            fireEvent.change(screen.getByLabelText('Stop loss'), { target: { value: '20' } });
            fireEvent.change(screen.getByLabelText('Max stake per trade'), { target: { value: '3.5' } });
            fireEvent.click(screen.getByText('Run'));
            expect(mockRunnerOptions.mock.calls[0][0].limits).toEqual({
                max_trades: 5,
                max_stake: 3.5,
                max_loss: 20,
                max_profit: undefined,
                keep_running: true,
            });

            act(() => mockRunnerOptions.mock.calls[0][0].onStatus('running'));
            fireEvent.click(screen.getByText('Stop'));
            expect(mockStop).toHaveBeenCalled();
        });

        describe('real money banner', () => {
            const startReal = () => {
                renderPage(real);
                fireEvent.change(screen.getByLabelText('Stop loss'), { target: { value: '10' } });
                fireEvent.change(screen.getByLabelText('Max stake per trade'), { target: { value: '2' } });
                fireEvent.click(screen.getByText('Run'));
                fireEvent.click(screen.getByText('Run with real money'));
            };

            it('is hidden until a bot is running', () => {
                renderPage(real);
                expect(screen.queryByTestId('dt_bot_builder_real_banner')).not.toBeInTheDocument();
            });

            it('shows while a bot trades on a real account, and goes when it stops', () => {
                startReal();
                act(() => mockRunnerOptions.mock.calls[0][0].onStatus('running'));
                expect(screen.getByTestId('dt_bot_builder_real_banner')).toHaveTextContent(
                    'REAL MONEY: this bot is trading on account CR1'
                );

                act(() => mockRunnerOptions.mock.calls[0][0].onStatus('stopping'));
                expect(screen.getByTestId('dt_bot_builder_real_banner')).toHaveTextContent('is stopping');

                act(() => mockRunnerOptions.mock.calls[0][0].onStatus('stopped'));
                expect(screen.queryByTestId('dt_bot_builder_real_banner')).not.toBeInTheDocument();
            });

            it('never shows on a demo account', () => {
                renderPage(demo);
                fireEvent.click(screen.getByText('Run'));
                act(() => mockRunnerOptions.mock.calls[0][0].onStatus('running'));
                expect(screen.queryByTestId('dt_bot_builder_real_banner')).not.toBeInTheDocument();
            });
        });

        it('shows the statistics reported by the runner', () => {
            renderPage(demo);
            fireEvent.click(screen.getByText('Run'));
            act(() =>
                mockRunnerOptions.mock.calls[0][0].onStats({
                    runs: 3,
                    won: 2,
                    lost: 1,
                    total_profit: 1.5,
                    total_stake: 3,
                    total_payout: 4.5,
                })
            );
            expect(screen.getByTestId('dt_bot_builder_stats')).toHaveTextContent('No. of runs3');
            expect(screen.getByTestId('dt_bot_builder_stats')).toHaveTextContent('Total payout4.50');
            expect(screen.getByTestId('dt_bot_builder_stats')).toHaveTextContent('1.50');
        });
    });
    describe('templates', () => {
        const openTemplates = () => fireEvent.click(screen.getByTestId('dt_bot_builder_templates_toggle'));

        beforeEach(() => {
            mockValidate.mockReturnValue([]);
            mockLoadParsedBot.mockReturnValue(true);
        });

        it('opens and closes the template library', () => {
            renderPage();
            expect(screen.queryByTestId('dt_bot_templates')).not.toBeInTheDocument();
            openTemplates();
            expect(screen.getByTestId('dt_bot_templates')).toBeInTheDocument();
            fireEvent.click(screen.getByLabelText('Close templates'));
            expect(screen.queryByTestId('dt_bot_templates')).not.toBeInTheDocument();
        });

        it('loads a template in one tap, closes the library and logs it', () => {
            renderPage();
            openTemplates();
            fireEvent.click(screen.getByTestId('dt_bot_template_import_rise_fall_basic'));

            expect(mockLoadParsedBot).toHaveBeenCalledTimes(1);
            expect(screen.queryByTestId('dt_bot_templates')).not.toBeInTheDocument();
            expect(screen.getByText(/Loaded the "Rise\/Fall: steady stake" template/)).toBeInTheDocument();
        });

        it('keeps the current bot and says so when a template cannot be loaded', () => {
            mockLoadParsedBot.mockReturnValue(false);
            renderPage();
            openTemplates();
            fireEvent.click(screen.getByTestId('dt_bot_template_import_even_odd_basic'));

            expect(screen.getByText('That template could not be loaded.')).toBeInTheDocument();
            // the library stays open and nothing was replaced, so there is no old bot to bring back
            expect(screen.getByTestId('dt_bot_templates')).toBeInTheDocument();
            expect(screen.queryByTestId('dt_bot_templates_restore')).not.toBeInTheDocument();
        });

        it('brings the previous bot back after a template replaced it', () => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { loadWorkspaceState } = require('../bot-utils');
            renderPage();
            openTemplates();
            fireEvent.click(screen.getByTestId('dt_bot_template_import_digit_over_2'));
            loadWorkspaceState.mockClear();

            openTemplates();
            fireEvent.click(screen.getByText('Bring it back'));

            expect(loadWorkspaceState).toHaveBeenCalledWith(mockWorkspace, {
                marker: 'old bot',
                blocks: { blocks: [] },
            });
            expect(screen.getByText('Your previous bot is back.')).toBeInTheDocument();
            openTemplates();
            expect(screen.queryByTestId('dt_bot_templates_restore')).not.toBeInTheDocument();
        });

        describe('saving your own bots as templates', () => {
            const openSave = () => fireEvent.click(screen.getByTestId('dt_bot_builder_save_template'));
            const typeName = (name: string) =>
                fireEvent.change(screen.getByTestId('dt_bot_save_template_name'), { target: { value: name } });
            const submit = () => fireEvent.click(screen.getByTestId('dt_bot_save_template_submit'));
            const saveAs = (name: string) => {
                openSave();
                typeName(name);
                submit();
            };

            it('asks for a name, and will not save an empty one', () => {
                renderPage();
                expect(screen.queryByTestId('dt_bot_save_template')).not.toBeInTheDocument();
                openSave();
                expect(screen.getByTestId('dt_bot_save_template')).toBeInTheDocument();
                expect(screen.getByTestId('dt_bot_save_template_submit')).toBeDisabled();
                typeName('   ');
                expect(screen.getByTestId('dt_bot_save_template_submit')).toBeDisabled();
                typeName('My bot');
                expect(screen.getByTestId('dt_bot_save_template_submit')).toBeEnabled();
            });

            it('closes without saving on Cancel and on Escape', () => {
                renderPage();
                openSave();
                typeName('Nope');
                fireEvent.click(screen.getByTestId('dt_bot_save_template_cancel'));
                expect(screen.queryByTestId('dt_bot_save_template')).not.toBeInTheDocument();
                openSave();
                fireEvent.keyDown(screen.getByTestId('dt_bot_save_template'), { key: 'Escape' });
                expect(screen.queryByTestId('dt_bot_save_template')).not.toBeInTheDocument();
                expect(readSavedBots()).toEqual([]);
            });

            it('keeps the bot in this browser, closes the form and says so', () => {
                renderPage();
                saveAs('  My   steady bot ');
                expect(readSavedBots()).toEqual([expect.objectContaining({ name: 'My steady bot', xml: GOOD_XML })]);
                expect(screen.queryByTestId('dt_bot_save_template')).not.toBeInTheDocument();
                expect(screen.getByText('Saved "My steady bot" to your templates.')).toBeInTheDocument();
            });

            it('lists the saved bot in the Templates drawer straight away', () => {
                renderPage();
                saveAs('My steady bot');
                openTemplates();
                expect(screen.getByTestId('dt_bot_saved_list')).toHaveTextContent('My steady bot');
                expect(screen.queryByTestId('dt_bot_saved_empty')).not.toBeInTheDocument();
            });

            it('replaces the earlier bot when the name is used again', () => {
                renderPage();
                saveAs('My bot');
                saveAs('my BOT');
                expect(readSavedBots()).toHaveLength(1);
                expect(screen.getByText('Replaced "my BOT" in your saved bots.')).toBeInTheDocument();
            });

            it('says so when the browser would not store it, and keeps the form open', () => {
                renderPage();
                openSave();
                typeName('My bot');
                const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                    throw new DOMException('full', 'QuotaExceededError');
                });
                submit();
                spy.mockRestore();
                expect(screen.getByText(/would not store the bot/)).toBeInTheDocument();
                expect(screen.getByTestId('dt_bot_save_template')).toBeInTheDocument();
            });

            it('says when the list is full', () => {
                for (let index = 0; index < 20; index += 1) saveBotAsTemplate(`Bot ${index}`, GOOD_XML);
                renderPage();
                saveAs('One too many');
                expect(screen.getByText(/You can keep up to 20 bots/)).toBeInTheDocument();
                expect(readSavedBots()).toHaveLength(20);
            });

            it('does not keep a bot that the importer would refuse', () => {
                mockExportXml.mockReturnValue('<xml><block type="not_a_real_block"></block></xml>');
                renderPage();
                saveAs('Broken');
                expect(screen.getByText(/blocks that are not supported/)).toBeInTheDocument();
                expect(readSavedBots()).toEqual([]);
            });

            it('can save while a bot is running, because saving changes nothing on the workspace', () => {
                renderPage({ is_logged_in: true, is_virtual: true, loginid: 'VRTC1', balance: '10', currency: 'USD' });
                fireEvent.click(screen.getByText('Run'));
                act(() => mockRunnerOptions.mock.calls[0][0].onStatus('running'));
                saveAs('While running');
                expect(readSavedBots()).toHaveLength(1);
            });

            describe('the saved list in the drawer', () => {
                beforeEach(() => {
                    saveBotAsTemplate('Older', GOOD_XML, 1000);
                    saveBotAsTemplate('Newer', GOOD_XML, 2000);
                });

                it('shows the saved bots, newest first, above the ready-made ones', () => {
                    renderPage();
                    openTemplates();
                    const names = within(screen.getByTestId('dt_bot_saved_list'))
                        .getAllByRole('heading', { level: 3 })
                        .map(heading => heading.textContent);
                    expect(names).toEqual(['Newer', 'Older']);
                    expect(screen.getByText('Ready-made bots')).toBeInTheDocument();
                });

                it('loads a saved bot in one tap through the same loader as a file', () => {
                    renderPage();
                    openTemplates();
                    const [newer] = readSavedBots();
                    fireEvent.click(screen.getByTestId(`dt_bot_saved_import_${newer.id}`));
                    expect(mockLoadParsedBot).toHaveBeenCalledTimes(1);
                    expect(mockLoadParsedBot.mock.calls[0]).toEqual([
                        mockWorkspace,
                        expect.objectContaining({ ok: true, kind: 'xml' }),
                    ]);
                    expect(screen.queryByTestId('dt_bot_templates')).not.toBeInTheDocument();
                    expect(screen.getByText(/Loaded the "Newer" template/)).toBeInTheDocument();
                });

                it('keeps the bot it replaced so it can be brought back', () => {
                    renderPage();
                    openTemplates();
                    fireEvent.click(screen.getByTestId(`dt_bot_saved_import_${readSavedBots()[0].id}`));
                    expect(readPreviousBot()).toEqual({ marker: 'old bot', blocks: { blocks: [] } });
                    openTemplates();
                    expect(screen.getByTestId('dt_bot_templates_restore')).toBeInTheDocument();
                });

                it('says so, and keeps the current bot, when a saved bot cannot be loaded', () => {
                    mockLoadParsedBot.mockReturnValue(false);
                    renderPage();
                    openTemplates();
                    fireEvent.click(screen.getByTestId(`dt_bot_saved_import_${readSavedBots()[0].id}`));
                    expect(screen.getByText('That saved bot could not be loaded.')).toBeInTheDocument();
                    expect(readPreviousBot()).toBeNull();
                });

                it('refuses a stored bot that the importer rejects, without touching the workspace', () => {
                    localStorage.setItem(
                        SAVED_BOTS_STORAGE_KEY,
                        JSON.stringify([
                            {
                                id: 'evil',
                                name: 'Evil',
                                saved_at: 1,
                                xml: '<xml><block type="not_a_real_block"></block></xml>',
                            },
                        ])
                    );
                    renderPage();
                    openTemplates();
                    fireEvent.click(screen.getByTestId('dt_bot_saved_import_evil'));
                    expect(mockLoadParsedBot).not.toHaveBeenCalled();
                    expect(screen.getByText(/blocks that are not supported/)).toBeInTheDocument();
                });

                it('turns Import off while a bot is running', () => {
                    renderPage({
                        is_logged_in: true,
                        is_virtual: true,
                        loginid: 'VRTC1',
                        balance: '10',
                        currency: 'USD',
                    });
                    fireEvent.click(screen.getByText('Run'));
                    act(() => mockRunnerOptions.mock.calls[0][0].onStatus('running'));
                    openTemplates();
                    expect(screen.getByTestId(`dt_bot_saved_import_${readSavedBots()[0].id}`)).toBeDisabled();
                });

                it('asks twice before deleting, then removes the bot from the list and from storage', () => {
                    renderPage();
                    openTemplates();
                    const [newer] = readSavedBots();
                    const button = () => screen.getByTestId(`dt_bot_saved_delete_${newer.id}`);
                    fireEvent.click(button());
                    expect(button()).toHaveTextContent('Tap again to delete');
                    expect(readSavedBots()).toHaveLength(2);
                    fireEvent.click(button());
                    expect(screen.queryByTestId(`dt_bot_saved_${newer.id}`)).not.toBeInTheDocument();
                    expect(readSavedBots().map(bot => bot.name)).toEqual(['Older']);
                    expect(screen.getByText('Deleted "Newer" from your saved bots.')).toBeInTheDocument();
                });

                it('starts the delete question over when a different bot is pressed', () => {
                    renderPage();
                    openTemplates();
                    const [newer, older] = readSavedBots();
                    fireEvent.click(screen.getByTestId(`dt_bot_saved_delete_${newer.id}`));
                    fireEvent.click(screen.getByTestId(`dt_bot_saved_delete_${older.id}`));
                    expect(readSavedBots()).toHaveLength(2);
                    expect(screen.getByTestId(`dt_bot_saved_delete_${older.id}`)).toHaveTextContent(
                        'Tap again to delete'
                    );
                    expect(screen.getByTestId(`dt_bot_saved_delete_${newer.id}`)).toHaveTextContent('Delete');
                });
            });

            it('shows a hint instead of a list when nothing is saved, and survives corrupt storage', () => {
                localStorage.setItem(SAVED_BOTS_STORAGE_KEY, '{not json');
                renderPage();
                openTemplates();
                expect(screen.getByTestId('dt_bot_saved_empty')).toBeInTheDocument();
                expect(screen.queryByTestId('dt_bot_saved_list')).not.toBeInTheDocument();
            });
        });

        describe('"Bring it back" after a reload', () => {
            it('remembers the replaced bot in this browser', () => {
                renderPage();
                openTemplates();
                fireEvent.click(screen.getByTestId('dt_bot_template_import_digit_over_2'));
                expect(readPreviousBot()).toEqual({ marker: 'old bot', blocks: { blocks: [] } });
            });

            it('offers it again after the page is reloaded, and restores it', () => {
                const { unmount } = renderPage();
                openTemplates();
                fireEvent.click(screen.getByTestId('dt_bot_template_import_digit_over_2'));
                unmount();

                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { loadWorkspaceState } = require('../bot-utils');
                renderPage();
                openTemplates();
                expect(screen.getByTestId('dt_bot_templates_restore')).toBeInTheDocument();
                loadWorkspaceState.mockClear();
                fireEvent.click(screen.getByText('Bring it back'));
                expect(loadWorkspaceState).toHaveBeenCalledWith(mockWorkspace, {
                    marker: 'old bot',
                    blocks: { blocks: [] },
                });
                expect(screen.getByText('Your previous bot is back.')).toBeInTheDocument();
            });

            it('forgets it once it has been brought back', () => {
                renderPage();
                openTemplates();
                fireEvent.click(screen.getByTestId('dt_bot_template_import_digit_over_2'));
                openTemplates();
                fireEvent.click(screen.getByText('Bring it back'));
                expect(localStorage.getItem(PREVIOUS_BOT_STORAGE_KEY)).toBeNull();
            });

            it('offers nothing when nothing was replaced', () => {
                renderPage();
                openTemplates();
                expect(screen.queryByTestId('dt_bot_templates_restore')).not.toBeInTheDocument();
            });

            it('still works for this visit when the browser will not store the replaced bot', () => {
                renderPage();
                openTemplates();
                const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                    throw new DOMException('full', 'QuotaExceededError');
                });
                fireEvent.click(screen.getByTestId('dt_bot_template_import_digit_over_2'));
                spy.mockRestore();
                openTemplates();
                expect(screen.getByTestId('dt_bot_templates_restore')).toBeInTheDocument();
            });

            it('refuses a stored replaced bot that does not pass the scan, and forgets it', () => {
                localStorage.setItem(
                    PREVIOUS_BOT_STORAGE_KEY,
                    JSON.stringify({ blocks: { blocks: [{ type: 'not_a_real_block' }] } })
                );
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { loadWorkspaceState } = require('../bot-utils');
                renderPage();
                openTemplates();
                loadWorkspaceState.mockClear();
                fireEvent.click(screen.getByText('Bring it back'));
                expect(loadWorkspaceState).not.toHaveBeenCalled();
                expect(screen.getByText('Your previous bot could not be restored.')).toBeInTheDocument();
                expect(localStorage.getItem(PREVIOUS_BOT_STORAGE_KEY)).toBeNull();
                openTemplates();
                expect(screen.queryByTestId('dt_bot_templates_restore')).not.toBeInTheDocument();
            });

            it('ignores a stored replaced bot that is not even an object', () => {
                localStorage.setItem(PREVIOUS_BOT_STORAGE_KEY, '[1,2,3]');
                renderPage();
                openTemplates();
                expect(screen.queryByTestId('dt_bot_templates_restore')).not.toBeInTheDocument();
            });
        });

        describe('opened from the Markets page', () => {
            const openWith = (search: string) => window.history.pushState({}, '', `/bot-builder${search}`);

            afterEach(() => window.history.pushState({}, '', '/'));

            it('opens the library with bots built for that market', () => {
                openWith('?market=frxEURUSD');
                renderPage();
                expect(screen.getByTestId('dt_bot_templates')).toBeInTheDocument();
                expect(screen.getByTestId('dt_bot_templates_market')).toHaveTextContent('Bots for EUR/USD.');
                expect(screen.getByTestId('dt_bot_templates_market')).toHaveTextContent('5 minute');
                // digit bots do not exist on forex
                expect(screen.queryByTestId('dt_bot_template_even_odd_basic')).not.toBeInTheDocument();
                expect(screen.getByTestId('dt_bot_template_rise_fall_basic')).toHaveTextContent('EUR/USD');
            });

            it('shows all five bots for a Derived index', () => {
                openWith('?market=R_50');
                renderPage();
                expect(screen.getByTestId('dt_bot_templates_market')).toHaveTextContent(
                    'Bots for Volatility 50 Index.'
                );
                expect(screen.getByTestId('dt_bot_template_even_odd_basic')).toBeInTheDocument();
            });

            it('ignores a market it cannot trade, so the library stays closed', () => {
                openWith('?market=frxNZDUSD');
                renderPage();
                expect(screen.queryByTestId('dt_bot_templates')).not.toBeInTheDocument();
            });

            it('goes back to every bot on its own market with Show all markets', () => {
                openWith('?market=frxEURUSD');
                renderPage();
                fireEvent.click(screen.getByText('Show all markets'));
                expect(screen.queryByTestId('dt_bot_templates_market')).not.toBeInTheDocument();
                expect(screen.getByTestId('dt_bot_template_even_odd_basic')).toBeInTheDocument();
                expect(window.location.search).toBe('');
            });

            it('loads the market bot and drops ?market= from the address', () => {
                openWith('?market=frxEURUSD');
                renderPage();
                fireEvent.click(screen.getByTestId('dt_bot_template_import_rise_fall_basic'));
                expect(mockLoadParsedBot).toHaveBeenCalledTimes(1);
                const parsed = mockLoadParsedBot.mock.calls[0] as unknown as [unknown, { kind: string; dom: Element }];
                expect(parsed[1].dom.outerHTML).toContain('frxEURUSD');
                expect(window.location.search).toBe('');
            });
        });

        it('cannot import while a bot is running', () => {
            renderPage({ is_logged_in: true, is_virtual: true, loginid: 'VRTC1', currency: 'USD', balance: 10000 });
            fireEvent.click(screen.getByText('Run'));
            act(() => mockRunnerOptions.mock.calls[0][0].onStatus('running'));
            openTemplates();
            expect(screen.getByTestId('dt_bot_template_import_rise_fall_basic')).toBeDisabled();
        });
    });
});
