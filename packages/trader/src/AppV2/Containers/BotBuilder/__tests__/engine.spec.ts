import * as Blockly from 'blockly';

import { BLOCK_TYPES, registerBlocks } from '../blocks';
import { getDefaultWorkspaceState, loadWorkspaceState } from '../bot-utils';
import { compileProgram } from '../Engine/compile';
import { evaluate, execute, TInterpreterContext } from '../Engine/interpreter';
import { BotRunner } from '../Engine/runner';
import type { TApiResponse, TBotApi, TLevel, TProgram, TStmt } from '../Engine/types';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

describe('compileProgram', () => {
    beforeAll(() => registerBlocks());

    it('compiles the starter bot', () => {
        const workspace = new Blockly.Workspace();
        loadWorkspaceState(workspace, getDefaultWorkspaceState());
        expect(compileProgram(workspace)).toEqual({
            trade: { symbol: '1HZ100V', contract_type: 'CALL', duration: 5, duration_unit: 't', stake: 1 },
            purchase: [{ t: 'purchase', contract_type: 'CALL' }],
            sell: [],
            restart: [{ t: 'trade_again' }],
        });
        workspace.dispose();
    });

    it('compiles conditions, variables and sell blocks', () => {
        const state = getDefaultWorkspaceState();
        const blocks = state.blocks.blocks as Record<string, unknown>[];
        blocks[1] = {
            type: BLOCK_TYPES.BEFORE_PURCHASE,
            id: 'before_purchase',
            inputs: {
                STACK: {
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
                            DO0: { block: { type: BLOCK_TYPES.PURCHASE, fields: { PURCHASE_TYPE: 'CALL' } } },
                        },
                    },
                },
            },
        };
        blocks[2] = {
            type: BLOCK_TYPES.SELL_CONDITIONS,
            id: 'sell_conditions',
            inputs: {
                STACK: {
                    block: {
                        type: 'controls_if',
                        inputs: {
                            IF0: { block: { type: BLOCK_TYPES.IS_SELL_AVAILABLE } },
                            DO0: { block: { type: BLOCK_TYPES.SELL_AT_MARKET } },
                        },
                    },
                },
            },
        };
        const workspace = new Blockly.Workspace();
        loadWorkspaceState(workspace, state);
        const program = compileProgram(workspace);
        expect(program.purchase).toEqual([
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
        expect(program.sell).toEqual([
            {
                t: 'if',
                branches: [{ cond: { t: 'data', kind: 'sell_available' }, body: [{ t: 'sell' }] }],
                otherwise: [],
            },
        ]);
        workspace.dispose();
    });

    it('throws when a required input is empty', () => {
        const state = getDefaultWorkspaceState();
        (state.blocks.blocks as Record<string, unknown>[])[1] = {
            type: BLOCK_TYPES.BEFORE_PURCHASE,
            id: 'before_purchase',
            inputs: { STACK: { block: { type: 'controls_if' } } },
        };
        const workspace = new Blockly.Workspace();
        loadWorkspaceState(workspace, state);
        expect(() => compileProgram(workspace)).toThrow(/missing its "IF0" input/);
        workspace.dispose();
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
});

type TFakeApi = TBotApi & {
    emitTick: (quote: number, pip_size?: number) => void;
    emitContract: (update: Record<string, unknown>) => void;
    resolveBuy: (response: TApiResponse) => void;
    calls: { proposal: Record<string, unknown>[]; buy: [string, number][]; sell: [number, number][] };
    unsubscribed: string[];
};

const createFakeApi = (): TFakeApi => {
    const callbacks: Record<string, (response: TApiResponse) => void> = {};
    const unsubscribed: string[] = [];
    let buy_resolve: (response: TApiResponse) => void = () => undefined;
    const calls: TFakeApi['calls'] = { proposal: [], buy: [], sell: [] };
    const subscription = (name: string) => ({ unsubscribe: () => unsubscribed.push(name) });
    return {
        subscribeTicks: (_symbol, cb) => {
            callbacks.tick = cb;
            return subscription('tick');
        },
        subscribeProposal: (request, cb) => {
            calls.proposal.push(request);
            callbacks.proposal = cb;
            // proposals answer asynchronously on the real socket
            Promise.resolve().then(() => cb({ proposal: { id: 'prop-1', ask_price: 1 } }));
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
    trade: { symbol: '1HZ100V', contract_type: 'CALL', duration: 5, duration_unit: 't', stake: 1 },
    purchase: [{ t: 'purchase', contract_type: 'CALL' }],
    sell: [],
    restart: [{ t: 'trade_again' }],
    ...overrides,
});

const setup = (
    program: TProgram,
    options: { balance?: number; limits?: { max_trades?: number; max_loss?: number } } = {}
) => {
    const api = createFakeApi();
    const logs: [TLevel, string][] = [];
    const runner = new BotRunner({
        api,
        program,
        currency: 'USD',
        getBalance: () => options.balance ?? 100,
        limits: options.limits,
        onLog: (level, message) => logs.push([level, message]),
        onStats: jest.fn(),
        onStatus: jest.fn(),
    });
    return { api, logs, runner };
};

const bought = { buy: { contract_id: 77, buy_price: 1 } };

describe('BotRunner', () => {
    it('buys on a tick, tracks the contract and records a win', async () => {
        const { api, runner, logs } = setup(baseProgram());
        runner.start();
        api.emitTick(1234.56);
        await flush();

        expect(api.calls.proposal[0]).toMatchObject({
            amount: 1,
            basis: 'stake',
            contract_type: 'CALL',
            currency: 'USD',
            duration: 5,
            duration_unit: 't',
            symbol: '1HZ100V',
        });
        expect(api.calls.buy).toEqual([['prop-1', 1]]);

        api.resolveBuy(bought);
        await flush();
        api.emitContract({ profit: 0.95, is_sold: 1, status: 'won' });

        expect(runner.getStats()).toMatchObject({ runs: 1, won: 1, lost: 0, total_profit: 0.95 });
        expect(logs.some(([level, message]) => level === 'success' && message.includes('won'))).toBe(true);
        expect(runner.getStatus()).toBe('running');
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
            purchase: [
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
            sell: [
                {
                    t: 'if',
                    branches: [
                        {
                            cond: {
                                t: 'cmp',
                                op: 'GT',
                                a: { t: 'data', kind: 'current_profit' },
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
        const { api, runner, logs } = setup(baseProgram({ restart: [] }));
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
        expect(logs.some(([, message]) => message.includes('Loss limit'))).toBe(true);
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
});
