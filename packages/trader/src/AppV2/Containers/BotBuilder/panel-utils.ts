import { ALL_CONTRACT_OPTIONS, MARKETS } from './blocks';
import type { TTransaction } from './Engine';

/** Contract types that move up (or win on a high digit) get an up arrow, the rest a down arrow. */
const UP_CONTRACTS = new Set(['CALL', 'CALLE', 'DIGITOVER', 'DIGITMATCH', 'DIGITEVEN', 'ONETOUCH', 'EXPIRYRANGE']);

/** `Rise` for `CALL`, `Even` for `DIGITEVEN`, and so on. Unknown types are shown as they come. */
export const getContractLabel = (contract_type: string): string =>
    ALL_CONTRACT_OPTIONS.find(([, value]) => value === contract_type)?.[0] ?? contract_type;

export const isUpContract = (contract_type: string): boolean => UP_CONTRACTS.has(contract_type);

/** `Volatility 100 (1s) Index` for `1HZ100V`; the symbol itself when it is not one of ours. */
export const getSymbolLabel = (symbol: string): string => {
    const symbols = Object.values(MARKETS).flatMap(market =>
        Object.values(market.submarkets).flatMap(submarket => submarket.symbols)
    );
    return symbols.find(([, value]) => value === symbol)?.[0] ?? symbol;
};

/** The number in the round badge next to a synthetic index (`100` for Volatility 100), or an empty string. */
export const getSymbolBadge = (symbol: string): string => {
    const match = /(\d+)/.exec(getSymbolLabel(symbol));
    return match ? match[1] : '';
};

export const formatSigned = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;

const csvCell = (value: string | number) => {
    const text = String(value);
    // a leading = + - @ would make a spreadsheet run the cell as a formula
    const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The Transactions tab as CSV, oldest contract first. */
export const transactionsToCsv = (transactions: TTransaction[]): string => {
    const header = [
        'Contract ID',
        'Time',
        'Market',
        'Type',
        'Entry spot',
        'Exit spot',
        'Buy price',
        'Profit/loss',
        'Status',
    ];
    const rows = [...transactions]
        .reverse()
        .map(item =>
            [
                item.contract_id,
                item.time,
                getSymbolLabel(item.symbol),
                getContractLabel(item.contract_type),
                item.entry_spot,
                item.exit_spot,
                item.buy_price.toFixed(2),
                item.status === 'open' ? '' : item.profit.toFixed(2),
                item.status,
            ]
                .map(csvCell)
                .join(',')
        );
    return [header.join(','), ...rows].join('\n');
};
