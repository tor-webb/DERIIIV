import {
    areAlertsOn,
    countUnread,
    getRecommendations,
    getTags,
    isHighImpact,
    loadNews,
    parseFeed,
    pickAlerts,
    resetNewsCache,
    STORAGE_ALERTS_OFF,
    STORAGE_VIEWED,
    TNewsFeed,
    TNewsItem,
} from '../news-utils';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_m, key) => String(values[key])) : text,
}));

const NOW = Date.parse('2026-10-27T12:00:00Z');
const ago = (hours: number) => new Date(NOW - hours * 3600000).toISOString();

const item = (id: string, title: string, hours = 1, summary = ''): TNewsItem => ({
    id,
    title,
    summary,
    link: `https://example.com/${id}`,
    source: 'Example',
    category: 'markets',
    published: ago(hours),
});

describe('tags', () => {
    it('finds the topics a headline is about', () => {
        expect(getTags(item('a', 'Fed holds interest rates as inflation cools'))).toEqual(
            expect.arrayContaining(['rates', 'inflation'])
        );
        expect(getTags(item('b', 'Bitcoin steadies above support'))).toContain('crypto');
        expect(getTags(item('c', 'A quiet day in the garden'))).toEqual([]);
    });

    it('marks only market-moving topics as high impact', () => {
        expect(isHighImpact(item('a', 'Oil jumps after OPEC meeting'))).toBe(true);
        expect(isHighImpact(item('b', 'Bitcoin steadies above support'))).toBe(false);
    });
});

describe('parseFeed', () => {
    it('keeps good items and drops malformed or unsafe ones', () => {
        const feed = parseFeed({
            updated: ago(0),
            items: [
                {
                    id: '1',
                    title: 'Good',
                    link: 'https://example.com/1',
                    published: ago(1),
                    source: 'S',
                    category: 'forex',
                },
                { id: '2', title: 'Bad link', link: 'javascript:alert(1)', published: ago(1) },
                { id: '3', title: 'No date', link: 'https://example.com/3' },
                null,
            ],
        });
        expect(feed?.items.map(i => i.id)).toEqual(['1']);
    });

    it('returns null for anything that is not a feed', () => {
        expect(parseFeed(null)).toBeNull();
        expect(parseFeed({ items: 'nope' })).toBeNull();
    });
});

describe('loadNews', () => {
    beforeEach(() => resetNewsCache());
    afterEach(() => {
        // @ts-expect-error cleaning up the test double
        delete global.fetch;
    });

    it('returns null instead of throwing when the network fails', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
        await expect(loadNews(true)).resolves.toBeNull();
    });

    it('returns null when fetch does not exist', async () => {
        await expect(loadNews(true)).resolves.toBeNull();
    });

    it('shares one request and does not cache a failure', async () => {
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({ ok: false })
            .mockResolvedValue({ ok: true, json: async () => ({ updated: ago(0), items: [] }) });
        expect(await loadNews(true)).toBeNull();
        expect(await loadNews()).not.toBeNull(); // retried because the failure was not kept
        await loadNews();
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});

describe('pickAlerts', () => {
    const feed: TNewsFeed = {
        updated: ago(0),
        items: [
            item('new-rates', 'Bank of England cuts interest rates', 1),
            item('old-rates', 'Fed hints at rate decision', 10),
            item('new-crypto', 'Bitcoin steadies', 1),
            item('seen-oil', 'Oil jumps on OPEC cut', 1),
        ],
    };

    it('stays quiet on the very first visit', () => {
        expect(pickAlerts(feed, null, NOW)).toEqual([]);
    });

    it('alerts only for new, recent, market-moving headlines', () => {
        const ids = pickAlerts(feed, ['seen-oil'], NOW).map(i => i.id);
        expect(ids).toEqual(['new-rates']);
    });

    it('never returns more than the maximum', () => {
        const many: TNewsFeed = {
            updated: ago(0),
            items: ['a', 'b', 'c', 'd'].map(id => item(id, 'Inflation report due', 1)),
        };
        expect(pickAlerts(many, [], NOW)).toHaveLength(2);
    });
});

describe('recommendations', () => {
    it('leads with what the latest headlines are about and cites a headline', () => {
        const feed: TNewsFeed = {
            updated: ago(0),
            items: [
                item('1', 'Central bank decision due Thursday', 2),
                item('2', 'Fed officials split on interest rates', 3),
                item('3', 'Bitcoin steadies', 2),
            ],
        };
        const recs = getRecommendations(feed, NOW);
        expect(recs[0].id).toBe('rates');
        expect(recs[0].because?.id).toBeDefined();
        expect(recs.length).toBeLessThanOrEqual(4);
    });

    it('falls back to everyday habits with no feed, and never predicts prices', () => {
        const recs = getRecommendations(null, NOW);
        expect(recs.map(r => r.id)).toEqual(['demo', 'limit']);
        recs.forEach(r => expect(r.text).not.toMatch(/will (rise|fall|go up|go down)|guarantee|buy now|sell now/i));
    });

    it('ignores headlines older than two days', () => {
        const feed: TNewsFeed = { updated: ago(0), items: [item('1', 'Interest rates decision', 80)] };
        expect(getRecommendations(feed, NOW)[0].id).toBe('demo');
    });
});

describe('storage helpers', () => {
    afterEach(() => window.localStorage.clear());

    it('shows no unread badge until the page has been opened once', () => {
        const feed: TNewsFeed = { updated: ago(0), items: [item('1', 'Inflation data', 1)] };
        expect(countUnread(feed)).toBe(0);
        window.localStorage.setItem(STORAGE_VIEWED, String(NOW - 5 * 3600000));
        expect(countUnread(feed)).toBe(1);
    });

    it('treats alerts as on unless switched off', () => {
        expect(areAlertsOn()).toBe(true);
        window.localStorage.setItem(STORAGE_ALERTS_OFF, '1');
        expect(areAlertsOn()).toBe(false);
    });
});
