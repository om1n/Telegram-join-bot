import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDuplicates } from './database.js';

describe('database - cleanupDuplicates', () => {
    beforeEach(async () => {
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

        await env.DB.prepare('DELETE FROM requests').run();
    });

    it('should mark older pending requests as superseded for the same user and chat', async () => {
        // Insert multiple requests
        await env.DB.prepare(`INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status) VALUES
            (1, 'chat1', 101, 1000, 2000, 'pending'),
            (2, 'chat1', 101, 1010, 2010, 'pending'),
            (3, 'chat1', 101, 1020, 2020, 'pending'),
            (4, 'chat2', 101, 1000, 2000, 'pending'),
            (5, 'chat2', 101, 1010, 2010, 'pending'),
            (6, 'chat1', 102, 1000, 2000, 'pending'),
            (7, 'chat1', 103, 1000, 2000, 'answered')
        `).run();

        await cleanupDuplicates(env.DB);

        // Fetch results
        const { results } = await env.DB.prepare('SELECT id, status FROM requests ORDER BY id ASC').all();

        expect(results).toEqual([
            { id: 1, status: 'superseded' },
            { id: 2, status: 'superseded' },
            { id: 3, status: 'pending' },
            { id: 4, status: 'superseded' },
            { id: 5, status: 'pending' },
            { id: 6, status: 'pending' },
            { id: 7, status: 'answered' }
        ]);
    });
});
