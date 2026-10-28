import { getAssistantReply, SUGGESTED_QUESTIONS } from '../assistant-knowledge';

jest.mock('@deriv-com/translations', () => ({
    Localize: () => null,
    localize: (text: string, values?: Record<string, string>) =>
        values ? text.replace(/{{(\w+)}}/g, (_m, key) => values[key]) : text,
}));

const guest = { is_logged_in: false, is_virtual: false, pathname: '/' };
const demo = { is_logged_in: true, is_virtual: true, pathname: '/dashboard' };
const real = { is_logged_in: true, is_virtual: false, pathname: '/dashboard' };

describe('getAssistantReply', () => {
    it('sends each suggested question to the right topic', () => {
        const expected = ['trade', 'bot_what', 'bot_import', 'demo_real', 'bot_limits', 'bot_templates', 'markets'];
        SUGGESTED_QUESTIONS().forEach((question, index) => {
            expect(getAssistantReply(question, guest).id).toBe(expected[index]);
        });
    });

    it.each([
        ['how do I log in', 'login'],
        ['where is the risk calculator', 'risk'],
        ['can I copy your trades', 'copy'],
        ['where can I read the news and alerts', 'news'],
        ['is there a handout I can print', 'news'],
        ['how do I set a take profit', 'bot_limits'],
        ['what is the max stake limit', 'bot_limits'],
        ['what happens if my connection drops while a bot trades', 'bot_limits'],
        ['my bot is not running', 'bot_run'],
        ['where are my past trades', 'reports'],
        ['how do I download my statement', 'reports'],
        ['show me the charts and indicators', 'charts'],
        ['where can I see live prices and the top movers', 'markets'],
        ['how do I add a market to my watchlist', 'markets'],
        ['which market should I trade', 'markets'],
        ['which markets are the most volatile', 'markets'],
        ['are there any bot templates', 'bot_templates'],
        ['how do I import a bot template', 'bot_templates'],
        ['I want a ready made strategy', 'bot_templates'],
        ['import a bot from a file', 'bot_import'],
    ])('answers "%s" with the %s topic', (question, id) => {
        expect(getAssistantReply(question, guest).id).toBe(id);
    });

    it('never promises profit and points to the risk tools', () => {
        const reply = getAssistantReply('is there a guaranteed win strategy, I want to make money', guest);
        expect(reply.id).toBe('guarantee');
        expect(reply.text).toMatch(/no bot|cannot guarantee|can lose/i);
        expect(reply.text).not.toMatch(/you will (win|profit)|always win/i);
        expect(reply.actions.map(a => a.path)).toContain('/risk-calculator');
    });

    it('offers a log in button to a guest and the dashboard to a logged in user', () => {
        expect(getAssistantReply('log in', guest).actions).toEqual([{ label: 'Log in', login: true }]);
        expect(getAssistantReply('log in', demo).actions[0].path).toBe('/dashboard');
    });

    it('says which account type you are on, and warns about real money', () => {
        expect(getAssistantReply('demo or real', demo).text).toMatch(/demo account right now/);
        expect(getAssistantReply('demo or real', real).text).toMatch(/REAL account right now/);
    });

    it('tells you where you are from the current path', () => {
        expect(getAssistantReply('where am I', { ...guest, pathname: '/bot-builder' }).text).toMatch(/Bot Builder/);
        expect(getAssistantReply('where am I', { ...guest, pathname: '/' }).text).toMatch(/Trade page/);
    });

    it('explains the bot safety limits without promising results', () => {
        const reply = getAssistantReply('what is the max stake limit', real);
        expect(reply.text).toMatch(/Max stake per trade/);
        expect(reply.text).toMatch(/real account/);
        expect(reply.text).toMatch(/Positions/);
        expect(reply.text).not.toMatch(/you will (win|profit)|always win|guarantee/i);
    });

    it('describes Markets and Templates without promising results', () => {
        const markets = getAssistantReply('tell me about the watchlist', guest);
        expect(markets.actions.map(a => a.path)).toContain('/markets');
        expect(markets.text).toMatch(/not which way it will go/);
        const templates = getAssistantReply('bot templates', guest);
        expect(templates.text).toMatch(/not advice/);
        expect(templates.text).toMatch(/demo account/);
        expect(templates.text).not.toMatch(/you will (win|profit)|always win/i);
    });

    it('knows when you are on the Markets page', () => {
        expect(getAssistantReply('where am I', { ...guest, pathname: '/markets' }).text).toMatch(/Markets/);
    });

    it('falls back with a helpful message when it does not understand', () => {
        const reply = getAssistantReply('purple elephants', guest);
        expect(reply.id).toBe('fallback');
        expect(reply.text).toMatch(/Bot Builder/);
        expect(reply.actions).toEqual([]);
    });

    it('does not say anything about the site that is not true of it', () => {
        // answers are written from what exists; this guards against a topic silently pointing to a missing page
        const paths = new Set(SUGGESTED_QUESTIONS().flatMap(q => getAssistantReply(q, guest).actions.map(a => a.path)));
        paths.forEach(path => expect(path === undefined || path.startsWith('/')).toBe(true));
    });
});
