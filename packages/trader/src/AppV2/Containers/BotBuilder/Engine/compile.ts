import * as Blockly from 'blockly';

import { localize } from '@deriv-com/translations';

import { BLOCK_TYPES, TRADE_TYPES } from '../blocks';

import type {
    TCandleField,
    TDataKind,
    TExpr,
    TLevel,
    TNumberProperty,
    TProcedure,
    TProgram,
    TSeriesSource,
    TStmt,
    TTradeOptions,
    TTradeSetup,
} from './types';

export class CompileError extends Error {}

type TLegacyProcedureBlock = Blockly.Block & { getVars?: () => string[] };
type TIfBlock = Blockly.Block & { elseifCount_?: number; elseCount_?: number };

const missing = (block: Blockly.Block, input: string): never => {
    throw new CompileError(
        localize('The "{{block}}" block is missing its "{{input}}" input.', { block: block.type, input })
    );
};

const throwCompile = (message: string): never => {
    throw new CompileError(message);
};

const unsupported = (block: Blockly.Block): never => {
    throw new CompileError(localize('The "{{block}}" block is not supported in a bot yet.', { block: block.type }));
};

/**
 * Values an input falls back to when nothing is plugged in and it has no shadow block. Deriv Bot fills these
 * in with shadow blocks; a bot saved without them still compiles the same way.
 */
const DEFAULT_INPUTS: Record<string, TExpr> = {
    [`${BLOCK_TYPES.TRADE_OPTIONS}.DURATION`]: { t: 'num', v: 5 },
    [`${BLOCK_TYPES.TRADE_OPTIONS}.AMOUNT`]: { t: 'num', v: 1 },
    [`${BLOCK_TYPES.TRADE_OPTIONS}.PREDICTION`]: { t: 'num', v: 0 },
    [`${BLOCK_TYPES.NOTIFY}.MESSAGE`]: { t: 'str', v: '' },
    [`${BLOCK_TYPES.TIMEOUT}.SECONDS`]: { t: 'num', v: 1 },
    [`${BLOCK_TYPES.SMA}.PERIOD`]: { t: 'num', v: 10 },
    [`${BLOCK_TYPES.EMA}.PERIOD`]: { t: 'num', v: 10 },
    [`${BLOCK_TYPES.RSI}.PERIOD`]: { t: 'num', v: 14 },
    [`${BLOCK_TYPES.BOLLINGER}.PERIOD`]: { t: 'num', v: 20 },
    [`${BLOCK_TYPES.BOLLINGER}.UPMULTIPLIER`]: { t: 'num', v: 2 },
    [`${BLOCK_TYPES.BOLLINGER}.DOWNMULTIPLIER`]: { t: 'num', v: 2 },
    [`${BLOCK_TYPES.READ_OHLC}.CANDLEINDEX`]: { t: 'num', v: 1 },
};

const CANDLE_FIELDS: ReadonlySet<string> = new Set(['open', 'high', 'low', 'close']);

const candleField = (block: Blockly.Block): TCandleField => {
    const field = String(block.getFieldValue('OHLCFIELD_LIST'));
    if (!CANDLE_FIELDS.has(field)) {
        throw new CompileError(
            localize('The "{{block}}" block uses "{{field}}", which is not supported in a bot yet.', {
                block: block.type,
                field,
            })
        );
    }
    return field as TCandleField;
};

/**
 * Where an indicator reads its prices from. The list has to be a Ticks list or a Candles list block plugged straight
 * into the indicator; a list held in a variable cannot be followed, so it is refused with an explanation.
 */
const indicatorSource = (block: Blockly.Block): TSeriesSource => {
    const list = block.getInputTargetBlock('INPUT_LIST');
    if (!list) return missing(block, 'INPUT_LIST');
    if (list.type === BLOCK_TYPES.TICKS) return { kind: 'ticks' };
    if (list.type === BLOCK_TYPES.OHLC_VALUES) return { kind: 'candles', field: candleField(list) };
    return throwCompile(
        localize(
            'The "{{block}}" block must have a Ticks list or a Candles list block plugged straight into it. A list kept in a variable is not supported yet.',
            { block: block.type }
        )
    );
};

const DATA_BLOCKS: Record<string, TDataKind> = {
    [BLOCK_TYPES.TICK]: 'tick',
    [BLOCK_TYPES.LAST_DIGIT]: 'last_digit',
    [BLOCK_TYPES.TOTAL_PROFIT]: 'total_profit',
    [BLOCK_TYPES.TOTAL_RUNS]: 'total_runs',
    [BLOCK_TYPES.SELL_AVAILABLE]: 'sell_available',
};

/** See READ_DETAILS_OPTIONS: only index 4 is confirmed against real Deriv bots. */
const DETAIL_KINDS: Record<string, TDataKind> = {
    '1': 'detail_contract_id',
    '2': 'detail_buy_price',
    '3': 'detail_sell_price',
    '4': 'detail_profit',
    '5': 'detail_contract_type',
};

const getVariableName = (block: Blockly.Block) => block.getField('VAR')?.getText() ?? '';

const compileInput = (block: Blockly.Block, input: string): TExpr => {
    const target = block.getInputTargetBlock(input);
    if (target) return compileExpr(target);
    return DEFAULT_INPUTS[`${block.type}.${input}`] ?? missing(block, input);
};

const compileArguments = (block: Blockly.Block): TExpr[] =>
    block.inputList
        .filter(input => /^ARG\d+$/.test(input.name))
        .map(input => {
            const target = block.getInputTargetBlock(input.name);
            return target ? compileExpr(target) : ({ t: 'num', v: 0 } as TExpr);
        });

export const compileExpr = (block: Blockly.Block): TExpr => {
    const data_kind = DATA_BLOCKS[block.type];
    if (data_kind) return { t: 'data', kind: data_kind };

    switch (block.type) {
        case BLOCK_TYPES.BALANCE:
            return { t: 'data', kind: block.getFieldValue('BALANCE_TYPE') === 'STR' ? 'balance_text' : 'balance' };
        case BLOCK_TYPES.CONTRACT_CHECK_RESULT:
            return { t: 'data', kind: block.getFieldValue('CHECK_RESULT') === 'win' ? 'result_win' : 'result_loss' };
        case BLOCK_TYPES.READ_DETAILS: {
            const kind = DETAIL_KINDS[String(block.getFieldValue('DETAIL_INDEX'))];
            if (!kind) {
                throw new CompileError(
                    localize('"Contract detail" option {{index}} is not supported in a bot yet.', {
                        index: String(block.getFieldValue('DETAIL_INDEX')),
                    })
                );
            }
            return { t: 'data', kind };
        }
        case 'math_number':
        case 'math_number_positive':
            return { t: 'num', v: Number(block.getFieldValue('NUM')) };
        case 'text':
            return { t: 'str', v: String(block.getFieldValue('TEXT') ?? '') };
        case 'logic_boolean':
            return { t: 'bool', v: block.getFieldValue('BOOL') === 'TRUE' };
        case 'logic_null':
            return { t: 'null' };
        case 'variables_get':
            return { t: 'var', name: getVariableName(block) };
        case 'math_number_property': {
            const prop = String(block.getFieldValue('PROPERTY')) as TNumberProperty;
            return {
                t: 'numprop',
                prop,
                a: compileInput(block, 'NUMBER_TO_CHECK'),
                divisor: prop === 'DIVISIBLE_BY' ? compileInput(block, 'DIVISOR') : null,
            };
        }
        case 'text_prompt_ext':
            return {
                t: 'prompt',
                kind: block.getFieldValue('TYPE') === 'NUMBER' ? 'NUMBER' : 'TEXT',
                message: compileInput(block, 'TEXT'),
            };
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
        case 'math_modulo':
            return { t: 'mod', a: compileInput(block, 'DIVIDEND'), b: compileInput(block, 'DIVISOR') };
        case 'math_round':
            return { t: 'round', op: block.getFieldValue('OP'), a: compileInput(block, 'NUM') };
        case 'math_random_int':
            return { t: 'rand', from: compileInput(block, 'FROM'), to: compileInput(block, 'TO') };
        case BLOCK_TYPES.PROCEDURE_CALL_RETURN:
            return { t: 'call', name: String(block.getFieldValue('NAME')), args: compileArguments(block) };
        case BLOCK_TYPES.SMA:
        case BLOCK_TYPES.EMA:
        case BLOCK_TYPES.RSI:
            return {
                t: 'indicator',
                ind: block.type as 'sma' | 'ema' | 'rsi',
                source: indicatorSource(block),
                period: compileInput(block, 'PERIOD'),
            };
        case BLOCK_TYPES.BOLLINGER:
            return {
                t: 'indicator',
                ind: 'bb',
                source: indicatorSource(block),
                period: compileInput(block, 'PERIOD'),
                band: block.getFieldValue('BBRESULT_LIST') as 'upper' | 'middle' | 'lower',
                up: compileInput(block, 'UPMULTIPLIER'),
                down: compileInput(block, 'DOWNMULTIPLIER'),
            };
        case BLOCK_TYPES.READ_OHLC:
            return { t: 'candle', field: candleField(block), index: compileInput(block, 'CANDLEINDEX') };
        case BLOCK_TYPES.CHECK_DIRECTION:
            return { t: 'direction', dir: block.getFieldValue('CHECK_DIRECTION') as 'rise' | 'fall' | 'no_change' };
        case BLOCK_TYPES.TICKS:
        case BLOCK_TYPES.OHLC_VALUES:
            return throwCompile(
                localize(
                    'The "{{block}}" block is a list of prices. Plug it into an indicator block such as the moving average.',
                    { block: block.type }
                )
            );
        default:
            return unsupported(block);
    }
};

const compileStatement = (block: Blockly.Block): TStmt => {
    switch (block.type) {
        case 'controls_if': {
            // Blockly keeps the else-if/else counts of an if block in these underscore-suffixed fields
            /* eslint-disable no-underscore-dangle */
            const mutation = block as TIfBlock;
            const branch_count = (mutation.elseifCount_ ?? 0) + 1;
            const branches = Array.from({ length: branch_count }, (_unused, index) => ({
                cond: compileInput(block, `IF${index}`),
                body: compileStack(block.getInputTargetBlock(`DO${index}`)),
            }));
            const otherwise = mutation.elseCount_ ? compileStack(block.getInputTargetBlock('ELSE')) : [];
            /* eslint-enable no-underscore-dangle */
            return { t: 'if', branches, otherwise };
        }
        case 'controls_repeat_ext':
            return {
                t: 'repeat',
                times: compileInput(block, 'TIMES'),
                body: compileStack(block.getInputTargetBlock('DO')),
            };
        case 'controls_whileUntil':
            return {
                t: 'while',
                until: block.getFieldValue('MODE') === 'UNTIL',
                cond: compileInput(block, 'BOOL'),
                body: compileStack(block.getInputTargetBlock('DO')),
            };
        case 'controls_flow_statements':
            return { t: 'flow', kind: block.getFieldValue('FLOW') === 'CONTINUE' ? 'CONTINUE' : 'BREAK' };
        case 'variables_set':
            return { t: 'set', name: getVariableName(block), value: compileInput(block, 'VALUE') };
        case 'math_change': {
            const name = getVariableName(block);
            return {
                t: 'set',
                name,
                value: { t: 'arith', op: 'ADD', a: { t: 'var', name }, b: compileInput(block, 'DELTA') },
            };
        }
        case 'text_print':
            return { t: 'notify', level: 'info', message: compileInput(block, 'TEXT') };
        case 'text_join': {
            // Deriv Bot's "set VARIABLE to create text with ..." statement
            const parts: TExpr[] = [];
            for (let part = block.getInputTargetBlock('STACK'); part; part = part.getNextBlock()) {
                if (part.isEnabled()) parts.push(compileInput(part, 'TEXT'));
            }
            return { t: 'set', name: String(block.getField('VARIABLE')?.getText() ?? ''), value: { t: 'join', parts } };
        }
        case BLOCK_TYPES.NOTIFY:
            return {
                t: 'notify',
                level: block.getFieldValue('NOTIFICATION_TYPE') as TLevel,
                message: compileInput(block, 'MESSAGE'),
            };
        case BLOCK_TYPES.TIMEOUT:
            return {
                t: 'timeout',
                seconds: compileInput(block, 'SECONDS'),
                body: compileStack(block.getInputTargetBlock('TIMEOUTSTACK')),
            };
        case BLOCK_TYPES.TRADE_OPTIONS:
            return {
                t: 'set_options',
                duration_unit: String(block.getFieldValue('DURATIONTYPE_LIST')),
                duration: compileInput(block, 'DURATION'),
                amount: compileInput(block, 'AMOUNT'),
                prediction: block.getInputTargetBlock('PREDICTION') ? compileInput(block, 'PREDICTION') : null,
            };
        case BLOCK_TYPES.PURCHASE:
            return { t: 'purchase', contract_type: block.getFieldValue('PURCHASE_LIST') };
        case BLOCK_TYPES.SELL_AT_MARKET:
            return { t: 'sell' };
        case BLOCK_TYPES.TRADE_AGAIN:
            return { t: 'trade_again' };
        case BLOCK_TYPES.PROCEDURE_CALL:
            return { t: 'call', name: String(block.getFieldValue('NAME')), args: compileArguments(block) };
        case BLOCK_TYPES.PROCEDURE_IF_RETURN:
            return {
                t: 'return',
                cond: compileInput(block, 'CONDITION'),
                value: block.getInputTargetBlock('VALUE') ? compileInput(block, 'VALUE') : null,
            };
        default:
            return unsupported(block);
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

const findInStack = (first: Blockly.Block | null, type: string) => {
    for (let block = first; block; block = block.getNextBlock()) {
        if (block.type === type && block.isEnabled()) return block;
    }
    return null;
};

const compileSetup = (trade_block: Blockly.Block): TTradeSetup => {
    const stack = trade_block.getInputTargetBlock('TRADE_OPTIONS');
    const market = findInStack(stack, BLOCK_TYPES.MARKET);
    const trade_type = findInStack(stack, BLOCK_TYPES.TRADE_TYPE);
    if (!market) throw new CompileError(localize('Missing block: Market.'));
    if (!trade_type) throw new CompileError(localize('Missing block: Trade type.'));

    const contract = findInStack(stack, BLOCK_TYPES.CONTRACT_TYPE);
    const candle = findInStack(stack, BLOCK_TYPES.CANDLE_INTERVAL);
    const restart_buy_sell = findInStack(stack, BLOCK_TYPES.RESTART_BUY_SELL);
    const restart_on_error = findInStack(stack, BLOCK_TYPES.RESTART_ON_ERROR);

    return {
        symbol: String(market.getFieldValue('SYMBOL_LIST')),
        trade_type: String(trade_type.getFieldValue('TRADETYPE_LIST')),
        contract_type: String(contract?.getFieldValue('TYPE_LIST') ?? 'both'),
        candle_interval: Number(candle?.getFieldValue('CANDLEINTERVAL_LIST') ?? 60),
        restart_buy_sell: restart_buy_sell?.getFieldValue('TIME_MACHINE_ENABLED') !== 'FALSE',
        restart_on_error: restart_on_error?.getFieldValue('RESTARTONERROR') === 'TRUE',
    };
};

/** The first trade options block anywhere in the trade parameters script, however deep it sits. */
const findNestedOptions = (first: Blockly.Block | null) =>
    first?.getDescendants(false).find(block => block.type === BLOCK_TYPES.TRADE_OPTIONS && block.isEnabled()) ?? null;

const compileOptions = (trade_block: Blockly.Block, trade_type: string): TTradeOptions => {
    const stack = trade_block.getInputTargetBlock('SUBMARKET');
    const options = findInStack(stack, BLOCK_TYPES.TRADE_OPTIONS) ?? findNestedOptions(stack);
    if (!options) throw new CompileError(localize('Missing block: Trade options (duration and stake).'));
    return {
        duration_unit: String(options.getFieldValue('DURATIONTYPE_LIST')),
        duration: compileInput(options, 'DURATION'),
        amount: compileInput(options, 'AMOUNT'),
        prediction: TRADE_TYPES[trade_type]?.needs_prediction ? compileInput(options, 'PREDICTION') : null,
    };
};

const compileProcedures = (workspace: Blockly.Workspace): Record<string, TProcedure> => {
    const procedures: Record<string, TProcedure> = {};
    workspace
        .getTopBlocks(false)
        .filter(
            block =>
                block.isEnabled() &&
                (block.type === BLOCK_TYPES.PROCEDURE_DEF || block.type === BLOCK_TYPES.PROCEDURE_DEF_RETURN)
        )
        .forEach(block => {
            const name = String(block.getFieldValue('NAME'));
            if (procedures[name]) {
                throw new CompileError(localize('Two functions are named "{{name}}".', { name }));
            }
            procedures[name] = {
                name,
                params: (block as TLegacyProcedureBlock).getVars?.() ?? [],
                body: compileStack(block.getInputTargetBlock('STACK')),
                returns:
                    block.type === BLOCK_TYPES.PROCEDURE_DEF_RETURN && block.getInputTargetBlock('RETURN')
                        ? compileInput(block, 'RETURN')
                        : null,
            };
        });
    return procedures;
};

/** Which price histories the enabled blocks read, so the runner can load them before it starts. */
const findSeriesUse = (workspace: Blockly.Workspace) => {
    const blocks = workspace.getAllBlocks(false).filter(block => block.isEnabled() && !block.getInheritedDisabled());
    const has = (...types: string[]) => blocks.some(block => types.includes(block.type));
    return {
        ticks: has(BLOCK_TYPES.TICKS, BLOCK_TYPES.CHECK_DIRECTION),
        candles: has(BLOCK_TYPES.OHLC_VALUES, BLOCK_TYPES.READ_OHLC),
    };
};

/** Turns the blocks on the workspace into a plain program the runner can execute. */
export const compileProgram = (workspace: Blockly.Workspace): TProgram => {
    const trade_block = findRoot(workspace, BLOCK_TYPES.TRADE_DEFINITION);
    const before_block = findRoot(workspace, BLOCK_TYPES.BEFORE_PURCHASE);
    const during_block = findRoot(workspace, BLOCK_TYPES.DURING_PURCHASE);
    const after_block = findRoot(workspace, BLOCK_TYPES.AFTER_PURCHASE);

    if (!trade_block) throw new CompileError(localize('Missing block: Trade parameters.'));
    if (!before_block) throw new CompileError(localize('Missing block: Purchase conditions.'));
    if (!after_block) throw new CompileError(localize('Missing block: Restart trading conditions.'));

    const setup = compileSetup(trade_block);
    const options_stack_start = trade_block.getInputTargetBlock('SUBMARKET');
    // options picked by a script (inside ifs, loops, timeouts) rather than a plain trade options block
    const picks_options_at_run_time =
        !findInStack(options_stack_start, BLOCK_TYPES.TRADE_OPTIONS) && Boolean(findNestedOptions(options_stack_start));
    return {
        setup,
        options: compileOptions(trade_block, setup.trade_type),
        options_stack: picks_options_at_run_time ? compileStack(options_stack_start) : null,
        init: compileStack(trade_block.getInputTargetBlock('INITIALIZATION')),
        before_purchase: compileStack(before_block.getInputTargetBlock('BEFOREPURCHASE_STACK')),
        during_purchase: during_block ? compileStack(during_block.getInputTargetBlock('DURING_PURCHASE_STACK')) : [],
        after_purchase: compileStack(after_block.getInputTargetBlock('AFTERPURCHASE_STACK')),
        procedures: compileProcedures(workspace),
        series: findSeriesUse(workspace),
    };
};
