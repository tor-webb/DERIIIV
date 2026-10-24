import * as Blockly from 'blockly';

import { localize } from '@deriv-com/translations';

import { BLOCK_TYPES, ROOT_BLOCK_TYPES } from './blocks';

export const STORAGE_KEY = 'bot_builder_workspace';

export type TJournalLevel = 'info' | 'success' | 'warn' | 'error';

export type TJournalEntry = {
    id: number;
    level: TJournalLevel;
    message: string;
    time: string;
};

export const getDefaultWorkspaceState = () => ({
    blocks: {
        languageVersion: 0,
        blocks: [
            {
                type: BLOCK_TYPES.TRADE_DEFINITION,
                id: 'trade_definition',
                x: 20,
                y: 20,
                fields: {
                    MARKET: '1HZ100V',
                    CONTRACT_TYPE: 'CALL',
                    DURATION: 5,
                    DURATION_UNIT: 't',
                    STAKE: 1,
                },
            },
            {
                type: BLOCK_TYPES.BEFORE_PURCHASE,
                id: 'before_purchase',
                x: 20,
                y: 230,
                inputs: {
                    STACK: { block: { type: BLOCK_TYPES.PURCHASE, id: 'purchase', fields: { PURCHASE_TYPE: 'CALL' } } },
                },
            },
            {
                type: BLOCK_TYPES.SELL_CONDITIONS,
                id: 'sell_conditions',
                x: 360,
                y: 20,
            },
            {
                type: BLOCK_TYPES.RESTART_CONDITIONS,
                id: 'restart_conditions',
                x: 360,
                y: 230,
                inputs: {
                    STACK: { block: { type: BLOCK_TYPES.TRADE_AGAIN, id: 'trade_again' } },
                },
            },
        ],
    },
});

export const saveWorkspaceToStorage = (workspace: Blockly.Workspace) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Blockly.serialization.workspaces.save(workspace)));
    } catch {
        // storage can be unavailable (private mode, quota); the bot is still editable
    }
};

export const readWorkspaceFromStorage = (): Record<string, unknown> | null => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

export const loadWorkspaceState = (workspace: Blockly.Workspace, state: Record<string, unknown>) => {
    Blockly.Events.disable();
    try {
        Blockly.serialization.workspaces.load(state, workspace);
    } finally {
        Blockly.Events.enable();
    }
};

export const serializeWorkspace = (workspace: Blockly.Workspace) =>
    JSON.stringify(Blockly.serialization.workspaces.save(workspace), null, 2);

export const parseWorkspaceFile = (text: string): Record<string, unknown> | null => {
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && parsed.blocks) return parsed as Record<string, unknown>;
        return null;
    } catch {
        return null;
    }
};

export type TValidationIssue = { level: TJournalLevel; message: string };

const ROOT_LABELS: Record<(typeof ROOT_BLOCK_TYPES)[number], string> = {
    [BLOCK_TYPES.TRADE_DEFINITION]: 'Trade parameters',
    [BLOCK_TYPES.BEFORE_PURCHASE]: 'Purchase conditions',
    [BLOCK_TYPES.SELL_CONDITIONS]: 'Sell conditions',
    [BLOCK_TYPES.RESTART_CONDITIONS]: 'Restart trading conditions',
};

const OPTIONAL_ROOTS: string[] = [BLOCK_TYPES.SELL_CONDITIONS];

const getAncestorRoot = (block: Blockly.Block) => block.getRootBlock().type;

/**
 * Checks the structure of the bot without running it. Pure over a Blockly workspace so it can be used
 * with a headless workspace in tests.
 */
export const validateBot = (workspace: Blockly.Workspace): TValidationIssue[] => {
    const issues: TValidationIssue[] = [];
    const all_blocks = workspace.getAllBlocks(false);

    ROOT_BLOCK_TYPES.forEach(type => {
        const count = all_blocks.filter(block => block.type === type).length;
        const label = ROOT_LABELS[type];
        if (count === 0 && !OPTIONAL_ROOTS.includes(type)) {
            issues.push({ level: 'error', message: localize('Missing block: {{label}}.', { label }) });
        } else if (count > 1) {
            issues.push({
                level: 'error',
                message: localize('Only one "{{label}}" block is allowed, found {{count}}.', { label, count }),
            });
        }
    });

    const purchase_blocks = all_blocks.filter(block => block.type === BLOCK_TYPES.PURCHASE);
    if (all_blocks.some(block => block.type === BLOCK_TYPES.BEFORE_PURCHASE) && purchase_blocks.length === 0) {
        issues.push({ level: 'error', message: localize('Add a "Purchase" block to the purchase conditions.') });
    }
    purchase_blocks
        .filter(block => getAncestorRoot(block) !== BLOCK_TYPES.BEFORE_PURCHASE)
        .forEach(() =>
            issues.push({
                level: 'error',
                message: localize('"Purchase" can only be used inside the purchase conditions.'),
            })
        );

    all_blocks
        .filter(block => block.type === BLOCK_TYPES.SELL_AT_MARKET)
        .filter(block => getAncestorRoot(block) !== BLOCK_TYPES.SELL_CONDITIONS)
        .forEach(() =>
            issues.push({
                level: 'error',
                message: localize('"Sell at market price" can only be used inside the sell conditions.'),
            })
        );

    all_blocks
        .filter(block => block.type === BLOCK_TYPES.TRADE_AGAIN)
        .filter(block => getAncestorRoot(block) !== BLOCK_TYPES.RESTART_CONDITIONS)
        .forEach(() =>
            issues.push({
                level: 'error',
                message: localize('"Trade again" can only be used inside the restart trading conditions.'),
            })
        );

    all_blocks
        .filter(block => block.type === BLOCK_TYPES.RESTART_CONDITIONS)
        .forEach(block => {
            const has_trade_again = block.getDescendants(false).some(d => d.type === BLOCK_TYPES.TRADE_AGAIN);
            if (!has_trade_again) {
                issues.push({
                    level: 'warn',
                    message: localize('The bot will stop after one trade because nothing triggers "Trade again".'),
                });
            }
        });

    const trade_definition = all_blocks.find(block => block.type === BLOCK_TYPES.TRADE_DEFINITION);
    if (trade_definition) {
        const stake = Number(trade_definition.getFieldValue('STAKE'));
        if (!Number.isFinite(stake) || stake <= 0) {
            issues.push({ level: 'error', message: localize('Stake must be greater than zero.') });
        }
        const contract_type = trade_definition.getFieldValue('CONTRACT_TYPE');
        const purchase_mismatch = purchase_blocks.some(block => block.getFieldValue('PURCHASE_TYPE') !== contract_type);
        if (purchase_mismatch) {
            issues.push({
                level: 'warn',
                message: localize('A "Purchase" block uses a different contract type than the trade parameters.'),
            });
        }
    }

    all_blocks
        .filter(block => !block.isEnabled())
        .forEach(() => issues.push({ level: 'warn', message: localize('A disabled block was ignored.') }));

    return issues;
};

export const formatTime = (date = new Date()) =>
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
