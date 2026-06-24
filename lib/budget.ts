import { CATEGORIES, normalizeCategory, type Category } from './parse';


export interface Profile {
  salary: number;
  budgetPct: Partial<Record<Category, number>>;
}

export interface Investment {
  name: string;
  amount: number;
}


function num(s: string): number | null {
  const n = parseFloat(s.replace(/[₹,%\s]/g, ''));
  return isFinite(n) ? n : null;
}

function splitKV(line: string): { key: string; value: number } | null {
  const m = line.match(/^(.+?)[\s:=]+([₹\d.,%\s]+)$/);
  if (!m) return null;
  const value = num(m[2]);
  if (value === null) return null;
  return { key: m[1].trim(), value };
}

export interface BudgetForm {
  salary: number | null;
  budgetPct: Partial<Record<Category, number>>;
  unknown: string[];
}

export function parseBudgetForm(body: string): BudgetForm {
  const out: BudgetForm = { salary: null, budgetPct: {}, unknown: [] };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const kv = splitKV(line);
    if (!kv) {
      out.unknown.push(line);
      continue;
    }
    const key = kv.key.toLowerCase();
    if (key === 'salary' || key === 'income' || key === 'pay') {
      out.salary = kv.value;
      continue;
    }
    const cat = normalizeCategory(key);
    if (cat) out.budgetPct[cat] = kv.value;
    else out.unknown.push(line);
  }
  return out;
}



export function parseInvestmentForm(body: string): { items: Investment[]; unknown: string[] } {
  const items: Investment[] = [];
  const unknown: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const kv = splitKV(line);
    if (!kv) {
      unknown.push(line);
      continue;
    }
    items.push({ name: kv.key, amount: kv.value });
  }
  return { items, unknown };
}


export interface CatAnalysis {
  category: string;
  spent: number;
  budget: number | null; // null when no budget is configured for the category
  usePct: number | null; // spent / budget * 100
  overspend: number; // max(spent - budget, 0), 0 when within / no budget
}

export interface Analysis {
  month: string;
  salary: number | null;
  totalSpent: number;
  totalBudget: number; // sum of configured category budgets
  saved: number | null; // salary - totalSpent
  cats: CatAnalysis[];
  overspent: CatAnalysis[]; // sorted, largest overspend first
  totalOverspend: number;
  hasBudget: boolean;
}

export function analyzeSpending(
  month: string,
  byCat: Record<string, number>,
  profile: Profile | null,
): Analysis {
  const salary = profile?.salary ?? null;

  // Standard categories first, then any stray categories found in the sheet.
  const extra = Object.keys(byCat).filter(
    (k) => !(CATEGORIES as readonly string[]).includes(k),
  );
  const allCats = [...CATEGORIES, ...extra];

  const cats: CatAnalysis[] = allCats.map((category) => {
    const spent = byCat[category] || 0;
    const pct = profile?.budgetPct?.[category as Category];
    const budget = salary != null && pct != null ? (salary * pct) / 100 : null;
    const usePct = budget && budget > 0 ? (spent / budget) * 100 : null;
    const overspend = budget != null && spent > budget ? spent - budget : 0;
    return { category, spent, budget, usePct, overspend };
  });

  const totalSpent = Object.values(byCat).reduce((a, b) => a + b, 0);
  const totalBudget = cats.reduce((a, c) => a + (c.budget || 0), 0);
  const saved = salary != null ? salary - totalSpent : null;
  const overspent = cats
    .filter((c) => c.overspend > 0)
    .sort((a, b) => b.overspend - a.overspend);
  const totalOverspend = overspent.reduce((a, c) => a + c.overspend, 0);
  const hasBudget = cats.some((c) => c.budget != null);

  return {
    month,
    salary,
    totalSpent,
    totalBudget,
    saved,
    cats,
    overspent,
    totalOverspend,
    hasBudget,
  };
}
