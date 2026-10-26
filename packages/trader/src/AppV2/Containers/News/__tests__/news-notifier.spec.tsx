import { MemoryRouter, Route } from 'react-router-dom';

import { fireEvent, render, screen } from '@testing-library/react';

import { resetNewsCache, STORAGE_ALERTS_OFF, STORAGE_SEEN } from '../news-utils';
import NewsNotifier from '../news-notifier';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, string | number>) =>
        values ? text.replace(/{{(\w+)}}/g, (_m, key) => String(values[key])) : text,
}));

const iso = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
const entry = (id: string, title: string) => ({
    id,
    title,
    link: `https://example.com/${id}`,
    summary: '',
    source: 'Example',
    category: 'economy',
    published: iso(1),
});

const FEED = {
    updated: iso(0),
    items: [entry('rates', 'Bank cuts interest rates'), entry('crypto', 'Bitcoin steadies')],
};

const renderNotifier = (path = '/dashboard') =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <NewsNotifier />
            <Route path='*' render={({ location }) => <span data-testid='dt_location'>{location.pathname}</span>} />
        </MemoryRouter>
    );

describe('<NewsNotifier />', () => {
    beforeEach(() => {
        resetNewsCache();
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => FEED });
    });
    afterEach(() => {
        window.localStorage.clear();
        // @ts-expect-error cleaning up the test double
        delete global.fetch;
    });

    it('does not pop up on the very first visit, but remembers what exists', async () => {
        renderNotifier();
        await screen.findByTestId('dt_location');
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(screen.queryByTestId('dt_news_notifier')).not.toBeInTheDocument();
        expect(JSON.parse(window.localStorage.getItem(STORAGE_SEEN) as string)).toEqual(
            expect.arrayContaining(['rates', 'crypto'])
        );
    });

    it('shows a new market-moving headline and opens the News page from it', async () => {
        window.localStorage.setItem(STORAGE_SEEN, JSON.stringify(['crypto']));
        renderNotifier();
        const popup = await screen.findByTestId('dt_news_notifier');
        expect(popup).toHaveTextContent('Bank cuts interest rates');
        expect(popup).not.toHaveTextContent('Bitcoin steadies');
        fireEvent.click(screen.getByTestId('dt_news_notifier_open'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/news');
        expect(screen.queryByTestId('dt_news_notifier')).not.toBeInTheDocument();
    });

    it('can be dismissed', async () => {
        window.localStorage.setItem(STORAGE_SEEN, JSON.stringify([]));
        renderNotifier();
        await screen.findByTestId('dt_news_notifier');
        fireEvent.click(screen.getByTestId('dt_news_notifier_close'));
        expect(screen.queryByTestId('dt_news_notifier')).not.toBeInTheDocument();
    });

    it('stays silent when the person turned alerts off', async () => {
        window.localStorage.setItem(STORAGE_SEEN, JSON.stringify([]));
        window.localStorage.setItem(STORAGE_ALERTS_OFF, '1');
        renderNotifier();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(screen.queryByTestId('dt_news_notifier')).not.toBeInTheDocument();
    });

    it('stays silent on the News page itself', async () => {
        window.localStorage.setItem(STORAGE_SEEN, JSON.stringify([]));
        renderNotifier('/news');
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(screen.queryByTestId('dt_news_notifier')).not.toBeInTheDocument();
    });
});
