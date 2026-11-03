import { localize } from '@deriv-com/translations';

/**
 * The kinds of contract the Voltrex page can analyse and trade. Rise/Fall runs through the Bot Builder engine; every
 * other kind runs through the generic executor (`voltrex-executor.ts`), which sends the proposal, buys, and follows the
 * contract to its end.
 */
export type TProductId =
    | 'rise_fall'
    | 'over_under'
    | 'match_differ'
    | 'even_odd'
    | 'touch'
    | 'accumulator'
    | 'multiplier';

export const PRODUCT_IDS: TProductId[] = [
    'rise_fall',
    'over_under',
    'match_differ',
    'even_odd',
    'touch',
    'accumulator',
    'multiplier',
];

export const productLabel = (id: TProductId): string => {
    switch (id) {
        case 'over_under':
            return localize('Over / Under');
        case 'match_differ':
            return localize('Matches / Differs');
        case 'even_odd':
            return localize('Even / Odd');
        case 'touch':
            return localize('Touch / No Touch');
        case 'accumulator':
            return localize('Accumulators');
        case 'multiplier':
            return localize('Multipliers');
        default:
            return localize('Rise / Fall');
    }
};

/** One line on what the contract pays and how it can lose, shown next to the choice. */
export const productNote = (id: TProductId): string => {
    switch (id) {
        case 'over_under':
            return localize(
                'Bet that the last digit of the price, after the ticks you choose, is over or under a digit. The payout depends on the digit: a rarer outcome pays more.'
            );
        case 'match_differ':
            return localize(
                'Matches wins if the last digit equals your digit (about 1 in 10, pays a lot). Differs wins if it does not (about 9 in 10, pays a little).'
            );
        case 'even_odd':
            return localize('Bet that the last digit of the price is even or odd after the ticks you choose.');
        case 'touch':
            return localize(
                'Touch wins if the price reaches the barrier before the contract ends; No Touch wins if it never does. A closer barrier is more likely to be touched and pays less.'
            );
        case 'accumulator':
            return localize(
                'The payout grows with every tick the price stays inside a small band. The contract ends, and the whole stake is lost, the moment a tick leaves the band. Set a take profit to close it by itself.'
            );
        case 'multiplier':
            return localize(
                'Gains and losses are multiplied. The stake is the most you can lose. A take profit and stop loss close it by themselves.'
            );
        default:
            return localize('Bet that the price will be higher (Rise) or lower (Fall) when the contract ends.');
    }
};

/** What the person (or auto-trading) chose, in the terms the server's proposal needs. */
export type TContractChoice = {
    product: TProductId;
    /** The server's contract type: CALL, PUT, DIGITOVER, DIGITUNDER, DIGITMATCH, DIGITDIFF, DIGITEVEN, DIGITODD, ONETOUCH, NOTOUCH, ACCU, MULTUP, MULTDOWN. */
    contract_type: string;
    /** Short text for lists: "Rise", "Over 4", "Touch +0.52", "Accumulator 2%", "Multiplier ×20 up". */
    label: string;
    /** Digit for the digit contracts; the offset or level for Touch / No Touch. */
    barrier?: string;
    /** Accumulators: the growth rate as a fraction (0.02 is 2%). */
    growth_rate?: number;
    /** Multipliers: the multiplier. */
    multiplier?: number;
    duration?: number;
    duration_unit?: 't' | 'm';
    /** Accumulators and multipliers: close by themselves at this profit or (multipliers) loss, in account currency. */
    take_profit?: number;
    stop_loss?: number;
};

export const DIGIT_PRODUCTS: TProductId[] = ['over_under', 'match_differ', 'even_odd'];

export const isDigitProduct = (id: TProductId) => DIGIT_PRODUCTS.includes(id);

/** The words for a digit contract, used in labels. */
export const digitLabel = (contract_type: string, barrier?: string): string => {
    switch (contract_type) {
        case 'DIGITOVER':
            return localize('Over {{digit}}', { digit: barrier ?? '' });
        case 'DIGITUNDER':
            return localize('Under {{digit}}', { digit: barrier ?? '' });
        case 'DIGITMATCH':
            return localize('Matches {{digit}}', { digit: barrier ?? '' });
        case 'DIGITDIFF':
            return localize('Differs {{digit}}', { digit: barrier ?? '' });
        case 'DIGITEVEN':
            return localize('Even');
        default:
            return localize('Odd');
    }
};

/** Builds the proposal request the server needs for a choice. */
export const buildProposal = (
    choice: TContractChoice,
    params: { symbol: string; stake: number; currency: string }
): Record<string, unknown> => {
    const request: Record<string, unknown> = {
        amount: params.stake,
        basis: 'stake',
        contract_type: choice.contract_type,
        currency: params.currency,
        underlying_symbol: params.symbol,
    };
    if (choice.product === 'accumulator') {
        request.growth_rate = choice.growth_rate;
        if (choice.take_profit) request.limit_order = { take_profit: choice.take_profit };
        return request;
    }
    if (choice.product === 'multiplier') {
        request.multiplier = choice.multiplier;
        const limit_order: Record<string, number> = {};
        if (choice.take_profit) limit_order.take_profit = choice.take_profit;
        if (choice.stop_loss) limit_order.stop_loss = choice.stop_loss;
        if (Object.keys(limit_order).length) request.limit_order = limit_order;
        return request;
    }
    request.duration = choice.duration;
    request.duration_unit = choice.duration_unit;
    if (choice.barrier !== undefined) request.barrier = choice.barrier;
    return request;
};
