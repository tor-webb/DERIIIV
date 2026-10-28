/**
 * The markets Bot Builder can trade, in the order its market dropdowns list them. This lives in its own file, with no
 * Blockly in it, so other pages (Markets) can ask "can a bot trade this symbol?" without loading the block editor.
 */

export const MARKETS: Record<
    string,
    { label: string; submarkets: Record<string, { label: string; symbols: [string, string][] }> }
> = {
    synthetic_index: {
        label: 'Derived',
        submarkets: {
            random_index: {
                label: 'Continuous Indices',
                symbols: [
                    ['Volatility 10 Index', 'R_10'],
                    ['Volatility 25 Index', 'R_25'],
                    ['Volatility 50 Index', 'R_50'],
                    ['Volatility 75 Index', 'R_75'],
                    ['Volatility 100 Index', 'R_100'],
                    ['Volatility 10 (1s) Index', '1HZ10V'],
                    ['Volatility 25 (1s) Index', '1HZ25V'],
                    ['Volatility 50 (1s) Index', '1HZ50V'],
                    ['Volatility 75 (1s) Index', '1HZ75V'],
                    ['Volatility 100 (1s) Index', '1HZ100V'],
                ],
            },
        },
    },
    forex: {
        label: 'Forex',
        submarkets: {
            major_pairs: {
                label: 'Major Pairs',
                symbols: [
                    ['EUR/USD', 'frxEURUSD'],
                    ['GBP/USD', 'frxGBPUSD'],
                    ['USD/JPY', 'frxUSDJPY'],
                ],
            },
        },
    },
};

export type TBotMarket = {
    symbol: string;
    /** Display name, for example "Volatility 100 Index". */
    name: string;
    /** Keys of the market and submarket dropdowns that contain the symbol. */
    market: string;
    submarket: string;
    /** Derived indices allow digit contracts and tick durations; forex does not. */
    group: 'synthetic' | 'forex';
};

/** Looks a symbol up in the market list. Returns null for a market Bot Builder cannot trade yet. */
export const findBotMarket = (symbol: string | null | undefined): TBotMarket | null => {
    if (!symbol) return null;
    const markets = Object.entries(MARKETS);
    for (let m = 0; m < markets.length; m += 1) {
        const [market, config] = markets[m];
        const submarkets = Object.entries(config.submarkets);
        for (let s = 0; s < submarkets.length; s += 1) {
            const [submarket, details] = submarkets[s];
            const found = details.symbols.find(([, value]) => value === symbol);
            if (found) {
                return { symbol, name: found[0], market, submarket, group: market === 'forex' ? 'forex' : 'synthetic' };
            }
        }
    }
    return null;
};
