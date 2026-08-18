import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { escapeMarkdownLegacy, formatGroupLink, fullname, getChatInfo } from './telegram.js';

describe('escapeMarkdownLegacy', () => {
    it('should return empty string for falsy values', () => {
        expect(escapeMarkdownLegacy('')).toBe('');
        expect(escapeMarkdownLegacy(null)).toBe('');
        expect(escapeMarkdownLegacy(undefined)).toBe('');
    });

    it('should escape legacy markdown characters', () => {
        expect(escapeMarkdownLegacy('*bold*')).toBe('\\*bold\\*');
        expect(escapeMarkdownLegacy('_italic_')).toBe('\\_italic\\_');
        expect(escapeMarkdownLegacy('`code`')).toBe('\\`code\\`');
        expect(escapeMarkdownLegacy('[link]')).toBe('\\[link\\]');
        expect(escapeMarkdownLegacy('\\')).toBe('\\\\');
    });

    it('should not escape characters that are not special in legacy markdown', () => {
        expect(escapeMarkdownLegacy('()')).toBe('()');
        expect(escapeMarkdownLegacy('{}')).toBe('{}');
        expect(escapeMarkdownLegacy('#tag')).toBe('#tag');
        expect(escapeMarkdownLegacy('+1')).toBe('+1');
        expect(escapeMarkdownLegacy('-1')).toBe('-1');
        expect(escapeMarkdownLegacy('test.')).toBe('test.');
        expect(escapeMarkdownLegacy('test!')).toBe('test!');
        expect(escapeMarkdownLegacy('~')).toBe('~');
    });

    it('should not alter text without special characters', () => {
        expect(escapeMarkdownLegacy('Hello World 123')).toBe('Hello World 123');
    });

    it('should escape a mix of characters', () => {
        expect(escapeMarkdownLegacy('Hello *World*! See [Link](http://example.com)')).toBe('Hello \\*World\\*! See \\[Link\\](http://example.com)');
    });
});

describe('fullname', () => {
    it('should return only first_name if last_name is missing', () => {
        expect(fullname({ first_name: 'John' })).toBe('John');
    });

    it('should return only last_name if first_name is missing', () => {
        expect(fullname({ last_name: 'Doe' })).toBe('Doe');
    });

    it('should return both names separated by a space if both are provided', () => {
        expect(fullname({ first_name: 'John', last_name: 'Doe' })).toBe('John Doe');
    });

    it('should return an empty string if neither is provided', () => {
        expect(fullname({})).toBe('');
    });

    it('should handle falsy values correctly', () => {
        expect(fullname({ first_name: '', last_name: undefined })).toBe('');
        expect(fullname({ first_name: null, last_name: false })).toBe('');
    });
});

describe('formatGroupLink', () => {
    describe('Happy Paths', () => {
        it('should format a public group with a username as a markdown link', () => {
            const result = formatGroupLink('123456', 'Public Group', 'public_username');
            expect(result).toBe('[Public Group](https://t.me/public_username)');
        });

        it('should format a private group without a username in bold', () => {
            const result = formatGroupLink('123456', 'Private Group');
            expect(result).toBe('*Private Group*');
        });
    });

    describe('Username Edge Cases', () => {
        it('should fallback to private group format if username is an empty string', () => {
            const result = formatGroupLink('123456', 'Group Title', '');
            expect(result).toBe('*Group Title*');
        });

        it('should fallback to private group format if username is null', () => {
            const result = formatGroupLink('123456', 'Group Title', null);
            expect(result).toBe('*Group Title*');
        });

        it('should fallback to private group format if username is undefined', () => {
            const result = formatGroupLink('123456', 'Group Title', undefined);
            expect(result).toBe('*Group Title*');
        });
    });

    describe('Title Edge Cases', () => {
        it('should handle empty string as title', () => {
            expect(formatGroupLink('123', '', 'username')).toBe('[](https://t.me/username)');
            expect(formatGroupLink('123', '')).toBe('**');
        });

        it('should handle null as title predictably', () => {
            expect(formatGroupLink('123', null, 'username')).toBe('[null](https://t.me/username)');
            expect(formatGroupLink('123', null)).toBe('*null*');
        });

        it('should handle undefined as title predictably', () => {
            expect(formatGroupLink('123', undefined, 'username')).toBe('[undefined](https://t.me/username)');
            expect(formatGroupLink('123', undefined)).toBe('*undefined*');
        });
    });

    describe('ChatId Cases', () => {
        it('should not be affected by omitting the chatId', () => {
            expect(formatGroupLink(undefined, 'Group', 'user')).toBe('[Group](https://t.me/user)');
            expect(formatGroupLink(undefined, 'Group')).toBe('*Group*');
        });

        it('should not be affected by passing null for chatId', () => {
            expect(formatGroupLink(null, 'Group', 'user')).toBe('[Group](https://t.me/user)');
            expect(formatGroupLink(null, 'Group')).toBe('*Group*');
        });

        it('should not be affected by the value of chatId', () => {
            expect(formatGroupLink('some-weird-id', 'Group', 'user')).toBe('[Group](https://t.me/user)');
            expect(formatGroupLink(-987654, 'Group')).toBe('*Group*');
        });
    });
});

describe('getChatInfo', () => {
    const mockEnv = { TELEGRAM_BOT_TOKEN: 'test-token' };

    let consoleErrorSpy;
    let fetchSpy;

    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        fetchSpy = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return chat object on success', async () => {
        fetchSpy.mockResolvedValueOnce({
            json: async () => ({
                ok: true,
                result: { id: '123', title: 'Test Chat' }
            })
        });

        const result = await getChatInfo('123', mockEnv);
        expect(result).toEqual({ id: '123', title: 'Test Chat' });
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://api.telegram.org/bottest-token/getChat',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ chat_id: '123' })
            })
        );
    });

    it('should return null when API returns ok: false', async () => {
        const errorPayload = { ok: false, error_code: 400, description: 'Chat not found' };
        fetchSpy.mockResolvedValueOnce({
            json: async () => errorPayload
        });

        const result = await getChatInfo('123', mockEnv);
        expect(result).toBeNull();
        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to get chat info:', errorPayload);
    });

    it('should return null when sendToTelegram throws an error', async () => {
        const networkError = new Error('Network error');
        fetchSpy.mockRejectedValueOnce(networkError);

        const result = await getChatInfo('123', mockEnv);
        expect(result).toBeNull();
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error fetching chat info:', networkError);
    });
});
