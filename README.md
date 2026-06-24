# GGS Accounts Telegram Bot

Message a Telegram bot like `200 - coffee - wants` and it logs the expense to a
Google Sheet, with a **new tab per month** (`2026-06`, `2026-07`, …). Each tab gets a
bold header, a ₹ currency column, and a category **dropdown** on the Type column.

Runs as a single Vercel serverless function .

## Message format

```
amount - description - category [- notes]
```

Examples:

```
200 - coffee - wants
130 - groceries - family - weekly run
₹1,200 - flight - investment
```

Categories: `needs, wants, family, investment, suspense`
(typos like `want` or `invst` are auto-corrected; an unknown category is rejected, not logged).

Commands: `/total` shows this month's spend, broken down by category.

## One-time setup (~15 min)

### 1. Create the bot
- In Telegram, message **@BotFather** → `/newbot` → follow prompts.
- Copy the **bot token** it gives you → `TELEGRAM_BOT_TOKEN`.
- Message **@userinfobot** to get your numeric id → `ALLOWED_CHAT_ID`
  (this locks the bot to only you).
- Invent any long random string → `TELEGRAM_SECRET_TOKEN`.

### 2. Create the Google Sheet
- Make a blank Google Sheet. Copy its id from the URL
  (`.../spreadsheets/d/THIS_PART/edit`) → `SPREADSHEET_ID`.
- You can leave the default `Sheet1`; the bot creates its own month tabs.

### 3. Create a service account (so the bot can write)
- Google Cloud Console → create/select a project → enable the **Google Sheets API**.
- IAM & Admin → Service Accounts → create one → add a **JSON key** → download it.
- From the JSON: `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
  `private_key` → `GOOGLE_PRIVATE_KEY` (keep the `\n` sequences, wrap in quotes).
- **Share the Sheet** (Editor) with that `client_email` address — easy step to forget.

### 4. Deploy
- Push this folder to a Git repo and import it on **vercel.com**, or run `vercel` from the CLI.
- Add all six env vars (see `.env.example`) in the Vercel project settings.
- Redeploy so the env vars take effect.

### 5. Connect Telegram to your deployment
```bash
export TELEGRAM_BOT_TOKEN=...        # same token as above
export TELEGRAM_SECRET_TOKEN=...     # same secret as above
./setup-webhook.sh https://your-app.vercel.app
```
You should see `{"ok":true,...}`.


