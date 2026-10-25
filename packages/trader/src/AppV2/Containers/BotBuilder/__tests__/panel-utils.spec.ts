import type { TTransaction } from '../Engine';
import {
    formatSigned,
    getContractLabel,
    getSymbolBadge,
    getSymbolLabel,
    isUpContract,
    transactionsToCsv,
} from '../panel-utils';

const transaction = (overrides: Partial<TTransaction> = {}): TTransaction => ({
    contract_id: 1,
    contract_type: 'CALL',
    symbol: '1HZ100V',
    buy_price: 1,
    payout: 1.95,
    profit: -1,
    entry_spot: '1061.49',
    exit_spot: '1061.15',
    status: 'lost',
    time: '10:00:00',
    ...overrides,
});

describe('panel-utils', () => {
    it('names contracts and markets the way the panel shows them', () => {
        expect(getContractLabel('CALL')).toBe('Rise');
        expect(getContractLabel('DIGITDIFF')).toBe('Differs');
        expect(getContractLabel('SOMETHING')).toBe('SOMETHING');
        expect(getSymbolLabel('1HZ100V')).toBe('Volatility 100 (1s) Index');
        expect(getSymbolLabel('unknown')).toBe('unknown');
        expect(getSymbolBadge('1HZ100V')).toBe('100');
        expect(getSymbolBadge('frxEURUSD')).toBe('');
        expect(isUpContract('CALL')).toBe(true);
        expect(isUpContract('PUT')).toBe(false);
    });

    it('signs profits', () => {
        expect(formatSigned(0.8)).toBe('+0.80');
        expect(formatSigned(-1)).toBe('-1.00');
        expect(formatSigned(0)).toBe('0.00');
    });

    it('exports the transactions as CSV, oldest first, and leaves the profit of an open contract empty', () => {
        const csv = transactionsToCsv([
            transaction({ contract_id: 2, status: 'open', profit: 0 }),
            transaction({ contract_id: 1 }),
        ]);
        const lines = csv.split('\n');
        expect(lines[0]).toBe('Contract ID,Time,Market,Type,Entry spot,Exit spot,Buy price,Profit/loss,Status');
        expect(lines[1]).toBe('1,10:00:00,Volatility 100 (1s) Index,Rise,1061.49,1061.15,1.00,-1.00,lost');
        expect(lines[2]).toBe('2,10:00:00,Volatility 100 (1s) Index,Rise,1061.49,1061.15,1.00,,open');
    });

    it('stops a spreadsheet running text as a formula', () => {
        const csv = transactionsToCsv([transaction({ symbol: '=HYPERLINK("x")' })]);
        expect(csv.split('\n')[1]).toContain(`"'=HYPERLINK(""x"")"`);
    });
});
