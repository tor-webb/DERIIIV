import type { TLesson, TTopic } from '../learn-content';
import {
    LEARN_READ_KEY,
    overallProgress,
    readingMinutes,
    readLessonsRead,
    toggleRead,
    topicProgress,
    writeLessonsRead,
} from '../learn-progress';

const lesson = (id: string, overrides: Partial<TLesson> = {}): TLesson => ({
    id,
    title: 'Title',
    summary: 'Summary',
    body: ['One paragraph.'],
    points: ['One point.'],
    ...overrides,
});

const topic = (id: string, ids: string[]): TTopic => ({
    id,
    label: id,
    intro: '',
    lessons: ids.map(item => lesson(item)),
});

const words = (count: number) => Array.from({ length: count }, () => 'word').join(' ');

describe('read lessons', () => {
    beforeEach(() => localStorage.clear());

    it('starts empty', () => {
        expect(readLessonsRead(['a', 'b'])).toEqual([]);
    });

    it('saves and reads them back', () => {
        writeLessonsRead(['a', 'b']);
        expect(readLessonsRead(['a', 'b', 'c'])).toEqual(['a', 'b']);
    });

    it('drops ids that are not lessons any more, repeats and non-text', () => {
        localStorage.setItem(LEARN_READ_KEY, JSON.stringify(['a', 'gone', 'a', 7, null, { id: 'a' }]));
        expect(readLessonsRead(['a', 'b'])).toEqual(['a']);
    });

    it('treats broken storage as empty', () => {
        localStorage.setItem(LEARN_READ_KEY, '{oops');
        expect(readLessonsRead(['a'])).toEqual([]);
        localStorage.setItem(LEARN_READ_KEY, '{"a":true}');
        expect(readLessonsRead(['a'])).toEqual([]);
        const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(readLessonsRead(['a'])).toEqual([]);
        spy.mockRestore();
    });

    it('does not throw when storage refuses a write', () => {
        const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        expect(() => writeLessonsRead(['a'])).not.toThrow();
        spy.mockRestore();
    });

    it('toggles a lesson on and off without changing the original list', () => {
        const original = ['a'];
        expect(toggleRead(original, 'b')).toEqual(['a', 'b']);
        expect(toggleRead(original, 'a')).toEqual([]);
        expect(original).toEqual(['a']);
    });
});

describe('readingMinutes', () => {
    it('is at least one minute', () => {
        expect(readingMinutes(lesson('a'))).toBe(1);
    });

    it('rounds up at 200 words a minute', () => {
        // title, summary and the one point add up to 3 + 2 words of fixed text, so build around that
        const base = lesson('a', { title: '', summary: '', points: [] });
        expect(readingMinutes({ ...base, body: [words(200)] })).toBe(1);
        expect(readingMinutes({ ...base, body: [words(201)] })).toBe(2);
        expect(readingMinutes({ ...base, body: [words(400)] })).toBe(2);
        expect(readingMinutes({ ...base, body: [words(401)] })).toBe(3);
    });

    it('counts the title, summary, body and points together', () => {
        const long = lesson('a', { title: words(100), summary: words(100), body: [words(100)], points: [words(101)] });
        expect(readingMinutes(long)).toBe(3);
    });
});

describe('progress', () => {
    const topics = [topic('one', ['a', 'b', 'c', 'd']), topic('two', ['e', 'f'])];

    it('counts read lessons in a topic', () => {
        expect(topicProgress(topics[0], ['a', 'b', 'e'])).toEqual({ done: 2, total: 4, percent: 50 });
        expect(topicProgress(topics[0], [])).toEqual({ done: 0, total: 4, percent: 0 });
        expect(topicProgress(topics[1], ['e', 'f'])).toEqual({ done: 2, total: 2, percent: 100 });
    });

    it('counts read lessons across topics', () => {
        expect(overallProgress(topics, ['a', 'e'])).toEqual({ done: 2, total: 6, percent: 33 });
    });

    it('is 0 percent when there are no lessons', () => {
        expect(overallProgress([], [])).toEqual({ done: 0, total: 0, percent: 0 });
        expect(topicProgress(topic('empty', []), ['a'])).toEqual({ done: 0, total: 0, percent: 0 });
    });
});
