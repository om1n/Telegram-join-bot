import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleChatMember } from './member.js';
import { MESSAGES } from '../messages.js';

vi.mock('../services/telegram.js', () => ({
    sendToTelegram: vi.fn(),
    escapeMarkdownLegacy: vi.fn((str) => str),
    formatGroupLink: vi.fn((id, title, username) => `[${title}](https://t.me/${username})`)
}));

import { sendToTelegram } from '../services/telegram.js';

describe('handleChatMember', () => {
    let mockEnv;
    let mockDb;
    let baseChatMember;
    let executedQueries = [];

    beforeEach(() => {
        vi.clearAllMocks();
        executedQueries = [];

        mockDb = {
            prepare: vi.fn((query) => {
                const queryObj = { query, params: [] };
                const chainable = {
                    bind: vi.fn((...params) => {
                        queryObj.params = params;
                        return chainable;
                    }),
                    run: vi.fn(async () => {
                        executedQueries.push({ ...queryObj, type: 'run' });
                        return {};
                    })
                };
                return chainable;
            })
        };

        mockEnv = {
            DB: mockDb,
            MOD_CHAT_ID: 'mod-123'
        };

        baseChatMember = {
            from: {
                id: 999,
                first_name: 'Admin',
                last_name: 'User',
                username: 'adminuser'
            },
            chat: {
                id: -10012345,
                title: 'Test Chat',
                username: 'testchat'
            },
            new_chat_member: {
                status: 'member',
                user: {
                    id: 12345,
                    first_name: 'John',
                    last_name: 'Doe',
                    username: 'johndoe',
                    is_bot: false
                }
            }
        };
    });

    it('should log debug event and process new member', async () => {
        await handleChatMember(baseChatMember, mockEnv);

        // Verify DB query
        expect(executedQueries.length).toBe(1);
        expect(executedQueries[0].query).toContain('INSERT INTO events');
        expect(executedQueries[0].params[2]).toBe('debug_chat_member'); // Index 2 is event_type

        // Verify Telegram calls
        expect(sendToTelegram).toHaveBeenCalledTimes(2);

        // 1. Welcome Message
        expect(sendToTelegram).toHaveBeenCalledWith('sendMessage', {
            chat_id: 12345,
            text: MESSAGES.welcome('Test Chat'),
            parse_mode: 'Markdown'
        }, mockEnv);

        // 2. Mod Notification
        expect(sendToTelegram).toHaveBeenCalledWith('sendMessage', {
            chat_id: 'mod-123',
            text: expect.any(String), // We can trust the message generator
            parse_mode: 'Markdown'
        }, mockEnv);
    });

    it('should only log event if status is not member', async () => {
        baseChatMember.new_chat_member.status = 'left';

        await handleChatMember(baseChatMember, mockEnv);

        expect(executedQueries.length).toBe(1);
        expect(sendToTelegram).not.toHaveBeenCalled();
    });

    it('should ignore bots', async () => {
        baseChatMember.new_chat_member.user.is_bot = true;

        await handleChatMember(baseChatMember, mockEnv);

        expect(executedQueries.length).toBe(1);
        expect(sendToTelegram).not.toHaveBeenCalled();
    });

    it('should not send mod notification if MOD_CHAT_ID is missing', async () => {
        delete mockEnv.MOD_CHAT_ID;

        await handleChatMember(baseChatMember, mockEnv);

        expect(sendToTelegram).toHaveBeenCalledTimes(1);
        expect(sendToTelegram).toHaveBeenCalledWith('sendMessage', {
            chat_id: 12345,
            text: MESSAGES.welcome('Test Chat'),
            parse_mode: 'Markdown'
        }, mockEnv);
    });

    it('should not crash if debug logging fails', async () => {
        mockDb.prepare = vi.fn().mockImplementation(() => {
            throw new Error('DB Error');
        });

        // Spy on console.error
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await handleChatMember(baseChatMember, mockEnv);

        expect(consoleSpy).toHaveBeenCalledWith('Debug log error', expect.any(Error));
        expect(sendToTelegram).toHaveBeenCalledTimes(2);

        consoleSpy.mockRestore();
    });

    it('should not crash if sending welcome message fails', async () => {
        sendToTelegram.mockImplementationOnce(() => {
            throw new Error('API Error');
        });

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await handleChatMember(baseChatMember, mockEnv);

        expect(consoleSpy).toHaveBeenCalledWith('Failed to send welcome message', expect.any(Error));
        // Mod notification should still be sent
        expect(sendToTelegram).toHaveBeenCalledTimes(2);

        consoleSpy.mockRestore();
    });

    it('should not crash if sending mod notification fails', async () => {
        sendToTelegram.mockImplementationOnce(() => Promise.resolve()); // welcome succeeds
        sendToTelegram.mockImplementationOnce(() => { // mod fails
            throw new Error('API Error 2');
        });

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await handleChatMember(baseChatMember, mockEnv);

        expect(consoleSpy).toHaveBeenCalledWith('Failed to notify moderators', expect.any(Error));
        expect(sendToTelegram).toHaveBeenCalledTimes(2);

        consoleSpy.mockRestore();
    });
});
