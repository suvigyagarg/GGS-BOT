import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseExpense, CATEGORIES } from './lib/parse';
import { ensureMonthSheet, appendExpense, monthTotals } from './lib/sheets';
import { istParts } from './lib/util';

async function send(chatId: number, text: string, html = false): Promise<void> {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(html ? { parse_mode: 'HTML' } : {}),
    }),
  });
}

const HELP =
  'Log an expense as:\n' +
  '<code>amount - description - category [- notes]</code>\n\n' +
  'e.g. <code>200 - coffee - wants</code>\n' +
  'or   <code>130 - groceries - family - weekly run</code>\n\n' +
  `Categories: ${CATEGORIES.join(', ')}\n` +
  'Commands: /total — this month so far';

async function handleText(chatId: number, text: string): Promise<void> {
  if (text === '/start' || text === '/help') {
    await send(chatId, HELP, true);
    return;
  }

  if (text === '/total') {
    const { month } = istParts();
    const t = await monthTotals(month);
    if (!t || t.total === 0) {
      await send(chatId, `No entries yet for ${month}.`);
      return;
    }
    const lines = Object.entries(t.byCat)
      .sort((a, b) => b[1] - a[1])
      .map(([c, v]) => `• ${c}: ₹${v.toFixed(2)}`);
    await send(chatId, `<b>${month} total: ₹${t.total.toFixed(2)}</b>\n${lines.join('\n')}`, true);
    return;
  }

  const r = parseExpense(text);
  if (!r.ok) {
    if (r.error === 'category') {
      await send(chatId, `🤔 "${r.rawCategory}" isn't a category.\nUse one of: ${CATEGORIES.join(', ')}`);
    } else if (r.error === 'amount') {
      await send(chatId, "🤔 Couldn't read the amount.\nFormat: 200 - coffee - wants");
    } else {
      await send(chatId, 'Format: amount - description - category [- notes]\ne.g. 200 - coffee - wants');
    }
    return;
  }

  const { date, month } = istParts();
  await ensureMonthSheet(month);
  await appendExpense(month, {
    date,
    description: r.value.description,
    category: r.value.category,
    amount: r.value.amount,
    notes: r.value.notes,
  });

  const tail = r.value.notes ? ` · ${r.value.notes}` : '';
  await send(
    chatId,
    `✅ ₹${r.value.amount.toFixed(2)} · ${r.value.description} · ${r.value.category}${tail}  (${date})`,
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  // Reject anything not coming from Telegram with our secret.
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (process.env.TELEGRAM_SECRET_TOKEN && secret !== process.env.TELEGRAM_SECRET_TOKEN) {
    res.status(401).send('unauthorized');
    return;
  }

  const msg = req.body?.message;
  const text: string | undefined = msg?.text;
  const chatId: number | undefined = msg?.chat?.id;

  // Non-text updates (edits, photos, joins, etc.) are ignored.
  if (!msg || typeof text !== 'string' || chatId === undefined) {
    res.status(200).send('ok');
    return;
  }

  // Only respond to you. Strangers are silently ignored.
  const allowed = process.env.ALLOWED_CHAT_ID;
  if (allowed && String(chatId) !== String(allowed)) {
    res.status(200).send('ok');
    return;
  }

  try {
    await handleText(chatId, text.trim());
  } catch (err) {
    console.error(err);
    await send(chatId, '⚠️ Something went wrong logging that. Please try again.');
  }

  res.status(200).send('ok');
}
