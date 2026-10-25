/**
 * Thin wrapper over Deriv's copy trading calls.
 *
 * How it works: the trader being copied shares a READ-ONLY API token. A follower who is logged in sends that token to
 * `copy_start` on their own session, and Deriv then mirrors the trader's trades onto the follower's account. No
 * follower token is ever stored by this site.
 */

export type TCopyApi = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: (request: Record<string, unknown>) => Promise<any>;
};

/** Adapts the platform websocket helper (`WS` from `@deriv/shared`) to `TCopyApi`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createCopyApi = (ws: Record<string, any>): TCopyApi => ({
    send: request => ws.get().send(request),
});

export type TCopyLimits = {
    min_trade_stake?: number;
    max_trade_stake?: number;
};

/** Deriv rejects with `{ error: { message } }`, other failures are plain errors. */
export const getErrorMessage = (error: unknown): string => {
    const candidate = error as { error?: { message?: string }; message?: string } | undefined;
    return candidate?.error?.message ?? candidate?.message ?? 'Something went wrong. Please try again.';
};

export const startCopying = async (api: TCopyApi, trader_token: string, limits: TCopyLimits = {}) => {
    const request: Record<string, unknown> = { copy_start: trader_token };
    if (limits.min_trade_stake !== undefined) request.min_trade_stake = limits.min_trade_stake;
    if (limits.max_trade_stake !== undefined) request.max_trade_stake = limits.max_trade_stake;
    await api.send(request);
};

export const stopCopying = async (api: TCopyApi, trader_token: string) => {
    await api.send({ copy_stop: trader_token });
};

/** True when this account is already copying the trader with that token. */
export const isCopying = async (api: TCopyApi, trader_token: string): Promise<boolean> => {
    const response = await api.send({ copytrading_list: 1 });
    const traders: { token?: string }[] = response?.copytrading_list?.traders ?? [];
    return traders.some(trader => trader.token === trader_token);
};

export type TLimitsInput = { min: string; max: string };

/** Turns the two optional stake boxes into limits, or an error code when they do not make sense. */
export const parseLimits = ({ min, max }: TLimitsInput): { limits: TCopyLimits; error?: 'invalid' | 'order' } => {
    const limits: TCopyLimits = {};
    const read = (text: string) => (text.trim() === '' ? undefined : Number(text));
    const min_value = read(min);
    const max_value = read(max);

    if ([min_value, max_value].some(value => value !== undefined && (!Number.isFinite(value) || value <= 0))) {
        return { limits, error: 'invalid' };
    }
    if (min_value !== undefined && max_value !== undefined && min_value > max_value) {
        return { limits, error: 'order' };
    }
    if (min_value !== undefined) limits.min_trade_stake = min_value;
    if (max_value !== undefined) limits.max_trade_stake = max_value;
    return { limits };
};
