// Pulls headlines from public RSS feeds and writes news.json (title, link, short summary, source). The app links out to
// the publisher for the full story; nothing is copied beyond a short snippet. Run by .github/workflows/update_news.yml.
'use strict';

const fs = require('fs');
const path = require('path');

const { parseFeed } = require('./parse-feed');

const BROWSER_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const FEEDS = [
    { source: 'investingLive', category: 'forex', url: 'https://investinglive.com/feed', ua: BROWSER_UA },
    { source: 'Federal Reserve', category: 'economy', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
    { source: 'ECB', category: 'economy', url: 'https://www.ecb.europa.eu/rss/press.html' },
    { source: 'Bank of England', category: 'economy', url: 'https://www.bankofengland.co.uk/rss/news' },
    { source: 'Cointelegraph', category: 'crypto', url: 'https://cointelegraph.com/rss' },
    { source: 'BBC Business', category: 'economy', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
    { source: 'CNBC Finance', category: 'markets', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664' },
    { source: 'The Guardian Business', category: 'economy', url: 'https://www.theguardian.com/business/rss' },
];

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 80;
const PER_FEED = 12;

const hash = text => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return h.toString(36);
};

const fetchFeed = async feed => {
    const response = await fetch(feed.url, {
        headers: { 'User-Agent': feed.ua || 'FiscoFX-news-bot/1.0 (+https://github.com/tor-webb/DERIIIV)', Accept: 'application/rss+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseFeed(await response.text(), PER_FEED).map(item => ({ ...item, source: feed.source, category: feed.category }));
};

const main = async () => {
    const out = process.argv[2] || 'news.json';
    const results = await Promise.allSettled(FEEDS.map(fetchFeed));
    const now = Date.now();
    const seen = new Set();
    const items = [];

    const sources = {};
    results.forEach((result, i) => {
        const name = FEEDS[i].source;
        if (result.status === 'rejected') {
            const why = String(result.reason?.cause?.code || result.reason?.message || result.reason);
            console.warn(`Feed failed: ${name} (${FEEDS[i].url}): ${why}`);
            sources[`${name} ${new URL(FEEDS[i].url).pathname}`] = `error: ${why}`;
            return;
        }
        console.log(`${name}: ${result.value.length} items`);
        sources[`${name} ${new URL(FEEDS[i].url).pathname}`] = result.value.length;
        for (const item of result.value) {
            const time = item.published ? Date.parse(item.published) : now;
            if (now - time > MAX_AGE_MS || seen.has(item.link)) continue;
            seen.add(item.link);
            items.push({ id: hash(item.link), ...item, published: item.published || new Date(now).toISOString() });
        }
    });

    if (items.length === 0) {
        console.error('No items from any feed; leaving the existing file untouched.');
        process.exit(1);
    }

    items.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
    const payload = { updated: new Date(now).toISOString(), sources, items: items.slice(0, MAX_ITEMS) };
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 1)}\n`);
    console.log(`Wrote ${payload.items.length} items to ${out}`);
};

main();
