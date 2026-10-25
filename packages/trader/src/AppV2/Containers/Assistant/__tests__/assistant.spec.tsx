import { MemoryRouter, Route } from 'react-router-dom';

import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen } from '@testing-library/react';

import Assistant from '../assistant';

const mockRedirectToLogin = jest.fn();

jest.mock('@deriv/shared', () => ({
    ...jest.requireActual('@deriv/shared'),
    redirectToLogin: () => mockRedirectToLogin(),
    getBrandName: () => 'FiscoFX',
}));

jest.mock('@deriv-com/translations', () => ({
    Localize: () => null,
    localize: (text: string, values?: Record<string, string>) =>
        values ? text.replace(/{{(\w+)}}/g, (_m, key) => values[key]) : text,
}));

const renderAssistant = (is_logged_in = false) => {
    const store = mockStore({ client: { is_logged_in, is_virtual: true, loginid: 'VRTC1' } });
    render(
        <StoreProvider store={store}>
            <MemoryRouter initialEntries={['/dashboard']}>
                <Assistant />
                <Route path='*' render={({ location }) => <div data-testid='dt_location'>{location.pathname}</div>} />
            </MemoryRouter>
        </StoreProvider>
    );
};

const openGuide = () => fireEvent.click(screen.getByTestId('dt_assistant_launcher'));

describe('Assistant', () => {
    beforeEach(() => mockRedirectToLogin.mockClear());

    it('is closed until the Help button is pressed, then greets the user', () => {
        renderAssistant();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        openGuide();
        expect(screen.getByRole('dialog', { name: 'Site guide' })).toBeInTheDocument();
        expect(screen.getByText(/I can show you around/)).toBeInTheDocument();
    });

    it('is honest that it is a help list and not live AI', () => {
        renderAssistant();
        openGuide();
        expect(screen.getByText(/not live AI/i)).toBeInTheDocument();
    });

    it('answers a typed question', () => {
        renderAssistant();
        openGuide();
        fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'how do I import a bot' } });
        fireEvent.click(screen.getByText('Send'));
        expect(screen.getByText('how do I import a bot')).toBeInTheDocument();
        expect(screen.getByText(/press Import and choose a bot file/)).toBeInTheDocument();
    });

    it('answers a suggested question when it is tapped', () => {
        renderAssistant();
        openGuide();
        fireEvent.click(screen.getByText('Demo or real account?'));
        expect(screen.getByText(/virtual money/)).toBeInTheDocument();
    });

    it('takes the user to the page an answer links to and closes', () => {
        renderAssistant(true);
        openGuide();
        fireEvent.click(screen.getByText('What is the Bot Builder?'));
        fireEvent.click(screen.getByText('Open Bot Builder'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/bot-builder');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('sends a guest to Deriv log in from the Log in button', () => {
        renderAssistant(false);
        openGuide();
        fireEvent.change(screen.getByLabelText('Your question'), { target: { value: 'log in' } });
        fireEvent.click(screen.getByText('Send'));
        fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
        expect(mockRedirectToLogin).toHaveBeenCalledTimes(1);
    });

    it('does not send an empty question and closes with Escape', () => {
        renderAssistant();
        openGuide();
        expect(screen.getByText('Send')).toBeDisabled();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
