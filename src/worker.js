/*
Telegram Join Request Bot — Cloudflare Workers (JavaScript)
*/

import { handleJoinRequest } from './handlers/join.js';
import { handleMessage } from './handlers/message.js';
import { handleChatMember } from './handlers/member.js';
import { handleCallbackQuery } from './handlers/callback.js';
import { processRemindersAndTimeouts } from './handlers/cron.js';

export default {
  async fetch(request, env) {
    try {
      if (request.method !== 'POST') return new Response('ok');

      // Security: Webhook Authentication
      if (env.WEBHOOK_SECRET) {
        const token = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
        const secret = env.WEBHOOK_SECRET;
        let mismatch = token.length === secret.length ? 0 : 1;
        const compareToken = mismatch === 0 ? token : secret;
        for (let i = 0; i < secret.length; i++) {
          mismatch |= compareToken.charCodeAt(i) ^ secret.charCodeAt(i);
        }
        if (mismatch !== 0) {
          console.warn('Unauthorized webhook request: invalid or missing secret token');
          return new Response('Unauthorized', { status: 401 });
        }
      }

      const body = await request.json();

      if (body.chat_join_request) {
        await handleJoinRequest(body.chat_join_request, env);
      } else if (body.message) {
        await handleMessage(body.message, env);
      } else if (body.chat_member) {
        await handleChatMember(body.chat_member, env);
      } else if (body.callback_query) {
        await handleCallbackQuery(body.callback_query, env);
      }

      return new Response('ok');
    } catch (err) {
      console.error('fetch handler error', err);
      return new Response('error', { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    try {
      await processRemindersAndTimeouts(env);
    } catch (err) {
      console.error('scheduled error', err);
    }
  }
};