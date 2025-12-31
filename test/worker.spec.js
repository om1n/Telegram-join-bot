import { env, createExecutionContext, waitOnExecutionContext, SELF, applyD1Migrations } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/worker';
import { MESSAGES } from '../src/messages';

// Mock fetch for Telegram API calls
global.fetch = vi.fn();

describe('Telegram Join Request Bot', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        fetch.mockResolvedValue(createResponse({ ok: true }));

        // Mock env vars
        env.MOD_CHAT_ID = '-100999';
        env.ADMIN_USER_ID = '123456';
        env.TELEGRAM_BOT_TOKEN = 'test_token';

        // Apply schema
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            username TEXT,
            display_name TEXT,
            request_date INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', -- pending, answered, confirmed, rejected, timed_out
            answer_text TEXT,
            answer_date INTEGER,
            confirmed_date INTEGER,
            reminder_3_sent INTEGER DEFAULT 0,
            reminder_6_sent INTEGER DEFAULT 0,
            last_reminder_ts INTEGER
          )`).run();

        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id INTEGER,
            user_id INTEGER,
            event_type TEXT, -- submitted, answered, confirmed, reminder_sent, auto_rejected, admin_action
            event_ts INTEGER,
            data TEXT
          )`).run();
    });

    function createResponse(data) {
        return {
            json: () => Promise.resolve(data),
            ok: true
        };
    }

    it('handleJoinRequest: saves request and sends questions', async () => {
        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({
                chat_join_request: {
                    chat: { id: 123, title: 'Test_Chat*' },
                    from: { id: 123, first_name: 'User', is_bot: false },
                    date: 1000
                }
            })
        });

        await worker.fetch(request, env);

        // Check DB
        const { results } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(123).all();
        expect(results.length).toBe(1);
        expect(results[0].status).toBe('pending');
        expect(results[0].chat_id).toBe('123');

        // Check Telegram API call
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                method: 'POST',
                // We expect escaping: Test_Chat* -> Test\_Chat\*
                body: expect.stringContaining(MESSAGES.questions('Test\\_Chat\\*').substring(0, 20))
            })
        );

        // precise check for new text
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining('ежедневные напоминания')
            })
        );
    });

    it('handleMessage: ignores commands when pending', async () => {
        // Setup pending request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', 123, 1000, 2000, 'pending').run();

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({
                message: {
                    chat: { id: 123, type: 'private' },
                    from: { id: 123, is_bot: false },
                    text: '/start'
                }
            })
        });

        await worker.fetch(request, env);

        // Should NOT send any message (ignored)
        expect(fetch).not.toHaveBeenCalled();
    });

    it('handleMessage: saves answer and asks confirmation', async () => {
        // Setup pending request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', 124, 1000, 2000, 'pending').run();
        const { results: [req] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(124).all();

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({
                message: {
                    chat: { id: 124, type: 'private' },
                    from: { id: 124, is_bot: false },
                    text: 'My Answer'
                }
            })
        });

        await worker.fetch(request, env);

        // Check DB update
        const { results: [updated] } = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(req.id).all();
        expect(updated.status).toBe('answered');
        expect(updated.answer_text).toBe('My Answer');

        // Check confirmation message
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining('Вы отправили следующий ответ')
            })
        );
    });

    it('handleMessage: confirms and sends to moderators', async () => {
        // Setup answered request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status, answer_text) VALUES (?, ?, ?, ?, ?, ?)")
            .bind('-100', 125, 1000, 2000, 'answered', 'My Answer').run();

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({
                message: {
                    chat: { id: 125, type: 'private' },
                    from: { id: 125, is_bot: false },
                    text: 'Да'
                }
            })
        });

        await worker.fetch(request, env);

        // Check DB update
        const { results: [updated] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(125).all();
        expect(updated.status).toBe('confirmed');

        // Check moderator message
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining(env.MOD_CHAT_ID) // sending to mod chat
            })
        );

        // Verify no double escaping of exclamation marks
        const callArgs = fetch.mock.calls.find(call => call[0].includes('/sendMessage') && call[1].body.includes(env.MOD_CHAT_ID));
        const body = JSON.parse(callArgs[1].body);
        expect(body.text).not.toContain('\\!');
        expect(body.text).toContain('My Answer');
    });

    it('handleMessage: escapes markdown in moderator message', async () => {
        const userId = 125;
        // Setup answered request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status, answer_text) VALUES (?, ?, ?, ?, ?, ?)")
            .bind('-100', 125, 1000, 2000, 'answered', 'My Answer*').run();

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({
                message: {
                    chat: { id: 125, type: 'private' },
                    from: { id: 125, is_bot: false },
                    text: 'Да'
                }
            })
        });

        await worker.fetch(request, env);

        const callArgs = fetch.mock.calls.find(call => call[0].includes('/sendMessage') && call[1].body.includes(env.MOD_CHAT_ID));
        const body = JSON.parse(callArgs[1].body);
        expect(body.text).not.toContain('\\!');
        expect(body.text).toContain('My Answer\\*');
    });

    it('handleMessage: truncates long messages', async () => {
        const userId = 301;
        const longText = 'a'.repeat(3000);
        // Setup pending request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', userId, 1000, 2000, 'pending').run();

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({
                message: {
                    chat: { id: userId, type: 'private' },
                    from: { id: userId, is_bot: false },
                    text: longText
                }
            })
        });

        await worker.fetch(request, env);

        // Check DB
        const { results: [updated] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(userId).all();
        expect(updated.answer_text.length).toBe(2000);
    });

    it('handleMessage: confirms with variations (yes, Да!, etc)', async () => {
        const variations = ['Да!', 'yes', 'YES', 'да.', 'Yes...'];

        for (const [index, variant] of variations.entries()) {
            const userId = 200 + index;
            // Setup answered request
            await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status, answer_text) VALUES (?, ?, ?, ?, ?, ?)")
                .bind('-100', userId, 1000, 2000, 'answered', 'My Answer').run();

            const request = new Request('http://localhost', {
                method: 'POST',
                body: JSON.stringify({
                    message: {
                        chat: { id: userId, type: 'private' },
                        from: { id: userId, is_bot: false },
                        text: variant
                    }
                })
            });

            await worker.fetch(request, env);

            // Check DB update
            const { results: [updated] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(userId).all();
            expect(updated.status).toBe('confirmed');
        }
    });



    it('scheduled: timeouts expired requests', async () => {
        const now = Math.floor(Date.now() / 1000);
        const expired = now - 100;

        // Setup expired request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', 128, expired - 1000, expired, 'pending').run();

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        // Check DB
        const { results: [updated] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(128).all();
        expect(updated.status).toBe('timed_out');

        // Check rejection call
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/declineChatJoinRequest'),
            expect.anything()
        );

        // Check moderator notification (should have parse_mode)
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining(env.MOD_CHAT_ID)
            })
        );
        const modCall = fetch.mock.calls.find(c => c[1].body.includes(env.MOD_CHAT_ID) && c[1].body.includes('Авто-отказ'));
        const modBody = JSON.parse(modCall[1].body);
        expect(modBody.parse_mode).toBe('Markdown');
    });

    it('scheduled: does not reject if newer pending request exists', async () => {
        const now = Math.floor(Date.now() / 1000);
        const oldExpired = now - 100;
        const userId = 999;

        // 1. Old request (expired)
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', userId, oldExpired - 7 * 24 * 3600, oldExpired, 'pending').run();

        // 2. New request (active)
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', userId, now, now + 7 * 24 * 3600, 'pending').run();

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        // Check that we did NOT call declineChatJoinRequest for this user
        const calls = fetch.mock.calls.filter(c => c[0].includes('/declineChatJoinRequest'));
        const rejectedUsers = calls.map(c => JSON.parse(c[1].body).user_id);
        expect(rejectedUsers).not.toContain(userId);
    });

    it('scheduled: does not mark as timed_out if rejection fails (API error)', async () => {
        const now = Math.floor(Date.now() / 1000);
        const expired = now - 100;
        const userId = 888;

        // Setup expired request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', userId, expired - 1000, expired, 'pending').run();

        // FAIL the next declineChatJoinRequest call
        fetch.mockImplementation(async (url, options) => {
            if (url.includes('declineChatJoinRequest')) {
                return createResponse({ ok: false, description: 'Temporary network error' });
            }
            return createResponse({ ok: true });
        });

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        // Check DB: should still be pending because API call failed locally or temporarily
        const { results: [req] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(userId).all();
        expect(req.status).toBe('pending');
    });

    it('scheduled: handles USER_ID_INVALID by marking as user_missing_or_banned', async () => {
        const now = Math.floor(Date.now() / 1000);
        const expired = now - 100;
        const userId = 901;

        // Setup expired request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', userId, expired - 1000, expired, 'pending').run();

        // FAIL with USER_ID_INVALID
        fetch.mockImplementation(async (url, options) => {
            if (url.includes('declineChatJoinRequest')) {
                return createResponse({ ok: false, description: 'Bad Request: USER_ID_INVALID' });
            }
            return createResponse({ ok: true });
        });

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        // Check DB status
        const { results: [req] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(userId).all();
        expect(req.status).toBe('user_missing_or_banned');
    });

    it('scheduled: handles deactivated user by marking as user_missing_or_banned', async () => {
        const now = Math.floor(Date.now() / 1000);
        const expired = now - 100;
        const userId = 905;

        // Setup expired request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', userId, expired - 1000, expired, 'pending').run();

        // FAIL with user is deactivated
        fetch.mockImplementation(async (url, options) => {
            if (url.includes('declineChatJoinRequest')) {
                return createResponse({ ok: false, description: 'Forbidden: user is deactivated' });
            }
            return createResponse({ ok: true });
        });

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        // Check DB status
        const { results: [req] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(userId).all();
        expect(req.status).toBe('user_missing_or_banned');
    });

    it('scheduled: handles HIDE_REQUESTER_MISSING by marking as request_no_longer_valid', async () => {
        const now = Math.floor(Date.now() / 1000);
        const expired = now - 100;
        const userId = 902;

        // Setup expired request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', userId, expired - 1000, expired, 'pending').run();

        // FAIL with HIDE_REQUESTER_MISSING
        fetch.mockImplementation(async (url, options) => {
            if (url.includes('declineChatJoinRequest')) {
                return createResponse({ ok: false, description: 'Bad Request: HIDE_REQUESTER_MISSING' });
            }
            return createResponse({ ok: true });
        });

        const ctx = createExecutionContext();
        await worker.scheduled({}, env, ctx);
        await waitOnExecutionContext(ctx);

        // Check DB status
        const { results: [req] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(userId).all();
        expect(req.status).toBe('request_no_longer_valid');
    });

    it('handleJoinRequest: supersedes old pending requests', async () => {
        const userId = 400;
        const chat = { id: -100, title: 'Test Chat' };
        const user = { id: userId, first_name: 'John', is_bot: false };

        // 1. First request
        await worker.fetch(new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ chat_join_request: { chat, from: user, date: 1000 } })
        }), env);

        // 2. Second request (same user)
        await worker.fetch(new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ chat_join_request: { chat, from: user, date: 2000 } })
        }), env);

        // Check DB: Should have 2 requests, but only 1 'pending'
        const { results } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ? ORDER BY id ASC').bind(userId).all();

        expect(results.length).toBe(2);
        expect(results[0].status).toBe('superseded'); // Old one
        expect(results[1].status).toBe('pending');    // New one
    });
    it('handleChatMember: welcomes user and notifies moderators when added', async () => {
        const user = { id: 500, first_name: 'New', last_name: 'Member', username: 'new_mem*', is_bot: false };
        const admin = { id: 600, first_name: 'Admin', is_bot: false };
        const chat = { id: -100, title: 'My_Group*' };

        // chat_member update payload
        const payload = {
            chat_member: {
                chat: chat,
                from: admin,
                date: 123456,
                old_chat_member: { status: 'left', user: user },
                new_chat_member: { status: 'member', user: user }
            }
        };

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        await worker.fetch(request, env);

        // 1. Check Welcome Message
        // Title: My_Group* -> My\_Group\*
        // The message starts with "Добро пожаловать в My\_Group\*..."
        // MESSAGES.welcome(escaped)
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                // Check for start of message or something simple to verify call happened
                body: expect.stringContaining('chat_id')
            })
        );
        // We find the call specifically by content
        const welcomeCall = fetch.mock.calls.find(c => c[1].body.includes('My\\\\_Group\\\\*'));
        const welcomeBody = JSON.parse(welcomeCall[1].body);
        expect(welcomeBody.chat_id).toBe(user.id);

        // 2. Check Moderator Notification
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining(env.MOD_CHAT_ID)
            })
        );
        const modCall = fetch.mock.calls.find(c => c[1].body.includes(env.MOD_CHAT_ID) && c[1].body.includes('Пользователь добавлен'));
        const modBody = JSON.parse(modCall[1].body);
        expect(modBody.text).toContain('New Member');
        // username: new_mem* -> new\_mem\*
        expect(modBody.text).toContain('@new\\_mem\\*');
        expect(modBody.text).toContain('Admin');
    });

    it('handleAdminCommand: /reject <user_id> rejects user', async () => {
        const adminId = env.ADMIN_USER_ID;
        const targetUserId = 777;

        // Setup pending request
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', targetUserId, 1000, 2000, 'pending').run();

        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({
                message: {
                    chat: { id: adminId, type: 'private' },
                    from: { id: adminId, is_bot: false },
                    text: `/reject ${targetUserId}`
                }
            })
        });

        await worker.fetch(request, env);

        // Check DB: should be 'rejected'
        const { results: [req] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ?').bind(targetUserId).all();
        expect(req.status).toBe('rejected');

        // Check Telegram API calls
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/declineChatJoinRequest'),
            expect.objectContaining({
                body: expect.stringContaining(`"user_id":${targetUserId}`)
            })
        );

        // Check confirmation message to admin
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining(`Rejected 1 requests for user ${targetUserId}`)
            })
        );
    });

    it('handleAdminCommand: ignores commands from non-admins', async () => {
        const nonAdminId = 99999;
        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({
                message: {
                    chat: { id: nonAdminId, type: 'private' },
                    from: { id: nonAdminId, is_bot: false },
                    text: '/status'
                }
            })
        });

        await worker.fetch(request, env);

        // Should NOT send status message
        expect(fetch).not.toHaveBeenCalled();
    });

    it('handleJoinRequest: sends warning on 3rd attempt', async () => {
        const userId = 801;
        const chat = { id: -100, title: 'Test Chat' };

        // Populate 2 prior requests (submitted/revoked logic simulations)
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', userId, 1000, 2000, 'superseded').run();
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', userId, 2000, 3000, 'superseded').run();

        // 3rd request
        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ chat_join_request: { chat, from: { id: userId, is_bot: false }, date: 3000 } })
        });
        await worker.fetch(request, env);

        // Should have sent questions AND warning
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining('подозрительное поведение')
            })
        );
    });

    it('handleJoinRequest: bans on 5th attempt', async () => {
        const userId = 802;
        const chat = { id: -100, title: 'Test Chat' };

        // Populate 4 prior requests
        for (let i = 0; i < 4; i++) {
            await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
                .bind('-100', userId, 1000 + i, 2000 + i, 'superseded').run();
        }

        // 5th request
        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ chat_join_request: { chat, from: { id: userId, is_bot: false, first_name: 'Spammer' }, date: 5000 } })
        });
        await worker.fetch(request, env);

        // 1. banChatMember
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/banChatMember'),
            expect.objectContaining({
                body: expect.stringContaining(`"user_id":${userId}`)
            })
        );
        // 2. declineChatJoinRequest
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/declineChatJoinRequest'),
            expect.objectContaining({
                body: expect.stringContaining(`"user_id":${userId}`)
            })
        );
        // 3. User notification (banned)
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining('Вы были забанены')
            })
        );

        // 4. Moderator notification
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/sendMessage'),
            expect.objectContaining({
                body: expect.stringContaining(env.MOD_CHAT_ID)
            })
        );
        const modCall = fetch.mock.calls.find(c => c[1].body.includes(env.MOD_CHAT_ID) && c[1].body.includes('БАН ЗА СПАМ'));
        expect(modCall).toBeDefined();

        // 5. Check DB status is 'banned' for previous requests?
        // Actually the code updates "pending" or "answered" to "banned". 
        // Our setup created 'superseded' requests. Let's create one 'pending' to be sure.
        // But wait, the loop created 'superseded'. 
        // Logic: UPDATE requests SET status = 'banned' WHERE user_id = ? ... AND status IN ('pending', 'answered')
        // So existing 'superseded' won't change. 
        // But if I had a pending one hanging, it should change.
        // Let's verify that.
    });

    it('handleJoinRequest: marks pending requests as banned on spam ban', async () => {
        const userId = 803;
        const chat = { id: -100, title: 'Test Chat' };

        // 1. Pending request (hanging)
        await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
            .bind('-100', userId, 1000, 2000, 'pending').run();

        // 3 other superseded requests (total 4 existing)
        for (let i = 0; i < 3; i++) {
            await env.DB.prepare("INSERT INTO requests (chat_id, user_id, request_date, expires_at, status) VALUES (?, ?, ?, ?, ?)")
                .bind('-100', userId, 1000 + i, 2000 + i, 'superseded').run();
        }

        // 5th attempt
        const request = new Request('http://localhost', {
            method: 'POST',
            body: JSON.stringify({ chat_join_request: { chat, from: { id: userId, is_bot: false, first_name: 'Spammer' }, date: 5000 } })
        });
        await worker.fetch(request, env);

        // Verify pending request became banned
        const { results: [req] } = await env.DB.prepare('SELECT * FROM requests WHERE user_id = ? AND request_date = 1000').bind(userId).all();
        expect(req.status).toBe('banned');
    });
});

