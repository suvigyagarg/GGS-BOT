import { google, sheets_v4 } from 'googleapis';
import { CATEGORIES, type Category } from './parse';
import type { Investment, Profile } from './budget';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const HEADERS = ['Date', 'Description', 'Type', 'Amount', 'Notes'];
const SETTINGS_TAB = '_Settings';
const INVEST_TAB = '_Investments';

let _sheets: sheets_v4.Sheets | null = null;

function client(): sheets_v4.Sheets {
  if (_sheets) return _sheets;
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: SCOPES,
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

function spreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('SPREADSHEET_ID is not set');
  return id;
}

async function findSheetId(title: string): Promise<number | null> {
  const meta = await client().spreadsheets.get({ spreadsheetId: spreadsheetId() });
  const sheet = meta.data.sheets?.find((sh) => sh.properties?.title === title);
  return sheet?.properties?.sheetId ?? null;
}

// Create this month's tab (header + bold header + ₹ currency on Amount +
// category dropdown on Type) the first time it's needed.
export async function ensureMonthSheet(title: string): Promise<void> {
  const s = client();
  if ((await findSheetId(title)) !== null) return;

  const add = await s.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title,
              gridProperties: { rowCount: 1000, columnCount: 5, frozenRowCount: 1 },
            },
          },
        },
      ],
    },
  });

  const sheetId = add.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId == null) throw new Error('Failed to create month sheet');

  await s.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${title}!A1:E1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  });

  await s.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        {
          // Amount column (D, index 3) -> ₹ currency
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 },
            cell: {
              userEnteredFormat: {
                numberFormat: { type: 'CURRENCY', pattern: '₹#,##0.00' },
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        },
        {
          // Type column (C, index 2) -> dropdown
          setDataValidation: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: CATEGORIES.map((c) => ({ userEnteredValue: c })),
              },
              showCustomUi: true,
              strict: false,
            },
          },
        },
      ],
    },
  });
}

export interface ExpenseRow {
  date: string;
  description: string;
  category: string;
  amount: number;
  notes: string;
}

export async function appendExpense(title: string, row: ExpenseRow): Promise<void> {
  await client().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${title}!A:E`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[row.date, row.description, row.category, row.amount, row.notes]],
    },
  });
}

export async function monthTotals(
  title: string,
): Promise<{ total: number; byCat: Record<string, number> } | null> {
  if ((await findSheetId(title)) === null) return null;
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${title}!A2:E`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values || [];
  let total = 0;
  const byCat: Record<string, number> = {};
  for (const r of rows) {
    const amt = parseFloat(String(r[3] ?? '').replace(/[₹,\s]/g, ''));
    if (!isFinite(amt)) continue;
    total += amt;
    const cat = String(r[2] ?? 'uncategorized');
    byCat[cat] = (byCat[cat] || 0) + amt;
  }
  return { total, byCat };
}
export async function categoryEntries(
  month: string,
  category: string,
): Promise<ExpenseRow[] | null> {
  if ((await findSheetId(month)) === null) return null;
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${month}!A2:E`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const out: ExpenseRow[] = [];
  for (const r of res.data.values || []) {
    if (String(r[2] ?? '').trim().toLowerCase() !== category.toLowerCase()) continue;
    const amount = parseFloat(String(r[3] ?? '').replace(/[₹,\s]/g, ''));
    if (!isFinite(amount)) continue;
    out.push({
      date: String(r[0] ?? ''),
      description: String(r[1] ?? ''),
      category: String(r[2] ?? ''),
      amount,
      notes: String(r[4] ?? ''),
    });
  }
  return out;
}

async function ensureSimpleSheet(title: string, headers: string[]): Promise<void> {
  const s = client();
  if ((await findSheetId(title)) !== null) return;

  const add = await s.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title,
              gridProperties: {
                rowCount: 100,
                columnCount: headers.length,
                frozenRowCount: 1,
              },
            },
          },
        },
      ],
    },
  });

  const sheetId = add.data.replies?.[0]?.addSheet?.properties?.sheetId;
  await s.spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });

  if (sheetId != null) {
    await s.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId(),
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          },
        ],
      },
    });
  }
}

export async function getProfile(): Promise<Profile | null> {
  if ((await findSheetId(SETTINGS_TAB)) === null) return null;
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${SETTINGS_TAB}!A2:B`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values || [];
  let salary = 0;
  const budgetPct: Partial<Record<Category, number>> = {};
  for (const r of rows) {
    const key = String(r[0] ?? '').trim().toLowerCase();
    const val = parseFloat(String(r[1] ?? '').replace(/[₹,%\s]/g, ''));
    if (!isFinite(val)) continue;
    if (key === 'salary') salary = val;
    else if ((CATEGORIES as readonly string[]).includes(key)) budgetPct[key as Category] = val;
  }
  if (!salary && Object.keys(budgetPct).length === 0) return null;
  return { salary, budgetPct };
}

export async function setProfile(p: Profile): Promise<void> {
  await ensureSimpleSheet(SETTINGS_TAB, ['Key', 'Value']);
  const rows: (string | number)[][] = [['salary', p.salary]];
  for (const c of CATEGORIES) {
    const pct = p.budgetPct[c];
    if (pct != null) rows.push([c, pct]);
  }
  await client().spreadsheets.values.clear({
    spreadsheetId: spreadsheetId(),
    range: `${SETTINGS_TAB}!A2:B`,
  });
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${SETTINGS_TAB}!A2`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

export async function getInvestments(): Promise<Investment[]> {
  if ((await findSheetId(INVEST_TAB)) === null) return [];
  const res = await client().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${INVEST_TAB}!A2:B`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const out: Investment[] = [];
  for (const r of res.data.values || []) {
    const name = String(r[0] ?? '').trim();
    const amount = parseFloat(String(r[1] ?? '').replace(/[₹,\s]/g, ''));
    if (name && isFinite(amount)) out.push({ name, amount });
  }
  return out;
}

// Replaces the whole list (the user re-sends the full "form" to update it).
export async function setInvestments(items: Investment[]): Promise<void> {
  await ensureSimpleSheet(INVEST_TAB, ['Name', 'Amount']);
  await client().spreadsheets.values.clear({
    spreadsheetId: spreadsheetId(),
    range: `${INVEST_TAB}!A2:B`,
  });
  if (items.length === 0) return;
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${INVEST_TAB}!A2`,
    valueInputOption: 'RAW',
    requestBody: { values: items.map((x) => [x.name, x.amount]) },
  });
}
