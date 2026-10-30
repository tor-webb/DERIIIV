import * as Blockly from 'blockly';

import { ALLOWED_BLOCK_TYPES, BLOCK_TYPES, registerBlocks } from '../blocks';
import { getDefaultWorkspaceState, loadWorkspaceState, parseBotFile } from '../bot-utils';
import { compileProgram } from '../Engine/compile';
import { evaluate, MAX_INDICATOR_PERIOD, TInterpreterContext } from '../Engine/interpreter';
import { applyTickToCandles, BotRunner, mergeCandles, mergeTicks } from '../Engine/runner';
import type {
    TApiResponse,
    TBotApi,
    TCandle,
    THistoryRequest,
    TLevel,
    TProgram,
    TSeriesSource,
    TStmt,
    TWatchdogOptions,
} from '../Engine/types';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const num = (value: number) => ({ shadow: { type: 'math_number', fields: { NUM: value } } });
const ticks = { block: { type: BLOCK_TYPES.TICKS } };
const candles = (field: string) => ({ block: { type: BLOCK_TYPES.OHLC_VALUES, fields: { OHLCFIELD_LIST: field } } });

/** The starter bot with `block` as the only purchase condition. */
const botWith = (block: Record<string, unknown>) => {
    const state = getDefaultWorkspaceState();
    const blocks = state.blocks.blocks as Record<string, unknown>[];
    const index = blocks.findIndex(item => item.id === 'before_purchase');
    blocks[index] = {
        id: 'before_purchase',
        type: BLOCK_TYPES.BEFORE_PURCHASE,
        x: 0,
        y: 0,
        inputs: { BEFOREPURCHASE_STACK: { block } },
    };
    return state;
};

/** A "print" block holding `value`, which compiles to a notify statement whose message is the compiled value. */
const printing = (value: Record<string, unknown>) => ({
    type: 'text_print',
    inputs: { TEXT: { block: value } },
});

const compileWith = (block: Record<string, unknown>, variables: unknown[] = []): TProgram => {
    const workspace = new Blockly.Workspace();
    loadWorkspaceState(workspace, { ...botWith(block), variables } as Record<string, unknown>);
    try {
        return compileProgram(workspace);
    } finally {
        workspace.dispose();
    }
};

const compiledValue = (value: Record<string, unknown>, variables: unknown[] = []) => {
    const statement = compileWith(printing(value), variables).before_purchase[0];
    if (statement.t !== 'notify') throw new Error('expected a notify statement');
    return statement.message;
};

describe('indicator and candle blocks: compiling', () => {
    beforeAll(() => registerBlocks());

    it('compiles SMA, EMA and RSI of a ticks list, with the period', () => {
        (['sma', 'ema', 'rsi'] as const).forEach(type => {
            expect(compiledValue({ type, inputs: { INPUT_LIST: ticks, PERIOD: num(7) } })).toEqual({
                t: 'indicator',
                ind: type,
                source: { kind: 'ticks' },
                period: { t: 'num', v: 7 },
            });
        });
    });

    it('reads the candle price named in a candles list block', () => {
        expect(compiledValue({ type: 'sma', inputs: { INPUT_LIST: candles('high'), PERIOD: num(5) } })).toMatchObject({
            source: { kind: 'candles', field: 'high' },
        });
        expect(compiledValue({ type: 'rsi', inputs: { INPUT_LIST: candles('close'), PERIOD: num(5) } })).toMatchObject({
            source: { kind: 'candles', field: 'close' },
        });
    });

    it('compiles a Bollinger band with its multipliers', () => {
        expect(
            compiledValue({
                type: 'bb',
                fields: { BBRESULT_LIST: 'lower' },
                inputs: { INPUT_LIST: ticks, PERIOD: num(20), UPMULTIPLIER: num(2), DOWNMULTIPLIER: num(3) },
            })
        ).toEqual({
            t: 'indicator',
            ind: 'bb',
            source: { kind: 'ticks' },
            period: { t: 'num', v: 20 },
            band: 'lower',
            up: { t: 'num', v: 2 },
            down: { t: 'num', v: 3 },
        });
    });

    it('fills in the usual periods when none is plugged in', () => {
        const period = (type: string) =>
            (compiledValue({ type, inputs: { INPUT_LIST: ticks } }) as { period: unknown }).period;
        expect(period('sma')).toEqual({ t: 'num', v: 10 });
        expect(period('ema')).toEqual({ t: 'num', v: 10 });
        expect(period('rsi')).toEqual({ t: 'num', v: 14 });
        expect(period('bb')).toEqual({ t: 'num', v: 20 });
    });

    it('compiles "read candle value" and "last tick direction"', () => {
        expect(
            compiledValue({ type: 'read_ohlc', fields: { OHLCFIELD_LIST: 'open' }, inputs: { CANDLEINDEX: num(2) } })
        ).toEqual({ t: 'candle', field: 'open', index: { t: 'num', v: 2 } });
        expect(compiledValue({ type: 'read_ohlc', fields: { OHLCFIELD_LIST: 'low' } })).toEqual({
            t: 'candle',
            field: 'low',
            index: { t: 'num', v: 1 },
        });
        expect(compiledValue({ type: 'check_direction', fields: { CHECK_DIRECTION: 'fall' } })).toEqual({
            t: 'direction',
            dir: 'fall',
        });
    });

    it('refuses an indicator whose list is not a ticks or candles block, and says why', () => {
        const attempt = () =>
            compiledValue(
                {
                    type: 'sma',
                    inputs: {
                        INPUT_LIST: { block: { type: 'variables_get', fields: { VAR: { id: 'v1' } } } },
                        PERIOD: num(3),
                    },
                },
                [{ name: 'prices', id: 'v1' }]
            );
        expect(attempt).toThrow(/Ticks list or a Candles list block plugged straight into it/);
        expect(attempt).toThrow(/variable is not supported yet/);
    });

    it('refuses an indicator with nothing plugged into its list', () => {
        expect(() => compiledValue({ type: 'ema', inputs: { PERIOD: num(3) } })).toThrow(/missing its "INPUT_LIST"/);
    });

    it('refuses a candle price that is not open, high, low or close', () => {
        expect(() =>
            compiledValue({ type: 'read_ohlc', fields: { OHLCFIELD_LIST: 'close' }, inputs: {} })
        ).not.toThrow();
        const workspace = new Blockly.Workspace();
        loadWorkspaceState(workspace, botWith(printing({ type: 'read_ohlc' })) as Record<string, unknown>);
        const block = workspace.getAllBlocks(false).find(item => item.type === 'read_ohlc');
        block?.setFieldValue('open', 'OHLCFIELD_LIST');
        // a value Blockly itself would not accept is checked by the compiler too
        jest.spyOn(block as Blockly.Block, 'getFieldValue').mockImplementation(() => 'epoch');
        expect(() => compileProgram(workspace)).toThrow(/"epoch", which is not supported in a bot yet/);
        workspace.dispose();
    });

    it('explains that a bare list of prices cannot be used on its own', () => {
        expect(() => compiledValue({ type: 'ticks' })).toThrow(/is a list of prices. Plug it into an indicator/);
        expect(() => compiledValue({ type: 'ohlc_values', fields: { OHLCFIELD_LIST: 'close' } })).toThrow(
            /is a list of prices/
        );
    });

    describe('which histories the bot reads', () => {
        const series = (value: Record<string, unknown>) => compileWith(printing(value)).series;

        it('flags nothing for a bot that reads no prices', () => {
            expect(compileWith({ type: BLOCK_TYPES.PURCHASE, fields: { PURCHASE_LIST: 'CALL' } }).series).toEqual({
                ticks: false,
                candles: false,
            });
        });

        it('flags ticks for a ticks list and for the direction check', () => {
            expect(series({ type: 'sma', inputs: { INPUT_LIST: ticks, PERIOD: num(3) } })).toEqual({
                ticks: true,
                candles: false,
            });
            expect(series({ type: 'check_direction', fields: { CHECK_DIRECTION: 'rise' } })).toEqual({
                ticks: true,
                candles: false,
            });
        });

        it('flags candles for a candles list and for reading a candle', () => {
            expect(series({ type: 'sma', inputs: { INPUT_LIST: candles('close'), PERIOD: num(3) } })).toEqual({
                ticks: false,
                candles: true,
            });
            expect(series({ type: 'read_ohlc', fields: { OHLCFIELD_LIST: 'close' }, inputs: {} })).toEqual({
                ticks: false,
                candles: true,
            });
        });

        it('does not count a disabled block', () => {
            const program = compileWith({
                ...printing({ type: 'check_direction', fields: { CHECK_DIRECTION: 'rise' } }),
                enabled: false,
            });
            expect(program.series).toEqual({ ticks: false, candles: false });
        });
    });
});

describe('indicator and candle blocks: importing', () => {
    const file = (inner: string) =>
        `<xml is_dbot="true"><block type="before_purchase"><statement name="BEFOREPURCHASE_STACK">${inner}</statement></block></xml>`;
    const printed = (value: string) => `<block type="text_print"><value name="TEXT">${value}</value></block>`;

    it('lists every new block in the import allow-list', () => {
        ['ticks', 'ohlc_values', 'read_ohlc', 'sma', 'ema', 'rsi', 'bb', 'check_direction'].forEach(type =>
            expect(ALLOWED_BLOCK_TYPES.has(type)).toBe(true)
        );
    });

    it('accepts a bot file that uses them', () => {
        const xml = file(
            printed(
                '<block type="sma"><value name="INPUT_LIST"><block type="ticks"></block></value><value name="PERIOD"><block type="math_number"><field name="NUM">5</field></block></value></block>'
            )
        );
        expect(parseBotFile(xml)).toMatchObject({ ok: true, kind: 'xml' });
        expect(
            parseBotFile(
                file(printed('<block type="check_direction"><field name="CHECK_DIRECTION">rise</field></block>'))
            )
        ).toMatchObject({
            ok: true,
        });
    });

    it('still refuses indicators that are not supported, and names them', () => {
        const result = parseBotFile(file(printed('<block type="macda"></block>')));
        expect(result).toMatchObject({ ok: false });
        expect(JSON.stringify(result)).toContain('macda');
    });
});

describe('indicator and candle blocks: interpreter', () => {
    const PRICES = [2, 4, 4, 4, 5, 5, 7, 9];
    const makeContext = (prices: number[] | ((source: TSeriesSource) => number[]) = PRICES) =>
        ({
            vars: new Map(),
            read: () => 0,
            series: typeof prices === 'function' ? prices : () => prices,
            notify: jest.fn(),
            purchase: jest.fn(),
            sell: jest.fn(),
            tradeAgain: jest.fn(),
        }) as TInterpreterContext;
    const n = (v: number) => ({ t: 'num', v }) as const;
    const ticksSource = { kind: 'ticks' } as const;

    it('works out SMA, EMA, RSI and Bollinger bands from the prices', () => {
        const ctx = makeContext();
        expect(evaluate({ t: 'indicator', ind: 'sma', source: ticksSource, period: n(4) }, ctx)).toBe(6.5);
        expect(evaluate({ t: 'indicator', ind: 'ema', source: ticksSource, period: n(8) }, ctx)).toBe(5);
        expect(
            evaluate({ t: 'indicator', ind: 'rsi', source: ticksSource, period: n(3) }, makeContext([1, 2, 3, 4]))
        ).toBe(100);
        const band = (name: 'upper' | 'middle' | 'lower') =>
            evaluate(
                { t: 'indicator', ind: 'bb', source: ticksSource, period: n(8), band: name, up: n(2), down: n(2) },
                ctx
            );
        expect([band('lower'), band('middle'), band('upper')]).toEqual([1, 5, 9]);
    });

    it('defaults a Bollinger band to the middle with 2 deviations', () => {
        expect(evaluate({ t: 'indicator', ind: 'bb', source: ticksSource, period: n(8) }, makeContext())).toBe(5);
    });

    it('asks for the prices the source names', () => {
        const series = jest.fn(() => PRICES);
        const ctx = makeContext(series);
        evaluate({ t: 'indicator', ind: 'sma', source: { kind: 'candles', field: 'high' }, period: n(2) }, ctx);
        expect(series).toHaveBeenCalledWith({ kind: 'candles', field: 'high' });
    });

    it('takes the whole number part of the period', () => {
        expect(evaluate({ t: 'indicator', ind: 'sma', source: ticksSource, period: n(2.9) }, makeContext())).toBe(8);
    });

    it('refuses a period that is below 1, too large, or not a number', () => {
        const ctx = makeContext();
        const run = (period: Parameters<typeof evaluate>[0]) =>
            evaluate({ t: 'indicator', ind: 'sma', source: ticksSource, period }, ctx);
        expect(() => run(n(0))).toThrow(`The SMA period must be a whole number from 1 to ${MAX_INDICATOR_PERIOD}.`);
        expect(() => run(n(0.5))).toThrow(/period must be a whole number/);
        expect(() => run(n(MAX_INDICATOR_PERIOD + 1))).toThrow(/period must be a whole number/);
        expect(() => run({ t: 'str', v: 'many' })).toThrow(/where a number was needed/);
        expect(() => run(n(MAX_INDICATOR_PERIOD))).toThrow(/Not enough price history/);
    });

    it('says exactly how much history is missing instead of guessing', () => {
        expect(() =>
            evaluate({ t: 'indicator', ind: 'ema', source: ticksSource, period: n(20) }, makeContext([1, 2, 3]))
        ).toThrow(
            'Not enough price history for the EMA with a period of 20: it needs 20 prices and only 3 are available. Use a shorter period.'
        );
        expect(() =>
            evaluate({ t: 'indicator', ind: 'rsi', source: ticksSource, period: n(14) }, makeContext([1, 2, 3]))
        ).toThrow(/RSI with a period of 14: it needs 15 prices and only 3 are available/);
    });

    it('stops with a clear message when the bot has no prices to read', () => {
        const ctx = { ...makeContext(), series: undefined } as TInterpreterContext;
        expect(() => evaluate({ t: 'indicator', ind: 'sma', source: ticksSource, period: n(2) }, ctx)).toThrow(
            'This bot reads prices, which are not available here.'
        );
    });

    it('reads a candle price counting back from the newest', () => {
        const ctx = makeContext([10, 20, 30]);
        expect(evaluate({ t: 'candle', field: 'close', index: n(1) }, ctx)).toBe(30);
        expect(evaluate({ t: 'candle', field: 'close', index: n(3) }, ctx)).toBe(10);
        expect(() => evaluate({ t: 'candle', field: 'close', index: n(0) }, ctx)).toThrow(
            'The bot asked for candle number 0 from the end, but only 3 are available.'
        );
        expect(() => evaluate({ t: 'candle', field: 'close', index: n(4) }, ctx)).toThrow(/candle number 4/);
    });

    it('checks the direction of the newest tick', () => {
        const rising = makeContext([1, 2]);
        expect(evaluate({ t: 'direction', dir: 'rise' }, rising)).toBe(true);
        expect(evaluate({ t: 'direction', dir: 'fall' }, rising)).toBe(false);
        expect(evaluate({ t: 'direction', dir: 'no_change' }, makeContext([3, 3]))).toBe(true);
        // with fewer than two ticks nothing has moved yet, so no direction is true
        expect(evaluate({ t: 'direction', dir: 'no_change' }, makeContext([3]))).toBe(false);
        expect(evaluate({ t: 'direction', dir: 'rise' }, makeContext([]))).toBe(false);
    });
});

describe('merging prices', () => {
    const point = (epoch: number, quote: number) => ({ epoch, quote });
    const candle = (epoch: number, open: number, high: number, low: number, close: number): TCandle => ({
        epoch,
        open,
        high,
        low,
        close,
    });

    it('puts earlier ticks first and never repeats a tick', () => {
        const merged = mergeTicks([point(1, 10), point(2, 11), point(3, 12)], [point(3, 99), point(4, 13)]);
        expect(merged).toEqual([point(1, 10), point(2, 11), point(3, 99), point(4, 13)]);
    });

    it('keeps all history when nothing live has arrived, and only the newest 1,000', () => {
        expect(mergeTicks([point(1, 1)], [])).toEqual([point(1, 1)]);
        const history = Array.from({ length: 1200 }, (_unused, index) => point(index, index));
        const merged = mergeTicks(history, []);
        expect(merged).toHaveLength(1000);
        expect(merged[merged.length - 1]).toEqual(point(1199, 1199));
    });

    it('takes the open from the server and the close from the live ticks for the same candle', () => {
        const merged = mergeCandles([candle(0, 1, 5, 1, 4), candle(60, 4, 6, 3, 5)], [candle(60, 5, 8, 2, 7)]);
        expect(merged).toEqual([candle(0, 1, 5, 1, 4), candle(60, 4, 8, 2, 7)]);
    });

    it('adds live candles the server did not have, in order', () => {
        const merged = mergeCandles([candle(60, 1, 1, 1, 1)], [candle(120, 2, 2, 2, 2)]);
        expect(merged.map(item => item.epoch)).toEqual([60, 120]);
    });

    it('folds ticks into candles of the chosen size', () => {
        let list: TCandle[] = [];
        list = applyTickToCandles(list, 10, 125, 60);
        expect(list).toEqual([candle(120, 10, 10, 10, 10)]);
        list = applyTickToCandles(list, 12, 130, 60);
        list = applyTickToCandles(list, 9, 150, 60);
        expect(list).toEqual([candle(120, 10, 12, 9, 9)]);
        list = applyTickToCandles(list, 11, 180, 60);
        expect(list).toEqual([candle(120, 10, 12, 9, 9), candle(180, 11, 11, 11, 11)]);
    });

    it('uses the interval of the Candle interval block, such as 5 minutes', () => {
        const list = applyTickToCandles([], 1, 700, 300);
        expect(list[0].epoch).toBe(600);
    });
});

/* ----------------------------------------------------------------------------------------------- */
/* The runner                                                                                        */
/* ----------------------------------------------------------------------------------------------- */

type TFakeApi = TBotApi & {
    emitTick: (quote: number, epoch?: number) => void;
    resolveHistory: (ticks: TApiResponse | null, candles?: TApiResponse | null) => void;
    calls: { history: THistoryRequest[]; proposal: number };
};

/** A socket whose history answers when the test says so. */
const createApi = (
    options: { withHistory?: boolean; throwOnHistory?: Error; rejectHistory?: Error } = {}
): TFakeApi => {
    const { withHistory = true } = options;
    let tick: (response: TApiResponse) => void = () => undefined;
    const waiting: { ticks?: (value: TApiResponse | null) => void; candles?: (value: TApiResponse | null) => void } =
        {};
    const calls = { history: [] as THistoryRequest[], proposal: 0 };
    const api: TFakeApi = {
        subscribeTicks: (_symbol, cb) => {
            tick = cb;
            return { unsubscribe: jest.fn() };
        },
        subscribeProposal: (_request, cb) => {
            calls.proposal += 1;
            Promise.resolve().then(() => cb({ proposal: { id: 'p', ask_price: 1 } }));
            return { unsubscribe: jest.fn() };
        },
        buy: () => new Promise(() => undefined),
        subscribeOpenContract: () => ({ unsubscribe: jest.fn() }),
        sell: () => Promise.resolve({}),
        emitTick: (quote, epoch) => tick({ tick: { quote, pip_size: 2, ...(epoch === undefined ? {} : { epoch }) } }),
        resolveHistory: (ticks, candlesResponse = null) => {
            waiting.ticks?.(ticks);
            waiting.candles?.(candlesResponse);
        },
        calls,
    };
    if (withHistory) {
        api.getHistory = request => {
            calls.history.push(request);
            if (options.throwOnHistory) throw options.throwOnHistory;
            if (options.rejectHistory) return Promise.reject(options.rejectHistory);
            return new Promise<TApiResponse>(resolve => {
                waiting[request.style] = value => resolve(value as TApiResponse);
            });
        };
    }
    return api;
};

const flush = () =>
    new Promise(resolve => {
        setTimeout(resolve, 0);
    });

const n = (v: number) => ({ t: 'num', v }) as const;
const sma3 = { t: 'indicator', ind: 'sma', source: { kind: 'ticks' }, period: n(3) } as const;

const programWith = (before_purchase: TStmt[], overrides: Partial<TProgram> = {}): TProgram => ({
    setup: {
        symbol: '1HZ100V',
        trade_type: 'risefall',
        contract_type: 'both',
        candle_interval: 60,
        restart_buy_sell: false,
        restart_on_error: false,
    },
    options: { duration_unit: 't', duration: n(5), amount: n(1), prediction: null },
    init: [],
    before_purchase,
    during_purchase: [],
    after_purchase: [{ t: 'trade_again' }],
    procedures: {},
    series: { ticks: true, candles: false },
    ...overrides,
});

const start = (program: TProgram, api: TFakeApi, watchdog?: TWatchdogOptions) => {
    const logs: [TLevel, string][] = [];
    const runner = new BotRunner({
        api,
        program,
        currency: 'USD',
        getBalance: () => 100,
        watchdog,
        onLog: (level, message) => logs.push([level, message]),
        onStats: jest.fn(),
        onStatus: jest.fn(),
        onTransaction: jest.fn(),
        onLiveContract: jest.fn(),
    });
    runner.start();
    return { logs, runner };
};

const history = (prices: number[], first_epoch = 1) => ({
    history: { prices, times: prices.map((_unused, index) => first_epoch + index) },
});

const printSma: TStmt[] = [{ t: 'notify', level: 'info', message: sma3 }];
const buyWhenAbove = (limit: number): TStmt[] => [
    {
        t: 'if',
        branches: [
            { cond: { t: 'cmp', op: 'GT', a: sma3, b: n(limit) }, body: [{ t: 'purchase', contract_type: 'CALL' }] },
        ],
        otherwise: [],
    },
];

describe('BotRunner with indicators', () => {
    it('asks for the recent ticks of its market when it starts', () => {
        const api = createApi();
        start(programWith(printSma), api);
        expect(api.calls.history).toEqual([{ symbol: '1HZ100V', style: 'ticks', count: 1000 }]);
    });

    it('asks for candles of the size set in the Candle interval block', () => {
        const api = createApi();
        const program = programWith(printSma, {
            series: { ticks: false, candles: true },
            setup: { ...programWith([]).setup, candle_interval: 300 },
        });
        start(program, api);
        expect(api.calls.history).toEqual([{ symbol: '1HZ100V', style: 'candles', granularity: 300, count: 500 }]);
    });

    it('asks for nothing when the bot reads no prices, so every existing bot is unchanged', () => {
        const api = createApi();
        start(
            programWith([{ t: 'purchase', contract_type: 'CALL' }], { series: { ticks: false, candles: false } }),
            api
        );
        expect(api.calls.history).toEqual([]);
        const old = createApi();
        start(programWith([{ t: 'purchase', contract_type: 'CALL' }], { series: undefined }), old);
        expect(old.calls.history).toEqual([]);
    });

    it('does not judge purchase conditions until the history has arrived', async () => {
        const api = createApi();
        const { logs } = start(programWith(buyWhenAbove(10)), api);
        api.emitTick(50, 100);
        await flush();
        expect(api.calls.proposal).toBe(0);
        expect(logs.filter(([level]) => level === 'error')).toEqual([]);

        api.resolveHistory(history([20, 21, 22, 23, 24]));
        await flush();
        api.emitTick(25, 101);
        await flush();
        expect(api.calls.proposal).toBe(1);
    });

    it('has the average ready on the very first tick after the history arrives', async () => {
        const api = createApi();
        const { logs } = start(programWith(printSma), api);
        api.resolveHistory(history([10, 20, 30, 40, 50]));
        await flush();
        api.emitTick(60, 6);
        expect(logs.some(([, message]) => message === '50')).toBe(true);
    });

    it('keeps a tick that arrived while the history was loading, without repeating it', async () => {
        const api = createApi();
        const { logs } = start(programWith(printSma), api);
        api.emitTick(100, 5);
        api.resolveHistory(history([1, 2, 3, 4, 5]));
        await flush();
        // history epochs 1 to 5 and a live tick at 5: the live one wins, so the newest three are 4 (epoch 4)? no: 1,2,3,4 then 100
        api.emitTick(110, 6);
        // prices are 1, 2, 3, 4, 100, 110: the last three average (4 + 100 + 110) / 3
        expect(logs[logs.length - 1][1]).toBe(String((4 + 100 + 110) / 3));
    });

    it('builds candles from live ticks and reads them back, the newest first', async () => {
        const api = createApi();
        const program = programWith(
            [
                { t: 'notify', level: 'info', message: { t: 'candle', field: 'close', index: n(1) } },
                { t: 'notify', level: 'info', message: { t: 'candle', field: 'open', index: n(1) } },
                { t: 'notify', level: 'info', message: { t: 'candle', field: 'close', index: n(2) } },
            ],
            { series: { ticks: false, candles: true } }
        );
        const { logs } = start(program, api);
        api.resolveHistory(null, {
            candles: [
                { epoch: 0, open: 1, high: 3, low: 1, close: 2 },
                { epoch: 60, open: 2, high: 4, low: 2, close: 3 },
            ],
        });
        await flush();
        // inside the candle that opened at 60: the open stays 2, the close follows the tick
        api.emitTick(3.5, 90);
        expect(logs.slice(-3).map(([, message]) => message)).toEqual(['3.5', '2', '2']);
        // a tick in the next minute starts a new candle
        api.emitTick(9, 125);
        expect(logs.slice(-3).map(([, message]) => message)).toEqual(['9', '9', '3.5']);
    });

    it('stops, and says why, when the server answers with an error', async () => {
        const api = createApi();
        const { logs, runner } = start(programWith(printSma), api);
        api.resolveHistory({ error: { message: 'Market is closed' } });
        await flush();
        expect(logs).toContainEqual(['error', 'Market is closed']);
        expect(runner.getStatus()).toBe('stopped');
    });

    it('stops when the history has no prices in it', async () => {
        const api = createApi();
        const { runner } = start(programWith(printSma), api);
        api.resolveHistory({});
        await flush();
        expect(runner.getStatus()).toBe('stopped');
    });

    it('stops when the history request fails or throws', async () => {
        const failed = createApi({ rejectHistory: new Error('socket closed') });
        const first = start(programWith(printSma), failed);
        await flush();
        expect(first.logs).toContainEqual(['error', 'socket closed']);
        expect(first.runner.getStatus()).toBe('stopped');

        const thrown = createApi({ throwOnHistory: new Error('not connected') });
        const second = start(programWith(printSma), thrown);
        expect(second.logs).toContainEqual(['error', 'not connected']);
        expect(second.runner.getStatus()).toBe('stopped');
    });

    it('stops when the history never arrives', async () => {
        jest.useFakeTimers();
        try {
            const api = createApi();
            const { logs, runner } = start(programWith(printSma), api, { request_timeout_ms: 1000 });
            jest.advanceTimersByTime(999);
            expect(runner.getStatus()).toBe('running');
            jest.advanceTimersByTime(2);
            expect(logs).toContainEqual([
                'error',
                'Recent prices did not arrive in time, so the bot stopped. Try again.',
            ]);
            expect(runner.getStatus()).toBe('stopped');
        } finally {
            jest.useRealTimers();
        }
    });

    it('does not time out once the history has arrived', async () => {
        jest.useFakeTimers();
        try {
            const api = createApi();
            const { runner } = start(programWith(printSma), api, { request_timeout_ms: 1000 });
            api.resolveHistory(history([1, 2, 3]));
            await Promise.resolve();
            await Promise.resolve();
            jest.advanceTimersByTime(5000);
            expect(runner.getStatus()).toBe('running');
        } finally {
            jest.useRealTimers();
        }
    });

    it('ignores a late answer after the bot was stopped', async () => {
        const api = createApi();
        const { logs, runner } = start(programWith(printSma), api);
        runner.stop();
        const before = logs.length;
        api.resolveHistory({ error: { message: 'too late' } });
        await flush();
        expect(logs.slice(before).filter(([level]) => level === 'error')).toEqual([]);
        expect(runner.getStatus()).toBe('stopped');
    });

    it('stops with the missing-history message when the period is longer than the history', async () => {
        const api = createApi();
        const { logs, runner } = start(programWith(printSma), api);
        api.resolveHistory(history([1, 2]));
        await flush();
        api.emitTick(3, 3);
        // 3 prices now exist, enough for a period of 3, so raise the bar: ask for 20
        expect(runner.getStatus()).toBe('running');
        const long = createApi();
        const second = start(programWith([{ t: 'notify', level: 'info', message: { ...sma3, period: n(20) } }]), long);
        long.resolveHistory(history([1, 2]));
        await flush();
        long.emitTick(3, 3);
        expect(
            second.logs.some(
                ([level, message]) => level === 'error' && /Not enough price history for the SMA/.test(message)
            )
        ).toBe(true);
        expect(second.runner.getStatus()).toBe('stopped');
        expect(logs.some(([level]) => level === 'error')).toBe(false);
    });

    it('still runs on live ticks alone when the socket offers no history (direction needs only two ticks)', async () => {
        const api = createApi({ withHistory: false });
        const program = programWith(
            [
                {
                    t: 'if',
                    branches: [
                        { cond: { t: 'direction', dir: 'rise' }, body: [{ t: 'purchase', contract_type: 'CALL' }] },
                    ],
                    otherwise: [],
                },
            ],
            { series: { ticks: true, candles: false } }
        );
        start(program, api);
        api.emitTick(1, 1);
        await flush();
        expect(api.calls.proposal).toBe(0);
        api.emitTick(2, 2);
        await flush();
        expect(api.calls.proposal).toBe(1);
    });

    it('buys when the average says so, and not before', async () => {
        const api = createApi();
        start(programWith(buyWhenAbove(40)), api);
        api.resolveHistory(history([10, 20, 30]));
        await flush();
        api.emitTick(40, 4); // average of 20, 30, 40 is 30
        await flush();
        expect(api.calls.proposal).toBe(0);
        api.emitTick(90, 5); // average of 30, 40, 90 is about 53
        await flush();
        expect(api.calls.proposal).toBe(1);
    });
});

describe('Engine/ws-adapter getHistory', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createWsBotApi } = require('../Engine/ws-adapter');

    it('asks the platform socket for ticks, or for candles with a size', () => {
        const getTicksHistory = jest.fn().mockResolvedValue({});
        const api = createWsBotApi({ getTicksHistory });
        api.getHistory({ symbol: 'R_50', style: 'ticks', count: 1000 });
        api.getHistory({ symbol: 'R_50', style: 'candles', granularity: 300, count: 500 });
        expect(getTicksHistory).toHaveBeenNthCalledWith(1, {
            ticks_history: 'R_50',
            adjust_start_time: 1,
            count: 1000,
            end: 'latest',
            style: 'ticks',
        });
        expect(getTicksHistory).toHaveBeenNthCalledWith(2, {
            ticks_history: 'R_50',
            adjust_start_time: 1,
            count: 500,
            end: 'latest',
            style: 'candles',
            granularity: 300,
        });
    });
});
