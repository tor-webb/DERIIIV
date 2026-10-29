import type { TBotApi } from './types';

/** Adapts the platform's websocket helper (`WS` from `@deriv/shared`) to the interface the runner uses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createWsBotApi = (ws: Record<string, any>): TBotApi => ({
    getHistory: ({ symbol, style, granularity, count }) =>
        ws.getTicksHistory({
            ticks_history: symbol,
            adjust_start_time: 1,
            count,
            end: 'latest',
            style,
            ...(style === 'candles' ? { granularity } : {}),
        }),
    subscribeTicks: (symbol, cb) => ws.subscribeTicks(symbol, cb),
    subscribeProposal: (request, cb) => ws.subscribeProposal(request, cb),
    buy: (proposal_id, price) => ws.buy({ proposal_id, price }),
    subscribeOpenContract: (contract_id, cb) => ws.subscribeProposalOpenContract(contract_id, cb),
    sell: (contract_id, price) => ws.sell(contract_id, price),
});
