import { render, screen, within } from '@testing-library/react';

import type { TScanRow } from '../use-voltrex-scanner';
import VoltrexEngine, { blipPosition, hashOf } from '../voltrex-engine';
import type { TScanReport, TTrade } from '../voltrex-trader';

jest.mock('@deriv-com/translations', () => ({
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

const row = (symbol: string, direction: 'BUY' | 'SELL' | 'NEUTRAL' | null, strength = 60): TScanRow =>
    ({
        symbol,
        name: symbol,
        signal: direction ? { direction, strength } : null,
    }) as unknown as TScanRow;

const trade = (overrides: Partial<TTrade> = {}): TTrade => ({
    id: 1,
    symbol: 'R_10',
    name: 'Volatility 10 Index',
    side: 'CALL',
    stake: 1,
    duration: 5,
    duration_unit: 't',
    source: 'auto',
    why: '',
    status: 'placing',
    opened_at: 0,
    ...overrides,
});

const report = (overrides: Partial<TScanReport> = {}): TScanReport => ({
    at: 1,
    scans: 4,
    in_scope: 12,
    waiting: 2,
    signals: 5,
    accepted: 3,
    qualified: 0,
    closest: { name: 'Volatility 75 Index', direction: 'BUY', strength: 22 },
    min_strength: 30,
    note: 'Markets fit the strategy, but none reaches your minimum strength yet.',
    ...overrides,
});

const base = {
    rows: [row('R_10', 'BUY', 70), row('R_25', 'SELL', 40), row('R_50', 'NEUTRAL'), row('R_75', null)],
    loaded: 4,
    total: 4,
    auto: 'off' as const,
    scan: null,
    trades: [],
    log: [],
    emergency: false,
    is_virtual: true,
};

const mode = () => screen.getByTestId('voltrex-engine-mode');

describe('blipPosition', () => {
    it('keeps a market in the same place and inside the radar', () => {
        const first = blipPosition('R_100');
        expect(blipPosition('R_100')).toEqual(first);
        ['R_10', 'frxEURUSD', 'CRASH500', '1HZ75V', 'stpRNG'].forEach(symbol => {
            const { left, top } = blipPosition(symbol);
            // inside the circle: distance from the centre at most 50% of the width
            expect(Math.hypot(left - 50, top - 50)).toBeLessThanOrEqual(50);
        });
        expect(hashOf('R_10')).not.toBe(hashOf('R_25'));
    });
});

describe('<VoltrexEngine />', () => {
    it('shows only markets with a BUY or SELL reading on the radar', () => {
        render(<VoltrexEngine {...base} />);
        expect(screen.getByRole('img', { name: 'Radar of 2 markets with a buy or sell reading' })).toBeInTheDocument();
        expect(screen.getAllByTestId(/^voltrex-blip-/)).toHaveLength(2);
        expect(screen.getAllByTestId('voltrex-blip-buy')).toHaveLength(1);
        expect(screen.getAllByTestId('voltrex-blip-sell')).toHaveLength(1);
    });

    it('rings a market that has a trade open or being placed', () => {
        render(<VoltrexEngine {...base} trades={[trade({ status: 'open' })]} />);
        expect(screen.getAllByTestId(/^voltrex-blip-.*-trade$/)).toHaveLength(1);
    });

    it('counts signals and shows scan progress', () => {
        render(<VoltrexEngine {...base} loaded={37} total={120} />);
        expect(screen.getByTestId('voltrex-engine-progress')).toHaveTextContent('37 / 120 markets scanned');
        expect(screen.getByTestId('voltrex-engine')).toHaveTextContent('1 BUY');
        expect(screen.getByTestId('voltrex-engine')).toHaveTextContent('1 SELL');
        expect(screen.getByTestId('voltrex-engine')).toHaveTextContent('1 NEUTRAL');
    });

    it('moves only while something is scanning or trading', () => {
        const { rerender } = render(<VoltrexEngine {...base} />);
        expect(mode()).toHaveTextContent('LIVE · STANDBY');
        expect(screen.getByTestId('voltrex-engine')).not.toHaveClass('voltrex-engine--active');

        rerender(<VoltrexEngine {...base} loaded={10} total={120} />);
        expect(mode()).toHaveTextContent('SCANNING MARKETS');
        expect(screen.getByTestId('voltrex-engine')).toHaveClass('voltrex-engine--active');

        rerender(<VoltrexEngine {...base} auto='running' />);
        expect(mode()).toHaveTextContent('AUTO SCAN ACTIVE');
        expect(screen.getByTestId('voltrex-engine')).toHaveClass('voltrex-engine--active');

        rerender(<VoltrexEngine {...base} auto='paused' />);
        expect(mode()).toHaveTextContent('AUTO PAUSED');
        expect(screen.getByTestId('voltrex-engine')).not.toHaveClass('voltrex-engine--active');
    });

    it('says EXECUTING while a trade is being placed, and EMERGENCY STOP over everything', () => {
        const { rerender } = render(<VoltrexEngine {...base} auto='running' trades={[trade()]} />);
        expect(mode()).toHaveTextContent('EXECUTING TRADE');
        expect(screen.getByTestId('voltrex-engine-trade')).toHaveTextContent(
            'EXECUTING Rise · Volatility 10 Index · 1.00'
        );

        rerender(<VoltrexEngine {...base} auto='running' trades={[trade()]} emergency />);
        expect(mode()).toHaveTextContent('EMERGENCY STOP');
        expect(screen.getByTestId('voltrex-engine')).not.toHaveClass('voltrex-engine--active');
    });

    it('describes the latest trade as live, won, lost or not placed', () => {
        const { rerender } = render(<VoltrexEngine {...base} trades={[trade({ status: 'open' })]} />);
        expect(screen.getByTestId('voltrex-engine-trade')).toHaveTextContent('LIVE Rise');
        rerender(<VoltrexEngine {...base} trades={[trade({ status: 'won', profit: 0.95, side: 'PUT' })]} />);
        expect(screen.getByTestId('voltrex-engine-trade')).toHaveTextContent(
            'WON Fall · Volatility 10 Index · 1.00 +0.95'
        );
        rerender(<VoltrexEngine {...base} trades={[trade({ status: 'lost', profit: -1 })]} />);
        expect(screen.getByTestId('voltrex-engine-trade')).toHaveTextContent('LOST Rise');
        rerender(<VoltrexEngine {...base} trades={[trade({ status: 'failed' })]} />);
        expect(screen.getByTestId('voltrex-engine-trade')).toHaveTextContent('NOT PLACED');
    });

    it('tells the person why auto-trading is not trading: the closest market and what it needs', () => {
        render(<VoltrexEngine {...base} auto='running' scan={report()} />);
        const line = screen.getByTestId('voltrex-engine-auto');
        expect(line).toHaveTextContent('Scan #4: 12 markets in scope, 5 with a signal, 0 meet your limits.');
        expect(line).toHaveTextContent('Closest: Volatility 75 Index BUY 22 (needs 30).');
        expect(line).toHaveTextContent('none reaches your minimum strength');
    });

    it('does not show a "closest" market once something qualifies', () => {
        render(
            <VoltrexEngine {...base} auto='running' scan={report({ qualified: 2, note: 'Placed a trade on X.' })} />
        );
        expect(screen.getByTestId('voltrex-engine-auto')).not.toHaveTextContent('Closest');
        expect(screen.getByTestId('voltrex-engine-auto')).toHaveTextContent('Placed a trade on X.');
    });

    it('says auto-trading is off, and that it needs a demo account when the account is real', () => {
        const { rerender } = render(<VoltrexEngine {...base} />);
        expect(screen.getByTestId('voltrex-engine-auto')).toHaveTextContent('Auto-trading is off.');
        expect(screen.getByTestId('voltrex-engine-auto')).not.toHaveTextContent('Demo accounts only');
        rerender(<VoltrexEngine {...base} is_virtual={false} />);
        expect(screen.getByTestId('voltrex-engine-auto')).toHaveTextContent('Demo accounts only');
    });

    it('shows the last few log lines as the feed', () => {
        const log = Array.from({ length: 6 }, (_item, index) => ({
            time: 1_700_000_000_000 + index * 1000,
            level: 'info' as const,
            message: `line ${index}`,
        }));
        render(<VoltrexEngine {...base} log={log} />);
        const items = within(screen.getByTestId('voltrex-engine-feed')).getAllByRole('listitem');
        expect(items).toHaveLength(4);
        expect(items[3]).toHaveTextContent('line 5');
        expect(items[0]).toHaveTextContent('line 2');
    });
});
