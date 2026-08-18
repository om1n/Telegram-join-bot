import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, chat_id INTEGER, status TEXT, expires_at INTEGER)');
const insert = db.prepare('INSERT INTO requests (user_id, chat_id, status, expires_at) VALUES (?, ?, ?, ?)');
for (let i = 0; i < 10000; i++) {
    insert.run(i % 100, 1, 'pending', i < 5000 ? 100 : 200);
}

const now = 150;

function benchOld() {
    const start = performance.now();
    const rowsExp = db.prepare('SELECT * FROM requests WHERE expires_at <= ? AND status IN (\'pending\',\'answered\')').all(now);

    let updates = 0;
    let apiCalls = 0;

    const checkNewer = db.prepare('SELECT id FROM requests WHERE user_id = ? AND chat_id = ? AND status IN (\'pending\', \'answered\') AND id > ?');

    for (const r of rowsExp) {
        const newer = checkNewer.all(r.user_id, r.chat_id, r.id);
        if (newer.length > 0) {
            updates++;
            continue;
        }
        apiCalls++;
    }
    return performance.now() - start;
}

function benchNew() {
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

    for (const r of rowsExp) {
        if (r.has_newer) {
            updates++;
            continue;
        }
        apiCalls++;
    }
    return performance.now() - start;
}

let sumOld = 0;
let sumNew = 0;
for (let i = 0; i < 100; i++) {
    sumOld += benchOld();
    sumNew += benchNew();
}

console.log(`Old: ${sumOld.toFixed(2)}ms`);
console.log(`New: ${sumNew.toFixed(2)}ms`);
