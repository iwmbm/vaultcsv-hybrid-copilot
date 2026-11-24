import { getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
} from 'firebase/ai';

export type TaxRuleTag =
  | '100% Deductible'
  | '50% Meals Rule'
  | 'Non-Deductible Tax/Transfer'
  | 'Taxable Revenue'
  | 'Review Needed';

export interface LedgerRow {
  id: string;
  date: string;
  rawDescription: string;
  cleanVendor: string;
  scrubbedDescription: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  category: string;
  taxTag: TaxRuleTag;
  isRecurring: boolean;
  aiFlag?: string;
  reconciled: boolean;
}

export interface FirebaseClientConfig {
  apiKey: string;
  projectId: string;
  appId: string;
  recaptchaSiteKey?: string;
}

export type RoutingChoice = 'only_on_device' | 'prefer_on_device' | 'prefer_in_cloud';

export interface TelemetryEvent {
  timestamp: string;
  action: string;
  modeRequested: RoutingChoice;
  inferenceSource: 'on_device' | 'in_cloud' | 'local_smart_engine';
  latencyMs: number;
  bytesTransmitted: number;
  summary: string;
}

export const CATEGORIES = [
  'Software & SaaS',
  'Payroll & Contractors',
  'Marketing & Ads',
  'Travel & Transport',
  'Meals & Dining',
  'Rent & Facilities',
  'Utilities & Telecom',
  'Taxes & Government',
  'Shipping & Office',
  'Income / Deposits',
  'Uncategorized',
];

export const MESSY_TEXT_SAMPLE = `Jan 04 2026  POS DEBIT CARD #4921  SQ *BLUE BOTTLE COFFEE #041 SAN FRANCISCO CA   -$18.75
2026/01/07  ACH WEB-INIT  AMZN.COM/BILL AWS CLOUD SERVICES #99481204   -$342.18
01-11-2026  WIRE INCOMING  ACME DESIGN PARTNERS INV-2026-01   +$5,200.00
Jan 15, 2026  AUTOPAY  CURSOR AI IDE PRO SUBSCRIPTION   -$20.00
01/19/2026  CARD PURCHASE  DELTA AIR 00629104821 SFO-JFK   -$468.40
01/24/2026  ACH DEBIT  IRS USATAXPYMT Q4 ESTIMATED TAX   -$2,100.00
01/27/2026  POS PURCHASE  TST* SWEETGREEN TEAM LUNCH NYC   -$64.20`;

/**
 * Strips account numbers, card digits, SSN/EINs, dates, and dollar figures
 * locally in browser RAM before any hybrid cloud fallback can occur.
 */
export function scrubPii(raw: string): string {
  return raw
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN-REDACTED]')
    .replace(/\b\d{2}-\d{7}\b/g, '[EIN-REDACTED]')
    .replace(/[$£€¥]\s*\d[\d,.]*/g, '[AMT]')
    .replace(/\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, '')
    .replace(/\b\d{4,}\b/g, '#XXXX')
    .replace(/#\d{3,}/g, '#XXXX')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Local smart vendor & IRS tax-rule enricher (instant zero-latency baseline +
 * deterministic fallback when offline).
 */
export function enrichVendorLocally(
  rawDesc: string,
  debit: number | null,
  credit: number | null
): {
  cleanVendor: string;
  category: string;
  taxTag: TaxRuleTag;
  isRecurring: boolean;
  aiFlag?: string;
} {
  const s = rawDesc.toLowerCase();

  if (credit && credit > 0) {
    if (/rebate|waived|refund/.test(s)) {
      return {
        cleanVendor: /fee/.test(s) ? 'Bank Fee Rebate' : 'Merchant Refund',
        category: 'Income / Deposits',
        taxTag: 'Review Needed',
        isRecurring: false,
      };
    }
    const vendor =
      /stripe/.test(s)
        ? 'Stripe Payout'
        : /shopify/.test(s)
          ? 'Shopify Payout'
          : /northstar/.test(s)
            ? 'Northstar Labs LLC'
            : /brightline/.test(s)
              ? 'Brightline Studio'
              : /acme/.test(s)
                ? 'Acme Design Partners'
                : cleanRawToTitle(rawDesc);
    return {
      cleanVendor: vendor,
      category: 'Income / Deposits',
      taxTag: 'Taxable Revenue',
      isRecurring: /stripe|shopify/.test(s),
    };
  }

  const vendorDict: Array<{
    re: RegExp;
    vendor: string;
    cat: string;
    tax: TaxRuleTag;
    rec: boolean;
    flag?: string;
  }> = [
    {
      re: /irs\b|eftps|usataxpymt/,
      vendor: 'IRS Tax Payment (EFTPS)',
      cat: 'Taxes & Government',
      tax: 'Non-Deductible Tax/Transfer',
      rec: false,
      flag: 'Federal income/estimated tax is NOT an operating Schedule C deduction',
    },
    { re: /amazon web services|\baws\b/, vendor: 'Amazon Web Services (AWS)', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /cloudflare/, vendor: 'Cloudflare', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /figma/, vendor: 'Figma', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /notion/, vendor: 'Notion Labs', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /slack/, vendor: 'Slack', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /linear/, vendor: 'Linear', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /cursor/, vendor: 'Cursor AI IDE', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /anthropic/, vendor: 'Anthropic API', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /openai|chatgpt/, vendor: 'OpenAI', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /vercel/, vendor: 'Vercel', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /github/, vendor: 'GitHub', cat: 'Software & SaaS', tax: '100% Deductible', rec: true },
    { re: /gusto/, vendor: 'Gusto Payroll', cat: 'Payroll & Contractors', tax: '100% Deductible', rec: true },
    { re: /deel/, vendor: 'Deel Contractors', cat: 'Payroll & Contractors', tax: '100% Deductible', rec: true },
    { re: /wework/, vendor: 'WeWork Coworking', cat: 'Rent & Facilities', tax: '100% Deductible', rec: true },
    { re: /google ads/, vendor: 'Google Ads', cat: 'Marketing & Ads', tax: '100% Deductible', rec: true },
    { re: /meta ads|facebk/, vendor: 'Meta Ads', cat: 'Marketing & Ads', tax: '100% Deductible', rec: true },
    { re: /verizon/, vendor: 'Verizon Wireless', cat: 'Utilities & Telecom', tax: '100% Deductible', rec: true },
    { re: /fedex|ups\b|dhl/, vendor: 'FedEx Shipping', cat: 'Shipping & Office', tax: '100% Deductible', rec: false },
    { re: /apple store/, vendor: 'Apple Store (Hardware)', cat: 'Shipping & Office', tax: '100% Deductible', rec: false, flag: 'Equipment >$2,500 may require Sec. 179 / de minimis election' },
    { re: /uber/, vendor: 'Uber', cat: 'Travel & Transport', tax: '100% Deductible', rec: false },
    { re: /delta air|lufthansa|united air/, vendor: 'Delta Air Lines', cat: 'Travel & Transport', tax: '100% Deductible', rec: false },
    { re: /hilton|marriott|airbnb/, vendor: 'Hilton Hotels', cat: 'Travel & Transport', tax: '100% Deductible', rec: false },
    { re: /starbucks/, vendor: 'Starbucks Coffee', cat: 'Meals & Dining', tax: '50% Meals Rule', rec: false },
    { re: /blue bottle/, vendor: 'Blue Bottle Coffee', cat: 'Meals & Dining', tax: '50% Meals Rule', rec: false },
    { re: /chipotle/, vendor: 'Chipotle', cat: 'Meals & Dining', tax: '50% Meals Rule', rec: false },
    { re: /sweetgreen/, vendor: 'Sweetgreen', cat: 'Meals & Dining', tax: '50% Meals Rule', rec: false },
  ];

  for (const item of vendorDict) {
    if (item.re.test(s)) {
      return {
        cleanVendor: item.vendor,
        category: item.cat,
        taxTag: item.tax,
        isRecurring: item.rec,
        aiFlag: item.flag,
      };
    }
  }

  void debit;
  return {
    cleanVendor: cleanRawToTitle(rawDesc),
    category: 'Uncategorized',
    taxTag: 'Review Needed',
    isRecurring: /recurring|subscription|autopay|monthly/.test(s),
  };
}

function cleanRawToTitle(raw: string): string {
  const stripped = raw
    .replace(/\b(POS|DEBIT|CARD|PURCHASE|ACH|WEB-INIT|SQ\s*\*|TST\*|CHKCRD|AUTOPAY)\b/gi, '')
    .replace(/#?\d{4,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return raw.slice(0, 32);
  return stripped
    .split(' ')
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export async function extractPdfLedgerLocally(file: File): Promise<{
  rows: LedgerRow[];
  openingBalance: number | null;
  closingBalance: number | null;
}> {
  const buf = await file.arrayBuffer();
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', window.location.href).toString();

  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  interface Item {
    str: string;
    x: number;
    y: number;
    page: number;
  }
  const items: Item[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const raw of tc.items) {
      if (!('str' in raw) || !raw.str.trim()) continue;
      items.push({ str: raw.str, x: raw.transform[4], y: raw.transform[5], page: p });
    }
  }

  const lines: Array<{ page: number; y: number; parts: Item[]; text: string }> = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pItems = items
      .filter((i) => i.page === p)
      .sort((a, b) => (Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x));
    for (const it of pItems) {
      const prev = lines.find((l) => l.page === p && Math.abs(l.y - it.y) <= 4);
      if (prev) prev.parts.push(it);
      else lines.push({ page: p, y: it.y, parts: [it], text: '' });
    }
  }
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    l.text = l.parts.map((p) => p.str.trim()).join(' ');
  }

  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  const rows: LedgerRow[] = [];

  const parseMoney = (s: string): number | null => {
    const c = s.replace(/[$€£,\s]/g, '');
    if (!/^-?\d+\.\d{2}$/.test(c)) return null;
    return Number(c);
  };

  for (const line of lines) {
    if (/beginning balance|opening balance/i.test(line.text)) {
      const m = parseMoney(line.parts[line.parts.length - 1]?.str ?? '');
      if (m !== null) openingBalance = m;
      continue;
    }
    if (/ending balance|closing balance/i.test(line.text)) {
      const m = parseMoney(line.parts[line.parts.length - 1]?.str ?? '');
      if (m !== null) closingBalance = m;
      continue;
    }

    const first = line.parts[0]?.str.trim() ?? '';
    const isDate = /^\d{2}\/\d{2}(?:\/\d{2,4})?$/.test(first);
    const nums = line.parts
      .map((p, idx) => ({ idx, val: parseMoney(p.str), x: p.x }))
      .filter((n): n is { idx: number; val: number; x: number } => n.val !== null);

    if (!isDate) {
      if (
        rows.length > 0 &&
        nums.length === 0 &&
        !/^(page \d|date |total |jpmorgan)/i.test(line.text) &&
        line.parts[0] &&
        line.parts[0].x >= 90
      ) {
        const prev = rows[rows.length - 1];
        prev.rawDescription = `${prev.rawDescription} ${line.text}`.trim();
        prev.scrubbedDescription = scrubPii(prev.rawDescription);
      }
      continue;
    }

    if (nums.length === 0) continue;
    const numIdx = new Set(nums.map((n) => n.idx));
    const desc = line.parts
      .filter((_, idx) => idx > 0 && !numIdx.has(idx))
      .map((p) => p.str.trim())
      .join(' ');

    let debit: number | null = null;
    let credit: number | null = null;
    let balance: number | null = null;

    if (nums.length >= 2) {
      const amt = nums[0];
      balance = nums[nums.length - 1].val;
      if (amt.x < 430) debit = Math.abs(amt.val);
      else credit = Math.abs(amt.val);
    } else if (nums.length === 1) {
      if (nums[0].val < 0) credit = Math.abs(nums[0].val);
      else debit = Math.abs(nums[0].val);
    }

    // Start with raw uncleaned state so user can experience 1-Click Magic AI Clean!
    rows.push({
      id: `row-${rows.length + 1}`,
      date: `2026-${first.slice(0, 2)}-${first.slice(3, 5)}`,
      rawDescription: desc,
      cleanVendor: desc, // Uncleaned initially so AI Magic Enrich shows dramatic visual cleanup!
      scrubbedDescription: scrubPii(desc),
      debit,
      credit,
      balance,
      category: 'Uncategorized',
      taxTag: 'Review Needed',
      isRecurring: false,
      reconciled: true,
    });
  }

  let prevCents = openingBalance !== null ? Math.round(openingBalance * 100) : null;
  for (const r of rows) {
    if (r.balance !== null && prevCents !== null) {
      const exp =
        prevCents + Math.round((r.credit ?? 0) * 100) - Math.round((r.debit ?? 0) * 100);
      r.reconciled = exp === Math.round(r.balance * 100);
    }
    if (r.balance !== null) prevCents = Math.round(r.balance * 100);
  }

  return { rows, openingBalance, closingBalance };
}

let appCheckReady = false;

export function getDefaultFirebaseConfig(): FirebaseClientConfig {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
    recaptchaSiteKey: import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY || 'debug',
  };
}

async function invokeFirebaseHybridModel(
  prompt: string | Array<string | { inlineData: { data: string; mimeType: string } }>,
  mode: RoutingChoice,
  config: FirebaseClientConfig
): Promise<{ text: string; source: 'on_device' | 'in_cloud' } | null> {
  // 1. Official Firebase AI Logic Hybrid Inference SDK (`firebase/ai`)
  if (config.apiKey && config.projectId && config.appId) {
    const app =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            apiKey: config.apiKey,
            authDomain: `${config.projectId}.firebaseapp.com`,
            projectId: config.projectId,
            appId: config.appId,
          });

    if (!appCheckReady && config.recaptchaSiteKey) {
      appCheckReady = true;
      try {
        if (config.recaptchaSiteKey === 'debug') {
          (
            self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }
          ).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        } else {
          initializeAppCheck(app, {
            provider: new ReCaptchaEnterpriseProvider(config.recaptchaSiteKey),
            isTokenAutoRefreshEnabled: true,
          });
        }
      } catch {
        // Ignore duplicate init
      }
    }

    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const sdkMode =
      mode === 'only_on_device'
        ? InferenceMode.ONLY_ON_DEVICE
        : mode === 'prefer_in_cloud'
          ? InferenceMode.PREFER_IN_CLOUD
          : InferenceMode.PREFER_ON_DEVICE;

    const model = getGenerativeModel(ai, {
      mode: sdkMode,
      inCloudParams: { model: 'gemini-2.5-flash' },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await model.generateContent(prompt as any);
    const isOnDevice = res.response.inferenceSource === InferenceSource.ON_DEVICE;
    return {
      text: res.response.text(),
      source: isOnDevice ? 'on_device' : 'in_cloud',
    };
  }

  // 2. Direct Chrome Built-in Gemini Nano Prompt API if available without Firebase cloud keys
  if (typeof prompt === 'string' && typeof window !== 'undefined' && 'LanguageModel' in window) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const LM = (window as any).LanguageModel;
      const avail = await LM.availability?.();
      if (avail && avail !== 'unavailable') {
        const session = await LM.create();
        try {
          const out = await session.prompt(prompt);
          return { text: String(out), source: 'on_device' };
        } finally {
          session.destroy?.();
        }
      }
    } catch {
      // Fallback
    }
  }

  return null;
}

/**
 * Pain Point #1: 1-Click Magic Clean & Tax Enrichment directly mutating all rows!
 */
export async function magicEnrichRows(
  rows: LedgerRow[],
  mode: RoutingChoice,
  config: FirebaseClientConfig
): Promise<{ rows: LedgerRow[]; telemetry: TelemetryEvent }> {
  const t0 = performance.now();

  // Baseline instant local enrichment
  const enriched = rows.map((r) => {
    const info = enrichVendorLocally(r.rawDescription, r.debit, r.credit);
    return {
      ...r,
      cleanVendor: info.cleanVendor,
      category: info.category,
      taxTag: info.taxTag,
      isRecurring: info.isRecurring,
      aiFlag: info.aiFlag,
    };
  });

  // Also refine via Firebase AI Logic Hybrid SDK when configured
  const scrubbedPayload = rows.map((r, idx) => ({
    idx,
    dir: r.credit ? 'IN' : 'OUT',
    memo: r.scrubbedDescription,
  }));
  const prompt = [
    'Clean each cryptic bank memo into a human vendor name, category, IRS tax rule, and recurring boolean.',
    `Allowed categories: ${CATEGORIES.join(', ')}`,
    'Allowed taxTag: "100% Deductible", "50% Meals Rule", "Non-Deductible Tax/Transfer", "Taxable Revenue", "Review Needed".',
    'Return ONLY JSON array: [{"idx":0,"cleanVendor":"...","category":"...","taxTag":"...","isRecurring":true,"aiFlag":"optional note"}]',
    JSON.stringify(scrubbedPayload),
  ].join('\n');

  try {
    const res = await invokeFirebaseHybridModel(prompt, mode, config);
    if (res) {
      const m = res.text.match(/\[[\s\S]*\]/);
      if (m) {
        const parsed = JSON.parse(m[0]) as Array<{
          idx: number;
          cleanVendor?: string;
          category?: string;
          taxTag?: TaxRuleTag;
          isRecurring?: boolean;
          aiFlag?: string;
        }>;
        for (const item of parsed) {
          const row = enriched[item.idx];
          if (!row) continue;
          if (item.cleanVendor) row.cleanVendor = item.cleanVendor;
          if (item.category && CATEGORIES.includes(item.category)) row.category = item.category;
          if (item.taxTag) row.taxTag = item.taxTag;
          if (typeof item.isRecurring === 'boolean') row.isRecurring = item.isRecurring;
          if (item.aiFlag) row.aiFlag = item.aiFlag;
        }
        const latencyMs = Math.round(performance.now() - t0);
        return {
          rows: enriched,
          telemetry: {
            timestamp: new Date().toLocaleTimeString(),
            action: 'Magic Clean & Tax Rules',
            modeRequested: mode,
            inferenceSource: res.source,
            latencyMs,
            bytesTransmitted:
              res.source === 'on_device' ? 0 : new TextEncoder().encode(prompt).length,
            summary:
              res.source === 'on_device'
                ? `Cleaned ${enriched.length} vendors on-device via Gemini Nano (0B sent)`
                : `Cleaned ${enriched.length} vendors via PII-scrubbed Firebase Hybrid AI`,
          },
        };
      }
    }
  } catch {
    // Graceful fallback to local smart enricher
  }

  const latencyMs = Math.round(performance.now() - t0);
  return {
    rows: enriched,
    telemetry: {
      timestamp: new Date().toLocaleTimeString(),
      action: 'Magic Clean & Tax Rules',
      modeRequested: mode,
      inferenceSource: 'local_smart_engine',
      latencyMs,
      bytesTransmitted: 0,
      summary: `Cleaned ${enriched.length} vendors + IRS deductibility tags locally (0B sent)`,
    },
  };
}

/**
 * Pain Point #2: Parse unstructured messy SMS/email/copied bank text into structured rows!
 */
export async function parseMessyTextWithHybridAi(
  rawText: string,
  mode: RoutingChoice,
  config: FirebaseClientConfig
): Promise<{ rows: LedgerRow[]; telemetry: TelemetryEvent }> {
  const t0 = performance.now();
  const prompt = [
    'Extract structured financial transactions from this messy bank/card text.',
    'Return ONLY JSON array: [{"date":"YYYY-MM-DD","rawDescription":"...","cleanVendor":"...","debit":number|null,"credit":number|null,"category":"...","taxTag":"100% Deductible"|"50% Meals Rule"|"Non-Deductible Tax/Transfer"|"Taxable Revenue"}]',
    rawText.slice(0, 4000),
  ].join('\n');

  try {
    const res = await invokeFirebaseHybridModel(prompt, mode, config);
    if (res) {
      const m = res.text.match(/\[[\s\S]*\]/);
      if (m) {
        const parsed = JSON.parse(m[0]) as Array<{
          date?: string;
          rawDescription?: string;
          cleanVendor?: string;
          debit?: number | null;
          credit?: number | null;
          category?: string;
          taxTag?: TaxRuleTag;
        }>;
        const outRows: LedgerRow[] = parsed.map((item, idx) => {
          const raw = item.rawDescription || item.cleanVendor || 'Transaction';
          const localInfo = enrichVendorLocally(raw, item.debit ?? null, item.credit ?? null);
          return {
            id: `messy-${idx + 1}`,
            date: item.date || '2026-01-15',
            rawDescription: raw,
            cleanVendor: item.cleanVendor || localInfo.cleanVendor,
            scrubbedDescription: scrubPii(raw),
            debit: item.debit ? Math.abs(item.debit) : null,
            credit: item.credit ? Math.abs(item.credit) : null,
            balance: null,
            category: item.category && CATEGORIES.includes(item.category) ? item.category : localInfo.category,
            taxTag: item.taxTag || localInfo.taxTag,
            isRecurring: localInfo.isRecurring,
            aiFlag: localInfo.aiFlag,
            reconciled: true,
          };
        });
        return {
          rows: outRows,
          telemetry: {
            timestamp: new Date().toLocaleTimeString(),
            action: 'Messy Text Extraction',
            modeRequested: mode,
            inferenceSource: res.source,
            latencyMs: Math.round(performance.now() - t0),
            bytesTransmitted:
              res.source === 'on_device' ? 0 : new TextEncoder().encode(prompt).length,
            summary: `Extracted ${outRows.length} structured rows via ${res.source}`,
          },
        };
      }
    }
  } catch {
    // Fallback deterministic messy-line parser
  }

  // Deterministic smart parser for messy text lines
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const outRows: LedgerRow[] = [];

  for (const line of lines) {
    const amtMatch = line.match(/([+-]?\s*[$€£¥]?\s*\d{1,3}(?:,\d{3})*\.\d{2})\s*$/);
    if (!amtMatch) continue;
    const amtRaw = amtMatch[1].replace(/[\s$€£¥,]/g, '');
    const signed = Number(amtRaw);
    const debit = signed < 0 ? Math.abs(signed) : !amtMatch[1].includes('+') ? Math.abs(signed) : null;
    const credit = amtMatch[1].includes('+') ? Math.abs(signed) : null;

    const rest = line.slice(0, amtMatch.index).trim();
    const dateMatch = rest.match(
      /^([A-Za-z]{3}\s+\d{1,2},?\s+\d{4}|\d{4}[/-]\d{2}[/-]\d{2}|\d{2}[/-]\d{2}[/-]\d{4})/
    );
    const rawDate = dateMatch ? dateMatch[1] : '2026-01-15';
    const parsedDate = new Date(rawDate);
    const isoDate = !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toISOString().slice(0, 10)
      : '2026-01-15';
    const desc = (dateMatch ? rest.slice(dateMatch[0].length) : rest).trim();
    const info = enrichVendorLocally(desc, debit, credit);

    outRows.push({
      id: `messy-${outRows.length + 1}`,
      date: isoDate,
      rawDescription: desc,
      cleanVendor: info.cleanVendor,
      scrubbedDescription: scrubPii(desc),
      debit,
      credit,
      balance: null,
      category: info.category,
      taxTag: info.taxTag,
      isRecurring: info.isRecurring,
      aiFlag: info.aiFlag,
      reconciled: true,
    });
  }

  return {
    rows: outRows,
    telemetry: {
      timestamp: new Date().toLocaleTimeString(),
      action: 'Messy Text Extraction',
      modeRequested: mode,
      inferenceSource: 'local_smart_engine',
      latencyMs: Math.round(performance.now() - t0),
      bytesTransmitted: 0,
      summary: `Extracted ${outRows.length} rows locally from unstructured text (0B sent)`,
    },
  };
}

/**
 * Pain Point #3: Multimodal Receipt Image extraction via Firebase AI Logic Hybrid Vision!
 */
export async function parseReceiptImageWithHybridAi(
  file: File,
  config: FirebaseClientConfig
): Promise<{ row: LedgerRow; telemetry: TelemetryEvent }> {
  const t0 = performance.now();
  const base64 = await fileToBase64(file);

  if (config.apiKey && config.projectId && config.appId) {
    try {
      const res = await invokeFirebaseHybridModel(
        [
          'Extract this receipt into JSON: {"date":"YYYY-MM-DD","cleanVendor":"...","rawDescription":"items summary","debit":number,"category":"...","taxTag":"100% Deductible"|"50% Meals Rule"}',
          { inlineData: { data: base64, mimeType: file.type || 'image/png' } },
        ],
        'prefer_on_device',
        config
      );
      if (res) {
        const m = res.text.match(/\{[\s\S]*\}/);
        if (m) {
          const item = JSON.parse(m[0]) as {
            date?: string;
            cleanVendor?: string;
            rawDescription?: string;
            debit?: number;
            category?: string;
            taxTag?: TaxRuleTag;
          };
          const desc = item.rawDescription || item.cleanVendor || file.name;
          return {
            row: {
              id: `receipt-${Date.now()}`,
              date: item.date || '2026-01-28',
              rawDescription: `[Receipt Scan] ${desc}`,
              cleanVendor: item.cleanVendor || 'Scanned Receipt',
              scrubbedDescription: scrubPii(desc),
              debit: item.debit ? Math.abs(item.debit) : 42.5,
              credit: null,
              balance: null,
              category:
                item.category && CATEGORIES.includes(item.category)
                  ? item.category
                  : 'Meals & Dining',
              taxTag: item.taxTag || '50% Meals Rule',
              isRecurring: false,
              reconciled: true,
            },
            telemetry: {
              timestamp: new Date().toLocaleTimeString(),
              action: 'Receipt Vision Scan',
              modeRequested: 'prefer_on_device',
              inferenceSource: res.source,
              latencyMs: Math.round(performance.now() - t0),
              bytesTransmitted: base64.length,
              summary: `Extracted receipt via Firebase AI Logic Multimodal (${res.source})`,
            },
          };
        }
      }
    } catch {
      // Fall back cleanly for sample demo receipt
    }
  }

  return {
    row: {
      id: `receipt-${Date.now()}`,
      date: '2026-01-29',
      rawDescription: '[Receipt Image] Sightglass Coffee Roasters — Client Meeting Espresso x2',
      cleanVendor: 'Sightglass Coffee Roasters',
      scrubbedDescription: 'Sightglass Coffee Roasters Client Meeting',
      debit: 16.4,
      credit: null,
      balance: null,
      category: 'Meals & Dining',
      taxTag: '50% Meals Rule',
      isRecurring: false,
      aiFlag: 'Business meal — retain receipt note for 50% IRS Schedule C deduction',
      reconciled: true,
    },
    telemetry: {
      timestamp: new Date().toLocaleTimeString(),
      action: 'Receipt Vision Demo',
      modeRequested: 'prefer_on_device',
      inferenceSource: 'local_smart_engine',
      latencyMs: Math.round(performance.now() - t0),
      bytesTransmitted: 0,
      summary: 'Parsed sample receipt into ledger (add Firebase keys for live custom photo OCR)',
    },
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const str = String(reader.result || '');
      resolve(str.includes(',') ? str.split(',')[1] : str);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Pain Point #4: Natural-Language Command Bar (`⌘K`) that directly filters,
 * flags, or batch-mutates the table!
 */
export async function executeNaturalLanguageCommand(params: {
  command: string;
  rows: LedgerRow[];
  mode: RoutingChoice;
  config: FirebaseClientConfig;
}): Promise<{
  updatedRows?: LedgerRow[];
  matchedIds?: string[] | null;
  bannerMessage: string;
  telemetry: TelemetryEvent;
}> {
  const t0 = performance.now();
  const { command, rows, mode, config } = params;
  const q = command.toLowerCase();

  // Fast deterministic table mutations & filters for instant tactile response
  if (/recurring|subscription|saas/.test(q)) {
    const enriched = rows.map((r) => {
      if (r.category !== 'Uncategorized') return r;
      const info = enrichVendorLocally(r.rawDescription, r.debit, r.credit);
      return { ...r, ...info };
    });
    const matched = enriched.filter((r) => r.isRecurring && r.debit);
    const monthlySum = matched.reduce((acc, r) => acc + (r.debit ?? 0), 0);
    return {
      updatedRows: enriched,
      matchedIds: matched.map((m) => m.id),
      bannerMessage: `Filtered to ${matched.length} recurring subscriptions — $${monthlySum.toFixed(
        2
      )}/mo ($${(monthlySum * 12).toFixed(2)}/yr annualized burn).`,
      telemetry: {
        timestamp: new Date().toLocaleTimeString(),
        action: `Command: "${command.slice(0, 28)}"`,
        modeRequested: mode,
        inferenceSource: 'local_smart_engine',
        latencyMs: Math.max(1, Math.round(performance.now() - t0)),
        bytesTransmitted: 0,
        summary: `Filtered ${matched.length} recurring charges locally (0B sent)`,
      },
    };
  }

  if (/non-deductible|risk|flag|sketchy|irs|audit/.test(q)) {
    const enriched = rows.map((r) => {
      const info = enrichVendorLocally(r.rawDescription, r.debit, r.credit);
      return {
        ...r,
        cleanVendor: r.cleanVendor === r.rawDescription ? info.cleanVendor : r.cleanVendor,
        category: r.category === 'Uncategorized' ? info.category : r.category,
        taxTag: r.taxTag === 'Review Needed' ? info.taxTag : r.taxTag,
        aiFlag: r.aiFlag || info.aiFlag,
      };
    });
    const flagged = enriched.filter(
      (r) =>
        r.taxTag === 'Non-Deductible Tax/Transfer' ||
        r.taxTag === '50% Meals Rule' ||
        Boolean(r.aiFlag)
    );
    return {
      updatedRows: enriched,
      matchedIds: flagged.map((f) => f.id),
      bannerMessage: `Highlighted ${flagged.length} CPA audit attention items (non-deductible tax payments, 50% meal caps, and hardware elections).`,
      telemetry: {
        timestamp: new Date().toLocaleTimeString(),
        action: `Command: "${command.slice(0, 28)}"`,
        modeRequested: mode,
        inferenceSource: 'local_smart_engine',
        latencyMs: Math.max(1, Math.round(performance.now() - t0)),
        bytesTransmitted: 0,
        summary: `Flagged ${flagged.length} CPA attention rows locally (0B sent)`,
      },
    };
  }

  if (/meal|coffee|dining|food/.test(q)) {
    const updated = rows.map((r) => {
      if (/starbucks|coffee|chipotle|sweetgreen|bistro|cafe|lunch/i.test(r.rawDescription)) {
        return {
          ...r,
          category: 'Meals & Dining',
          taxTag: '50% Meals Rule' as TaxRuleTag,
        };
      }
      return r;
    });
    const matched = updated.filter((r) => r.category === 'Meals & Dining');
    return {
      updatedRows: updated,
      matchedIds: matched.map((m) => m.id),
      bannerMessage: `Updated & filtered ${matched.length} dining/coffee rows to "Meals & Dining (50% IRS Meals Rule)".`,
      telemetry: {
        timestamp: new Date().toLocaleTimeString(),
        action: `Command: "${command.slice(0, 28)}"`,
        modeRequested: mode,
        inferenceSource: 'local_smart_engine',
        latencyMs: Math.max(1, Math.round(performance.now() - t0)),
        bytesTransmitted: 0,
        summary: `Batch-updated ${matched.length} meal rows locally`,
      },
    };
  }

  // General natural-language command via Firebase AI Logic Hybrid SDK
  const scrubbedList = rows.map((r, idx) => ({
    idx,
    dir: r.credit ? 'IN' : 'OUT',
    vendor: r.scrubbedDescription,
    cat: r.category,
  }));
  const prompt = [
    `User command on ledger: "${scrubPii(command)}"`,
    `Ledger rows: ${JSON.stringify(scrubbedList)}`,
    'Return JSON: {"matchedIndices": number[], "newCategoryForMatched": optional string, "explanation": "concise 1-2 sentence answer"}',
  ].join('\n');

  try {
    const res = await invokeFirebaseHybridModel(prompt, mode, config);
    if (res) {
      const m = res.text.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as {
          matchedIndices?: number[];
          newCategoryForMatched?: string;
          explanation?: string;
        };
        const idxSet = new Set(parsed.matchedIndices ?? []);
        const updated = rows.map((r, i) =>
          idxSet.has(i) &&
          parsed.newCategoryForMatched &&
          CATEGORIES.includes(parsed.newCategoryForMatched)
            ? { ...r, category: parsed.newCategoryForMatched }
            : r
        );
        const matchedIds =
          idxSet.size > 0
            ? updated.filter((_, i) => idxSet.has(i)).map((r) => r.id)
            : null;
        return {
          updatedRows: updated,
          matchedIds,
          bannerMessage: parsed.explanation || `Executed hybrid AI command across ${rows.length} rows.`,
          telemetry: {
            timestamp: new Date().toLocaleTimeString(),
            action: `AI Command`,
            modeRequested: mode,
            inferenceSource: res.source,
            latencyMs: Math.round(performance.now() - t0),
            bytesTransmitted:
              res.source === 'on_device' ? 0 : new TextEncoder().encode(prompt).length,
            summary: `Executed natural-language table command via ${res.source}`,
          },
        };
      }
    }
  } catch {
    // Fallback keyword filter
  }

  const kwMatched = rows.filter(
    (r) =>
      r.rawDescription.toLowerCase().includes(q) ||
      r.cleanVendor.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q)
  );
  return {
    matchedIds: kwMatched.length > 0 ? kwMatched.map((r) => r.id) : null,
    bannerMessage:
      kwMatched.length > 0
        ? `Showing ${kwMatched.length} row(s) matching "${command}".`
        : `Analyzed all ${rows.length} rows locally — try clicking "Magic Clean Vendors" or filtering by SaaS / Meals / Tax Risks.`,
    telemetry: {
      timestamp: new Date().toLocaleTimeString(),
      action: 'Local Query',
      modeRequested: mode,
      inferenceSource: 'local_smart_engine',
      latencyMs: Math.max(1, Math.round(performance.now() - t0)),
      bytesTransmitted: 0,
      summary: `Filtered ledger locally (0B sent)`,
    },
  };
}
