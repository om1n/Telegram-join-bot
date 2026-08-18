import { DatabaseSync } from 'node:sqlite';

function setup() {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, chat_id INTEGER, status TEXT, expires_at INTEGER)');
    const insert = db.prepare('INSERT INTO requests (user_id, chat_id, status, expires_at) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 10000; i++) {
        insert.run(i % 100, 1, 'pending', i < 5000 ? 100 : 200);
    }
    return db;
}

const now = 150;

function benchNewSelect() {
    const db = setup();
    const start = performance.now();
    const rowsExp = db.prepare(`
        SELECT r1.*,
               EXISTS (
                   SELECT 1 FROM requests r2
                   WHERE r2.user_id = r1.user_id
                     AND r2.chat_id = r1.chat_id
                     AND r2.status IN ('pending', 'answered')
                     AND r2.id > r1.id
               ) as has_newer
        FROM requests r1
        WHERE r1.expires_at <= ? AND r1.status IN ('pending','answered')
    `).all(now);

    let updates = 0;
    let apiCalls = 0;

    const updateStmt = db.prepare('UPDATE requests SET status = ? WHERE id = ?');
    for (const r of rowsExp) {
        if (r.has_newer) {
            updateStmt.run('superseded', r.id);
            updates++;
            continue;
        }
        apiCalls++;
    }
    return performance.now() - start;
}

function benchBatchUpdate() {
    const db = setup();
    const start = performance.now();

    db.prepare(`
        UPDATE requests
        SET status = 'superseded'
        WHERE expires_at <= ?
          AND status IN ('pending', 'answered')
          AND EXISTS (
              SELECT 1 FROM requests r2
              WHERE r2.user_id = requests.user_id
                AND r2.chat_id = requests.chat_id
                AND r2.status IN ('pending', 'answered')
                AND r2.id > requests.id
          )
    `).run(now);

    const rowsExp = db.prepare('SELECT * FROM requests WHERE expires_at <= ? AND status IN (\'pending\',\'answered\')').all(now);

    let updates = 0;
    let apiCalls = 0;

    for (const r of rowsExp) {
        apiCalls++;
    }
    return performance.now() - start;
}

let sumSelect = 0;
let sumBatch = 0;
for (let i = 0; i < 100; i++) {
    sumSelect += benchNewSelect();
    sumBatch += benchBatchUpdate();
}

console.log(`Select+LoopUpdates: ${sumSelect.toFixed(2)}ms`);
console.log(`BatchUpdate+Select: ${sumBatch.toFixed(2)}ms`);
