import { CONFIG } from './config.js';

const ruOrdinals = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый'];
const toRuOrdinal = (n) => ruOrdinals[n] || `${n}-й`;

const translations = {
    ru: {
        questions: (chatTitle) => [
            `Здравствуйте! Спасибо за заявку на вступление в группу *${chatTitle || 'группа'}*, крупнейшее сообщество русскоязычных продуктовых специалистов и руководителей в финтехе.`,
            `Пожалуйста, ответьте одним сообщением на три вопроса (в одном сообщении):`,
            `1) Чем вы занимаетесь?\n2) Как вы связаны с финтехом?\n3) Откуда узнали о финтех-кружке?`,
            `Кроме того, подтвердите, что не будете присылать рекламные сообщения или вакансии (напишите об этом в ответе).`,
            `После отправки ответа бот спросит, отправлять ли ваш ответ модераторам — нажмите кнопку под сообщением или напишите *"Да"* чтобы передать.`,
            `Пожалуйста, ответьте в течение недели (бот будет напоминать об этом), иначе ваша заявка будет отклонена.`
        ].join('\n\n'),

        spamWarning: (attempt) => `⚠️ Я вижу подозрительное поведение (повторная подача заявки: ${toRuOrdinal(attempt)} раз).
Если вы продолжите спамить заявками, вы будете забанены навсегда.
Пожалуйста, ответьте на вопросы анкеты и дождитесь решения модераторов.`,

        banned: `⛔ Вы были забанены за спам заявками (слишком много попыток подачи и отмены).
Решение окончательное.`,

        confirmation: (answerText) => `Вы хотите отправить следующий ответ:

${answerText}

Отправлять этот ответ модераторам? Нажмите кнопку ниже или напишите *"Да"*, и я передам, либо ответьте на вопросы ещё раз.`,
        
        confirmButtonText: 'Отправить ответ',
        autoForwardedMessage: '⏳ Прошел час, поэтому ваш ответ был автоматически передан модераторам на рассмотрение.',

        sentToModerators: 'Спасибо — ваш ответ отправлен модераторам.',

        rewriteRequested: `Хорошо — напишите, пожалуйста, ответ ещё раз в одном сообщении, отвечая на вопросы:
1) Чем вы занимаетесь?
2) Как вы связаны с финтехом?
3) Откуда узнали о финтех-кружке?

И подтвердите, что не будете присылать рекламные сообщения или вакансии.`,

        noPendingRequest: `Похоже, активной заявки от вас пока нет 👀

*Хотите вступить?* Нажмите кнопку «Подать заявку на вступление» ниже — бот пришлёт вам анкету.

Это закрытое сообщество продакт-менеджеров и продуктовых специалистов в финтехе. Реклама и спам в группе запрещены.

_Уже подавали заявку? Убедитесь, что пишете с того же аккаунта Telegram._`,

        dailyReminder: (daysLeft) => `Напоминание: пожалуйста, ответьте на вопросы для вступления в группу. У вас осталось ${daysLeft} ${daysLeft === 1 ? 'день' : (daysLeft > 1 && daysLeft < 5 ? 'дня' : 'дней')}.`,
        timeoutUser: 'Ваша заявка отклонена автоматически: срок для ответа истёк.',

        admin: {
            status: (count) => `Активных (pending) заявок: ${count}`,
            config: (modChatId, adminUserId) => `MOD_CHAT_ID=${modChatId}\nADMIN_USER_ID=${adminUserId}`,
            help: `/status — количество активных заявок
/pending — список ожидающих ответов
/config — показать конфиг
/cleanup — удалить дубликаты заявок
/reject <id> — отклонить заявку пользователя
/force_cron — принудительный запуск задач по расписанию
/help — это сообщение`,
            unknown: 'Неизвестная команда. /help',
            emptyPending: 'Пусто',
            cleanupSuccess: 'Cleanup done.',
            forceCron: (reminders, timeouts, errors) => {
                let msg = 'Cron tasks executed manually.';
                msg += `\nReminders: ${reminders}`;
                msg += `\nTimeouts: ${timeouts}`;
                if (errors && errors.length > 0) {
                    msg += `\nErrors:\n${errors.join('\n')}`;
                }
                return msg;
            },
            rejectUsage: 'Usage: /reject <user_id>',
            rejectNotFound: (id) => `No pending requests found for user ${id}`,
            rejectResult: (id, rejected, failed, errors) => {
                let msg = `Rejected ${rejected} requests for user ${id}.`;
                if (failed > 0) {
                    msg += `\nFailed: ${failed}`;
                    if (errors && errors.length > 0) msg += `\nErrors:\n${errors.join('\n')}`;
                }
                return msg;
            }
        },

        moderator: {
            newRequest: (username, displayName, userId, profileLink, answerText, chatId, requestDate, expiresAt, groupLink) =>
                `Новая подтверждённая заявка\n\n` +
                `*Пользователь:* ${username ? '@' + username : displayName}\n` +
                `*Имя:* ${displayName || ''}\n` +
                `*User ID:* ${userId}\n` +
                `*Профиль:* ${profileLink}\n` +
                `*Текст ответа:*\n` +
                `${answerText}\n` +
                `\n` +
                `*Группа:* ${chatId}${groupLink ? ', ' + groupLink : ''}\n` +
                `*Дата подачи:* ${requestDate}\n` +
                `*Дата истечения:* ${expiresAt}`,

            autoReject: (id, username, displayName, userId) =>
                `Авто-отказ заявки ID:${id} от пользователя ${username ? ('@' + username) : displayName} (ID:${userId}). Причина: автоматический отказ по сроку.`,

            userAdded: (user, admin, groupLink) =>
                `🎉 Пользователь добавлен в группу\n\n` +
                `*Кто:* ${user.first_name}${user.last_name ? ' ' + user.last_name : ''} (${user.username ? '@' + user.username : 'ID:' + user.id})\n` +
                `*Добавил:* ${admin.first_name}${admin.last_name ? ' ' + admin.last_name : ''} (${admin.username ? '@' + admin.username : 'ID:' + admin.id})\n` +
                `*Группа:* ${groupLink}`,

            spamBan: (user, attempts) =>
                `⛔ **БАН ЗА СПАМ**\n\n` +
                `Пользователь: ${user.first_name} (ID: ${user.id})\n` +
                `Username: ${user.username ? '@' + user.username : 'нет'}\n` +
                `Попыток подачи заявки: ${attempts}\n` +
                `Статус: Забанен ботом автоматически.`
        },

        welcome: (groupTitle) =>
            `Добро пожаловать в ${groupTitle || 'наше сообщество'}! 👋\n\n` +
            `Не забудьте представиться, рассказать о себе и своём опыте.\n` +
            `Пожалуйста, соблюдайте правила и ведите себя доброжелательно.`
    },

    en: {
        questions: (chatTitle) => [
            `Hello! Thank you for your request to join *${chatTitle || 'our group'}*.`,
            `Please answer these three questions in a single message:`,
            `1) What do you do?\n2) How are you connected to this topic?\n3) How did you hear about us?`,
            `Also, please confirm that you will not send spam or job ads.`,
            `After you reply, the bot will ask needed confirmation — click the button below the message or type *"Yes"* (or *"Да"*) to send it to moderators.`,
            `You have 7 days to complete this, otherwise the request will be rejected. You will receive daily reminders.`
        ].join('\n\n'),

        spamWarning: (attempt) => `⚠️ Suspicious behavior detected (attempt #${attempt}).\nIf you continue to spam requests, you will be banned permanently.\nPlease answer the questions and wait not for the decision.`,

        banned: `⛔ You have been banned for spamming requests.\nDecision is final.`,

        confirmation: (answerText) => `Do you want to send the following answer:\n\n${answerText}\n\nSend this answer to moderators? Click the button below or type *"Yes"* to confirm, or answer the questions again to rewrite.`,

        confirmButtonText: 'Send answer',
        autoForwardedMessage: '⏳ One hour has passed, so your answer was automatically forwarded to the moderators for review.',

        sentToModerators: 'Thank you — your answer has been sent to moderators.',

        rewriteRequested: `Okay — please write your answer again in a single message:\n1) What do you do?\n2) How are you connected?\n3) Source?\n\nAnd confirm no spam.`,

        noPendingRequest: `Looks like there's no active request from you yet 👀

*Want to join?* Click the «Request to Join» button below — the bot will send you a questionnaire.

This is a closed community for product managers and product specialists in fintech. Spam and advertising are strictly prohibited.

_Already applied? Make sure you're writing from the same Telegram account._`,

        dailyReminder: (daysLeft) => `Reminder: please answer the questions to join the group. You have ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left.`,
        timeoutUser: 'Your request was automatically rejected: time expired.',

        admin: {
            status: (count) => `Active (pending) requests: ${count}`,
            config: (modChatId, adminUserId) => `MOD_CHAT_ID=${modChatId}\nADMIN_USER_ID=${adminUserId}`,
            help: `/status — count pending
/pending — list pending
/config — show config
/cleanup — remove duplicates
/reject <id> — reject user
/force_cron — run cron manually
/help — this message`,
            unknown: 'Unknown command. /help',
            emptyPending: 'Empty',
            cleanupSuccess: 'Cleanup done.',
            forceCron: (reminders, timeouts, errors) => {
                let msg = 'Cron tasks executed manually.';
                msg += `\nReminders: ${reminders}`;
                msg += `\nTimeouts: ${timeouts}`;
                if (errors && errors.length > 0) {
                    msg += `\nErrors:\n${errors.join('\n')}`;
                }
                return msg;
            },
            rejectUsage: 'Usage: /reject <user_id>',
            rejectNotFound: (id) => `No pending requests found for user ${id}`,
            rejectResult: (id, rejected, failed, errors) => {
                let msg = `Rejected ${rejected} requests for user ${id}.`;
                if (failed > 0) {
                    msg += `\nFailed: ${failed}`;
                    if (errors && errors.length > 0) msg += `\nErrors:\n${errors.join('\n')}`;
                }
                return msg;
            }
        },

        moderator: {
            newRequest: (username, displayName, userId, profileLink, answerText, chatId, requestDate, expiresAt, groupLink) =>
                `New Confirmed Request\n\n` +
                `*User:* ${username ? '@' + username : displayName}\n` +
                `*Name:* ${displayName || ''}\n` +
                `*User ID:* ${userId}\n` +
                `*Profile:* ${profileLink}\n` +
                `*Answer:*\n` +
                `${answerText}\n` +
                `\n` +
                `*Group:* ${chatId}${groupLink ? ', ' + groupLink : ''}\n` +
                `*Date:* ${requestDate}\n` +
                `*Expires:* ${expiresAt}`,

            autoReject: (id, username, displayName, userId) =>
                `Auto-reject ID:${id} user ${username ? ('@' + username) : displayName} (ID:${userId}). Reason: expired.`,

            userAdded: (user, admin, groupLink) =>
                `🎉 User added to group\n\n` +
                `*Who:* ${user.first_name}${user.last_name ? ' ' + user.last_name : ''} (${user.username ? '@' + user.username : 'ID:' + user.id})\n` +
                `*Added by:* ${admin.first_name}${admin.last_name ? ' ' + admin.last_name : ''} (${admin.username ? '@' + admin.username : 'ID:' + admin.id})\n` +
                `*Group:* ${groupLink}`,

            spamBan: (user, attempts) =>
                `⛔ **SPAM BAN**\n\n` +
                `User: ${user.first_name} (ID: ${user.id})\n` +
                `Username: ${user.username ? '@' + user.username : 'none'}\n` +
                `Attempts: ${attempts}\n` +
                `Status: Auto-banned.`
        },

        welcome: (groupTitle) =>
            `Welcome to ${groupTitle || 'our community'}! 👋\n\n` +
            `Please introduce yourself.\n` +
            `Please follow the rules and be kind.`
    }
};

export const MESSAGES = translations[CONFIG.LANGUAGE] || translations.ru;
