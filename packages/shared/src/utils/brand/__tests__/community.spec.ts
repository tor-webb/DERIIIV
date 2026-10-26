import { getCommunityConfig, isTelegramUrl } from '../brand';

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
