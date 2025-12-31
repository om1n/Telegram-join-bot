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
    return text.replace(/([*_`[])/g, '\\$1');
}

// Utility to escape markdown special chars roughly (for API errors etc)
export function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/([\\`*_[\]{}()#+\-.!])/g, '\\$1');
}

export function fullname(from) {
    const parts = [];
    if (from.first_name) parts.push(from.first_name);
    if (from.last_name) parts.push(from.last_name);
    return parts.join(' ');
}
