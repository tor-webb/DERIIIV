import { fireEvent, render, screen } from '@testing-library/react';

import { ALERTS_OFF_KEY, readThresholds } from '../price-alerts';
import PriceAlertsPanel from '../price-alerts-panel';

jest.mock('@deriv-com/translations', () => ({
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

describe('<PriceAlertsPanel />', () => {
    beforeEach(() => localStorage.clear());

    it('asks the person to star a market when none is starred', () => {
        render(<PriceAlertsPanel watchlist={[]} />);
        expect(screen.getByTestId('dt_price_alerts_empty')).toBeInTheDocument();
    });

    it('lists only the starred markets, each with no alert to begin with', () => {
        render(<PriceAlertsPanel watchlist={['R_50', 'frxEURUSD']} />);
        expect(screen.getByTestId('dt_price_alert_R_50')).toHaveValue('');
        expect(screen.getByTestId('dt_price_alert_frxEURUSD')).toHaveValue('');
        expect(screen.queryByTestId('dt_price_alert_R_100')).not.toBeInTheDocument();
    });

    it('saves the chosen move and shows it again next time', () => {
        const { unmount } = render(<PriceAlertsPanel watchlist={['R_50']} />);
        fireEvent.change(screen.getByTestId('dt_price_alert_R_50'), { target: { value: '0.5' } });
        expect(readThresholds()).toEqual({ R_50: 0.5 });
        unmount();
        render(<PriceAlertsPanel watchlist={['R_50']} />);
        expect(screen.getByTestId('dt_price_alert_R_50')).toHaveValue('0.5');
    });

    it('removes an alert with "No alert"', () => {
        render(<PriceAlertsPanel watchlist={['R_50']} />);
        fireEvent.change(screen.getByTestId('dt_price_alert_R_50'), { target: { value: '2' } });
        fireEvent.change(screen.getByTestId('dt_price_alert_R_50'), { target: { value: '' } });
        expect(readThresholds()).toEqual({});
    });

    it('switches all alerts off and on, and locks the choices while off', () => {
        render(<PriceAlertsPanel watchlist={['R_50']} />);
        const toggle = screen.getByTestId('dt_price_alerts_switch');
        expect(toggle).toBeChecked();
        fireEvent.click(toggle);
        expect(toggle).not.toBeChecked();
        expect(toggle).toHaveTextContent('Alerts off');
        expect(localStorage.getItem(ALERTS_OFF_KEY)).toBe('1');
        expect(screen.getByTestId('dt_price_alert_R_50')).toBeDisabled();
        fireEvent.click(toggle);
        expect(localStorage.getItem(ALERTS_OFF_KEY)).toBeNull();
        expect(screen.getByTestId('dt_price_alert_R_50')).toBeEnabled();
    });

    it('says alerts only work while the site is open and are not advice', () => {
        const { container } = render(<PriceAlertsPanel watchlist={[]} />);
        expect(container).toHaveTextContent('only work while this site is open');
        expect(container).toHaveTextContent('not advice');
    });
});
