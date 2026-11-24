import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardPaste,
  Command,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  Lock,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Undo2,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CATEGORIES,
  executeNaturalLanguageCommand,
  extractPdfLedgerLocally,
  getDefaultFirebaseConfig,
  magicEnrichRows,
  MESSY_TEXT_SAMPLE,
  parseMessyTextWithHybridAi,
  parseReceiptImageWithHybridAi,
  type FirebaseClientConfig,
  type LedgerRow,
  type RoutingChoice,
  type TelemetryEvent,
} from './hybridEngine';

export default function App() {
  const [inputTab, setInputTab] = useState<'pdf' | 'messy' | 'receipt'>('pdf');
  const [messyInput, setMessyInput] = useState(MESSY_TEXT_SAMPLE);

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [undoSnapshot, setUndoSnapshot] = useState<LedgerRow[] | null>(null);
  const [filteredIds, setFilteredIds] = useState<string[] | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [closing, setClosing] = useState<number | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>('');

  const [mode, setMode] = useState<RoutingChoice>('prefer_on_device');
  const [commandInput, setCommandInput] = useState('');
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [telemetryLog, setTelemetryLog] = useState<TelemetryEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showRawMemo, setShowRawMemo] = useState(false);
  const [fbConfig, setFbConfig] = useState<FirebaseClientConfig>(getDefaultFirebaseConfig);

  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const sync = () => setIsOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  async function loadPdfFile(file: File) {
    setSourceLabel(file.name);
    setFilteredIds(null);
    setUndoSnapshot(null);
    const res = await extractPdfLedgerLocally(file);
    setRows(res.rows);
    setOpening(res.openingBalance);
    setClosing(res.closingBalance);
    setBannerMsg(
      `Extracted ${res.rows.length} raw statement rows locally in RAM. Click "✨ Magic Clean Vendors & Tax Rules" to see Hybrid AI transform cryptic bank strings!`
    );
  }

  async function loadSamplePdf(name: string, path: string) {
    const res = await fetch(path);
    const blob = await res.blob();
    await loadPdfFile(new File([blob], name, { type: 'application/pdf' }));
  }

  async function handleParseMessyText() {
    if (!messyInput.trim()) return;
    setRunning(true);
    try {
      const res = await parseMessyTextWithHybridAi(messyInput, mode, fbConfig);
      setRows(res.rows);
      setSourceLabel('Unstructured Text / SMS Paste');
      setOpening(null);
      setClosing(null);
      setFilteredIds(null);
      setTelemetryLog((prev) => [res.telemetry, ...prev].slice(0, 8));
      setBannerMsg(
        `Converted ${res.rows.length} messy text lines into structured, tax-tagged accounting rows!`
      );
    } finally {
      setRunning(false);
    }
  }

  async function handleReceiptScan(file?: File) {
    setRunning(true);
    try {
      const target =
        file ?? new File([new Uint8Array([137, 80, 78, 71])], 'sample-coffee-receipt.png', { type: 'image/png' });
      const res = await parseReceiptImageWithHybridAi(target, fbConfig, mode);
      setUndoSnapshot(rows);
      setRows((prev) => [res.row, ...prev]);
      if (!sourceLabel) setSourceLabel('Receipt Vision Ledger');
      setTelemetryLog((prev) => [res.telemetry, ...prev].slice(0, 8));
      setBannerMsg(`Added scanned receipt "${res.row.cleanVendor}" ($${res.row.debit?.toFixed(2)}) into ledger!`);
    } finally {
      setRunning(false);
    }
  }

  async function handleMagicClean() {
    if (rows.length === 0) return;
    setRunning(true);
    setUndoSnapshot(rows);
    try {
      const res = await magicEnrichRows(rows, mode, fbConfig);
      setRows(res.rows);
      setTelemetryLog((prev) => [res.telemetry, ...prev].slice(0, 8));
      setBannerMsg(
        `Cleaned ${res.rows.length} cryptic bank memos into human vendor names + IRS Schedule C deductibility tags!`
      );
    } finally {
      setRunning(false);
    }
  }

  async function runCommand(cmdText: string) {
    if (!cmdText.trim() || rows.length === 0) return;
    setRunning(true);
    setUndoSnapshot(rows);
    try {
      const res = await executeNaturalLanguageCommand({
        command: cmdText,
        rows,
        mode,
        config: fbConfig,
      });
      if (res.updatedRows) setRows(res.updatedRows);
      setFilteredIds(res.matchedIds ?? null);
      setBannerMsg(res.bannerMessage);
      setTelemetryLog((prev) => [res.telemetry, ...prev].slice(0, 8));
    } finally {
      setRunning(false);
    }
  }

  function handleUndo() {
    if (!undoSnapshot) return;
    setRows(undoSnapshot);
    setUndoSnapshot(null);
    setFilteredIds(null);
    setBannerMsg('Reverted last AI table edit.');
  }

  function exportCsv() {
    const header = [
      'Date',
      'Clean Vendor',
      'Raw Bank Memo',
      'Debit',
      'Credit',
      'Balance',
      'Category',
      'IRS Tax Rule',
      'Recurring',
      'Audit Note',
    ];
    const lines = visibleRows.map((r) =>
      [
        r.date,
        `"${r.cleanVendor.replace(/"/g, '""')}"`,
        `"${r.rawDescription.replace(/"/g, '""')}"`,
        r.debit?.toFixed(2) ?? '',
        r.credit?.toFixed(2) ?? '',
        r.balance?.toFixed(2) ?? '',
        `"${r.category}"`,
        `"${r.taxTag}"`,
        r.isRecurring ? 'YES' : 'NO',
        `"${(r.aiFlag || '').replace(/"/g, '""')}"`,
      ].join(',')
    );
    const blob = new Blob(['\uFEFF' + [header.join(','), ...lines].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sourceLabel.replace(/[^a-z0-9]/gi, '_') || 'vaultcsv'}-enriched.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const visibleRows = useMemo(() => {
    if (!filteredIds) return rows;
    const set = new Set(filteredIds);
    return rows.filter((r) => set.has(r.id));
  }, [rows, filteredIds]);

  const stats = useMemo(() => {
    const deductible100 = rows
      .filter((r) => r.taxTag === '100% Deductible' && r.debit)
      .reduce((a, r) => a + (r.debit ?? 0), 0);
    const meals50 = rows
      .filter((r) => r.taxTag === '50% Meals Rule' && r.debit)
      .reduce((a, r) => a + (r.debit ?? 0) * 0.5, 0);
    const recurringMo = rows
      .filter((r) => r.isRecurring && r.debit)
      .reduce((a, r) => a + (r.debit ?? 0), 0);
    const verified = rows.filter((r) => r.reconciled).length;
    return {
      deductibleEst: deductible100 + meals50,
      recurringAnnual: recurringMo * 12,
      verified,
    };
  }, [rows]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-white">
                  Vault<span className="text-emerald-400">CSV</span>
                </span>
                <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                  HYBRID AI STUDIO
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                On-Device Gemini Nano + PII-Scrubbed Firebase AI Logic
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Routing Pill right in top bar for 1-click switching */}
            <div className="inline-flex rounded-xl border border-slate-800 bg-slate-900 p-0.5">
              {(
                [
                  { id: 'only_on_device', label: 'Airgap (Nano Only)' },
                  { id: 'prefer_on_device', label: 'Hybrid (Nano → Cloud)' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                    mode === m.id
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <span
              className={`hidden items-center gap-1.5 rounded-full border px-3 py-1 font-semibold sm:inline-flex ${
                isOffline
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-800 bg-slate-900 text-slate-300'
              }`}
            >
              <WifiOff className="h-3.5 w-3.5 text-emerald-400" />
              {isOffline ? 'OFFLINE VERIFIED' : '0B Raw PDF Upload'}
            </span>

            <button
              type="button"
              onClick={() => setShowConfig((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5" /> Keys
            </button>

            <a
              href="https://vaultcsv.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 font-bold text-emerald-300 hover:bg-emerald-500/20"
            >
              VaultCSV Pro <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
        {/* Optional Runtime Firebase Config */}
        {showConfig && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">
                Firebase AI Logic (`firebase/ai` + `firebase/app-check`) Credentials
              </span>
              <button
                type="button"
                onClick={() => setShowConfig(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-4">
              <input
                value={fbConfig.apiKey}
                onChange={(e) => setFbConfig({ ...fbConfig, apiKey: e.target.value })}
                placeholder="VITE_FIREBASE_API_KEY"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-200"
              />
              <input
                value={fbConfig.projectId}
                onChange={(e) => setFbConfig({ ...fbConfig, projectId: e.target.value })}
                placeholder="VITE_FIREBASE_PROJECT_ID"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-200"
              />
              <input
                value={fbConfig.appId}
                onChange={(e) => setFbConfig({ ...fbConfig, appId: e.target.value })}
                placeholder="VITE_FIREBASE_APP_ID"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-200"
              />
              <input
                value={fbConfig.recaptchaSiteKey}
                onChange={(e) => setFbConfig({ ...fbConfig, recaptchaSiteKey: e.target.value })}
                placeholder="App Check key or 'debug'"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-200"
              />
            </div>
          </div>
        )}

        {/* 3-Mode Ingestion Studio (PDF Statement / Messy Text / Receipt Vision) */}
        {rows.length === 0 && (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 sm:p-8">
            <div className="mx-auto max-w-2xl text-center">
              <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
                Turn Messy Bank PDFs, Raw Text & Receipts Into{' '}
                <span className="text-emerald-400">Tax-Ready Ledgers</span>
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                Deterministic penny-exact balance math meets{' '}
                <strong className="text-slate-200">Firebase AI Logic Hybrid Inference</strong>:
                clean cryptic card memos, flag non-deductible IRS traps, and edit your table in
                plain English—without leaking account numbers.
              </p>

              {/* 3 Ingestion Tabs */}
              <div className="mt-6 inline-flex rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setInputTab('pdf')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 cursor-pointer ${
                    inputTab === 'pdf'
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" /> 1. Bank PDF Statement
                </button>
                <button
                  type="button"
                  onClick={() => setInputTab('messy')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 cursor-pointer ${
                    inputTab === 'messy'
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <ClipboardPaste className="h-3.5 w-3.5" /> 2. Messy SMS / Email Text
                </button>
                <button
                  type="button"
                  onClick={() => setInputTab('receipt')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 cursor-pointer ${
                    inputTab === 'receipt'
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Camera className="h-3.5 w-3.5" /> 3. Receipt Vision Scan
                </button>
              </div>
            </div>

            {inputTab === 'pdf' && (
              <div className="mt-6 text-center">
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadPdfFile(f);
                  }}
                />
                <div
                  onClick={() => pdfInputRef.current?.click()}
                  className="mx-auto max-w-xl rounded-2xl border-2 border-dashed border-slate-700 bg-slate-950/60 p-8 transition hover:border-emerald-400 cursor-pointer"
                >
                  <Upload className="mx-auto h-8 w-8 text-emerald-400" />
                  <div className="mt-3 text-sm font-bold text-white">
                    Drop any Bank or Credit Card PDF Statement
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Parsed 100% in local browser RAM via self-hosted pdf.js
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
                  <span className="text-slate-400">Instant 1-Click Demo PDFs:</span>
                  <button
                    type="button"
                    onClick={() =>
                      void loadSamplePdf(
                        'chase-checking-2026.pdf',
                        './samples/chase-checking-2026.pdf'
                      )
                    }
                    className="rounded-lg bg-emerald-500 px-3.5 py-1.5 font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                  >
                    ✨ Load Chase 2-Page Checking PDF
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void loadSamplePdf(
                        'amex-business-card-2026.pdf',
                        './samples/amex-business-card-2026.pdf'
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                  >
                    Load Amex Card PDF
                  </button>
                </div>
              </div>
            )}

            {inputTab === 'messy' && (
              <div className="mx-auto mt-6 max-w-2xl space-y-3">
                <textarea
                  rows={6}
                  value={messyInput}
                  onChange={(e) => setMessyInput(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 p-4 font-mono text-xs text-slate-200 focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={running}
                  onClick={() => void handleParseMessyText()}
                  className="w-full rounded-xl bg-emerald-500 py-3 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                >
                  {running
                    ? 'Extracting Structured Ledger...'
                    : '✨ Parse Unstructured Text With Hybrid AI →'}
                </button>
              </div>
            )}

            {inputTab === 'receipt' && (
              <div className="mx-auto mt-6 max-w-xl text-center space-y-3">
                <input
                  ref={receiptInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleReceiptScan(f);
                  }}
                />
                <div
                  onClick={() => receiptInputRef.current?.click()}
                  className="rounded-2xl border-2 border-dashed border-slate-700 bg-slate-950/60 p-8 hover:border-emerald-400 cursor-pointer"
                >
                  <Camera className="mx-auto h-8 w-8 text-emerald-400" />
                  <div className="mt-2 text-sm font-bold text-white">
                    Upload Receipt or Invoice Photo (.PNG / .JPG)
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Extracts vendor, date, amount & IRS meal/expense deductibility
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleReceiptScan()}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                >
                  ✨ Try Instant Sample Coffee Receipt Scan
                </button>
              </div>
            )}
          </div>
        )}

        {/* Active AI-Native Ledger Workspace */}
        {rows.length > 0 && (
          <>
            {/* Live KPI Strip */}
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="text-[11px] font-semibold text-slate-400">Penny-Exact Balance Math</div>
                <div className="mt-1 font-mono text-xl font-extrabold text-emerald-400">
                  {stats.verified}/{rows.length} Verified
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {opening !== null ? `$${opening.toFixed(2)} → $${closing?.toFixed(2)}` : sourceLabel}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="text-[11px] font-semibold text-slate-400">
                  Est. Deductible Expenses
                </div>
                <div className="mt-1 font-mono text-xl font-extrabold text-white">
                  ${stats.deductibleEst.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  100% ops + 50% IRS meals cap applied
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div className="text-[11px] font-semibold text-slate-400">
                  Annualized SaaS / Recurring Burn
                </div>
                <div className="mt-1 font-mono text-xl font-extrabold text-amber-300">
                  ${stats.recurringAnnual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/yr
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">Auto-detected subscriptions</div>
              </div>

              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                  <Cpu className="h-3.5 w-3.5" /> Last Hybrid Execution
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-white">
                  {telemetryLog[0]
                    ? `${telemetryLog[0].inferenceSource} (${telemetryLog[0].latencyMs}ms)`
                    : 'Ready — Click Magic Clean'}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-emerald-300/80">
                  {telemetryLog[0]
                    ? `${telemetryLog[0].bytesTransmitted}B sent over network`
                    : `Mode: ${mode}`}
                </div>
              </div>
            </div>

            {/* AI Command & 1-Click Magic Action Bar */}
            <div className="rounded-2xl border border-emerald-500/40 bg-slate-900 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => void handleMagicClean()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-lg shadow-emerald-500/10 transition hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
                  >
                    <Sparkles className="h-4 w-4" />
                    {running ? 'Running Hybrid AI...' : '✨ Magic Clean Vendors & IRS Tax Rules'}
                  </button>

                  <button
                    type="button"
                    onClick={() => receiptInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                  >
                    <Camera className="h-3.5 w-3.5 text-emerald-400" /> + Scan Receipt Photo
                  </button>
                  <input
                    ref={receiptInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleReceiptScan(f);
                    }}
                  />

                  {undoSnapshot && (
                    <button
                      type="button"
                      onClick={handleUndo}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-slate-800 cursor-pointer"
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Undo AI Edit
                    </button>
                  )}

                  {filteredIds && (
                    <button
                      type="button"
                      onClick={() => setFilteredIds(null)}
                      className="inline-flex items-center gap-1 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-300 cursor-pointer"
                    >
                      Showing {visibleRows.length}/{rows.length} • Clear Filter ×
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={exportCsv}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-slate-200 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" /> Export Enriched CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRows([]);
                      setFilteredIds(null);
                      setBannerMsg(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> New File
                  </button>
                </div>
              </div>

              {/* Natural Language Command Bar (Talk to Edit/Filter Table) */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runCommand(commandInput);
                }}
                className="flex gap-2"
              >
                <div className="relative flex-1">
                  <Command className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-400" />
                  <input
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    placeholder='Tell AI what to do on the table — e.g. "Show recurring SaaS subscriptions" or "Flag IRS tax risks"...'
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={running || !commandInput.trim()}
                  className="rounded-xl bg-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40 cursor-pointer"
                >
                  Run Command
                </button>
              </form>

              {/* 1-Click Tactile Prompt Chips */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-slate-500">1-Click Commands:</span>
                {[
                  'Show only recurring SaaS subscriptions',
                  'Flag non-deductible IRS & audit attention items',
                  'Tag all coffee & dining under 50% Meals Rule',
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setCommandInput(chip);
                      void runCommand(chip);
                    }}
                    className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 cursor-pointer"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {bannerMsg && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-200">
                  <span>{bannerMsg}</span>
                  <label className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showRawMemo}
                      onChange={(e) => setShowRawMemo(e.target.checked)}
                      className="accent-emerald-500"
                    />
                    Show Raw Bank String + PII Diff
                  </label>
                </div>
              )}
            </div>

            {/* Enriched Interactive Ledger Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
              <table className="w-full min-w-[940px] divide-y divide-slate-800 text-left text-xs">
                <thead className="bg-slate-950 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3.5 py-3">Date</th>
                    <th className="px-3.5 py-3">Vendor / Payee (AI Cleaned)</th>
                    <th className="px-3.5 py-3 text-right">Outflow</th>
                    <th className="px-3.5 py-3 text-right">Inflow</th>
                    <th className="px-3.5 py-3">Category</th>
                    <th className="px-3.5 py-3">IRS Tax Treatment</th>
                    <th className="px-3.5 py-3 text-center">Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {visibleRows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-slate-300">
                        {r.date}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{r.cleanVendor}</span>
                          {r.isRecurring && (
                            <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">
                              Recurring
                            </span>
                          )}
                        </div>
                        {showRawMemo && (
                          <div className="mt-1 space-y-0.5 font-mono text-[10px]">
                            <div className="text-slate-500">Raw RAM: {r.rawDescription}</div>
                            <div className="text-emerald-400/80">
                              Scrubbed: {r.scrubbedDescription}
                            </div>
                          </div>
                        )}
                        {r.aiFlag && (
                          <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                            <AlertTriangle className="h-3 w-3" /> {r.aiFlag}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-rose-400">
                        {r.debit ? `-$${r.debit.toFixed(2)}` : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-emerald-400">
                        {r.credit ? `+$${r.credit.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <select
                          value={r.category}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((x) =>
                                x.id === r.id ? { ...x, category: e.target.value } : x
                              )
                            )
                          }
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            r.taxTag === '100% Deductible'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : r.taxTag === '50% Meals Rule'
                                ? 'bg-amber-500/15 text-amber-300'
                                : r.taxTag === 'Non-Deductible Tax/Transfer'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : r.taxTag === 'Taxable Revenue'
                                    ? 'bg-sky-500/15 text-sky-300'
                                    : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {r.taxTag}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-center">
                        {r.reconciled && (
                          <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-400" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Compact Telemetry Footer */}
            {telemetryLog.length > 0 && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                  <Lock className="h-3.5 w-3.5 text-emerald-400" />
                  <Activity className="h-3.5 w-3.5 text-emerald-400" />
                  Firebase AI Logic `response.inferenceSource` & Zero-Leakage Telemetry
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {telemetryLog.slice(0, 3).map((ev, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-[11px]"
                    >
                      <div className="flex justify-between font-mono">
                        <span className="font-bold text-emerald-400">{ev.inferenceSource}</span>
                        <span className="text-slate-500">
                          {ev.latencyMs}ms • {ev.bytesTransmitted}B out
                        </span>
                      </div>
                      <div className="mt-1 truncate text-slate-300">{ev.summary}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
