import { localize } from '@deriv-com/translations';

/**
 * Strategy library: ready-made bots a user can load into Bot Builder in one tap.
 *
 * Each template is a Deriv Bot style XML file, so it goes through the same safe importer (`parseBotFile`
 * then `loadParsedBot`) as a file the user picks from disk. Nothing here is a recommendation: no bot
 * beats the built-in margin of the contracts, and every one of them can lose the stake on each trade.
 */

export type TTemplateLevel = 'beginner' | 'intermediate';
export type TTemplateRisk = 'low' | 'medium' | 'high';

export type TBotTemplate = {
    id: string;
    name: string;
    description: string;
    level: TTemplateLevel;
    risk: TTemplateRisk;
    /** Short facts shown as chips on the card, for example "Volatility 100 (1s)" or "5 ticks". */
    facts: string[];
    /** A plain-language warning shown on the card. */
    caution: string;
    xml: string;
};

type TVariable = { id: string; name: string };

type TBotSpec = {
    symbol: string;
    category: 'callput' | 'digits';
    trade_type: string;
    duration: number;
    /** A number, or the id and name of a variable that holds the stake. */
    stake: number | TVariable;
    prediction?: number;
    purchase: string;
    variables?: TVariable[];
    /** Blocks run once when the bot starts. */
    init?: string;
    /** Blocks run after each contract closes, before the bot trades again. */
    after?: string;
};

const num = (value: number) => `<block type="math_number"><field name="NUM">${value}</field></block>`;
const variable = ({ id, name }: TVariable) =>
    `<block type="variables_get"><field name="VAR" id="${id}">${name}</field></block>`;

const setVariable = (target: TVariable, value: string, next = '') =>
    `<block type="variables_set"><field name="VAR" id="${target.id}">${target.name}</field><value name="VALUE">${value}</value>${
        next && `<next>${next}</next>`
    }</block>`;

const arithmetic = (op: 'ADD' | 'MULTIPLY', a: string, b: string) =>
    `<block type="math_arithmetic"><field name="OP">${op}</field><value name="A">${a}</value><value name="B">${b}</value></block>`;

const compare = (op: 'GT' | 'LT', a: string, b: string) =>
    `<block type="logic_compare"><field name="OP">${op}</field><value name="A">${a}</value><value name="B">${b}</value></block>`;

const ifBlock = (condition: string, then: string, otherwise?: string, next = '') =>
    `<block type="controls_if">${otherwise ? '<mutation else="1"></mutation>' : ''}<value name="IF0">${condition}</value><statement name="DO0">${then}</statement>${
        otherwise ? `<statement name="ELSE">${otherwise}</statement>` : ''
    }${next && `<next>${next}</next>`}</block>`;

const resultIs = (result: 'win' | 'loss') =>
    `<block type="contract_check_result"><field name="CHECK_RESULT">${result}</field></block>`;

const TRADE_AGAIN = '<block type="trade_again"></block>';

const buildBotXml = (spec: TBotSpec): string => {
    const fixed_stake = typeof spec.stake === 'number' ? spec.stake : BASE_STAKE;
    const variable_stake = typeof spec.stake === 'number' ? '' : variable(spec.stake);
    const has_prediction = spec.prediction !== undefined;
    const variables = (spec.variables ?? []).map(item => `<variable id="${item.id}">${item.name}</variable>`).join('');
    const trade_type_name = spec.trade_type;

    return `<xml xmlns="http://www.w3.org/1999/xhtml" is_dbot="true" collection="false">
  <variables>${variables}</variables>
  <block type="trade_definition" deletable="false" x="0" y="0">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${spec.symbol}</field>
        <next><block type="trade_definition_tradetype">
          <field name="TRADETYPECAT_LIST">${spec.category}</field>
          <field name="TRADETYPE_LIST">${trade_type_name}</field>
          <next><block type="trade_definition_contracttype">
            <field name="TYPE_LIST">both</field>
            <next><block type="trade_definition_candleinterval">
              <field name="CANDLEINTERVAL_LIST">60</field>
              <next><block type="trade_definition_restartbuysell">
                <field name="TIME_MACHINE_ENABLED">FALSE</field>
                <next><block type="trade_definition_restartonerror">
                  <field name="RESTARTONERROR">TRUE</field>
                </block></next>
              </block></next>
            </block></next>
          </block></next>
        </block></next>
      </block>
    </statement>${spec.init ? `\n    <statement name="INITIALIZATION">${spec.init}</statement>` : ''}
    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions">
        <mutation has_first_barrier="false" has_second_barrier="false" has_prediction="${has_prediction}"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <field name="CURRENCY_LIST">USD</field>
        <value name="DURATION"><shadow type="math_number"><field name="NUM">${spec.duration}</field></shadow></value>
        <value name="AMOUNT"><shadow type="math_number"><field name="NUM">${fixed_stake}</field></shadow>${variable_stake}</value>
        <value name="PREDICTION"><shadow type="math_number"><field name="NUM">${spec.prediction ?? 0}</field></shadow></value>
      </block>
    </statement>
  </block>
  <block type="before_purchase" deletable="false" x="0" y="440">
    <statement name="BEFOREPURCHASE_STACK"><block type="purchase"><field name="PURCHASE_LIST">${spec.purchase}</field></block></statement>
  </block>
  <block type="during_purchase" deletable="false" x="700" y="20"></block>
  <block type="after_purchase" deletable="false" x="700" y="220">
    <statement name="AFTERPURCHASE_STACK">${spec.after ? spec.after.replace('%TRADE_AGAIN%', TRADE_AGAIN) : TRADE_AGAIN}</statement>
  </block>
</xml>`;
};

/* ----------------------------------------------------------------------------------------------- */
/* Staking helpers for the two stake-changing templates                                              */
/* ----------------------------------------------------------------------------------------------- */

const STAKE: TVariable = { id: 'tpl_stake', name: 'Stake' };
const BASE: TVariable = { id: 'tpl_base', name: 'Initial stake' };
const BASE_STAKE = 1;
/** Both stake-changing bots go back to the first stake once the stake has grown past this many times it. */
const MAX_STAKE_MULTIPLE = 16;

const resetIfTooBig = (next: string) =>
    ifBlock(
        compare('GT', variable(STAKE), arithmetic('MULTIPLY', variable(BASE), num(MAX_STAKE_MULTIPLE))),
        setVariable(STAKE, variable(BASE)),
        undefined,
        next
    );

const stakeInit = setVariable(BASE, num(BASE_STAKE), setVariable(STAKE, variable(BASE)));

export const getBotTemplates = (): TBotTemplate[] => [
    {
        id: 'rise_fall_basic',
        name: localize('Rise/Fall: steady stake'),
        description: localize(
            'Buys a Rise contract on Volatility 100 (1s) every round with the same stake. The simplest bot to learn from.'
        ),
        level: 'beginner',
        risk: 'low',
        facts: [localize('Volatility 100 (1s)'), localize('Rise/Fall'), localize('5 ticks'), localize('Stake 1')],
        caution: localize('Rise and Fall each win about half the time, and the payout is below 2x your stake.'),
        xml: buildBotXml({
            symbol: '1HZ100V',
            category: 'callput',
            trade_type: 'risefall',
            duration: 5,
            stake: BASE_STAKE,
            purchase: 'CALL',
        }),
    },
    {
        id: 'even_odd_basic',
        name: localize('Even/Odd: last digit'),
        description: localize(
            'Buys Even on Volatility 100 (1s) for 1 tick. Fast rounds, so run it on a demo account first to see how quickly results add up.'
        ),
        level: 'beginner',
        risk: 'medium',
        facts: [localize('Volatility 100 (1s)'), localize('Even/Odd'), localize('1 tick'), localize('Stake 1')],
        caution: localize('One-tick rounds finish in seconds, so losses can pile up quickly.'),
        xml: buildBotXml({
            symbol: '1HZ100V',
            category: 'digits',
            trade_type: 'evenodd',
            duration: 1,
            stake: BASE_STAKE,
            purchase: 'DIGITEVEN',
        }),
    },
    {
        id: 'digit_over_2',
        name: localize('Digit Over 2'),
        description: localize(
            'Buys Over 2 on Volatility 100 Index for 1 tick. Over 2 wins when the last digit is 3 to 9, so it wins often but pays little.'
        ),
        level: 'beginner',
        risk: 'medium',
        facts: [localize('Volatility 100'), localize('Over/Under'), localize('Prediction 2'), localize('1 tick')],
        caution: localize(
            'A win pays a small profit while one loss costs the whole stake, so a few losses undo many wins.'
        ),
        xml: buildBotXml({
            symbol: 'R_100',
            category: 'digits',
            trade_type: 'overunder',
            duration: 1,
            stake: BASE_STAKE,
            prediction: 2,
            purchase: 'DIGITOVER',
        }),
    },
    {
        id: 'win_ladder',
        name: localize('Win ladder'),
        description: localize(
            'Raises the stake by the first stake after every win and goes back to the first stake after a loss, so it risks more only while it is winning.'
        ),
        level: 'intermediate',
        risk: 'medium',
        facts: [
            localize('Volatility 100 (1s)'),
            localize('Rise/Fall'),
            localize('5 ticks'),
            localize('Stake 1 and up'),
        ],
        caution: localize('One loss ends a winning run, and the stake you have built up is lost with it.'),
        xml: buildBotXml({
            symbol: '1HZ100V',
            category: 'callput',
            trade_type: 'risefall',
            duration: 5,
            stake: STAKE,
            purchase: 'CALL',
            variables: [BASE, STAKE],
            init: stakeInit,
            after: ifBlock(
                resultIs('win'),
                setVariable(STAKE, arithmetic('ADD', variable(STAKE), variable(BASE)), ''),
                setVariable(STAKE, variable(BASE)),
                resetIfTooBig('%TRADE_AGAIN%')
            ),
        }),
    },
    {
        id: 'martingale_rise_fall',
        name: localize('Martingale (capped)'),
        description: localize(
            'Doubles the stake after every loss and goes back to the first stake after a win. The stake also resets once it passes 16 times the first stake.'
        ),
        level: 'intermediate',
        risk: 'high',
        facts: [localize('Volatility 100 (1s)'), localize('Rise/Fall'), localize('5 ticks'), localize('Stake 1 to 16')],
        caution: localize(
            'Doubling after losses can empty an account in a bad run. Always set a stop loss, and try it on a demo account first.'
        ),
        xml: buildBotXml({
            symbol: '1HZ100V',
            category: 'callput',
            trade_type: 'risefall',
            duration: 5,
            stake: STAKE,
            purchase: 'CALL',
            variables: [BASE, STAKE],
            init: stakeInit,
            after: ifBlock(
                resultIs('loss'),
                setVariable(STAKE, arithmetic('MULTIPLY', variable(STAKE), num(2))),
                setVariable(STAKE, variable(BASE)),
                resetIfTooBig('%TRADE_AGAIN%')
            ),
        }),
    },
];
