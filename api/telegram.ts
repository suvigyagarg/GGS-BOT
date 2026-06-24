import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseExpense, CATEGORIES } from '../lib/parse';
import {
  ensureMonthSheet,
  appendExpense,
  monthTotals,
  getProfile,
  setProfile,
  getInvestments,
  setInvestments,
} from '../lib/sheets';
import {
  parseBudgetForm,
  parseInvestmentForm,
  analyzeSpending,
  type Profile,
} from '../lib/budget';
import {
  formatTotal,
  formatBudget,
  formatInvestments,
  formatAnalysis,
  formatSpendConfirmation,
  budgetHelp,
  investHelp,
} from '../lib/render';
import { istParts } from '../lib/util';

async function send(chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
}

const HELP =
  '<b>💸 Expense bot</b>\n\n' +
  'Log a spend:\n' +
  '<code>amount - description - category [- notes]</code>\n' +
  'e.g. <code>200 - coffee - wants</code>\n\n' +
  `Categories: ${CATEGORIES.join(', ')}\n\n` +
  '<b>Commands</b>\n' +
  '/total — this month, by category\n' +
  '/analyze — budget vs actual + overspends\n' +
  '/budget — set salary &amp; category split\n' +
  '/invest — your outstanding investments\n' +
  '/help — show this';

// Splits "/cmd rest..." into the (lowercased, @bot-stripped) command and its body.
function splitCommand(text: string): { cmd: string; body: string } {
  const i = text.search(/[\s\n]/);
  const head = i === -1 ? text : text.slice(0, i);
  const body = i === -1 ? '' : text.slice(i).trim();
  const cmd = head.toLowerCase().replace(/@.*$/, '');
  return { cmd, body };
}

async function handleBudget(chatId: number, body: string): Promise<void> {
  if (!body) {
    const p = await getProfile();
    if (!p) {
      await send(
        chatId,
        '<b>💼 Budget</b>\n\nNo budget set yet. Fill this form:\n' + budgetHelp(),
      );
    } else {
      await send(chatId, formatBudget(p));
    }
    return;
  }

  const form = parseBudgetForm(body);
  const existing = await getProfile();
  const salary = form.salary ?? existing?.salary ?? 0;
  if (!salary) {
    await send(chatId, '🤔 I need a salary. Add a line like <code>salary 50000</code>.');
    return;
  }
  const merged: Profile = {
    salary,
    budgetPct: { ...(existing?.budgetPct || {}), ...form.budgetPct },
  };
  await setProfile(merged);

  let msg = '✅ Budget saved.\n' + formatBudget(merged);
  if (form.unknown.length) {
    msg += `\n\n⚠️ Skipped: ${form.unknown.map((u) => `<code>${u}</code>`).join(', ')}`;
  }
  await send(chatId, msg);
}

async function handleInvest(chatId: number, body: string): Promise<void> {
  if (!body) {
    const items = await getInvestments();
    await send(chatId, formatInvestments(items));
    return;
  }

  const { items, unknown } = parseInvestmentForm(body);
  if (items.length === 0) {
    await send(chatId, "🤔 Couldn't read any investments. Format:\n" + investHelp());
    return;
  }
  await setInvestments(items);

  let msg = `✅ Saved ${items.length} investment${items.length > 1 ? 's' : ''} (replaced previous list).\n` +
    formatInvestments(items);
  if (unknown.length) {
    msg += `\n\n⚠️ Skipped: ${unknown.map((u) => `<code>${u}</code>`).join(', ')}`;
  }
  await send(chatId, msg);
}

async function handleAnalyze(chatId: number): Promise<void> {
  const { month } = istParts();
  const [t, profile, investments] = await Promise.all([
    monthTotals(month),
    getProfile(),
    getInvestments(),
  ]);
  if (!t || t.total === 0) {
    await send(chatId, `No entries yet for ${month} to analyse.`);
    return;
  }
  const analysis = analyzeSpending(month, t.byCat, profile);
  await send(chatId, formatAnalysis(analysis, investments));
}

async function handleText(chatId: number, text: string): Promise<void> {
  const { cmd, body } = splitCommand(text);

  switch (cmd) {
    case '/start':
    case '/help':
      await send(chatId, HELP);
      return;
    case '/total': {
      const { month } = istParts();
      const t = await monthTotals(month);
      await send(chatId, formatTotal(month, t?.byCat || {}, t?.total || 0));
      return;
    }
    case '/budget':
      await handleBudget(chatId, body);
      return;
    case '/invest':
    case '/investments':
      await handleInvest(chatId, body);
      return;
    case '/analyze':
    case '/analyse':
      await handleAnalyze(chatId);
      return;
  }

  // Not a command -> log it as an expense.
  const r = parseExpense(text);
  if (!r.ok) {
    if (r.error === 'category') {
      await send(chatId, `🤔 "${r.rawCategory}" isn't a category.\nUse one of: ${CATEGORIES.join(', ')}`);
    } else if (r.error === 'amount') {
      await send(chatId, "🤔 Couldn't read the amount.\nFormat: <code>200 - coffee - wants</code>");
    } else {
      await send(chatId, 'Format: <code>amount - description - category [- notes]</code>\ne.g. <code>200 - coffee - wants</code>');
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

  // Show how this category is tracking against budget, if one is set.
  let catSpent: number | null = null;
  let catBudget: number | null = null;
  const [t, profile] = await Promise.all([monthTotals(month), getProfile()]);
  if (t) catSpent = t.byCat[r.value.category] ?? r.value.amount;
  const pct = profile?.budgetPct?.[r.value.category];
  if (profile && pct != null) catBudget = (profile.salary * pct) / 100;

  await send(
    chatId,
    formatSpendConfirmation(
      r.value.amount,
      r.value.description,
      r.value.category,
      r.value.notes,
      date,
      catBudget != null ? catSpent : null,
      catBudget,
    ),
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
    await send(chatId, '⚠️ Something went wrong. Please try again.');
  }

  res.status(200).send('ok');
}
