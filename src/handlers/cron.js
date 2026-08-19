import { MESSAGES } from '../messages.js';
import { CONFIG } from '../config.js';
import { sendToTelegram, escapeMarkdownLegacy } from '../services/telegram.js';
import { confirmRequest } from '../services/confirmation.js';
import { cleanupDuplicates } from '../services/database.js';

export async function processRemindersAndTimeouts(env) {
    const db = env.DB;
    const now = Math.floor(Date.now() / 1000);
    const stats = { remindersSent: 0, timeoutsProcessed: 0, autoForwardsProcessed: 0, errors: [] };

    // 1. Auto-Forward responses > 1 hour old
    const oneHourAgo = now - 3600;
    const rowsToForward = await db.prepare(`
        SELECT * FROM requests 
        WHERE status = 'answered' 
        AND answer_date <= ?
    `).bind(oneHourAgo).all();

    const forwardPromises = rowsToForward.results.map(async (r) => {
        if (env.DEBUG === 'true') {
            console.debug(`[DEBUG] Auto-forwarding request ${r.id} for user ${r.user_id}`);
        } else {
            console.info(`Auto-forwarding request ${r.id} for user ${r.user_id} (1 hour passed)`);
        }
        
        try {
            await confirmRequest(r, r.user_id, env, true);
            stats.autoForwardsProcessed++;
        } catch (err) {
            console.error(`Auto-forward error for user ${r.user_id}`, err);
            stats.errors.push(`Auto-forward error for ${r.user_id}: ${err.message}`);
        }
    });

    await Promise.all(forwardPromises);

    const dbStatements = [];

    // 2. Daily reminders
    const oneDayAgo = now - Math.floor(CONFIG.DAILY_REMINDER_INTERVAL_HOURS * 3600);
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

        dbStatements.push(
            db.prepare('UPDATE requests SET last_reminder_ts = ? WHERE id = ?').bind(now, r.id)
        );
        dbStatements.push(
            db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                .bind(r.id, r.user_id, 'reminder_sent', now, JSON.stringify({ days_left: daysLeft }))
        );

        stats.remindersSent++;
    }

    // Timeouts
    await db.prepare(`
        UPDATE requests
        SET status = 'superseded'
        WHERE expires_at <= ?
          AND status IN ('pending', 'answered')
          AND EXISTS (
              SELECT 1 FROM requests r2
              WHERE r2.user_id = requests.user_id
                AND r2.chat_id = requests.chat_id
                AND r2.status IN ('pending', 'answered')
                AND r2.id > requests.id
          )
    `).bind(now).run();

    const rowsExp = await db.prepare('SELECT * FROM requests WHERE expires_at <= ? AND status IN ("pending","answered")').bind(now).all();
    for (const r of rowsExp.results) {
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
                dbStatements.push(
                    db.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('user_missing_or_banned', r.id)
                );
                dbStatements.push(
                    db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                        .bind(r.id, r.user_id, 'auto_rejected_invalid', now, JSON.stringify({ reason: 'api_error_invalid', error: desc }))
                );
                stats.timeoutsProcessed++;
                stats.errors.push(`User ${r.user_id} invalid (USER_ID_INVALID/deactivated), marked 'user_missing_or_banned'.`);
                continue;
            }

            if (desc.includes('HIDE_REQUESTER_MISSING')) {
                dbStatements.push(
                    db.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('request_no_longer_valid', r.id)
                );
                dbStatements.push(
                    db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                        .bind(r.id, r.user_id, 'auto_rejected_missing', now, JSON.stringify({ reason: 'api_error_missing', error: desc }))
                );
                stats.timeoutsProcessed++;
                stats.errors.push(`User ${r.user_id} missing request (HIDE_REQUESTER_MISSING), marked 'request_no_longer_valid'.`);
                continue;
            }

            stats.errors.push(`API Error for ${r.user_id}: ${desc}`);
            continue;
        }

        dbStatements.push(
            db.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('timed_out', r.id)
        );
        dbStatements.push(
            db.prepare('INSERT INTO events (request_id,user_id,event_type,event_ts,data) VALUES (?,?,?,?,?)')
                .bind(r.id, r.user_id, 'auto_rejected', now, JSON.stringify({ reason: 'timeout' }))
        );
        stats.timeoutsProcessed++;

        await sendToTelegram('sendMessage', { chat_id: r.user_id, text: MESSAGES.timeoutUser }, env);

        const modMsg = MESSAGES.moderator.autoReject(r.id, escapeMarkdownLegacy(r.username), escapeMarkdownLegacy(r.display_name), r.user_id);
        await sendToTelegram('sendMessage', { chat_id: env.MOD_CHAT_ID, text: modMsg, parse_mode: 'Markdown' }, env);
    }

    if (dbStatements.length > 0) {
        await db.batch(dbStatements);
    }

    // Cleanup duplicates from cron as well
    await cleanupDuplicates(db);
    return stats;
}

