/**
 * The bots a person keeps in this browser: a personal list of saved templates, and the one bot that a template or saved
 * bot replaced (so "Bring it back" survives a page reload).
 *
 * Nothing here imports Blockly. Everything read back from storage is treated as untrusted text: a saved bot is only
 * ever loaded through `parseBotFile` and `loadParsedBot` like a file, and the replaced bot is scanned before it loads.
 */

export const SAVED_BOTS_STORAGE_KEY = 'bot_builder_saved_bots';
export const PREVIOUS_BOT_STORAGE_KEY = 'bot_builder_previous';

export const MAX_SAVED_BOTS = 20;
/** Characters of XML per saved bot, about 200 KB. A normal bot is a few KB. */
export const MAX_SAVED_BOT_CHARS = 200_000;
export const MAX_SAVED_BOT_NAME_LENGTH = 60;
/** The replaced bot is a workspace JSON; this matches the largest file the importer accepts. */
export const MAX_PREVIOUS_BOT_CHARS = 2_000_000;

export type TSavedBot = {
    id: string;
    name: string;
    /** Milliseconds since 1970, shown as the date the bot was saved. */
    saved_at: number;
    xml: string;
};

export type TSaveResult =
    | { ok: true; bots: TSavedBot[]; replaced: boolean }
    | { ok: false; reason: 'empty_name' | 'too_large' | 'full' | 'storage' };

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Tidies a name typed by the person: collapses runs of whitespace, trims, and cuts it to the maximum length. */
export const cleanSavedBotName = (name: string): string =>
    name.replace(/\s+/g, ' ').trim().slice(0, MAX_SAVED_BOT_NAME_LENGTH).trim();

const toSavedBot = (value: unknown): TSavedBot | null => {
    if (!isObject(value)) return null;
    const { id, name, saved_at, xml } = value;
    if (typeof id !== 'string' || !id || id.length > 64) return null;
    if (typeof name !== 'string' || !cleanSavedBotName(name)) return null;
    if (typeof xml !== 'string' || !xml.trim() || xml.length > MAX_SAVED_BOT_CHARS) return null;
    return {
        id,
        name: cleanSavedBotName(name),
        saved_at: typeof saved_at === 'number' && Number.isFinite(saved_at) ? saved_at : 0,
        xml,
    };
};

/** The saved bots, newest first. Anything unreadable, oversized or repeated is dropped rather than trusted. */
export const readSavedBots = (): TSavedBot[] => {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_BOTS_STORAGE_KEY) ?? '[]');
        if (!Array.isArray(parsed)) return [];
        const seen = new Set<string>();
        const bots: TSavedBot[] = [];
        parsed.forEach(item => {
            const bot = toSavedBot(item);
            if (!bot || seen.has(bot.id) || bots.length >= MAX_SAVED_BOTS) return;
            seen.add(bot.id);
            bots.push(bot);
        });
        return bots;
    } catch {
        return [];
    }
};

const writeSavedBots = (bots: TSavedBot[]): boolean => {
    try {
        localStorage.setItem(SAVED_BOTS_STORAGE_KEY, JSON.stringify(bots));
        return true;
    } catch {
        // storage can be unavailable (private mode) or full
        return false;
    }
};

let id_counter = 0;
const newId = () => {
    id_counter += 1;
    return `${Date.now().toString(36)}-${id_counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * Keeps a bot under a name, newest first. Saving under a name that is already used (ignoring case) replaces that bot
 * instead of adding another, so saving an improved version never fills the list with copies.
 */
export const saveBotAsTemplate = (name: string, xml: string, now = Date.now()): TSaveResult => {
    const clean_name = cleanSavedBotName(name);
    if (!clean_name) return { ok: false, reason: 'empty_name' };
    if (typeof xml !== 'string' || !xml.trim() || xml.length > MAX_SAVED_BOT_CHARS) {
        return { ok: false, reason: 'too_large' };
    }

    const existing = readSavedBots();
    const same_name = existing.find(bot => bot.name.toLowerCase() === clean_name.toLowerCase());
    if (!same_name && existing.length >= MAX_SAVED_BOTS) return { ok: false, reason: 'full' };

    const bot: TSavedBot = { id: same_name?.id ?? newId(), name: clean_name, saved_at: now, xml };
    const bots = [bot, ...existing.filter(item => item.id !== bot.id)];
    if (!writeSavedBots(bots)) return { ok: false, reason: 'storage' };
    return { ok: true, bots, replaced: Boolean(same_name) };
};

/** Removes one saved bot and returns the list that remains. */
export const deleteSavedBot = (id: string): TSavedBot[] => {
    const bots = readSavedBots().filter(bot => bot.id !== id);
    writeSavedBots(bots);
    return bots;
};

/* ----------------------------------------------------------------------------------------------- */
/* The bot that was replaced                                                                        */
/* ----------------------------------------------------------------------------------------------- */

/** The replaced bot's workspace state, or null. The caller must scan it before loading it. */
export const readPreviousBot = (): Record<string, unknown> | null => {
    try {
        const raw = localStorage.getItem(PREVIOUS_BOT_STORAGE_KEY);
        if (!raw || raw.length > MAX_PREVIOUS_BOT_CHARS) return null;
        const parsed: unknown = JSON.parse(raw);
        return isObject(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

/** Keeps (or, with null, forgets) the replaced bot. Returns false when it could not be stored. */
export const writePreviousBot = (state: Record<string, unknown> | null): boolean => {
    try {
        if (state === null) {
            localStorage.removeItem(PREVIOUS_BOT_STORAGE_KEY);
            return true;
        }
        const text = JSON.stringify(state);
        if (text.length > MAX_PREVIOUS_BOT_CHARS) {
            localStorage.removeItem(PREVIOUS_BOT_STORAGE_KEY);
            return false;
        }
        localStorage.setItem(PREVIOUS_BOT_STORAGE_KEY, text);
        return true;
    } catch {
        return false;
    }
};
