import type { TScanRow } from './use-voltrex-scanner';
import type { TSignalDirection } from './voltrex-analysis';
import type { TRiskState } from './voltrex-risk';
import type { TTrade } from './voltrex-trader';

export type TPerformance = {
    finished: number;
    wins: number;
    losses: number;
    failed: number;
    /** Wins as a share of finished trades, 0 to 100. Null until a trade has finished. */
    win_rate: number | null;
    net_profit: number;
    today_profit: number;
    losing_streak: number;
    manual: number;
    auto: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Results of the trades this page has placed in this visit, plus today's saved figures. Nothing here is estimated. */
export const performance = (trades: TTrade[], risk: TRiskState): TPerformance => {
    const done = trades.filter(trade => trade.status === 'won' || trade.status === 'lost');
    const wins = done.filter(trade => trade.status === 'won').length;
    return {
        finished: done.length,
        wins,
        losses: done.length - wins,
        failed: trades.filter(trade => trade.status === 'failed').length,
        win_rate: done.length ? Math.round((wins / done.length) * 1000) / 10 : null,
        net_profit: round2(done.reduce((sum, trade) => sum + (trade.profit ?? 0), 0)),
        today_profit: risk.realised_profit,
        losing_streak: risk.consecutive_losses,
        manual: trades.filter(trade => trade.source === 'manual' && trade.status !== 'failed').length,
        auto: trades.filter(trade => trade.source === 'auto' && trade.status !== 'failed').length,
    };
};

export type TSignalEvent = {
    symbol: string;
    name: string;
    from: TSignalDirection;
    to: TSignalDirection;
    strength: number;
    time: number;
};

/**
 * Compares each market's signal with the one seen last time and reports the changes. A market seen for the first time
 * is remembered but not reported, since nothing changed. Returns the new "last seen" map along with the events.
 */
export const signalChanges = (
    previous: Record<string, TSignalDirection>,
    rows: TScanRow[],
    time: number
): { events: TSignalEvent[]; next: Record<string, TSignalDirection> } => {
    const next = { ...previous };
    const events: TSignalEvent[] = [];
    rows.forEach(row => {
        if (!row.signal) return;
        const to = row.signal.direction;
        const from = previous[row.symbol];
        if (from && from !== to) {
            events.push({ symbol: row.symbol, name: row.name, from, to, strength: row.signal.strength, time });
        }
        next[row.symbol] = to;
    });
    return { events, next };
};
