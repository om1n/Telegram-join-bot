import { describe, it } from 'vitest';

export async function measureNPlusOne(db, env) {
    const ts = Math.floor(Date.now() / 1000);
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
        await db.prepare("UPDATE requests SET status = 'rejected' WHERE id = ?").bind(i).run();
        await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
            .bind(i, 123, 'admin_rejected', ts, JSON.stringify({ admin_id: env.ADMIN_USER_ID })).run();
    }
    const end = Date.now();
    return end - start;
}

export async function measureOptimized(db, env) {
    const ts = Math.floor(Date.now() / 1000);
    const ids = [];
    for (let i = 0; i < 100; i++) {
        ids.push(i);
    }
    const start = Date.now();

    const statements = [];
    for (let i = 0; i < 100; i++) {
        statements.push(db.prepare("UPDATE requests SET status = 'rejected' WHERE id = ?").bind(i));
        statements.push(db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
            .bind(i, 123, 'admin_rejected', ts, JSON.stringify({ admin_id: env.ADMIN_USER_ID })));
    }
    await db.batch(statements);

    const end = Date.now();
    return end - start;
}
