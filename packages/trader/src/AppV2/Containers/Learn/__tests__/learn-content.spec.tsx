import { routes } from '@deriv/shared';

import { getChecklist, getGlossary, getTopics } from '../learn-content';

jest.mock('@deriv-com/translations', () => ({
    Localize: ({ i18n_default_text }: { i18n_default_text: string }) => <>{i18n_default_text}</>,
    localize: (text: string) => text,
}));

describe('learn content', () => {
    const topics = getTopics();
    const lessons = topics.flatMap(topic => topic.lessons);

    it('has unique ids for topics and lessons', () => {
        expect(new Set(topics.map(topic => topic.id)).size).toBe(topics.length);
        expect(new Set(lessons.map(lesson => lesson.id)).size).toBe(lessons.length);
    });

    it('has no empty text anywhere', () => {
        topics.forEach(topic => {
            expect(topic.label.trim()).not.toBe('');
            expect(topic.intro.trim()).not.toBe('');
        });
        lessons.forEach(lesson => {
            expect(lesson.title.trim()).not.toBe('');
            expect(lesson.summary.trim()).not.toBe('');
            expect(lesson.body.length).toBeGreaterThan(0);
            expect(lesson.points.length).toBeGreaterThan(0);
            [...lesson.body, ...lesson.points].forEach(text => expect(text.trim()).not.toBe(''));
        });
    });

    it('only links to pages that exist', () => {
        const known = Object.values(routes);
        lessons.forEach(lesson => {
            if (lesson.try_it) expect(known).toContain(lesson.try_it.path);
        });
        expect(lessons.filter(lesson => lesson.try_it).length).toBeGreaterThan(5);
    });

    it('covers the subjects a beginner asked for', () => {
        const ids = lessons.map(lesson => lesson.id);
        [
            'what_moves_prices',
            'candles',
            'indicators',
            'calendar',
            'stocks',
            'crypto',
            'prediction_truth',
            'risk_basics',
        ].forEach(id => expect(ids).toContain(id));
    });

    it('never promises results', () => {
        const everything = JSON.stringify([topics, getGlossary(), getChecklist()]).toLowerCase();
        ['guaranteed profit', 'sure win', 'risk-free', 'cannot lose', 'easy money'].forEach(phrase =>
            expect(everything).not.toContain(phrase)
        );
    });

    it('has unique glossary terms and checklist items', () => {
        const terms = getGlossary().map(entry => entry.term);
        expect(new Set(terms).size).toBe(terms.length);
        const checks = getChecklist().map(item => item.id);
        expect(new Set(checks).size).toBe(checks.length);
    });
});
