import * as Blockly from 'blockly';

import { BLOCK_TYPES, registerBlocks } from '../blocks';
import {
    exportWorkspaceXml,
    getDefaultWorkspaceState,
    loadParsedBot,
    loadWorkspaceState,
    MAX_FILE_SIZE,
    parseBotFile,
    scanState,
    validateBot,
} from '../bot-utils';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

type TBlock = Record<string, unknown>;

const createWorkspace = (state: Record<string, unknown> = getDefaultWorkspaceState()) => {
    const workspace = new Blockly.Workspace();
    loadWorkspaceState(workspace, state);
    return workspace;
};

const num = (value: number) => ({ shadow: { type: 'math_number', fields: { NUM: value } } });

const blockById = (state: ReturnType<typeof getDefaultWorkspaceState>, id: string) =>
    (state.blocks.blocks as TBlock[]).find(block => block.id === id) as TBlock;

const messages = (workspace: Blockly.Workspace) => validateBot(workspace).map(issue => issue.message);

/** Starter bot switched to a digit trade type with the given duration and prediction. */
const digitBot = (trade_type: string, duration: number, prediction: number, unit = 't') => {
    const state = getDefaultWorkspaceState();
    const trade = blockById(state, 'trade_definition') as {
        inputs: { TRADE_OPTIONS: { block: TBlock }; SUBMARKET: { block: TBlock } };
    };
    trade.inputs.TRADE_OPTIONS.block = {
        type: BLOCK_TYPES.MARKET,
        fields: { MARKET_LIST: 'synthetic_index', SUBMARKET_LIST: 'random_index', SYMBOL_LIST: 'R_100' },
        next: {
            block: {
                type: BLOCK_TYPES.TRADE_TYPE,
                fields: { TRADETYPECAT_LIST: 'digits', TRADETYPE_LIST: trade_type },
            },
        },
    };
    trade.inputs.SUBMARKET.block = {
        type: BLOCK_TYPES.TRADE_OPTIONS,
        fields: { DURATIONTYPE_LIST: unit },
        inputs: { DURATION: num(duration), AMOUNT: num(1), PREDICTION: num(prediction) },
    };
    (
        blockById(state, 'before_purchase') as { inputs: { BEFOREPURCHASE_STACK: { block: TBlock } } }
    ).inputs.BEFOREPURCHASE_STACK.block = {
        type: BLOCK_TYPES.PURCHASE,
        fields: { PURCHASE_LIST: trade_type === 'overunder' ? 'DIGITOVER' : 'DIGITMATCH' },
    };
    return state;
};

describe('validateBot', () => {
    beforeAll(() => registerBlocks());

    it('accepts the starter bot without errors or warnings', () => {
        const workspace = createWorkspace();
        expect(validateBot(workspace)).toEqual([]);
        workspace.dispose();
    });

    it('reports missing required blocks on an empty workspace', () => {
        const workspace = createWorkspace({ blocks: { languageVersion: 0, blocks: [] } });
        const found = messages(workspace);
        expect(found).toEqual(
            expect.arrayContaining([
                'Missing block: Trade parameters.',
                'Missing block: Purchase conditions.',
                'Missing block: Restart trading conditions.',
            ])
        );
        expect(found.some(message => message.includes('Sell conditions'))).toBe(false);
        workspace.dispose();
    });

    it('rejects duplicate root blocks', () => {
        const state = getDefaultWorkspaceState();
        (state.blocks.blocks as TBlock[]).push({ type: BLOCK_TYPES.TRADE_DEFINITION, id: 'second', x: 0, y: 0 });
        const workspace = createWorkspace(state);
        expect(messages(workspace)).toContain('Only one "Trade parameters" block is allowed, found 2.');
        workspace.dispose();
    });

    it('warns when nothing triggers Trade again', () => {
        const state = getDefaultWorkspaceState();
        delete (blockById(state, 'after_purchase') as { inputs?: unknown }).inputs;
        const workspace = createWorkspace(state);
        expect(validateBot(workspace)).toEqual([
            expect.objectContaining({ level: 'warn', message: expect.stringContaining('Trade again') }),
        ]);
        workspace.dispose();
    });

    it('does not warn when a timeout or function may trade again', () => {
        const state = getDefaultWorkspaceState();
        (blockById(state, 'after_purchase') as { inputs: unknown }).inputs = {
            AFTERPURCHASE_STACK: {
                block: { type: BLOCK_TYPES.TIMEOUT, inputs: { SECONDS: num(2) } },
            },
        };
        const workspace = createWorkspace(state);
        expect(validateBot(workspace)).toEqual([]);
        workspace.dispose();
    });

    it('warns when a purchase uses a different contract than the trade parameters allow', () => {
        const state = getDefaultWorkspaceState();
        const trade = blockById(state, 'trade_definition') as { inputs: { TRADE_OPTIONS: { block: TBlock } } };
        // the contract type block is the third in the chain
        const contract = ((trade.inputs.TRADE_OPTIONS.block.next as { block: TBlock }).block.next as { block: TBlock })
            .block as { fields: Record<string, string> };
        contract.fields.TYPE_LIST = 'CALL';
        (
            blockById(state, 'before_purchase') as { inputs: { BEFOREPURCHASE_STACK: { block: TBlock } } }
        ).inputs.BEFOREPURCHASE_STACK.block = { type: BLOCK_TYPES.PURCHASE, fields: { PURCHASE_LIST: 'PUT' } };
        const workspace = createWorkspace(state);
        expect(validateBot(workspace)).toEqual([
            expect.objectContaining({ level: 'warn', message: expect.stringContaining('different contract type') }),
        ]);
        workspace.dispose();
    });

    it('accepts a valid over/under bot', () => {
        const workspace = createWorkspace(digitBot('overunder', 1, 4));
        expect(validateBot(workspace)).toEqual([]);
        workspace.dispose();
    });

    it('rejects a prediction outside 0 to 9', () => {
        const workspace = createWorkspace(digitBot('matchesdiffers', 1, 12));
        expect(messages(workspace)).toContain('The prediction must be a digit from 0 to 9.');
        workspace.dispose();
    });

    it('rejects digit trades with a duration that digits do not allow', () => {
        const long = createWorkspace(digitBot('overunder', 15, 4));
        expect(messages(long)).toContain('Digit trades last between 1 and 10 ticks.');
        const minutes = createWorkspace(digitBot('overunder', 1, 4, 'm'));
        expect(messages(minutes)).toContain('Digit trades can only use a duration in ticks.');
        long.dispose();
        minutes.dispose();
    });

    it('rejects a digit purchase on a rise/fall bot', () => {
        const state = getDefaultWorkspaceState();
        (
            blockById(state, 'before_purchase') as { inputs: { BEFOREPURCHASE_STACK: { block: TBlock } } }
        ).inputs.BEFOREPURCHASE_STACK.block = { type: BLOCK_TYPES.PURCHASE, fields: { PURCHASE_LIST: 'DIGITOVER' } };
        const workspace = createWorkspace(state);
        expect(messages(workspace)).toContain('A digit contract needs a digit trade type.');
        workspace.dispose();
    });

    it('rejects a purchase block placed outside the purchase conditions', () => {
        const state = getDefaultWorkspaceState();
        (state.blocks.blocks as TBlock[]).push({
            type: BLOCK_TYPES.PURCHASE,
            id: 'stray',
            x: 0,
            y: 900,
            fields: { PURCHASE_LIST: 'CALL' },
        });
        const workspace = createWorkspace(state);
        expect(messages(workspace)).toContain('"Purchase" can only be used inside the purchase conditions.');
        workspace.dispose();
    });
});

describe('importing bots', () => {
    beforeAll(() => registerBlocks());

    it('round-trips the workspace through Deriv Bot XML', () => {
        const workspace = createWorkspace();
        const xml = exportWorkspaceXml(workspace);
        expect(xml).toContain('is_dbot="true"');

        const parsed = parseBotFile(xml);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        const copy = new Blockly.Workspace();
        expect(loadParsedBot(copy, parsed)).toBe(true);
        const types = (target: Blockly.Workspace) =>
            target
                .getAllBlocks(false)
                .map(block => block.type)
                .sort();
        expect(types(copy)).toEqual(types(workspace));
        expect(validateBot(copy)).toEqual([]);
        workspace.dispose();
        copy.dispose();
    });

    it('round-trips the workspace through JSON', () => {
        const workspace = createWorkspace();
        const saved = Blockly.serialization.workspaces.save(workspace);
        const parsed = parseBotFile(JSON.stringify(saved));
        expect(parsed).toMatchObject({ ok: true, kind: 'json' });
        workspace.dispose();
    });

    it('rejects files that are not bots', () => {
        expect(parseBotFile('')).toMatchObject({ ok: false });
        expect(parseBotFile('not json')).toMatchObject({ ok: false });
        expect(parseBotFile('{"hello":1}')).toMatchObject({ ok: false });
        expect(parseBotFile('<xml><block type="trade_definition"></xml>')).toMatchObject({ ok: false });
        expect(parseBotFile('<html></html>')).toMatchObject({ ok: false });
    });

    it('refuses blocks that are not part of the vocabulary', () => {
        const xml = '<xml><block type="procedures_defnoreturn"/><block type="evil_block"/></xml>';
        const parsed = parseBotFile(xml);
        expect(parsed).toEqual({
            ok: false,
            errors: ['This bot uses blocks that are not supported here: evil_block.'],
        });

        const json = JSON.stringify({ blocks: { blocks: [{ type: 'lists_create_with' }] } });
        expect(parseBotFile(json)).toMatchObject({ ok: false });
    });

    it('refuses entity declarations and oversized files', () => {
        const bomb = '<?xml version="1.0"?><!DOCTYPE xml [<!ENTITY a "aaaa">]><xml>&a;</xml>';
        expect(parseBotFile(bomb)).toMatchObject({ ok: false });
        expect(parseBotFile(' '.repeat(MAX_FILE_SIZE + 1))).toMatchObject({ ok: false });
    });

    it('refuses deeply nested and oversized bots', () => {
        let nested: Record<string, unknown> = { type: 'math_number' };
        for (let index = 0; index < 250; index += 1) {
            nested = { type: 'math_arithmetic', inputs: { A: { block: nested } } };
        }
        expect(scanState({ blocks: { blocks: [nested] } }).errors).toEqual(['This bot is nested too deeply.']);

        const many = Array.from({ length: 5001 }, () => ({ type: 'math_number' }));
        expect(scanState({ blocks: { blocks: many } }).errors).toEqual(['This bot has too many blocks.']);
    });

    it('keeps the current bot when a scanned file still fails to load', () => {
        const workspace = createWorkspace();
        const before = workspace.getAllBlocks(false).length;
        const broken = {
            ok: true as const,
            kind: 'json' as const,
            // passes the scan but Blockly cannot load a block whose type has no definition
            state: { blocks: { languageVersion: 0, blocks: [{ type: 'math_number', fields: { NUM: 1 } }, null] } },
        };
        expect(loadParsedBot(workspace, broken)).toBe(false);
        expect(workspace.getAllBlocks(false)).toHaveLength(before);
        workspace.dispose();
    });
});
