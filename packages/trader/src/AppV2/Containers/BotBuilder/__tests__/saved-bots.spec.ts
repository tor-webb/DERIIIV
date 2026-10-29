import {
    cleanSavedBotName,
    deleteSavedBot,
    MAX_PREVIOUS_BOT_CHARS,
    MAX_SAVED_BOT_CHARS,
    MAX_SAVED_BOT_NAME_LENGTH,
    MAX_SAVED_BOTS,
    PREVIOUS_BOT_STORAGE_KEY,
    readPreviousBot,
    readSavedBots,
    saveBotAsTemplate,
    SAVED_BOTS_STORAGE_KEY,
    writePreviousBot,
} from '../saved-bots';

const XML = '<xml is_dbot="true"><block type="trade_definition"></block></xml>';

const stored = (value: unknown) => localStorage.setItem(SAVED_BOTS_STORAGE_KEY, JSON.stringify(value));
const entry = (overrides: Record<string, unknown> = {}) => ({
    id: 'a1',
    name: 'My bot',
    saved_at: 1000,
    xml: XML,
    ...overrides,
});

describe('cleanSavedBotName', () => {
    it('trims, collapses whitespace and cuts to the maximum length', () => {
        expect(cleanSavedBotName('  My   steady\n bot  ')).toBe('My steady bot');
        expect(cleanSavedBotName('x'.repeat(200))).toHaveLength(MAX_SAVED_BOT_NAME_LENGTH);
        expect(cleanSavedBotName('   ')).toBe('');
    });
});

describe('saved bots', () => {
    beforeEach(() => localStorage.clear());

    it('starts empty', () => {
        expect(readSavedBots()).toEqual([]);
    });

    it('saves a bot and lists it', () => {
        const result = saveBotAsTemplate('  Steady   bot ', XML, 5000);
        expect(result.ok).toBe(true);
        expect(readSavedBots()).toEqual([expect.objectContaining({ name: 'Steady bot', saved_at: 5000, xml: XML })]);
        expect(readSavedBots()[0].id).toBeTruthy();
    });

    it('lists the newest first', () => {
        saveBotAsTemplate('First', XML, 1);
        saveBotAsTemplate('Second', XML, 2);
        saveBotAsTemplate('Third', XML, 3);
        expect(readSavedBots().map(bot => bot.name)).toEqual(['Third', 'Second', 'First']);
    });

    it('gives every bot its own id', () => {
        saveBotAsTemplate('One', XML);
        saveBotAsTemplate('Two', XML);
        const ids = readSavedBots().map(bot => bot.id);
        expect(new Set(ids).size).toBe(2);
    });

    it('replaces a bot saved under the same name (ignoring case) instead of adding a copy', () => {
        saveBotAsTemplate('Steady bot', XML, 1);
        saveBotAsTemplate('Other', XML, 2);
        const id = readSavedBots().find(bot => bot.name === 'Steady bot')?.id;
        const result = saveBotAsTemplate('  steady BOT ', `${XML}<!-- v2 -->`, 3);
        expect(result).toMatchObject({ ok: true, replaced: true });
        const bots = readSavedBots();
        expect(bots).toHaveLength(2);
        expect(bots[0]).toMatchObject({ id, name: 'steady BOT', saved_at: 3 });
        expect(bots[0].xml).toContain('v2');
    });

    it('refuses an empty name and does not store anything', () => {
        expect(saveBotAsTemplate('   ', XML)).toEqual({ ok: false, reason: 'empty_name' });
        expect(localStorage.getItem(SAVED_BOTS_STORAGE_KEY)).toBeNull();
    });

    it('refuses an empty or oversized bot', () => {
        expect(saveBotAsTemplate('Big', 'x'.repeat(MAX_SAVED_BOT_CHARS + 1))).toEqual({
            ok: false,
            reason: 'too_large',
        });
        expect(saveBotAsTemplate('Empty', '   ')).toEqual({ ok: false, reason: 'too_large' });
        expect(readSavedBots()).toEqual([]);
    });

    it('accepts a bot exactly at the size limit', () => {
        expect(saveBotAsTemplate('Edge', 'x'.repeat(MAX_SAVED_BOT_CHARS)).ok).toBe(true);
    });

    it('stops at the limit, but still lets a bot replace one of the same name', () => {
        for (let index = 0; index < MAX_SAVED_BOTS; index += 1) saveBotAsTemplate(`Bot ${index}`, XML, index);
        expect(readSavedBots()).toHaveLength(MAX_SAVED_BOTS);
        expect(saveBotAsTemplate('One too many', XML)).toEqual({ ok: false, reason: 'full' });
        expect(saveBotAsTemplate('bot 3', XML, 999)).toMatchObject({ ok: true, replaced: true });
        expect(readSavedBots()).toHaveLength(MAX_SAVED_BOTS);
    });

    it('reports a storage error (full or private mode) and leaves the old list alone', () => {
        saveBotAsTemplate('Kept', XML, 1);
        const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        expect(saveBotAsTemplate('New', XML, 2)).toEqual({ ok: false, reason: 'storage' });
        spy.mockRestore();
        expect(readSavedBots().map(bot => bot.name)).toEqual(['Kept']);
    });

    it('deletes one bot and returns the rest', () => {
        saveBotAsTemplate('One', XML, 1);
        saveBotAsTemplate('Two', XML, 2);
        const [two, one] = readSavedBots();
        expect(deleteSavedBot(two.id).map(bot => bot.name)).toEqual(['One']);
        expect(readSavedBots().map(bot => bot.id)).toEqual([one.id]);
    });

    it('does nothing when the bot to delete is not there', () => {
        saveBotAsTemplate('One', XML, 1);
        expect(deleteSavedBot('nope')).toHaveLength(1);
    });

    describe('corrupt storage', () => {
        it('returns an empty list for text that is not JSON', () => {
            localStorage.setItem(SAVED_BOTS_STORAGE_KEY, '{not json');
            expect(readSavedBots()).toEqual([]);
        });

        it('returns an empty list when the stored value is not a list', () => {
            stored({ id: 'a1' });
            expect(readSavedBots()).toEqual([]);
            stored('text');
            expect(readSavedBots()).toEqual([]);
            stored(null);
            expect(readSavedBots()).toEqual([]);
        });

        it('drops entries with the wrong shape and keeps the good ones', () => {
            stored([
                entry({ id: 'good' }),
                null,
                'text',
                7,
                entry({ id: '' }),
                entry({ id: 5 }),
                entry({ id: 'no-name', name: '   ' }),
                entry({ id: 'bad-name', name: 12 }),
                entry({ id: 'no-xml', xml: '' }),
                entry({ id: 'xml-number', xml: 42 }),
                entry({ id: 'huge', xml: 'x'.repeat(MAX_SAVED_BOT_CHARS + 1) }),
            ]);
            expect(readSavedBots().map(bot => bot.id)).toEqual(['good']);
        });

        it('drops repeated ids and entries beyond the limit', () => {
            stored([entry({ id: 'same', name: 'A' }), entry({ id: 'same', name: 'B' })]);
            expect(readSavedBots().map(bot => bot.name)).toEqual(['A']);

            stored(Array.from({ length: MAX_SAVED_BOTS + 5 }, (_unused, index) => entry({ id: `id${index}` })));
            expect(readSavedBots()).toHaveLength(MAX_SAVED_BOTS);
        });

        it('cleans stored names and falls back to 0 for a bad date', () => {
            stored([entry({ name: '  Spaced   out  ', saved_at: 'yesterday' })]);
            expect(readSavedBots()[0]).toMatchObject({ name: 'Spaced out', saved_at: 0 });
        });

        it('returns an empty list when storage cannot be read at all', () => {
            const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('blocked');
            });
            expect(readSavedBots()).toEqual([]);
            spy.mockRestore();
        });
    });
});

describe('the replaced bot', () => {
    beforeEach(() => localStorage.clear());

    it('keeps a bot and reads it back', () => {
        const state = { blocks: { blocks: [{ type: 'trade_definition' }] } };
        expect(writePreviousBot(state)).toBe(true);
        expect(readPreviousBot()).toEqual(state);
    });

    it('forgets the bot when given null', () => {
        writePreviousBot({ blocks: {} });
        expect(writePreviousBot(null)).toBe(true);
        expect(readPreviousBot()).toBeNull();
        expect(localStorage.getItem(PREVIOUS_BOT_STORAGE_KEY)).toBeNull();
    });

    it('has nothing before one is stored', () => {
        expect(readPreviousBot()).toBeNull();
    });

    it('ignores text that is not JSON, or JSON that is not an object', () => {
        localStorage.setItem(PREVIOUS_BOT_STORAGE_KEY, '{oops');
        expect(readPreviousBot()).toBeNull();
        localStorage.setItem(PREVIOUS_BOT_STORAGE_KEY, '[1,2]');
        expect(readPreviousBot()).toBeNull();
        localStorage.setItem(PREVIOUS_BOT_STORAGE_KEY, '"text"');
        expect(readPreviousBot()).toBeNull();
        localStorage.setItem(PREVIOUS_BOT_STORAGE_KEY, 'null');
        expect(readPreviousBot()).toBeNull();
    });

    it('ignores a stored bot that is larger than the importer would accept', () => {
        localStorage.setItem(PREVIOUS_BOT_STORAGE_KEY, `{"x":"${'a'.repeat(MAX_PREVIOUS_BOT_CHARS)}"}`);
        expect(readPreviousBot()).toBeNull();
    });

    it('does not store, and clears the old copy of, a bot that is too large', () => {
        writePreviousBot({ small: true });
        expect(writePreviousBot({ big: 'a'.repeat(MAX_PREVIOUS_BOT_CHARS) })).toBe(false);
        expect(readPreviousBot()).toBeNull();
    });

    it('reports false when the browser refuses to store it', () => {
        const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        expect(writePreviousBot({ blocks: {} })).toBe(false);
        spy.mockRestore();
    });
});
