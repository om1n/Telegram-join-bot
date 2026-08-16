import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCallbackQuery } from './callback';

// Mock fetch for all Telegram API calls
global.fetch = vi.fn();

describe('handleCallbackQuery', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true, result: {} }),
            ok: true,
        });

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

    const baseCallback = {
        id: 'callback_123',
        from: { id: 42 },
        message: {
            message_id: 100,
            chat: { id: 42 }
        },
        data: 'confirm_1'
    };

    it('always calls answerCallbackQuery to remove loading state', async () => {
        await handleCallbackQuery(baseCallback, env);

        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, options] = fetch.mock.calls[0];
        expect(url).toContain('/answerCallbackQuery');
        const body = JSON.parse(options.body);
        expect(body.callback_query_id).toBe('callback_123');
    });

    it('processes happy path when request exists and is "answered"', async () => {
        // Insert a request with status 'answered'
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(1, '-100', 42, now - 100, now + 86400, 'answered').run();

        await handleCallbackQuery(baseCallback, env);

        // Fetch should be called for:
        // 1. answerCallbackQuery
        // 2. editMessageReplyMarkup
        // 3. confirmRequest -> getChatInfo (getChat)
        // 4. confirmRequest -> sendMessage (moderators)
        // 5. confirmRequest -> sendMessage (user)

        // Let's verify answerCallbackQuery
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/answerCallbackQuery'),
            expect.any(Object)
        );

        // Verify editMessageReplyMarkup is called
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/editMessageReplyMarkup'),
            expect.objectContaining({
                body: expect.stringContaining('"inline_keyboard":[]')
            })
        );

        // Verify confirmRequest changed the status to 'confirmed'
        const dbResult = await env.DB.prepare('SELECT status FROM requests WHERE id = 1').first();
        expect(dbResult.status).toBe('confirmed');
    });

    it('ignores invalid callback data not starting with confirm_', async () => {
        const invalidCallback = { ...baseCallback, data: 'other_action_1' };
        await handleCallbackQuery(invalidCallback, env);

        // Only answerCallbackQuery should be called
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/answerCallbackQuery'),
            expect.any(Object)
        );
    });

    it('ignores if request ID from confirm_{id} does not exist in DB', async () => {
        const nonExistentCallback = { ...baseCallback, data: 'confirm_999' };
        await handleCallbackQuery(nonExistentCallback, env);

        // Only answerCallbackQuery should be called
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/answerCallbackQuery'),
            expect.any(Object)
        );
    });

    it('ignores if request exists but status is not "answered"', async () => {
        // Insert a request with status 'pending'
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(1, '-100', 42, now - 100, now + 86400, 'pending').run();

        await handleCallbackQuery(baseCallback, env);

        // Only answerCallbackQuery should be called
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/answerCallbackQuery'),
            expect.any(Object)
        );

        // Status should remain 'pending'
        const dbResult = await env.DB.prepare('SELECT status FROM requests WHERE id = 1').first();
        expect(dbResult.status).toBe('pending');
    });
});
