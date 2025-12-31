import { MESSAGES } from '../messages.js';
import { CONFIG } from '../config.js';
import { sendToTelegram, escapeMarkdownLegacy } from '../services/telegram.js';
import { processRemindersAndTimeouts } from './cron.js';

export async function handleMessage(msg, env) {
    const db = env.DB;
    const text = (msg.text || '').trim().substring(0, CONFIG.MAX_MESSAGE_LENGTH);
    const chat = msg.chat;
    const user_id = msg.from.id;
    const now = Math.floor(Date.now() / 1000);

    // Admin commands
    if (chat.type === 'private' && String(user_id) === String(env.ADMIN_USER_ID) && text.startsWith('/')) {
        await handleAdminCommand(text, msg, env);
        return;
    }

    if (chat.type !== 'private') return;
    if (msg.from.is_bot) return;
    if (text.startsWith('/')) return; // Ignore non-admin commands

    // Find latest pending request
    const pending = await db.prepare('SELECT * FROM requests WHERE user_id = ? AND status IN (?, ?) ORDER BY request_date DESC LIMIT 1')
        .bind(user_id, 'pending', 'answered').all();
    const req = pending.results && pending.results[0] ? pending.results[0] : null;

    if (!req) {
        await sendToTelegram('sendMessage', { chat_id: user_id, text: MESSAGES.noPendingRequest }, env);
        return;
    }

    // Logic: Wait for answer OR confirmation
    if (!req.answer_text) {
        // Treat as answer
        await db.prepare('UPDATE requests SET answer_text = ?, answer_date = ?, status = ? WHERE id = ?')
            .bind(text, now, 'answered', req.id).run();
        await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
            .bind(req.id, user_id, 'answered', now, JSON.stringify({ answer: text })).run();

        await sendToTelegram('sendMessage', { chat_id: user_id, text: MESSAGES.confirmation(escapeMarkdownLegacy(text)), parse_mode: 'Markdown' }, env);
        return;
    }

    if (req.status === 'answered') {
        if (/^(да|yes)[\W]*$/i.test(text.trim())) {
            // Confirm
            await db.prepare('UPDATE requests SET status = ?, confirmed_date = ? WHERE id = ?')
                .bind('confirmed', now, req.id).run();
            await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                .bind(req.id, user_id, 'confirmed', now, JSON.stringify({})).run();

            // Notify Mods
            const profileLink = `tg://user?id=${user_id}`;
            const moderatorMessage = MESSAGES.moderator.newRequest(
                escapeMarkdownLegacy(req.username),
                escapeMarkdownLegacy(req.display_name),
                user_id,
                profileLink,
                escapeMarkdownLegacy(req.answer_text),
                escapeMarkdownLegacy(req.chat_id),
                new Date(req.request_date * 1000).toISOString(),
                new Date(req.expires_at * 1000).toISOString()
            );

            await sendToTelegram('sendMessage', { chat_id: env.MOD_CHAT_ID, text: moderatorMessage, parse_mode: 'Markdown' }, env);
            await sendToTelegram('sendMessage', { chat_id: user_id, text: MESSAGES.sentToModerators }, env);
            return;
        } else {
            // Rewrite
            await db.prepare('UPDATE requests SET answer_text = NULL, answer_date = NULL, status = ? WHERE id = ?')
                .bind('pending', req.id).run();
            await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                .bind(req.id, user_id, 'rewrite_requested', now, JSON.stringify({})).run();

            await sendToTelegram('sendMessage', { chat_id: user_id, text: MESSAGES.rewriteRequested }, env);
            return;
        }
    }
}

async function handleAdminCommand(text, msg, env) {
    const db = env.DB;
    const chat_id = msg.chat.id;

    if (text.startsWith('/status')) {
        const res = await db.prepare("SELECT COUNT(*) as c FROM requests WHERE status = 'pending'").all();
        const c = res.results[0].c || 0;
        await sendToTelegram('sendMessage', { chat_id, text: MESSAGES.admin.status(c) }, env);
        return;
    }
    if (text.startsWith('/pending')) {
        const rows = await db.prepare("SELECT id,user_id,username,display_name,request_date,answer_text FROM requests WHERE status = 'pending' ORDER BY request_date DESC LIMIT 50").all();
        const list = rows.results.map(r => `ID:${r.id} UID:${r.user_id} ${r.username ? ('@' + r.username) : r.display_name} Подана:${new Date(r.request_date * 1000).toISOString()} Ответ:${r.answer_text ? 'Да' : 'Нет'}`).join('\n') || MESSAGES.admin.emptyPending;
        await sendToTelegram('sendMessage', { chat_id, text: list }, env);
        return;
    }
    if (text.startsWith('/config')) {
        const cfg = MESSAGES.admin.config(env.MOD_CHAT_ID, env.ADMIN_USER_ID);
        await sendToTelegram('sendMessage', { chat_id, text: cfg }, env);
        return;
    }
    if (text.startsWith('/help')) {
        await sendToTelegram('sendMessage', { chat_id, text: MESSAGES.admin.help }, env);
        return;
    }
    if (text.startsWith('/cleanup')) {
        await cleanupDuplicates(db);
        await sendToTelegram('sendMessage', { chat_id, text: MESSAGES.admin.cleanupSuccess }, env);
        return;
    }
    if (text.startsWith('/force_cron')) {
        const result = await processRemindersAndTimeouts(env);
        const msg = MESSAGES.admin.forceCron(
            result ? result.remindersSent : 0,
            result ? result.timeoutsProcessed : 0,
            result ? result.errors : []
        );
        await sendToTelegram('sendMessage', { chat_id, text: msg }, env);
        return;
    }
    if (text.startsWith('/reject ')) {
        const targetUserId = text.split(' ')[1];
        if (!targetUserId) {
            await sendToTelegram('sendMessage', { chat_id, text: MESSAGES.admin.rejectUsage }, env);
            return;
        }

        const rows = await db.prepare("SELECT * FROM requests WHERE user_id = ? AND status IN ('pending', 'answered')").bind(targetUserId).all();
        if (!rows.results || rows.results.length === 0) {
            await sendToTelegram('sendMessage', { chat_id, text: MESSAGES.admin.rejectNotFound(targetUserId) }, env);
            return;
        }

        let rejectedCount = 0;
        let failCount = 0;
        let errors = [];

        for (const r of rows.results) {
            let res;
            try {
                res = await sendToTelegram('declineChatJoinRequest', { chat_id: r.chat_id, user_id: r.user_id }, env);
            } catch (err) {
                console.error('Manual reject error', err);
                failCount++;
                errors.push(`Pending status kept. Net error: ${err.message}`);
                continue;
            }

            if (!res || !res.ok) {
                const desc = res ? res.description : 'Unknown';
                if (desc.includes('HIDE_REQUESTER_MISSING')) {
                    await db.prepare("UPDATE requests SET status = 'rejected' WHERE id = ?").bind(r.id).run();
                    await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                        .bind(r.id, r.user_id, 'admin_rejected_missing', Math.floor(Date.now() / 1000), JSON.stringify({ admin_id: env.ADMIN_USER_ID, note: 'request was missing in TG' })).run();
                    rejectedCount++;
                    continue;
                }

                failCount++;
                errors.push(`API Error: ${desc}`);
                continue;
            }

            await db.prepare("UPDATE requests SET status = 'rejected' WHERE id = ?").bind(r.id).run();
            await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                .bind(r.id, r.user_id, 'admin_rejected', Math.floor(Date.now() / 1000), JSON.stringify({ admin_id: env.ADMIN_USER_ID })).run();
            rejectedCount++;
        }

        const msg = MESSAGES.admin.rejectResult(targetUserId, rejectedCount, failCount, errors);
        await sendToTelegram('sendMessage', { chat_id, text: msg }, env);
        return;
    }
    await sendToTelegram('sendMessage', { chat_id, text: MESSAGES.admin.unknown }, env);
}

// Internal dupe cleaner
async function cleanupDuplicates(db) {
    await db.prepare(`
    UPDATE requests 
    SET status = 'superseded' 
    WHERE status = 'pending' 
    AND id NOT IN (
      SELECT MAX(id) 
      FROM requests 
      WHERE status = 'pending' 
      GROUP BY user_id, chat_id
    )
  `).run();
}
