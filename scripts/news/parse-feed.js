// Minimal RSS/Atom reader with no dependencies. Used by fetch-news.js (GitHub Actions) and its test.
'use strict';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#8217': '’', '#8216': '‘', '#8220': '“', '#8221': '”' };

const decode = text =>
    text
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&(#?\w+);/g, (m, name) => (name in ENTITIES ? ENTITIES[name] : m))
        .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)));

const stripHtml = text => decode(decode(text)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const pick = (block, tag) => {
    const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return match ? match[1] : '';
};

const pickLink = block => {
    const text = stripHtml(pick(block, 'link'));
    if (/^https?:\/\//i.test(text)) return text;
    const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
    return href ? href[1] : '';
};

const truncate = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

/** Returns [{ title, link, summary, published (ISO string) }]. Items without a title or an http(s) link are dropped. */
const parseFeed = (xml, limit = 15) => {
    const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
    const items = [];
    for (const block of blocks) {
        const title = stripHtml(pick(block, 'title'));
        const link = pickLink(block);
        if (!title || !/^https?:\/\//i.test(link)) continue;
        const date = new Date(stripHtml(pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated')));
        items.push({
            title: truncate(title, 160),
            link,
            summary: truncate(stripHtml(pick(block, 'description') || pick(block, 'summary')), 220),
            published: Number.isNaN(date.getTime()) ? null : date.toISOString(),
        });
        if (items.length >= limit) break;
    }
    return items;
};

module.exports = { parseFeed, stripHtml };
