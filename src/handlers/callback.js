import { sendToTelegram } from '../services/telegram.js';
import { confirmRequest } from '../services/confirmation.js';

export async function handleCallbackQuery(callbackQuery, env) {
    const data = callbackQuery.data;
    const callbackQueryId = callbackQuery.id;
    const msg = callbackQuery.message;
    const user_id = callbackQuery.from.id;
    const db = env.DB;

    // Acknowledge the callback immediately to remove loading state
    await sendToTelegram('answerCallbackQuery', { callback_query_id: callbackQueryId }, env);

    if (data && data.startsWith('confirm_')) {
        const reqId = Number(data.replace('confirm_', ''));

        // Fetch the request
        const pending = await db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').bind(reqId, user_id).all();
        const req = pending.results && pending.results[0] ? pending.results[0] : null;

        if (!req || req.status !== 'answered') {
            if (env.DEBUG === 'true') {
                console.debug('[DEBUG] Callback ignored: Request not found or not in answered state.', { reqId, status: req?.status });
            }
            return;
        }

        if (env.DEBUG === 'true') console.debug('[DEBUG] Confirmation via callback button triggered for user', user_id);
        else console.info(`User ${user_id} confirmed answer via button`);

        // Remove the inline button First to prevent multiple clicks
        if (msg) {
            try {
                 await sendToTelegram('editMessageReplyMarkup', {
                    chat_id: msg.chat.id,
                    message_id: msg.message_id,
                    reply_markup: { inline_keyboard: [] }
                }, env);
            } catch (err) {
                 console.error('Failed to remove inline keyboard from confirmation message', err);
            }
        }

        await confirmRequest(req, user_id, env, false);
    }
}
