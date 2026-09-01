import { processTimeouts } from './src/handlers/cron.js';

async function run() {
    let batchCalls = 0;

    // Mock DB
    const db = {
        prepare: (query) => {
            return {
                bind: (...args) => ({
                    run: async () => {},
                    all: async () => {
                        // Generate 500 fake requests
                        const results = Array.from({length: 500}, (_, i) => ({
                            id: i + 1,
                            user_id: 1000 + i,
                            chat_id: 2000,
                            expires_at: 0,
                            status: 'pending'
                        }));
                        return { results };
                    }
                })
            };
        },
        batch: async (statements) => {
            batchCalls++;
            // Simulate network latency for DB
            await new Promise(r => setTimeout(r, 5));
        }
    };

    // Mock env
    const env = {
        DB: db,
        MOD_CHAT_ID: 12345
    };

    // Override sendToTelegram globally in the module?
    // We can use a test or just run processTimeouts knowing it will fail the network if we don't mock it.
    // Let's write a proper vitest test for the benchmark or mock it correctly.
}
run();
