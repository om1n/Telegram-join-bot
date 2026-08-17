import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleJoinRequest } from './join.js';
import { CONFIG } from '../config.js';
import { MESSAGES } from '../messages.js';

// Mock dependencies
vi.mock('../services/telegram.js', () => ({
    sendToTelegram: vi.fn(),
    escapeMarkdownLegacy: vi.fn((str) => str),
    fullname: vi.fn((user) => user.first_name + (user.last_name ? ' ' + user.last_name : ''))
}));

import { sendToTelegram } from '../services/telegram.js';

describe('handleJoinRequest', () => {
    let mockEnv;
    let mockDb;
    let baseJoinRequest;

    // We will simulate DB prepare().bind().run()/.all() chains
    // A simplified way to track this is an array of executed queries
    let executedQueries = [];
    let mockQueryResult = { results: [] };

    beforeEach(() => {
        vi.clearAllMocks();
        executedQueries = [];
        mockQueryResult = { results: [{ c: 0 }] }; // Default to 0 attempts

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
                    }),
                    all: vi.fn(async () => {
                        executedQueries.push({ ...queryObj, type: 'all' });
                        // Return specific results based on query if needed
                        if (query.includes('SELECT last_insert_rowid()')) {
                            return { results: [{ id: 999 }] };
                        }
                        if (query.includes('SELECT COUNT(*)')) {
                            return mockQueryResult;
                        }
                        return { results: [] };
                    })
                };
                return chainable;
            })
        };

        mockEnv = {
            DB: mockDb,
            MOD_CHAT_ID: 'mod-123'
        };

        baseJoinRequest = {
            from: {
                id: 12345,
                first_name: 'John',
                last_name: 'Doe',
                username: 'johndoe'
            },
            chat: {
                id: -10012345,
                title: 'Test Chat'
            }
        };
    });

    it('should handle a normal request (0 spam attempts)', async () => {
        await handleJoinRequest(baseJoinRequest, mockEnv);

        // Verify DB queries
        expect(executedQueries.some(q => q.query.includes('SELECT COUNT(*) as c FROM requests'))).toBe(true);
        expect(executedQueries.some(q => q.query.includes('UPDATE requests SET status = ? WHERE user_id = ? AND chat_id = ? AND status = ?'))).toBe(true);
        expect(executedQueries.some(q => q.query.includes('INSERT INTO requests'))).toBe(true);
        expect(executedQueries.some(q => q.query.includes('INSERT INTO events') && q.params.includes('submitted'))).toBe(true);

        // Verify Telegram calls
        expect(sendToTelegram).toHaveBeenCalledTimes(1);
        expect(sendToTelegram).toHaveBeenCalledWith('sendMessage', {
            chat_id: 12345,
            text: MESSAGES.questions('Test Chat'),
            parse_mode: 'Markdown'
        }, mockEnv);
    });

    it('should send a warning if approaching spam limit', async () => {
        // Set attempt count to SPAM_WARNING_ATTEMPTS_START - 1
        mockQueryResult = { results: [{ c: CONFIG.SPAM_WARNING_ATTEMPTS_START - 1 }] };

        await handleJoinRequest(baseJoinRequest, mockEnv);

        // Still process the request
        expect(executedQueries.some(q => q.query.includes('INSERT INTO requests'))).toBe(true);

        // But send two messages: the questions, and the warning
        expect(sendToTelegram).toHaveBeenCalledTimes(2);

        const currentAttempt = CONFIG.SPAM_WARNING_ATTEMPTS_START;
        expect(sendToTelegram).toHaveBeenCalledWith('sendMessage', {
            chat_id: 12345,
            text: MESSAGES.spamWarning(currentAttempt)
        }, mockEnv);
    });

    it('should ban user and reject request if spam limit reached', async () => {
        // Set attempt count to SPAM_BAN_ATTEMPTS - 1
        const attempts = CONFIG.SPAM_BAN_ATTEMPTS - 1;
        mockQueryResult = { results: [{ c: attempts }] };

        await handleJoinRequest(baseJoinRequest, mockEnv);

        // Should ban chat member
        expect(sendToTelegram).toHaveBeenCalledWith('banChatMember', {
            chat_id: '-10012345',
            user_id: 12345
        }, mockEnv);

        // Should decline request
        expect(sendToTelegram).toHaveBeenCalledWith('declineChatJoinRequest', {
            chat_id: '-10012345',
            user_id: 12345
        }, mockEnv);

        // Should notify user
        expect(sendToTelegram).toHaveBeenCalledWith('sendMessage', {
            chat_id: 12345,
            text: MESSAGES.banned
        }, mockEnv);

        // Update existing requests to banned
        expect(executedQueries.some(q =>
            q.query.includes("UPDATE requests SET status = 'banned'") &&
            q.params[0] === 12345 &&
            q.params[1] === '-10012345'
        )).toBe(true);

        // Log spam ban event
        expect(executedQueries.some(q =>
            q.query.includes('INSERT INTO events') &&
            q.params[1] === 12345 &&
            q.params[2] === 'banned_spam'
        )).toBe(true);

        // Should notify moderators
        const safeUser = { ...baseJoinRequest.from };
        expect(sendToTelegram).toHaveBeenCalledWith('sendMessage', {
            chat_id: 'mod-123',
            text: MESSAGES.moderator.spamBan(safeUser, attempts + 1),
            parse_mode: 'Markdown'
        }, mockEnv);

        // Should NOT insert new request or log normal event
        expect(executedQueries.some(q => q.query.includes('INSERT INTO requests'))).toBe(false);
        expect(executedQueries.some(q => q.query.includes('INSERT INTO events') && q.params.includes('submitted'))).toBe(false);
    });

    it('should handle ban gracefully if MOD_CHAT_ID is missing', async () => {
        delete mockEnv.MOD_CHAT_ID;
        mockQueryResult = { results: [{ c: CONFIG.SPAM_BAN_ATTEMPTS - 1 }] };

        await handleJoinRequest(baseJoinRequest, mockEnv);

        // Banning calls should still happen
        expect(sendToTelegram).toHaveBeenCalledWith('banChatMember', expect.anything(), mockEnv);
        expect(sendToTelegram).toHaveBeenCalledWith('declineChatJoinRequest', expect.anything(), mockEnv);

        // Moderator notification should NOT happen (sendToTelegram called 3 times: ban, decline, user message)
        expect(sendToTelegram).toHaveBeenCalledTimes(3);
        expect(sendToTelegram).not.toHaveBeenCalledWith('sendMessage', expect.objectContaining({
            chat_id: 'mod-123'
        }), mockEnv);
    });
});
