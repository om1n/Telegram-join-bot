# Telegram Join Request Bot

This Cloudflare Worker bot manages join requests for a Telegram group. It screens users by asking them 3 questions before forwarding their answers to a moderator group for manual approval. It also handles reminders and automatic shutdowns for stale requests.

## Features

- **Automated Screening**: DMs users upon join request with a questionnaire.
- **Moderator Loop**: Forwards confirmed answers to a moderator group.
- **Timeouts**: Specifically handles request expiration (7 days).
- **Reminders**: Sends daily reminders if the user has not answered questions.
- **Spam Protection**: Detects and bans users who repeatedly spam join requests.
  - **Warnings**: Users receive a warning after 3 cancelled/new attempts.
  - **Ban**: Users are automatically banned from the group after 5 attempts.
- **Welcome Message**: Sends a welcome message to the user upon being added to the group.
- **Member Notifications**: Notifies the moderator chat when a new member is successfully added.
- **Localization**: Supports multiple languages (Default: Russian `ru`, English `en` available).
- **Robust Error Handling**: Handles cases where users are missing or requests are revoked (`user_missing_or_banned`, `request_no_longer_valid`).

## User Guide (Interaction Flow)

> **No active request?** If a user messages the bot without a pending join request, the bot will explain what the group is about and show an inline button **"📨 Подать заявку на вступление"** linking directly to the group ([t.me/fintechprod](https://t.me/fintechprod)), where they can tap *Request to Join* to start the flow.

1. **Request**: User requests to join the Telegram group.
2. **Screening**: The bot initiates a private chat (DM) with the user and asks the configured questions.
3. **Answer**: The user replies with their answers in a single message. **Note:** Answers are accepted *strictly* via Direct Messages (DMs). Messages exceeding 2000 characters will be automatically truncated.
4. **Confirmation**: The bot shows the user their answer and asks for confirmation via an inline button ("Отправить ответ") or by typing "Yes" / "Да".
    - **Confirmed**: The answer is confirmed and forwarded to the moderators.
    - **Auto-forward**: If the user forgets to click/type after 1 hour, the request is automatically forwarded to the moderators.
    - **Rejected (Rewrite)**: If the user types anything other than "Yes", they can rewrite their answer.
5. **Approval**: The bot forwards the questionnaire to the moderator group as text. Moderators review it and must use Telegram's built-in "Join Requests" UI (the banner in the group/channel) to approve or reject the user. The bot does not provide inline approval buttons.

## Setup

### Prerequisites

- Cloudflare Account (Workers & D1)
- Telegram Bot Token
- Node.js & npm

### BotFather Setup

Configure your bot via [@BotFather](https://t.me/BotFather) before starting:

1. **Token**: Create a new bot to get your `<TELEGRAM_BOT_TOKEN>`.
2. **Privacy Mode**: Disable Privacy Mode (`/setprivacy` -> Disable) to ensure the bot can read messages properly if added to other context groups.
3. **Groups**: Ensure the bot can be added to groups (`/setjoingroups` -> Enable).

### Bot Permissions

To function correctly, the bot must be an Administrator in the target group with the following permissions:

- **Ban Users**: Required for the Spam Protection feature to ban repeat offenders.
- **Approve Join Requests**: Required (implicit for admins) to manage the requests.
- **Send Messages**: Required in the Moderator Chat to send notifications.

### Database

1. Create a D1 database: `wrangler d1 create joinbot`
2. Update `wrangler.toml` with your new `database_id` (copy from `wrangler.toml.example` if needed).
3. Initialize schema:

   ```bash
   wrangler d1 execute joinbot --file=./schema.sql
   ```

> **Migrations**: D1 supports migrations. For future updates, apply schema changes using Wrangler's migration system or run specific `ALTER TABLE` commands. Avoid simply re-running `schema.sql` on a production database to prevent data loss.

### Configuration

1. Copy the example configuration:

   ```bash
   cp wrangler.toml.example wrangler.toml
   ```

2. Edit `wrangler.toml` to add your `database_id`.
3. **Cron Triggers**: Ensure the `[triggers]` block is uncommented/configured in your `wrangler.toml` (see `wrangler.toml.example`). Without this configuring to `crons = ["0 * * * *"]`, automated tasks (reminders, timeouts) will not execute.
4. Set the following secrets:

   ```bash
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put MOD_CHAT_ID
   wrangler secret put ADMIN_USER_ID
   wrangler secret put WEBHOOK_SECRET # Optional, but highly recommended for security
   ```

### Hardcoded Configs

The following settings can be adjusted in `src/config.js`:

| Constant | Default | Description |
| :--- | :--- | :--- |
| `LANGUAGE` | `'ru'` | Bot language (`'ru'` or `'en'`). |
| `REQUEST_EXPIRY_DAYS` | `7` | Days before a pending request is auto-rejected. |
| `DAILY_REMINDER_INTERVAL_HOURS` | `23.1` | Hours between reminder messages to users. |
| `SPAM_BAN_ATTEMPTS` | `5` | Number of repeatedly cancelled/new requests before ban. |
| `SPAM_WARNING_ATTEMPTS_START` | `3` | Attempt count to start sending spam warnings. |
| `MAX_MESSAGE_LENGTH` | `2000` | Max length for user answers (truncated otherwise). |

### Data Privacy

This bot stores user data (ID, username, display name, request history) in a D1 database to function.

- **Retention**: Data is currently retained indefinitely for spam protection and history.
- **Logs**: Event logs are stored in the `events` table. Note that this may include PII (usernames).

### Deployment

```bash
npm install
npm run deploy
```

**Crucial Step: Set Webhook**
After deployment, explicitly tell Telegram to route events to your Cloudflare Worker. We strictly define `allowed_updates` so Telegram sends everything we need (including button clicks):

```bash
# If using a WEBHOOK_SECRET, add `-F "secret_token=<YOUR_WEBHOOK_SECRET>"` to this command
curl -F "url=https://<YOUR_WORKER_URL>" -F "allowed_updates=[\"message\", \"chat_member\", \"chat_join_request\", \"callback_query\"]" "https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook"
```

Alternatively, use the provided helper script: `./scripts/setup-webhook.sh` which will also prompt you for the optional webhook secret.

## Admin Commands

Send these commands to the bot in a private chat (must be `ADMIN_USER_ID`):

- `/help`: Show the list of available admin commands.
- `/status`: Show count of pending requests.
- `/pending`: List recent pending requests.
- `/config`: Show current configuration (IDs).
- `/force_cron`: Manually trigger the scheduled task (reminders/timeouts) and see detailed execution logs.
- `/reject <user_id>`: Manually reject a user's request. This actively calls `declineChatJoinRequest` in Telegram API to deny entry, in addition to marking it rejected in the DB.
- `/cleanup`: Remove duplicate superseded requests (maintenance).

> **Security Note**: These commands are strictly protected. They can ONLY be executed by the user with `ADMIN_USER_ID`. Commands sent by any other user will be silently ignored to prevent information leakage or spam.

## Statuses

The bot uses the following statuses for requests:

- `pending`: User submitted request, waiting for answer.
- `answered`: User answered questions, waiting for confirmation.
- `confirmed`: User confirmed answers, sent to mods.
- `rejected`: Manually rejected.
- `timed_out`: Auto-rejected after 7 days.
- `superseded`: User submitted a new request, replacing this one.
- `user_missing_or_banned`: processing failed because user doesn't exist (Telegram API `USER_ID_INVALID`).
- `request_no_longer_valid`: processing failed because request is gone (Telegram API `HIDE_REQUESTER_MISSING`).

## Development

Run tests:

```bash
npm test
```

## Project Structure

- `src/handlers/`: Business logic modules (join requests, messages, cron).
- `src/services/`: External integrations (Telegram API).
- `src/config.js`: Configuration constants (language, timeouts).
- `src/worker.js`: Cloudflare Worker entry point.
- `src/messages.js`: Internationalized message dictionary.
- `schema.sql`: D1 Database schema.
