import * as Blockly from 'blockly';

import { localize } from '@deriv-com/translations';

/**
 * Block vocabulary. Block types and field names follow Deriv Bot so bots exported from Deriv Bot load here.
 * (`trade_definition`, `trade_definition_market`, `SYMBOL_LIST`, `PURCHASE_LIST`, `PREDICTION`, ...)
 */
export const BLOCK_TYPES = {
    TRADE_DEFINITION: 'trade_definition',
    MARKET: 'trade_definition_market',
    TRADE_TYPE: 'trade_definition_tradetype',
    CONTRACT_TYPE: 'trade_definition_contracttype',
    CANDLE_INTERVAL: 'trade_definition_candleinterval',
    RESTART_BUY_SELL: 'trade_definition_restartbuysell',
    RESTART_ON_ERROR: 'trade_definition_restartonerror',
    TRADE_OPTIONS: 'trade_definition_tradeoptions',
    BEFORE_PURCHASE: 'before_purchase',
    PURCHASE: 'purchase',
    DURING_PURCHASE: 'during_purchase',
    SELL_AVAILABLE: 'sell_available',
    SELL_AT_MARKET: 'sell_at_market',
    AFTER_PURCHASE: 'after_purchase',
    TRADE_AGAIN: 'trade_again',
    TICK: 'tick',
    LAST_DIGIT: 'last_digit',
    BALANCE: 'balance',
    TOTAL_PROFIT: 'total_profit',
    TOTAL_RUNS: 'total_runs',
    READ_DETAILS: 'read_details',
    CONTRACT_CHECK_RESULT: 'contract_check_result',
    NOTIFY: 'notify',
    TIMEOUT: 'timeout',
    PROCEDURE_DEF: 'procedures_defnoreturn',
    PROCEDURE_CALL: 'procedures_callnoreturn',
    PROCEDURE_DEF_RETURN: 'procedures_defreturn',
    PROCEDURE_CALL_RETURN: 'procedures_callreturn',
    PROCEDURE_IF_RETURN: 'procedures_ifreturn',
} as const;

/** Blocks that sit at the top level of a bot and may appear only once. */
export const ROOT_BLOCK_TYPES = [
    BLOCK_TYPES.TRADE_DEFINITION,
    BLOCK_TYPES.BEFORE_PURCHASE,
    BLOCK_TYPES.DURING_PURCHASE,
    BLOCK_TYPES.AFTER_PURCHASE,
] as const;

/** Every block type a bot may contain. Anything else is refused on import. */
export const ALLOWED_BLOCK_TYPES: ReadonlySet<string> = new Set<string>([
    ...Object.values(BLOCK_TYPES),
    'controls_if',
    'controls_repeat_ext',
    'controls_whileUntil',
    'controls_flow_statements',
    'logic_compare',
    'logic_operation',
    'logic_negate',
    'logic_boolean',
    'math_number',
    'math_arithmetic',
    'math_single',
    'math_modulo',
    'math_round',
    'math_random_int',
    'text',
    'text_join',
    'variables_get',
    'variables_set',
]);

const COLOURS = {
    trade: '#ff444f',
    purchase: '#0e7c86',
    sell: '#c0392b',
    restart: '#6c5ce7',
    analysis: '#2f80ed',
    utility: '#e17055',
};

/* ----------------------------------------------------------------------------------------------- */
/* Markets and trade types                                                                          */
/* ----------------------------------------------------------------------------------------------- */

export const MARKETS: Record<
    string,
    { label: string; submarkets: Record<string, { label: string; symbols: [string, string][] }> }
> = {
    synthetic_index: {
        label: 'Derived',
        submarkets: {
            random_index: {
                label: 'Continuous Indices',
                symbols: [
                    ['Volatility 10 Index', 'R_10'],
                    ['Volatility 25 Index', 'R_25'],
                    ['Volatility 50 Index', 'R_50'],
                    ['Volatility 75 Index', 'R_75'],
                    ['Volatility 100 Index', 'R_100'],
                    ['Volatility 10 (1s) Index', '1HZ10V'],
                    ['Volatility 25 (1s) Index', '1HZ25V'],
                    ['Volatility 50 (1s) Index', '1HZ50V'],
                    ['Volatility 75 (1s) Index', '1HZ75V'],
                    ['Volatility 100 (1s) Index', '1HZ100V'],
                ],
            },
        },
    },
    forex: {
        label: 'Forex',
        submarkets: {
            major_pairs: {
                label: 'Major Pairs',
                symbols: [
                    ['EUR/USD', 'frxEURUSD'],
                    ['GBP/USD', 'frxGBPUSD'],
                    ['USD/JPY', 'frxUSDJPY'],
                ],
            },
        },
    },
};

export type TTradeTypeConfig = {
    category: string;
    label: string;
    contracts: [string, string][];
    needs_prediction: boolean;
};

export const TRADE_TYPE_CATEGORIES: [string, string][] = [
    ['Up/Down', 'callput'],
    ['Digits', 'digits'],
];

export const TRADE_TYPES: Record<string, TTradeTypeConfig> = {
    risefall: {
        category: 'callput',
        label: 'Rise/Fall',
        contracts: [
            ['Rise', 'CALL'],
            ['Fall', 'PUT'],
        ],
        needs_prediction: false,
    },
    evenodd: {
        category: 'digits',
        label: 'Even/Odd',
        contracts: [
            ['Even', 'DIGITEVEN'],
            ['Odd', 'DIGITODD'],
        ],
        needs_prediction: false,
    },
    overunder: {
        category: 'digits',
        label: 'Over/Under',
        contracts: [
            ['Over', 'DIGITOVER'],
            ['Under', 'DIGITUNDER'],
        ],
        needs_prediction: true,
    },
    matchesdiffers: {
        category: 'digits',
        label: 'Matches/Differs',
        contracts: [
            ['Matches', 'DIGITMATCH'],
            ['Differs', 'DIGITDIFF'],
        ],
        needs_prediction: true,
    },
};

export const ALL_CONTRACT_OPTIONS: [string, string][] = Object.values(TRADE_TYPES).flatMap(type => type.contracts);

export const DIGIT_CONTRACTS: ReadonlySet<string> = new Set(
    Object.values(TRADE_TYPES)
        .filter(type => type.category === 'digits')
        .flatMap(type => type.contracts.map(([, value]) => value))
);

export const PREDICTION_CONTRACTS: ReadonlySet<string> = new Set(
    Object.values(TRADE_TYPES)
        .filter(type => type.needs_prediction)
        .flatMap(type => type.contracts.map(([, value]) => value))
);

export const DURATION_UNIT_OPTIONS: [string, string][] = [
    ['Ticks', 't'],
    ['Seconds', 's'],
    ['Minutes', 'm'],
    ['Hours', 'h'],
    ['Days', 'd'],
];

export const CANDLE_INTERVAL_OPTIONS: [string, string][] = [
    ['1 minute', '60'],
    ['2 minutes', '120'],
    ['3 minutes', '180'],
    ['5 minutes', '300'],
    ['10 minutes', '600'],
    ['15 minutes', '900'],
    ['30 minutes', '1800'],
    ['1 hour', '3600'],
    ['1 day', '86400'],
];

export const READ_DETAILS_OPTIONS: [string, string][] = [
    ['Buy price', '1'],
    ['Payout', '2'],
    ['Profit', '3'],
    ['Current sell price', '4'],
];

/** Walks the trade parameter blocks of a workspace to find the selected trade type. */
export const getSelectedTradeType = (workspace: Blockly.Workspace | null | undefined): string => {
    const block = workspace?.getBlocksByType(BLOCK_TYPES.TRADE_TYPE, false)[0];
    const value = block?.getFieldValue('TRADETYPE_LIST');
    return value && TRADE_TYPES[value] ? value : 'risefall';
};

const contractOptionsFor = (trade_type: string): [string, string][] =>
    TRADE_TYPES[trade_type]?.contracts ?? ALL_CONTRACT_OPTIONS;

const asOptions = (options: [string, string][]) =>
    options.map(([label, value]) => [localize(label), value] as [string, string]);

/* ----------------------------------------------------------------------------------------------- */
/* Registration                                                                                     */
/* ----------------------------------------------------------------------------------------------- */

const dynamicDropdown = (read: (block: Blockly.Block) => [string, string][]) =>
    new Blockly.FieldDropdown(function (this: Blockly.FieldDropdown) {
        const block = this.getSourceBlock();
        const options = block ? read(block) : [];
        return options.length ? asOptions(options) : [['', '']];
    });

const marketValue = (block: Blockly.Block) => block.getFieldValue('MARKET_LIST') || 'synthetic_index';
const submarketOptions = (block: Blockly.Block): [string, string][] =>
    Object.entries(MARKETS[marketValue(block)]?.submarkets ?? {}).map(([value, submarket]) => [submarket.label, value]);
const symbolOptions = (block: Blockly.Block): [string, string][] => {
    const submarket = MARKETS[marketValue(block)]?.submarkets[block.getFieldValue('SUBMARKET_LIST')];
    return submarket?.symbols ?? [];
};

/** Keeps a dependent dropdown valid after the field it depends on changes. */
const settle = (block: Blockly.Block, name: string) => {
    const field = block.getField(name) as Blockly.FieldDropdown | null;
    if (!field) return;
    const options = field.getOptions(false);
    if (options.length && !options.some(([, value]) => value === field.getValue())) {
        field.setValue(options[0][1]);
    }
};

let blocks_registered = false;

export const registerBlocks = () => {
    if (blocks_registered) return;
    blocks_registered = true;

    Blockly.common.defineBlocksWithJsonArray([
        {
            type: BLOCK_TYPES.TRADE_DEFINITION,
            message0: localize('1. Trade parameters'),
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'TRADE_OPTIONS' }],
            message2: localize('Run once at start:'),
            message3: '%1',
            args3: [{ type: 'input_statement', name: 'INITIALIZATION' }],
            message4: localize('Define your trade options such as duration and stake.'),
            message5: '%1',
            args5: [{ type: 'input_statement', name: 'SUBMARKET' }],
            colour: COLOURS.trade,
            tooltip: localize('Define your trade options such as duration and stake.'),
        },
        {
            type: BLOCK_TYPES.CANDLE_INTERVAL,
            message0: localize('Default Candle Interval: %1'),
            args0: [
                { type: 'field_dropdown', name: 'CANDLEINTERVAL_LIST', options: asOptions(CANDLE_INTERVAL_OPTIONS) },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: COLOURS.trade,
            tooltip: localize('Candle interval used for candle based analysis.'),
        },
        {
            type: BLOCK_TYPES.RESTART_BUY_SELL,
            message0: localize('Restart buy/sell on error (disable for better performance): %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'TIME_MACHINE_ENABLED',
                    options: [
                        [localize('True'), 'TRUE'],
                        [localize('False'), 'FALSE'],
                    ],
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: COLOURS.trade,
            tooltip: localize('Restarts the buy or sell request when it fails.'),
        },
        {
            type: BLOCK_TYPES.RESTART_ON_ERROR,
            message0: localize('Restart last trade on error (bot ignores the unsuccessful trade): %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'RESTARTONERROR',
                    options: [
                        [localize('True'), 'TRUE'],
                        [localize('False'), 'FALSE'],
                    ],
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: COLOURS.trade,
            tooltip: localize('Carries on with the next trade when a trade fails instead of stopping the bot.'),
        },
        {
            type: BLOCK_TYPES.BEFORE_PURCHASE,
            message0: localize('2. Purchase conditions'),
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'BEFOREPURCHASE_STACK' }],
            colour: COLOURS.purchase,
            tooltip: localize('Decide when to buy a contract.'),
        },
        {
            type: BLOCK_TYPES.PURCHASE,
            message0: localize('Purchase %1'),
            args0: [{ type: 'field_dropdown', name: 'PURCHASE_LIST', options: asOptions(ALL_CONTRACT_OPTIONS) }],
            previousStatement: null,
            colour: COLOURS.purchase,
            tooltip: localize('Buys a contract of the selected type.'),
        },
        {
            type: BLOCK_TYPES.DURING_PURCHASE,
            message0: localize('3. Sell conditions (optional)'),
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'DURING_PURCHASE_STACK' }],
            colour: COLOURS.sell,
            tooltip: localize('Decide when to sell an open contract before it expires.'),
        },
        {
            type: BLOCK_TYPES.SELL_AT_MARKET,
            message0: localize('Sell at market price'),
            previousStatement: null,
            nextStatement: null,
            colour: COLOURS.sell,
            tooltip: localize('Sells the open contract at the current market price.'),
        },
        {
            type: BLOCK_TYPES.SELL_AVAILABLE,
            message0: localize('Sell is available'),
            output: 'Boolean',
            colour: COLOURS.sell,
            tooltip: localize('True if the open contract can be sold right now.'),
        },
        {
            type: BLOCK_TYPES.AFTER_PURCHASE,
            message0: localize('4. Restart trading conditions'),
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'AFTERPURCHASE_STACK' }],
            colour: COLOURS.restart,
            tooltip: localize('Decide whether to trade again once a contract finishes.'),
        },
        {
            type: BLOCK_TYPES.TRADE_AGAIN,
            message0: localize('Trade again'),
            previousStatement: null,
            colour: COLOURS.restart,
            tooltip: localize('Starts the next trade from the purchase conditions.'),
        },
        {
            type: BLOCK_TYPES.TICK,
            message0: localize('Last Tick'),
            output: 'Number',
            colour: COLOURS.analysis,
            tooltip: localize('The most recent tick price of the selected market.'),
        },
        {
            type: BLOCK_TYPES.LAST_DIGIT,
            message0: localize('Last Digit'),
            output: 'Number',
            colour: COLOURS.analysis,
            tooltip: localize('The last digit of the most recent tick price.'),
        },
        {
            type: BLOCK_TYPES.BALANCE,
            message0: localize('Balance: %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'BALANCE_TYPE',
                    options: [
                        [localize('Number'), 'NUM'],
                        [localize('String'), 'STR'],
                    ],
                },
            ],
            output: null,
            colour: COLOURS.utility,
            tooltip: localize('Your current account balance.'),
        },
        {
            type: BLOCK_TYPES.TOTAL_PROFIT,
            message0: localize('Total profit'),
            output: 'Number',
            colour: COLOURS.utility,
            tooltip: localize('Profit or loss across all trades since the bot started.'),
        },
        {
            type: BLOCK_TYPES.TOTAL_RUNS,
            message0: localize('Number of runs'),
            output: 'Number',
            colour: COLOURS.utility,
            tooltip: localize('How many contracts the bot has finished.'),
        },
        {
            type: BLOCK_TYPES.READ_DETAILS,
            message0: localize('Contract detail: %1'),
            args0: [{ type: 'field_dropdown', name: 'DETAIL_INDEX', options: asOptions(READ_DETAILS_OPTIONS) }],
            output: null,
            colour: COLOURS.analysis,
            tooltip: localize('Details of the open or most recent contract.'),
        },
        {
            type: BLOCK_TYPES.CONTRACT_CHECK_RESULT,
            message0: localize('Result is %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'CHECK_RESULT',
                    options: [
                        [localize('Win'), 'win'],
                        [localize('Loss'), 'loss'],
                    ],
                },
            ],
            output: 'Boolean',
            colour: COLOURS.restart,
            tooltip: localize('True if the last finished contract matches the selected result.'),
        },
        {
            type: BLOCK_TYPES.NOTIFY,
            message0: localize('Notify %1 with sound: %2 %3'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'NOTIFICATION_TYPE',
                    options: [
                        [localize('Green'), 'success'],
                        [localize('Blue'), 'info'],
                        [localize('Yellow'), 'warn'],
                        [localize('Red'), 'error'],
                    ],
                },
                {
                    type: 'field_dropdown',
                    name: 'NOTIFICATION_SOUND',
                    options: [
                        [localize('Silent'), 'silent'],
                        [localize('Announcement'), 'announcement'],
                        [localize('Earn money'), 'earn-money'],
                    ],
                },
                { type: 'input_value', name: 'MESSAGE' },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: COLOURS.utility,
            tooltip: localize('Shows a message in the journal.'),
        },
        {
            type: BLOCK_TYPES.TIMEOUT,
            message0: localize('Run after %1 seconds'),
            args0: [{ type: 'input_value', name: 'SECONDS', check: 'Number' }],
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'TIMEOUTSTACK' }],
            previousStatement: null,
            nextStatement: null,
            colour: COLOURS.utility,
            tooltip: localize('Runs the blocks inside after the given number of seconds.'),
        },
    ]);

    Blockly.Blocks[BLOCK_TYPES.MARKET] = {
        init(this: Blockly.Block) {
            this.appendDummyInput()
                .appendField(localize('Market:'))
                .appendField(
                    new Blockly.FieldDropdown(asOptions(Object.entries(MARKETS).map(([key, m]) => [m.label, key]))),
                    'MARKET_LIST'
                )
                .appendField('>')
                .appendField(dynamicDropdown(submarketOptions), 'SUBMARKET_LIST')
                .appendField('>')
                .appendField(dynamicDropdown(symbolOptions), 'SYMBOL_LIST');
            this.setPreviousStatement(true);
            this.setNextStatement(true);
            this.setColour(COLOURS.trade);
            this.setTooltip(localize('The market and symbol the bot trades.'));
        },
        onchange(this: Blockly.Block) {
            settle(this, 'SUBMARKET_LIST');
            settle(this, 'SYMBOL_LIST');
        },
    };

    Blockly.Blocks[BLOCK_TYPES.TRADE_TYPE] = {
        init(this: Blockly.Block) {
            this.appendDummyInput()
                .appendField(localize('Trade Type:'))
                .appendField(new Blockly.FieldDropdown(asOptions(TRADE_TYPE_CATEGORIES)), 'TRADETYPECAT_LIST')
                .appendField('>')
                .appendField(
                    dynamicDropdown(block =>
                        Object.entries(TRADE_TYPES)
                            .filter(([, type]) => type.category === block.getFieldValue('TRADETYPECAT_LIST'))
                            .map(([key, type]) => [type.label, key])
                    ),
                    'TRADETYPE_LIST'
                );
            this.setPreviousStatement(true);
            this.setNextStatement(true);
            this.setColour(COLOURS.trade);
            this.setTooltip(localize('The kind of contract the bot trades.'));
        },
        onchange(this: Blockly.Block) {
            settle(this, 'TRADETYPE_LIST');
        },
    };

    Blockly.Blocks[BLOCK_TYPES.CONTRACT_TYPE] = {
        init(this: Blockly.Block) {
            this.appendDummyInput()
                .appendField(localize('Contract Type:'))
                .appendField(
                    new Blockly.FieldDropdown(function (this: Blockly.FieldDropdown) {
                        const trade_type = getSelectedTradeType(this.getSourceBlock()?.workspace);
                        return asOptions([[localize('Both'), 'both'], ...contractOptionsFor(trade_type)]);
                    }),
                    'TYPE_LIST'
                );
            this.setPreviousStatement(true);
            this.setNextStatement(true);
            this.setColour(COLOURS.trade);
            this.setTooltip(localize('Which contracts the bot may buy.'));
        },
        onchange(this: Blockly.Block) {
            settle(this, 'TYPE_LIST');
        },
    };

    Blockly.Blocks[BLOCK_TYPES.TRADE_OPTIONS] = {
        init(this: Blockly.Block) {
            this.appendDummyInput()
                .appendField(localize('Duration:'))
                .appendField(new Blockly.FieldDropdown(asOptions(DURATION_UNIT_OPTIONS)), 'DURATIONTYPE_LIST');
            this.appendValueInput('DURATION').setCheck('Number');
            this.appendDummyInput()
                .appendField(localize('Stake:'))
                .appendField(new Blockly.FieldLabelSerializable('USD'), 'CURRENCY_LIST');
            this.appendValueInput('AMOUNT').setCheck('Number');
            this.appendValueInput('PREDICTION').setCheck('Number').appendField(localize('Prediction:'));
            this.setInputsInline(true);
            this.setPreviousStatement(true);
            this.setNextStatement(true);
            this.setColour(COLOURS.trade);
            this.setTooltip(localize('Duration, stake and, for digit trades, the digit prediction.'));
        },
        onchange(this: Blockly.Block) {
            const show = TRADE_TYPES[getSelectedTradeType(this.workspace)].needs_prediction;
            const input = this.getInput('PREDICTION');
            if (input && input.isVisible() !== show) input.setVisible(show);
        },
    };
};

/* ----------------------------------------------------------------------------------------------- */
/* Toolbox                                                                                          */
/* ----------------------------------------------------------------------------------------------- */

const num = (value: number) => ({ shadow: { type: 'math_number', fields: { NUM: value } } });
const txt = (value: string) => ({ shadow: { type: 'text', fields: { TEXT: value } } });

export const getToolbox = (): Blockly.utils.toolbox.ToolboxDefinition => ({
    kind: 'categoryToolbox',
    contents: [
        {
            kind: 'category',
            name: localize('Trade parameters'),
            colour: COLOURS.trade,
            contents: [
                { kind: 'block', type: BLOCK_TYPES.TRADE_DEFINITION },
                { kind: 'block', type: BLOCK_TYPES.MARKET },
                { kind: 'block', type: BLOCK_TYPES.TRADE_TYPE },
                { kind: 'block', type: BLOCK_TYPES.CONTRACT_TYPE },
                { kind: 'block', type: BLOCK_TYPES.CANDLE_INTERVAL },
                { kind: 'block', type: BLOCK_TYPES.RESTART_BUY_SELL },
                { kind: 'block', type: BLOCK_TYPES.RESTART_ON_ERROR },
                {
                    kind: 'block',
                    type: BLOCK_TYPES.TRADE_OPTIONS,
                    inputs: { DURATION: num(5), AMOUNT: num(1), PREDICTION: num(0) },
                },
            ],
        },
        {
            kind: 'category',
            name: localize('Purchase conditions'),
            colour: COLOURS.purchase,
            contents: [
                { kind: 'block', type: BLOCK_TYPES.BEFORE_PURCHASE },
                { kind: 'block', type: BLOCK_TYPES.PURCHASE },
            ],
        },
        {
            kind: 'category',
            name: localize('Sell conditions'),
            colour: COLOURS.sell,
            contents: [
                { kind: 'block', type: BLOCK_TYPES.DURING_PURCHASE },
                { kind: 'block', type: BLOCK_TYPES.SELL_AT_MARKET },
                { kind: 'block', type: BLOCK_TYPES.SELL_AVAILABLE },
            ],
        },
        {
            kind: 'category',
            name: localize('Restart trading conditions'),
            colour: COLOURS.restart,
            contents: [
                { kind: 'block', type: BLOCK_TYPES.AFTER_PURCHASE },
                { kind: 'block', type: BLOCK_TYPES.TRADE_AGAIN },
                { kind: 'block', type: BLOCK_TYPES.CONTRACT_CHECK_RESULT },
            ],
        },
        { kind: 'sep' },
        {
            kind: 'category',
            name: localize('Analysis'),
            colour: COLOURS.analysis,
            contents: [
                { kind: 'block', type: BLOCK_TYPES.TICK },
                { kind: 'block', type: BLOCK_TYPES.LAST_DIGIT },
                { kind: 'block', type: BLOCK_TYPES.READ_DETAILS },
            ],
        },
        {
            kind: 'category',
            name: localize('Utility'),
            colour: COLOURS.utility,
            contents: [
                { kind: 'block', type: BLOCK_TYPES.BALANCE },
                { kind: 'block', type: BLOCK_TYPES.TOTAL_PROFIT },
                { kind: 'block', type: BLOCK_TYPES.TOTAL_RUNS },
                { kind: 'block', type: BLOCK_TYPES.NOTIFY, inputs: { MESSAGE: txt('abc') } },
                { kind: 'block', type: BLOCK_TYPES.TIMEOUT, inputs: { SECONDS: num(1) } },
            ],
        },
        {
            kind: 'category',
            name: localize('Logic'),
            colour: '#5c81a6',
            contents: [
                { kind: 'block', type: 'controls_if' },
                { kind: 'block', type: 'logic_compare' },
                { kind: 'block', type: 'logic_operation' },
                { kind: 'block', type: 'logic_negate' },
                { kind: 'block', type: 'logic_boolean' },
            ],
        },
        {
            kind: 'category',
            name: localize('Loops'),
            colour: '#5ca65c',
            contents: [
                { kind: 'block', type: 'controls_repeat_ext', inputs: { TIMES: num(10) } },
                { kind: 'block', type: 'controls_whileUntil' },
                { kind: 'block', type: 'controls_flow_statements' },
            ],
        },
        {
            kind: 'category',
            name: localize('Math'),
            colour: '#5c68a6',
            contents: [
                { kind: 'block', type: 'math_number' },
                { kind: 'block', type: 'math_arithmetic', inputs: { A: num(1), B: num(1) } },
                { kind: 'block', type: 'math_single', inputs: { NUM: num(9) } },
                { kind: 'block', type: 'math_modulo', inputs: { DIVIDEND: num(64), DIVISOR: num(10) } },
                { kind: 'block', type: 'math_round', inputs: { NUM: num(3.1) } },
                { kind: 'block', type: 'math_random_int', inputs: { FROM: num(1), TO: num(100) } },
            ],
        },
        {
            kind: 'category',
            name: localize('Text'),
            colour: '#5ca68d',
            contents: [
                { kind: 'block', type: 'text' },
                { kind: 'block', type: 'text_join' },
            ],
        },
        { kind: 'category', name: localize('Variables'), colour: '#a65c81', custom: 'VARIABLE' },
        { kind: 'category', name: localize('Functions'), colour: '#995ba5', custom: 'PROCEDURE' },
    ],
});
