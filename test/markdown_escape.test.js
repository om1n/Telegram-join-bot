
import { describe, it, expect } from 'vitest';
import { MESSAGES } from '../src/messages.js';

// Replica of the function in worker.js
function escapeMarkdownLegacy(text) {
    if (!text) return '';
    return text.replace(/([*_`[])/g, '\\$1');
}

describe('Markdown Escaping', () => {
    it('escapes special characters correctly', () => {
        const dangerous = 'Hello *world* [link] _italic_ `code`';
        const escaped = escapeMarkdownLegacy(dangerous);
        expect(escaped).toBe('Hello \\*world\\* \\[link] \\_italic\\_ \\`code\\`');
    });

    it('escapes names in welcome message', () => {
        const groupTitle = 'Damn_Good_Group*';
        const escapedTitle = escapeMarkdownLegacy(groupTitle);
        const msg = MESSAGES.welcome(escapedTitle);
        expect(msg).toContain('Damn\\_Good\\_Group\\*');
    });

    it('escapes user inputs in moderator message', () => {
        const username = 'user_name';
        const displayName = 'Display*Name';
        const answer = 'I am a *hacker* [link]';

        const safeUser = escapeMarkdownLegacy(username);
        const safeDisplay = escapeMarkdownLegacy(displayName);
        const safeAnswer = escapeMarkdownLegacy(answer);

        const msg = MESSAGES.moderator.newRequest(
            safeUser, safeDisplay, 123, 'link', safeAnswer, 'chat', 'date', 'expires'
        );

        expect(msg).toContain('user\\_name');
        expect(msg).toContain('Display\\*Name');
        expect(msg).toContain('I am a \\*hacker\\* \\[link]');
    });
});
