import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, vi, beforeEach } from 'vitest';
import { processRemindersAndTimeouts } from '../src/handlers/cron.js';

// Mock fetch for Telegram API calls
global.fetch = vi.fn();

describe('Benchmark processRemindersAndTimeouts', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        fetch.mockImplementation(async () => {
            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 50));
            return {
                json: () => Promise.resolve({ ok: true }),
                ok: true
            };
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

    it('benchmarks auto-forwarding', async () => {
        const now = Math.floor(Date.now() / 1000);
        const twoHoursAgo = now - 7200;

        // Insert 20 answered requests that need auto-forwarding
        const stmt = env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, answer_date, expires_at, status) VALUES (?, ?, ?, ?, ?, ?)");
        const batch = [];
        for (let i = 0; i < 20; i++) {
            batch.push(stmt.bind('-100', 1000 + i, twoHoursAgo - 1000, twoHoursAgo, now + 10000, 'answered'));
        }
        await env.DB.batch(batch);

        const start = performance.now();
        await processRemindersAndTimeouts(env);
        const end = performance.now();

        console.log(`[BENCHMARK] auto-forwarding 20 requests took: ${end - start} ms`);
    });
});
