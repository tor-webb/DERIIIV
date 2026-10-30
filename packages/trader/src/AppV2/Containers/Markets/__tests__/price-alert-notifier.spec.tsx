import { Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';

import { routes, WS } from '@deriv/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WATCHLIST_STORAGE_KEY } from '../markets-config';
import PriceAlertNotifier from '../price-alert-notifier';
import { ALERTS_LAST_KEY, readLastAlerts, setPriceAlertsOn, writeThresholds } from '../price-alerts';

jest.mock('@deriv-com/translations', () => ({
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

jest.mock('@deriv/shared', () => ({
    ...jest.requireActual('@deriv/shared'),
    WS: { getTicksHistory: jest.fn(), subscribeTicks: jest.fn() },
}));

const getTicksHistory = WS.getTicksHistory as jest.Mock;
const subscribeTicks = WS.subscribeTicks as jest.Mock;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** 60 one-minute candles ending now, closing from `start` up to `end`. */
const candles = (start: number, end: number) => {
    const now = nowSeconds();
    return {
        pip_size: 2,
        candles: Array.from({ length: 60 }, (_unused, index) => {
            const close = start + ((end - start) * index) / 59;
            return { epoch: now - (59 - index) * 60, open: close, high: close, low: close, close };
        }),
    };
};

let sendTick: (quote: number, epoch?: number) => void;
const unsubscribe = jest.fn();

const watch = (symbol: string, threshold: number) => {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify([symbol]));
    writeThresholds({ [symbol]: threshold });
};

const renderNotifier = () => {
    const history = createMemoryHistory();
    const view = render(
        <Router history={history}>
            <PriceAlertNotifier />
        </Router>
    );
    return { history, ...view };
};

describe('<PriceAlertNotifier />', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        sendTick = () => undefined;
        subscribeTicks.mockImplementation((_symbol: string, callback: (response: unknown) => void) => {
            sendTick = (quote, epoch = nowSeconds()) => callback({ tick: { quote, epoch } });
            return { unsubscribe };
        });
    });

    it('does nothing at all when no market has an alert', () => {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_50']));
        renderNotifier();
        expect(getTicksHistory).not.toHaveBeenCalled();
        expect(screen.queryByTestId('dt_price_alerts')).not.toBeInTheDocument();
    });

    it('ignores a threshold on a market that is not starred', () => {
        writeThresholds({ R_50: 1 });
        renderNotifier();
        expect(getTicksHistory).not.toHaveBeenCalled();
    });

    it('does nothing while alerts are switched off', () => {
        watch('R_50', 1);
        setPriceAlertsOn(false);
        renderNotifier();
        expect(getTicksHistory).not.toHaveBeenCalled();
    });

    it('shows an alert when the hour has already moved past the threshold', async () => {
        watch('R_50', 1);
        getTicksHistory.mockResolvedValue(candles(100, 102));
        renderNotifier();
        const alert = await screen.findByTestId('dt_price_alerts');
        expect(alert).toHaveTextContent('Price alert · Volatility 50 Index');
        expect(alert).toHaveTextContent('Up 2.00% in the last hour. Now 102.');
        expect(getTicksHistory).toHaveBeenCalledWith(
            expect.objectContaining({ ticks_history: 'R_50', style: 'candles', granularity: 60, count: 60 })
        );
    });

    it('says "down" for a fall', async () => {
        watch('R_50', 1);
        getTicksHistory.mockResolvedValue(candles(100, 97));
        renderNotifier();
        expect(await screen.findByTestId('dt_price_alerts')).toHaveTextContent('Down 3.00% in the last hour.');
    });

    it('stays quiet below the threshold, then alerts when a live tick crosses it', async () => {
        watch('R_50', 1);
        getTicksHistory.mockResolvedValue(candles(100, 100.5));
        renderNotifier();
        await waitFor(() => expect(subscribeTicks).toHaveBeenCalled());
        expect(screen.queryByTestId('dt_price_alerts')).not.toBeInTheDocument();
        act(() => sendTick(101.5));
        expect(await screen.findByTestId('dt_price_alerts')).toHaveTextContent('Up 1.50%');
    });

    it('alerts once an hour per market, even as the price keeps moving', async () => {
        watch('R_50', 1);
        getTicksHistory.mockResolvedValue(candles(100, 100.5));
        renderNotifier();
        await waitFor(() => expect(subscribeTicks).toHaveBeenCalled());
        act(() => sendTick(101.5));
        await screen.findByTestId('dt_price_alerts');
        fireEvent.click(screen.getByTestId('dt_price_alert_close'));
        expect(screen.queryByTestId('dt_price_alerts')).not.toBeInTheDocument();
        act(() => sendTick(103, nowSeconds() + 10));
        act(() => sendTick(104, nowSeconds() + 20));
        expect(screen.queryByTestId('dt_price_alerts')).not.toBeInTheDocument();
        expect(readLastAlerts().R_50).toBeGreaterThan(0);
    });

    it('does not repeat an alert after the page is reloaded', async () => {
        watch('R_50', 1);
        localStorage.setItem(ALERTS_LAST_KEY, JSON.stringify({ R_50: Date.now() - 5 * 60 * 1000 }));
        getTicksHistory.mockResolvedValue(candles(100, 105));
        renderNotifier();
        await waitFor(() => expect(subscribeTicks).toHaveBeenCalled());
        expect(screen.queryByTestId('dt_price_alerts')).not.toBeInTheDocument();
    });

    it('does not alert for a market that has closed (old prices)', async () => {
        watch('R_50', 1);
        const stale = candles(100, 110);
        stale.candles = stale.candles.map(candle => ({ ...candle, epoch: candle.epoch - 3 * 3600 }));
        getTicksHistory.mockResolvedValue(stale);
        renderNotifier();
        await waitFor(() => expect(subscribeTicks).toHaveBeenCalled());
        expect(screen.queryByTestId('dt_price_alerts')).not.toBeInTheDocument();
    });

    it('starts watching when an alert is chosen while the site is open, and stops when it is removed', async () => {
        getTicksHistory.mockResolvedValue(candles(100, 100.2));
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_50']));
        renderNotifier();
        expect(getTicksHistory).not.toHaveBeenCalled();
        act(() => writeThresholds({ R_50: 1 }));
        await waitFor(() => expect(subscribeTicks).toHaveBeenCalledTimes(1));
        act(() => writeThresholds({}));
        await waitFor(() => expect(unsubscribe).toHaveBeenCalled());
    });

    it('keeps going when one market cannot be loaded', async () => {
        localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(['R_50', 'R_100']));
        writeThresholds({ R_50: 1, R_100: 1 });
        getTicksHistory.mockRejectedValueOnce(new Error('no data')).mockResolvedValueOnce(candles(100, 103));
        renderNotifier();
        expect(await screen.findByTestId('dt_price_alerts')).toHaveTextContent('Volatility 100 Index');
    });

    it('opens the Markets page from the alert', async () => {
        watch('R_50', 1);
        getTicksHistory.mockResolvedValue(candles(100, 102));
        const { history } = renderNotifier();
        fireEvent.click(await screen.findByTestId('dt_price_alert_open'));
        expect(history.location.pathname).toBe(routes.markets);
        expect(screen.queryByTestId('dt_price_alerts')).not.toBeInTheDocument();
    });

    it('goes away by itself, and stops following prices when it unmounts', async () => {
        jest.useFakeTimers();
        try {
            watch('R_50', 1);
            getTicksHistory.mockResolvedValue(candles(100, 102));
            const { unmount } = renderNotifier();
            await act(async () => {
                await Promise.resolve();
                await Promise.resolve();
            });
            expect(screen.getByTestId('dt_price_alerts')).toBeInTheDocument();
            act(() => {
                jest.advanceTimersByTime(14001);
            });
            expect(screen.queryByTestId('dt_price_alerts')).not.toBeInTheDocument();
            unmount();
            expect(unsubscribe).toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it('describes a move that happened and never tells anyone to trade', async () => {
        watch('R_50', 1);
        getTicksHistory.mockResolvedValue(candles(100, 102));
        renderNotifier();
        const alert = await screen.findByTestId('dt_price_alerts');
        expect(alert).not.toHaveTextContent(/buy|sell|opportunity|signal|guarantee/i);
    });
});
