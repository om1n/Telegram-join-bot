import { MESSAGES } from '../messages.js';
import { CONFIG } from '../config.js';
import { sendToTelegram, escapeMarkdownLegacy, getChatInfo, formatGroupLink } from '../services/telegram.js';
import { processRemindersAndTimeouts } from './cron.js';
import { cleanupDuplicates } from '../services/database.js';
import { confirmRequest } from '../services/confirmation.js';

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
        await sendToTelegram('sendMessage', {
            chat_id: user_id,
            text: MESSAGES.noPendingRequest,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '📨 Подать заявку на вступление', url: 'https://t.me/fintechprod' }
                ]]
            }
        }, env);
        return;
    }

    // Logic: Wait for answer OR confirmation
    if (!req.answer_text) {
        // Treat as answer
        await db.prepare('UPDATE requests SET answer_text = ?, answer_date = ?, status = ? WHERE id = ?')
            .bind(text, now, 'answered', req.id).run();
        await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
            .bind(req.id, user_id, 'answered', now, JSON.stringify({ answer: text })).run();

        const opts = {
            chat_id: user_id,
            text: MESSAGES.confirmation(escapeMarkdownLegacy(text)),
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: MESSAGES.confirmButtonText, callback_data: `confirm_${req.id}` }
                ]]
            }
        };
        await sendToTelegram('sendMessage', opts, env);
        return;
    }

    if (req.status === 'answered') {
        if (/^(да|yes)[\W]*$/i.test(text.trim())) {
            // Confirm using imported service
            // Wrap debug log for info
            if (env.DEBUG === 'true') console.debug('[DEBUG] Manual text confirmation triggered for user', user_id);
            else console.info(`User ${user_id} confirmed answer via text`);

            await confirmRequest(req, user_id, env, false);
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
        let dbStatements = [];

        const rejectPromises = rows.results.map(async (r) => {
            try {
                const res = await sendToTelegram('declineChatJoinRequest', { chat_id: r.chat_id, user_id: r.user_id }, env);
                if (!res || !res.ok) {
                    const desc = res ? res.description : 'Unknown';
                    if (desc.includes('HIDE_REQUESTER_MISSING')) {
                        return { success: true, missing: true, r };
                    }
                    return { success: false, error: `API Error: ${desc}` };
                }
                return { success: true, missing: false, r };
            } catch (err) {
                console.error('Manual reject error', err);
                return { success: false, error: `Pending status kept. Net error: ${err.message}` };
            }
        });

        const results = await Promise.all(rejectPromises);

        for (const result of results) {
            if (!result.success) {
                failCount++;
                errors.push(result.error);
            } else {
                const { missing, r } = result;
                dbStatements.push(db.prepare("UPDATE requests SET status = 'rejected' WHERE id = ?").bind(r.id));
                if (missing) {
                    dbStatements.push(db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                        .bind(r.id, r.user_id, 'admin_rejected_missing', Math.floor(Date.now() / 1000), JSON.stringify({ admin_id: env.ADMIN_USER_ID, note: 'request was missing in TG' })));
                } else {
                    dbStatements.push(db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                        .bind(r.id, r.user_id, 'admin_rejected', Math.floor(Date.now() / 1000), JSON.stringify({ admin_id: env.ADMIN_USER_ID })));
                }
                rejectedCount++;
            }
        }

        if (dbStatements.length > 0) {
            await db.batch(dbStatements);
        }

        const msg = MESSAGES.admin.rejectResult(targetUserId, rejectedCount, failCount, errors);
        await sendToTelegram('sendMessage', { chat_id, text: msg }, env);
        return;
    }
    await sendToTelegram('sendMessage', { chat_id, text: MESSAGES.admin.unknown }, env);
}

