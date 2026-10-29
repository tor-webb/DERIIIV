/**
 * The maths behind the trade journal. Pure functions over a list of finished trades, so every number on the page can be
 * checked by hand. Nothing here predicts anything: it only describes trades that already happened.
 */
import { breakEvenWinRate, round2 } from '../StakeTools/stake-math';

/** The most trades the journal asks the server for (the profit table's own maximum per request). */
export const JOURNAL_TRADE_LIMIT = 500;

export type TJournalTrade = {
    id: string;
    symbol: string;
    /** Money paid for the contract. */
    stake: number;
    /** Money received when it closed (0 for a loss). */
    sold_for: number;
    /** `sold_for - stake`, rounded to 2 decimals. */
    profit: number;
    won: boolean;
    /** What the contract would pay if it won, or null when the server did not say. */
    payout: number | null;
    /** Seconds since 1970, when the contract closed. */
    closed_at: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | null => {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

/**
 * Turns profit-table rows from the server into trades. A row with a missing or impossible stake or time is dropped
 * rather than guessed at. The result is oldest first.
 */
export const normaliseTrades = (rows: unknown): TJournalTrade[] => {
    if (!Array.isArray(rows)) return [];
    const trades: TJournalTrade[] = [];
    rows.forEach(row => {
        if (!isObject(row)) return;
        const stake = finite(row.buy_price);
        const sold_for = finite(row.sell_price);
        const closed_at = finite(row.sell_time) ?? finite(row.purchase_time);
        const symbol = row.underlying_symbol ?? row.symbol ?? row.underlying;
        if (stake === null || stake <= 0 || sold_for === null || sold_for < 0 || closed_at === null) return;
        if (typeof symbol !== 'string' || !symbol) return;
        const payout = finite(row.payout);
        const profit = round2(sold_for - stake);
        trades.push({
            id: String(row.contract_id ?? `${symbol}-${closed_at}-${trades.length}`),
            symbol,
            stake,
            sold_for,
            profit,
            won: profit > 0,
            payout: payout !== null && payout > stake ? payout : null,
            closed_at,
        });
    });
    return trades.sort((a, b) => a.closed_at - b.closed_at);
};

export type TMarketTotals = {
    symbol: string;
    trades: number;
    wins: number;
    win_rate: number;
    profit: number;
};

export type TJournalSummary = {
    trades: number;
    wins: number;
    losses: number;
    /** Percent of trades that closed with a profit. */
    win_rate: number;
    total_staked: number;
    /** Total of every profit and loss. Negative when the trades lost money overall. */
    net_profit: number;
    average_stake: number;
    /**
     * The average return on a winning trade, as a percent of the stake, worked out from the payouts the server reported.
     * Null when no trade reported one.
     */
    average_payout_percent: number | null;
    /** The win rate a person needs just to break even at that average payout, or null when the payout is unknown. */
    break_even_rate: number | null;
    biggest_win: TJournalTrade | null;
    biggest_loss: TJournalTrade | null;
    markets: TMarketTotals[];
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Totals for each market, with the one that made the most money first. */
export const marketTotals = (trades: TJournalTrade[]): TMarketTotals[] => {
    const by_symbol = new Map<string, TJournalTrade[]>();
    trades.forEach(trade => by_symbol.set(trade.symbol, [...(by_symbol.get(trade.symbol) ?? []), trade]));
    return [...by_symbol.entries()]
        .map(([symbol, items]) => {
            const wins = items.filter(trade => trade.won).length;
            return {
                symbol,
                trades: items.length,
                wins,
                win_rate: (wins / items.length) * 100,
                profit: round2(items.reduce((sum, trade) => sum + trade.profit, 0)),
            };
        })
        .sort((a, b) => b.profit - a.profit || b.trades - a.trades || a.symbol.localeCompare(b.symbol));
};

/** The numbers shown at the top of the journal. Returns null for an empty list. */
export const summariseTrades = (trades: TJournalTrade[]): TJournalSummary | null => {
    if (!trades.length) return null;
    const wins = trades.filter(trade => trade.won).length;
    const payouts = trades.filter(trade => trade.payout !== null).map(trade => (trade.payout! / trade.stake - 1) * 100);
    const average_payout_percent = payouts.length ? mean(payouts) : null;
    const total_staked = round2(trades.reduce((sum, trade) => sum + trade.stake, 0));
    const by_profit = [...trades].sort((a, b) => b.profit - a.profit);
    const best = by_profit[0];
    const worst = by_profit[by_profit.length - 1];
    return {
        trades: trades.length,
        wins,
        losses: trades.length - wins,
        win_rate: (wins / trades.length) * 100,
        total_staked,
        net_profit: round2(trades.reduce((sum, trade) => sum + trade.profit, 0)),
        average_stake: round2(total_staked / trades.length),
        average_payout_percent,
        break_even_rate: average_payout_percent === null ? null : breakEvenWinRate(average_payout_percent),
        biggest_win: best.profit > 0 ? best : null,
        biggest_loss: worst.profit < 0 ? worst : null,
        markets: marketTotals(trades),
    };
};

/** The stake of each trade, oldest first, for the stake-over-time line. */
export const stakeSeries = (trades: TJournalTrade[]): number[] => trades.map(trade => trade.stake);

/** Running total of profit and loss after each trade, oldest first, starting from the first trade. */
export const profitSeries = (trades: TJournalTrade[]): number[] => {
    let running = 0;
    return trades.map(trade => {
        running = round2(running + trade.profit);
        return running;
    });
};

export type TFairnessNote = 'above' | 'below' | 'unknown';

/**
 * Whether the win rate is above or below the rate needed to break even. This compares two numbers from past trades.
 * It says nothing about the next trade.
 */
export const breakEvenComparison = (summary: TJournalSummary): TFairnessNote => {
    if (summary.break_even_rate === null) return 'unknown';
    return summary.win_rate >= summary.break_even_rate ? 'above' : 'below';
};

/** Keeps the newest `count` trades (the list is oldest first). Zero or less means keep all. */
export const lastTrades = (trades: TJournalTrade[], count: number): TJournalTrade[] =>
    count > 0 ? trades.slice(-count) : trades;
