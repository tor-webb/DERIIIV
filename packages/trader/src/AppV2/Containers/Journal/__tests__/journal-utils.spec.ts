import {
    breakEvenComparison,
    lastTrades,
    marketTotals,
    normaliseTrades,
    profitSeries,
    stakeSeries,
    summariseTrades,
} from '../journal-utils';

const row = (overrides: Record<string, unknown> = {}) => ({
    contract_id: 1,
    underlying_symbol: 'R_100',
    buy_price: 10,
    sell_price: 19,
    payout: 19,
    purchase_time: 100,
    sell_time: 200,
    ...overrides,
});

// 4 trades. Stakes 10, 10, 20, 10. Results +9, -10, +18, -10. Net +7. Win rate 50%. Payout 90% each time.
const ROWS = [
    row({ contract_id: 3, underlying_symbol: '1HZ100V', buy_price: 20, sell_price: 38, payout: 38, sell_time: 400 }),
    row({ contract_id: 1, sell_time: 200 }),
    row({ contract_id: 2, sell_price: 0, sell_time: 300 }),
    row({ contract_id: 4, underlying_symbol: '1HZ100V', sell_price: 0, sell_time: 500 }),
];

describe('normaliseTrades', () => {
    it('reads rows, works out profit, and sorts oldest first', () => {
        const trades = normaliseTrades(ROWS);
        expect(trades.map(trade => trade.id)).toEqual(['1', '2', '3', '4']);
        expect(trades.map(trade => trade.profit)).toEqual([9, -10, 18, -10]);
        expect(trades.map(trade => trade.won)).toEqual([true, false, true, false]);
        expect(trades[0]).toMatchObject({ symbol: 'R_100', stake: 10, sold_for: 19, payout: 19, closed_at: 200 });
    });

    it('accepts numbers sent as text and an older "symbol" field', () => {
        const [trade] = normaliseTrades([
            { contract_id: 'a', symbol: 'R_50', buy_price: '5.00', sell_price: '9.50', sell_time: '10' },
        ]);
        expect(trade).toMatchObject({ symbol: 'R_50', stake: 5, sold_for: 9.5, profit: 4.5, closed_at: 10 });
    });

    it('rounds profit to 2 decimals', () => {
        const [trade] = normaliseTrades([row({ buy_price: 0.1, sell_price: 0.3, payout: 0.3 })]);
        expect(trade.profit).toBe(0.2);
    });

    it('drops rows that are not usable instead of guessing', () => {
        const trades = normaliseTrades([
            null,
            'text',
            7,
            row({ buy_price: 0 }),
            row({ buy_price: -1 }),
            row({ buy_price: 'many' }),
            row({ sell_price: undefined }),
            row({ sell_price: -3 }),
            row({ sell_time: undefined, purchase_time: undefined }),
            row({ underlying_symbol: '' }),
            row({ underlying_symbol: undefined }),
            row({ contract_id: 'good' }),
        ]);
        expect(trades.map(trade => trade.id)).toEqual(['good']);
    });

    it('uses the purchase time when there is no sell time', () => {
        expect(normaliseTrades([row({ sell_time: undefined, purchase_time: 55 })])[0].closed_at).toBe(55);
    });

    it('ignores a payout that is not above the stake', () => {
        expect(normaliseTrades([row({ payout: 5 })])[0].payout).toBeNull();
        expect(normaliseTrades([row({ payout: undefined })])[0].payout).toBeNull();
    });

    it('returns nothing for something that is not a list', () => {
        expect(normaliseTrades(undefined)).toEqual([]);
        expect(normaliseTrades({})).toEqual([]);
    });

    it('treats a trade that returned exactly the stake as not won', () => {
        expect(normaliseTrades([row({ sell_price: 10 })])[0]).toMatchObject({ profit: 0, won: false });
    });
});

describe('summariseTrades', () => {
    const trades = normaliseTrades(ROWS);

    it('is null for no trades', () => {
        expect(summariseTrades([])).toBeNull();
    });

    it('counts wins and losses and the win rate', () => {
        expect(summariseTrades(trades)).toMatchObject({ trades: 4, wins: 2, losses: 2, win_rate: 50 });
    });

    it('adds up the money', () => {
        expect(summariseTrades(trades)).toMatchObject({ total_staked: 50, net_profit: 7, average_stake: 12.5 });
    });

    it('works out the break-even win rate from the payouts', () => {
        // a 90% return needs 100 / 1.9 = 52.63% wins to break even
        const summary = summariseTrades(trades)!;
        expect(summary.average_payout_percent).toBeCloseTo(90, 6);
        expect(summary.break_even_rate).toBeCloseTo(52.6316, 3);
    });

    it('has no break-even rate when no payout is known', () => {
        const summary = summariseTrades(normaliseTrades([row({ payout: undefined })]))!;
        expect(summary.average_payout_percent).toBeNull();
        expect(summary.break_even_rate).toBeNull();
    });

    it('finds the biggest win and the biggest loss, and none when there is no such trade', () => {
        const summary = summariseTrades(trades)!;
        expect(summary.biggest_win?.id).toBe('3');
        expect(summary.biggest_loss?.profit).toBe(-10);
        const only_wins = summariseTrades(normaliseTrades([row()]))!;
        expect(only_wins.biggest_loss).toBeNull();
        const only_losses = summariseTrades(normaliseTrades([row({ sell_price: 0 })]))!;
        expect(only_losses.biggest_win).toBeNull();
    });

    it('keeps cents exact', () => {
        const summary = summariseTrades(
            normaliseTrades([
                row({ contract_id: 1, buy_price: 0.1, sell_price: 0.3, payout: 0.3 }),
                row({ contract_id: 2, buy_price: 0.2, sell_price: 0, payout: 0.5 }),
            ])
        )!;
        expect(summary.net_profit).toBe(0);
        expect(summary.total_staked).toBe(0.3);
    });
});

describe('marketTotals', () => {
    it('groups by market with the most profitable first', () => {
        const totals = marketTotals(normaliseTrades(ROWS));
        // R_100: +9 and -10 = -1. 1HZ100V: +18 and -10 = +8.
        expect(totals).toEqual([
            { symbol: '1HZ100V', trades: 2, wins: 1, win_rate: 50, profit: 8 },
            { symbol: 'R_100', trades: 2, wins: 1, win_rate: 50, profit: -1 },
        ]);
    });

    it('breaks a tie by trade count and then name', () => {
        const totals = marketTotals(
            normaliseTrades([
                row({ contract_id: 1, underlying_symbol: 'B', sell_price: 10, payout: 19 }),
                row({ contract_id: 2, underlying_symbol: 'A', sell_price: 10, payout: 19 }),
            ])
        );
        expect(totals.map(item => item.symbol)).toEqual(['A', 'B']);
    });
});

describe('series', () => {
    const trades = normaliseTrades(ROWS);

    it('lists the stake of each trade in order', () => {
        expect(stakeSeries(trades)).toEqual([10, 10, 20, 10]);
    });

    it('keeps a running total of profit and loss', () => {
        expect(profitSeries(trades)).toEqual([9, -1, 17, 7]);
    });

    it('is empty for no trades', () => {
        expect(stakeSeries([])).toEqual([]);
        expect(profitSeries([])).toEqual([]);
    });
});

describe('breakEvenComparison', () => {
    it('says above, below or unknown', () => {
        const summary = summariseTrades(normaliseTrades(ROWS))!;
        expect(breakEvenComparison(summary)).toBe('below'); // 50% against 52.6%
        expect(breakEvenComparison({ ...summary, win_rate: 60 })).toBe('above');
        expect(breakEvenComparison({ ...summary, win_rate: summary.break_even_rate! })).toBe('above');
        expect(breakEvenComparison({ ...summary, break_even_rate: null })).toBe('unknown');
    });
});

describe('lastTrades', () => {
    const trades = normaliseTrades(ROWS);

    it('keeps the newest trades', () => {
        expect(lastTrades(trades, 2).map(trade => trade.id)).toEqual(['3', '4']);
    });

    it('keeps everything for zero, a negative number, or a count larger than the list', () => {
        expect(lastTrades(trades, 0)).toHaveLength(4);
        expect(lastTrades(trades, -1)).toHaveLength(4);
        expect(lastTrades(trades, 99)).toHaveLength(4);
    });
});
