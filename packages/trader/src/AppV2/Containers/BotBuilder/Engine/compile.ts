import * as Blockly from 'blockly';

import { localize } from '@deriv-com/translations';

import { BLOCK_TYPES } from '../blocks';

import type { TDataKind, TExpr, TLevel, TProgram, TStmt } from './types';

export class CompileError extends Error {}

const missing = (block: Blockly.Block, input: string): never => {
    throw new CompileError(
        localize('The "{{block}}" block is missing its "{{input}}" input.', { block: block.type, input })
    );
};

const DATA_BLOCKS: Record<string, TDataKind> = {
    [BLOCK_TYPES.LAST_TICK]: 'last_tick',
    [BLOCK_TYPES.LAST_DIGIT]: 'last_digit',
    [BLOCK_TYPES.ACCOUNT_BALANCE]: 'balance',
    [BLOCK_TYPES.TOTAL_PROFIT]: 'total_profit',
    [BLOCK_TYPES.CURRENT_PROFIT]: 'current_profit',
    [BLOCK_TYPES.IS_SELL_AVAILABLE]: 'sell_available',
};

const getVariableName = (block: Blockly.Block) => block.getField('VAR')?.getText() ?? '';

const compileInput = (block: Blockly.Block, input: string): TExpr => {
    const target = block.getInputTargetBlock(input);
    if (!target) return missing(block, input);
    return compileExpr(target);
};

export const compileExpr = (block: Blockly.Block): TExpr => {
    const data_kind = DATA_BLOCKS[block.type];
    if (data_kind) return { t: 'data', kind: data_kind };

    switch (block.type) {
        case BLOCK_TYPES.LAST_TRADE_RESULT:
            return {
                t: 'data',
                kind: block.getFieldValue('RESULT') === 'win' ? 'last_result_win' : 'last_result_loss',
            };
        case 'math_number':
            return { t: 'num', v: Number(block.getFieldValue('NUM')) };
        case 'logic_boolean':
            return { t: 'bool', v: block.getFieldValue('BOOL') === 'TRUE' };
        case 'variables_get':
            return { t: 'var', name: getVariableName(block) };
        case 'logic_compare':
            return {
                t: 'cmp',
                op: block.getFieldValue('OP'),
                a: compileInput(block, 'A'),
                b: compileInput(block, 'B'),
            };
        case 'logic_operation':
            return {
                t: 'logic',
                op: block.getFieldValue('OP'),
                a: compileInput(block, 'A'),
                b: compileInput(block, 'B'),
            };
        case 'logic_negate':
            return { t: 'not', a: compileInput(block, 'BOOL') };
        case 'math_arithmetic':
            return {
                t: 'arith',
                op: block.getFieldValue('OP'),
                a: compileInput(block, 'A'),
                b: compileInput(block, 'B'),
            };
        case 'math_single':
            return { t: 'single', op: block.getFieldValue('OP'), a: compileInput(block, 'NUM') };
        case 'math_random_int':
            return { t: 'rand', from: compileInput(block, 'FROM'), to: compileInput(block, 'TO') };
        default:
            throw new CompileError(
                localize('The "{{block}}" block is not supported in a bot yet.', { block: block.type })
            );
    }
};

const compileStatement = (block: Blockly.Block): TStmt => {
    switch (block.type) {
        case 'controls_if': {
            // Blockly keeps the else-if/else counts of an if block in these underscore-suffixed fields
            /* eslint-disable no-underscore-dangle */
            const mutation = block as Blockly.Block & { elseifCount_?: number; elseCount_?: number };
            const branch_count = (mutation.elseifCount_ ?? 0) + 1;
            const branches = Array.from({ length: branch_count }, (_unused, index) => ({
                cond: compileInput(block, `IF${index}`),
                body: compileStack(block.getInputTargetBlock(`DO${index}`)),
            }));
            const otherwise = mutation.elseCount_ ? compileStack(block.getInputTargetBlock('ELSE')) : [];
            /* eslint-enable no-underscore-dangle */
            return { t: 'if', branches, otherwise };
        }
        case 'variables_set':
            return { t: 'set', name: getVariableName(block), value: compileInput(block, 'VALUE') };
        case BLOCK_TYPES.NOTIFY:
            return {
                t: 'notify',
                level: block.getFieldValue('LEVEL') as TLevel,
                message: String(block.getFieldValue('MESSAGE') ?? ''),
            };
        case BLOCK_TYPES.PURCHASE:
            return { t: 'purchase', contract_type: block.getFieldValue('PURCHASE_TYPE') };
        case BLOCK_TYPES.SELL_AT_MARKET:
            return { t: 'sell' };
        case BLOCK_TYPES.TRADE_AGAIN:
            return { t: 'trade_again' };
        default:
            throw new CompileError(
                localize('The "{{block}}" block is not supported in a bot yet.', { block: block.type })
            );
    }
};

export const compileStack = (first: Blockly.Block | null): TStmt[] => {
    const statements: TStmt[] = [];
    for (let block = first; block; block = block.getNextBlock()) {
        if (block.isEnabled()) statements.push(compileStatement(block));
    }
    return statements;
};

const findRoot = (workspace: Blockly.Workspace, type: string) =>
    workspace.getTopBlocks(false).find(block => block.type === type && block.isEnabled()) ?? null;

/** Turns the blocks on the workspace into a plain program the runner can execute. */
export const compileProgram = (workspace: Blockly.Workspace): TProgram => {
    const trade_block = findRoot(workspace, BLOCK_TYPES.TRADE_DEFINITION);
    const purchase_block = findRoot(workspace, BLOCK_TYPES.BEFORE_PURCHASE);
    const sell_block = findRoot(workspace, BLOCK_TYPES.SELL_CONDITIONS);
    const restart_block = findRoot(workspace, BLOCK_TYPES.RESTART_CONDITIONS);

    if (!trade_block) throw new CompileError(localize('Missing block: Trade parameters.'));
    if (!purchase_block) throw new CompileError(localize('Missing block: Purchase conditions.'));
    if (!restart_block) throw new CompileError(localize('Missing block: Restart trading conditions.'));

    return {
        trade: {
            symbol: trade_block.getFieldValue('MARKET'),
            contract_type: trade_block.getFieldValue('CONTRACT_TYPE'),
            duration: Number(trade_block.getFieldValue('DURATION')),
            duration_unit: trade_block.getFieldValue('DURATION_UNIT'),
            stake: Number(trade_block.getFieldValue('STAKE')),
        },
        purchase: compileStack(purchase_block.getInputTargetBlock('STACK')),
        sell: sell_block ? compileStack(sell_block.getInputTargetBlock('STACK')) : [],
        restart: compileStack(restart_block.getInputTargetBlock('STACK')),
    };
};
