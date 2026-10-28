import { findBotMarket, MARKETS } from '../bot-markets';

describe('findBotMarket', () => {
    it('finds a Derived index and says which dropdowns hold it', () => {
        expect(findBotMarket('R_100')).toEqual({
            symbol: 'R_100',
            name: 'Volatility 100 Index',
            market: 'synthetic_index',
            submarket: 'random_index',
            group: 'synthetic',
        });
        expect(findBotMarket('1HZ10V')?.group).toBe('synthetic');
    });

    it('finds a forex pair', () => {
        expect(findBotMarket('frxEURUSD')).toMatchObject({
            name: 'EUR/USD',
            market: 'forex',
            submarket: 'major_pairs',
            group: 'forex',
        });
    });

    it('returns null for a market Bot Builder cannot trade, and for empty input', () => {
        expect(findBotMarket('frxNZDUSD')).toBeNull();
        expect(findBotMarket('NOPE')).toBeNull();
        expect(findBotMarket('')).toBeNull();
        expect(findBotMarket(null)).toBeNull();
        expect(findBotMarket(undefined)).toBeNull();
    });

    it('finds every symbol that the market dropdowns list', () => {
        Object.values(MARKETS).forEach(market =>
            Object.values(market.submarkets).forEach(submarket =>
                submarket.symbols.forEach(([name, symbol]) => expect(findBotMarket(symbol)?.name).toBe(name))
            )
        );
    });
});
