#!/bin/bash
echo "Setup Telegram Webhook with correct allowed_updates"
echo "---------------------------------------------------"
read -p "Enter your Telegram Bot Token: " TOKEN
read -p "Enter your Worker URL (e.g. https://my-bot.workers.dev/telegram): " URL

if [ -z "$TOKEN" ] || [ -z "$URL" ]; then
  echo "Token and URL are required."
  exit 1
fi

echo "Setting webhook..."
curl -F "url=$URL" -F "allowed_updates=[\"message\", \"chat_member\", \"chat_join_request\"]" "https://api.telegram.org/bot$TOKEN/setWebhook"

echo ""
echo "Done."
