import {
    buildWhatsAppLink,
    getCommunityConfig,
    getWhatsAppConfig,
    isTelegramUrl,
    normaliseWhatsAppNumber,
} from '../brand';

describe('isTelegramUrl', () => {
    it('accepts https invite links on Telegram domains', () => {
        expect(isTelegramUrl('https://t.me/fiscofx')).toBe(true);
        expect(isTelegramUrl('https://t.me/+AbCdEfGh123')).toBe(true);
        expect(isTelegramUrl('https://t.me/joinchat/AAAAAE')).toBe(true);
        expect(isTelegramUrl('https://telegram.me/fiscofx')).toBe(true);
    });

    it('rejects other schemes, look-alike domains, bare domains and junk', () => {
        expect(isTelegramUrl('')).toBe(false);
        expect(isTelegramUrl('not a url')).toBe(false);
        expect(isTelegramUrl('http://t.me/fiscofx')).toBe(false);
        expect(isTelegramUrl('javascript:alert(1)')).toBe(false);
        expect(isTelegramUrl('https://t.me')).toBe(false);
        expect(isTelegramUrl('https://t.me/')).toBe(false);
        expect(isTelegramUrl('https://evil.com/t.me/fiscofx')).toBe(false);
        expect(isTelegramUrl('https://t.me.evil.com/fiscofx')).toBe(false);
        expect(isTelegramUrl('https://nott.me/fiscofx')).toBe(false);
    });
});

describe('getCommunityConfig', () => {
    it('gives an empty link and a name until the owner adds a link', () => {
        const config = getCommunityConfig();
        expect(config.telegram_url).toBe('');
        expect(config.telegram_name.length).toBeGreaterThan(0);
    });
});

describe('normaliseWhatsAppNumber', () => {
    it('keeps digits and drops a plus, spaces, dashes and brackets', () => {
        expect(normaliseWhatsAppNumber('254748404496')).toBe('254748404496');
        expect(normaliseWhatsAppNumber('+13074573763')).toBe('13074573763');
        expect(normaliseWhatsAppNumber(' +254 748-404 496 ')).toBe('254748404496');
        expect(normaliseWhatsAppNumber('+1 (307) 457-3763')).toBe('13074573763');
    });

    it('rejects anything that is not a plausible international number', () => {
        ['', '   ', '0748404496', '+0748404496', '123', '1234567', '1234567890123456', 'abc', '2547x8404496'].forEach(
            value => expect(normaliseWhatsAppNumber(value)).toBeNull()
        );
        [undefined, null, 254748404496, {}, []].forEach(value => expect(normaliseWhatsAppNumber(value)).toBeNull());
    });
});

describe('buildWhatsAppLink', () => {
    it('opens a chat with the number', () => {
        expect(buildWhatsAppLink('254748404496')).toBe('https://wa.me/254748404496');
        expect(buildWhatsAppLink('254748404496', '   ')).toBe('https://wa.me/254748404496');
    });

    it('puts the message in the link, safely encoded', () => {
        expect(buildWhatsAppLink('13074573763', 'Hello, how do I join?')).toBe(
            'https://wa.me/13074573763?text=Hello%2C%20how%20do%20I%20join%3F'
        );
        const link = buildWhatsAppLink('13074573763', 'a&b=c #1 \u00e9\n"x"');
        expect(link).not.toMatch(/[ #"\n]/);
        expect(new URL(link).searchParams.get('text')).toBe('a&b=c #1 \u00e9\n"x"');
    });
});

describe('getWhatsAppConfig', () => {
    it('reads the numbers in brand.config.json', () => {
        expect(getWhatsAppConfig().numbers).toEqual(['254748404496', '13074573763']);
    });
});
