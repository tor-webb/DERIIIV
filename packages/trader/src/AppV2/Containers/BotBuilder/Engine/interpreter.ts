import { localize } from '@deriv-com/translations';

import type { TDataKind, TExpr, TLevel, TStmt } from './types';

export class RuntimeError extends Error {}

export type TInterpreterContext = {
    vars: Map<string, number | boolean>;
    read: (kind: TDataKind) => number | boolean;
    notify: (level: TLevel, message: string) => void;
    purchase: (contract_type: string) => void;
    sell: () => void;
    tradeAgain: () => void;
};

const toNumber = (value: number | boolean) => (typeof value === 'boolean' ? Number(value) : value);

const checkFinite = (value: number) => {
    if (!Number.isFinite(value))
        throw new RuntimeError(localize('A calculation in the bot produced an invalid number.'));
    return value;
};

export const evaluate = (expr: TExpr, ctx: TInterpreterContext): number | boolean => {
    switch (expr.t) {
        case 'num':
        case 'bool':
            return expr.v;
        case 'var':
            return ctx.vars.get(expr.name) ?? 0;
        case 'data':
            return ctx.read(expr.kind);
        case 'not':
            return !evaluate(expr.a, ctx);
        case 'logic': {
            const left = Boolean(evaluate(expr.a, ctx));
            // short-circuit like the logic blocks suggest
            if (expr.op === 'AND') return left && Boolean(evaluate(expr.b, ctx));
            return left || Boolean(evaluate(expr.b, ctx));
        }
        case 'cmp': {
            const a = toNumber(evaluate(expr.a, ctx));
            const b = toNumber(evaluate(expr.b, ctx));
            switch (expr.op) {
                case 'EQ':
                    return a === b;
                case 'NEQ':
                    return a !== b;
                case 'LT':
                    return a < b;
                case 'LTE':
                    return a <= b;
                case 'GT':
                    return a > b;
                default:
                    return a >= b;
            }
        }
        case 'arith': {
            const a = toNumber(evaluate(expr.a, ctx));
            const b = toNumber(evaluate(expr.b, ctx));
            switch (expr.op) {
                case 'ADD':
                    return checkFinite(a + b);
                case 'MINUS':
                    return checkFinite(a - b);
                case 'MULTIPLY':
                    return checkFinite(a * b);
                case 'DIVIDE':
                    if (b === 0) throw new RuntimeError(localize('The bot tried to divide by zero.'));
                    return checkFinite(a / b);
                default:
                    return checkFinite(a ** b);
            }
        }
        case 'single': {
            const a = toNumber(evaluate(expr.a, ctx));
            switch (expr.op) {
                case 'ROOT':
                    return checkFinite(Math.sqrt(a));
                case 'ABS':
                    return Math.abs(a);
                case 'NEG':
                    return -a;
                case 'LN':
                    return checkFinite(Math.log(a));
                case 'LOG10':
                    return checkFinite(Math.log10(a));
                case 'EXP':
                    return checkFinite(Math.exp(a));
                default:
                    return checkFinite(10 ** a);
            }
        }
        case 'rand': {
            const from = Math.ceil(toNumber(evaluate(expr.from, ctx)));
            const to = Math.floor(toNumber(evaluate(expr.to, ctx)));
            const [low, high] = from <= to ? [from, to] : [to, from];
            return low + Math.floor(Math.random() * (high - low + 1));
        }
        default:
            throw new RuntimeError(localize('Unknown expression.'));
    }
};

export const execute = (statements: TStmt[], ctx: TInterpreterContext): void => {
    statements.forEach(statement => {
        switch (statement.t) {
            case 'if': {
                const match = statement.branches.find(branch => Boolean(evaluate(branch.cond, ctx)));
                execute(match ? match.body : statement.otherwise, ctx);
                break;
            }
            case 'set':
                ctx.vars.set(statement.name, evaluate(statement.value, ctx));
                break;
            case 'notify':
                ctx.notify(statement.level, statement.message);
                break;
            case 'purchase':
                ctx.purchase(statement.contract_type);
                break;
            case 'sell':
                ctx.sell();
                break;
            default:
                ctx.tradeAgain();
        }
    });
};
