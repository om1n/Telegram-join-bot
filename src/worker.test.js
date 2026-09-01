import { describe, it, expect } from 'vitest';
import worker from './worker.js';

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
