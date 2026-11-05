import React from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { TScanRow } from '../use-voltrex-scanner';
import VoltrexAlertsPanel from '../voltrex-alerts-panel';

jest.mock('@deriv-com/translations', () => ({
    localize: (text: string, values?: Record<string, unknown>) =>
        values ? text.replace(/{{(\w+)}}/g, (_match, key) => String(values[key])) : text,
}));

const rows = [
    { symbol: 'R_10', name: 'Volatility 10 Index', is_open: true },
    { symbol: 'R_100', name: 'Volatility 100 Index', is_open: true },
] as TScanRow[];

const make = (overrides = {}) => ({
    rules: [],
    addRule: jest.fn(() => null),
    removeRule: jest.fn(),
    sound: true,
    setSound: jest.fn(),
    fired: [],
    clearFired: jest.fn(),
    ...overrides,
});

describe('VoltrexAlertsPanel', () => {
    it('adds a rule from the form', async () => {
        const alerts = make();
        render(<VoltrexAlertsPanel alerts={alerts} rows={rows} onSelect={jest.fn()} />);
        await userEvent.selectOptions(screen.getByTestId('voltrex-alert-product'), 'even_odd');
        await userEvent.selectOptions(screen.getByTestId('voltrex-alert-symbol'), 'R_100');
        await userEvent.clear(screen.getByTestId('voltrex-alert-strength'));
        await userEvent.type(screen.getByTestId('voltrex-alert-strength'), '60');
        await userEvent.click(screen.getByTestId('voltrex-alert-add'));
        expect(alerts.addRule).toHaveBeenCalledWith(
            expect.objectContaining({ product: 'even_odd', symbol: 'R_100', min_strength: 60 })
        );
    });

    it('shows why a rule was refused', async () => {
        const alerts = make({ addRule: jest.fn(() => 'The minimum strength must be between 1 and 100.') });
        render(<VoltrexAlertsPanel alerts={alerts} rows={rows} onSelect={jest.fn()} />);
        await userEvent.click(screen.getByTestId('voltrex-alert-add'));
        expect(screen.getByTestId('voltrex-alert-error')).toHaveTextContent(/between 1 and 100/);
    });

    it('lists rules, removes one, and opens a market from a recent alert', async () => {
        const onSelect = jest.fn();
        const alerts = make({
            rules: [{ id: 'a', product: 'rise_fall', symbol: 'any', min_strength: 40 }],
            fired: [
                {
                    rule_id: 'a',
                    symbol: 'R_10',
                    name: 'Volatility 10 Index',
                    product: 'rise_fall',
                    label: 'Rise',
                    strength: 55,
                    why: 'test',
                    at: Date.now(),
                },
            ],
        });
        render(<VoltrexAlertsPanel alerts={alerts} rows={rows} onSelect={onSelect} />);
        expect(screen.getByTestId('voltrex-alert-rules')).toHaveTextContent(/any market/);
        await userEvent.click(screen.getByTestId('voltrex-alert-remove-a'));
        expect(alerts.removeRule).toHaveBeenCalledWith('a');
        await userEvent.click(screen.getByText(/Volatility 10 Index/, { selector: 'strong' }));
        expect(onSelect).toHaveBeenCalledWith('R_10');
    });

    it('switches the sound off', async () => {
        const alerts = make();
        render(<VoltrexAlertsPanel alerts={alerts} rows={rows} onSelect={jest.fn()} />);
        await userEvent.click(screen.getByTestId('voltrex-alert-sound'));
        expect(alerts.setSound).toHaveBeenCalledWith(false);
    });
});
