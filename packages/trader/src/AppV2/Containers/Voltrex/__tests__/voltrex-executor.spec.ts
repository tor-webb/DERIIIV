import type { TApiResponse, TBotApi } from '../../BotBuilder/Engine/types';
import { ContractExecutor, TExecutorEnd } from '../voltrex-executor';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const flush = () =>
    Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => Promise.resolve())
        .then(() => Promise.resolve());

const setup = (options: Partial<ConstructorParameters<typeof ContractExecutor>[0]> = {}) => {
    let proposal_cb: (response: TApiResponse) => void = () => undefined;
    let contract_cb: (response: TApiResponse) => void = () => undefined;
    const unsub = jest.fn();
    const api = {
        subscribeProposal: jest.fn((_request, cb) => {
            proposal_cb = cb;
            return { unsubscribe: unsub };
        }),
        buy: jest.fn(() => Promise.resolve({ buy: { contract_id: 7, buy_price: 1, payout: 1.9 } } as TApiResponse)),
        subscribeOpenContract: jest.fn((_id, cb) => {
            contract_cb = cb;
            return { unsubscribe: unsub };
        }),
        sell: jest.fn(() => Promise.resolve({} as TApiResponse)),
        subscribeTicks: jest.fn(),
    } as unknown as TBotApi;
    const ends: TExecutorEnd[] = [];
    const onBought = jest.fn();
    const onLog = jest.fn();
    const executor = new ContractExecutor({
        api,
        request: { contract_type: 'DIGITEVEN' },
        max_price: 1,
        onBought,
        onEnd: end => ends.push(end),
        onLog,
        ...options,
    });
    return {
        api,
        executor,
        ends,
        onBought,
        onLog,
        proposal: (response: TApiResponse) => proposal_cb(response),
        contract: (response: TApiResponse) => contract_cb(response),
    };
};

const quote = (ask_price = 1) => ({ proposal: { id: 'p1', ask_price } });
const open = (extra: Record<string, unknown> = {}) => ({
    proposal_open_contract: { contract_id: 7, profit: 0, is_valid_to_sell: 1, ...extra },
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('ContractExecutor', () => {
    it('buys at the quoted price and reports the result when the contract is sold', async () => {
        const t = setup();
        t.executor.start();
        t.proposal(quote());
        await flush();
        expect(t.api.buy).toHaveBeenCalledWith('p1', 1);
        expect(t.onBought).toHaveBeenCalledWith({ contract_id: 7, buy_price: 1, payout: 1.9 });
        t.contract(
            open({ is_sold: 1, profit: 0.9, entry_tick_display_value: '1.10', exit_tick_display_value: '1.20' })
        );
        expect(t.ends).toEqual([
            { kind: 'closed', profit: 0.9, entry_spot: '1.10', exit_spot: '1.20', contract_id: 7 },
        ]);
    });

    it('reports a loss as a negative profit', async () => {
        const t = setup();
        t.executor.start();
        t.proposal(quote());
        await flush();
        t.contract(open({ is_sold: 1, profit: -1 }));
        expect(t.ends[0]).toMatchObject({ kind: 'closed', profit: -1 });
    });

    it('fails and buys nothing when the server refuses the proposal', () => {
        const t = setup();
        t.executor.start();
        t.proposal({ error: { message: 'Barrier is invalid' } });
        expect(t.ends).toEqual([{ kind: 'failed', reason: 'Barrier is invalid' }]);
        expect(t.api.buy).not.toHaveBeenCalled();
    });

    it('refuses a price above the cap', () => {
        const t = setup();
        t.executor.start();
        t.proposal(quote(1.5));
        expect(t.ends[0].kind).toBe('failed');
        expect(t.api.buy).not.toHaveBeenCalled();
    });

    it('fails when no price arrives in time', () => {
        const t = setup();
        t.executor.start();
        jest.advanceTimersByTime(21_000);
        expect(t.ends[0]).toMatchObject({ kind: 'failed' });
        expect(t.api.buy).not.toHaveBeenCalled();
    });

    it('fails when the purchase is refused', async () => {
        const t = setup();
        (t.api.buy as jest.Mock).mockResolvedValueOnce({ error: { message: 'Insufficient balance' } });
        t.executor.start();
        t.proposal(quote());
        await flush();
        expect(t.ends).toEqual([{ kind: 'failed', reason: 'Insufficient balance' }]);
    });

    it('can be cancelled before the purchase, but not after', async () => {
        const first = setup();
        first.executor.start();
        expect(first.executor.cancel()).toBe(true);
        expect(first.ends[0].kind).toBe('failed');

        const second = setup();
        second.executor.start();
        second.proposal(quote());
        await flush();
        expect(second.executor.cancel()).toBe(false);
    });

    it('asks again when updates stop, then gives up loudly with the contract id', async () => {
        const t = setup({ contract_stall_ms: 1000, max_resubscribes: 2 });
        t.executor.start();
        t.proposal(quote());
        await flush();
        jest.advanceTimersByTime(1000);
        jest.advanceTimersByTime(1000);
        expect(t.api.subscribeOpenContract).toHaveBeenCalledTimes(3);
        expect(t.ends).toHaveLength(0);
        jest.advanceTimersByTime(1000);
        expect(t.ends[0]).toMatchObject({ kind: 'lost_contact', contract_id: 7 });
    });

    it('sells at market after the longest hold', async () => {
        const t = setup({ max_hold_ms: 5000 });
        t.executor.start();
        t.proposal(quote());
        await flush();
        t.contract(open());
        jest.advanceTimersByTime(5000);
        expect(t.api.sell).toHaveBeenCalledWith(7, 0);
    });

    it('does not sell a contract the server says cannot be sold, and tries again later', async () => {
        const t = setup({ max_hold_ms: 1000 });
        t.executor.start();
        t.proposal(quote());
        await flush();
        t.contract(open({ is_valid_to_sell: 0 }));
        jest.advanceTimersByTime(1000);
        expect(t.api.sell).not.toHaveBeenCalled();
        t.contract(open());
        jest.advanceTimersByTime(5000);
        expect(t.api.sell).toHaveBeenCalledTimes(1);
    });

    it('still follows a purchase that is confirmed after the trade timed out', async () => {
        let confirm: (value: TApiResponse) => void = () => undefined;
        const t = setup({ buy_timeout_ms: 1000 });
        (t.api.buy as jest.Mock).mockReturnValueOnce(
            new Promise(resolve => {
                confirm = resolve;
            })
        );
        t.executor.start();
        t.proposal(quote());
        jest.advanceTimersByTime(1000);
        expect(t.ends[0].kind).toBe('failed');
        confirm({ buy: { contract_id: 7, buy_price: 1, payout: 2 } });
        await flush();
        expect(t.onBought).toHaveBeenCalled();
        t.contract(open({ is_sold: 1, profit: 1 }));
        expect(t.ends.some(end => end.kind === 'closed')).toBe(true);
    });
});
