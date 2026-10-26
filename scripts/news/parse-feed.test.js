'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parseFeed } = require('./parse-feed');

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Fed holds rates &amp; signals patience]]></title><link>https://example.com/a</link>
<description>&lt;p&gt;The central bank kept rates &lt;b&gt;unchanged&lt;/b&gt;.&lt;/p&gt;</description><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>No link here</title><description>skipped</description></item>
<item><title>Javascript link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

const ATOM = `<feed><entry><title>Bitcoin steadies</title><link href="https://example.com/b"/><summary>Calm day</summary><updated>2026-10-26T08:00:00Z</updated></entry></feed>`;

test('reads RSS items, decodes entities and strips HTML', () => {
    const items = parseFeed(RSS);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Fed holds rates & signals patience');
    assert.equal(items[0].summary, 'The central bank kept rates unchanged .');
    assert.equal(items[0].published, '2026-10-26T10:00:00.000Z');
});

test('drops items with a missing or non-http link', () => {
    assert.ok(parseFeed(RSS).every(i => /^https?:\/\//.test(i.link)));
});

test('reads Atom entries', () => {
    const [item] = parseFeed(ATOM);
    assert.equal(item.link, 'https://example.com/b');
    assert.equal(item.published, '2026-10-26T08:00:00.000Z');
});

test('truncates long titles and respects the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => `<item><title>${'x'.repeat(300)}${i}</title><link>https://e.com/${i}</link></item>`).join('');
    const items = parseFeed(`<rss>${many}</rss>`, 5);
    assert.equal(items.length, 5);
    assert.ok(items[0].title.length <= 160);
});
