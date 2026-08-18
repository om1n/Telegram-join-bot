const TELEGRAM_API = (token) => `https://api.telegram.org/bot${token}`;

export async function sendToTelegram(method, body, env) {
    const url = `${TELEGRAM_API(env.TELEGRAM_BOT_TOKEN)}/${method}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) console.error('Telegram API error', data);
    return data;
}

// Utility to escape Legacy Markdown special chars
// In Legacy Markdown, only [ ] ( ) ~ > # + - = | { } . ! are NOT special.
// Special chars are: * _ ` [ ]
export function escapeMarkdownLegacy(text) {
    if (!text) return '';
    return text.replace(/([*_`\[\]\\])/g, '\\$1');
}

export function fullname(from) {
    const parts = [];
    if (from.first_name) parts.push(from.first_name);
    if (from.last_name) parts.push(from.last_name);
    return parts.join(' ');
}

/**
 * Fetch chat information from Telegram API
 * @param {string} chatId - Chat ID to fetch info for
 * @param {object} env - Environment variables with TELEGRAM_BOT_TOKEN
 * @returns {Promise<object|null>} Chat object or null on error
 */
export async function getChatInfo(chatId, env) {
    try {
        const result = await sendToTelegram('getChat', { chat_id: chatId }, env);
        if (result.ok) {
            return result.result;
        }
        console.error('Failed to get chat info:', result);
        return null;
    } catch (error) {
        console.error('Error fetching chat info:', error);
        return null;
    }
}

/**
 * Format group link for messages
 * For public groups (with username): creates clickable Telegram link
 * For private groups: returns escaped title only
 * @param {string} chatId - Chat ID
 * @param {string} title - Chat title (already escaped)
 * @param {string} username - Chat username (optional)
 * @returns {string} Formatted group link or title
 */
export function formatGroupLink(chatId, title, username) {
    if (username) {
        // Public group - create clickable link
        return `[${title}](https://t.me/${username})`;
    }
    // Private group - return title in bold
    return `*${title}*`;
}
