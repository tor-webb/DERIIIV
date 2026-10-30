import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen } from '@testing-library/react';

import RiskCalculator from '../risk-calculator';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

const renderPage = (client = {}) =>
    render(
        <StoreProvider store={mockStore({ client })}>
            <RiskCalculator />
        </StoreProvider>
    );

describe('<RiskCalculator />', () => {
    it('shows a position size for the default numbers', () => {
        renderPage();
        expect(screen.getByText('0.05 lots')).toBeInTheDocument();
        expect(screen.getByText('33.3%')).toBeInTheDocument();
    });

    it('recalculates when an input changes', () => {
        renderPage();
        fireEvent.change(screen.getByTestId('dt_risk_stop_loss_pips'), { target: { value: '10' } });
        expect(screen.getByText('0.10 lots')).toBeInTheDocument();
    });

    it('starts from the account balance when logged in', () => {
        renderPage({ is_logged_in: true, balance: '2500', currency: 'USD' });
        expect(screen.getByTestId('dt_risk_balance')).toHaveValue(2500);
    });

    it('warns when risk per trade is above 2%', () => {
        renderPage();
        expect(screen.queryByTestId('dt_risk_warning')).not.toBeInTheDocument();
        fireEvent.change(screen.getByTestId('dt_risk_risk_percent'), { target: { value: '5' } });
        expect(screen.getByTestId('dt_risk_warning')).toBeInTheDocument();
    });

    it('asks for valid numbers instead of showing a result', () => {
        renderPage();
        fireEvent.change(screen.getByTestId('dt_risk_balance'), { target: { value: '' } });
        expect(screen.getByText('Enter values above zero to see results.')).toBeInTheDocument();
    });

    it('shows the stake plan, the losing streak table and the doubling warning on the stake tab', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('dt_risk_tab_stake'));
        expect(screen.getByText('If you lose in a row (fixed stake)')).toBeInTheDocument();
        expect(screen.getByTestId('dt_risk_martingale')).toHaveTextContent('fund 6 trades in a row');
    });

    it('sets the risk with a preset button and shows which one is chosen', () => {
        renderPage();
        expect(screen.getByTestId('dt_risk_preset_1')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('dt_risk_preset_5'));
        expect(screen.getByTestId('dt_risk_risk_percent')).toHaveValue(5);
        expect(screen.getByTestId('dt_risk_preset_5')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('dt_risk_preset_1')).toHaveAttribute('aria-pressed', 'false');
    });

    it('describes where the risk sits, in words, as the number changes', () => {
        renderPage();
        expect(screen.getByTestId('dt_risk_band')).toHaveTextContent('Cautious');
        fireEvent.change(screen.getByTestId('dt_risk_risk_percent'), { target: { value: '2' } });
        expect(screen.getByTestId('dt_risk_band')).toHaveTextContent('In the common 1% to 2% range');
        fireEvent.change(screen.getByTestId('dt_risk_risk_percent'), { target: { value: '4' } });
        expect(screen.getByTestId('dt_risk_band')).toHaveTextContent('High');
        fireEvent.change(screen.getByTestId('dt_risk_risk_percent'), { target: { value: '8' } });
        expect(screen.getByTestId('dt_risk_band')).toHaveTextContent('Very high');
    });

    it('hides the gauge when the risk is empty', () => {
        renderPage();
        fireEvent.change(screen.getByTestId('dt_risk_risk_percent'), { target: { value: '' } });
        expect(screen.queryByTestId('dt_risk_gauge')).not.toBeInTheDocument();
    });
});
