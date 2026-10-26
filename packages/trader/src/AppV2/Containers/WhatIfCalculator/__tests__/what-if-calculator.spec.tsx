import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen } from '@testing-library/react';

import WhatIfCalculator from '../what-if-calculator';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

const renderPage = (client = {}) =>
    render(
        <StoreProvider store={mockStore({ client })}>
            <WhatIfCalculator />
        </StoreProvider>
    );

const change = (testid: string, value: string) => fireEvent.change(screen.getByTestId(testid), { target: { value } });

describe('<WhatIfCalculator />', () => {
    it('labels the win rate as an assumption, not a prediction', () => {
        renderPage();
        const note = screen.getByTestId('dt_whatif_assumption');
        expect(note).toHaveTextContent('Assumption, not a prediction');
        expect(note).toHaveTextContent('55.0%');
        expect(screen.getByText('An input you choose, not a forecast of how often you will win.')).toBeInTheDocument();
    });

    it('shows the assumed win rate against break-even and the expected result per contract', () => {
        renderPage();
        // 100 / 1.95 = 51.3%, so 55% is 3.7 points above
        expect(screen.getByTestId('dt_stake_gauge')).toHaveTextContent('Assumed win rate 55.0%');
        expect(screen.getByTestId('dt_stake_gauge')).toHaveTextContent('Break-even 51.3%');
        expect(screen.getByTestId('dt_whatif_verdict')).toHaveTextContent('3.7 points above break-even');
        // 0.55 x 9.50 - 0.45 x 10 = 0.725
        expect(screen.getByTestId('dt_whatif_ev')).toHaveTextContent(/0\.7[23]/);
        expect(screen.queryByTestId('dt_whatif_below')).not.toBeInTheDocument();
        expect(screen.getByTestId('dt_stake_chart')).toBeInTheDocument();
    });

    it('warns when the assumed win rate is below break-even', () => {
        renderPage();
        change('dt_whatif_win_rate', '40');
        expect(screen.getByTestId('dt_whatif_verdict')).toHaveTextContent('11.3 points short of break-even');
        expect(screen.getByTestId('dt_whatif_below')).toBeInTheDocument();
    });

    it('shows how the plan does as the win rate falls short', () => {
        renderPage();
        const rows = screen.getAllByTestId('dt_whatif_row');
        expect(rows).toHaveLength(5);
        expect(rows[0]).toHaveTextContent('55.0% (assumed)');
        expect(rows[1]).toHaveTextContent('53.0% (2 lower)');
        expect(rows[4]).toHaveTextContent('35.0% (20 lower)');
    });

    it('does not repeat rows when lower win rates reach zero', () => {
        renderPage();
        change('dt_whatif_win_rate', '3');
        expect(screen.getAllByTestId('dt_whatif_row')).toHaveLength(3);
    });

    it('says how many losses in a row the plan can pay for', () => {
        renderPage();
        expect(screen.getByTestId('dt_whatif_survives')).toHaveTextContent('pay for 100');
        change('dt_whatif_plan', 'martingale');
        // 10 + 20 + 40 + 80 + 160 + 320 = 630 fits in 1000; the next stake is 640
        expect(screen.getByTestId('dt_whatif_survives')).toHaveTextContent('pay for 6');
        expect(screen.getByTestId('dt_whatif_survives')).toHaveTextContent('640');
        expect(screen.getByTestId('dt_whatif_plan_note')).toBeInTheDocument();
    });

    it('shows a martingale running out of balance when the win rate is low', () => {
        renderPage();
        change('dt_whatif_plan', 'martingale');
        change('dt_whatif_win_rate', '45');
        change('dt_whatif_trades', '300');
        const ruin = screen.getByTestId('dt_whatif_ruin');
        expect(Number.parseFloat(ruin.textContent ?? '0')).toBeGreaterThan(50);
    });

    it('asks for a multiplier only on a martingale and a step only on D’Alembert', () => {
        renderPage();
        expect(screen.queryByTestId('dt_whatif_multiplier')).not.toBeInTheDocument();
        change('dt_whatif_plan', 'martingale');
        expect(screen.getByTestId('dt_whatif_multiplier')).toBeInTheDocument();
        change('dt_whatif_plan', 'dalembert');
        expect(screen.getByTestId('dt_whatif_step')).toBeInTheDocument();
        expect(screen.queryByTestId('dt_whatif_multiplier')).not.toBeInTheDocument();
    });

    it('asks for valid numbers instead of showing a result', () => {
        renderPage();
        change('dt_whatif_win_rate', '101');
        expect(screen.getByTestId('dt_whatif_empty')).toHaveTextContent('Enter values above zero');
        expect(screen.queryByTestId('dt_whatif_assumption')).not.toBeInTheDocument();
        change('dt_whatif_win_rate', '55');
        change('dt_whatif_balance', '');
        expect(screen.getByTestId('dt_whatif_empty')).toBeInTheDocument();
    });

    it('never draws the chart from half-typed numbers', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        renderPage();
        change('dt_whatif_balance', '');
        change('dt_whatif_balance', '5');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('limits the number of purchases', () => {
        renderPage();
        change('dt_whatif_trades', '501');
        expect(screen.getByTestId('dt_whatif_empty')).toHaveTextContent('Use 500 purchases or fewer.');
    });

    it('starts from the account balance when logged in', () => {
        renderPage({ is_logged_in: true, balance: '2500', currency: 'USD' });
        expect(screen.getByTestId('dt_whatif_balance')).toHaveValue(2500);
    });
});
