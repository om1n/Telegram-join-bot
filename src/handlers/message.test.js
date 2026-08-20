import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMessage } from './message';

// Mock fetch for all Telegram API calls
global.fetch = vi.fn();

describe('handleAdminCommand - error handling', () => {
    beforeEach(async () => {
        vi.clearAllMocks();

        env.MOD_CHAT_ID = '-100999';
        env.ADMIN_USER_ID = '999999';
        env.TELEGRAM_BOT_TOKEN = 'test_token';

        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            username TEXT,
            display_name TEXT,
            request_date INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            answer_text TEXT,
            answer_date INTEGER,
            confirmed_date INTEGER,
            reminder_3_sent INTEGER DEFAULT 0,
            reminder_6_sent INTEGER DEFAULT 0,
            last_reminder_ts INTEGER
        )`).run();

        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id INTEGER,
            user_id INTEGER,
            event_type TEXT,
            event_ts INTEGER,
            data TEXT
        )`).run();

        await env.DB.prepare('DELETE FROM requests').run();
        await env.DB.prepare('DELETE FROM events').run();
    });

    it('handles manual reject error and keeps pending status', async () => {
        // 1. Insert a pending request for user 123
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(1, '-1001', 123, now - 100, now + 86400, 'pending').run();

        // 2. Mock fetch to throw a network error for declineChatJoinRequest,
        // but succeed for sendMessage (to send the result back to the admin).
        fetch.mockImplementation((url, options) => {
            if (url.includes('declineChatJoinRequest')) {
                return Promise.reject(new Error('Network failure'));
            }
            return Promise.resolve({
                json: () => Promise.resolve({ ok: true, result: {} }),
                ok: true,
            });
        });

        const adminMessage = {
            text: '/reject 123',
            chat: { type: 'private', id: 999999 },
            from: { id: 999999 },
        };

        // 3. Call the handler
        await handleMessage(adminMessage, env);

        // 4. Verify fetch was called with declineChatJoinRequest and sendMessage
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('declineChatJoinRequest'),
            expect.any(Object)
        );

        // Check the admin response contains the error string
        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        expect(sendMessageCall).toBeDefined();
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toContain('Rejected 0 requests for user 123');
        expect(body.text).toContain('Failed: 1');
        expect(body.text).toContain('Errors:\nPending status kept. Net error: Network failure');

        // 5. Verify the DB status is still pending
        const dbResult = await env.DB.prepare('SELECT status FROM requests WHERE id = 1').first();
        expect(dbResult.status).toBe('pending');
    });
});
