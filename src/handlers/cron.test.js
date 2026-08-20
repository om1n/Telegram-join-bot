import { env } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processRemindersAndTimeouts } from './cron.js';
import { CONFIG } from '../config.js';

// Mock fetch for all Telegram API calls
global.fetch = vi.fn();

describe('processRemindersAndTimeouts', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true, result: {} }),
            ok: true,
        });

        env.MOD_CHAT_ID = '-100999';
        env.ADMIN_USER_ID = '999999';
        env.TELEGRAM_BOT_TOKEN = 'test_token';
        env.DEBUG = 'false';

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

    it('auto-forwards answered requests older than 1 hour', async () => {
        const now = Math.floor(Date.now() / 1000);
        const twoHoursAgo = now - 7200;

        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status, answer_date, answer_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(1, '-100', 42, now - 86400, now + 86400, 'answered', twoHoursAgo, 'my answer').run();

        const stats = await processRemindersAndTimeouts(env);

        expect(stats.autoForwardsProcessed).toBe(1);

        const request = await env.DB.prepare('SELECT status FROM requests WHERE id = 1').first();
        expect(request.status).toBe('confirmed');

        const event = await env.DB.prepare('SELECT event_type FROM events WHERE request_id = 1').first();
        expect(event.event_type).toBe('confirmed');
    });

    it('does not auto-forward answered requests newer than 1 hour', async () => {
        const now = Math.floor(Date.now() / 1000);
        const thirtyMinsAgo = now - 1800;

        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status, answer_date, answer_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(1, '-100', 42, now - 86400, now + 86400, 'answered', thirtyMinsAgo, 'my answer').run();

        const stats = await processRemindersAndTimeouts(env);

        expect(stats.autoForwardsProcessed).toBe(0);

        const request = await env.DB.prepare('SELECT status FROM requests WHERE id = 1').first();
        expect(request.status).toBe('answered');
    });

    it('processes daily reminders for pending requests older than the interval', async () => {
        const now = Math.floor(Date.now() / 1000);
        const twoDaysAgo = now - (2 * 24 * 3600);
        const expiration = now + (5 * 24 * 3600); // 5 days from now

        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(2, '-100', 42, twoDaysAgo, expiration, 'pending').run();

        const stats = await processRemindersAndTimeouts(env);

        expect(stats.remindersSent).toBe(1);

        const request = await env.DB.prepare('SELECT last_reminder_ts FROM requests WHERE id = 2').first();
        expect(request.last_reminder_ts).toBeGreaterThan(0);

        const event = await env.DB.prepare('SELECT event_type FROM events WHERE request_id = 2').first();
        expect(event.event_type).toBe('reminder_sent');

        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining('"chat_id":42')
            })
        );
    });

    it('does not process reminders if already sent recently', async () => {
        const now = Math.floor(Date.now() / 1000);
        const twoDaysAgo = now - (2 * 24 * 3600);
        const twoHoursAgo = now - 7200;
        const expiration = now + (5 * 24 * 3600);

        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status, last_reminder_ts) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(3, '-100', 42, twoDaysAgo, expiration, 'pending', twoHoursAgo).run();

        const stats = await processRemindersAndTimeouts(env);

        expect(stats.remindersSent).toBe(0);
    });

    it('processes timeouts for expired pending requests (happy path)', async () => {
        const now = Math.floor(Date.now() / 1000);
        const expired = now - 3600; // expired 1 hour ago

        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, username, display_name, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(4, '-100', 42, 'testuser', 'Test User', now - 86400, expired, 'pending').run();

        const stats = await processRemindersAndTimeouts(env);

        expect(stats.timeoutsProcessed).toBe(1);

        const request = await env.DB.prepare('SELECT status FROM requests WHERE id = 4').first();
        expect(request.status).toBe('timed_out');

        const event = await env.DB.prepare('SELECT event_type FROM events WHERE request_id = 4').first();
        expect(event.event_type).toBe('auto_rejected');

        // Check for declineChatJoinRequest call
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/declineChatJoinRequest'),
            expect.objectContaining({
                body: expect.stringContaining('"chat_id":"-100"')
            })
        );

        // Check for message to user
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining('"chat_id":42')
            })
        );

        // Check for message to moderator
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining('"chat_id":"-100999"') // MOD_CHAT_ID
            })
        );
    });

    it('processes timeouts - handles network error when declining', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(5, '-100', 42, now - 86400, now - 3600, 'pending').run();

        fetch.mockRejectedValueOnce(new Error('Network failure'));

        const stats = await processRemindersAndTimeouts(env);

        expect(stats.timeoutsProcessed).toBe(0);
        expect(stats.errors.length).toBe(1);
        expect(stats.errors[0]).toContain('Net error for 42: Network failure');

        const request = await env.DB.prepare('SELECT status FROM requests WHERE id = 5').first();
        expect(request.status).toBe('pending');
    });

    it('processes timeouts - handles USER_ID_INVALID error', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(6, '-100', 42, now - 86400, now - 3600, 'pending').run();

        fetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ ok: false, description: 'Bad Request: USER_ID_INVALID' }),
            ok: true, // The mock implementation in code checks result.ok
        });

        const stats = await processRemindersAndTimeouts(env);

        expect(stats.timeoutsProcessed).toBe(1);

        const request = await env.DB.prepare('SELECT status FROM requests WHERE id = 6').first();
        expect(request.status).toBe('user_missing_or_banned');
    });

    it('processes timeouts - handles HIDE_REQUESTER_MISSING error', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(7, '-100', 42, now - 86400, now - 3600, 'pending').run();

        fetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ ok: false, description: 'Bad Request: HIDE_REQUESTER_MISSING' }),
            ok: true,
        });

        const stats = await processRemindersAndTimeouts(env);

        expect(stats.timeoutsProcessed).toBe(1);

        const request = await env.DB.prepare('SELECT status FROM requests WHERE id = 7').first();
        expect(request.status).toBe('request_no_longer_valid');
    });

    it('processes timeouts - handles generic API errors', async () => {
        const now = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(8, '-100', 42, now - 86400, now - 3600, 'pending').run();

        fetch.mockResolvedValueOnce({
            json: () => Promise.resolve({ ok: false, description: 'Some other error' }),
            ok: true,
        });

        const stats = await processRemindersAndTimeouts(env);

        expect(stats.timeoutsProcessed).toBe(0);
        expect(stats.errors.length).toBe(1);
        expect(stats.errors[0]).toContain('API Error for 42: Some other error');

        const request = await env.DB.prepare('SELECT status FROM requests WHERE id = 8').first();
        expect(request.status).toBe('pending');
    });

    it('cleans up duplicate pending requests', async () => {
        const now = Math.floor(Date.now() / 1000);

        // Insert three requests for the same user/chat. The two older ones should be superseded.
        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(9, '-100', 42, now, now + 86400, 'pending').run();

        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(10, '-100', 42, now, now + 86400, 'pending').run();

        await env.DB.prepare(
            "INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(11, '-100', 42, now, now + 86400, 'pending').run();

        await processRemindersAndTimeouts(env);

        const req9 = await env.DB.prepare('SELECT status FROM requests WHERE id = 9').first();
        const req10 = await env.DB.prepare('SELECT status FROM requests WHERE id = 10').first();
        const req11 = await env.DB.prepare('SELECT status FROM requests WHERE id = 11').first();

        expect(req9.status).toBe('superseded');
        expect(req10.status).toBe('superseded');
        expect(req11.status).toBe('pending');
    });
});
