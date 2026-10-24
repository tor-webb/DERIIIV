import * as Blockly from 'blockly';

import { localize } from '@deriv-com/translations';

export const BLOCK_TYPES = {
    TRADE_DEFINITION: 'trade_definition',
    BEFORE_PURCHASE: 'before_purchase',
    PURCHASE: 'purchase',
    SELL_CONDITIONS: 'sell_conditions',
    SELL_AT_MARKET: 'sell_at_market',
    RESTART_CONDITIONS: 'restart_conditions',
    TRADE_AGAIN: 'trade_again',
    LAST_TICK: 'last_tick',
    LAST_DIGIT: 'last_digit',
    ACCOUNT_BALANCE: 'account_balance',
    TOTAL_PROFIT: 'total_profit',
    LAST_TRADE_RESULT: 'last_trade_result',
    IS_SELL_AVAILABLE: 'is_sell_available',
    CURRENT_PROFIT: 'current_profit',
    NOTIFY: 'notify',
} as const;

/** Blocks that must appear exactly once at the top level of a bot. */
export const ROOT_BLOCK_TYPES = [
    BLOCK_TYPES.TRADE_DEFINITION,
    BLOCK_TYPES.BEFORE_PURCHASE,
    BLOCK_TYPES.SELL_CONDITIONS,
    BLOCK_TYPES.RESTART_CONDITIONS,
] as const;

const COLOURS = {
    trade: '#2a3052',
    purchase: '#0e7c86',
    sell: '#c0392b',
    restart: '#6c5ce7',
    value: '#2f80ed',
    action: '#e17055',
};

export const MARKET_OPTIONS: [string, string][] = [
    ['Volatility 10 Index', '1HZ10V'],
    ['Volatility 25 Index', '1HZ25V'],
    ['Volatility 50 Index', '1HZ50V'],
    ['Volatility 75 Index', '1HZ75V'],
    ['Volatility 100 Index', '1HZ100V'],
    ['EUR/USD', 'frxEURUSD'],
    ['GBP/USD', 'frxGBPUSD'],
    ['USD/JPY', 'frxUSDJPY'],
];

export const CONTRACT_OPTIONS: [string, string][] = [
    ['Rise', 'CALL'],
    ['Fall', 'PUT'],
];

export const DURATION_UNIT_OPTIONS: [string, string][] = [
    ['Ticks', 't'],
    ['Seconds', 's'],
    ['Minutes', 'm'],
    ['Hours', 'h'],
    ['Days', 'd'],
];

let blocks_registered = false;

export const registerBlocks = () => {
    if (blocks_registered) return;
    blocks_registered = true;

    Blockly.common.defineBlocksWithJsonArray([
        {
            type: BLOCK_TYPES.TRADE_DEFINITION,
            message0: localize('1. Trade parameters'),
            message1: localize('Market: %1'),
            args1: [{ type: 'field_dropdown', name: 'MARKET', options: MARKET_OPTIONS }],
            message2: localize('Contract type: %1'),
            args2: [{ type: 'field_dropdown', name: 'CONTRACT_TYPE', options: CONTRACT_OPTIONS }],
            message3: localize('Duration: %1 %2'),
            args3: [
                { type: 'field_number', name: 'DURATION', value: 5, min: 1, precision: 1 },
                { type: 'field_dropdown', name: 'DURATION_UNIT', options: DURATION_UNIT_OPTIONS },
            ],
            message4: localize('Stake: %1'),
            args4: [{ type: 'field_number', name: 'STAKE', value: 1, min: 0.35, precision: 0.01 }],
            colour: COLOURS.trade,
            tooltip: localize('Defines the market, contract type, duration and stake for every trade.'),
        },
        {
            type: BLOCK_TYPES.BEFORE_PURCHASE,
            message0: localize('2. Purchase conditions'),
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'STACK', check: ['Purchase', 'Notify', 'Statement'] }],
            colour: COLOURS.purchase,
            tooltip: localize('Decide when to buy a contract.'),
        },
        {
            type: BLOCK_TYPES.PURCHASE,
            message0: localize('Purchase %1'),
            args0: [{ type: 'field_dropdown', name: 'PURCHASE_TYPE', options: CONTRACT_OPTIONS }],
            previousStatement: 'Purchase',
            colour: COLOURS.purchase,
            tooltip: localize('Buys a contract of the selected type.'),
        },
        {
            type: BLOCK_TYPES.SELL_CONDITIONS,
            message0: localize('3. Sell conditions (optional)'),
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'STACK', check: ['Sell', 'Notify', 'Statement'] }],
            colour: COLOURS.sell,
            tooltip: localize('Decide when to sell an open contract before it expires.'),
        },
        {
            type: BLOCK_TYPES.SELL_AT_MARKET,
            message0: localize('Sell at market price'),
            previousStatement: 'Sell',
            colour: COLOURS.sell,
            tooltip: localize('Sells the open contract at the current market price.'),
        },
        {
            type: BLOCK_TYPES.RESTART_CONDITIONS,
            message0: localize('4. Restart trading conditions'),
            message1: '%1',
            args1: [{ type: 'input_statement', name: 'STACK', check: ['Restart', 'Notify', 'Statement'] }],
            colour: COLOURS.restart,
            tooltip: localize('Decide whether to trade again once a contract finishes.'),
        },
        {
            type: BLOCK_TYPES.TRADE_AGAIN,
            message0: localize('Trade again'),
            previousStatement: 'Restart',
            colour: COLOURS.restart,
            tooltip: localize('Starts the next trade from the purchase conditions.'),
        },
        {
            type: BLOCK_TYPES.LAST_TICK,
            message0: localize('Last tick price'),
            output: 'Number',
            colour: COLOURS.value,
            tooltip: localize('The most recent tick price of the selected market.'),
        },
        {
            type: BLOCK_TYPES.LAST_DIGIT,
            message0: localize('Last digit of last tick'),
            output: 'Number',
            colour: COLOURS.value,
            tooltip: localize('The last digit of the most recent tick price.'),
        },
        {
            type: BLOCK_TYPES.ACCOUNT_BALANCE,
            message0: localize('Account balance'),
            output: 'Number',
            colour: COLOURS.value,
            tooltip: localize('Your current account balance.'),
        },
        {
            type: BLOCK_TYPES.TOTAL_PROFIT,
            message0: localize('Total profit'),
            output: 'Number',
            colour: COLOURS.value,
            tooltip: localize('Profit or loss across all trades since the bot started.'),
        },
        {
            type: BLOCK_TYPES.CURRENT_PROFIT,
            message0: localize('Profit of open contract'),
            output: 'Number',
            colour: COLOURS.value,
            tooltip: localize('Current profit or loss of the open contract.'),
        },
        {
            type: BLOCK_TYPES.LAST_TRADE_RESULT,
            message0: localize('Last trade result is %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'RESULT',
                    options: [
                        [localize('Win'), 'win'],
                        [localize('Loss'), 'loss'],
                    ],
                },
            ],
            output: 'Boolean',
            colour: COLOURS.value,
            tooltip: localize('True if the last finished contract matches the selected result.'),
        },
        {
            type: BLOCK_TYPES.IS_SELL_AVAILABLE,
            message0: localize('Is sell available'),
            output: 'Boolean',
            colour: COLOURS.value,
            tooltip: localize('True if the open contract can be sold right now.'),
        },
        {
            type: BLOCK_TYPES.NOTIFY,
            message0: localize('Notify %1 %2'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'LEVEL',
                    options: [
                        [localize('Info'), 'info'],
                        [localize('Success'), 'success'],
                        [localize('Warn'), 'warn'],
                        [localize('Error'), 'error'],
                    ],
                },
                { type: 'field_input', name: 'MESSAGE', text: 'Hello' },
            ],
            previousStatement: ['Purchase', 'Sell', 'Restart', 'Notify'],
            nextStatement: ['Purchase', 'Sell', 'Restart', 'Notify'],
            colour: COLOURS.action,
            tooltip: localize('Shows a message in the journal.'),
        },
    ]);
};

export const getToolbox = (): Blockly.utils.toolbox.ToolboxDefinition => ({
    kind: 'categoryToolbox',
    contents: [
        {
            kind: 'category',
            name: localize('Trade parameters'),
            colour: COLOURS.trade,
            contents: [{ kind: 'block', type: BLOCK_TYPES.TRADE_DEFINITION }],
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
                { kind: 'block', type: BLOCK_TYPES.SELL_CONDITIONS },
                { kind: 'block', type: BLOCK_TYPES.SELL_AT_MARKET },
            ],
        },
        {
            kind: 'category',
            name: localize('Restart conditions'),
            colour: COLOURS.restart,
            contents: [
                { kind: 'block', type: BLOCK_TYPES.RESTART_CONDITIONS },
                { kind: 'block', type: BLOCK_TYPES.TRADE_AGAIN },
            ],
        },
        { kind: 'sep' },
        {
            kind: 'category',
            name: localize('Market data'),
            colour: COLOURS.value,
            contents: [
                { kind: 'block', type: BLOCK_TYPES.LAST_TICK },
                { kind: 'block', type: BLOCK_TYPES.LAST_DIGIT },
                { kind: 'block', type: BLOCK_TYPES.ACCOUNT_BALANCE },
                { kind: 'block', type: BLOCK_TYPES.TOTAL_PROFIT },
                { kind: 'block', type: BLOCK_TYPES.CURRENT_PROFIT },
                { kind: 'block', type: BLOCK_TYPES.LAST_TRADE_RESULT },
                { kind: 'block', type: BLOCK_TYPES.IS_SELL_AVAILABLE },
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
            name: localize('Math'),
            colour: '#5c68a6',
            contents: [
                { kind: 'block', type: 'math_number' },
                { kind: 'block', type: 'math_arithmetic' },
                { kind: 'block', type: 'math_single' },
                { kind: 'block', type: 'math_random_int' },
            ],
        },
        {
            kind: 'category',
            name: localize('Variables'),
            colour: '#a65c81',
            custom: 'VARIABLE',
        },
        {
            kind: 'category',
            name: localize('Utility'),
            colour: COLOURS.action,
            contents: [{ kind: 'block', type: BLOCK_TYPES.NOTIFY }],
        },
    ],
});
