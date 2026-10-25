import * as Blockly from 'blockly';

import { BLOCK_TYPES, registerBlocks } from '../blocks';
import { getDefaultWorkspaceState, loadWorkspaceState } from '../bot-utils';
import { compileProgram } from '../Engine/compile';
import { evaluate, execute, MAX_STEPS, TInterpreterContext } from '../Engine/interpreter';
import { BotRunner } from '../Engine/runner';
import type {
    TApiResponse,
    TBotApi,
    TLevel,
    TLiveContract,
    TProgram,
    TRunLimits,
    TStmt,
    TTradeRequest,
    TTransaction,
} from '../Engine/types';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

type TState = ReturnType<typeof getDefaultWorkspaceState>;

const loadState = (state: TState | Record<string, unknown>) => {
    const workspace = new Blockly.Workspace();
    loadWorkspaceState(workspace, state as Record<string, unknown>);
    return workspace;
};

const num = (value: number) => ({ shadow: { type: 'math_number', fields: { NUM: value } } });

/** Starter bot with one section replaced. Sections are the top-level blocks, by id. */
const withBlock = (id: string, block: Record<string, unknown>): TState => {
    const state = getDefaultWorkspaceState();
    const blocks = state.blocks.blocks as Record<string, unknown>[];
    const index = blocks.findIndex(item => item.id === id);
    blocks[index] = { id, x: 0, y: 0, ...block };
    return state;
};

describe('compileProgram', () => {
    beforeAll(() => registerBlocks());

    it('compiles the starter bot into Deriv Bot sections', () => {
        const workspace = loadState(getDefaultWorkspaceState());
        const program = compileProgram(workspace);

        expect(program.setup).toEqual({
            symbol: '1HZ100V',
            trade_type: 'risefall',
            contract_type: 'both',
            candle_interval: 60,
            restart_buy_sell: false,
            restart_on_error: true,
        });
        expect(program.options).toEqual({
            duration_unit: 't',
            duration: { t: 'num', v: 5 },
            amount: { t: 'num', v: 1 },
            prediction: null,
        });
        expect(program.init).toEqual([]);
        expect(program.before_purchase).toEqual([{ t: 'purchase', contract_type: 'CALL' }]);
        expect(program.during_purchase).toEqual([]);
        expect(program.after_purchase).toEqual([{ t: 'trade_again' }]);
        expect(program.procedures).toEqual({});
        workspace.dispose();
    });

    it('fills in shadow defaults when trade options carry no blocks', () => {
        const state = getDefaultWorkspaceState();
        const trade = (state.blocks.blocks as Record<string, unknown>[])[0] as {
            inputs: { SUBMARKET: { block: Record<string, unknown> } };
        };
        trade.inputs.SUBMARKET.block = { type: BLOCK_TYPES.TRADE_OPTIONS, fields: { DURATIONTYPE_LIST: 't' } };
        const program = compileProgram(loadState(state));
        expect(program.options.duration).toEqual({ t: 'num', v: 5 });
        expect(program.options.amount).toEqual({ t: 'num', v: 1 });
    });

    it('reads the digit prediction for over/under trades', () => {
        const state = getDefaultWorkspaceState();
        const trade = (state.blocks.blocks as Record<string, unknown>[])[0] as {
            inputs: {
                TRADE_OPTIONS: { block: Record<string, unknown> };
                SUBMARKET: { block: Record<string, unknown> };
            };
        };
        trade.inputs.TRADE_OPTIONS.block = {
            type: BLOCK_TYPES.MARKET,
            fields: { MARKET_LIST: 'synthetic_index', SUBMARKET_LIST: 'random_index', SYMBOL_LIST: 'R_100' },
            next: {
                block: {
                    type: BLOCK_TYPES.TRADE_TYPE,
                    fields: { TRADETYPECAT_LIST: 'digits', TRADETYPE_LIST: 'overunder' },
                },
            },
        };
        trade.inputs.SUBMARKET.block = {
            type: BLOCK_TYPES.TRADE_OPTIONS,
            fields: { DURATIONTYPE_LIST: 't' },
            inputs: { DURATION: num(1), AMOUNT: num(2), PREDICTION: num(4) },
        };
        const program = compileProgram(loadState(state));
        expect(program.setup).toMatchObject({ symbol: 'R_100', trade_type: 'overunder', contract_type: 'both' });
        expect(program.options.prediction).toEqual({ t: 'num', v: 4 });
    });

    it('compiles conditions, variables, text and the sell section', () => {
        const state = withBlock('before_purchase', {
            type: BLOCK_TYPES.BEFORE_PURCHASE,
            inputs: {
                BEFOREPURCHASE_STACK: {
                    block: {
                        type: 'controls_if',
                        inputs: {
                            IF0: {
                                block: {
                                    type: 'logic_compare',
                                    fields: { OP: 'GT' },
                                    inputs: {
                                        A: { block: { type: BLOCK_TYPES.LAST_DIGIT } },
                                        B: { block: { type: 'math_number', fields: { NUM: 5 } } },
                                    },
                                },
                            },
                            DO0: { block: { type: BLOCK_TYPES.PURCHASE, fields: { PURCHASE_LIST: 'CALL' } } },
                        },
                    },
                },
            },
        });
        const blocks = state.blocks.blocks as Record<string, unknown>[];
        blocks[2] = {
            type: BLOCK_TYPES.DURING_PURCHASE,
            id: 'during_purchase',
            inputs: {
                DURING_PURCHASE_STACK: {
                    block: {
                        type: 'controls_if',
                        inputs: {
                            IF0: { block: { type: BLOCK_TYPES.SELL_AVAILABLE } },
                            DO0: { block: { type: BLOCK_TYPES.SELL_AT_MARKET } },
                        },
                    },
                },
            },
        };
        const program = compileProgram(loadState(state));
        expect(program.before_purchase).toEqual([
            {
                t: 'if',
                branches: [
                    {
                        cond: {
                            t: 'cmp',
                            op: 'GT',
                            a: { t: 'data', kind: 'last_digit' },
                            b: { t: 'num', v: 5 },
                        },
                        body: [{ t: 'purchase', contract_type: 'CALL' }],
                    },
                ],
                otherwise: [],
            },
        ]);
        expect(program.during_purchase).toEqual([
            {
                t: 'if',
                branches: [{ cond: { t: 'data', kind: 'sell_available' }, body: [{ t: 'sell' }] }],
                otherwise: [],
            },
        ]);
    });

    it('throws when a required input is empty', () => {
        const state = withBlock('before_purchase', {
            type: BLOCK_TYPES.BEFORE_PURCHASE,
            inputs: { BEFOREPURCHASE_STACK: { block: { type: 'controls_if' } } },
        });
        expect(() => compileProgram(loadState(state))).toThrow(/missing its "IF0" input/);
    });

    it('throws when a section is missing', () => {
        const state = getDefaultWorkspaceState();
        const blocks = state.blocks.blocks as Record<string, unknown>[];
        blocks.splice(3, 1); // restart trading conditions
        expect(() => compileProgram(loadState(state))).toThrow(/Restart trading conditions/);
    });

    it('compiles functions with parameters and return values', () => {
        const state = withBlock('before_purchase', {
            type: BLOCK_TYPES.BEFORE_PURCHASE,
            inputs: {
                BEFOREPURCHASE_STACK: {
                    block: {
                        type: BLOCK_TYPES.PROCEDURE_CALL,
                        extraState: { name: 'buy it', params: ['n'] },
                        inputs: { ARG0: { block: { type: 'math_number', fields: { NUM: 3 } } } },
                    },
                },
            },
        });
        (state as Record<string, unknown>).variables = [{ name: 'n', id: 'var-n' }];
        (state.blocks.blocks as Record<string, unknown>[]).push(
            {
                type: BLOCK_TYPES.PROCEDURE_DEF,
                id: 'def1',
                x: 0,
                y: 600,
                extraState: { params: [{ name: 'n', id: 'var-n' }] },
                fields: { NAME: 'buy it' },
                inputs: {
                    STACK: { block: { type: BLOCK_TYPES.PURCHASE, fields: { PURCHASE_LIST: 'PUT' } } },
                },
            },
            {
                type: BLOCK_TYPES.PROCEDURE_DEF_RETURN,
                id: 'def2',
                x: 0,
                y: 700,
                extraState: { params: [{ name: 'n', id: 'var-n' }] },
                fields: { NAME: 'twice' },
                inputs: {
                    RETURN: {
                        block: {
                            type: 'math_arithmetic',
                            fields: { OP: 'MULTIPLY' },
                            inputs: {
                                A: { block: { type: 'variables_get', fields: { VAR: { id: 'var-n' } } } },
                                B: { block: { type: 'math_number', fields: { NUM: 2 } } },
                            },
                        },
                    },
                },
            }
        );
        const program = compileProgram(loadState(state));
        expect(program.before_purchase).toEqual([{ t: 'call', name: 'buy it', args: [{ t: 'num', v: 3 }] }]);
        expect(program.procedures['buy it']).toEqual({
            name: 'buy it',
            params: ['n'],
            body: [{ t: 'purchase', contract_type: 'PUT' }],
            returns: null,
        });
        expect(program.procedures.twice.params).toEqual(['n']);
        expect(program.procedures.twice.returns).toMatchObject({ t: 'arith', op: 'MULTIPLY' });
    });
});

describe('interpreter', () => {
    const makeContext = (overrides: Partial<TInterpreterContext> = {}): TInterpreterContext => ({
        vars: new Map(),
        read: () => 0,
        notify: jest.fn(),
        purchase: jest.fn(),
        sell: jest.fn(),
        tradeAgain: jest.fn(),
        ...overrides,
    });

    it('evaluates arithmetic, comparison and logic', () => {
        const ctx = makeContext();
        expect(
            evaluate(
                {
                    t: 'arith',
                    op: 'ADD',
                    a: { t: 'num', v: 2 },
                    b: { t: 'arith', op: 'MULTIPLY', a: { t: 'num', v: 3 }, b: { t: 'num', v: 4 } },
                },
                ctx
            )
        ).toBe(14);
        expect(evaluate({ t: 'cmp', op: 'LTE', a: { t: 'num', v: 2 }, b: { t: 'num', v: 2 } }, ctx)).toBe(true);
        expect(
            evaluate(
                { t: 'logic', op: 'AND', a: { t: 'bool', v: true }, b: { t: 'not', a: { t: 'bool', v: true } } },
                ctx
            )
        ).toBe(false);
        expect(evaluate({ t: 'mod', a: { t: 'num', v: 17 }, b: { t: 'num', v: 5 } }, ctx)).toBe(2);
        expect(evaluate({ t: 'round', op: 'ROUNDUP', a: { t: 'num', v: 2.1 } }, ctx)).toBe(3);
    });

    it('joins text and compares strings', () => {
        const ctx = makeContext();
        expect(
            evaluate(
                {
                    t: 'join',
                    parts: [
                        { t: 'str', v: 'Digit ' },
                        { t: 'num', v: 7 },
                    ],
                },
                ctx
            )
        ).toBe('Digit 7');
        expect(evaluate({ t: 'cmp', op: 'EQ', a: { t: 'str', v: 'a' }, b: { t: 'str', v: 'a' } }, ctx)).toBe(true);
    });

    it('refuses to divide by zero', () => {
        expect(() =>
            evaluate({ t: 'arith', op: 'DIVIDE', a: { t: 'num', v: 1 }, b: { t: 'num', v: 0 } }, makeContext())
        ).toThrow('divide by zero');
    });

    it('runs the matching branch, else branch and variable assignments', () => {
        const ctx = makeContext();
        const program: TStmt[] = [
            { t: 'set', name: 'count', value: { t: 'num', v: 3 } },
            {
                t: 'if',
                branches: [
                    {
                        cond: { t: 'cmp', op: 'GT', a: { t: 'var', name: 'count' }, b: { t: 'num', v: 5 } },
                        body: [{ t: 'sell' }],
                    },
                ],
                otherwise: [{ t: 'purchase', contract_type: 'PUT' }],
            },
        ];
        execute(program, ctx);
        expect(ctx.vars.get('count')).toBe(3);
        expect(ctx.sell).not.toHaveBeenCalled();
        expect(ctx.purchase).toHaveBeenCalledWith('PUT');
    });

    it('repeats, breaks and continues', () => {
        const ctx = makeContext();
        execute(
            [
                { t: 'set', name: 'total', value: { t: 'num', v: 0 } },
                {
                    t: 'repeat',
                    times: { t: 'num', v: 10 },
                    body: [
                        {
                            t: 'set',
                            name: 'total',
                            value: { t: 'arith', op: 'ADD', a: { t: 'var', name: 'total' }, b: { t: 'num', v: 1 } },
                        },
                        {
                            t: 'if',
                            branches: [
                                {
                                    cond: {
                                        t: 'cmp',
                                        op: 'GTE',
                                        a: { t: 'var', name: 'total' },
                                        b: { t: 'num', v: 4 },
                                    },
                                    body: [{ t: 'flow', kind: 'BREAK' }],
                                },
                            ],
                            otherwise: [],
                        },
                    ],
                },
            ],
            ctx
        );
        expect(ctx.vars.get('total')).toBe(4);
    });

    it('stops a bot that loops forever', () => {
        const forever: TStmt[] = [{ t: 'while', until: false, cond: { t: 'bool', v: true }, body: [] }];
        expect(() => execute(forever, makeContext())).toThrow('ran for too long');
        expect(MAX_STEPS).toBeGreaterThan(1000);
    });

    it('calls functions with their own parameters and return values', () => {
        const ctx = makeContext({
            procedures: {
                twice: {
                    name: 'twice',
                    params: ['n'],
                    body: [],
                    returns: { t: 'arith', op: 'MULTIPLY', a: { t: 'var', name: 'n' }, b: { t: 'num', v: 2 } },
                },
                shout: {
                    name: 'shout',
                    params: ['n'],
                    body: [{ t: 'set', name: 'n', value: { t: 'num', v: 99 } }, { t: 'sell' }],
                    returns: null,
                },
            },
        });
        ctx.vars.set('n', 1);
        expect(evaluate({ t: 'call', name: 'twice', args: [{ t: 'num', v: 21 }] }, ctx)).toBe(42);
        execute([{ t: 'call', name: 'shout', args: [{ t: 'num', v: 5 }] }], ctx);
        expect(ctx.sell).toHaveBeenCalled();
        // the parameter shadows the global, so the global is untouched
        expect(ctx.vars.get('n')).toBe(1);
    });

    it('stops runaway recursion and unknown functions', () => {
        const ctx = makeContext({
            procedures: {
                loop: { name: 'loop', params: [], body: [{ t: 'call', name: 'loop', args: [] }], returns: null },
            },
        });
        expect(() => execute([{ t: 'call', name: 'loop', args: [] }], ctx)).toThrow('too many times');
        expect(() => execute([{ t: 'call', name: 'nope', args: [] }], makeContext())).toThrow('does not exist');
    });

    it('stops a function early with a return block', () => {
        const ctx = makeContext({
            procedures: {
                early: {
                    name: 'early',
                    params: [],
                    body: [{ t: 'return', cond: { t: 'bool', v: true }, value: null }, { t: 'sell' }],
                    returns: null,
                },
            },
        });
        execute([{ t: 'call', name: 'early', args: [] }], ctx);
        expect(ctx.sell).not.toHaveBeenCalled();
    });

    it('hands timeouts to the scheduler', () => {
        const schedule = jest.fn();
        const body: TStmt[] = [{ t: 'trade_again' }];
        execute([{ t: 'timeout', seconds: { t: 'num', v: 2 }, body }], makeContext({ schedule }));
        expect(schedule).toHaveBeenCalledWith(2, body);
    });
});

type TFakeApi = TBotApi & {
    emitTick: (quote: number, pip_size?: number) => void;
    emitContract: (update: Record<string, unknown>) => void;
    resolveBuy: (response: TApiResponse) => void;
    calls: { proposal: TTradeRequest[]; buy: [string, number][]; sell: [number, number][]; ticks: string[] };
    unsubscribed: string[];
};

const createFakeApi = (): TFakeApi => {
    const callbacks: Record<string, (response: TApiResponse) => void> = {};
    const unsubscribed: string[] = [];
    let buy_resolve: (response: TApiResponse) => void = () => undefined;
    const calls: TFakeApi['calls'] = { proposal: [], buy: [], sell: [], ticks: [] };
    const subscription = (name: string) => ({ unsubscribe: () => unsubscribed.push(name) });
    return {
        subscribeTicks: (symbol, cb) => {
            calls.ticks.push(symbol);
            callbacks.tick = cb;
            return subscription('tick');
        },
        subscribeProposal: (request, cb) => {
            calls.proposal.push(request);
            callbacks.proposal = cb;
            // proposals answer asynchronously on the real socket
            Promise.resolve().then(() => cb({ proposal: { id: 'prop-1', ask_price: request.amount } }));
            return subscription('proposal');
        },
        buy: (proposal_id, price) => {
            calls.buy.push([proposal_id, price]);
            return new Promise(resolve => {
                buy_resolve = resolve;
            });
        },
        subscribeOpenContract: (_id, cb) => {
            callbacks.contract = cb;
            return subscription('contract');
        },
        sell: (contract_id, price) => {
            calls.sell.push([contract_id, price]);
            return Promise.resolve({ sell: { sold_for: price } });
        },
        emitTick: (quote, pip_size = 2) => callbacks.tick({ tick: { quote, pip_size } }),
        emitContract: update => callbacks.contract({ proposal_open_contract: { contract_id: 77, ...update } }),
        resolveBuy: response => buy_resolve(response),
        calls,
        unsubscribed,
    };
};

const flush = () =>
    new Promise(resolve => {
        setTimeout(resolve, 0);
    });

const baseProgram = (overrides: Partial<TProgram> = {}): TProgram => ({
    setup: {
        symbol: '1HZ100V',
        trade_type: 'risefall',
        contract_type: 'both',
        candle_interval: 60,
        restart_buy_sell: false,
        restart_on_error: false,
    },
    options: { duration_unit: 't', duration: { t: 'num', v: 5 }, amount: { t: 'num', v: 1 }, prediction: null },
    init: [],
    before_purchase: [{ t: 'purchase', contract_type: 'CALL' }],
    during_purchase: [],
    after_purchase: [{ t: 'trade_again' }],
    procedures: {},
    ...overrides,
});

const setup = (program: TProgram, options: { balance?: number; limits?: TRunLimits } = {}) => {
    const api = createFakeApi();
    const logs: [TLevel, string][] = [];
    const transactions: TTransaction[] = [];
    const live: (TLiveContract | null)[] = [];
    const runner = new BotRunner({
        api,
        program,
        currency: 'USD',
        getBalance: () => options.balance ?? 100,
        limits: options.limits,
        onLog: (level, message) => logs.push([level, message]),
        onStats: jest.fn(),
        onStatus: jest.fn(),
        onTransaction: transaction => transactions.push(transaction),
        onLiveContract: contract => live.push(contract),
    });
    return { api, live, logs, runner, transactions };
};

const bought = { buy: { contract_id: 77, buy_price: 1, payout: 1.95 } };

describe('BotRunner', () => {
    it('buys on a tick, tracks the contract and records a win', async () => {
        const { api, runner, logs, transactions } = setup(baseProgram());
        runner.start();
        api.emitTick(1234.56);
        await flush();

        expect(api.calls.proposal[0]).toEqual({
            amount: 1,
            basis: 'stake',
            contract_type: 'CALL',
            currency: 'USD',
            duration: 5,
            duration_unit: 't',
            underlying_symbol: '1HZ100V',
        });
        expect(api.calls.buy).toEqual([['prop-1', 1]]);

        api.resolveBuy(bought);
        await flush();
        api.emitContract({ profit: 0.95, sell_price: 1.95, is_sold: 1, status: 'won' });

        expect(runner.getStats()).toMatchObject({
            runs: 1,
            won: 1,
            lost: 0,
            total_profit: 0.95,
            total_stake: 1,
            total_payout: 1.95,
        });
        expect(logs.some(([level, message]) => level === 'success' && message.includes('won'))).toBe(true);
        expect(transactions.map(item => item.status)).toEqual(['open', 'won']);
        expect(runner.getStatus()).toBe('running');
    });

    it('sends the digit prediction as barrier', async () => {
        const program = baseProgram({
            setup: { ...baseProgram().setup, trade_type: 'overunder' },
            options: {
                duration_unit: 't',
                duration: { t: 'num', v: 1 },
                amount: { t: 'num', v: 2 },
                prediction: { t: 'num', v: 4 },
            },
            before_purchase: [{ t: 'purchase', contract_type: 'DIGITOVER' }],
        });
        const { api, runner } = setup(program);
        runner.start();
        api.emitTick(10.25);
        await flush();
        expect(api.calls.proposal[0]).toEqual({
            amount: 2,
            basis: 'stake',
            contract_type: 'DIGITOVER',
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
            underlying_symbol: '1HZ100V',
            barrier: '4',
        });
    });

    it('does not send a barrier for rise/fall and rejects a bad prediction', async () => {
        const rise = setup(baseProgram());
        rise.runner.start();
        rise.api.emitTick(1);
        await flush();
        expect(rise.api.calls.proposal[0]).not.toHaveProperty('barrier');

        const digits = setup(
            baseProgram({
                options: {
                    duration_unit: 't',
                    duration: { t: 'num', v: 1 },
                    amount: { t: 'num', v: 1 },
                    prediction: { t: 'num', v: 12 },
                },
                before_purchase: [{ t: 'purchase', contract_type: 'DIGITMATCH' }],
            })
        );
        digits.runner.start();
        digits.api.emitTick(1);
        await flush();
        expect(digits.api.calls.proposal).toHaveLength(0);
        expect(digits.logs).toEqual(expect.arrayContaining([['error', 'The prediction must be a digit from 0 to 9.']]));
    });

    it('re-evaluates the trade options for every trade', async () => {
        const program = baseProgram({
            init: [{ t: 'set', name: 'stake', value: { t: 'num', v: 1 } }],
            options: {
                duration_unit: 't',
                duration: { t: 'num', v: 5 },
                amount: { t: 'var', name: 'stake' },
                prediction: null,
            },
            after_purchase: [
                {
                    t: 'set',
                    name: 'stake',
                    value: { t: 'arith', op: 'MULTIPLY', a: { t: 'var', name: 'stake' }, b: { t: 'num', v: 2 } },
                },
                { t: 'trade_again' },
            ],
        });
        const { api, runner } = setup(program);
        runner.start();
        api.emitTick(1);
        await flush();
        api.resolveBuy(bought);
        await flush();
        api.emitContract({ profit: -1, is_sold: 1, status: 'lost' });
        api.emitTick(2);
        await flush();
        expect(api.calls.proposal.map(request => request.amount)).toEqual([1, 2]);
    });

    it('runs the first section once, before the first tick', async () => {
        const program = baseProgram({
            init: [{ t: 'notify', level: 'info', message: { t: 'str', v: 'ready' } }],
        });
        const { api, runner, logs } = setup(program);
        runner.start();
        expect(logs.filter(([, message]) => message === 'ready')).toHaveLength(1);
        expect(api.calls.ticks).toEqual(['1HZ100V']);
        api.emitTick(1);
        api.emitTick(2);
        expect(logs.filter(([, message]) => message === 'ready')).toHaveLength(1);
    });

    it('places only one trade while a contract is open', async () => {
        const { api, runner } = setup(baseProgram());
        runner.start();
        api.emitTick(1);
        api.emitTick(2);
        await flush();
        api.resolveBuy(bought);
        await flush();
        api.emitTick(3);
        await flush();
        expect(api.calls.proposal).toHaveLength(1);
    });

    it('trades again after a finished contract and exposes the last digit and result to blocks', async () => {
        const program = baseProgram({
            before_purchase: [
                {
                    t: 'if',
                    branches: [
                        {
                            cond: { t: 'cmp', op: 'EQ', a: { t: 'data', kind: 'last_digit' }, b: { t: 'num', v: 7 } },
                            body: [{ t: 'purchase', contract_type: 'CALL' }],
                        },
                    ],
                    otherwise: [],
                },
            ],
        });
        const { api, runner } = setup(program);
        runner.start();
        api.emitTick(100.12); // digit 2, no purchase
        await flush();
        expect(api.calls.proposal).toHaveLength(0);
        api.emitTick(100.17); // digit 7
        await flush();
        expect(api.calls.proposal).toHaveLength(1);
        api.resolveBuy(bought);
        await flush();
        api.emitContract({ profit: -1, is_sold: 1, status: 'lost' });
        expect(runner.getStats()).toMatchObject({ runs: 1, lost: 1, total_profit: -1 });
        api.emitTick(100.27);
        await flush();
        expect(api.calls.proposal).toHaveLength(2);
    });

    it('sells at market when the sell conditions ask for it', async () => {
        const program = baseProgram({
            during_purchase: [
                {
                    t: 'if',
                    branches: [
                        {
                            cond: {
                                t: 'cmp',
                                op: 'GT',
                                a: { t: 'data', kind: 'detail_profit' },
                                b: { t: 'num', v: 0.5 },
                            },
                            body: [{ t: 'sell' }],
                        },
                    ],
                    otherwise: [],
                },
            ],
        });
        const { api, runner } = setup(program);
        runner.start();
        api.emitTick(1);
        await flush();
        api.resolveBuy(bought);
        await flush();
        api.emitContract({ profit: 0.2, bid_price: 1.2, is_valid_to_sell: 1, is_sold: 0 });
        expect(api.calls.sell).toHaveLength(0);
        api.emitContract({ profit: 0.8, bid_price: 1.8, is_valid_to_sell: 1, is_sold: 0 });
        expect(api.calls.sell).toEqual([[77, 1.8]]);
        api.emitContract({ profit: 0.9, bid_price: 1.9, is_valid_to_sell: 1, is_sold: 0 });
        expect(api.calls.sell).toHaveLength(1); // not sold twice while the first sell is pending
    });

    it('stops with a message when the restart conditions do not trade again', async () => {
        const { api, runner, logs } = setup(baseProgram({ after_purchase: [] }));
        runner.start();
        api.emitTick(1);
        await flush();
        api.resolveBuy(bought);
        await flush();
        api.emitContract({ profit: 1, is_sold: 1, status: 'won' });
        expect(runner.getStatus()).toBe('stopped');
        expect(logs.some(([, message]) => message.includes('did not ask to trade again'))).toBe(true);
        expect(api.unsubscribed).toEqual(expect.arrayContaining(['tick', 'contract']));
    });

    it('waits for an open contract before stopping when asked to stop', async () => {
        const { api, runner } = setup(baseProgram());
        runner.start();
        api.emitTick(1);
        await flush();
        api.resolveBuy(bought);
        await flush();
        runner.stop();
        expect(runner.getStatus()).toBe('stopping');
        api.emitContract({ profit: 1, is_sold: 1, status: 'won' });
        expect(runner.getStatus()).toBe('stopped');
        expect(runner.getStats().runs).toBe(1);
    });

    it('stops straight away when idle between trades', () => {
        const { api, runner } = setup(baseProgram());
        runner.start();
        runner.stop();
        expect(runner.getStatus()).toBe('stopped');
        expect(api.unsubscribed).toContain('tick');
    });

    it('does not buy when the balance is below the stake', async () => {
        const { api, runner, logs } = setup(baseProgram(), { balance: 0.5 });
        runner.start();
        api.emitTick(1);
        await flush();
        expect(api.calls.proposal).toHaveLength(0);
        expect(runner.getStatus()).toBe('stopped');
        expect(logs.some(([level, message]) => level === 'error' && message.includes('balance'))).toBe(true);
    });

    it('stops when the loss limit is reached', async () => {
        const { api, runner, logs } = setup(baseProgram(), { limits: { max_loss: 2 } });
        runner.start();
        api.emitTick(1);
        await flush();
        api.resolveBuy(bought);
        await flush();
        api.emitContract({ profit: -2, is_sold: 1, status: 'lost' });
        expect(runner.getStatus()).toBe('stopped');
        expect(logs.some(([, message]) => message.includes('Stop loss'))).toBe(true);
    });

    it('stops at the take profit', async () => {
        const { api, runner, logs } = setup(baseProgram(), { limits: { max_profit: 1.5 } });
        runner.start();
        api.emitTick(1);
        await flush();
        api.resolveBuy(bought);
        await flush();
        api.emitContract({ profit: 0.95, sell_price: 1.95, is_sold: 1, status: 'won' });
        expect(runner.getStatus()).toBe('running');
        api.emitTick(2);
        await flush();
        api.resolveBuy(bought);
        await flush();
        api.emitContract({ profit: 0.95, sell_price: 1.95, is_sold: 1, status: 'won' });
        expect(runner.getStatus()).toBe('stopped');
        expect(logs.some(([, message]) => message.includes('Take profit'))).toBe(true);
    });

    it('keeps trading until a limit is hit when the restart conditions do not ask to trade again', async () => {
        const program = baseProgram({ after_purchase: [] });
        const { api, runner } = setup(program, { limits: { max_loss: 5, keep_running: true } });
        runner.start();
        const playRound = async (tick: number) => {
            api.emitTick(tick);
            await flush();
            api.resolveBuy(bought);
            await flush();
            api.emitContract({ profit: -1, is_sold: 1, status: 'lost' });
            expect(runner.getStatus()).toBe('running');
        };
        await playRound(1);
        await playRound(2);
        await playRound(3);
        expect(api.calls.proposal).toHaveLength(3);
    });

    it('reports the live contract with its tick progress, and the entry and exit spots of each transaction', async () => {
        const program = baseProgram();
        const { api, live, runner, transactions } = setup(program);
        runner.start();
        api.emitTick(1);
        await flush();
        api.resolveBuy(bought);
        await flush();
        api.emitContract({
            profit: 0.2,
            bid_price: 1.2,
            payout: 1.95,
            is_valid_to_sell: 0,
            is_sold: 0,
            entry_spot_display_value: '1061.49',
            tick_stream: [{ epoch: 1 }, { epoch: 2 }],
        });
        expect(live[live.length - 1]).toMatchObject({
            contract_id: 77,
            contract_type: 'CALL',
            symbol: '1HZ100V',
            profit: 0.2,
            current_value: 1.2,
            resale_offered: false,
            tick_current: 2,
            tick_total: 5,
        });
        api.emitContract({
            profit: -1,
            is_sold: 1,
            status: 'lost',
            exit_tick_display_value: '1061.15',
            entry_spot_display_value: '1061.49',
        });
        expect(live[live.length - 1]).toBeNull();
        expect(transactions[transactions.length - 1]).toMatchObject({
            status: 'lost',
            symbol: '1HZ100V',
            entry_spot: '1061.49',
            exit_spot: '1061.15',
        });
    });

    it('stops after the trade limit', async () => {
        const { api, runner } = setup(baseProgram(), { limits: { max_trades: 1 } });
        runner.start();
        api.emitTick(1);
        await flush();
        api.resolveBuy(bought);
        await flush();
        api.emitContract({ profit: 1, is_sold: 1, status: 'won' });
        expect(runner.getStatus()).toBe('stopped');
        expect(api.calls.proposal).toHaveLength(1);
    });

    it('refuses a purchase that the trade parameters do not allow', async () => {
        const program = baseProgram({ setup: { ...baseProgram().setup, contract_type: 'PUT' } });
        const { api, runner, logs } = setup(program);
        runner.start();
        api.emitTick(1);
        await flush();
        expect(api.calls.proposal).toHaveLength(0);
        expect(runner.getStatus()).toBe('stopped');
        expect(logs.some(([level, message]) => level === 'error' && message.includes('may only buy'))).toBe(true);
    });

    it('stops with the server message when a proposal fails', async () => {
        const { api, runner, logs } = setup(baseProgram());
        api.subscribeProposal = (_request, cb) => {
            Promise.resolve().then(() => cb({ error: { message: 'Market is closed' } }));
            return { unsubscribe: jest.fn() };
        };
        runner.start();
        api.emitTick(1);
        await flush();
        expect(runner.getStatus()).toBe('stopped');
        expect(logs).toEqual(expect.arrayContaining([['error', 'Market is closed']]));
    });

    it('stops with the server message when the purchase is rejected', async () => {
        const { api, runner, logs } = setup(baseProgram());
        runner.start();
        api.emitTick(1);
        await flush();
        api.resolveBuy({ error: { message: 'Insufficient balance' } });
        await flush();
        expect(runner.getStatus()).toBe('stopped');
        expect(logs).toEqual(expect.arrayContaining([['error', 'Insufficient balance']]));
    });

    it('skips a failed trade and carries on when restart on error is on', async () => {
        const program = baseProgram({ setup: { ...baseProgram().setup, restart_on_error: true } });
        const { api, runner, logs } = setup(program);
        runner.start();
        api.emitTick(1);
        await flush();
        api.resolveBuy({ error: { message: 'Try later' } });
        await flush();
        expect(runner.getStatus()).toBe('running');
        expect(logs.some(([level, message]) => level === 'warn' && message.includes('Trade skipped'))).toBe(true);
        api.emitTick(2);
        await flush();
        expect(api.calls.proposal).toHaveLength(2);
    });

    describe('timeouts', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        const finishFirstTrade = async (api: TFakeApi) => {
            api.emitTick(1);
            await jest.advanceTimersByTimeAsync(0);
            api.resolveBuy(bought);
            await jest.advanceTimersByTimeAsync(0);
            api.emitContract({ profit: 1, is_sold: 1, status: 'won' });
        };

        it('waits before trading again', async () => {
            const program = baseProgram({
                after_purchase: [{ t: 'timeout', seconds: { t: 'num', v: 5 }, body: [{ t: 'trade_again' }] }],
            });
            const { api, runner } = setup(program);
            runner.start();
            await finishFirstTrade(api);

            expect(runner.getStatus()).toBe('running');
            api.emitTick(2);
            await jest.advanceTimersByTimeAsync(0);
            expect(api.calls.proposal).toHaveLength(1); // still waiting

            await jest.advanceTimersByTimeAsync(5000);
            api.emitTick(3);
            await jest.advanceTimersByTimeAsync(0);
            expect(api.calls.proposal).toHaveLength(2);
        });

        it('cancels pending timeouts when the bot stops', async () => {
            const program = baseProgram({
                after_purchase: [{ t: 'timeout', seconds: { t: 'num', v: 5 }, body: [{ t: 'trade_again' }] }],
            });
            const { api, runner } = setup(program);
            runner.start();
            await finishFirstTrade(api);
            runner.stop();
            expect(runner.getStatus()).toBe('stopped');
            await jest.advanceTimersByTimeAsync(10_000);
            api.emitTick(2);
            expect(api.calls.proposal).toHaveLength(1);
        });

        it('finishes when a timeout ran and still did not ask to trade again', async () => {
            const program = baseProgram({
                after_purchase: [{ t: 'timeout', seconds: { t: 'num', v: 1 }, body: [] }],
            });
            const { api, runner, logs } = setup(program);
            runner.start();
            await finishFirstTrade(api);
            await jest.advanceTimersByTimeAsync(1000);
            expect(runner.getStatus()).toBe('stopped');
            expect(logs.some(([, message]) => message.includes('did not ask to trade again'))).toBe(true);
        });
    });
});
