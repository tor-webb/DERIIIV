import { formatMoney } from '@deriv/shared';

/**
 * `formatMoney(currency, amount, false)` puts the currency in as an HTML <span class="symbols usd"> string, which only
 * works when it is injected as HTML. React prints it as text, so use this plain version everywhere in AppV2:
 * "9,987.00" (amount only) or "9,987.00 USD" (with the currency code).
 */
export const formatBalance = (currency: string, amount: number | string | undefined | null) =>
    formatMoney(currency, amount ?? 0, true);

export const formatBalanceWithCurrency = (currency: string, amount: number | string | undefined | null) =>
    `${formatBalance(currency, amount)} ${currency ?? ''}`.trim();
