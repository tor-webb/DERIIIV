/**
 * A rough model for Touch / No Touch, to compare the price the server quotes with how likely a touch looks.
 *
 * It treats the price as a driftless random walk whose size is taken from the recent average candle range. That is an
 * estimate, not a measurement: real prices have jumps and changing volatility. A quote that differs from the model by
 * a few percent says little. The page therefore trades only when the gap is clearly above the minimum strength.
 */

/** The standard normal distribution function (Abramowitz and Stegun 7.1.26 for the error function). */
export const normalCdf = (x: number): number => {
    const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
    const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
    const erf = 1 - poly * Math.exp(-(x * x) / 2);
    return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
};

/** Standard deviation of a candle's move as a percentage of price. A candle's average range is about 1.6 of it. */
export const sigmaFromAtr = (atr_pct: number): number => atr_pct / 1.6;

/**
 * The chance the price reaches a level `distance_pct` percent away at any time within `minutes`, for a random walk
 * with a per-candle size of `sigma_pct` over candles of `candle_minutes`. This is twice the chance of finishing beyond it.
 */
export const touchProbability = (
    distance_pct: number,
    minutes: number,
    sigma_pct: number,
    candle_minutes = 5
): number => {
    if (!(distance_pct > 0) || !(minutes > 0) || !(sigma_pct > 0)) return 0;
    const horizon = sigma_pct * Math.sqrt(minutes / candle_minutes);
    return Math.min(1, 2 * (1 - normalCdf(distance_pct / horizon)));
};

/** The distance, as a percentage of price, at which a touch is about as likely as `target` (0 to 1) within `minutes`. */
export const distanceForProbability = (
    target: number,
    minutes: number,
    sigma_pct: number,
    candle_minutes = 5
): number => {
    let low = 0;
    let high = sigma_pct * Math.sqrt(minutes / candle_minutes) * 6;
    for (let step = 0; step < 40; step += 1) {
        const mid = (low + high) / 2;
        if (touchProbability(mid, minutes, sigma_pct, candle_minutes) > target) low = mid;
        else high = mid;
    }
    return (low + high) / 2;
};

export type TTouchQuote = { ask_price: number; payout: number };

export type TTouchVerdict = {
    contract_type: 'ONETOUCH' | 'NOTOUCH';
    /** The model's chance for the side chosen, and the chance implied by its price (price / payout). */
    model: number;
    implied: number;
    /** model minus implied: how much the model thinks the side is under-priced. */
    edge: number;
};

/** Compares both sides with the model and returns the one the model finds more under-priced, or null with no quote. */
export const touchVerdict = (
    model_touch: number,
    touch: TTouchQuote | null,
    no_touch: TTouchQuote | null
): TTouchVerdict | null => {
    const options: TTouchVerdict[] = [];
    if (touch && touch.payout > 0) {
        const implied = touch.ask_price / touch.payout;
        options.push({ contract_type: 'ONETOUCH', model: model_touch, implied, edge: model_touch - implied });
    }
    if (no_touch && no_touch.payout > 0) {
        const implied = no_touch.ask_price / no_touch.payout;
        options.push({ contract_type: 'NOTOUCH', model: 1 - model_touch, implied, edge: 1 - model_touch - implied });
    }
    return options.sort((a, b) => b.edge - a.edge)[0] ?? null;
};

/** Strength on the 0 to 100 scale the risk gate uses: a 5-point gap between model and quote scores 25. */
export const strengthOfEdge = (edge: number): number => Math.max(0, Math.min(100, Math.round(edge * 500)));
