import { CONFIG } from './config.js';

const translations = {
    ru: {
        questions: (chatTitle) => `Здравствуйте! Спасибо за заявку на вступление в группу *${chatTitle || 'группа'}*, крупнейшее сообщество руссоязычных продуктовых специалистов и руководителей в финтехе.

Пожалуйста, ответьте одним сообщением на три вопроса (в одном сообщении):

1) Чем вы занимаетесь?
2) Как вы связаны с финтехом?
3) Откуда узнали о финтех-кружке?

Кроме того, подтвердите, что не будете присылать рекламные сообщения или вакансии (напишите об этом в ответе).

После отправки ответа бот спросит, отправлять ли ваш ответ модераторам — напишите *"Да"* чтобы передать.

У вас есть 7 дней на заполнение анкеты, иначе заявка будет отклонена. Бот будет присылать ежедневные напоминания.`,

        spamWarning: (attempt) => `⚠️ Я вижу подозрительное поведение (повторная подача заявки: ${attempt}-й раз).
Если вы продолжите спамить заявками, вы будете забанены навсегда.
Пожалуйста, ответьте на вопросы анкеты и дождитесь решения модераторов.`,

        banned: `⛔ Вы были забанены за спам заявками (слишком много попыток подачи и отмены).
Решение окончательное.`,

        confirmation: (answerText) => `Вы отправили следующий ответ:

${answerText}

Отправлять этот ответ модераторам? Напишите *"Да"* и я передам, или ответьте на вопросы ещё раз.`,

        sentToModerators: 'Спасибо — ваш ответ отправлен модераторам.',

        rewriteRequested: `Хорошо — напишите, пожалуйста, ответ ещё раз в одном сообщении, отвечая на вопросы:
1) Чем вы занимаетесь?
2) Как вы связаны с финтехом?
3) Откуда узнали о финтех-кружке?

И подтвердите, что не будете присылать рекламные сообщения или вакансии.`,

        noPendingRequest: 'У нас нет ожидающей заявки для вас. Если вы подавали заявку, проверьте, пожалуйста, что вы отвечаете с того же аккаунта.',

        dailyReminder: (daysLeft) => `Напоминание: пожалуйста, ответьте на вопросы для вступления в группу. У вас осталось ${daysLeft} ${daysLeft === 1 ? 'день' : (daysLeft > 1 && daysLeft < 5 ? 'дня' : 'дней')}.`,
        timeoutUser: 'Ваша заявка отклонена автоматически: срок для ответа истёк.',

        admin: {
            status: (count) => `Активных (pending) заявок: ${count}`,
            config: (modChatId, adminUserId) => `MOD_CHAT_ID=${modChatId}\nADMIN_USER_ID=${adminUserId}`,
            help: `/status — количество активных заявок\n/pending — список ожидающих ответов\n/config — показать конфиг\n/cleanup — удалить дубликаты заявок\n/reject <id> — отклонить заявку пользователя\n/force_cron — принудительный запуск задач по расписанию\n/help — это сообщение`,
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
            newRequest: (username, displayName, userId, profileLink, answerText, chatId, requestDate, expiresAt) =>
                `Новая подтверждённая заявка\n
*Пользователь:* ${username ? '@' + username : displayName}
*Имя:* ${displayName || ''}
*User ID:* ${userId}
*Профиль:* ${profileLink}
*Текст ответа:*
${answerText}

*Группа:* ${chatId}
*Дата подачи:* ${requestDate}
*Дата истечения:* ${expiresAt}`,

            autoReject: (id, username, displayName, userId) =>
                `Авто-отказ заявки ID:${id} от пользователя ${username ? ('@' + username) : displayName} (ID:${userId}). Причина: автоматический отказ по сроку.`,

            userAdded: (user, admin, groupTitle) =>
                `🎉 Пользователь добавлен в группу\n\n` +
                `*Кто:* ${user.first_name}${user.last_name ? ' ' + user.last_name : ''} (${user.username ? '@' + user.username : 'ID:' + user.id})\n` +
                `*Добавил:* ${admin.first_name}${admin.last_name ? ' ' + admin.last_name : ''} (${admin.username ? '@' + admin.username : 'ID:' + admin.id})\n` +
                `*Группа:* ${groupTitle}`,

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
        questions: (chatTitle) => `Hello! Thank you for your request to join *${chatTitle || 'our group'}*.\n\nPlease answer these three questions in a single message:\n\n1) What do you do?\n2) How are you connected to this topic?\n3) How did you hear about us?\n\nAlso, please confirm that you will not send spam or job ads.\n\nAfter you reply, the bot will ask needed confirmation — type *"Yes"* (or *"Да"*) to send it to moderators.\n\nYou have 7 days to complete this, otherwise the request will be rejected. You will receive daily reminders.`,

        spamWarning: (attempt) => `⚠️ Suspicious behavior detected (attempt #${attempt}).\nIf you continue to spam requests, you will be banned permanently.\nPlease answer the questions and wait not for the decision.`,

        banned: `⛔ You have been banned for spamming requests.\nDecision is final.`,

        confirmation: (answerText) => `You sent the following answer:\n\n${answerText}\n\nSend this answer to moderators? Type *"Yes"* to confirm, or answer the questions again to rewrite.`,

        sentToModerators: 'Thank you — your answer has been sent to moderators.',

        rewriteRequested: `Okay — please write your answer again in a single message:\n1) What do you do?\n2) How are you connected?\n3) Source?\n\nAnd confirm no spam.`,

        noPendingRequest: 'No pending request found for you. If you applied, please check you are using the same account.',

        dailyReminder: (daysLeft) => `Reminder: please answer the questions to join the group. You have ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left.`,
        timeoutUser: 'Your request was automatically rejected: time expired.',

        admin: {
            status: (count) => `Active (pending) requests: ${count}`,
            config: (modChatId, adminUserId) => `MOD_CHAT_ID=${modChatId}\nADMIN_USER_ID=${adminUserId}`,
            help: `/status — count pending\n/pending — list pending\n/config — show config\n/cleanup — remove duplicates\n/reject <id> — reject user\n/force_cron — run cron manually\n/help — this message`,
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
            newRequest: (username, displayName, userId, profileLink, answerText, chatId, requestDate, expiresAt) =>
                `New Confirmed Request\n
*User:* ${username ? '@' + username : displayName}
*Name:* ${displayName || ''}
*User ID:* ${userId}
*Profile:* ${profileLink}
*Answer:*
${answerText}

*Group:* ${chatId}
*Date:* ${requestDate}
*Expires:* ${expiresAt}`,

            autoReject: (id, username, displayName, userId) =>
                `Auto-reject ID:${id} user ${username ? ('@' + username) : displayName} (ID:${userId}). Reason: expired.`,

            userAdded: (user, admin, groupTitle) =>
                `🎉 User added to group\n\n` +
                `*Who:* ${user.first_name}${user.last_name ? ' ' + user.last_name : ''} (${user.username ? '@' + user.username : 'ID:' + user.id})\n` +
                `*Added by:* ${admin.first_name}${admin.last_name ? ' ' + admin.last_name : ''} (${admin.username ? '@' + admin.username : 'ID:' + admin.id})\n` +
                `*Group:* ${groupTitle}`,

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
