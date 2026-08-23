import { env } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processRemindersAndTimeouts } from '../src/handlers/cron';

global.fetch = vi.fn();

describe('Cron Performance - Auto Forwarding', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        fetch.mockResolvedValue({
            json: () => Promise.resolve({ ok: true }),
            ok: true
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

    it('measures auto-forward performance with 1000 requests', async () => {
        const now = Math.floor(Date.now() / 1000);
        const requestDate = now - 2 * 3600; // 2 hours ago
        const answerDate = now - 3601; // slightly more than 1 hour ago
        const expiresAt = requestDate + 7 * 24 * 3600;

        // Insert 1000 answered requests that need auto-forwarding
        const insertStmt = env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status, answer_date, answer_text) VALUES (?, ?, ?, ?, ?, ?, ?)");
        const batch = [];
        for (let i = 0; i < 1000; i++) {
             batch.push(insertStmt.bind('-100', 101 + i, requestDate, expiresAt, 'answered', answerDate, 'Hello'));
        }
        await env.DB.batch(batch);

        const start = performance.now();
        await processRemindersAndTimeouts(env);
        const end = performance.now();

        console.log(`Processing 1000 auto-forwards took ${end - start} ms`);

        // Check if status changed to 'confirmed'
        const { count } = await env.DB.prepare('SELECT count(*) as count FROM requests WHERE status = ?').bind('confirmed').first();
        expect(count).toBe(1000);
    });
});
