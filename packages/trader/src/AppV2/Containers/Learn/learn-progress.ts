/**
 * Which lessons a person has marked as read, kept in this browser only, plus the small sums the Learn page shows
 * (reading time and progress). Nothing here is sent anywhere.
 */
import type { TLesson, TTopic } from './learn-content';

export const LEARN_READ_KEY = 'learn_read_lessons';

const WORDS_PER_MINUTE = 200;

/** The lessons marked as read. Anything that is not a known lesson id is dropped, so old or edited storage is harmless. */
export const readLessonsRead = (known_ids: string[]): string[] => {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(LEARN_READ_KEY) ?? '[]');
        if (!Array.isArray(parsed)) return [];
        const known = new Set(known_ids);
        return Array.from(new Set(parsed.filter((id): id is string => typeof id === 'string' && known.has(id))));
    } catch {
        return [];
    }
};

export const writeLessonsRead = (ids: string[]) => {
    try {
        localStorage.setItem(LEARN_READ_KEY, JSON.stringify(ids));
    } catch {
        // storage can be unavailable (private mode, quota); the ticks last until the page closes
    }
};

/** Adds the lesson if it is missing, removes it if it is there. Returns a new list. */
export const toggleRead = (ids: string[], id: string): string[] =>
    ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** About how many minutes the lesson takes to read, never less than 1. */
export const readingMinutes = (lesson: TLesson): number => {
    const words = [lesson.title, lesson.summary, ...lesson.body, ...lesson.points].reduce(
        (total, text) => total + countWords(text),
        0
    );
    return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
};

export type TProgress = { done: number; total: number; percent: number };

const progress = (done: number, total: number): TProgress => ({
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
});

/** How many of a topic's lessons are marked as read. */
export const topicProgress = (topic: TTopic, read: string[]): TProgress =>
    progress(topic.lessons.filter(lesson => read.includes(lesson.id)).length, topic.lessons.length);

/** How many lessons are read across every topic. */
export const overallProgress = (topics: TTopic[], read: string[]): TProgress => {
    const lessons = topics.flatMap(topic => topic.lessons);
    return progress(lessons.filter(lesson => read.includes(lesson.id)).length, lessons.length);
};
