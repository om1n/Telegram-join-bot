import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMessage } from './message';

// Mock fetch for all Telegram API calls
global.fetch = vi.fn();

describe('handleAdminCommand - Other Commands', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        env.MOD_CHAT_ID = '-100999';
        env.ADMIN_USER_ID = '999999';
        env.TELEGRAM_BOT_TOKEN = 'test_token';
        env.WEBHOOK_SECRET = 'test_secret';

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

        fetch.mockImplementation((url, options) => {
            return Promise.resolve({
                json: () => Promise.resolve({ ok: true, result: {} }),
                ok: true,
            });
        });
    });

    const createAdminMessage = (text) => ({
        text,
        chat: { type: 'private', id: 999999 },
        from: { id: 999999 },
    });

    it('handles /status command correctly', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)"
        ).bind('-1001', 123, now - 100, now + 86400, 'pending').run();
        await env.DB.prepare(
            "INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)"
        ).bind('-1001', 124, now - 100, now + 86400, 'pending').run();

        await handleMessage(createAdminMessage('/status'), env);

        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        expect(sendMessageCall).toBeDefined();
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toBe('Активных (pending) заявок: 2');
    });

    it('handles /pending command correctly with empty list', async () => {
        await handleMessage(createAdminMessage('/pending'), env);
        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toBe('Пусто');
    });

    it('handles /pending command correctly with active requests', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, username, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(1, '-1001', 123, 'user123', now - 100, now + 86400, 'pending').run();

        await handleMessage(createAdminMessage('/pending'), env);
        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toContain('ID:1 UID:123 @user123');
        expect(body.text).toContain('Ответ:Нет');
    });

    it('handles /config command correctly', async () => {
        await handleMessage(createAdminMessage('/config'), env);
        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toBe('MOD_CHAT_ID=-100999\nADMIN_USER_ID=999999');
    });

    it('handles /help command correctly', async () => {
        await handleMessage(createAdminMessage('/help'), env);
        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toContain('/status — количество активных заявок');
    });

    it('handles /cleanup command correctly', async () => {
        await handleMessage(createAdminMessage('/cleanup'), env);
        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toBe('Cleanup done.');
    });

    it('handles /force_cron command correctly', async () => {
        await handleMessage(createAdminMessage('/force_cron'), env);
        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toContain('Cron tasks executed manually.');
        expect(body.text).toContain('Reminders: 0');
        expect(body.text).toContain('Timeouts: 0');
    });

    it('handles unknown admin commands correctly', async () => {
        await handleMessage(createAdminMessage('/unknown_command_here'), env);
        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toBe('Неизвестная команда. /help');
    });
});

describe('handleAdminCommand - /reject', () => {
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

        fetch.mockImplementation((url, options) => {
            return Promise.resolve({
                json: () => Promise.resolve({ ok: true, result: {} }),
                ok: true,
            });
        });
    });

    const createAdminMessage = (text) => ({
        text,
        chat: { type: 'private', id: 999999 },
        from: { id: 999999 },
    });

    it('returns usage message if user ID is not provided', async () => {
        // Sending '/reject a b' bypasses trim() cutting out trailing space, and text becomes '/reject a b'.
        // To test handleRejectCommand('a b', chat_id, env), we should actually test '/reject' falling through?
        // Wait, the prompt says test handleRejectCommand. It's exported? No, it's not exported.
        // If we send `/reject a` where `a` is not an ID but rather we want no target user ID...
        // Actually, if we send `/reject` (without space), `text.startsWith('/reject ')` is false, it falls to unknown command.
        // We can just call handleRejectCommand directly? No, it's not exported.
        // In the handler it splits by space, and accesses `parts[1]`.
        // If we send `'/reject '`, trim() makes it `'/reject'`.
        // If we send `'/reject  '`, trim makes it `'/reject'`.
        // Is there any way `text` inside `handleRejectCommand` has `text.split(' ')[1]` as falsy when called from `handleAdminCommand`?
        // Yes, if we send `'/reject a'` but then there's no way. Wait. Wait. Wait.
        // What if we don't send a message? What if we bypass the `trim()` logic?
        // We can't bypass `trim()` logic from `handleMessage`.
        // If we send `'/reject  '` it's trimmed to `'/reject'`.
        // But what if we send `'/reject \n'` ? Wait, trim() removes \n.
        // The implementation in `handleMessage`: `if (text.startsWith('/reject ')) { await handleRejectCommand(text, chat_id, env); }`
        // Wait! If `trim()` removes trailing spaces, `text` will NEVER start with `'/reject '` if it's just `'/reject '`!
        // It must have something AFTER the space.
        // So how can `targetUserId` ever be empty when it enters `handleRejectCommand`?
        // Actually, `text` in `handleAdminCommand` is the trimmed text.
        // If the user sends `/reject `, `text` is `/reject`.
        // `text.startsWith('/reject ')` will be false!
        // So the `if (!targetUserId)` branch inside `handleRejectCommand` is theoretically UNREACHABLE via `handleMessage`!
        // UNLESS... wait, what if the user sends `/reject  a` (double space)?
        // Then `text` is `/reject  a`.
        // `text.split(' ')` is `['/reject', '', 'a']`.
        // `text.split(' ')[1]` is `''`, which is falsy!
        await handleMessage(createAdminMessage('/reject  a'), env);

        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        expect(sendMessageCall).toBeDefined();
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toBe('Usage: /reject <user_id>');
    });

    it('returns not found message if user has no pending/answered requests', async () => {
        await handleMessage(createAdminMessage('/reject 123'), env);

        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        expect(sendMessageCall).toBeDefined();
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toBe('No pending requests found for user 123');
    });

    it('successfully rejects requests and updates database', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(1, '-1001', 123, now - 100, now + 86400, 'pending').run();

        await handleMessage(createAdminMessage('/reject 123'), env);

        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        expect(sendMessageCall).toBeDefined();
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toBe('Rejected 1 requests for user 123.');

        const dbResult = await env.DB.prepare('SELECT status FROM requests WHERE id = 1').first();
        expect(dbResult.status).toBe('rejected');

        const eventResult = await env.DB.prepare('SELECT event_type FROM events WHERE request_id = 1').first();
        expect(eventResult.event_type).toBe('admin_rejected');
    });

    it('successfully rejects multiple requests for the same user', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(1, '-1001', 123, now - 100, now + 86400, 'pending').run();
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(2, '-1002', 123, now - 100, now + 86400, 'answered').run();

        await handleMessage(createAdminMessage('/reject 123'), env);

        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toBe('Rejected 2 requests for user 123.');

        const dbResults = await env.DB.prepare('SELECT status FROM requests ORDER BY id').all();
        expect(dbResults.results[0].status).toBe('rejected');
        expect(dbResults.results[1].status).toBe('rejected');
    });

    it('handles HIDE_REQUESTER_MISSING correctly', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(1, '-1001', 123, now - 100, now + 86400, 'pending').run();

        fetch.mockImplementation((url, options) => {
            if (url.includes('declineChatJoinRequest')) {
                return Promise.resolve({
                    json: () => Promise.resolve({ ok: false, description: 'HIDE_REQUESTER_MISSING' }),
                    ok: true,
                });
            }
            return Promise.resolve({
                json: () => Promise.resolve({ ok: true, result: {} }),
                ok: true,
            });
        });

        await handleMessage(createAdminMessage('/reject 123'), env);

        const dbResult = await env.DB.prepare('SELECT status FROM requests WHERE id = 1').first();
        expect(dbResult.status).toBe('rejected');

        const eventResult = await env.DB.prepare('SELECT event_type FROM events WHERE request_id = 1').first();
        expect(eventResult.event_type).toBe('admin_rejected_missing');
    });

    it('handles generic API error gracefully', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(1, '-1001', 123, now - 100, now + 86400, 'pending').run();

        fetch.mockImplementation((url, options) => {
            if (url.includes('declineChatJoinRequest')) {
                return Promise.resolve({
                    json: () => Promise.resolve({ ok: false, description: 'Some generic error' }),
                    ok: true,
                });
            }
            return Promise.resolve({
                json: () => Promise.resolve({ ok: true, result: {} }),
                ok: true,
            });
        });

        await handleMessage(createAdminMessage('/reject 123'), env);

        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toContain('Failed: 1');
        expect(body.text).toContain('API Error: Some generic error');

        const dbResult = await env.DB.prepare('SELECT status FROM requests WHERE id = 1').first();
        expect(dbResult.status).toBe('pending');
    });

    it('handles manual reject exception thrown by sendToTelegram', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(1, '-1001', 123, now - 100, now + 86400, 'pending').run();

        fetch.mockImplementation((url, options) => {
            if (url.includes('declineChatJoinRequest')) {
                throw new Error('Unexpected exception during fetch');
            }
            return Promise.resolve({
                json: () => Promise.resolve({ ok: true, result: {} }),
                ok: true,
            });
        });

        await handleMessage(createAdminMessage('/reject 123'), env);

        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toContain('Pending status kept. Net error: Unexpected exception during fetch');

        const dbResult = await env.DB.prepare('SELECT status FROM requests WHERE id = 1').first();
        expect(dbResult.status).toBe('pending');
    });

    it('handles manual reject network error and keeps pending status', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(1, '-1001', 123, now - 100, now + 86400, 'pending').run();

        fetch.mockImplementation((url, options) => {
            if (url.includes('declineChatJoinRequest')) {
                return Promise.reject(new Error('Network failure'));
            }
            return Promise.resolve({
                json: () => Promise.resolve({ ok: true, result: {} }),
                ok: true,
            });
        });

        await handleMessage(createAdminMessage('/reject 123'), env);

        const sendMessageCall = fetch.mock.calls.find(call => call[0].includes('sendMessage'));
        const body = JSON.parse(sendMessageCall[1].body);
        expect(body.text).toContain('Pending status kept. Net error: Network failure');

        const dbResult = await env.DB.prepare('SELECT status FROM requests WHERE id = 1').first();
        expect(dbResult.status).toBe('pending');
    });
});
