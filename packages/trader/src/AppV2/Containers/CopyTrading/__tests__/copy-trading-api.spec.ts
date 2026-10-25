import { createCopyApi, getErrorMessage, isCopying, parseLimits, startCopying, stopCopying } from '../copy-trading-api';

const makeApi = (response: unknown = {}) => ({ send: jest.fn().mockResolvedValue(response) });

describe('copy trading api', () => {
    it('starts copying with only the limits that were set', async () => {
        const api = makeApi();
        await startCopying(api, 'TOKEN', { max_trade_stake: 20 });
        expect(api.send).toHaveBeenCalledWith({ copy_start: 'TOKEN', max_trade_stake: 20 });
    });

    it('starts copying with no limits', async () => {
        const api = makeApi();
        await startCopying(api, 'TOKEN');
        expect(api.send).toHaveBeenCalledWith({ copy_start: 'TOKEN' });
    });

    it('stops copying', async () => {
        const api = makeApi();
        await stopCopying(api, 'TOKEN');
        expect(api.send).toHaveBeenCalledWith({ copy_stop: 'TOKEN' });
    });

    it('detects an existing copy of the trader by token', async () => {
        expect(await isCopying(makeApi({ copytrading_list: { traders: [{ token: 'TOKEN' }] } }), 'TOKEN')).toBe(true);
        expect(await isCopying(makeApi({ copytrading_list: { traders: [{ token: 'OTHER' }] } }), 'TOKEN')).toBe(false);
        expect(await isCopying(makeApi({}), 'TOKEN')).toBe(false);
    });

    it('sends requests through the platform websocket', async () => {
        const send = jest.fn().mockResolvedValue({});
        await createCopyApi({ get: () => ({ send }) }).send({ copy_stop: 'T' });
        expect(send).toHaveBeenCalledWith({ copy_stop: 'T' });
    });

    it('reads Deriv error messages', () => {
        expect(getErrorMessage({ error: { message: 'Token is invalid.' } })).toBe('Token is invalid.');
        expect(getErrorMessage(new Error('Socket closed'))).toBe('Socket closed');
        expect(getErrorMessage(undefined)).toMatch(/try again/);
    });

    describe('parseLimits', () => {
        it('accepts empty boxes', () => {
            expect(parseLimits({ min: '', max: '' })).toEqual({ limits: {} });
        });
        it('parses numbers', () => {
            expect(parseLimits({ min: '1', max: '25.5' })).toEqual({
                limits: { min_trade_stake: 1, max_trade_stake: 25.5 },
            });
        });
        it('rejects zero, negative and non-numbers', () => {
            expect(parseLimits({ min: '0', max: '' }).error).toBe('invalid');
            expect(parseLimits({ min: '', max: '-3' }).error).toBe('invalid');
            expect(parseLimits({ min: 'abc', max: '' }).error).toBe('invalid');
        });
        it('rejects a smallest stake above the largest', () => {
            expect(parseLimits({ min: '10', max: '5' }).error).toBe('order');
        });
    });
});
