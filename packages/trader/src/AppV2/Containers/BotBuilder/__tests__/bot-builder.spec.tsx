import { mockStore, StoreProvider } from '@deriv/stores';
import { act, fireEvent, render, screen } from '@testing-library/react';

import BotBuilder from '../bot-builder';

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
    serialization: { workspaces: { save: jest.fn(() => ({ marker: 'old bot' })) } },
}));

jest.mock('../blocks', () => ({
    ...jest.requireActual('../blocks'),
    registerBlocks: jest.fn(),
    getToolbox: jest.fn(() => ({})),
    getBlocklyTheme: jest.fn(() => ({})),
}));

const mockValidate = jest.fn();
const mockLoadParsedBot = jest.fn(() => true);
jest.mock('../bot-utils', () => ({
    ...jest.requireActual('../bot-utils'),
    loadParsedBot: (...args: unknown[]) => (mockLoadParsedBot as (...a: unknown[]) => boolean)(...args),
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
    beforeEach(() => jest.clearAllMocks());

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

        it('requires explicit confirmation before trading real money', () => {
            renderPage(real);
            expect(screen.getByTestId('dt_bot_builder_account')).toHaveTextContent('Real account · CR1');
            fireEvent.change(screen.getByLabelText('Stop loss'), { target: { value: '10' } });
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
            fireEvent.click(screen.getByText('Run'));
            expect(mockRunnerOptions.mock.calls[0][0].limits).toEqual({
                max_trades: 5,
                max_loss: 20,
                max_profit: undefined,
                keep_running: true,
            });

            act(() => mockRunnerOptions.mock.calls[0][0].onStatus('running'));
            fireEvent.click(screen.getByText('Stop'));
            expect(mockStop).toHaveBeenCalled();
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

            expect(loadWorkspaceState).toHaveBeenCalledWith(mockWorkspace, { marker: 'old bot' });
            expect(screen.getByText('Your previous bot is back.')).toBeInTheDocument();
            openTemplates();
            expect(screen.queryByTestId('dt_bot_templates_restore')).not.toBeInTheDocument();
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
