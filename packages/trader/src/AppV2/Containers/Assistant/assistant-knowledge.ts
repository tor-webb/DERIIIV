import { routes } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

/*
 * The site guide's brain. It is a built-in help list, not a live AI model: each topic has keywords, and the topic whose
 * keywords best match the question gives its answer. Answers describe what the site really has, never promise profit,
 * and offer buttons that take the person to the right page.
 */

export type TAssistantAction = { label: string; path?: string; login?: boolean };

export type TAssistantContext = { is_logged_in: boolean; is_virtual: boolean; pathname: string };

export type TAssistantReply = { id: string; text: string; actions: TAssistantAction[] };

type TTopic = {
    id: string;
    keywords: string[];
    answer: (ctx: TAssistantContext) => string;
    actions?: (ctx: TAssistantContext) => TAssistantAction[];
};

const go = (label: string, path: string): TAssistantAction => ({ label, path });

const topics = (): TTopic[] => [
    {
        id: 'greeting',
        keywords: ['hello', 'hi', 'hey', 'good morning', 'good evening', 'start', 'help'],
        answer: () =>
            localize(
                'Hi! I can show you around: trading, markets and your watchlist, charts, the Bot Builder and its ready-made bots, the risk calculator, copy trading and your reports. Pick a question below or type your own.'
            ),
    },
    {
        id: 'login',
        keywords: ['log in', 'login', 'sign in', 'signin', 'account', 'register', 'sign up', 'signup', 'open account'],
        answer: ({ is_logged_in }) =>
            is_logged_in
                ? localize('You are already logged in. Your balance and account type are at the top of the dashboard.')
                : localize(
                      'Trading, the Bot Builder runs, copy trading and reports need a Deriv account. Press Log in and you will be sent to Deriv to sign in or create one, then brought back here.'
                  ),
        actions: ({ is_logged_in }) =>
            is_logged_in
                ? [go(localize('Open dashboard'), routes.dashboard)]
                : [{ label: localize('Log in'), login: true }],
    },
    {
        id: 'demo_real',
        keywords: ['demo', 'real', 'virtual', 'practice', 'paper', 'real money', 'which account', 'switch account'],
        answer: ({ is_logged_in, is_virtual }) => {
            const base = localize(
                'A demo account trades with virtual money, so wins and losses are not real. A real account uses your own money. Start on demo until you understand how a strategy behaves.'
            );
            if (!is_logged_in) return base;
            return is_virtual
                ? `${base} ${localize('You are on a demo account right now.')}`
                : `${base} ${localize('You are on a REAL account right now, so trades use real money.')}`;
        },
        actions: () => [go(localize('Open dashboard'), routes.dashboard)],
    },
    {
        id: 'balance',
        keywords: ['balance', 'how much', 'my money', 'funds', 'deposit', 'withdraw'],
        answer: ({ is_logged_in }) =>
            is_logged_in
                ? localize(
                      'Your balance is on the dashboard and at the top right of every page. Deposits and withdrawals are done in your Deriv account, not on this site.'
                  )
                : localize('Log in first and your balance will show on the dashboard and at the top right.'),
        actions: ({ is_logged_in }) =>
            is_logged_in
                ? [go(localize('Open dashboard'), routes.dashboard)]
                : [{ label: localize('Log in'), login: true }],
    },
    {
        id: 'trade',
        keywords: [
            'trade',
            'trading',
            'buy',
            'place',
            'contract',
            'rise',
            'fall',
            'even',
            'odd',
            'over',
            'under',
            'stake',
        ],
        answer: () =>
            localize(
                'Open Trade, choose a market, pick a contract type (Rise/Fall, Even/Odd, Over/Under and others), set your duration and stake, then press the purchase button. Check the payout before you buy, and only stake what you can afford to lose.'
            ),
        actions: () => [go(localize('Go to Trade'), routes.index)],
    },
    {
        id: 'markets',
        keywords: [
            'markets',
            'market',
            'watchlist',
            'watch list',
            'top movers',
            'movers',
            'gainers',
            'losers',
            'volatility',
            'live prices',
            'prices',
            'which market',
            'what to trade',
            'what should i trade',
            'star a market',
            'find a market',
            'search for a market',
            'search markets',
            'trend line',
            'sparkline',
            'time window',
            'open in charts',
            'scanner',
            'market scanner',
            'scan markets',
            'screener',
            'filter markets',
            'filter the markets',
            'near the high',
            'near the low',
            'rising markets',
            'falling markets',
        ],
        answer: () =>
            localize(
                'The Markets page lists live prices for 20 markets (Volatility indices and forex pairs). For each one it shows the change and the range over the last hour (switch to 4 hours or 1 day with the buttons above the list), a small trend line, and a Low, Medium or High volatility label compared with similar markets. Use the search box to find a market by name or symbol. The Scanner button opens filters for rising or falling markets, a volatility level, a smallest move, whether the price is near the high or low of the range, and open markets only. It also lists the top gainers and losers. Tap the star to add a market to your watchlist, which is saved in this browser and shown on your Dashboard. Trade opens the Trade page on that market, Chart opens it in Charts, and Bot opens the Bot Builder with ready-made bots for it. Volatility and the trend line show how much a market has moved, not which way it will go next.'
            ),
        actions: () => [go(localize('Open Markets'), routes.markets), go(localize('Go to Trade'), routes.index)],
    },
    {
        id: 'charts',
        keywords: ['chart', 'charts', 'indicator', 'indicators', 'drawing', 'candles', 'analysis'],
        answer: () =>
            localize(
                'The Charts page shows live market charts with indicators and drawing tools, so you can study a market before you trade it.'
            ),
        actions: () => [go(localize('Open Charts'), routes.charts)],
    },
    {
        id: 'bot_what',
        keywords: ['bot', 'bots', 'bot builder', 'robot', 'automate', 'automatic', 'blocks', 'what is a bot'],
        answer: () =>
            localize(
                'The Bot Builder lets you build a trading bot by snapping blocks together: set the market and contract in Trade parameters, say when to buy in Purchase conditions, and what to do after a result in Restart trading conditions. Press Run to start it and Stop to end it. A bot follows your rules exactly, so it can lose as fast as it can win.'
            ),
        actions: () => [go(localize('Open Bot Builder'), routes.bot_builder)],
    },
    {
        id: 'bot_templates',
        keywords: [
            'template',
            'templates',
            'bot template',
            'bot templates',
            'import a template',
            'import a bot template',
            'strategy',
            'strategies',
            'strategy library',
            'ready made',
            'ready made bot',
            'example bot',
            'sample bot',
            'starter bot',
            'one tap',
            'save my bot',
            'save a bot',
            'save as template',
            'my own template',
            'saved bots',
            'keep my bot',
        ],
        answer: () =>
            localize(
                'In the Bot Builder press Templates to see five ready-made bots: Rise/Fall with a steady stake, Even/Odd, Digit Over 2, a Win ladder and a capped Martingale. Press Import on one and it loads into the builder, where you can change any block. It replaces the bot on your workspace, and Bring it back restores your old bot, even after you reload the page. To keep a bot of your own, press Save as template, give it a name, and it appears under Your saved bots in Templates, where you can import or delete it. Saved bots stay in this browser only, up to 20, so use Save to download a file if you want a copy elsewhere. Templates are examples to learn from, not advice, so try them on a demo account first.'
            ),
        actions: () => [go(localize('Open Bot Builder'), routes.bot_builder)],
    },
    {
        id: 'bot_import',
        keywords: [
            'import',
            'import a bot',
            'import bot',
            'xml',
            'upload bot',
            'load bot',
            'deriv bot',
            'binary bot',
            'my bot file',
            'existing bot',
        ],
        answer: () =>
            localize(
                'In the Bot Builder press Import and choose a bot file (.xml) from Deriv Bot or Binary Bot. Stake-management bots such as Martingale and D’Alembert style bots work. If a bot uses a block this site does not support yet, it is refused with a list of the missing blocks instead of loading half-working.'
            ),
        actions: () => [go(localize('Open Bot Builder'), routes.bot_builder)],
    },
    {
        id: 'bot_limits',
        keywords: [
            'take profit',
            'stop loss',
            'limit',
            'limits',
            'stop after',
            'stop automatically',
            'protect',
            'max stake',
            'maximum stake',
            'stake cap',
            'lost contact',
            'connection drops',
        ],
        answer: () =>
            localize(
                'In the Bot Builder run panel (Summary tab) you can set a Take profit, a Stop loss, a Max stake per trade and Stop after trades. Once a limit is reached the bot stops by itself, and a trade above the max stake is never placed. On a real account the Stop loss and Max stake are required, and a red banner shows while the bot is trading. If the connection drops and the server stops answering, the bot asks again a few times, then stops and tells you which contract to check in Positions. Always set a stop loss, especially on a real account.'
            ),
        actions: () => [go(localize('Open Bot Builder'), routes.bot_builder)],
    },
    {
        id: 'bot_run',
        keywords: [
            'run',
            'running',
            'stop',
            'run bot',
            'start bot',
            'journal',
            'transactions',
            'not working',
            'not running',
            'error',
        ],
        answer: () =>
            localize(
                'Press Run at the bottom of the Bot Builder to start and Stop to end. The Summary tab shows your totals, Transactions lists each trade, and Journal shows what the bot is doing and any errors. If it will not start, press Check bot to see what is missing, and make sure you are logged in.'
            ),
        actions: () => [go(localize('Open Bot Builder'), routes.bot_builder)],
    },
    {
        id: 'risk',
        keywords: [
            'risk',
            'risk calculator',
            'position size',
            'how much should i stake',
            'lot',
            'martingale',
            'stake plan',
        ],
        answer: () =>
            localize(
                'The Risk calculator works out your position size and a sensible stake from your balance and the percentage you are willing to risk. It also shows how many losing trades in a row a Martingale-style plan can survive, which is usually fewer than people expect.'
            ),
        actions: () => [go(localize('Open Risk calculator'), routes.risk_calculator)],
    },
    {
        id: 'news',
        keywords: [
            'news',
            'headlines',
            'market news',
            'alert',
            'alerts',
            'notification',
            'notifications',
            'handout',
            'recommendation',
            'recommendations',
        ],
        answer: () =>
            localize(
                'The News page lists recent headlines from public news sites, tags the ones that can move markets, and gives tips on staying safe around them. You can switch pop-up alerts on or off there, and print a one-page handout. News is information, not advice.'
            ),
        actions: () => [go(localize('Open News'), routes.news)],
    },
    {
        id: 'copy',
        keywords: ['copy', 'copy trading', 'copier', 'mirror', 'follow'],
        answer: () =>
            localize(
                'Copy trading mirrors our trades on your account. Log in, set your minimum and maximum stake, accept the terms and press Start copying. You can stop at any time. Copied trades can lose, so use limits you are comfortable with.'
            ),
        actions: () => [go(localize('Open Copy trading'), routes.copy_trading)],
    },
    {
        id: 'positions',
        keywords: ['positions', 'open trades', 'open contracts', 'open position', 'running trades'],
        answer: () =>
            localize(
                'Positions lists your open contracts. Open one to follow it or close it early where that is allowed.'
            ),
        actions: () => [go(localize('Open Positions'), routes.trader_positions)],
    },
    {
        id: 'reports',
        keywords: ['report', 'reports', 'statement', 'history', 'profit table', 'past trades', 'download'],
        answer: () =>
            localize(
                'Reports has your statement and trade history. In the Bot Builder, the Transactions tab also lets you download that bot’s trades as a CSV file.'
            ),
        actions: () => [go(localize('Open Reports'), routes.reports)],
    },
    {
        id: 'guarantee',
        keywords: [
            'guarantee',
            'guaranteed',
            'sure win',
            'always win',
            'never lose',
            'profit',
            'make money',
            'win rate',
            'best strategy',
            'safe',
        ],
        answer: () =>
            localize(
                'No bot, strategy or copy trader can guarantee profit, and nobody can promise you will not lose. Trading can lose money quickly. Practise on a demo account, use the Risk calculator, set a stop loss, and never stake money you cannot afford to lose.'
            ),
        actions: () => [go(localize('Open Risk calculator'), routes.risk_calculator)],
    },
    {
        id: 'where',
        keywords: ['where am i', 'this page', 'what is this', 'what can i do here', 'current page'],
        answer: ({ pathname }) => {
            if (pathname.startsWith(routes.bot_builder))
                return localize('You are in the Bot Builder: build, import and run trading bots.');
            if (pathname.startsWith(routes.dashboard))
                return localize('You are on the dashboard: your balance, account type and shortcuts to every tool.');
            if (pathname.startsWith(routes.markets))
                return localize(
                    'You are on Markets: live prices, top movers, volatility, a scanner to filter the list, and your watchlist. Pick a market, then open it on Trade or in the Bot Builder.'
                );
            if (pathname.startsWith(routes.charts))
                return localize('You are on Charts: live charts with indicators and drawing tools.');
            if (pathname.startsWith(routes.risk_calculator))
                return localize('You are on the Risk calculator: position size and stake planning.');
            if (pathname.startsWith(routes.copy_trading))
                return localize('You are on Copy trading: mirror our trades on your account.');
            if (pathname.startsWith('/reports'))
                return localize('You are in Reports: your statement and trade history.');
            return localize('You are on the Trade page: choose a market and a contract and place a trade.');
        },
    },
];

export const SUGGESTED_QUESTIONS = () => [
    localize('How do I start trading?'),
    localize('What is the Bot Builder?'),
    localize('How do I import a bot?'),
    localize('Demo or real account?'),
    localize('How do I stop losing too much?'),
    localize('Where are the ready-made bots?'),
    localize('How do I use the watchlist?'),
];

const normalise = (text: string) =>
    ` ${text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()} `;

// "stop losing too much" should reach the limits answer, "how do i start trading" the trade answer.
const SYNONYMS: [RegExp, string][] = [
    [/\bstop losing\b|\blose too much\b|\blimit (my )?loss/g, 'stop loss'],
    [/\bstart trading\b|\bhow do i trade\b/g, 'trade'],
    [/\bsign ?in\b|\blog ?in\b/g, 'log in'],
];

const scoreTopic = (text: string, topic: TTopic) =>
    topic.keywords.reduce((total, keyword) => {
        const needle = normalise(keyword);
        if (!text.includes(needle)) return total;
        // a longer phrase is a stronger signal than a single word
        return total + needle.trim().split(' ').length;
    }, 0);

export const getAssistantReply = (question: string, ctx: TAssistantContext): TAssistantReply => {
    let text = normalise(question);
    SYNONYMS.forEach(([pattern, replacement]) => {
        text = normalise(text.replace(pattern, replacement));
    });

    const scored = topics()
        .map(topic => ({ topic, score: scoreTopic(text, topic) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);
    const best = scored[0]?.topic;

    if (!best) {
        return {
            id: 'fallback',
            text: localize(
                'I did not quite get that. I can help with trading, markets and the watchlist, charts, the Bot Builder (building, importing, ready-made templates, running, limits), the risk calculator, copy trading, demo vs real accounts and your reports. Try one of the questions below.'
            ),
            actions: [],
        };
    }
    return { id: best.id, text: best.answer(ctx), actions: best.actions?.(ctx) ?? [] };
};
