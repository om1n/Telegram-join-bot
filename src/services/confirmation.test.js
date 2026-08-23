import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { confirmRequest } from './confirmation.js';
import * as telegramService from './telegram.js';
import { MESSAGES } from '../messages.js';

vi.mock('./telegram.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        sendToTelegram: vi.fn(),
        getChatInfo: vi.fn()
    };
});

describe('confirmation service - confirmRequest', () => {
    const mockReq = {
        id: 1,
        chat_id: 'chat123',
        username: 'testuser',
        display_name: 'Test User',
        answer_text: 'My answer',
        request_date: 1000,
        expires_at: 2000
    };

    const mockUserId = 12345;

    beforeEach(async () => {
        vi.clearAllMocks();

        // Setup DB
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

        await env.DB.prepare(`INSERT INTO requests (id, chat_id, user_id, request_date, expires_at, status, answer_text) VALUES
            (1, 'chat123', 12345, 1000, 2000, 'pending', 'My answer')
        `).run();

        env.MOD_CHAT_ID = 'mod_chat_456';
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should confirm request normally and send notifications', async () => {
        telegramService.getChatInfo.mockResolvedValue({ title: 'Test Group', username: 'testgroup' });
        telegramService.sendToTelegram.mockResolvedValue({});

        await confirmRequest(mockReq, mockUserId, env, false);

        // Check DB update
        const reqResult = await env.DB.prepare('SELECT status, confirmed_date FROM requests WHERE id = 1').first();
        expect(reqResult.status).toBe('confirmed');
        expect(reqResult.confirmed_date).toBeGreaterThan(0);

        // Check event insertion
        const eventResult = await env.DB.prepare('SELECT event_type, data FROM events WHERE request_id = 1').first();
        expect(eventResult.event_type).toBe('confirmed');
        const eventData = JSON.parse(eventResult.data);
        expect(eventData.auto_forward).toBe(false);

        // Check telegram calls
        expect(telegramService.getChatInfo).toHaveBeenCalledWith('chat123', env);

        expect(telegramService.sendToTelegram).toHaveBeenCalledTimes(2);

        // First call is to moderators
        expect(telegramService.sendToTelegram).toHaveBeenNthCalledWith(1, 'sendMessage', expect.objectContaining({
            chat_id: 'mod_chat_456',
            parse_mode: 'Markdown'
        }), env);

        // Second call is to user
        expect(telegramService.sendToTelegram).toHaveBeenNthCalledWith(2, 'sendMessage', expect.objectContaining({
            chat_id: mockUserId,
            text: MESSAGES.sentToModerators
        }), env);
    });

    it('should confirm request as auto-forwarded and send notifications', async () => {
        telegramService.getChatInfo.mockResolvedValue(null); // test when chat info is not available
        telegramService.sendToTelegram.mockResolvedValue({});

        await confirmRequest(mockReq, mockUserId, env, true);

        // Check DB update
        const reqResult = await env.DB.prepare('SELECT status, confirmed_date FROM requests WHERE id = 1').first();
        expect(reqResult.status).toBe('confirmed');

        // Check event insertion
        const eventResult = await env.DB.prepare('SELECT event_type, data FROM events WHERE request_id = 1').first();
        expect(eventResult.event_type).toBe('confirmed');
        const eventData = JSON.parse(eventResult.data);
        expect(eventData.auto_forward).toBe(true);

        // Check telegram calls
        expect(telegramService.getChatInfo).toHaveBeenCalledWith('chat123', env);

        expect(telegramService.sendToTelegram).toHaveBeenCalledTimes(2);

        // Second call is to user with auto-forward message
        expect(telegramService.sendToTelegram).toHaveBeenNthCalledWith(2, 'sendMessage', expect.objectContaining({
            chat_id: mockUserId,
            text: MESSAGES.autoForwardedMessage
        }), env);
    });
});
