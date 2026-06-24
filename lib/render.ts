import type { Analysis, Investment, Profile } from './budget';


const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹ amount, Indian grouping (lakh/crore), whole rupees. */
export function inr(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}₹${inrFmt.format(Math.round(Math.abs(n)))}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function padEnd(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padStart(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Render aligned rows. `aligns`: 'l' left-pads-right (text), 'r' right-aligns (numbers). */
function table(rows: string[][], aligns: ('l' | 'r')[], gap = '  '): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((c, i) => {
      widths[i] = Math.max(widths[i] || 0, c.length);
    });
  }
  return rows
    .map((row) =>
      row
        .map((c, i) => (aligns[i] === 'r' ? padStart(c, widths[i]) : padEnd(c, widths[i])))
        .join(gap),
    )
    .join('\n');
}

function tableWithRule(rows: string[][], aligns: ('l' | 'r')[], footerRows = 1): string {
  const rendered = table(rows, aligns).split('\n');
  const line = '─'.repeat(Math.max(...rendered.map((l) => l.length)));
  const cut = rendered.length - footerRows;
  return [...rendered.slice(0, cut), line, ...rendered.slice(cut)].join('\n');
}

function progress(pct: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

function wrapPre(block: string): string {
  return `<pre>${esc(block)}</pre>`;
}

export function formatTotal(
  month: string,
  byCat: Record<string, number>,
  total: number,
): string {
  if (total === 0) return `No entries yet for <b>${month}</b>.`;

  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const rows = entries.map(([c, v]) => [
    cap(c),
    inr(v),
    `${Math.round((v / total) * 100)}%`,
  ]);
  rows.push(['Total', inr(total), '']);

  return (
    `<b>📊 ${month} · Spending</b>\n` +
    wrapPre(tableWithRule(rows, ['l', 'r', 'r']))
  );
}

// ── /budget ───────────────────────────────────────────────────────────────────

export function formatBudget(p: Profile): string {
  const cats = Object.entries(p.budgetPct);
  if (cats.length === 0) {
    return (
      `<b>💼 Budget</b>\nSalary: ${inr(p.salary)}\n\n` +
      `No category split set yet. Send:\n${budgetHelp()}`
    );
  }

  const rows = cats
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .map(([c, pct]) => [cap(c), `${pct}%`, inr((p.salary * (pct || 0)) / 100)]);

  const allocPct = cats.reduce((a, [, v]) => a + (v || 0), 0);
  const allocAmt = (p.salary * allocPct) / 100;
  rows.push(['Allocated', `${Math.round(allocPct)}%`, inr(allocAmt)]);
  rows.push(['Left/Save', `${Math.round(100 - allocPct)}%`, inr(p.salary - allocAmt)]);

  return (
    `<b>💼 Budget</b>\nSalary: <b>${inr(p.salary)}</b> / month\n` +
    wrapPre(tableWithRule(rows, ['l', 'r', 'r'], 2))
  );
}

export function budgetHelp(): string {
  return (
    '<pre>/budget\n' +
    'salary 50000\n' +
    'needs 40\n' +
    'wants 20\n' +
    'family 15\n' +
    'investment 20\n' +
    'suspense 5</pre>\n' +
    '(numbers are % of salary)'
  );
}

// ── /invest ───────────────────────────────────────────────────────────────────

export function formatInvestments(items: Investment[]): string {
  if (items.length === 0) {
    return (
      '<b>💰 Outstanding investments</b>\n\nNothing saved yet. Send:\n' +
      investHelp()
    );
  }

  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  const total = sorted.reduce((a, x) => a + x.amount, 0);
  const rows = sorted.map((x) => [x.name, inr(x.amount), `${Math.round((x.amount / total) * 100)}%`]);
  rows.push(['Total', inr(total), '']);

  return (
    `<b>💰 Outstanding investments</b>\n` +
    wrapPre(tableWithRule(rows, ['l', 'r', 'r']))
  );
}

export function investHelp(): string {
  return (
    '<pre>/invest\n' +
    'LIC = 50000\n' +
    'Mutual Funds = 120000\n' +
    'Stocks = 75000</pre>\n' +
    '(re-send the full list to update it)'
  );
}

// ── /analyze ──────────────────────────────────────────────────────────────────

export function formatAnalysis(a: Analysis, investments: Investment[]): string {
  if (a.totalSpent === 0) return `No entries yet for <b>${a.month}</b> to analyse.`;

  let out = `<b>🔍 Analysis · ${a.month}</b>\n`;

  // Headline figures
  const head: string[][] = [];
  if (a.salary != null) head.push(['Salary', inr(a.salary)]);
  if (a.hasBudget) head.push(['Budgeted', inr(a.totalBudget)]);
  head.push(['Spent', inr(a.totalSpent)]);
  if (a.saved != null) {
    const pct = a.salary ? Math.round((a.saved / a.salary) * 100) : 0;
    head.push(['Saved', `${inr(a.saved)} (${pct}%)`]);
  }
  out += wrapPre(table(head, ['l', 'r']));

  // Per-category: Spent vs Budget vs Use%
  const rows = a.cats
    .filter((c) => c.spent > 0 || c.budget)
    .map((c) => [
      cap(c.category),
      inr(c.spent),
      c.budget != null ? inr(c.budget) : '—',
      c.usePct != null ? `${Math.round(c.usePct)}%` : '—',
    ]);
  if (rows.length) {
    const header = ['Category', 'Spent', 'Budget', 'Use'];
    const body = table([header, ...rows], ['l', 'r', 'r', 'r']);
    out += '\n' + wrapPre(body);
  }

  // Overspend verdict
  if (!a.hasBudget) {
    out += `\n\nℹ️ Set a budget with /budget to flag overspends.`;
  } else if (a.overspent.length === 0) {
    out += `\n\n✅ Within budget across every category. Nicely done.`;
  } else {
    out += `\n\n🔴 <b>Overspent ${inr(a.totalOverspend)}</b>`;
    for (const c of a.overspent) {
      const sev = c.usePct != null && c.usePct > 110 ? '🔴' : '⚠️';
      out += `\n${sev} ${cap(c.category)} · +${inr(c.overspend)} (${Math.round(c.usePct || 0)}% of budget)`;
    }
  }

  // Portfolio footer
  if (investments.length) {
    const total = investments.reduce((s, x) => s + x.amount, 0);
    out += `\n\n💰 Investments held: <b>${inr(total)}</b> across ${investments.length} — see /invest`;
  }

  return out;
}

// ── Single-expense confirmation ───────────────────────────────────────────────

export function formatSpendConfirmation(
  amount: number,
  description: string,
  category: string,
  notes: string,
  date: string,
  catSpent: number | null,
  catBudget: number | null,
): string {
  const tail = notes ? ` · ${esc(notes)}` : '';
  let out = `✅ <b>${inr(amount)}</b> · ${esc(description)} · ${esc(category)}${tail}  <i>(${date})</i>`;

  if (catSpent != null && catBudget != null && catBudget > 0) {
    const pct = Math.round((catSpent / catBudget) * 100);
    out += `\n<pre>${cap(category)}  ${progress(pct)} ${pct}%\n${inr(catSpent)} of ${inr(catBudget)}</pre>`;
    if (catSpent > catBudget) {
      out += `\n⚠️ Over budget by <b>${inr(catSpent - catBudget)}</b>`;
    }
  }
  return out;
}
