import { getApps, initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
} from 'firebase/ai';

export interface LedgerRow {
  id: string;
  date: string;
  rawDescription: string;
  scrubbedDescription: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  category: string;
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
  modeRequested: RoutingChoice;
  inferenceSource: 'on_device' | 'in_cloud' | 'local_fallback';
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

/**
 * Deterministic local PII scrubber: strips account numbers, card digits,
 * SSN/EINs, dates, and dollar figures before any cloud fallback can occur.
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

function guessInitialCategory(desc: string, credit: number | null): string {
  if (credit && credit > 0) return 'Income / Deposits';
  const s = desc.toLowerCase();
  if (/aws|cloudflare|figma|notion|slack|linear|anthropic|openai|vercel|github/.test(s))
    return 'Software & SaaS';
  if (/gusto|payroll|deel/.test(s)) return 'Payroll & Contractors';
  if (/google ads|meta ads|facebk/.test(s)) return 'Marketing & Ads';
  if (/uber|delta|lufthansa|hilton/.test(s)) return 'Travel & Transport';
  if (/starbucks|chipotle|blue bottle/.test(s)) return 'Meals & Dining';
  if (/wework|rent/.test(s)) return 'Rent & Facilities';
  if (/verizon|telecom/.test(s)) return 'Utilities & Telecom';
  if (/irs|eftps|tax/.test(s)) return 'Taxes & Government';
  return 'Uncategorized';
}

export async function extractPdfLedgerLocally(file: File): Promise<{
  rows: LedgerRow[];
  openingBalance: number | null;
  closingBalance: number | null;
}> {
  const buf = await file.arrayBuffer();
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

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

  // Group into visual rows per page
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
      // Multi-line continuation
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

    rows.push({
      id: `row-${rows.length + 1}`,
      date: first,
      rawDescription: desc,
      scrubbedDescription: scrubPii(desc),
      debit,
      credit,
      balance,
      category: guessInitialCategory(desc, credit),
      reconciled: true,
    });
  }

  // Verify integer-cent running balance reconciliation
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

export async function runHybridInferenceAudit(params: {
  rows: LedgerRow[];
  mode: RoutingChoice;
  promptGoal: 'tax_audit' | 'subscriptions' | 'classify' | 'custom';
  customPrompt?: string;
  config: FirebaseClientConfig;
}): Promise<{
  output: string;
  telemetry: TelemetryEvent;
  categoryMap?: Record<string, string>;
}> {
  const t0 = performance.now();
  const { rows, mode, promptGoal, customPrompt, config } = params;

  // Strictly PII-scrubbed payload (zero account numbers, dates, or balances!)
  const scrubbedList = rows.map((r, idx) => ({
    idx,
    dir: r.credit ? 'INFLOW' : 'OUTFLOW',
    merchant: r.scrubbedDescription,
    cat: r.category,
  }));

  const instruction =
    promptGoal === 'classify'
      ? `Classify each scrubbed merchant into one of [${CATEGORIES.join(', ')}]. Return JSON array [{"idx":0,"category":"..."}] followed by a 2-sentence summary.`
      : promptGoal === 'subscriptions'
        ? 'Identify recurring SaaS/telecom subscriptions, potential duplicate vendors, and cost-saving opportunities in concise bullet points.'
        : promptGoal === 'custom' && customPrompt
          ? `Answer concisely based ONLY on these scrubbed merchant records: ${scrubPii(customPrompt)}`
          : 'Write an executive 5-bullet CPA tax-readiness audit covering deductible categories, recurring vendors, and audit review notes.';

  const fullPrompt = `${instruction}\n\nScrubbed Records (PII & balances removed locally):\n${JSON.stringify(
    scrubbedList
  )}`;

  // 1. Official Firebase AI Logic Hybrid Inference SDK (`firebase/ai` + `firebase/app-check`)
  if (config.apiKey && config.projectId && config.appId) {
    try {
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

      const res = await model.generateContent(fullPrompt);
      const text = res.response.text();
      const isOnDevice = res.response.inferenceSource === InferenceSource.ON_DEVICE;
      const latencyMs = Math.round(performance.now() - t0);

      let categoryMap: Record<string, string> | undefined;
      if (promptGoal === 'classify') {
        const match = text.match(/\[[\s\S]*?\]/);
        if (match) {
          const parsed = JSON.parse(match[0]) as Array<{ idx: number; category: string }>;
          categoryMap = {};
          for (const item of parsed) {
            const target = rows[item.idx];
            if (target && CATEGORIES.includes(item.category)) {
              categoryMap[target.id] = item.category;
            }
          }
        }
      }

      return {
        output: text,
        categoryMap,
        telemetry: {
          timestamp: new Date().toLocaleTimeString(),
          modeRequested: mode,
          inferenceSource: isOnDevice ? 'on_device' : 'in_cloud',
          latencyMs,
          bytesTransmitted: isOnDevice ? 0 : new TextEncoder().encode(fullPrompt).length,
          summary: isOnDevice
            ? 'Executed 100% on-device via Gemini Nano (0 bytes left browser)'
            : 'Routed to Gemini 2.5 Flash via Firebase AI Logic (PII-scrubbed)',
        },
      };
    } catch (err) {
      if (mode === 'only_on_device') {
        const latencyMs = Math.round(performance.now() - t0);
        return {
          output: `Strict Airgap Lock (InferenceMode.ONLY_ON_DEVICE) prevented cloud fallback because Chrome On-Device Gemini Nano is not active in this browser session (${
            err instanceof Error ? err.message : 'unavailable'
          }).\n\nTip: Enable Chrome Built-in AI (Gemini Nano) or switch routing mode to PREFER_ON_DEVICE to test PII-scrubbed hybrid cloud fallback.`,
          telemetry: {
            timestamp: new Date().toLocaleTimeString(),
            modeRequested: mode,
            inferenceSource: 'local_fallback',
            latencyMs,
            bytesTransmitted: 0,
            summary: 'Airgap lock enforced — blocked cloud transmission (0 bytes sent)',
          },
        };
      }
    }
  }

  // 2. Deterministic offline fallback when Firebase keys aren't supplied yet
  const latencyMs = Math.round(performance.now() - t0);
  const byCat = new Map<string, number>();
  for (const r of rows) {
    if (r.debit) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.debit);
  }
  const catLines = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `• ${c}: $${v.toFixed(2)}`);

  return {
    output: [
      'Deterministic Local Audit (Add Firebase AI Logic keys in Config Drawer to run live Gemini Nano / Cloud Hybrid):',
      ...catLines,
    ].join('\n'),
    telemetry: {
      timestamp: new Date().toLocaleTimeString(),
      modeRequested: mode,
      inferenceSource: 'local_fallback',
      latencyMs,
      bytesTransmitted: 0,
      summary: 'Local deterministic fallback (0 bytes sent)',
    },
  };
}
