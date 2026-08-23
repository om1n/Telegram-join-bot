import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processRemindersAndTimeouts } from '../src/handlers/cron';

global.fetch = vi.fn();

describe('Cron Performance', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        fetch.mockImplementation(() => {
            return new Promise(resolve => {
                setTimeout(() => {
                    resolve({
                        json: () => Promise.resolve({ ok: true }),
                        ok: true
                    });
                }, 10);
            });
        });

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

    it('measures reminder performance', async () => {
        const now = Math.floor(Date.now() / 1000);
        const requestDate = now - 25 * 3600; // 25 hours ago
        const expiresAt = requestDate + 7 * 24 * 3600;

        // Insert 200 requests that need reminders
        const insertStmt = env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)");
        const batch = [];
        for (let i = 0; i < 200; i++) {
             batch.push(insertStmt.bind('-100', 101 + i, requestDate, expiresAt, 'pending'));
        }
        await env.DB.batch(batch);

        const start = performance.now();
        await processRemindersAndTimeouts(env);
        const end = performance.now();

        console.log(`Processing 200 reminders took ${end - start} ms`);

        // Assert we actually did the work
        const { count } = await env.DB.prepare('SELECT count(*) as count FROM events WHERE event_type = ?').bind('reminder_sent').first();
        expect(count).toBe(200);
    });
});
