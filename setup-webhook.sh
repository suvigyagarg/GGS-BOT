p
set -euo pipefail

URL="${1:?Pass your Vercel base URL, e.g. https://your-app.vercel.app}"

curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"${URL%/}/api/telegram\",\"secret_token\":\"${TELEGRAM_SECRET_TOKEN}\",\"allowed_updates\":[\"message\"]}"
echo
