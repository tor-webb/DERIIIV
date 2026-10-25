import { localize } from '@deriv-com/translations';

import type { TDataKind, TExpr, TLevel, TNumberProperty, TProcedure, TStmt, TValue } from './types';

export class RuntimeError extends Error {}

/** A bot that runs this many steps in one go is stuck in a loop. */
export const MAX_STEPS = 50_000;
const MAX_CALL_DEPTH = 64;

class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
    value: TValue | null;

    constructor(value: TValue | null) {
        this.value = value;
    }
}

export type TInterpreterContext = {
    vars: Map<string, TValue>;
    procedures?: Record<string, TProcedure>;
    read: (kind: TDataKind) => TValue;
    notify: (level: TLevel, message: string) => void;
    purchase: (contract_type: string) => void;
    sell: () => void;
    tradeAgain: () => void;
    schedule?: (seconds: number, body: TStmt[]) => void;
    /** Asks the person running the bot a question (the "prompt for" block). May throw to stop the bot. */
    prompt?: (message: string, kind: 'NUMBER' | 'TEXT') => TValue;
    /** A "trade options" block ran: the bot says what to trade next. Values are already worked out. */
    setOptions?: (options: {
        duration_unit: string;
        duration: TValue;
        amount: TValue;
        prediction: TValue | null;
    }) => void;
    /** Parameter scopes of the procedures that are currently running; the last one is the innermost. */
    frames?: Map<string, TValue>[];
    /** Steps left before the bot is considered stuck. */
    budget?: { left: number };
};

type TState = TInterpreterContext & Required<Pick<TInterpreterContext, 'frames' | 'budget'>>;

const prepare = (ctx: TInterpreterContext): TState => {
    ctx.frames = ctx.frames ?? [];
    ctx.budget = ctx.budget ?? { left: MAX_STEPS };
    return ctx as TState;
};

const spend = (ctx: TState) => {
    ctx.budget.left -= 1;
    if (ctx.budget.left < 0) {
        throw new RuntimeError(localize('The bot ran for too long without finishing. Check your loops.'));
    }
};

const toNumber = (value: TValue): number => {
    if (value === null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return Number(value);
    const parsed = Number(value);
    if (value.trim() === '' || Number.isNaN(parsed)) {
        throw new RuntimeError(localize('The bot used "{{text}}" where a number was needed.', { text: value }));
    }
    return parsed;
};

const toText = (value: TValue) => String(value);

const checkFinite = (value: number) => {
    if (!Number.isFinite(value))
        throw new RuntimeError(localize('A calculation in the bot produced an invalid number.'));
    return value;
};

const lookup = (ctx: TState, name: string): TValue => {
    for (let index = ctx.frames.length - 1; index >= 0; index -= 1) {
        const frame = ctx.frames[index];
        if (frame.has(name)) return frame.get(name) as TValue;
    }
    // a variable nobody has set reads as 0; one set to null stays null
    return ctx.vars.has(name) ? (ctx.vars.get(name) as TValue) : 0;
};

const assign = (ctx: TState, name: string, value: TValue) => {
    for (let index = ctx.frames.length - 1; index >= 0; index -= 1) {
        if (ctx.frames[index].has(name)) {
            ctx.frames[index].set(name, value);
            return;
        }
    }
    ctx.vars.set(name, value);
};

const isNumeric = (value: TValue) => typeof value !== 'string' && value !== null;

const isPrime = (n: number) => {
    if (n === 2 || n === 3) return true;
    if (n <= 1 || n % 1 !== 0 || n % 2 === 0 || n % 3 === 0) return false;
    for (let divisor = 5; divisor <= Math.sqrt(n); divisor += 6) {
        if (n % divisor === 0 || n % (divisor + 2) === 0) return false;
    }
    return true;
};

/** The same tests Blockly's "is even / odd / prime / whole / positive / negative / divisible by" block makes. */
const hasProperty = (prop: TNumberProperty, n: number, divisor: number): boolean => {
    switch (prop) {
        case 'EVEN':
            return n % 2 === 0;
        case 'ODD':
            return n % 2 === 1;
        case 'PRIME':
            return isPrime(n);
        case 'WHOLE':
            return n % 1 === 0;
        case 'POSITIVE':
            return n > 0;
        case 'NEGATIVE':
            return n < 0;
        default:
            return divisor !== 0 && n % divisor === 0;
    }
};

const callProcedure = (ctx: TState, name: string, args: TExpr[]): TValue | null => {
    const procedure = ctx.procedures?.[name];
    if (!procedure) {
        throw new RuntimeError(localize('The bot called the function "{{name}}", which does not exist.', { name }));
    }
    if (ctx.frames.length >= MAX_CALL_DEPTH) {
        throw new RuntimeError(localize('The function "{{name}}" calls itself too many times.', { name }));
    }
    spend(ctx);
    // arguments are evaluated by the caller, before the new scope exists
    const frame = new Map<string, TValue>(
        procedure.params.map((param, index) => [param, args[index] ? evaluateState(args[index], ctx) : 0])
    );
    ctx.frames.push(frame);
    try {
        executeState(procedure.body, ctx);
        return procedure.returns ? evaluateState(procedure.returns, ctx) : null;
    } catch (signal) {
        if (signal instanceof ReturnSignal) return signal.value;
        throw signal;
    } finally {
        ctx.frames.pop();
    }
};

const evaluateState = (expr: TExpr, ctx: TState): TValue => {
    switch (expr.t) {
        case 'num':
        case 'bool':
        case 'str':
            return expr.v;
        case 'null':
            return null;
        case 'var':
            return lookup(ctx, expr.name);
        case 'data':
            return ctx.read(expr.kind);
        case 'not':
            return !evaluateState(expr.a, ctx);
        case 'logic': {
            const left = Boolean(evaluateState(expr.a, ctx));
            // short-circuit, like the logic blocks suggest
            if (expr.op === 'AND') return left && Boolean(evaluateState(expr.b, ctx));
            return left || Boolean(evaluateState(expr.b, ctx));
        }
        case 'cmp': {
            const a = evaluateState(expr.a, ctx);
            const b = evaluateState(expr.b, ctx);
            if (expr.op === 'EQ' || expr.op === 'NEQ') {
                let equal: boolean;
                if (a === null || b === null) equal = a === b;
                else equal = isNumeric(a) && isNumeric(b) ? Number(a) === Number(b) : toText(a) === toText(b);
                return expr.op === 'EQ' ? equal : !equal;
            }
            const x = toNumber(a);
            const y = toNumber(b);
            switch (expr.op) {
                case 'LT':
                    return x < y;
                case 'LTE':
                    return x <= y;
                case 'GT':
                    return x > y;
                default:
                    return x >= y;
            }
        }
        case 'arith': {
            const a = toNumber(evaluateState(expr.a, ctx));
            const b = toNumber(evaluateState(expr.b, ctx));
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
        case 'mod': {
            const a = toNumber(evaluateState(expr.a, ctx));
            const b = toNumber(evaluateState(expr.b, ctx));
            if (b === 0) throw new RuntimeError(localize('The bot tried to divide by zero.'));
            return a % b;
        }
        case 'numprop': {
            const a = toNumber(evaluateState(expr.a, ctx));
            const divisor = expr.divisor ? toNumber(evaluateState(expr.divisor, ctx)) : 0;
            return hasProperty(expr.prop, a, divisor);
        }
        case 'prompt': {
            if (!ctx.prompt) {
                throw new RuntimeError(localize('This bot asks a question, which cannot be answered here.'));
            }
            return ctx.prompt(toText(evaluateState(expr.message, ctx)), expr.kind);
        }
        case 'round': {
            const a = toNumber(evaluateState(expr.a, ctx));
            if (expr.op === 'ROUNDUP') return Math.ceil(a);
            if (expr.op === 'ROUNDDOWN') return Math.floor(a);
            return Math.round(a);
        }
        case 'single': {
            const a = toNumber(evaluateState(expr.a, ctx));
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
            const from = Math.ceil(toNumber(evaluateState(expr.from, ctx)));
            const to = Math.floor(toNumber(evaluateState(expr.to, ctx)));
            const [low, high] = from <= to ? [from, to] : [to, from];
            return low + Math.floor(Math.random() * (high - low + 1));
        }
        case 'join':
            return expr.parts.map(part => toText(evaluateState(part, ctx))).join('');
        case 'call':
            return callProcedure(ctx, expr.name, expr.args) ?? 0;
        default:
            throw new RuntimeError(localize('Unknown expression.'));
    }
};

const runBody = (body: TStmt[], ctx: TState): 'break' | 'continue' | null => {
    try {
        executeState(body, ctx);
    } catch (signal) {
        if (signal instanceof BreakSignal) return 'break';
        if (signal instanceof ContinueSignal) return 'continue';
        throw signal;
    }
    return null;
};

const executeState = (statements: TStmt[], ctx: TState): void => {
    statements.forEach(statement => {
        spend(ctx);
        switch (statement.t) {
            case 'if': {
                const match = statement.branches.find(branch => Boolean(evaluateState(branch.cond, ctx)));
                executeState(match ? match.body : statement.otherwise, ctx);
                break;
            }
            case 'set':
                assign(ctx, statement.name, evaluateState(statement.value, ctx));
                break;
            case 'notify':
                ctx.notify(statement.level, toText(evaluateState(statement.message, ctx)));
                break;
            case 'set_options':
                ctx.setOptions?.({
                    duration_unit: statement.duration_unit,
                    duration: evaluateState(statement.duration, ctx),
                    amount: evaluateState(statement.amount, ctx),
                    prediction: statement.prediction ? evaluateState(statement.prediction, ctx) : null,
                });
                break;
            case 'purchase':
                ctx.purchase(statement.contract_type);
                break;
            case 'sell':
                ctx.sell();
                break;
            case 'trade_again':
                ctx.tradeAgain();
                break;
            case 'repeat': {
                const times = Math.floor(toNumber(evaluateState(statement.times, ctx)));
                for (let count = 0; count < times; count += 1) {
                    spend(ctx);
                    if (runBody(statement.body, ctx) === 'break') break;
                }
                break;
            }
            case 'while':
                while (Boolean(evaluateState(statement.cond, ctx)) !== statement.until) {
                    spend(ctx);
                    if (runBody(statement.body, ctx) === 'break') break;
                }
                break;
            case 'flow':
                throw statement.kind === 'BREAK' ? new BreakSignal() : new ContinueSignal();
            case 'timeout': {
                const seconds = toNumber(evaluateState(statement.seconds, ctx));
                if (!ctx.schedule) {
                    throw new RuntimeError(localize('Timeouts are not available here.'));
                }
                ctx.schedule(Math.max(0, seconds), statement.body);
                break;
            }
            case 'call':
                callProcedure(ctx, statement.name, statement.args);
                break;
            default: {
                if (statement.cond && !evaluateState(statement.cond, ctx)) break;
                throw new ReturnSignal(statement.value ? evaluateState(statement.value, ctx) : null);
            }
        }
    });
};

export const evaluate = (expr: TExpr, ctx: TInterpreterContext): TValue => evaluateState(expr, prepare(ctx));

/** Runs a stack of statements. Throws RuntimeError when the bot does something invalid or runs too long. */
export const execute = (statements: TStmt[], ctx: TInterpreterContext): void => {
    const state = prepare(ctx);
    try {
        executeState(statements, state);
    } catch (signal) {
        if (signal instanceof BreakSignal || signal instanceof ContinueSignal) {
            throw new RuntimeError(localize('"Break out" and "continue" only work inside a loop.'));
        }
        // a return outside a function simply ends the stack
        if (!(signal instanceof ReturnSignal)) throw signal;
    }
};
