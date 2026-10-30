import { routes } from '@deriv/shared';
import { localize } from '@deriv-com/translations';

/*
 * News feed logic. Headlines come from news.json, which the "Update news feed" GitHub workflow rewrites every 30
 * minutes from public RSS feeds (scripts/news/). The app only links out to the publisher. Recommendations and alerts are
 * plain keyword rules: they point to the right tool or habit and never say what a price will do.
 */

export const NEWS_URL = 'https://raw.githubusercontent.com/tor-webb/DERIIIV/news-data/news.json';

export const STORAGE_SEEN = 'fiscofx_news_seen';
export const STORAGE_VIEWED = 'fiscofx_news_viewed';
export const STORAGE_ALERTS_OFF = 'fiscofx_news_alerts_off';

export const HOUR_MS = 60 * 60 * 1000;
export const STALE_AFTER_MS = 3 * HOUR_MS;
const ALERT_MAX_AGE_MS = 6 * HOUR_MS;

export type TNewsItem = {
    id: string;
    title: string;
    link: string;
    summary: string;
    source: string;
    category: string;
    published: string;
};

export type TNewsFeed = { updated: string; items: TNewsItem[] };

export type TTagId =
    | 'rates'
    | 'inflation'
    | 'jobs'
    | 'energy'
    | 'geopolitics'
    | 'crypto'
    | 'stocks'
    | 'gold'
    | 'currency';

const TAG_RULES: { id: TTagId; pattern: RegExp; high_impact: boolean }[] = [
    {
        id: 'rates',
        pattern:
            /\b(rate (cut|hike|decision|rise)s?|interest rates?|central bank|fed|federal reserve|fomc|ecb|bank of england|boe|bank of japan|boj|rba|snb|powell|lagarde)\b/i,
        high_impact: true,
    },
    { id: 'inflation', pattern: /\b(inflation|cpi|consumer prices?|ppi|price growth)\b/i, high_impact: true },
    {
        id: 'jobs',
        pattern: /\b(jobs report|payrolls?|nonfarm|unemployment|jobless|employment|labou?r market)\b/i,
        high_impact: true,
    },
    { id: 'energy', pattern: /\b(oil|crude|opec|brent|natural gas|energy prices?)\b/i, high_impact: true },
    {
        id: 'geopolitics',
        pattern: /\b(war|sanctions?|tariffs?|trade deal|election|conflict|ceasefire|missile|strike|shutdown)\b/i,
        high_impact: true,
    },
    {
        id: 'crypto',
        pattern: /\b(bitcoin|btc|ethereum|ether|crypto\w*|stablecoin|altcoin|solana|xrp)\b/i,
        high_impact: false,
    },
    {
        id: 'stocks',
        pattern: /\b(stocks?|shares|earnings|s&p|nasdaq|dow jones|wall street|ftse)\b/i,
        high_impact: false,
    },
    { id: 'gold', pattern: /\b(gold|silver|bullion)\b/i, high_impact: false },
    {
        id: 'currency',
        pattern: /\b(dollar|usd|euro|eur|sterling|pound|yen|forex|currency|currencies)\b/i,
        high_impact: false,
    },
];

export const getTags = (item: Pick<TNewsItem, 'title' | 'summary'>): TTagId[] => {
    const text = `${item.title} ${item.summary}`;
    return TAG_RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.id);
};

export const isHighImpact = (item: Pick<TNewsItem, 'title' | 'summary'>) =>
    TAG_RULES.some(rule => rule.high_impact && rule.pattern.test(`${item.title} ${item.summary}`));

export const getTagLabel = (id: TTagId) =>
    ({
        rates: localize('Interest rates'),
        inflation: localize('Inflation'),
        jobs: localize('Jobs'),
        energy: localize('Oil and energy'),
        geopolitics: localize('World events'),
        crypto: localize('Crypto'),
        stocks: localize('Stocks'),
        gold: localize('Gold'),
        currency: localize('Currencies'),
    })[id];

export const getCategories = () => [
    { id: 'all', label: localize('All') },
    { id: 'markets', label: localize('Markets') },
    { id: 'forex', label: localize('Forex') },
    { id: 'crypto', label: localize('Crypto') },
    { id: 'economy', label: localize('Economy') },
];

const isHttpUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//i.test(value);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

/** Accepts only well-formed items, so a broken or tampered feed can never put odd values on the page. */
export const parseFeed = (data: unknown): TNewsFeed | null => {
    const raw = data as { updated?: unknown; items?: unknown } | null;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
    const updated = typeof raw.updated === 'string' && !Number.isNaN(Date.parse(raw.updated)) ? raw.updated : '';
    const items = raw.items
        .map((entry: Record<string, unknown>) => ({
            id: text(entry?.id, 40),
            title: text(entry?.title, 200),
            link: isHttpUrl(entry?.link) ? entry.link : '',
            summary: text(entry?.summary, 300),
            source: text(entry?.source, 60),
            category: text(entry?.category, 20),
            published:
                typeof entry?.published === 'string' && !Number.isNaN(Date.parse(entry.published))
                    ? entry.published
                    : '',
        }))
        .filter(item => item.id && item.title && item.link && item.published);
    return { updated, items };
};

let cached: { at: number; promise: Promise<TNewsFeed | null> } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/** One shared request for the page, the notifier and the tab badge. Resolves to null when the feed is not reachable. */
export const loadNews = (force = false): Promise<TNewsFeed | null> => {
    if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.promise;
    const promise = Promise.resolve()
        .then(() => fetch(NEWS_URL, { cache: 'no-cache' }))
        .then(response => (response.ok ? response.json() : null))
        .then(parseFeed)
        .catch(() => null);
    cached = { at: Date.now(), promise };
    promise.then(feed => {
        if (!feed && cached?.promise === promise) cached = null; // do not cache a failure
    });
    return promise;
};

export const resetNewsCache = () => {
    cached = null;
};

export const timeAgo = (iso: string, now = Date.now()) => {
    const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
    if (minutes < 1) return localize('just now');
    if (minutes < 60) return localize('{{count}} min ago', { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return localize('{{count}} h ago', { count: hours });
    return localize('{{count}} d ago', { count: Math.round(hours / 24) });
};

/* ---------- Storage (all wrapped: private windows and blocked storage must not break the page) ---------- */

export const readStore = (key: string): string | null => {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
};

export const writeStore = (key: string, value: string | null) => {
    try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
    } catch {
        /* storage unavailable: carry on without remembering */
    }
};

export const readSeen = (): string[] | null => {
    const stored = readStore(STORAGE_SEEN);
    if (stored === null) return null;
    try {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : null;
    } catch {
        return null;
    }
};

export const writeSeen = (ids: string[]) => writeStore(STORAGE_SEEN, JSON.stringify(ids.slice(0, 200)));

export const areAlertsOn = () => readStore(STORAGE_ALERTS_OFF) !== '1';

/**
 * True when every word typed appears in the headline, summary, source or category (ignoring case). An empty search
 * matches everything.
 */
export const matchesNewsSearch = (item: TNewsItem, query: string): boolean => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const text = `${item.title} ${item.summary} ${item.source} ${item.category}`.toLowerCase();
    return words.every(word => text.includes(word));
};

/**
 * True when the headline was published after the page was last opened. A person who has never opened the page sees
 * nothing marked, so a first visit is not a wall of "New" labels (the same rule the unread badge follows).
 */
export const isNewSince = (item: TNewsItem, viewed_ms: number): boolean => {
    if (!viewed_ms) return false;
    const published = Date.parse(item.published);
    return Number.isFinite(published) && published > viewed_ms;
};

export const countUnread = (feed: TNewsFeed | null) => {
    if (!feed) return 0;
    const viewed = Number(readStore(STORAGE_VIEWED)) || 0;
    if (!viewed) return 0; // never opened the page: no badge, so a new visitor is not greeted by a number
    return feed.items.filter(item => Date.parse(item.published) > viewed).length;
};

/**
 * Headlines worth a pop-up: new since last time, recent, and about something that tends to move markets.
 * The first visit only records what exists, so nobody is greeted by a pile of alerts.
 */
export const pickAlerts = (feed: TNewsFeed, seen: string[] | null, now = Date.now(), max = 2): TNewsItem[] => {
    if (seen === null) return [];
    const known = new Set(seen);
    return feed.items
        .filter(
            item => !known.has(item.id) && now - Date.parse(item.published) <= ALERT_MAX_AGE_MS && isHighImpact(item)
        )
        .slice(0, max);
};

/* ---------- Recommendations ---------- */

export type TRecommendation = {
    id: string;
    title: string;
    text: string;
    action: { label: string; path: string };
    because?: TNewsItem;
};

const ADVICE: Record<TTagId, (item?: TNewsItem) => Omit<TRecommendation, 'id' | 'because'>> = {
    rates: () => ({
        title: localize('Rate news is in the headlines'),
        text: localize(
            'Central bank decisions can move currencies fast and make prices jump. Check the release time, stay out in the minutes around it, and rehearse on a demo account first.'
        ),
        action: { label: localize('Size your risk'), path: routes.risk_calculator },
    }),
    inflation: () => ({
        title: localize('Inflation figures are in focus'),
        text: localize(
            'Inflation reports often shift what traders expect from central banks. Know the release time and keep your stake small enough that one jump will not hurt.'
        ),
        action: { label: localize('Size your risk'), path: routes.risk_calculator },
    }),
    jobs: () => ({
        title: localize('Jobs data is moving the news'),
        text: localize(
            'Employment reports can swing the dollar and stock indices within seconds. If you cannot watch the screen, do not leave a trade open through the release.'
        ),
        action: { label: localize('Check what-if outcomes'), path: routes.what_if },
    }),
    energy: () => ({
        title: localize('Oil and energy are making news'),
        text: localize(
            'Energy prices affect inflation and currencies of oil exporting countries. Gaps and fast moves are common, so avoid oversized stakes.'
        ),
        action: { label: localize('Size your risk'), path: routes.risk_calculator },
    }),
    geopolitics: () => ({
        title: localize('World events are driving headlines'),
        text: localize(
            'Sudden political news makes prices unpredictable and wider than usual. Many traders simply wait until things settle. Practising on a demo account costs nothing.'
        ),
        action: { label: localize('Learn about risk'), path: routes.learn },
    }),
    crypto: () => ({
        title: localize('Crypto is active'),
        text: localize(
            'Crypto prices can swing sharply at any hour, including weekends. Read how leverage and stops work before trading it.'
        ),
        action: { label: localize('Read the lessons'), path: routes.learn },
    }),
    stocks: () => ({
        title: localize('Company earnings and stock news'),
        text: localize(
            'Earnings season can move whole indices. Look at the calendar and check how a bigger move would change your result before you trade.'
        ),
        action: { label: localize('Check what-if outcomes'), path: routes.what_if },
    }),
    gold: () => ({
        title: localize('Gold is in the news'),
        text: localize(
            'Gold often reacts to interest rates and the dollar. Watch the same scheduled releases and keep position sizes modest.'
        ),
        action: { label: localize('Open the charts'), path: routes.charts },
    }),
    currency: () => ({
        title: localize('Currencies are in focus'),
        text: localize(
            'Currency pairs react to the same few events: rate decisions, inflation and jobs. Look at the chart for the pair first and decide your limit before you trade.'
        ),
        action: { label: localize('Open the charts'), path: routes.charts },
    }),
};

const FALLBACK: TRecommendation[] = [
    {
        id: 'demo',
        title: localize('Practise on a demo account'),
        text: localize(
            'Try a news day with virtual money first. You learn how fast prices move without risking your own.'
        ),
        action: { label: localize('Open the Learn page'), path: routes.learn },
    },
    {
        id: 'limit',
        title: localize('Decide your limit before you trade'),
        text: localize('Work out the most you are happy to lose on one trade, then size the stake to that number.'),
        action: { label: localize('Size your risk'), path: routes.risk_calculator },
    },
];

/** Up to `max` recommendations, led by whatever topics the latest headlines mention most. Falls back to evergreen habits. */
export const getRecommendations = (feed: TNewsFeed | null, now = Date.now(), max = 4): TRecommendation[] => {
    const recent = (feed?.items ?? []).filter(item => now - Date.parse(item.published) <= 48 * HOUR_MS);
    const counts = new Map<TTagId, { count: number; first: TNewsItem }>();
    recent.forEach(item =>
        getTags(item).forEach(tag => {
            const entry = counts.get(tag);
            if (entry) entry.count += 1;
            else counts.set(tag, { count: 1, first: item });
        })
    );
    const fromNews = [...counts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, max)
        .map(([tag, { first }]): TRecommendation => ({ id: tag, ...ADVICE[tag](first), because: first }));
    return [...fromNews, ...FALLBACK].slice(0, max);
};

/* ---------- Handout (printed from the page) ---------- */

export const getHandoutChecklist = () => [
    localize('Know the release time of any big data or central bank decision today.'),
    localize('Decide the most you will lose on one trade before you open it.'),
    localize('Set a stop loss or a stake you can afford to lose entirely.'),
    localize('Do not trade money you need for rent, food or bills.'),
    localize('If you feel rushed or want to win back a loss, stop for the day.'),
    localize('Try the idea on a demo account first.'),
];

export const getHandoutTerms = () => [
    {
        term: localize('Rate decision'),
        meaning: localize('A central bank announces whether borrowing costs go up, down or stay.'),
    },
    {
        term: localize('Inflation (CPI)'),
        meaning: localize('How fast everyday prices are rising. Markets watch it closely.'),
    },
    { term: localize('Non-farm payrolls'), meaning: localize('A monthly US jobs report that often moves the dollar.') },
    { term: localize('Volatility'), meaning: localize('How quickly and how far a price moves. News raises it.') },
    { term: localize('Spread'), meaning: localize('The gap between buy and sell price. It can widen around news.') },
    {
        term: localize('Slippage'),
        meaning: localize('Getting a different price from the one you clicked in a fast market.'),
    },
];
