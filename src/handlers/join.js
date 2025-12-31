import { MESSAGES } from '../messages.js';
import { CONFIG } from '../config.js';
import { sendToTelegram, escapeMarkdownLegacy, fullname } from '../services/telegram.js';

export async function handleJoinRequest(jr, env) {
    const db = env.DB;
    const user = jr.from;
    const now = Math.floor(Date.now() / 1000);
    const expires_at = now + CONFIG.REQUEST_EXPIRY_DAYS * 24 * 3600;

    const username = user.username || null;
    const display_name = fullname(user) || null;
    const chat_id = jr.chat.id.toString();
    const user_id = user.id;

    // Check for SPAM (repeated requests)
    const history = await db.prepare('SELECT COUNT(*) as c FROM requests WHERE user_id = ? AND chat_id = ?').bind(user_id, chat_id).all();
    const attemptCount = (history.results && history.results[0] && history.results[0].c) ? history.results[0].c : 0;

    if (attemptCount >= CONFIG.SPAM_BAN_ATTEMPTS - 1) { // 4 previous attempts = 5th now
        // BAN
        await sendToTelegram('banChatMember', { chat_id: chat_id, user_id: user_id }, env);
        await sendToTelegram('declineChatJoinRequest', { chat_id: chat_id, user_id: user_id }, env);
        await sendToTelegram('sendMessage', { chat_id: user_id, text: MESSAGES.banned }, env);

        // Update DB: mark ALL pending/answered requests for this user as 'banned'
        await db.prepare("UPDATE requests SET status = 'banned' WHERE user_id = ? AND chat_id = ? AND status IN ('pending', 'answered')")
            .bind(user_id, chat_id).run();

        // Log event
        await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
            .bind(null, user_id, 'banned_spam', now, JSON.stringify({ attempts: attemptCount + 1 })).run();

        // Notify Moderators
        if (env.MOD_CHAT_ID) {
            const safeUser = { ...user, first_name: escapeMarkdownLegacy(user.first_name), username: escapeMarkdownLegacy(user.username) };
            await sendToTelegram('sendMessage', {
                chat_id: env.MOD_CHAT_ID,
                text: MESSAGES.moderator.spamBan(safeUser, attemptCount + 1),
                parse_mode: 'Markdown'
            }, env);
        }
        return;
    }

    // Supersede any existing pending requests for this user in this chat
    await db.prepare('UPDATE requests SET status = ? WHERE user_id = ? AND chat_id = ? AND status = ?')
        .bind('superseded', user_id, chat_id, 'pending').run();

    // Insert request
    const insertSQL = `INSERT INTO requests (chat_id,user_id,username,display_name,request_date,expires_at,status) VALUES (?,?,?,?,?,?,?)`;
    await db.prepare(insertSQL).bind(chat_id, user_id, username, display_name, now, expires_at, 'pending').run();
    const requestRow = await db.prepare('SELECT last_insert_rowid() as id').all();
    const reqId = requestRow.results && requestRow.results[0] && requestRow.results[0].id ? requestRow.results[0].id : null;

    // Log event
    await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
        .bind(reqId, user_id, 'submitted', now, JSON.stringify({ chat: jr.chat })).run();

    // Send DM with questions
    await sendToTelegram('sendMessage', { chat_id: user_id, text: MESSAGES.questions(escapeMarkdownLegacy(jr.chat.title)), parse_mode: 'Markdown' }, env);

    // Send warning if approaching spam limit
    if (attemptCount >= CONFIG.SPAM_WARNING_ATTEMPTS_START - 1) { // 3rd or 4th attempt
        const currentAttempt = attemptCount + 1;
        await sendToTelegram('sendMessage', { chat_id: user_id, text: MESSAGES.spamWarning(currentAttempt) }, env);
    }
}
