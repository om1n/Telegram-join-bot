import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/worker';
import { MESSAGES } from '../src/messages';

// Mock fetch for Telegram API calls
global.fetch = vi.fn();

describe('Daily Reminders Logic', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true }),
            ok: true
        });

        // Mock env vars
        env.MOD_CHAT_ID = '-100999';
        env.ADMIN_USER_ID = '123456';
        env.TELEGRAM_BOT_TOKEN = 'test_token';

        // Apply schema with new column
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

        // Clear tables
        await env.DB.prepare('DELETE FROM requests').run();
        await env.DB.prepare('DELETE FROM events').run();
    });

    it('sends daily reminder if first time (> 24h)', async () => {
        const now = Math.floor(Date.now() / 1000);
        const requestDate = now - 25 * 3600; // 25 hours ago
        const expiresAt = requestDate + 7 * 24 * 3600;

        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', 101, requestDate, expiresAt, 'pending').run();

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        // Check DB: last_reminder_ts should be updated
        const { results: [req] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(101).all();
        expect(req.last_reminder_ts).toBeGreaterThan(now - 10);

        // Check message
        // Days left: roughly 6 days (7 - 1)
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining('У вас осталось 6 дней')
            })
        );
    });

    it('sends daily reminder if 24h passed since last reminder', async () => {
        const now = Math.floor(Date.now() / 1000);
        const requestDate = now - 49 * 3600; // 49 hours ago (2 days + 1 hour)
        const lastReminder = now - 25 * 3600; // 25 hours ago
        const expiresAt = requestDate + 7 * 24 * 3600;

        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status, last_reminder_ts) VALUES (?, ?, ?, ?, ?, ?)")
            .bind('-100', 102, requestDate, expiresAt, 'pending', lastReminder).run();

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        // Check DB
        const { results: [req] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(102).all();
        expect(req.last_reminder_ts).toBeGreaterThan(now - 10);

        // Check message
        // Days left: roughly 5 days (7 - 2)
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining('У вас осталось 5 дней')
            })
        );
    });

    it('does NOT send reminder if < 24h passed since last reminder', async () => {
        const now = Math.floor(Date.now() / 1000);
        const requestDate = now - 48 * 3600;
        const lastReminder = now - 10 * 3600; // 10 hours ago
        const expiresAt = requestDate + 7 * 24 * 3600;

        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status, last_reminder_ts) VALUES (?, ?, ?, ?, ?, ?)")
            .bind('-100', 103, requestDate, expiresAt, 'pending', lastReminder).run();

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        // Check DB: last_reminder_ts should NOT verify changed
        const { results: [req] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(103).all();
        expect(req.last_reminder_ts).toBe(lastReminder);

        expect(fetch).not.toHaveBeenCalled();
    });

    it('does NOT send reminder if request is too fresh (< 24h)', async () => {
        const now = Math.floor(Date.now() / 1000);
        const requestDate = now - 10 * 3600; // 10 hours ago
        const expiresAt = requestDate + 7 * 24 * 3600;

        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', 104, requestDate, expiresAt, 'pending').run();

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        expect(fetch).not.toHaveBeenCalled();
    });

    it('correctly calculates remaining days (1 day left)', async () => {
        const now = Math.floor(Date.now() / 1000);
        // User requested 6 days ago (1 day left)
        const requestDate = now - 6 * 24 * 3600 - 100;
        const expiresAt = requestDate + 7 * 24 * 3600;

        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', 105, requestDate, expiresAt, 'pending').run(); // last_reminder_ts is null logic

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                // "1 день" or "1 days" check
                body: expect.stringContaining('осталось 1 день')
            })
        );
    });
});
