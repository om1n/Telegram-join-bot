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
