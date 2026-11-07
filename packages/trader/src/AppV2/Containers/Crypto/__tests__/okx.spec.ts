import {
    coinOf,
    fetchTickers,
    formatCoinPrice,
    formatVolume,
    instrumentId,
    okxError,
    parseCandles,
    parseFunding,
    parseTicker,
    parseTickers,
    readCoinWatchlist,
    WATCHLIST_KEY,
    writeCoinWatchlist,
} from '../okx';

const row = (instId: string, extra: Record<string, unknown> = {}) => ({
    instId,
    last: '110',
    open24h: '100',
    high24h: '120',
    low24h: '90',
    volCcy24h: '5000',
    ...extra,
});

describe('instruments', () => {
    it('names spot and perpetual instruments the way OKX does', () => {
        expect(instrumentId('BTC', 'SPOT')).toBe('BTC-USDT');
        expect(instrumentId('BTC', 'SWAP')).toBe('BTC-USDT-SWAP');
        expect(coinOf('ETH-USDT-SWAP')).toBe('ETH');
    });
});

describe('parseTicker', () => {
    it('reads prices and the 24 hour change', () => {
        const ticker = parseTicker(row('BTC-USDT'));
        expect(ticker).toMatchObject({ coin: 'BTC', last: 110, high_24h: 120, low_24h: 90, volume_24h: 5000 });
        expect(ticker?.change_pct).toBeCloseTo(10, 5);
    });

    it('turns swap volume from coins into USDT', () => {
        expect(parseTicker(row('BTC-USDT-SWAP'))?.volume_24h).toBe(550000);
    });

    it('has no change when the open price is missing, and no ticker without a price', () => {
        expect(parseTicker(row('BTC-USDT', { open24h: '' }))?.change_pct).toBeNull();
        expect(parseTicker(row('BTC-USDT', { last: '' }))).toBeNull();
        expect(parseTicker(row('BTC-USDT', { last: '0' }))).toBeNull();
    });
});

describe('parseTickers', () => {
    it('keeps the listed coins of the right kind, in list order', () => {
        const body = { code: '0', data: [row('ETH-USDT'), row('XYZ-USDT'), row('BTC-USDT'), row('BTC-USDT-SWAP')] };
        expect(parseTickers(body, 'SPOT').map(item => item.coin)).toEqual(['BTC', 'ETH']);
        expect(parseTickers(body, 'SWAP').map(item => item.inst_id)).toEqual(['BTC-USDT-SWAP']);
    });

    it('gives nothing for a malformed reply', () => {
        expect(parseTickers(null, 'SPOT')).toEqual([]);
        expect(parseTickers({ data: 'no' }, 'SPOT')).toEqual([]);
    });
});

describe('parseCandles', () => {
    it('puts the oldest candle first and drops broken ones', () => {
        const body = {
            data: [
                ['2000', '2', '3', '1', '2.5'],
                ['1000', '1', '2', '0.5', '1.5'],
                ['3000', 'x', '1', '1', '1'],
            ],
        };
        expect(parseCandles(body)).toEqual([
            { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5 },
            { time: 2000, open: 2, high: 3, low: 1, close: 2.5 },
        ]);
        expect(parseCandles(undefined)).toEqual([]);
    });
});

describe('parseFunding and okxError', () => {
    it('reads the funding rate', () => {
        expect(parseFunding({ data: [{ fundingRate: '0.0001', nextFundingTime: '1700000000000' }] })).toEqual({
            rate: 0.0001,
            next_time: 1700000000000,
        });
        expect(parseFunding({ data: [] })).toBeNull();
        expect(parseFunding({ data: [{ fundingRate: '' }] })).toBeNull();
    });

    it('spots a refused request', () => {
        expect(okxError({ code: '0', data: [] })).toBeNull();
        expect(okxError({ code: '50011', msg: 'Rate limit reached' })).toBe('Rate limit reached');
        expect(okxError(null)).toMatch(/refused/);
    });
});

describe('fetchTickers', () => {
    afterEach(() => jest.restoreAllMocks());

    it('asks OKX for the right instrument type and parses the reply', async () => {
        const fetchMock = jest
            .fn()
            .mockResolvedValue({ ok: true, json: async () => ({ code: '0', data: [row('BTC-USDT')] }) });
        (global as unknown as { fetch: unknown }).fetch = fetchMock;
        const tickers = await fetchTickers('SPOT');
        expect(fetchMock.mock.calls[0][0]).toBe('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
        expect(tickers).toHaveLength(1);
    });

    it('throws on an HTTP error and on a refused request', async () => {
        (global as unknown as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
        await expect(fetchTickers('SPOT')).rejects.toThrow('503');
        (global as unknown as { fetch: unknown }).fetch = jest
            .fn()
            .mockResolvedValue({ ok: true, json: async () => ({ code: '50011', msg: 'Too many requests' }) });
        await expect(fetchTickers('SPOT')).rejects.toThrow('Too many requests');
    });
});

describe('formatting and watchlist', () => {
    beforeEach(() => localStorage.clear());

    it('formats prices and volumes', () => {
        expect(formatCoinPrice(65432.1)).toBe('65,432.10');
        expect(formatCoinPrice(2.5)).toBe('2.5000');
        expect(formatCoinPrice(0.01234)).toBe('0.01234');
        expect(formatCoinPrice(Number.NaN)).toBe('–');
        expect(formatVolume(2.5e9)).toBe('2.50B');
        expect(formatVolume(3.4e6)).toBe('3.4M');
        expect(formatVolume(12000)).toBe('12K');
    });

    it('keeps only listed coins, and survives broken storage', () => {
        writeCoinWatchlist(['BTC', 'ETH']);
        expect(readCoinWatchlist()).toEqual(['BTC', 'ETH']);
        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(['BTC', 'NOPE', 3]));
        expect(readCoinWatchlist()).toEqual(['BTC']);
        localStorage.setItem(WATCHLIST_KEY, '{oops');
        expect(readCoinWatchlist()).toEqual([]);
    });
});
