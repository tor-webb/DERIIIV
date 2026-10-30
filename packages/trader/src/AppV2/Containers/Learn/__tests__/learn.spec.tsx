import { MemoryRouter, Route } from 'react-router-dom';

import { getCommunityConfig } from '@deriv/shared';
import { mockStore, StoreProvider } from '@deriv/stores';
import { fireEvent, render, screen } from '@testing-library/react';

import Learn from '../learn';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (key: string, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), key),
}));

jest.mock('@deriv/shared', () => ({
    ...jest.requireActual('@deriv/shared'),
    getCommunityConfig: jest.fn(),
}));

const mockCommunity = getCommunityConfig as jest.Mock;

const renderPage = () =>
    render(
        <StoreProvider store={mockStore({})}>
            <MemoryRouter initialEntries={['/learn']}>
                <Learn />
                <Route path='*' render={({ location }) => <span data-testid='dt_location'>{location.pathname}</span>} />
            </MemoryRouter>
        </StoreProvider>
    );

describe('<Learn />', () => {
    beforeEach(() => {
        localStorage.clear();
        mockCommunity.mockReturnValue({ telegram_url: '', telegram_name: 'FiscoFX Community' });
    });

    it('opens on the first lessons and says it is education, not advice', () => {
        renderPage();
        expect(screen.getByText('Learn to trade')).toBeInTheDocument();
        expect(screen.getByTestId('dt_learn_notice')).toHaveTextContent('Nobody, including us, can predict');
        expect(screen.getByTestId('dt_learn_lesson_what_moves_prices')).toBeInTheDocument();
        expect(screen.queryByTestId('dt_learn_lesson_candles')).not.toBeInTheDocument();
    });

    it('switches topics', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('dt_learn_tab_charts'));
        expect(screen.getByTestId('dt_learn_lesson_candles')).toBeInTheDocument();
        expect(screen.getByTestId('dt_learn_tab_charts')).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByTestId('dt_learn_tab_news'));
        expect(screen.getByTestId('dt_learn_lesson_crypto')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('dt_learn_tab_predictions'));
        expect(screen.getByTestId('dt_learn_lesson_prediction_truth')).toBeInTheDocument();
    });

    it('opens the tool a lesson points to', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('dt_learn_try_how_a_trade_works'));
        expect(screen.getByTestId('dt_location')).toHaveTextContent('/what-if');
    });

    it('filters the glossary and says when nothing matches', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('dt_learn_tab_glossary'));
        expect(screen.getByText('Martingale')).toBeInTheDocument();
        fireEvent.change(screen.getByTestId('dt_learn_search'), { target: { value: 'rsi' } });
        expect(screen.getByText('RSI')).toBeInTheDocument();
        expect(screen.queryByText('Martingale')).not.toBeInTheDocument();
        fireEvent.change(screen.getByTestId('dt_learn_search'), { target: { value: 'zzzz' } });
        expect(screen.getByTestId('dt_learn_no_match')).toHaveTextContent('No terms match "zzzz".');
    });

    it('tells people the Telegram channel is coming until a link is set', () => {
        renderPage();
        expect(screen.getByTestId('dt_learn_telegram_soon')).toBeInTheDocument();
        expect(screen.queryByTestId('dt_learn_telegram_link')).not.toBeInTheDocument();
    });

    it('shows a safe Join button once a Telegram link is set', () => {
        mockCommunity.mockReturnValue({ telegram_url: 'https://t.me/fiscofx', telegram_name: 'FiscoFX Community' });
        renderPage();
        const link = screen.getByTestId('dt_learn_telegram_link');
        expect(link).toHaveAttribute('href', 'https://t.me/fiscofx');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.queryByTestId('dt_learn_telegram_soon')).not.toBeInTheDocument();
    });

    it('warns about scams in the community card', () => {
        renderPage();
        expect(screen.getByTestId('dt_learn_community')).toHaveTextContent('Never send money, passwords or codes');
    });

    it('only says "you have thought it through" when every checklist line is ticked', () => {
        renderPage();
        expect(screen.getByTestId('dt_learn_ready')).toHaveTextContent('Tick each line honestly');
        ['demo', 'news', 'risk', 'plan'].forEach(id => fireEvent.click(screen.getByTestId(`dt_learn_check_${id}`)));
        expect(screen.getByTestId('dt_learn_ready')).toHaveTextContent('Tick each line honestly');
        fireEvent.click(screen.getByTestId('dt_learn_check_calm'));
        expect(screen.getByTestId('dt_learn_ready')).toHaveTextContent('All ticked');
        fireEvent.click(screen.getByTestId('dt_learn_check_calm'));
        expect(screen.getByTestId('dt_learn_ready')).toHaveTextContent('Tick each line honestly');
    });

    describe('reading progress', () => {
        it('starts at none read and shows a reading time on each lesson', () => {
            renderPage();
            expect(screen.getByTestId('dt_learn_progress')).toHaveTextContent(/You have read 0 of \d+ lessons\./);
            expect(screen.getByTestId('dt_learn_progress').querySelector('[role=progressbar]')).toHaveAttribute(
                'aria-valuenow',
                '0'
            );
            expect(screen.getByTestId('dt_learn_lesson_what_moves_prices')).toHaveTextContent(/\d+ min read/);
        });

        it('marks a lesson as read, updates the counts, and can undo it', () => {
            renderPage();
            const before = screen.getByTestId('dt_learn_count_basics').textContent as string;
            expect(before).toMatch(/^0\/\d+$/);
            fireEvent.click(screen.getByTestId('dt_learn_mark_what_moves_prices'));
            expect(screen.getByTestId('dt_learn_mark_what_moves_prices')).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByTestId('dt_learn_mark_what_moves_prices')).toHaveTextContent('Marked as read');
            expect(screen.getByTestId('dt_learn_lesson_what_moves_prices')).toHaveClass('learn__lesson--read');
            expect(screen.getByTestId('dt_learn_count_basics')).toHaveTextContent(/^1\//);
            expect(screen.getByTestId('dt_learn_progress')).toHaveTextContent('You have read 1 of');
            fireEvent.click(screen.getByTestId('dt_learn_mark_what_moves_prices'));
            expect(screen.getByTestId('dt_learn_count_basics')).toHaveTextContent(before);
        });

        it('remembers what was read after the page is opened again', () => {
            const first = renderPage();
            fireEvent.click(screen.getByTestId('dt_learn_mark_what_moves_prices'));
            first.unmount();
            renderPage();
            expect(screen.getByTestId('dt_learn_mark_what_moves_prices')).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByTestId('dt_learn_progress')).toHaveTextContent('You have read 1 of');
        });

        it('shows a count on every topic tab but not on the glossary', () => {
            renderPage();
            expect(screen.getByTestId('dt_learn_count_charts')).toBeInTheDocument();
            expect(screen.queryByTestId('dt_learn_count_glossary')).not.toBeInTheDocument();
        });

        it('still does not remember the pre-trade checklist', () => {
            const first = renderPage();
            fireEvent.click(screen.getByTestId('dt_learn_check_demo'));
            first.unmount();
            renderPage();
            expect(screen.getByTestId('dt_learn_check_demo')).not.toBeChecked();
        });
    });
});
