import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('Benchmark DB Operations', () => {
    it('should measure N+1 vs batch', async () => {
        const db = env.DB;

        // Setup schema
        await db.exec(`
            CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY, status TEXT);
            CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, request_id INTEGER, user_id INTEGER, event_type TEXT, event_ts INTEGER, data TEXT);
        `);

        for(let i=0; i<100; i++) {
            await db.prepare("INSERT INTO requests (id, status) VALUES (?, 'pending')").bind(i).run();
        }

        const ts = Math.floor(Date.now() / 1000);

        // Measure N+1
        const startN1 = Date.now();
        for (let i = 0; i < 50; i++) {
            await db.prepare("UPDATE requests SET status = 'rejected' WHERE id = ?").bind(i).run();
            await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                .bind(i, 123, 'admin_rejected', ts, JSON.stringify({ admin_id: 123 })).run();
        }
        const endN1 = Date.now();
        const durationN1 = endN1 - startN1;

        // Measure batch
        const startBatch = Date.now();
        const statements = [];
        for (let i = 50; i < 100; i++) {
            statements.push(db.prepare("UPDATE requests SET status = 'rejected' WHERE id = ?").bind(i));
            statements.push(db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                .bind(i, 123, 'admin_rejected', ts, JSON.stringify({ admin_id: 123 })));
        }
        await db.batch(statements);
        const endBatch = Date.now();
        const durationBatch = endBatch - startBatch;

        console.log(`N+1 time: ${durationN1}ms`);
        console.log(`Batch time: ${durationBatch}ms`);
        console.log(`Improvement: ${(durationN1 / durationBatch).toFixed(2)}x`);

        expect(true).toBe(true);
    });
});
