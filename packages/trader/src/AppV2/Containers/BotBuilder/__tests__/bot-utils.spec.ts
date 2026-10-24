import * as Blockly from 'blockly';

import { BLOCK_TYPES, registerBlocks } from '../blocks';
import { getDefaultWorkspaceState, loadWorkspaceState, parseWorkspaceFile, validateBot } from '../bot-utils';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const createWorkspace = (state: Record<string, unknown> = getDefaultWorkspaceState()) => {
    const workspace = new Blockly.Workspace();
    loadWorkspaceState(workspace, state);
    return workspace;
};

describe('bot-builder utils', () => {
    beforeAll(() => registerBlocks());

    it('accepts the starter bot without errors or warnings', () => {
        const workspace = createWorkspace();
        expect(validateBot(workspace)).toEqual([]);
        workspace.dispose();
    });

    it('reports missing required blocks on an empty workspace', () => {
        const workspace = createWorkspace({ blocks: { languageVersion: 0, blocks: [] } });
        const messages = validateBot(workspace).map(issue => issue.message);
        expect(messages).toEqual(
            expect.arrayContaining([
                'Missing block: Trade parameters.',
                'Missing block: Purchase conditions.',
                'Missing block: Restart trading conditions.',
            ])
        );
        expect(messages.some(message => message.includes('Sell conditions'))).toBe(false);
        workspace.dispose();
    });

    it('rejects duplicate root blocks', () => {
        const state = getDefaultWorkspaceState();
        state.blocks.blocks.push({ type: BLOCK_TYPES.TRADE_DEFINITION, id: 'second', x: 0, y: 0 } as never);
        const workspace = createWorkspace(state);
        expect(validateBot(workspace).map(issue => issue.message)).toContain(
            'Only one "Trade parameters" block is allowed, found 2.'
        );
        workspace.dispose();
    });

    it('warns when nothing triggers Trade again', () => {
        const state = getDefaultWorkspaceState();
        const restart = state.blocks.blocks.find(block => block.type === BLOCK_TYPES.RESTART_CONDITIONS);
        delete (restart as { inputs?: unknown }).inputs;
        const workspace = createWorkspace(state);
        expect(validateBot(workspace)).toEqual([
            expect.objectContaining({ level: 'warn', message: expect.stringContaining('Trade again') }),
        ]);
        workspace.dispose();
    });

    it('warns when the purchase type differs from the trade parameters', () => {
        const state = getDefaultWorkspaceState();
        const purchase = (
            state.blocks.blocks[1] as { inputs: { STACK: { block: { fields: Record<string, string> } } } }
        ).inputs.STACK.block;
        purchase.fields.PURCHASE_TYPE = 'PUT';
        const workspace = createWorkspace(state);
        expect(validateBot(workspace)).toEqual([
            expect.objectContaining({ level: 'warn', message: expect.stringContaining('different contract type') }),
        ]);
        workspace.dispose();
    });

    it('round-trips the workspace through serialization', () => {
        const workspace = createWorkspace();
        const saved = Blockly.serialization.workspaces.save(workspace);
        const parsed = parseWorkspaceFile(JSON.stringify(saved));
        expect(parsed).not.toBeNull();
        const copy = createWorkspace(parsed as Record<string, unknown>);
        expect(
            copy
                .getAllBlocks(false)
                .map(block => block.type)
                .sort()
        ).toEqual(
            workspace
                .getAllBlocks(false)
                .map(block => block.type)
                .sort()
        );
        workspace.dispose();
        copy.dispose();
    });

    it('rejects files that are not bots', () => {
        expect(parseWorkspaceFile('not json')).toBeNull();
        expect(parseWorkspaceFile('{"hello":1}')).toBeNull();
    });
});
