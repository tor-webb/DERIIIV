import {
    addPoint,
    ALERT_SETTINGS_KEY,
    ALERTS_LAST_KEY,
    ALERTS_OFF_KEY,
    arePriceAlertsOn,
    COOLDOWN_MS,
    hourMove,
    makeAlert,
    MIN_SPAN_SECONDS,
    POINT_GAP_SECONDS,
    readLastAlerts,
    readThresholds,
    setPriceAlertsOn,
    shouldAlert,
    THRESHOLD_CHOICES,
    TPricePoint,
    withThreshold,
    writeLastAlerts,
    writeThresholds,
} from '../price-alerts';

const NOW = 1_000_000;

/** One price a minute for `minutes` minutes, ending at NOW, rising from `start` to `end`. */
const line = (start: number, end: number, minutes = 60): TPricePoint[] =>
    Array.from({ length: minutes + 1 }, (_unused, index) => ({
        epoch: NOW - (minutes - index) * 60,
        quote: start + ((end - start) * index) / minutes,
    }));

describe('hourMove', () => {
    it('is the signed percent change over the hour', () => {
        expect(hourMove(line(100, 102), NOW)).toEqual({ percent: 2, price: 102 });
        expect(hourMove(line(100, 97), NOW)?.percent).toBeCloseTo(-3, 9);
    });

    it('compares with the price an hour before the newest, ignoring older points', () => {
        const points = [{ epoch: NOW - 7200, quote: 50 }, ...line(100, 101)];
        expect(hourMove(points, NOW)?.percent).toBeCloseTo(1, 9);
    });

    it('cannot be judged with fewer than two prices', () => {
        expect(hourMove([], NOW)).toBeNull();
        expect(hourMove([{ epoch: NOW, quote: 1 }], NOW)).toBeNull();
    });

    it('waits until half an hour of prices is known', () => {
        expect(hourMove(line(100, 105, MIN_SPAN_SECONDS / 60 - 1), NOW)).toBeNull();
        expect(hourMove(line(100, 105, MIN_SPAN_SECONDS / 60), NOW)).not.toBeNull();
    });

    it('is null when the market has closed and its newest price is stale', () => {
        expect(hourMove(line(100, 110), NOW + 11 * 60)).toBeNull();
        expect(hourMove(line(100, 110), NOW + 9 * 60)).not.toBeNull();
    });
});

describe('shouldAlert', () => {
    const up = { percent: 1.2, price: 5 };

    it('fires when the move reaches the threshold, up or down', () => {
        expect(shouldAlert(up, 1, undefined, NOW)).toBe(true);
        expect(shouldAlert({ percent: -1.2, price: 5 }, 1, undefined, NOW)).toBe(true);
        expect(shouldAlert({ percent: 1, price: 5 }, 1, undefined, NOW)).toBe(true);
    });

    it('stays quiet below the threshold', () => {
        expect(shouldAlert({ percent: 0.99, price: 5 }, 1, undefined, NOW)).toBe(false);
        expect(shouldAlert({ percent: -0.99, price: 5 }, 1, undefined, NOW)).toBe(false);
    });

    it('stays quiet with no threshold or no move', () => {
        expect(shouldAlert(up, undefined, undefined, NOW)).toBe(false);
        expect(shouldAlert(null, 1, undefined, NOW)).toBe(false);
    });

    it('does not repeat within an hour, and may fire again after it', () => {
        expect(shouldAlert(up, 1, NOW - COOLDOWN_MS + 1, NOW)).toBe(false);
        expect(shouldAlert(up, 1, NOW - COOLDOWN_MS, NOW)).toBe(true);
    });
});

describe('addPoint', () => {
    it('keeps only the last hour', () => {
        const points = addPoint(line(1, 2), { epoch: NOW + 120, quote: 3 });
        expect(points[0].epoch).toBeGreaterThanOrEqual(NOW + 120 - 3600);
        expect(points[points.length - 1].quote).toBe(3);
    });

    it('replaces a tick that comes too soon after the last one', () => {
        const once = addPoint([{ epoch: NOW, quote: 1 }], { epoch: NOW + POINT_GAP_SECONDS - 1, quote: 2 });
        expect(once).toEqual([{ epoch: NOW + POINT_GAP_SECONDS - 1, quote: 2 }]);
        const twice = addPoint([{ epoch: NOW, quote: 1 }], { epoch: NOW + POINT_GAP_SECONDS, quote: 2 });
        expect(twice).toHaveLength(2);
    });

    it('ignores a late tick and an unusable price', () => {
        const points = [{ epoch: NOW, quote: 1 }];
        expect(addPoint(points, { epoch: NOW - 1, quote: 2 })).toBe(points);
        expect(addPoint(points, { epoch: NOW + 10, quote: NaN })).toBe(points);
        expect(addPoint(points, { epoch: NOW + 10, quote: 0 })).toBe(points);
        expect(addPoint(points, { epoch: NaN, quote: 5 })).toBe(points);
    });
});

describe('makeAlert', () => {
    it('describes the move', () => {
        expect(makeAlert('R_50', { percent: 1.5, price: 9 }, 42)).toEqual({
            id: 'R_50-42',
            symbol: 'R_50',
            percent: 1.5,
            price: 9,
            at: 42,
        });
    });
});

describe('storage', () => {
    beforeEach(() => localStorage.clear());

    it('starts with no thresholds', () => {
        expect(readThresholds()).toEqual({});
    });

    it('saves and reads thresholds', () => {
        writeThresholds({ R_50: 1, frxEURUSD: 0.25 });
        expect(readThresholds()).toEqual({ R_50: 1, frxEURUSD: 0.25 });
    });

    it('drops unknown markets and thresholds that are not on offer', () => {
        localStorage.setItem(
            ALERT_SETTINGS_KEY,
            JSON.stringify({ R_50: 1, NOPE: 1, R_100: 3, R_25: 'big', R_10: null })
        );
        expect(readThresholds()).toEqual({ R_50: 1 });
    });

    it('treats broken storage as empty', () => {
        localStorage.setItem(ALERT_SETTINGS_KEY, '{oops');
        expect(readThresholds()).toEqual({});
        localStorage.setItem(ALERT_SETTINGS_KEY, '[1,2]');
        expect(readThresholds()).toEqual({});
        localStorage.setItem(ALERT_SETTINGS_KEY, 'null');
        expect(readThresholds()).toEqual({});
        const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(readThresholds()).toEqual({});
        expect(readLastAlerts()).toEqual({});
        expect(arePriceAlertsOn()).toBe(true);
        spy.mockRestore();
    });

    it('does not throw when storage refuses a write', () => {
        const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        expect(() => writeThresholds({ R_50: 1 })).not.toThrow();
        expect(() => writeLastAlerts({ R_50: 5 })).not.toThrow();
        expect(() => setPriceAlertsOn(false)).not.toThrow();
        spy.mockRestore();
    });

    it('sets and clears a threshold without changing the original', () => {
        const original = { R_50: 1 };
        expect(withThreshold(original, 'R_25', 2)).toEqual({ R_50: 1, R_25: 2 });
        expect(withThreshold(original, 'R_50', null)).toEqual({});
        expect(original).toEqual({ R_50: 1 });
    });

    it('refuses a threshold that is not offered or a market that is not listed', () => {
        expect(withThreshold({}, 'R_50', 3)).toEqual({});
        expect(withThreshold({ R_50: 1 }, 'R_50', 3)).toEqual({});
        expect(withThreshold({}, 'NOPE', 1)).toEqual({});
    });

    it('offers only thresholds that are accepted back', () => {
        THRESHOLD_CHOICES.forEach(choice => expect(withThreshold({}, 'R_50', choice)).toEqual({ R_50: choice }));
    });

    it('is on until switched off, and back on when switched on', () => {
        expect(arePriceAlertsOn()).toBe(true);
        setPriceAlertsOn(false);
        expect(localStorage.getItem(ALERTS_OFF_KEY)).toBe('1');
        expect(arePriceAlertsOn()).toBe(false);
        setPriceAlertsOn(true);
        expect(arePriceAlertsOn()).toBe(true);
    });

    it('remembers when each market last alerted, and ignores nonsense', () => {
        writeLastAlerts({ R_50: 123 });
        expect(readLastAlerts()).toEqual({ R_50: 123 });
        localStorage.setItem(ALERTS_LAST_KEY, JSON.stringify({ R_50: 5, NOPE: 5, R_25: 'x', R_10: -1, R_75: 0 }));
        expect(readLastAlerts()).toEqual({ R_50: 5 });
        localStorage.setItem(ALERTS_LAST_KEY, '"text"');
        expect(readLastAlerts()).toEqual({});
    });
});
