import * as Blockly from 'blockly';

import { registerBlocks } from '../blocks';
import { loadParsedBot, parseBotFile, validateBot } from '../bot-utils';
import { compileProgram } from '../Engine/compile';
import { execute, TInterpreterContext } from '../Engine/interpreter';
import { getBotTemplates } from '../templates';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const loadTemplate = (xml: string) => {
    const parsed = parseBotFile(xml);
    if (!parsed.ok) throw new Error(parsed.errors.join(' | '));
    const workspace = new Blockly.Workspace();
    expect(loadParsedBot(workspace, parsed)).toBe(true);
    return workspace;
};

describe('bot templates', () => {
    beforeAll(() => registerBlocks());

    const templates = getBotTemplates();

    it('has a unique id, name and a warning on every template', () => {
        expect(templates.length).toBeGreaterThanOrEqual(4);
        expect(new Set(templates.map(template => template.id)).size).toBe(templates.length);
        templates.forEach(template => {
            expect(template.name).not.toBe('');
            expect(template.description).not.toBe('');
            expect(template.caution).not.toBe('');
            expect(template.facts.length).toBeGreaterThan(0);
        });
    });

    describe.each(getBotTemplates().map(template => [template.id, template] as const))('%s', (_id, template) => {
        it('passes the safe importer', () => {
            expect(parseBotFile(template.xml)).toMatchObject({ ok: true, kind: 'xml' });
        });

        it('loads with every section and has no validation errors', () => {
            const workspace = loadTemplate(template.xml);
            const types = workspace.getTopBlocks(false).map(block => block.type);
            expect(types).toEqual(
                expect.arrayContaining(['trade_definition', 'before_purchase', 'during_purchase', 'after_purchase'])
            );
            expect(validateBot(workspace).filter(issue => issue.level === 'error')).toEqual([]);
        });

        it('compiles to a program that buys and trades again', () => {
            const program = compileProgram(loadTemplate(template.xml));
            expect(program.before_purchase).toEqual([expect.objectContaining({ t: 'purchase' })]);
            expect(JSON.stringify(program.after_purchase)).toContain('trade_again');
        });
    });

    it('sets the market, trade type, duration and prediction each card promises', () => {
        const compiled = Object.fromEntries(
            templates.map(template => [template.id, compileProgram(loadTemplate(template.xml))])
        );
        expect(compiled.rise_fall_basic.setup).toMatchObject({ symbol: '1HZ100V', trade_type: 'risefall' });
        expect(compiled.even_odd_basic.setup).toMatchObject({ symbol: '1HZ100V', trade_type: 'evenodd' });
        expect(compiled.digit_over_2.setup).toMatchObject({ symbol: 'R_100', trade_type: 'overunder' });
        expect(compiled.digit_over_2.options.prediction).toEqual({ t: 'num', v: 2 });
        expect(compiled.rise_fall_basic.options.duration).toEqual({ t: 'num', v: 5 });
        expect(compiled.even_odd_basic.options.duration).toEqual({ t: 'num', v: 1 });
    });

    describe('stake changing bots, run through the interpreter', () => {
        /** Runs the start-up blocks, then the after-purchase blocks once per result, and returns the stake that each trade would use. */
        const stakesAfter = (id: string, results: ('win' | 'loss')[]) => {
            const program = compileProgram(loadTemplate(templates.find(item => item.id === id)!.xml));
            let last_result: 'win' | 'loss' = 'win';
            const trade_again = jest.fn();
            const context: TInterpreterContext = {
                vars: new Map(),
                read: kind =>
                    kind === 'result_win' ? last_result === 'win' : kind === 'result_loss' ? last_result === 'loss' : 0,
                notify: jest.fn(),
                purchase: jest.fn(),
                sell: jest.fn(),
                tradeAgain: trade_again,
            };
            execute(program.init, context);
            const stakes = [Number(context.vars.get('Stake'))];
            results.forEach(result => {
                last_result = result;
                execute(program.after_purchase, context);
                stakes.push(Number(context.vars.get('Stake')));
            });
            expect(trade_again).toHaveBeenCalledTimes(results.length);
            return stakes;
        };

        it('martingale starts at 1, doubles after each loss and resets after a win', () => {
            expect(stakesAfter('martingale_rise_fall', ['loss', 'loss', 'loss', 'win', 'loss'])).toEqual([
                1, 2, 4, 8, 1, 2,
            ]);
        });

        it('martingale goes back to the first stake once the stake passes 16 times it', () => {
            expect(stakesAfter('martingale_rise_fall', ['loss', 'loss', 'loss', 'loss', 'loss', 'loss'])).toEqual([
                1, 2, 4, 8, 16, 1, 2,
            ]);
        });

        it('win ladder adds the first stake after each win and resets after a loss', () => {
            expect(stakesAfter('win_ladder', ['win', 'win', 'win', 'loss', 'win'])).toEqual([1, 2, 3, 4, 1, 2]);
        });

        it('win ladder goes back to the first stake once the stake passes 16 times it', () => {
            const wins = Array.from({ length: 16 }, () => 'win' as const);
            const stakes = stakesAfter('win_ladder', wins);
            expect(Math.max(...stakes)).toBeLessThanOrEqual(16);
            expect(stakes[stakes.length - 1]).toBe(1);
        });
    });
});
