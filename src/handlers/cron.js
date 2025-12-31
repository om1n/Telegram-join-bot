import { MESSAGES } from '../messages.js';
import { CONFIG } from '../config.js';
import { sendToTelegram, escapeMarkdownLegacy } from '../services/telegram.js';

export async function processRemindersAndTimeouts(env) {
    const db = env.DB;
    const now = Math.floor(Date.now() / 1000);
    const stats = { remindersSent: 0, timeoutsProcessed: 0, errors: [] };

    // Daily reminders
    const oneDayAgo = now - 24 * 3600;
    const rowsRemind = await db.prepare(`
    SELECT * FROM requests 
    WHERE request_date <= ? 
    AND status = 'pending' 
    AND (last_reminder_ts IS NULL OR last_reminder_ts <= ?)
  `).bind(oneDayAgo, oneDayAgo).all();

    for (const r of rowsRemind.results) {
        const secondsLeft = r.expires_at - now;
        const daysLeft = Math.ceil(secondsLeft / (24 * 3600));

        if (daysLeft <= 0) continue;

        await sendToTelegram('sendMessage', { chat_id: r.user_id, text: MESSAGES.dailyReminder(daysLeft) }, env);

        await db.prepare('UPDATE requests SET last_reminder_ts = ? WHERE id = ?').bind(now, r.id).run();
        await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
            .bind(r.id, r.user_id, 'reminder_sent', now, JSON.stringify({ days_left: daysLeft })).run();

        stats.remindersSent++;
    }

    // Timeouts
    const rowsExp = await db.prepare('SELECT * FROM requests WHERE expires_at <= ? AND status IN ("pending","answered")').bind(now).all();
    for (const r of rowsExp.results) {
        const newer = await db.prepare('SELECT id FROM requests WHERE user_id = ? AND chat_id = ? AND status IN ("pending", "answered") AND id > ?')
            .bind(r.user_id, r.chat_id, r.id).all();

        if (newer.results && newer.results.length > 0) {
            await db.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('superseded', r.id).run();
            continue;
        }

        let rejectRes;
        try {
            rejectRes = await sendToTelegram('declineChatJoinRequest', { chat_id: r.chat_id, user_id: r.user_id }, env);
        } catch (err) {
            console.error('reject error (network/fetch)', err);
            stats.errors.push(`Net error for ${r.user_id}: ${err.message}`);
            continue;
        }

        if (!rejectRes || !rejectRes.ok) {
            const desc = rejectRes ? rejectRes.description : 'Unknown';
            console.error(`reject error (api) for user ${r.user_id}:`, desc);

            if (desc.includes('USER_ID_INVALID') || desc.includes('user is deactivated')) {
                await db.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('user_missing_or_banned', r.id).run();
                await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                    .bind(r.id, r.user_id, 'auto_rejected_invalid', now, JSON.stringify({ reason: 'api_error_invalid', error: desc })).run();
                stats.timeoutsProcessed++;
                stats.errors.push(`User ${r.user_id} invalid (USER_ID_INVALID/deactivated), marked 'user_missing_or_banned'.`);
                continue;
            }

            if (desc.includes('HIDE_REQUESTER_MISSING')) {
                await db.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('request_no_longer_valid', r.id).run();
                await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                    .bind(r.id, r.user_id, 'auto_rejected_missing', now, JSON.stringify({ reason: 'api_error_missing', error: desc })).run();
                stats.timeoutsProcessed++;
                stats.errors.push(`User ${r.user_id} missing request (HIDE_REQUESTER_MISSING), marked 'request_no_longer_valid'.`);
                continue;
            }

            stats.errors.push(`API Error for ${r.user_id}: ${desc}`);
            continue;
        }

        await db.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('timed_out', r.id).run();
        await db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
            .bind(r.id, r.user_id, 'auto_rejected', now, JSON.stringify({ reason: 'timeout' })).run();
        stats.timeoutsProcessed++;

        await sendToTelegram('sendMessage', { chat_id: r.user_id, text: MESSAGES.timeoutUser }, env);

        const modMsg = MESSAGES.moderator.autoReject(r.id, escapeMarkdownLegacy(r.username), escapeMarkdownLegacy(r.display_name), r.user_id);
        await sendToTelegram('sendMessage', { chat_id: env.MOD_CHAT_ID, text: modMsg, parse_mode: 'Markdown' }, env);
    }

    // Cleanup duplicates from cron as well
    await cleanupDuplicates(db);
    return stats;
}

// Internal
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
