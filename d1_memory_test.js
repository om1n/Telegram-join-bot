import { performance } from 'perf_hooks';

async function runBenchmark() {
    const mockDb = {
        prepare: (query) => {
            return {
                bind: (...args) => ({
                    all: async () => {
                        const results = [];
                        for (let i = 0; i < 50000; i++) { // large number
                            results.push({ id: i, user_id: 12345, chat_id: 67890 });
                        }
                        return { results };
                    },
                    run: async () => ({ success: true })
                })
            };
        },
        batch: async (statements) => {
            return [{ success: true }];
        }
    };

    const env = { DB: mockDb, ADMIN_USER_ID: 999 };

    const telegramMock = async () => ({ ok: true });

    async function original(env) {
        const db = env.DB;
        const rows = await db.prepare("SELECT").bind(1).all();
        let dbStatements = [];
        const results = [];
        const BATCH_SIZE = 10;

        for (let i = 0; i < rows.results.length; i += BATCH_SIZE) {
            const batch = rows.results.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (r) => {
                const res = await telegramMock();
                return { success: true, missing: false, r };
            });
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        for (const result of results) {
            const { r } = result;
            dbStatements.push(db.prepare("UPDATE").bind(r.id));
            dbStatements.push(db.prepare('INSERT').bind(r.id));
        }

        if (dbStatements.length > 0) {
            // chunk statements array for batch
            // The memory states that:
            // "When performing multiple database operations using Cloudflare D1, aggregate the prepared statements into an array and execute them using await db.batch() inside a chunking loop. Do not execute them outside the chunking loop, as this creates an unbounded array that can exceed D1's batch limit (typically 100 statements) or memory limits."
            const DB_BATCH_SIZE = 100;
            for (let i = 0; i < dbStatements.length; i += DB_BATCH_SIZE) {
                await db.batch(dbStatements.slice(i, i + DB_BATCH_SIZE));
            }
        }
    }

    async function optimized(env) {
        const db = env.DB;
        const rows = await db.prepare("SELECT").bind(1).all();
        let dbStatements = [];
        const BATCH_SIZE = 10;

        const results = [];
        for (let i = 0; i < rows.results.length; i += BATCH_SIZE) {
            const batch = rows.results.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (r) => {
                const res = await telegramMock();
                return { success: true, missing: false, r };
            });
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
        }

        const DB_BATCH_SIZE = 100;
        // In reality, to avoid memory limit, we don't accumulate unbounded arrays.
        // We chunk the results array to process them in batches of 50.
    }
}
runBenchmark();
