import { MemoryRouter, Route } from 'react-router-dom';

import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import News from '../news';
import { resetNewsCache, STORAGE_ALERTS_OFF, STORAGE_VIEWED } from '../news-utils';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_m, key) => String(values[key])) : text,
}));

const iso = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();

const FEED = {
    updated: iso(0.2),
    items: [
        {
            id: 'a',
            title: 'Fed holds interest rates steady',
            link: 'https://example.com/a',
            summary: 'Rates unchanged.',
            source: 'FXStreet',
            category: 'forex',
            published: iso(1),
        },
        {
            id: 'b',
            title: 'Bitcoin steadies above support',
            link: 'https://example.com/b',
            summary: '',
            source: 'Cointelegraph',
            category: 'crypto',
            published: iso(2),
        },
    ],
};

const renderNews = () =>
    render(
        <StoreProvider store={mockStore({})}>
            <MemoryRouter initialEntries={['/news']}>
                <News />
                <Route path='*' render={({ location }) => <span data-testid='dt_location'>{location.pathname}</span>} />
            </MemoryRouter>
        </StoreProvider>
    );

const mockFeed = (feed: unknown) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: !!feed, json: async () => feed });
};

describe('<News />', () => {
    beforeEach(() => resetNewsCache());
    afterEach(() => {
        window.localStorage.clear();
        // @ts-expect-error cleaning up the test double
        delete global.fetch;
    });

    it('lists headlines as safe external links, with the not-advice notice', async () => {
        mockFeed(FEED);
        renderNews();
        const links = await screen.findAllByRole('link', { name: /Fed holds|Bitcoin steadies/ });
        expect(links).toHaveLength(2);
        links.forEach(link => {
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
        });
        expect(screen.getByTestId('dt_news_notice')).toHaveTextContent(/not advice/i);
    });

    it('filters by category', async () => {
        mockFeed(FEED);
        renderNews();
        await screen.findAllByTestId('dt_news_item');
        fireEvent.click(screen.getByTestId('dt_news_tab_crypto'));
        expect(screen.getAllByTestId('dt_news_item')).toHaveLength(1);
        expect(screen.getByText('Bitcoin steadies above support')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('dt_news_tab_economy'));
        expect(screen.getByTestId('dt_news_empty')).toHaveTextContent(/No headlines in this category/);
    });

    it('searches headlines, says when nothing matches, and combines with the category', async () => {
        mockFeed(FEED);
        renderNews();
        await screen.findAllByTestId('dt_news_item');
        fireEvent.change(screen.getByTestId('dt_news_search'), { target: { value: 'bitcoin' } });
        expect(screen.getAllByTestId('dt_news_item')).toHaveLength(1);
        fireEvent.change(screen.getByTestId('dt_news_search'), { target: { value: 'zzzz' } });
        expect(screen.getByTestId('dt_news_empty')).toHaveTextContent('No headlines match "zzzz".');
        fireEvent.change(screen.getByTestId('dt_news_search'), { target: { value: 'fed' } });
        fireEvent.click(screen.getByTestId('dt_news_tab_crypto'));
        expect(screen.getByTestId('dt_news_empty')).toBeInTheDocument();
    });

    it('marks headlines published since the last visit as new', async () => {
        window.localStorage.setItem(STORAGE_VIEWED, String(Date.now() - 90 * 60000));
        mockFeed(FEED);
        renderNews();
        await screen.findAllByTestId('dt_news_item');
        // "a" was published 1 hour ago (after the visit 90 minutes ago), "b" 2 hours ago (before it)
        expect(screen.getAllByTestId('dt_news_new')).toHaveLength(1);
        const [fed, bitcoin] = screen.getAllByTestId('dt_news_item');
        expect(within(fed).getByTestId('dt_news_new')).toBeInTheDocument();
        expect(within(bitcoin).queryByTestId('dt_news_new')).not.toBeInTheDocument();
    });

    it('marks nothing as new on a first visit', async () => {
        mockFeed(FEED);
        renderNews();
        await screen.findAllByTestId('dt_news_item');
        expect(screen.queryByTestId('dt_news_new')).not.toBeInTheDocument();
    });

    it('recommends tools from the headlines and opens them', async () => {
        mockFeed(FEED);
        renderNews();
        const rec = await screen.findByTestId('dt_news_rec_rates');
        expect(rec).toHaveTextContent('Because of: Fed holds interest rates steady');
        fireEvent.click(within(rec).getByRole('button', { name: 'Size your risk' }));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/risk-calculator');
    });

    it('still works when the feed cannot be loaded', async () => {
        mockFeed(null);
        renderNews();
        expect(await screen.findByTestId('dt_news_empty')).toHaveTextContent(/could not load the news feed/i);
        expect(screen.getByTestId('dt_news_recommendations')).toHaveTextContent('Practise on a demo account');
        expect(screen.getByTestId('dt_news_handout')).toHaveTextContent('Before you trade the news');
    });

    it('warns when the feed is old', async () => {
        mockFeed({ ...FEED, updated: iso(5) });
        renderNews();
        expect(await screen.findByTestId('dt_news_stale')).toBeInTheDocument();
    });

    it('switches alerts off and remembers it', async () => {
        mockFeed(FEED);
        renderNews();
        const toggle = await screen.findByTestId('dt_news_alerts_toggle');
        expect(toggle).toBeChecked();
        fireEvent.click(toggle);
        expect(toggle).not.toBeChecked();
        expect(window.localStorage.getItem(STORAGE_ALERTS_OFF)).toBe('1');
    });

    it('puts the day’s headlines in the handout and prints it', async () => {
        mockFeed(FEED);
        window.print = jest.fn();
        renderNews();
        await waitFor(() =>
            expect(screen.getByTestId('dt_news_handout')).toHaveTextContent('Fed holds interest rates steady')
        );
        fireEvent.click(screen.getByTestId('dt_news_print'));
        expect(window.print).toHaveBeenCalled();
    });
});
