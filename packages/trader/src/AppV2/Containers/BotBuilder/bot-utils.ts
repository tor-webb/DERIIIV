import * as Blockly from 'blockly';

import { localize } from '@deriv-com/translations';

import { ALLOWED_BLOCK_TYPES, BLOCK_TYPES, DIGIT_CONTRACTS, ROOT_BLOCK_TYPES, TRADE_TYPES } from './blocks';

export const STORAGE_KEY = 'bot_builder_workspace';

/** Largest bot file accepted on import, in characters. */
export const MAX_FILE_SIZE = 2_000_000;
const MAX_BLOCKS = 5000;
const MAX_DEPTH = 200;

export type TJournalLevel = 'info' | 'success' | 'warn' | 'error';

export type TJournalEntry = {
    id: number;
    level: TJournalLevel;
    message: string;
    time: string;
};

/* ----------------------------------------------------------------------------------------------- */
/* Starter bot                                                                                      */
/* ----------------------------------------------------------------------------------------------- */

type TBlockState = Record<string, unknown>;

/** Chains blocks into a stack: each block becomes the `next` of the one before it. */
const stack = (...blocks: TBlockState[]): TBlockState => {
    const [first, ...rest] = blocks;
    return rest.length ? { ...first, next: { block: stack(...rest) } } : first;
};

const shadowNumber = (value: number) => ({ shadow: { type: 'math_number', fields: { NUM: value } } });

export const getDefaultWorkspaceState = () => ({
    blocks: {
        languageVersion: 0,
        blocks: [
            {
                type: BLOCK_TYPES.TRADE_DEFINITION,
                id: 'trade_definition',
                x: 20,
                y: 20,
                inputs: {
                    TRADE_OPTIONS: {
                        block: stack(
                            {
                                type: BLOCK_TYPES.MARKET,
                                fields: {
                                    MARKET_LIST: 'synthetic_index',
                                    SUBMARKET_LIST: 'random_index',
                                    SYMBOL_LIST: '1HZ100V',
                                },
                            },
                            {
                                type: BLOCK_TYPES.TRADE_TYPE,
                                fields: { TRADETYPECAT_LIST: 'callput', TRADETYPE_LIST: 'risefall' },
                            },
                            { type: BLOCK_TYPES.CONTRACT_TYPE, fields: { TYPE_LIST: 'both' } },
                            { type: BLOCK_TYPES.CANDLE_INTERVAL, fields: { CANDLEINTERVAL_LIST: '60' } },
                            { type: BLOCK_TYPES.RESTART_BUY_SELL, fields: { TIME_MACHINE_ENABLED: 'FALSE' } },
                            { type: BLOCK_TYPES.RESTART_ON_ERROR, fields: { RESTARTONERROR: 'TRUE' } }
                        ),
                    },
                    SUBMARKET: {
                        block: {
                            type: BLOCK_TYPES.TRADE_OPTIONS,
                            fields: { DURATIONTYPE_LIST: 't', CURRENCY_LIST: 'USD' },
                            inputs: {
                                DURATION: shadowNumber(5),
                                AMOUNT: shadowNumber(1),
                                PREDICTION: shadowNumber(0),
                            },
                        },
                    },
                },
            },
            {
                type: BLOCK_TYPES.BEFORE_PURCHASE,
                id: 'before_purchase',
                x: 20,
                y: 440,
                inputs: {
                    BEFOREPURCHASE_STACK: {
                        block: { type: BLOCK_TYPES.PURCHASE, fields: { PURCHASE_LIST: 'CALL' } },
                    },
                },
            },
            {
                type: BLOCK_TYPES.DURING_PURCHASE,
                id: 'during_purchase',
                x: 700,
                y: 20,
            },
            {
                type: BLOCK_TYPES.AFTER_PURCHASE,
                id: 'after_purchase',
                x: 700,
                y: 220,
                inputs: {
                    AFTERPURCHASE_STACK: { block: { type: BLOCK_TYPES.TRADE_AGAIN } },
                },
            },
        ],
    },
});

/* ----------------------------------------------------------------------------------------------- */
/* Storage                                                                                          */
/* ----------------------------------------------------------------------------------------------- */

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

/**
 * Loads the saved bot, or the starter bot when nothing usable is saved. A saved bot that no longer loads
 * (an older save, a block that has since been removed) must not leave the page empty.
 */
export const restoreWorkspace = (workspace: Blockly.Workspace) => {
    const saved = readWorkspaceFromStorage();
    if (saved) {
        try {
            const scan = scanState(saved);
            if (scan.errors.length === 0) {
                loadWorkspaceState(workspace, saved);
                return;
            }
        } catch {
            // fall through to the starter bot
        }
        workspace.clear();
    }
    loadWorkspaceState(workspace, getDefaultWorkspaceState());
};

/* ----------------------------------------------------------------------------------------------- */
/* Deriv Bot file format                                                                            */
/* ----------------------------------------------------------------------------------------------- */

/** Deriv Bot saves bots as Blockly XML with the `is_dbot` flag on the root. */
export const exportWorkspaceXml = (workspace: Blockly.Workspace): string => {
    const dom = Blockly.Xml.workspaceToDom(workspace);
    dom.setAttribute('is_dbot', 'true');
    dom.setAttribute('collection', 'false');
    return Blockly.Xml.domToPrettyText(dom);
};

export const serializeWorkspace = (workspace: Blockly.Workspace) =>
    JSON.stringify(Blockly.serialization.workspaces.save(workspace), null, 2);

export type TScanResult = { errors: string[] };

const describeUnknown = (types: Set<string>) =>
    localize('This bot uses blocks that are not supported here: {{blocks}}.', {
        blocks: Array.from(types).slice(0, 6).join(', '),
    });

/** Walks Blockly JSON state and checks the size and the block types. Nothing is loaded. */
const scanJsonBlock = (
    block: unknown,
    depth: number,
    seen: { count: number; unknown: Set<string> },
    errors: string[]
) => {
    if (errors.length) return;
    if (!block || typeof block !== 'object') {
        errors.push(localize('That file is not a valid bot.'));
        return;
    }
    if (depth > MAX_DEPTH) {
        errors.push(localize('This bot is nested too deeply.'));
        return;
    }
    const { type, inputs, next } = block as {
        type?: unknown;
        inputs?: Record<string, { block?: unknown; shadow?: unknown }>;
        next?: { block?: unknown; shadow?: unknown };
    };
    seen.count += 1;
    if (seen.count > MAX_BLOCKS) {
        errors.push(localize('This bot has too many blocks.'));
        return;
    }
    if (typeof type !== 'string' || !ALLOWED_BLOCK_TYPES.has(type)) seen.unknown.add(String(type));

    Object.values(inputs ?? {}).forEach(input => {
        if (input?.block) scanJsonBlock(input.block, depth + 1, seen, errors);
        if (input?.shadow) scanJsonBlock(input.shadow, depth + 1, seen, errors);
    });
    if (next?.block) scanJsonBlock(next.block, depth + 1, seen, errors);
};

export const scanState = (state: Record<string, unknown>): TScanResult => {
    const errors: string[] = [];
    const seen = { count: 0, unknown: new Set<string>() };
    const top = (state?.blocks as { blocks?: unknown[] } | undefined)?.blocks;
    if (!Array.isArray(top)) return { errors: [localize('That file is not a valid bot.')] };
    top.forEach(block => scanJsonBlock(block, 0, seen, errors));
    if (!errors.length && seen.unknown.size) errors.push(describeUnknown(seen.unknown));
    return { errors };
};

const scanXml = (root: Element): TScanResult => {
    const errors: string[] = [];
    const unknown = new Set<string>();
    let count = 0;

    const visit = (element: Element, depth: number) => {
        if (errors.length) return;
        if (depth > MAX_DEPTH) {
            errors.push(localize('This bot is nested too deeply.'));
            return;
        }
        const tag = element.tagName.toLowerCase();
        if (tag === 'block' || tag === 'shadow') {
            count += 1;
            if (count > MAX_BLOCKS) {
                errors.push(localize('This bot has too many blocks.'));
                return;
            }
            const type = element.getAttribute('type') ?? '';
            if (!ALLOWED_BLOCK_TYPES.has(type)) unknown.add(type || '(no type)');
        }
        Array.from(element.children).forEach(child => visit(child, depth + 1));
    };

    visit(root, 0);
    if (!errors.length && unknown.size) errors.push(describeUnknown(unknown));
    return { errors };
};

/* ----------------------------------------------------------------------------------------------- */
/* Legacy Binary Bot files                                                                          */
/* ----------------------------------------------------------------------------------------------- */

const childrenOf = (element: Element, tag?: string) =>
    Array.from(element.children).filter(child => !tag || child.tagName.toLowerCase() === tag);

const fieldOf = (block: Element, name: string) =>
    childrenOf(block, 'field').find(field => field.getAttribute('name') === name);

const makeElement = (doc: Document, tag: string, attributes: Record<string, string> = {}) => {
    const element = doc.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
};

/** The market, trade type and restart settings were fields of one `trade` block; Deriv Bot makes them blocks. */
const TRADE_SETTING_BLOCKS: [string, string[]][] = [
    [BLOCK_TYPES.MARKET, ['MARKET_LIST', 'SUBMARKET_LIST', 'SYMBOL_LIST']],
    [BLOCK_TYPES.TRADE_TYPE, ['TRADETYPECAT_LIST', 'TRADETYPE_LIST']],
    [BLOCK_TYPES.CONTRACT_TYPE, ['TYPE_LIST']],
    [BLOCK_TYPES.CANDLE_INTERVAL, ['CANDLEINTERVAL_LIST']],
    [BLOCK_TYPES.RESTART_BUY_SELL, ['TIME_MACHINE_ENABLED']],
    [BLOCK_TYPES.RESTART_ON_ERROR, ['RESTARTONERROR']],
];

const migrateTradeBlock = (trade: Element) => {
    const doc = trade.ownerDocument;
    let chain: Element | null = null;
    [...TRADE_SETTING_BLOCKS].reverse().forEach(([type, names]) => {
        const block = makeElement(doc, 'block', { type });
        names.forEach(name => {
            const old = fieldOf(trade, name);
            if (old) block.appendChild(old.cloneNode(true));
        });
        if (chain) {
            const next = makeElement(doc, 'next');
            next.appendChild(chain);
            block.appendChild(next);
        }
        chain = block;
    });
    childrenOf(trade, 'field').forEach(field => trade.removeChild(field));
    trade.setAttribute('type', BLOCK_TYPES.TRADE_DEFINITION);
    if (chain) {
        const statement = makeElement(doc, 'statement', { name: 'TRADE_OPTIONS' });
        statement.appendChild(chain);
        trade.insertBefore(statement, trade.firstChild);
    }
};

const isLegacyJoin = (element: Element) =>
    element.tagName.toLowerCase() === 'block' &&
    element.getAttribute('type') === 'text_join' &&
    childrenOf(element).some(
        child =>
            child.tagName.toLowerCase() === 'mutation' ||
            (child.tagName.toLowerCase() === 'value' && /^ADD\d+$/.test(child.getAttribute('name') ?? ''))
    );

const MAX_MIGRATION_STEPS = 2000;

/**
 * Binary Bot's "create text with" was a value block. Deriv Bot's is a statement that fills a variable. The text is
 * built in a statement placed just before the block that used it, and the value block becomes that variable.
 */
const hoistLegacyJoins = (root: Element) => {
    const doc = root.ownerDocument;
    for (let step = 1; step <= MAX_MIGRATION_STEPS; step += 1) {
        const joins = Array.from(root.getElementsByTagName('block')).filter(isLegacyJoin);
        // innermost first, so a join nested in another is already a variable by the time the outer one moves
        const join = joins.find(candidate => !Array.from(candidate.getElementsByTagName('block')).some(isLegacyJoin));
        if (!join) return;

        // climb to the statement block that holds this join, through any value blocks in between
        let statement: Element | null = join;
        while (statement) {
            const container: Element | null = statement.parentElement;
            const container_tag: string = container?.tagName.toLowerCase() ?? '';
            if (container_tag === 'next' || container_tag === 'statement') break;
            const is_value_slot = container_tag === 'value' || container_tag === 'shadow';
            statement = is_value_slot ? (container?.parentElement ?? null) : null;
        }
        const parent = statement?.parentElement;
        if (!statement || !parent || !join.parentElement) {
            // a join that is not inside any statement cannot be moved; the scan reports it
            join.setAttribute('type', 'legacy_text_join');
            return hoistLegacyJoins(root);
        }

        const variable_name = `joined text ${step}`;
        const variable_id = `legacy_text_${step}`;
        const parts = childrenOf(join, 'value')
            .filter(value => /^ADD\d+$/.test(value.getAttribute('name') ?? ''))
            .sort((a, b) => Number(a.getAttribute('name')?.slice(3)) - Number(b.getAttribute('name')?.slice(3)));

        let chain: Element | null = null;
        [...parts].reverse().forEach(part => {
            const piece = makeElement(doc, 'block', { type: 'text_statement' });
            const slot = makeElement(doc, 'value', { name: 'TEXT' });
            childrenOf(part).forEach(child => slot.appendChild(child));
            piece.appendChild(slot);
            if (chain) {
                const next = makeElement(doc, 'next');
                next.appendChild(chain);
                piece.appendChild(next);
            }
            chain = piece;
        });

        const setter = makeElement(doc, 'block', { type: 'text_join' });
        const set_field = makeElement(doc, 'field', { name: 'VARIABLE', id: variable_id, variabletype: '' });
        set_field.textContent = variable_name;
        setter.appendChild(set_field);
        if (chain) {
            const stack = makeElement(doc, 'statement', { name: 'STACK' });
            stack.appendChild(chain);
            setter.appendChild(stack);
        }

        const getter = makeElement(doc, 'block', { type: 'variables_get' });
        const get_field = makeElement(doc, 'field', { name: 'VAR', id: variable_id, variabletype: '' });
        get_field.textContent = variable_name;
        getter.appendChild(get_field);
        join.parentElement.replaceChild(getter, join);

        parent.replaceChild(setter, statement);
        const next = makeElement(doc, 'next');
        next.appendChild(statement);
        setter.appendChild(next);
    }
    // gave up: leave what is left for the scan to refuse
    Array.from(root.getElementsByTagName('block'))
        .filter(isLegacyJoin)
        .forEach(block => block.setAttribute('type', 'legacy_text_join'));
    return undefined;
};

/** Upgrades a Binary Bot file (`trade`, `tradeOptions`, value-form text join) to the blocks used here. */
export const migrateLegacyBot = (root: Element) => {
    Array.from(root.getElementsByTagName('block'))
        .filter(block => block.getAttribute('type') === 'trade')
        .forEach(migrateTradeBlock);
    Array.from(root.getElementsByTagName('block'))
        .filter(block => block.getAttribute('type') === 'tradeOptions')
        .forEach(block => block.setAttribute('type', BLOCK_TYPES.TRADE_OPTIONS));
    hoistLegacyJoins(root);
};

export type TParsedBot =
    | { ok: true; kind: 'json'; state: Record<string, unknown> }
    | { ok: true; kind: 'xml'; dom: Element }
    | { ok: false; errors: string[] };

const invalid = (message = localize('That file is not a valid bot.')): TParsedBot => ({ ok: false, errors: [message] });

/**
 * Reads a bot file (Deriv Bot XML or this page's JSON) and checks it before anything touches the workspace.
 * Bots come from other people, so an unknown block, an oversized file or an entity declaration is refused.
 */
export const parseBotFile = (text: string): TParsedBot => {
    if (typeof text !== 'string' || !text.trim()) return invalid();
    if (text.length > MAX_FILE_SIZE) return invalid(localize('That file is too large to be a bot.'));

    const trimmed = text.trimStart();
    if (trimmed.startsWith('<')) {
        // entity declarations are never part of a bot, and are how XML bombs are built
        if (/<!DOCTYPE|<!ENTITY/i.test(text)) return invalid();
        const parsed = new DOMParser().parseFromString(text, 'application/xml');
        const root = parsed.documentElement;
        if (!root || parsed.getElementsByTagName('parsererror').length || root.tagName.toLowerCase() !== 'xml') {
            return invalid();
        }
        migrateLegacyBot(root);
        const { errors } = scanXml(root);
        return errors.length ? { ok: false, errors } : { ok: true, kind: 'xml', dom: root };
    }

    let state: unknown;
    try {
        state = JSON.parse(text);
    } catch {
        return invalid();
    }
    if (!state || typeof state !== 'object') return invalid();
    const { errors } = scanState(state as Record<string, unknown>);
    return errors.length ? { ok: false, errors } : { ok: true, kind: 'json', state: state as Record<string, unknown> };
};

/** Loads a scanned bot into the workspace. Returns false, leaving the old bot in place, when Blockly refuses it. */
export const loadParsedBot = (workspace: Blockly.Workspace, parsed: Extract<TParsedBot, { ok: true }>): boolean => {
    const backup = Blockly.serialization.workspaces.save(workspace);
    try {
        if (parsed.kind === 'json') {
            loadWorkspaceState(workspace, parsed.state);
        } else {
            Blockly.Events.disable();
            try {
                workspace.clear();
                Blockly.Xml.domToWorkspace(parsed.dom, workspace);
            } finally {
                Blockly.Events.enable();
            }
        }
        return true;
    } catch {
        loadWorkspaceState(workspace, backup);
        return false;
    }
};

/* ----------------------------------------------------------------------------------------------- */
/* Validation                                                                                       */
/* ----------------------------------------------------------------------------------------------- */

export type TValidationIssue = { level: TJournalLevel; message: string };

const ROOT_LABELS: Record<(typeof ROOT_BLOCK_TYPES)[number], string> = {
    [BLOCK_TYPES.TRADE_DEFINITION]: 'Trade parameters',
    [BLOCK_TYPES.BEFORE_PURCHASE]: 'Purchase conditions',
    [BLOCK_TYPES.DURING_PURCHASE]: 'Sell conditions',
    [BLOCK_TYPES.AFTER_PURCHASE]: 'Restart trading conditions',
};

const OPTIONAL_ROOTS: string[] = [BLOCK_TYPES.DURING_PURCHASE];

const FUNCTION_ROOTS: string[] = [BLOCK_TYPES.PROCEDURE_DEF, BLOCK_TYPES.PROCEDURE_DEF_RETURN];

/** True when the block sits under `root`, or inside a function (which any section may call). */
const isUnder = (block: Blockly.Block, root: string) => {
    const root_type = block.getRootBlock().type;
    return root_type === root || FUNCTION_ROOTS.includes(root_type);
};

const plainNumber = (block: Blockly.Block, input: string): number | null => {
    const target = block.getInputTargetBlock(input);
    return target?.type === 'math_number' || target?.type === 'math_number_positive'
        ? Number(target.getFieldValue('NUM'))
        : null;
};

/**
 * Checks the structure of the bot without running it. Pure over a Blockly workspace so it can be used
 * with a headless workspace in tests.
 */
export const validateBot = (workspace: Blockly.Workspace): TValidationIssue[] => {
    const issues: TValidationIssue[] = [];
    const error = (message: string) => issues.push({ level: 'error', message });
    const warn = (message: string) => issues.push({ level: 'warn', message });
    const all_blocks = workspace.getAllBlocks(false);
    const ofType = (type: string) => all_blocks.filter(block => block.type === type);

    ROOT_BLOCK_TYPES.forEach(type => {
        const count = ofType(type).length;
        const label = ROOT_LABELS[type];
        if (count === 0 && !OPTIONAL_ROOTS.includes(type)) {
            error(localize('Missing block: {{label}}.', { label }));
        } else if (count > 1) {
            error(localize('Only one "{{label}}" block is allowed, found {{count}}.', { label, count }));
        }
    });

    const trade_definition = ofType(BLOCK_TYPES.TRADE_DEFINITION)[0];
    const market = ofType(BLOCK_TYPES.MARKET)[0];
    const trade_type_block = ofType(BLOCK_TYPES.TRADE_TYPE)[0];
    const contract_block = ofType(BLOCK_TYPES.CONTRACT_TYPE)[0];
    const options = ofType(BLOCK_TYPES.TRADE_OPTIONS)[0];

    if (trade_definition) {
        if (!market) error(localize('Missing block: Market.'));
        if (!trade_type_block) error(localize('Missing block: Trade type.'));
        if (!options) error(localize('Missing block: Trade options (duration and stake).'));
    }

    const trade_type = trade_type_block?.getFieldValue('TRADETYPE_LIST') as string | undefined;
    const trade_config = trade_type ? TRADE_TYPES[trade_type] : undefined;
    const allowed_contracts = trade_config?.contracts.map(([, value]) => value) ?? [];

    const purchase_blocks = ofType(BLOCK_TYPES.PURCHASE);
    if (ofType(BLOCK_TYPES.BEFORE_PURCHASE).length && purchase_blocks.length === 0) {
        error(localize('Add a "Purchase" block to the purchase conditions.'));
    }
    purchase_blocks
        .filter(block => !isUnder(block, BLOCK_TYPES.BEFORE_PURCHASE))
        .forEach(() => error(localize('"Purchase" can only be used inside the purchase conditions.')));

    ofType(BLOCK_TYPES.SELL_AT_MARKET)
        .filter(block => !isUnder(block, BLOCK_TYPES.DURING_PURCHASE))
        .forEach(() => error(localize('"Sell at market price" can only be used inside the sell conditions.')));

    const trade_again_blocks = ofType(BLOCK_TYPES.TRADE_AGAIN);
    trade_again_blocks
        .filter(block => !isUnder(block, BLOCK_TYPES.AFTER_PURCHASE))
        .forEach(() => error(localize('"Trade again" can only be used inside the restart trading conditions.')));

    ofType(BLOCK_TYPES.AFTER_PURCHASE).forEach(block => {
        const descendants = block.getDescendants(false);
        const hands_off = descendants.some(
            d =>
                d.type === BLOCK_TYPES.TRADE_AGAIN ||
                d.type === BLOCK_TYPES.PROCEDURE_CALL ||
                d.type === BLOCK_TYPES.TIMEOUT
        );
        if (!hands_off) {
            warn(localize('The bot will stop after one trade because nothing triggers "Trade again".'));
        }
    });

    if (trade_config) {
        const contract_choice = contract_block?.getFieldValue('TYPE_LIST') as string | undefined;
        if (contract_choice && contract_choice !== 'both' && !allowed_contracts.includes(contract_choice)) {
            error(localize('The contract type does not belong to the selected trade type.'));
        }
        purchase_blocks.forEach(block => {
            const purchase = block.getFieldValue('PURCHASE_LIST') as string;
            if (!allowed_contracts.includes(purchase)) {
                warn(localize('A "Purchase" block uses a contract that does not belong to the trade type.'));
            } else if (contract_choice && contract_choice !== 'both' && contract_choice !== purchase) {
                warn(localize('A "Purchase" block uses a different contract type than the trade parameters.'));
            }
        });
    }

    if (options) {
        const amount = plainNumber(options, 'AMOUNT');
        if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
            error(localize('Stake must be greater than zero.'));
        }
        const duration = plainNumber(options, 'DURATION');
        const unit = options.getFieldValue('DURATIONTYPE_LIST');
        if (duration !== null && !(duration >= 1)) error(localize('Duration must be at least 1.'));
        const is_digit_trade = trade_config?.category === 'digits';
        if (is_digit_trade && unit !== 't') error(localize('Digit trades can only use a duration in ticks.'));
        if (is_digit_trade && unit === 't' && duration !== null && duration > 10) {
            error(localize('Digit trades last between 1 and 10 ticks.'));
        }
        if (trade_config?.needs_prediction) {
            const prediction = plainNumber(options, 'PREDICTION');
            if (prediction !== null && !(Number.isInteger(prediction) && prediction >= 0 && prediction <= 9)) {
                error(localize('The prediction must be a digit from 0 to 9.'));
            }
        }
    }

    const uses_digit_purchase = purchase_blocks.some(block =>
        DIGIT_CONTRACTS.has(block.getFieldValue('PURCHASE_LIST'))
    );
    if (uses_digit_purchase && trade_config && trade_config.category !== 'digits') {
        error(localize('A digit contract needs a digit trade type.'));
    }

    all_blocks.filter(block => !block.isEnabled()).forEach(() => warn(localize('A disabled block was ignored.')));

    return issues;
};

export const formatTime = (date = new Date()) =>
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
