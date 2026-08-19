// We can mock the global fetch to measure the sequential vs concurrent performance
global.fetch = async (url, options) => {
    // simulate 50ms latency
    await new Promise(resolve => setTimeout(resolve, 50));
    return {
        json: async () => ({ ok: true, result: {} })
    };
};

import { handleMessage } from './src/handlers/message.js';

async function run() {
    const env = {
        DB: {
            prepare: (query) => {
                return {
                    bind: (...args) => {
                        return {
                            all: async () => {
                                if (query.includes("SELECT * FROM requests WHERE user_id = ? AND status IN ('pending', 'answered')")) {
                                    const results = [];
                                    for (let i = 0; i < 20; i++) {
                                        results.push({
                                            id: i,
                                            chat_id: `chat_${i}`,
                                            user_id: args[0],
                                            status: 'pending'
                                        });
                                    }
                                    return { results };
                                }
                                return { results: [] };
                            },
                            run: async () => {},
                        };
                    }
                };
            },
            batch: async () => {}
        },
        ADMIN_USER_ID: '123',
        TELEGRAM_BOT_TOKEN: 'mock_token'
    };

    const msg = {
        chat: { type: 'private', id: '123' },
        from: { id: '123' },
        text: '/reject 456'
    };

    console.log("Running benchmark...");
    const start = Date.now();
    await handleMessage(msg, env);
    const end = Date.now();
    console.log(`Time taken: ${end - start}ms`);
}

run();
