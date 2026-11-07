import type { TScanRow } from '../use-voltrex-scanner';
import {
    ALERT_COOLDOWN_MS,
    ANY_MARKET,
    dueHits,
    findHits,
    ideaFor,
    loadRules,
    MAX_RULES,
    RULES_KEY,
    saveRules,
    TAlertRule,
    validateRule,
} from '../voltrex-alerts';
import { analyseMarket } from '../voltrex-analysis';
import { digitStats } from '../voltrex-digits';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const candles = (up: boolean) =>
    Array.from({ length: 120 }, (_item, index) => {
        const close = up ? 100 + index + 0.03 * index ** 2 : 400 - index - 0.03 * index ** 2;
        return { epoch: index * 300, open: close, high: close + 0.2, low: close - 0.2, close };
    });

const row = (symbol: string, overrides: Partial<TScanRow> = {}): TScanRow =>
    ({
        symbol,
        name: symbol,
        category: 'volatility',
        is_open: true,
        status: 'ready',
        signal: analyseMarket(candles(true), candles(true)),
        volatility_level: 'medium',
        ...overrides,
    }) as TScanRow;

const rule = (overrides: Partial<TAlertRule> = {}): TAlertRule => ({
    id: 'a',
    product: 'rise_fall',
    symbol: ANY_MARKET,
    min_strength: 10,
    ...overrides,
});

const no_stats = () => null;
const skewed_even = digitStats(Array.from({ length: 100 }, (_item, index) => (index < 70 ? 2 : 1)));

describe('validateRule', () => {
    it('accepts a good rule and refuses bad ones', () => {
        expect(validateRule(rule())).toBeNull();
        expect(validateRule({ ...rule(), product: 'touch' as never })).toMatch(/contract/);
        expect(validateRule({ ...rule(), symbol: '' })).toMatch(/market/);
        expect(validateRule({ ...rule(), min_strength: 0 })).toMatch(/between 1 and 100/);
        expect(validateRule({ ...rule(), min_strength: 101 })).toMatch(/between 1 and 100/);
    });
});

describe('storage', () => {
    beforeEach(() => localStorage.clear());

    it('saves and loads rules, and drops bad entries', () => {
        saveRules([rule()]);
        expect(loadRules()).toEqual([rule()]);
        localStorage.setItem(RULES_KEY, JSON.stringify([rule(), { id: 'x', product: 'nope' }, 5]));
        expect(loadRules()).toEqual([rule()]);
    });

    it('survives broken storage', () => {
        localStorage.setItem(RULES_KEY, '{not json');
        expect(loadRules()).toEqual([]);
        localStorage.setItem(
            RULES_KEY,
            JSON.stringify(Array.from({ length: 30 }, (_item, i) => rule({ id: `r${i}` })))
        );
        expect(loadRules()).toHaveLength(MAX_RULES);
    });
});

describe('ideaFor', () => {
    it('gives Rise for an up market and nothing without a signal', () => {
        expect(ideaFor('rise_fall', row('A'), null)?.label).toBe('Rise');
        expect(ideaFor('multiplier', row('A'), null)?.label).toBe('Multiplier up');
        expect(ideaFor('rise_fall', row('A', { signal: null }), null)).toBeNull();
        expect(ideaFor('accumulator', row('A', { signal: null }), null)).toBeNull();
    });

    it('needs enough digits for the digit products', () => {
        expect(ideaFor('even_odd', row('A'), null)).toBeNull();
        expect(ideaFor('even_odd', row('A'), digitStats([2, 4, 6]))).toBeNull();
        expect(ideaFor('even_odd', row('A'), skewed_even)?.label).toBe('Even');
    });
});

describe('findHits', () => {
    it('finds a rule on any market or on one market', () => {
        const rows = [row('A'), row('B')];
        expect(findHits([rule()], rows, no_stats)).toHaveLength(2);
        expect(findHits([rule({ symbol: 'B' })], rows, no_stats).map(hit => hit.symbol)).toEqual(['B']);
    });

    it('ignores weak ideas, closed markets and markets not analysed yet', () => {
        expect(findHits([rule({ min_strength: 100 })], [row('A')], no_stats)).toEqual([]);
        expect(
            findHits([rule()], [row('A', { is_open: false }), row('B', { status: 'loading' as never })], no_stats)
        ).toEqual([]);
    });

    it('uses digit statistics for digit rules', () => {
        const hits = findHits([rule({ product: 'even_odd', min_strength: 50 })], [row('A')], () => skewed_even);
        expect(hits).toHaveLength(1);
        expect(hits[0].label).toBe('Even');
    });
});

describe('dueHits', () => {
    it('alerts once, then not again until the cooldown has passed', () => {
        const hits = findHits([rule()], [row('A')], no_stats);
        const last = new Map<string, number>();
        expect(dueHits(hits, last, 1000)).toHaveLength(1);
        expect(dueHits(hits, last, 2000)).toHaveLength(0);
        expect(dueHits(hits, last, 1000 + ALERT_COOLDOWN_MS)).toHaveLength(1);
    });

    it('keeps markets and rules apart', () => {
        const last = new Map<string, number>();
        const hits = findHits([rule(), rule({ id: 'b' })], [row('A'), row('B')], no_stats);
        expect(dueHits(hits, last, 1000)).toHaveLength(4);
    });
});
