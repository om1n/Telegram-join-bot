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

1. **Request**: User requests to join the Telegram group.
2. **Screening**: The bot initiates a private chat (DM) with the user and asks the configured questions.
3. **Answer**: The user replies with their answers in a single message.
4. **Confirmation**: The bot shows the user their answer and asks for confirmation ("Yes" or "No").
    - **Yes**: The answer is confirmed and forwarded to the moderators.
    - **No**: The user can rewrite their answer.
5. **Approval**: Moderators review the request. If approved, the user is added to the group and receives a welcome message.

## Setup

### Prerequisites

- Cloudflare Account (Workers & D1)
- Telegram Bot Token
- Node.js & npm

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

### Configuration

1. Copy the example configuration:

   ```bash
   cp wrangler.toml.example wrangler.toml
   ```

2. Edit `wrangler.toml` to add your `database_id`.
3. Set the following secrets:

   ```bash
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put MOD_CHAT_ID
   wrangler secret put ADMIN_USER_ID
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

## Admin Commands

Send these commands to the bot in a private chat (must be `ADMIN_USER_ID`):

- `/help`: Show the list of available admin commands.
- `/status`: Show count of pending requests.
- `/pending`: List recent pending requests.
- `/config`: Show current configuration (IDs).
- `/force_cron`: Manually trigger the scheduled task (reminders/timeouts) and see detailed execution logs.
- `/reject <user_id>`: Manually reject a user's request (marks as rejected in DB).
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
