import * as Blockly from 'blockly';

import { registerBlocks } from '../blocks';
import { loadParsedBot, parseBotFile } from '../bot-utils';
import { compileProgram } from '../Engine/compile';
import { evaluate, TInterpreterContext } from '../Engine/interpreter';
import { BotRunner } from '../Engine/runner';
import type { TApiResponse, TBotApi, TExpr, TLevel, TTradeRequest } from '../Engine/types';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const context = (overrides: Partial<TInterpreterContext> = {}): TInterpreterContext => ({
    vars: new Map(),
    read: () => 0,
    notify: jest.fn(),
    purchase: jest.fn(),
    sell: jest.fn(),
    tradeAgain: jest.fn(),
    ...overrides,
});

const num = (v: number): TExpr => ({ t: 'num', v });
const numprop = (prop: 'EVEN' | 'ODD' | 'PRIME' | 'WHOLE' | 'POSITIVE' | 'NEGATIVE' | 'DIVISIBLE_BY', v: number) =>
    evaluate({ t: 'numprop', prop, a: num(v), divisor: prop === 'DIVISIBLE_BY' ? num(3) : null }, context());

describe('null, number properties and prompts', () => {
    it('treats null as nothing: equal only to null, zero in arithmetic', () => {
        const ctx = context();
        const isNull = (op: 'EQ' | 'NEQ', other: TExpr) => evaluate({ t: 'cmp', op, a: { t: 'null' }, b: other }, ctx);
        expect(isNull('EQ', { t: 'null' })).toBe(true);
        expect(isNull('NEQ', { t: 'null' })).toBe(false);
        expect(isNull('EQ', num(0))).toBe(false);
        expect(isNull('NEQ', { t: 'str', v: '' })).toBe(true);
        expect(evaluate({ t: 'arith', op: 'ADD', a: { t: 'null' }, b: num(2) }, ctx)).toBe(2);
    });

    it('keeps a variable set to null as null, while an unset variable reads 0', () => {
        const ctx = context({ vars: new Map([['trader', null]]) });
        expect(evaluate({ t: 'var', name: 'trader' }, ctx)).toBeNull();
        expect(evaluate({ t: 'var', name: 'never_set' }, ctx)).toBe(0);
    });

    it('tests number properties like Blockly does', () => {
        expect(numprop('EVEN', 4)).toBe(true);
        expect(numprop('EVEN', 7)).toBe(false);
        expect(numprop('ODD', 7)).toBe(true);
        expect(numprop('PRIME', 7)).toBe(true);
        expect(numprop('PRIME', 9)).toBe(false);
        expect(numprop('PRIME', 1)).toBe(false);
        expect(numprop('WHOLE', 2.5)).toBe(false);
        expect(numprop('POSITIVE', 3)).toBe(true);
        expect(numprop('NEGATIVE', -3)).toBe(true);
        expect(numprop('DIVISIBLE_BY', 9)).toBe(true);
        expect(numprop('DIVISIBLE_BY', 10)).toBe(false);
    });

    it('asks the person through the prompt function, and refuses when none is available', () => {
        const prompt = jest.fn(() => 12);
        const question: TExpr = { t: 'prompt', kind: 'NUMBER', message: { t: 'str', v: 'Take profit?' } };
        expect(evaluate(question, context({ prompt }))).toBe(12);
        expect(prompt).toHaveBeenCalledWith('Take profit?', 'NUMBER');
        expect(() => evaluate(question, context())).toThrow('cannot be answered here');
    });
});

/** A small Binary Bot style file: the trade options are chosen by a script, inside a timeout, before every trade. */
const BOT_XML = `<xml xmlns="http://www.w3.org/1999/xhtml">
  <variables><variable id="v1">stake</variable><variable id="v2">trader</variable></variables>
  <block type="trade" id="t1" x="0" y="0">
    <field name="MARKET_LIST">synthetic_index</field>
    <field name="SUBMARKET_LIST">random_index</field>
    <field name="SYMBOL_LIST">R_50</field>
    <field name="TRADETYPECAT_LIST">digits</field>
    <field name="TRADETYPE_LIST">matchesdiffers</field>
    <field name="TYPE_LIST">DIGITDIFF</field>
    <field name="CANDLEINTERVAL_LIST">60</field>
    <field name="TIME_MACHINE_ENABLED">FALSE</field>
    <field name="RESTARTONERROR">TRUE</field>
    <statement name="INITIALIZATION">
      <block type="variables_set"><field name="VAR" id="v1">stake</field>
        <value name="VALUE"><block type="math_number"><field name="NUM">0.5</field></block></value>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="variables_set"><field name="VAR" id="v2">trader</field>
        <value name="VALUE"><block type="logic_null"></block></value>
        <next>
          <block type="controls_whileUntil"><field name="MODE">UNTIL</field>
            <value name="BOOL">
              <block type="logic_compare"><field name="OP">NEQ</field>
                <value name="A"><block type="variables_get"><field name="VAR" id="v2">trader</field></block></value>
                <value name="B"><block type="logic_null"></block></value>
              </block>
            </value>
            <statement name="DO">
              <block type="variables_set"><field name="VAR" id="v2">trader</field>
                <value name="VALUE"><block type="text"><field name="TEXT">go</field></block></value>
                <next>
                  <block type="timeout">
                    <statement name="TIMEOUTSTACK">
                      <block type="tradeOptions"><field name="DURATIONTYPE_LIST">t</field>
                        <value name="DURATION"><shadow type="math_number"><field name="NUM">3</field></shadow></value>
                        <value name="AMOUNT"><shadow type="math_number"><field name="NUM">1</field></shadow>
                          <block type="variables_get"><field name="VAR" id="v1">stake</field></block>
                        </value>
                        <value name="PREDICTION"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
                      </block>
                    </statement>
                    <value name="SECONDS"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
                  </block>
                </next>
              </block>
            </statement>
          </block>
        </next>
      </block>
    </statement>
  </block>
  <block type="before_purchase" id="b1">
    <statement name="BEFOREPURCHASE_STACK"><block type="purchase"><field name="PURCHASE_LIST">DIGITDIFF</field></block></statement>
  </block>
  <block type="after_purchase" id="a1">
    <statement name="AFTERPURCHASE_STACK">
      <block type="math_change"><field name="VAR" id="v1">stake</field>
        <value name="DELTA"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
        <next><block type="trade_again"></block></next>
      </block>
    </statement>
  </block>
</xml>`;

describe('a bot that picks its trade options at run time', () => {
    beforeAll(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
    afterAll(() => jest.restoreAllMocks());
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const flush = async () => {
        for (let step = 0; step < 6; step += 1) {
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve();
        }
    };

    it('imports, compiles and trades with the options its script chooses before each trade', async () => {
        const parsed = parseBotFile(BOT_XML);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        registerBlocks();
        const workspace = new Blockly.Workspace();
        expect(loadParsedBot(workspace, parsed)).toBe(true);
        const program = compileProgram(workspace);
        expect(program.options_stack).toBeTruthy();

        const proposals: TTradeRequest[] = [];
        const logs: [TLevel, string][] = [];
        let tick: (response: TApiResponse) => void = () => undefined;
        let contract: (response: TApiResponse) => void = () => undefined;
        const api: TBotApi = {
            subscribeTicks: (_symbol, cb) => {
                tick = cb;
                return { unsubscribe: jest.fn() };
            },
            subscribeProposal: (request, cb) => {
                proposals.push(request);
                Promise.resolve().then(() => cb({ proposal: { id: 'p', ask_price: request.amount } }));
                return { unsubscribe: jest.fn() };
            },
            buy: () => Promise.resolve({ buy: { contract_id: 9, buy_price: 0.5, payout: 1 } }),
            subscribeOpenContract: (_id, cb) => {
                contract = cb;
                return { unsubscribe: jest.fn() };
            },
            sell: () => Promise.resolve({}),
        };
        const runner = new BotRunner({
            api,
            program,
            currency: 'USD',
            getBalance: () => 100,
            limits: { max_loss: 10, keep_running: true },
            onLog: (level, message) => logs.push([level, message]),
            onStats: jest.fn(),
            onStatus: jest.fn(),
        });

        runner.start();
        // nothing is bought until the script's timeout has fired and said what to trade
        tick({ tick: { quote: 100.12, pip_size: 2 } });
        await flush();
        expect(proposals).toHaveLength(0);

        jest.advanceTimersByTime(1000);
        tick({ tick: { quote: 100.13, pip_size: 2 } });
        await flush();
        expect(proposals).toEqual([
            {
                amount: 0.5,
                basis: 'stake',
                contract_type: 'DIGITDIFF',
                currency: 'USD',
                duration: 3,
                duration_unit: 't',
                underlying_symbol: 'R_50',
                barrier: '4',
            },
        ]);

        // a lost trade raises the stake, and the script runs again before the next trade
        contract({ proposal_open_contract: { contract_id: 9, profit: -0.5, is_sold: 1, status: 'lost' } });
        tick({ tick: { quote: 100.14, pip_size: 2 } });
        await flush();
        expect(proposals).toHaveLength(1);
        jest.advanceTimersByTime(1000);
        tick({ tick: { quote: 100.15, pip_size: 2 } });
        await flush();
        expect(proposals).toHaveLength(2);
        expect(proposals[1].amount).toBe(1.5);
        expect(runner.getStatus()).toBe('running');
    });

    it('stops with a clear message when the script never sets any trade options', () => {
        const program = compileFixed();
        const logs: [TLevel, string][] = [];
        const api = { subscribeTicks: () => ({ unsubscribe: jest.fn() }) } as unknown as TBotApi;
        const runner = new BotRunner({
            api,
            program: { ...program, options_stack: [{ t: 'set', name: 'x', value: num(1) }] },
            currency: 'USD',
            getBalance: () => 100,
            onLog: (level, message) => logs.push([level, message]),
            onStats: jest.fn(),
            onStatus: jest.fn(),
        });
        runner.start();
        expect(runner.getStatus()).toBe('stopped');
        expect(logs).toEqual(
            expect.arrayContaining([['error', 'The trade parameters did not set any trade options.']])
        );
    });
});

const compileFixed = () => ({
    setup: {
        symbol: 'R_50',
        trade_type: 'risefall',
        contract_type: 'both',
        candle_interval: 60,
        restart_buy_sell: false,
        restart_on_error: false,
    },
    options: { duration_unit: 't', duration: num(1), amount: num(1), prediction: null },
    init: [],
    before_purchase: [],
    during_purchase: [],
    after_purchase: [],
    procedures: {},
});
