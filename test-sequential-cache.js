import { getChatInfo, __resetChatInfoCache } from './src/services/telegram.js';

async function run() {
    let callCount = 0;

    // Mock global fetch
    global.fetch = async (url, options) => {
        callCount++;
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
            json: async () => ({ ok: true, result: { id: '123', title: 'Test' } })
        };
    };

    const env = { TELEGRAM_BOT_TOKEN: 'test' };

    __resetChatInfoCache();
    callCount = 0;

    const start = Date.now();
    // Simulate 100 sequential requests for the same chat ID
    for (let i = 0; i < 100; i++) {
        await getChatInfo('123', env);
    }
    const end = Date.now();

    console.log(`Sequential requests took ${end - start}ms`);
    console.log(`API was called ${callCount} times`);
}

run();
