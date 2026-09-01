import { MESSAGES } from '../messages.js';
import { sendToTelegram, escapeMarkdownLegacy, getChatInfo, formatGroupLink } from './telegram.js';

/**
 * Handles the logic of confirming a user's join request.
 * @param {Object} req The database representation of the request.
 * @param {Number|String} user_id Telegram User ID.
 * @param {Object} env Cloudflare worker environment.
 * @param {Boolean} isAutoForward Whether this confirmation was triggered automatically by cron.
 */
export async function sendConfirmationNotifications(req, user_id, env, isAutoForward = false) {
    // 2. Fetch Group Info for Moderation Message
    const chatInfo = await getChatInfo(req.chat_id, env);
    let groupLink = '';
    if (chatInfo) {
        const escapedTitle = escapeMarkdownLegacy(chatInfo.title || 'Unknown Group');
        const username = chatInfo.username;
        groupLink = formatGroupLink(req.chat_id, escapedTitle, username);
    }

    // 3. Notify Moderators
    const profileLink = `tg://user?id=${user_id}`;
    const moderatorMessage = MESSAGES.moderator.newRequest(
        escapeMarkdownLegacy(req.username),
        escapeMarkdownLegacy(req.display_name),
        user_id,
        profileLink,
        escapeMarkdownLegacy(req.answer_text),
        escapeMarkdownLegacy(req.chat_id),
        new Date(req.request_date * 1000).toISOString(),
        new Date(req.expires_at * 1000).toISOString(),
        groupLink
    );
    await sendToTelegram('sendMessage', { chat_id: env.MOD_CHAT_ID, text: moderatorMessage, parse_mode: 'Markdown' }, env);

    // 4. Notify User
    const userMessage = isAutoForward ? MESSAGES.autoForwardedMessage : MESSAGES.sentToModerators;
    await sendToTelegram('sendMessage', { chat_id: user_id, text: userMessage }, env);
}

export async function confirmRequest(req, user_id, env, isAutoForward = false) {
    const db = env.DB;
    const now = Math.floor(Date.now() / 1000);

    // 1. Update DB State
    await db.prepare('UPDATE requests SET status = ?, confirmed_date = ? WHERE id = ?')
        .bind('confirmed', now, req.id).run();
    await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
        .bind(req.id, user_id, 'confirmed', now, JSON.stringify({ auto_forward: isAutoForward })).run();

    await sendConfirmationNotifications(req, user_id, env, isAutoForward);
}
