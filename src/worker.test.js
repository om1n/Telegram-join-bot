import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './worker.js';
import { processRemindersAndTimeouts } from './handlers/cron.js';
import { handleJoinRequest } from './handlers/join.js';
import { handleMessage } from './handlers/message.js';
import { handleChatMember } from './handlers/member.js';
import { handleCallbackQuery } from './handlers/callback.js';

vi.mock('./handlers/cron.js', () => ({
    processRemindersAndTimeouts: vi.fn()
}));
vi.mock('./handlers/join.js', () => ({ handleJoinRequest: vi.fn() }));
vi.mock('./handlers/message.js', () => ({ handleMessage: vi.fn() }));
vi.mock('./handlers/member.js', () => ({ handleChatMember: vi.fn() }));
vi.mock('./handlers/callback.js', () => ({ handleCallbackQuery: vi.fn() }));

describe('Worker Webhook Routing', () => {
    const env = { WEBHOOK_SECRET: 'secret123' };
    const headers = { 'X-Telegram-Bot-Api-Secret-Token': 'secret123' };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should route chat_join_request', async () => {
        const payload = { chat_join_request: { id: 1 } };
        const request = new Request('http://localhost', { method: 'POST', headers, body: JSON.stringify(payload) });
        const response = await worker.fetch(request, env);
        expect(response.status).toBe(200);
        expect(handleJoinRequest).toHaveBeenCalledWith(payload.chat_join_request, env);
    });

    it('should route message', async () => {
        const payload = { message: { message_id: 1 } };
        const request = new Request('http://localhost', { method: 'POST', headers, body: JSON.stringify(payload) });
        const response = await worker.fetch(request, env);
        expect(response.status).toBe(200);
        expect(handleMessage).toHaveBeenCalledWith(payload.message, env);
    });

    it('should route chat_member', async () => {
        const payload = { chat_member: { date: 1 } };
        const request = new Request('http://localhost', { method: 'POST', headers, body: JSON.stringify(payload) });
        const response = await worker.fetch(request, env);
        expect(response.status).toBe(200);
        expect(handleChatMember).toHaveBeenCalledWith(payload.chat_member, env);
    });

    it('should route callback_query', async () => {
        const payload = { callback_query: { id: 'test' } };
        const request = new Request('http://localhost', { method: 'POST', headers, body: JSON.stringify(payload) });
        const response = await worker.fetch(request, env);
        expect(response.status).toBe(200);
        expect(handleCallbackQuery).toHaveBeenCalledWith(payload.callback_query, env);
    });
});

describe('Worker Webhook Authentication - Timing Attack Fix', () => {
    it('should correctly reject invalid tokens and missing tokens', async () => {
        const env = { WEBHOOK_SECRET: 'secret123' };

        // Missing token
        let request = new Request('http://localhost', { method: 'POST', body: '{}' });
        let response = await worker.fetch(request, env);
        expect(response.status).toBe(401);

        // Wrong length
        request = new Request('http://localhost', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret12' }, body: '{}' });
        response = await worker.fetch(request, env);
        expect(response.status).toBe(401);

        // Wrong character (timing check conceptually)
        request = new Request('http://localhost', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secreta23' }, body: '{}' });
        response = await worker.fetch(request, env);
        expect(response.status).toBe(401);
    });
});

describe('Worker Error Handling', () => {
    it('should return 500 on internal error during fetch', async () => {
        const env = { WEBHOOK_SECRET: 'secret123' };
        const request = new Request('http://localhost', {
            method: 'POST',
            headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret123' },
            body: '{}'
        });
        request.json = async () => {
            throw new Error('Test error');
        };
        const response = await worker.fetch(request, env);
        expect(response.status).toBe(500);
        const text = await response.text();
        expect(text).toBe('error');
    });
});

describe('Worker Scheduled Handler', () => {
    it('should catch and log errors gracefully from scheduled task', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const testError = new Error('Cron failed');
        processRemindersAndTimeouts.mockRejectedValueOnce(testError);

        await worker.scheduled(null, {}, null);

        expect(consoleSpy).toHaveBeenCalledWith('scheduled error', testError);

        consoleSpy.mockRestore();
    });
});
