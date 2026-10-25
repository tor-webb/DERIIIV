import * as Blockly from 'blockly';

import { registerBlocks } from '../blocks';
import { loadParsedBot, parseBotFile, validateBot } from '../bot-utils';
import { compileProgram } from '../Engine/compile';
import { BotRunner } from '../Engine/runner';
import type { TApiResponse, TBotApi, TLevel, TTradeRequest } from '../Engine/types';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

/*
 * Reduced reproductions of the two kinds of file users bring: a bot exported from Deriv Bot, and an older Binary
 * Bot file. They keep the structure of real bots (shadows with blocks on top, mutations, the "create text with"
 * statement, read_details 4 as the profit) with text of our own.
 */

const SETTINGS = `
  <statement name="TRADE_OPTIONS">
    <block type="trade_definition_market"><field name="MARKET_LIST">synthetic_index</field><field name="SUBMARKET_LIST">random_index</field><field name="SYMBOL_LIST">1HZ75V</field>
      <next><block type="trade_definition_tradetype"><field name="TRADETYPECAT_LIST">digits</field><field name="TRADETYPE_LIST">overunder</field>
        <next><block type="trade_definition_contracttype"><field name="TYPE_LIST">both</field>
          <next><block type="trade_definition_candleinterval"><field name="CANDLEINTERVAL_LIST">60</field>
            <next><block type="trade_definition_restartbuysell"><field name="TIME_MACHINE_ENABLED">FALSE</field>
              <next><block type="trade_definition_restartonerror"><field name="RESTARTONERROR">TRUE</field></block></next>
            </block></next>
          </block></next>
        </block></next>
      </block></next>
    </block>
  </statement>`;

const MODERN_BOT = `<xml xmlns="http://www.w3.org/1999/xhtml" is_dbot="true" collection="false">
  <variables>
    <variable id="v_stake">Stake</variable>
    <variable id="v_lost">Total Lost</variable>
    <variable id="v_text">text</variable>
  </variables>
  <block type="trade_definition" deletable="false" x="0" y="0">
    ${SETTINGS}
    <statement name="INITIALIZATION">
      <block type="text_print"><value name="TEXT"><shadow type="text"><field name="TEXT">Hello</field></shadow></value>
        <next><block type="variables_set"><field name="VAR" id="v_stake">Stake</field><value name="VALUE"><block type="math_number"><field name="NUM">0.7</field></block></value></block></next>
      </block>
    </statement>
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions">
        <mutation has_first_barrier="false" has_second_barrier="false" has_prediction="true"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <value name="DURATION"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
        <value name="AMOUNT"><shadow type="math_number"><field name="NUM">1</field></shadow><block type="variables_get"><field name="VAR" id="v_stake">Stake</field></block></value>
        <value name="PREDICTION"><shadow type="math_number_positive"><field name="NUM">5</field></shadow></value>
      </block>
    </statement>
  </block>
  <block type="during_purchase" x="500" y="0">
    <statement name="DURING_PURCHASE_STACK">
      <block type="controls_if"><value name="IF0"><block type="check_sell"></block></value></block>
    </statement>
  </block>
  <block type="after_purchase" x="500" y="200">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if">
        <mutation else="1"></mutation>
        <value name="IF0"><block type="contract_check_result"><field name="CHECK_RESULT">loss</field></block></value>
        <statement name="DO0">
          <block type="math_change"><field name="VAR" id="v_lost">Total Lost</field>
            <value name="DELTA"><shadow type="math_number"><field name="NUM">1</field></shadow><block type="variables_get"><field name="VAR" id="v_stake">Stake</field></block></value>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="math_change"><field name="VAR" id="v_lost">Total Lost</field>
            <value name="DELTA"><shadow type="math_number"><field name="NUM">1</field></shadow>
              <block type="math_single"><field name="OP">NEG</field><value name="NUM"><shadow type="math_number"><field name="NUM">9</field></shadow><block type="read_details"><field name="DETAIL_INDEX">4</field></block></value></block>
            </value>
          </block>
        </statement>
        <next>
          <block type="text_join"><field name="VARIABLE" id="v_text">text</field>
            <statement name="STACK">
              <block type="text_statement"><value name="TEXT"><shadow type="text"><field name="TEXT"></field></shadow><block type="text"><field name="TEXT">Result: </field></block></value>
                <next><block type="text_statement"><value name="TEXT"><shadow type="text"><field name="TEXT"></field></shadow><block type="read_details"><field name="DETAIL_INDEX">4</field></block></value></block></next>
              </block>
            </statement>
            <next>
              <block type="notify"><field name="NOTIFICATION_TYPE">info</field><field name="NOTIFICATION_SOUND">silent</field>
                <value name="MESSAGE"><shadow type="text"><field name="TEXT">abc</field></shadow><block type="variables_get"><field name="VAR" id="v_text">text</field></block></value>
                <next><block type="trade_again"></block></next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>
  <block type="before_purchase" deletable="false" x="0" y="400">
    <statement name="BEFOREPURCHASE_STACK"><block type="purchase"><field name="PURCHASE_LIST">DIGITUNDER</field></block></statement>
  </block>
</xml>`;

// an older Binary Bot file: one `trade` block holding the settings as fields, `tradeOptions`, and a value-form join
const LEGACY_BOT = `<xml xmlns="http://www.w3.org/1999/xhtml" collection="false">
  <variables><variable id="v_amount">initial amount</variable></variables>
  <block type="trade" id="trade" x="0" y="0">
    <field name="MARKET_LIST">synthetic_index</field><field name="SUBMARKET_LIST">random_index</field><field name="SYMBOL_LIST">1HZ100V</field>
    <field name="TRADETYPECAT_LIST">digits</field><field name="TRADETYPE_LIST">overunder</field><field name="TYPE_LIST">both</field>
    <field name="CANDLEINTERVAL_LIST">60</field><field name="TIME_MACHINE_ENABLED">FALSE</field><field name="RESTARTONERROR">TRUE</field>
    <statement name="INITIALIZATION">
      <block type="variables_set"><field name="VAR" id="v_amount">initial amount</field><value name="VALUE"><block type="math_number"><field name="NUM">2</field></block></value></block>
    </statement>
    <statement name="SUBMARKET">
      <block type="tradeOptions">
        <field name="DURATIONTYPE_LIST">t</field><field name="CURRENCY_LIST">USD</field>
        <field name="BARRIEROFFSETTYPE_LIST">+</field><field name="SECONDBARRIEROFFSETTYPE_LIST">-</field>
        <value name="DURATION"><block type="math_number"><field name="NUM">1</field></block></value>
        <value name="AMOUNT"><block type="variables_get"><field name="VAR" id="v_amount">initial amount</field></block></value>
        <value name="PREDICTION"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
      </block>
    </statement>
  </block>
  <block type="after_purchase" x="0" y="400">
    <statement name="AFTERPURCHASE_STACK">
      <block type="notify"><field name="NOTIFICATION_TYPE">success</field><field name="NOTIFICATION_SOUND">silent</field>
        <value name="MESSAGE">
          <block type="text_join"><mutation items="2"></mutation>
            <value name="ADD0"><block type="text"><field name="TEXT">Won: </field></block></value>
            <value name="ADD1"><block type="read_details"><field name="DETAIL_INDEX">4</field></block></value>
          </block>
        </value>
        <next><block type="trade_again"></block></next>
      </block>
    </statement>
  </block>
  <block type="before_purchase" x="0" y="600">
    <statement name="BEFOREPURCHASE_STACK"><block type="purchase"><field name="PURCHASE_LIST">DIGITOVER</field></block></statement>
  </block>
</xml>`;

const load = (text: string) => {
    const parsed = parseBotFile(text);
    if (!parsed.ok) throw new Error(`refused: ${parsed.errors.join(' | ')}`);
    const workspace = new Blockly.Workspace();
    expect(loadParsedBot(workspace, parsed)).toBe(true);
    return workspace;
};

type TFake = TBotApi & {
    tick: (quote: number) => void;
    contract: (update: Record<string, unknown>) => void;
    buy: TBotApi['buy'];
    proposals: TTradeRequest[];
    resolveBuy: (response: TApiResponse) => void;
};

const createFake = (): TFake => {
    const callbacks: Record<string, (response: TApiResponse) => void> = {};
    let resolve: (response: TApiResponse) => void = () => undefined;
    const proposals: TTradeRequest[] = [];
    return {
        subscribeTicks: (_symbol, cb) => {
            callbacks.tick = cb;
            return { unsubscribe: () => undefined };
        },
        subscribeProposal: (request, cb) => {
            proposals.push(request);
            Promise.resolve().then(() => cb({ proposal: { id: 'p', ask_price: request.amount } }));
            return { unsubscribe: () => undefined };
        },
        buy: () =>
            new Promise(done => {
                resolve = done;
            }),
        subscribeOpenContract: (_id, cb) => {
            callbacks.contract = cb;
            return { unsubscribe: () => undefined };
        },
        sell: () => Promise.resolve({}),
        tick: quote => callbacks.tick({ tick: { quote, pip_size: 2 } }),
        contract: update => callbacks.contract({ proposal_open_contract: { contract_id: 9, ...update } }),
        resolveBuy: response => resolve(response),
        proposals,
    };
};

const flush = () =>
    new Promise(done => {
        setTimeout(done, 0);
    });

const run = (workspace: Blockly.Workspace) => {
    const api = createFake();
    const logs: [TLevel, string][] = [];
    const runner = new BotRunner({
        api,
        program: compileProgram(workspace),
        currency: 'USD',
        getBalance: () => 1000,
        onLog: (level, message) => logs.push([level, message]),
        onStats: jest.fn(),
        onStatus: jest.fn(),
    });
    return { api, logs, runner };
};

const bought = { buy: { contract_id: 9, buy_price: 0.7, payout: 1.4 } };

describe('a bot exported from Deriv Bot', () => {
    beforeAll(() => registerBlocks());

    it('imports and passes validation with no issues', () => {
        const workspace = load(MODERN_BOT);
        expect(validateBot(workspace)).toEqual([]);
        workspace.dispose();
    });

    it('compiles to the settings, the stake variable and the prediction in the file', () => {
        const program = compileProgram(load(MODERN_BOT));
        expect(program.setup).toMatchObject({ symbol: '1HZ75V', trade_type: 'overunder', restart_on_error: true });
        expect(program.options).toMatchObject({
            duration_unit: 't',
            duration: { t: 'num', v: 1 },
            amount: { t: 'var', name: 'Stake' },
            prediction: { t: 'num', v: 5 },
        });
        expect(program.init).toEqual([
            { t: 'notify', level: 'info', message: { t: 'str', v: 'Hello' } },
            { t: 'set', name: 'Stake', value: { t: 'num', v: 0.7 } },
        ]);
    });

    it('trades the way the file says, including the loss bookkeeping', async () => {
        const { api, logs, runner } = run(load(MODERN_BOT));
        runner.start();
        api.tick(100.1);
        await flush();
        expect(api.proposals[0]).toEqual({
            amount: 0.7,
            basis: 'stake',
            contract_type: 'DIGITUNDER',
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
            underlying_symbol: '1HZ75V',
            barrier: '5',
        });
        api.resolveBuy(bought);
        await flush();
        api.contract({ profit: -0.7, sell_price: 0, is_sold: 1, status: 'lost' });

        // "Result: " + read_details 4 (the profit), created by the "create text with" statement
        expect(logs).toEqual(expect.arrayContaining([['info', 'Result: -0.7']]));
        // and "trade again" ran, so the next tick buys again
        api.tick(100.2);
        await flush();
        expect(api.proposals).toHaveLength(2);
    });

    it('refuses a contract detail it does not know yet instead of guessing', () => {
        const unsupported = MODERN_BOT.replace(
            '<field name="DETAIL_INDEX">4</field>',
            '<field name="DETAIL_INDEX">8</field>'
        );
        expect(() => compileProgram(load(unsupported))).toThrow(/option 8 is not supported/);
    });
});

describe('an older Binary Bot file', () => {
    beforeAll(() => registerBlocks());

    it('is upgraded to the current blocks on import', () => {
        const workspace = load(LEGACY_BOT);
        const types = workspace.getAllBlocks(false).map(block => block.type);
        expect(types).toEqual(
            expect.arrayContaining(['trade_definition', 'trade_definition_market', 'trade_definition_tradeoptions'])
        );
        expect(types).not.toContain('trade');
        expect(types).not.toContain('tradeOptions');
        // the value-form join became a "create text with" statement plus a variable
        expect(types.filter(type => type === 'text_join')).toHaveLength(1);
        expect(validateBot(workspace)).toEqual([]);
    });

    it('runs with the settings that were fields of the old trade block', async () => {
        const { api, logs, runner } = run(load(LEGACY_BOT));
        runner.start();
        api.tick(50.5);
        await flush();
        expect(api.proposals[0]).toMatchObject({
            amount: 2,
            contract_type: 'DIGITOVER',
            underlying_symbol: '1HZ100V',
            barrier: '4',
        });
        api.resolveBuy({ buy: { contract_id: 9, buy_price: 2, payout: 3.9 } });
        await flush();
        api.contract({ profit: 1.9, sell_price: 3.9, is_sold: 1, status: 'won' });
        expect(logs).toEqual(expect.arrayContaining([['success', 'Won: 1.9']]));
    });

    it('refuses a value-form join that is not inside any statement', () => {
        const stray =
            '<xml><block type="text_join" x="0" y="0"><mutation items="1"></mutation>' +
            '<value name="ADD0"><block type="text"><field name="TEXT">a</field></block></value></block></xml>';
        const parsed = parseBotFile(stray);
        expect(parsed).toMatchObject({ ok: false });
        expect(JSON.stringify(parsed)).toContain('legacy_text_join');
    });
});

describe('stake rounding', () => {
    beforeAll(() => registerBlocks());

    it('rounds a martingale stake to two decimals before asking for a price', async () => {
        const text = MODERN_BOT.replace('<field name="NUM">0.7</field>', '<field name="NUM">0.36419</field>');
        const { api, runner } = run(load(text));
        runner.start();
        api.tick(1);
        await flush();
        expect(api.proposals[0].amount).toBe(0.36);
    });
});
