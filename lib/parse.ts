
export const CATEGORIES = [
  'needs',
  'wants',
  'family',
  'investment',
  'suspense',
] as const;

export type Category = (typeof CATEGORIES)[number];


const SYNONYMS: Record<string, Category> = {
  need: 'needs',
  needs: 'needs',
  want: 'wants',
  wants: 'wants',
  fam: 'family',
  family: 'family',
  invest: 'investment',
  investments: 'investment',
  investment: 'investment',
  susp: 'suspense',
  suspence: 'suspense', 
  suspense: 'suspense',
};

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1, 
        dp[j - 1] + 1, 
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[n];
}

export function normalizeCategory(raw: string): Category | null {
  const k = raw.trim().toLowerCase();
  if (!k) return null;
  if (SYNONYMS[k]) return SYNONYMS[k];

  const prefix = CATEGORIES.find((c) => c.startsWith(k) || k.startsWith(c));
  if (prefix) return prefix;

 
  let best: Category | null = null;
  let bestDist = Infinity;
  for (const c of CATEGORIES) {
    const d = levenshtein(k, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return bestDist <= 2 ? best : null;
}

export interface ParsedExpense {
  amount: number;
  description: string;
  category: Category;
  notes: string;
}

export type ParseResult =
  | { ok: true; value: ParsedExpense }
  | { ok: false; error: 'format' | 'amount' | 'category'; rawCategory?: string };


export function parseExpense(text: string): ParseResult {
  const parts = text
    .split('-')
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length < 3) return { ok: false, error: 'format' };

  const amount = parseFloat(parts[0].replace(/[₹,\s]/g, ''));
  if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'amount' };

  const description = parts[1];
  const category = normalizeCategory(parts[2]);
  if (!category) return { ok: false, error: 'category', rawCategory: parts[2] };

  const notes = parts.slice(3).join(' - '); // notes may itself contain hyphens
  return { ok: true, value: { amount, description, category, notes } };
}
