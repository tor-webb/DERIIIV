import { localize } from '@deriv-com/translations';

import type { TScanRow } from './use-voltrex-scanner';
import { evaluateStrategy } from './voltrex-analysis';
import { bestDigitIdea, MIN_DIGITS, TDigitStats } from './voltrex-digits';
import { accumulatorStrength } from './voltrex-entries';
import type { TProductId } from './voltrex-products';

/**
 * Smart alerts: tell the person when the scanner finds an idea of a chosen kind at or above a chosen strength, on one
 * market or on any. Alerts only watch; they never place a trade. They run while the VOLTREX page is open.
 *
 * Strengths are on the same 0 to 100 scale as everywhere else on the page. Digit ideas describe how the last digits
 * have come up so far; the digits of Deriv's synthetic indices are random, so an alert is not a forecast.
 */

export type TAlertProduct = Extract<
    TProductId,
    'rise_fall' | 'multiplier' | 'accumulator' | 'over_under' | 'match_differ' | 'even_odd'
>;

/** Touch / No Touch needs server quotes for every market, so it is not offered as an alert. */
export const ALERT_PRODUCTS: TAlertProduct[] = [
    'rise_fall',
    'multiplier',
    'accumulator',
    'over_under',
    'match_differ',
    'even_odd',
];

export const ANY_MARKET = 'any';

export type TAlertRule = {
    id: string;
    product: TAlertProduct;
    /** A market symbol, or `any`. */
    symbol: string;
    min_strength: number;
};

export type TAlertHit = {
    rule_id: string;
    symbol: string;
    name: string;
    product: TAlertProduct;
    label: string;
    strength: number;
    why: string;
};

export const RULES_KEY = 'voltrex_alert_rules';
export const SOUND_KEY = 'voltrex_alert_sound';
/** The same rule does not alert again for the same market within this time. */
export const ALERT_COOLDOWN_MS = 10 * 60 * 1000;
export const MAX_RULES = 12;
export const MAX_RECENT = 12;

export const isAlertProduct = (value: unknown): value is TAlertProduct =>
    typeof value === 'string' && (ALERT_PRODUCTS as string[]).includes(value);

export const validateRule = (rule: Partial<TAlertRule>): string | null => {
    if (!isAlertProduct(rule.product)) return localize('Choose a contract type.');
    if (!rule.symbol) return localize('Choose a market.');
    const strength = Number(rule.min_strength);
    if (!Number.isFinite(strength) || strength < 1 || strength > 100) {
        return localize('The minimum strength must be between 1 and 100.');
    }
    return null;
};

const isRule = (value: unknown): value is TAlertRule => {
    const rule = value as TAlertRule;
    return !!rule && typeof rule.id === 'string' && validateRule(rule) === null;
};

export const loadRules = (): TAlertRule[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(RULES_KEY) ?? '[]');
        return Array.isArray(parsed) ? parsed.filter(isRule).slice(0, MAX_RULES) : [];
    } catch {
        return [];
    }
};

export const saveRules = (rules: TAlertRule[]) => {
    try {
        localStorage.setItem(RULES_KEY, JSON.stringify(rules));
    } catch {
        // storage can be blocked; the rules then last until the page is closed
    }
};

export const loadSound = (): boolean => {
    try {
        return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
        return true;
    }
};

export const saveSound = (on: boolean) => {
    try {
        localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
        // see saveRules
    }
};

type TIdea = { label: string; strength: number; why: string };

/** What one market offers for one contract type right now, or null when there is nothing to say. */
export const ideaFor = (product: TAlertProduct, row: TScanRow, stats: TDigitStats | null): TIdea | null => {
    if (product === 'accumulator') {
        if (!row.signal) return null;
        return {
            label: localize('Accumulator'),
            strength: accumulatorStrength(row),
            why: localize('The price looks to be ranging ({{level}} volatility).', {
                level: row.volatility_level ?? localize('unknown'),
            }),
        };
    }
    if (product === 'rise_fall' || product === 'multiplier') {
        if (!row.signal) return null;
        const idea = evaluateStrategy('confluence', row.signal);
        if (!idea) return null;
        const is_up = idea.side === 'CALL';
        let label = is_up ? localize('Rise') : localize('Fall');
        if (product === 'multiplier') label = is_up ? localize('Multiplier up') : localize('Multiplier down');
        return { label, strength: idea.strength, why: idea.why };
    }
    if (!stats || stats.count < MIN_DIGITS) return null;
    const idea = bestDigitIdea(product, stats);
    return idea ? { label: idea.choice.label, strength: idea.strength, why: idea.why } : null;
};

/** Every rule that is met right now. Closed markets and markets with no analysis yet are skipped. */
export const findHits = (
    rules: TAlertRule[],
    rows: TScanRow[],
    getStats: (symbol: string) => TDigitStats | null
): TAlertHit[] => {
    const hits: TAlertHit[] = [];
    rules.forEach(rule => {
        rows.forEach(row => {
            if (!row.is_open || row.status !== 'ready') return;
            if (rule.symbol !== ANY_MARKET && rule.symbol !== row.symbol) return;
            const idea = ideaFor(rule.product, row, getStats(row.symbol));
            if (!idea || idea.strength < rule.min_strength) return;
            hits.push({
                rule_id: rule.id,
                symbol: row.symbol,
                name: row.name,
                product: rule.product,
                label: idea.label,
                strength: idea.strength,
                why: idea.why,
            });
        });
    });
    return hits;
};

/** The hits that have not alerted lately. Updates `last` for the ones it returns. */
export const dueHits = (hits: TAlertHit[], last: Map<string, number>, now: number): TAlertHit[] =>
    hits.filter(hit => {
        const key = `${hit.rule_id}:${hit.symbol}`;
        const before = last.get(key);
        if (before !== undefined && now - before < ALERT_COOLDOWN_MS) return false;
        last.set(key, now);
        return true;
    });

export const newRuleId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
