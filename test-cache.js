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
    // Simulate 100 concurrent requests for the same chat ID
    const promises = [];
    for (let i = 0; i < 100; i++) {
        promises.push(getChatInfo('123', env));
    }
    await Promise.all(promises);
    const end = Date.now();

    console.log(`Concurrent requests took ${end - start}ms`);
    console.log(`API was called ${callCount} times (expected 1 if deduped properly)`);
}

run();
