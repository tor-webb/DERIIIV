import React from 'react';

import { loadNews, TNewsFeed } from './news-utils';

const POLL_MS = 15 * 60 * 1000;

/** Loads the feed once and re-checks every 15 minutes while the page is open. `feed` is null until it arrives or if it cannot. */
export const useNews = () => {
    const [feed, setFeed] = React.useState<TNewsFeed | null>(null);
    const [is_loading, setIsLoading] = React.useState(true);

    const refresh = React.useCallback(async (force = false) => {
        setIsLoading(true);
        const next = await loadNews(force);
        setFeed(previous => next ?? previous);
        setIsLoading(false);
    }, []);

    React.useEffect(() => {
        let active = true;
        const run = (force: boolean) =>
            loadNews(force).then(next => {
                if (!active) return;
                setFeed(previous => next ?? previous);
                setIsLoading(false);
            });
        run(false);
        const timer = window.setInterval(() => run(true), POLL_MS);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, []);

    return { feed, is_loading, refresh };
};
