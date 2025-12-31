/*
Telegram Join Request Bot — Cloudflare Workers (JavaScript)
*/

import { handleJoinRequest } from './handlers/join.js';
import { handleMessage } from './handlers/message.js';
import { handleChatMember } from './handlers/member.js';
import { processRemindersAndTimeouts } from './handlers/cron.js';

export default {
  async fetch(request, env) {
    try {
      if (request.method !== 'POST') return new Response('ok');
      const body = await request.json();

      if (body.chat_join_request) {
        await handleJoinRequest(body.chat_join_request, env);
      } else if (body.message) {
        await handleMessage(body.message, env);
      } else if (body.chat_member) {
        await handleChatMember(body.chat_member, env);
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