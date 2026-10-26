import { routes } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

/**
 * Everything the Learn page teaches, as plain data. Edit the wording here; the page does not need to change.
 * Functions rather than constants because `localize` must run at render time, after the language is known.
 */

export type TTryIt = { label: string; path: string };

export type TLesson = {
    id: string;
    title: string;
    summary: string;
    /** Short paragraphs. */
    body: string[];
    /** The things to remember, as a list. */
    points: string[];
    /** A link to a tool in this app where the lesson can be practised. */
    try_it?: TTryIt;
};

export type TTopic = {
    id: string;
    label: string;
    intro: string;
    lessons: TLesson[];
};

export type TGlossaryEntry = { term: string; meaning: string };

export const getTopics = (): TTopic[] => [
    {
        id: 'basics',
        label: localize('Start here'),
        intro: localize('New to trading? Begin with how prices move and how a trade makes or loses money.'),
        lessons: [
            {
                id: 'what_moves_prices',
                title: localize('What makes a price move'),
                summary: localize('Prices change when more people want to buy than sell, or the other way round.'),
                body: [
                    localize(
                        'Every price is a meeting point between buyers and sellers. When buyers are keener, the price rises. When sellers are keener, it falls. Everything else is a reason why buyers or sellers changed their mind.'
                    ),
                    localize(
                        'Those reasons include news (a central bank changing interest rates, a company reporting earnings, a new law), the mood of the crowd, and large orders from banks and funds.'
                    ),
                ],
                points: [
                    localize('A price moves because of demand and supply, not because it is "due" to move.'),
                    localize(
                        'News matters most when it surprises people. A rate rise everyone expected moves prices less.'
                    ),
                    localize('Prices can move for no reason you can see. Not every move can be explained.'),
                ],
                try_it: { label: localize('Watch a live chart'), path: routes.charts },
            },
            {
                id: 'how_a_trade_works',
                title: localize('How a trade makes or loses money'),
                summary: localize(
                    'On this platform you pick a direction or a digit, a stake and a time. You win or lose that stake.'
                ),
                body: [
                    localize(
                        'In a Rise/Fall contract you stake an amount and say whether the price will be higher or lower when the time ends. If you are right you get your stake back plus a profit. If you are wrong you lose the stake.'
                    ),
                    localize(
                        'The profit on a win is smaller than the stake you risk on a loss, for example 95 on a win against 100 on a loss. That gap is why you need to win a bit more than half the time just to break even.'
                    ),
                ],
                points: [
                    localize('The most you can lose on one contract is the stake.'),
                    localize('Break-even win rate = 100 divided by (1 + profit on a win as a fraction of the stake).'),
                    localize('At a 95% profit on a win you need to win more than 51.3% of contracts to break even.'),
                ],
                try_it: { label: localize('Find your break-even win rate'), path: routes.what_if },
            },
            {
                id: 'demo_first',
                title: localize('Practise on a demo account first'),
                summary: localize('A demo account uses practice money, so mistakes cost nothing.'),
                body: [
                    localize(
                        'Use a demo account to learn where the buttons are, how a contract ends, and how fast a balance can fall. Do this for weeks, not minutes.'
                    ),
                    localize(
                        'Move to real money only when you have a written plan, you follow it on the demo account, and you are happy to lose the amount you put in.'
                    ),
                ],
                points: [
                    localize('Keep a simple journal: why you entered, what happened, what you would change.'),
                    localize(
                        'Demo results are easier than real ones because there is no fear. Expect to trade worse with real money.'
                    ),
                ],
                try_it: { label: localize('Open the trade page'), path: routes.index },
            },
        ],
    },
    {
        id: 'charts',
        label: localize('Reading charts'),
        intro: localize(
            'A chart is a record of past prices. These are the tools most beginners meet first, and what each one cannot tell you.'
        ),
        lessons: [
            {
                id: 'candles',
                title: localize('Candlesticks'),
                summary: localize('Each candle shows where the price started, ended, and how far it went in between.'),
                body: [
                    localize(
                        'A candle covers one period, such as one minute. The thick body runs from the opening price to the closing price. The thin lines (wicks) show the highest and lowest prices reached.'
                    ),
                    localize(
                        'Colours differ between charts, but usually one colour means the price closed higher than it opened and the other means it closed lower.'
                    ),
                ],
                points: [
                    localize('A long wick means the price went somewhere and was pushed back.'),
                    localize('A tiny body means buyers and sellers were close to even in that period.'),
                    localize('One candle tells you little. Read several together.'),
                ],
                try_it: { label: localize('Open the charts'), path: routes.charts },
            },
            {
                id: 'trend_levels',
                title: localize('Trend, support and resistance'),
                summary: localize(
                    'Trends show direction. Support and resistance are prices where the market has paused before.'
                ),
                body: [
                    localize(
                        'An uptrend is a series of higher highs and higher lows. A downtrend is lower highs and lower lows. Sideways is neither.'
                    ),
                    localize(
                        'Support is a price where falls have stopped before. Resistance is a price where rises have stopped before. Traders watch them because many other traders do too.'
                    ),
                ],
                points: [
                    localize('Levels are zones, not exact lines.'),
                    localize('Every level breaks eventually. Decide in advance what you will do if it does.'),
                    localize('A trend can end at any time, with no warning.'),
                ],
                try_it: { label: localize('Draw levels on a chart'), path: routes.charts },
            },
            {
                id: 'indicators',
                title: localize('Moving averages and RSI'),
                summary: localize(
                    'Indicators turn past prices into a line or a number. They describe the past. They do not see the future.'
                ),
                body: [
                    localize(
                        'A moving average is the average of the last N closing prices. It smooths the noise and shows direction, but it reacts late because it is built from old prices.'
                    ),
                    localize(
                        'The RSI is a number from 0 to 100 that compares recent rises with recent falls. Readings above 70 are often called overbought and below 30 oversold, but in a strong trend the RSI can stay there for a long time.'
                    ),
                ],
                points: [
                    localize('Pick one or two indicators and learn them well. More lines do not mean more certainty.'),
                    localize('An indicator is a prompt to look closer, not a signal to buy or sell.'),
                    localize('Test an idea on past data before you trust it. Then test it on a demo account.'),
                ],
                try_it: { label: localize('Add an indicator to a chart'), path: routes.charts },
            },
        ],
    },
    {
        id: 'news',
        label: localize('News and crypto'),
        intro: localize(
            'News starts many of the biggest moves. Learn what to watch and how to read it without being fooled.'
        ),
        lessons: [
            {
                id: 'calendar',
                title: localize('The economic calendar'),
                summary: localize(
                    'A calendar lists scheduled news such as interest rate decisions and inflation figures.'
                ),
                body: [
                    localize(
                        'Forex and stock prices often jump around scheduled releases: central bank rate decisions, inflation, jobs figures and company earnings. Calendars published by news and charting sites list the date and time of each one, and what the market expected.'
                    ),
                    localize(
                        'The price reacts to the difference between what was expected and what was announced. Spreads and price jumps can be larger around these times.'
                    ),
                ],
                points: [
                    localize('Check the calendar before you trade. Know when big news is due.'),
                    localize('Many beginners stay out of the market for a few minutes either side of major news.'),
                    localize('Look at the time zone shown. A wrong time zone is a common mistake.'),
                ],
            },
            {
                id: 'stocks',
                title: localize('Stocks and what moves them'),
                summary: localize('Company results, forecasts and the wider economy move share prices.'),
                body: [
                    localize(
                        'A share price reflects what investors think a company will earn in future. Earnings reports, forecasts from the company, new products, lawsuits and changes in interest rates can all change that view.'
                    ),
                    localize(
                        'Whole sectors and markets also move together, for example when investors become nervous about the economy.'
                    ),
                ],
                points: [
                    localize('Earnings days are among the most volatile days for a share.'),
                    localize('Good news can still cause a fall if people hoped for even better.'),
                    localize(
                        'Which markets you can trade depends on what this platform offers. The ideas still apply.'
                    ),
                ],
            },
            {
                id: 'crypto',
                title: localize('Reading crypto news'),
                summary: localize('Crypto trades all day, every day, and reacts quickly to news, rumours and rules.'),
                body: [
                    localize(
                        'Things that often move crypto prices include new regulation, exchange listings, security hacks, large transfers, big companies or funds buying or selling, and plans to release more coins into circulation.'
                    ),
                    localize(
                        'Because the market never closes and much of the talk happens on social media, rumours spread fast and prices can swing sharply in either direction.'
                    ),
                ],
                points: [
                    localize('Ask who is saying it, when, and how they know. Prefer sources that name their evidence.'),
                    localize('By the time you read a headline, the price has often already moved.'),
                    localize(
                        'Be careful with anyone promising guaranteed returns or asking you to send money first. Those are scams.'
                    ),
                ],
            },
            {
                id: 'synthetics',
                title: localize('A note on Volatility indices'),
                summary: localize('Volatility indices are simulated. News does not move them.'),
                body: [
                    localize(
                        'Volatility indices are simulated markets produced by a random number generator. They are not tied to a company, a currency or a coin, so there is no news that moves them and no event to prepare for.'
                    ),
                    localize(
                        'That means chart patterns and indicators cannot give you an edge there. What is left is the payout, your stake plan and luck. The Bulk Trader simulator lets you check this on real ticks.'
                    ),
                ],
                points: [
                    localize('Real markets (forex, stocks, crypto) respond to news. Simulated ones do not.'),
                    localize('Whatever the market, the payout sets the win rate you need to break even.'),
                ],
                try_it: { label: localize('Test it on real ticks'), path: routes.bulk_trader },
            },
        ],
    },
    {
        id: 'predictions',
        label: localize('Predictions and risk'),
        intro: localize('Nobody can predict the market. What you can do is plan for being wrong.'),
        lessons: [
            {
                id: 'prediction_truth',
                title: localize('What a prediction really is'),
                summary: localize(
                    'A forecast is a guess with a probability. Treat it as one possible future, not a promise.'
                ),
                body: [
                    localize(
                        'Analysts, indicators and chat groups all produce predictions, and all of them are wrong some of the time. Be wary of anyone who is always right, or who sells certainty.'
                    ),
                    localize(
                        'A better habit is to think in scenarios: "If the price holds above this level I will do this. If it breaks below it I will do that." You decide your reaction before the move, not during it.'
                    ),
                ],
                points: [
                    localize('A strategy with a 60% win rate still loses 4 times in every 10.'),
                    localize('Past results show what happened, not what will happen.'),
                    localize('Judge a plan over many trades, not one.'),
                ],
                try_it: { label: localize('Try a win rate of your own'), path: routes.what_if },
            },
            {
                id: 'win_rate_vs_break_even',
                title: localize('Win rate against break-even'),
                summary: localize('A strategy only works if it wins more often than its payout requires.'),
                body: [
                    localize(
                        'Every payout has a break-even win rate. Above it you make money on average. Below it you lose on average, however clever the stake plan.'
                    ),
                    localize(
                        'A short run of wins can sit well above break-even by luck alone. The Bulk Trader simulator shows the win rate next to break-even so you can see how far a streak really is from being profitable.'
                    ),
                ],
                points: [
                    localize('Stake plans such as Martingale change how bumpy the ride is, not the odds.'),
                    localize('Doubling after a loss can end an account in a few unlucky trades.'),
                    localize('Collect many trades before you trust a win rate.'),
                ],
                try_it: { label: localize('Run the simulator'), path: routes.bulk_trader },
            },
            {
                id: 'risk_basics',
                title: localize('Risk basics'),
                summary: localize('Decide how much you can lose before you trade, and stick to it.'),
                body: [
                    localize(
                        'Many traders risk 1% to 2% of their balance on a single trade, so a run of losses does not end their account. Choose your number before you start, not after a loss.'
                    ),
                    localize(
                        'Only trade money you can afford to lose. Never borrow to trade, and never trade money you need for rent, food or bills.'
                    ),
                ],
                points: [
                    localize('Set a stop loss for the day and stop when you reach it.'),
                    localize('Losing streaks are normal. Plan for them.'),
                    localize('If trading stops being calm, take a break.'),
                ],
                try_it: { label: localize('Open the risk calculator'), path: routes.risk_calculator },
            },
        ],
    },
];

export const getChecklist = (): { id: string; text: string }[] => [
    { id: 'demo', text: localize('I have practised this idea on a demo account.') },
    { id: 'news', text: localize('I have checked the calendar for news in the next hour.') },
    { id: 'risk', text: localize('I know how much I will lose if I am wrong, and I can afford it.') },
    { id: 'plan', text: localize('I know when I will stop, win or lose.') },
    { id: 'calm', text: localize('I am calm. I am not trying to win back a loss.') },
];

export const getGlossary = (): TGlossaryEntry[] => [
    {
        term: localize('Ask / bid'),
        meaning: localize(
            'The price you can buy at (ask) and the price you can sell at (bid). The gap between them is the spread.'
        ),
    },
    {
        term: localize('Break-even win rate'),
        meaning: localize(
            'The share of contracts you must win for your profit and losses to cancel out. It depends on the payout.'
        ),
    },
    { term: localize('Bull / bear'), meaning: localize('A bull market is rising. A bear market is falling.') },
    {
        term: localize('Candlestick'),
        meaning: localize('A chart symbol that shows the open, high, low and close of one period.'),
    },
    {
        term: localize('Drawdown'),
        meaning: localize('How far your balance falls from its highest point before it recovers.'),
    },
    {
        term: localize('Leverage'),
        meaning: localize(
            'Trading a larger position than your money alone would allow. It magnifies both gains and losses.'
        ),
    },
    {
        term: localize('Liquidity'),
        meaning: localize('How easily something can be bought or sold without moving the price.'),
    },
    {
        term: localize('Martingale'),
        meaning: localize(
            'Raising your stake after each loss to recover. It can end an account after a short losing streak.'
        ),
    },
    {
        term: localize('Moving average'),
        meaning: localize('The average of the last N closing prices, drawn as a line to smooth out noise.'),
    },
    { term: localize('Payout'), meaning: localize('What a winning contract returns: your stake plus the profit.') },
    { term: localize('Resistance'), meaning: localize('A price where rises have stopped before.') },
    {
        term: localize('RSI'),
        meaning: localize('Relative Strength Index. A 0 to 100 number that compares recent rises with recent falls.'),
    },
    { term: localize('Spread'), meaning: localize('The difference between the buy price and the sell price.') },
    { term: localize('Stake'), meaning: localize('The amount you risk on one contract.') },
    {
        term: localize('Stop loss'),
        meaning: localize('A limit you set so you stop or exit when a loss reaches a chosen size.'),
    },
    { term: localize('Support'), meaning: localize('A price where falls have stopped before.') },
    { term: localize('Tick'), meaning: localize('One price update. A 5-tick contract lasts for five price updates.') },
    {
        term: localize('Volatility'),
        meaning: localize('How much and how fast a price moves. High volatility means bigger swings.'),
    },
    { term: localize('Win rate'), meaning: localize('The share of your contracts that won.') },
];
