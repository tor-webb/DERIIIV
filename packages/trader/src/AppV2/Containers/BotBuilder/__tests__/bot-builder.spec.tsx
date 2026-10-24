import { mockStore, StoreProvider } from '@deriv/stores';
import { act, fireEvent, render, screen } from '@testing-library/react';

import BotBuilder from '../bot-builder';

const mockWorkspace = {
    addChangeListener: jest.fn(),
    dispose: jest.fn(),
    undo: jest.fn(),
};

jest.mock('blockly', () => ({
    inject: jest.fn(() => mockWorkspace),
    svgResize: jest.fn(),
}));

jest.mock('../blocks', () => ({
    ...jest.requireActual('../blocks'),
    registerBlocks: jest.fn(),
    getToolbox: jest.fn(() => ({})),
}));

const mockValidate = jest.fn();
jest.mock('../bot-utils', () => ({
    ...jest.requireActual('../bot-utils'),
    loadWorkspaceState: jest.fn(),
    saveWorkspaceToStorage: jest.fn(),
    readWorkspaceFromStorage: jest.fn(() => null),
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
    compileProgram: jest.fn(() => ({ trade: {}, purchase: [], sell: [], restart: [] })),
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

        it('requires explicit confirmation before trading real money', () => {
            renderPage(real);
            expect(screen.getByTestId('dt_bot_builder_account')).toHaveTextContent('Real account · CR1');
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
            expect(screen.getByText('Missing block: Trade parameters.')).toBeInTheDocument();
        });

        it('passes the optional limits to the runner and shows Stop while running', () => {
            renderPage(demo);
            fireEvent.change(screen.getByLabelText('Stop after trades'), { target: { value: '5' } });
            fireEvent.change(screen.getByLabelText('Stop at total loss'), { target: { value: '20' } });
            fireEvent.click(screen.getByText('Run'));
            expect(mockRunnerOptions.mock.calls[0][0].limits).toEqual({ max_trades: 5, max_loss: 20 });

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
                })
            );
            expect(screen.getByTestId('dt_bot_builder_stats')).toHaveTextContent('Runs3');
            expect(screen.getByTestId('dt_bot_builder_stats')).toHaveTextContent('1.50');
        });
    });
});
