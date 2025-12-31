import { MESSAGES } from '../messages.js';
import { sendToTelegram, escapeMarkdownLegacy } from '../services/telegram.js';

export async function handleChatMember(cm, env) {
    const newStatus = cm.new_chat_member?.status;

    // DEBUG event
    try {
        const db = env.DB;
        await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
            .bind(0, cm.from.id, 'debug_chat_member', Math.floor(Date.now() / 1000), JSON.stringify(cm)).run();
    } catch (e) {
        console.error('Debug log error', e);
    }

    if (newStatus !== 'member') return;

    const user = cm.new_chat_member.user;
    const from = cm.from;
    const chat = cm.chat;

    if (user.is_bot) return;

    // 1. Send Welcome Message
    try {
        await sendToTelegram('sendMessage', {
            chat_id: user.id,
            text: MESSAGES.welcome(escapeMarkdownLegacy(chat.title)),
            parse_mode: 'Markdown'
        }, env);
    } catch (e) {
        console.error('Failed to send welcome message', e);
    }

    // 2. Notify Moderators
    if (env.MOD_CHAT_ID) {
        try {
            const safeUser = { ...user, first_name: escapeMarkdownLegacy(user.first_name), last_name: escapeMarkdownLegacy(user.last_name), username: escapeMarkdownLegacy(user.username) };
            const safeAdmin = { ...from, first_name: escapeMarkdownLegacy(from.first_name), last_name: escapeMarkdownLegacy(from.last_name), username: escapeMarkdownLegacy(from.username) };

            await sendToTelegram('sendMessage', {
                chat_id: env.MOD_CHAT_ID,
                text: MESSAGES.moderator.userAdded(safeUser, safeAdmin, escapeMarkdownLegacy(chat.title)),
                parse_mode: 'Markdown'
            }, env);
        } catch (e) {
            console.error('Failed to notify moderators', e);
        }
    }
}
