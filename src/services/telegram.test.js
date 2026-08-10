import { describe, it, expect } from 'vitest';
import { formatGroupLink } from './telegram.js';

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
