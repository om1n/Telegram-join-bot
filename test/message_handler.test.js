import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/worker';

// Mock fetch for all Telegram API calls
global.fetch = vi.fn();

const GROUP_LINK = 'https://t.me/fintechprod';

describe('handleMessage — no pending request', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true }),
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

    it('replies with noPendingRequest text when user has no active request', async () => {
        const update = {
            message: {
                message_id: 1,
                from: { id: 42, is_bot: false, first_name: 'Alice' },
                chat: { id: 42, type: 'private' },
                text: 'Привет',
                date: Math.floor(Date.now() / 1000),
            },
        };

        const request = new Request('https://example.com/', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(update),
        });

        const ctx = createExecutionContext();
        await worker.fetch(request, env, ctx);
        await waitOnExecutionContext(ctx);

        expect(fetch).toHaveBeenCalledTimes(1);

        const [, callOptions] = fetch.mock.calls[0];
        const body = JSON.parse(callOptions.body);

        // Correct API method
        expect(fetch.mock.calls[0][0]).toContain('/sendMessage');

        // Target user
        expect(body.chat_id).toBe(42);

        // Message renders with Markdown
        expect(body.parse_mode).toBe('Markdown');

        // Text contains key phrases
        expect(body.text).toContain('активной заявки');
        expect(body.text).toContain('Подать заявку на вступление');
        expect(body.text).toContain('продакт-менеджеров');
        expect(body.text).toContain('запрещены');

        // Inline keyboard with correct URL
        expect(body.reply_markup).toBeDefined();
        const button = body.reply_markup.inline_keyboard[0][0];
        expect(button.url).toBe(GROUP_LINK);
        expect(button.text).toContain('Подать заявку');
    });

    it('does NOT send noPendingRequest when user has a pending request', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)"
        ).bind('-100', 42, now - 100, now + 7 * 86400, 'pending').run();

        const update = {
            message: {
                message_id: 2,
                from: { id: 42, is_bot: false, first_name: 'Alice' },
                chat: { id: 42, type: 'private' },
                text: 'Я продакт-менеджер в финтехе',
                date: now,
            },
        };

        const request = new Request('https://example.com/', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(update),
        });

        const ctx = createExecutionContext();
        await worker.fetch(request, env, ctx);
        await waitOnExecutionContext(ctx);

        // Should reply with confirmation, not noPendingRequest
        const [, callOptions] = fetch.mock.calls[0];
        const body = JSON.parse(callOptions.body);
        expect(body.text).not.toContain('активной заявки');
        // Now it SHOULD HAVE reply_markup
        expect(body.reply_markup).toBeDefined();
        expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('confirm_1');
    });
});
