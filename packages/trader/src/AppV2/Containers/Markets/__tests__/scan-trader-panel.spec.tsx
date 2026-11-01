import { mockStore, StoreProvider } from '@deriv/stores';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { DEFAULT_SCAN, TScanFilters } from '../markets-scanner';
import { TMarketRow } from '../markets-utils';
import ScanTraderPanel from '../scan-trader-panel';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

jest.mock('@deriv/shared', () => ({
    ...jest.requireActual('@deriv/shared'),
    WS: {},
}));

const mockTraders: {
    options: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    start: jest.Mock;
    stop: jest.Mock;
    poke: jest.Mock;
}[] = [];

jest.mock('../scan-trader', () => ({
    ScanTrader: class {
        start = jest.fn();
        stop = jest.fn();
        poke = jest.fn();
        options: Record<string, unknown>;
        constructor(options: Record<string, unknown>) {
            this.options = options;
            mockTraders.push(this as never);
        }
    },
}));

const row = (overrides: Partial<TMarketRow> & { symbol: string }): TMarketRow => ({
    name: overrides.symbol,
    group: 'synthetic',
    status: 'ready',
    price: 100,
    pip_size: 2,
    change_pct: 0.3,
    range_pct: 0.5,
    volatility: 'medium',
    is_closed: false,
    closes: [99, 101, 100],
    range_position: 0.5,
    ...overrides,
});

const ROWS = [
    row({ symbol: 'R_10', name: 'Volatility 10 Index', change_pct: 0.2 }),
    row({ symbol: 'R_100', name: 'Volatility 100 Index', change_pct: 0.9 }),
];
const UP: TScanFilters = { ...DEFAULT_SCAN, direction: 'up' };

const onTrade = jest.fn();

const tree = (
    client: Record<string, unknown> = {},
    rows: TMarketRow[] = ROWS,
    filters: TScanFilters = UP,
    window_text = '1h'
) => (
    <StoreProvider
        store={mockStore({
            client: { is_logged_in: true, is_virtual: true, currency: 'USD', balance: '100', ...client },
        })}
    >
        <ScanTraderPanel rows={rows} filters={filters} window_text={window_text} onTrade={onTrade} />
    </StoreProvider>
);

const renderPanel = (...args: Parameters<typeof tree>) => render(tree(...args));

const startAuto = async () => {
    fireEvent.click(screen.getByTestId('dt_scan_trader_start'));
    await waitFor(() => expect(mockTraders).toHaveLength(1));
    return mockTraders[0];
};

describe('<ScanTraderPanel />', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTraders.length = 0;
    });

    describe('the top match, for trading by hand', () => {
        it('names the market with the biggest move and opens the Trade page on it', () => {
            renderPanel();
            const top = screen.getByTestId('dt_scan_trader_top');
            expect(top).toHaveTextContent('Top match');
            expect(top).toHaveTextContent('Volatility 100 Index: +0.90% over the last 1h');
            fireEvent.click(screen.getByTestId('dt_scan_trader_trade'));
            expect(onTrade).toHaveBeenCalledWith('R_100');
        });

        it('shows a fall with a minus sign and follows the chosen window', () => {
            renderPanel(
                {},
                [row({ symbol: 'R_50', name: 'Volatility 50 Index', change_pct: -0.45 })],
                {
                    ...DEFAULT_SCAN,
                    direction: 'down',
                },
                '4h'
            );
            expect(screen.getByTestId('dt_scan_trader_top')).toHaveTextContent(
                'Volatility 50 Index: −0.45% over the last 4h'
            );
        });

        it('asks for a filter when none is on, and offers no trade', () => {
            renderPanel({}, ROWS, DEFAULT_SCAN);
            expect(screen.getByTestId('dt_scan_trader_top')).toHaveTextContent('Switch on a filter above');
            expect(screen.queryByTestId('dt_scan_trader_trade')).not.toBeInTheDocument();
            expect(screen.getByTestId('dt_scan_trader_start')).toBeDisabled();
        });

        it('says so when no tradeable market matches', () => {
            renderPanel({}, [row({ symbol: 'R_10', change_pct: -0.5 })]);
            expect(screen.getByTestId('dt_scan_trader_top')).toHaveTextContent('No market that Bot Builder can trade');
            expect(screen.queryByTestId('dt_scan_trader_trade')).not.toBeInTheDocument();
        });

        it('stays available to a person on a real account, who can still trade by hand', () => {
            renderPanel({ is_virtual: false });
            fireEvent.click(screen.getByTestId('dt_scan_trader_trade'));
            expect(onTrade).toHaveBeenCalledWith('R_100');
        });
    });

    describe('who may use auto-trade', () => {
        it('asks a logged out person to log in, with no controls', () => {
            renderPanel({ is_logged_in: false, is_virtual: false });
            expect(screen.getByTestId('dt_scan_trader_login')).toBeInTheDocument();
            expect(screen.queryByTestId('dt_scan_trader_start')).not.toBeInTheDocument();
            expect(screen.queryByTestId('dt_scan_trader_stake')).not.toBeInTheDocument();
        });

        it('switches auto-trade off on a real account and says why', () => {
            renderPanel({ is_virtual: false });
            expect(screen.getByTestId('dt_scan_trader_real')).toHaveTextContent('auto-trade is off');
            expect(screen.queryByTestId('dt_scan_trader_start')).not.toBeInTheDocument();
            expect(screen.queryByTestId('dt_scan_trader_stake')).not.toBeInTheDocument();
        });

        it('shows the controls on a demo account', () => {
            renderPanel();
            expect(screen.getByTestId('dt_scan_trader_start')).toBeEnabled();
            expect(screen.getByTestId('dt_scan_trader_stake')).toHaveValue(1);
            expect(screen.getByTestId('dt_scan_trader_trades')).toHaveValue(5);
            expect(screen.getByTestId('dt_scan_trader_loss')).toHaveValue(5);
            expect(screen.getByTestId('dt_scan_trader_wait')).toHaveValue(30);
            expect(screen.getByTestId('dt_scan_trader_profit')).toHaveValue(null);
        });

        it('says plainly that the scan does not predict and that real-money auto-trade is off', () => {
            renderPanel();
            const text = screen.getByTestId('dt_scan_trader').textContent ?? '';
            expect(text).toMatch(/not what it will do/);
            expect(text).toMatch(/either choice can lose the stake/);
            expect(text).toMatch(/Real-money auto-trading is switched off/);
            expect(text).not.toMatch(/you will (win|profit)|guarantee|best entry/i);
        });
    });

    describe('settings', () => {
        it('explains what is wrong and will not start with an unsafe setting', () => {
            renderPanel();
            fireEvent.change(screen.getByTestId('dt_scan_trader_loss'), { target: { value: '' } });
            expect(screen.getByTestId('dt_scan_trader_problem')).toHaveTextContent('Set a stop loss above zero.');
            expect(screen.getByTestId('dt_scan_trader_start')).toBeDisabled();

            fireEvent.change(screen.getByTestId('dt_scan_trader_loss'), { target: { value: '5' } });
            fireEvent.change(screen.getByTestId('dt_scan_trader_stake'), { target: { value: '10' } });
            expect(screen.getByTestId('dt_scan_trader_problem')).toHaveTextContent('at least one stake');
            fireEvent.change(screen.getByTestId('dt_scan_trader_wait'), { target: { value: '3' } });
            fireEvent.change(screen.getByTestId('dt_scan_trader_stake'), { target: { value: '1' } });
            expect(screen.getByTestId('dt_scan_trader_problem')).toHaveTextContent('at least 10 seconds');
            expect(mockTraders).toHaveLength(0);
        });

        it('trades with the move by default, and against it when asked', () => {
            renderPanel();
            expect(screen.getByTestId('dt_scan_trader_side_with')).toHaveAttribute('aria-pressed', 'true');
            fireEvent.click(screen.getByTestId('dt_scan_trader_side_against'));
            expect(screen.getByTestId('dt_scan_trader_side_against')).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByTestId('dt_scan_trader_side_with')).toHaveAttribute('aria-pressed', 'false');
        });
    });

    describe('running', () => {
        it('starts a trader with the chosen settings, on the demo account', async () => {
            renderPanel();
            fireEvent.click(screen.getByTestId('dt_scan_trader_side_against'));
            fireEvent.change(screen.getByTestId('dt_scan_trader_stake'), { target: { value: '2.5' } });
            fireEvent.change(screen.getByTestId('dt_scan_trader_trades'), { target: { value: '3' } });
            fireEvent.change(screen.getByTestId('dt_scan_trader_loss'), { target: { value: '7.5' } });
            fireEvent.change(screen.getByTestId('dt_scan_trader_profit'), { target: { value: '4' } });
            fireEvent.change(screen.getByTestId('dt_scan_trader_wait'), { target: { value: '45' } });

            const trader = await startAuto();
            expect(trader.start).toHaveBeenCalledTimes(1);
            expect(trader.options).toMatchObject({
                currency: 'USD',
                is_virtual: true,
                settings: {
                    side: 'against',
                    stake: 2.5,
                    max_trades: 3,
                    max_loss: 7.5,
                    max_profit: 4,
                    cooldown_seconds: 45,
                },
            });
            expect(trader.options.getBalance()).toBe(100);
            expect(trader.options.getRows()).toBe(ROWS);
            expect(trader.options.getFilters()).toBe(UP);
        });

        it('treats a blank take profit as off', async () => {
            renderPanel();
            const trader = await startAuto();
            expect(trader.options.settings.max_profit).toBe(0);
        });

        it('shows what the trader reports: status, session totals and messages, and locks the settings', async () => {
            renderPanel();
            const trader = await startAuto();
            expect(screen.getByTestId('dt_scan_trader_status')).toHaveTextContent('Auto-trading is off.');

            act(() => {
                trader.options.onState('watching', { runs: 0, won: 0, lost: 0, total_profit: 0 });
                trader.options.onLog('info', 'Auto-trading started on your demo account. Watching the scanner.');
            });
            expect(screen.getByTestId('dt_scan_trader_status')).toHaveTextContent('Watching the scanner for a match');
            expect(screen.getByTestId('dt_scan_trader_stake')).toBeDisabled();
            expect(screen.getByTestId('dt_scan_trader_side_with')).toBeDisabled();
            expect(screen.queryByTestId('dt_scan_trader_start')).not.toBeInTheDocument();
            expect(screen.getByTestId('dt_scan_trader_stop')).toBeEnabled();

            act(() => {
                trader.options.onState('trading', { runs: 1, won: 1, lost: 0, total_profit: 0.95 });
                trader.options.onLog('success', 'Volatility 100 Index: Contract won: +0.95 USD.');
            });
            expect(screen.getByTestId('dt_scan_trader_status')).toHaveTextContent('A trade is open or being placed.');
            expect(screen.getByTestId('dt_scan_trader_session')).toHaveTextContent(
                'This session: 1 trades, 1 won, 0 lost, 0.95 USD'
            );
            expect(screen.getByTestId('dt_scan_trader_log')).toHaveTextContent('Contract won: +0.95 USD.');
        });

        it('stops the trader from the Stop button, and shows Start again once it has stopped', async () => {
            renderPanel();
            const trader = await startAuto();
            act(() => trader.options.onState('watching', { runs: 0, won: 0, lost: 0, total_profit: 0 }));
            fireEvent.click(screen.getByTestId('dt_scan_trader_stop'));
            expect(trader.stop).toHaveBeenCalledTimes(1);

            act(() => trader.options.onState('stopping', { runs: 0, won: 0, lost: 0, total_profit: 0 }));
            expect(screen.getByTestId('dt_scan_trader_stop')).toBeDisabled();
            expect(screen.getByTestId('dt_scan_trader_status')).toHaveTextContent('Stopping once the open trade');

            act(() => trader.options.onState('stopped', { runs: 0, won: 0, lost: 0, total_profit: 0 }));
            expect(screen.getByTestId('dt_scan_trader_start')).toBeEnabled();
        });

        it('keeps only the latest messages on screen', async () => {
            renderPanel();
            const trader = await startAuto();
            act(() => {
                for (let i = 1; i <= 12; i += 1) trader.options.onLog('info', `message ${i}`);
            });
            const shown = within(screen.getByTestId('dt_scan_trader_log')).getAllByRole('listitem');
            expect(shown).toHaveLength(8);
            expect(shown[0]).toHaveTextContent('message 5');
            expect(shown[7]).toHaveTextContent('message 12');
        });

        it('lets the trader act on every new set of prices', async () => {
            const view = renderPanel();
            const trader = await startAuto();
            trader.poke.mockClear();
            const next = [row({ symbol: 'R_25', change_pct: 0.4 })];
            view.rerender(tree({}, next));
            expect(trader.poke).toHaveBeenCalled();
            expect(trader.options.getRows()).toBe(next);
        });

        it('stops the trader when the page is left', async () => {
            const view = renderPanel();
            const trader = await startAuto();
            act(() => trader.options.onState('watching', { runs: 0, won: 0, lost: 0, total_profit: 0 }));
            view.unmount();
            expect(trader.stop).toHaveBeenCalled();
        });

        it('stops the trader if the account switches to a real one while it runs', async () => {
            const view = renderPanel();
            const trader = await startAuto();
            act(() => trader.options.onState('watching', { runs: 0, won: 0, lost: 0, total_profit: 0 }));
            trader.stop.mockClear();
            view.rerender(tree({ is_virtual: false }));
            expect(trader.stop).toHaveBeenCalled();
            expect(screen.getByTestId('dt_scan_trader_real')).toBeInTheDocument();
        });
    });
});
