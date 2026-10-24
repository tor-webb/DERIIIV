import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen } from '@testing-library/react';

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
    localize: (text: string) => text,
}));

const renderPage = () =>
    render(
        <StoreProvider store={mockStore({})}>
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
});
