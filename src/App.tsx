import {
  Activity,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FileText,
  Lock,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  WifiOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  CATEGORIES,
  extractPdfLedgerLocally,
  getDefaultFirebaseConfig,
  runHybridInferenceAudit,
  type FirebaseClientConfig,
  type LedgerRow,
  type RoutingChoice,
  type TelemetryEvent,
} from './hybridEngine';

export default function App() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [opening, setOpening] = useState<number | null>(null);
  const [closing, setClosing] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [mode, setMode] = useState<RoutingChoice>('prefer_on_device');
  const [customPrompt, setCustomPrompt] = useState('');
  const [aiOutput, setAiOutput] = useState<string>('');
  const [telemetryLog, setTelemetryLog] = useState<TelemetryEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [fbConfig, setFbConfig] = useState<FirebaseClientConfig>(getDefaultFirebaseConfig);

  const fileRef = useRef<HTMLInputElement | null>(null);

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
    setFileName(file.name);
    const res = await extractPdfLedgerLocally(file);
    setRows(res.rows);
    setOpening(res.openingBalance);
    setClosing(res.closingBalance);
  }

  async function loadSample() {
    const res = await fetch('/samples/chase-checking-2026.pdf');
    const blob = await res.blob();
    await loadPdfFile(
      new File([blob], 'chase-checking-2026.pdf', { type: 'application/pdf' })
    );
  }

  async function executeHybrid(
    goal: 'tax_audit' | 'subscriptions' | 'classify' | 'custom'
  ) {
    if (rows.length === 0) return;
    setRunning(true);
    try {
      const res = await runHybridInferenceAudit({
        rows,
        mode,
        promptGoal: goal,
        customPrompt,
        config: fbConfig,
      });
      setAiOutput(res.output);
      setTelemetryLog((prev) => [res.telemetry, ...prev].slice(0, 8));
      if (res.categoryMap) {
        setRows((prev) =>
          prev.map((r) =>
            res.categoryMap?.[r.id] ? { ...r, category: res.categoryMap[r.id] } : r
          )
        );
      }
    } finally {
      setRunning(false);
    }
  }

  function exportCsv() {
    const header = ['Date', 'Description', 'Debit', 'Credit', 'Balance', 'Category', 'Reconciled'];
    const lines = rows.map((r) =>
      [
        r.date,
        `"${r.rawDescription.replace(/"/g, '""')}"`,
        r.debit?.toFixed(2) ?? '',
        r.credit?.toFixed(2) ?? '',
        r.balance?.toFixed(2) ?? '',
        `"${r.category}"`,
        r.reconciled ? 'VERIFIED' : 'CHECK',
      ].join(',')
    );
    const blob = new Blob(['\uFEFF' + [header.join(','), ...lines].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace(/\.pdf$/i, '') || 'ledger'}-reconciled.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const verifiedCount = rows.filter((r) => r.reconciled).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white">
                Vault<span className="text-emerald-400">CSV</span>{' '}
                <span className="text-xs font-semibold text-slate-400">Hybrid AI Studio</span>
              </span>
              <div className="text-[11px] text-slate-400">
                Built with Firebase AI Logic Hybrid SDK (Gemini Nano On-Device + Cloud Fallback)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold ${
                isOffline
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-700 bg-slate-800 text-slate-300'
              }`}
            >
              <WifiOff className="h-3.5 w-3.5 text-emerald-400" />
              {isOffline ? 'AIRGAPPED OFFLINE ACTIVE' : 'Local PDF Engine Ready'}
            </span>

            <button
              type="button"
              onClick={() => setShowConfig((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5" /> Firebase Config
            </button>

            <a
              href="https://vaultcsv.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 font-bold text-slate-950 hover:bg-emerald-400"
            >
              VaultCSV Pro <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
        {/* Optional Runtime Firebase Config Drawer for Judges Testing Custom Keys */}
        {showConfig && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-xs">
            <h2 className="font-bold text-white">
              Firebase AI Logic Runtime Configuration (Optional Override)
            </h2>
            <p className="mt-1 text-slate-400">
              Pre-populated from <code className="font-mono">VITE_FIREBASE_*</code> build variables,
              or paste custom Firebase Web credentials here to test live hybrid routing.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <input
                value={fbConfig.apiKey}
                onChange={(e) => setFbConfig({ ...fbConfig, apiKey: e.target.value })}
                placeholder="Firebase apiKey"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-200"
              />
              <input
                value={fbConfig.projectId}
                onChange={(e) => setFbConfig({ ...fbConfig, projectId: e.target.value })}
                placeholder="Firebase projectId"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-200"
              />
              <input
                value={fbConfig.appId}
                onChange={(e) => setFbConfig({ ...fbConfig, appId: e.target.value })}
                placeholder="Firebase appId"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-200"
              />
              <input
                value={fbConfig.recaptchaSiteKey}
                onChange={(e) => setFbConfig({ ...fbConfig, recaptchaSiteKey: e.target.value })}
                placeholder="App Check key or 'debug'"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-200"
              />
            </div>
          </div>
        )}

        {/* Dropzone / Sample Loader */}
        {rows.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-10 text-center">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadPdfFile(f);
              }}
            />
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
              <Upload className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-2xl font-extrabold text-white sm:text-3xl">
              Airgapped Bank PDF Parser + Hybrid On-Device AI Auditor
            </h1>
            <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-400">
              Parse PDF bank statements 100% locally in browser RAM, verify every running balance to
              the penny, and run CPA tax audits using{' '}
              <strong className="text-emerald-300">Firebase AI Logic Hybrid Inference</strong>{' '}
              (Chrome Gemini Nano on-device with PII-scrubbed cloud fallback).
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => void loadSample()}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
              >
                <Sparkles className="h-4 w-4" /> Load 2-Page Sample Chase PDF (Instant Demo)
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 cursor-pointer"
              >
                <FileText className="h-4 w-4" /> Drop Your Own Bank PDF
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Top Summary & Hybrid Routing Studio */}
            <div className="grid gap-6 lg:grid-cols-12">
              {/* Left 7 cols: Hybrid AI Control Panel */}
              <div className="space-y-4 rounded-2xl border border-emerald-500/30 bg-slate-900 p-5 lg:col-span-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-emerald-400" />
                    <h2 className="text-base font-bold text-white">
                      Firebase AI Logic — Hybrid Inference Router
                    </h2>
                  </div>
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
                    firebase/ai + App Check
                  </span>
                </div>

                {/* 3 InferenceMode Selector Buttons */}
                <div className="grid gap-2 sm:grid-cols-3 text-xs">
                  {(
                    [
                      {
                        id: 'only_on_device',
                        label: 'ONLY_ON_DEVICE',
                        sub: 'Strict Airgap • 0 Bytes Out',
                      },
                      {
                        id: 'prefer_on_device',
                        label: 'PREFER_ON_DEVICE',
                        sub: 'Nano First → Scrubbed Cloud',
                      },
                      {
                        id: 'prefer_in_cloud',
                        label: 'PREFER_IN_CLOUD',
                        sub: 'Gemini Flash (PII Scrubbed)',
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setMode(opt.id)}
                      className={`rounded-xl border p-3 text-left transition cursor-pointer ${
                        mode === opt.id
                          ? 'border-emerald-400 bg-emerald-500/15 text-white'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-mono font-bold text-emerald-300">{opt.label}</div>
                      <div className="mt-0.5 text-[11px] opacity-80">{opt.sub}</div>
                    </button>
                  ))}
                </div>

                {/* Action Triggers */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => void executeHybrid('tax_audit')}
                    className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 cursor-pointer"
                  >
                    {running ? 'Running Hybrid Inference...' : '1. Generate CPA Tax Audit'}
                  </button>
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => void executeHybrid('subscriptions')}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                  >
                    2. Detect SaaS Subscriptions
                  </button>
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => void executeHybrid('classify')}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                  >
                    3. AI Re-Classify Merchants
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (customPrompt.trim()) void executeHybrid('custom');
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Ask CPA Copilot about deductible expenses or vendors..."
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={running || !customPrompt.trim()}
                    className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-950 hover:bg-slate-200 disabled:opacity-50 cursor-pointer"
                  >
                    Ask
                  </button>
                </form>

                {aiOutput && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
                    {aiOutput}
                  </div>
                )}
              </div>

              {/* Right 5 cols: Live Privacy Scrubber Diff & Telemetry Log */}
              <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 lg:col-span-5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white">
                    <Lock className="h-4 w-4 text-emerald-400" /> Privacy Diff & Routing Telemetry
                  </span>
                  <span className="font-mono text-[11px] text-emerald-400">
                    {verifiedCount}/{rows.length} Penny-Verified
                  </span>
                </div>

                {/* Before vs After Scrubber Proof */}
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px]">
                  <div className="font-semibold text-slate-400">
                    Raw PDF Row (Never leaves local RAM):
                  </div>
                  <div className="mt-1 truncate font-mono text-rose-300">
                    {rows[0]?.date} | {rows[0]?.rawDescription} | Bal: $
                    {rows[0]?.balance?.toFixed(2)}
                  </div>
                  <div className="mt-2 font-semibold text-slate-400">
                    Scrubbed Payload (If cloud fallback is used):
                  </div>
                  <div className="mt-1 truncate font-mono text-emerald-300">
                    &quot;{rows[0]?.scrubbedDescription}&quot; (Balances & IDs stripped)
                  </div>
                </div>

                {/* Live InferenceSource Log */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                    <Activity className="h-3.5 w-3.5" /> Live `response.inferenceSource` Audit Log
                  </div>
                  {telemetryLog.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
                      Click any Hybrid AI button on the left to record live `inferenceSource` &
                      byte-count telemetry.
                    </div>
                  ) : (
                    telemetryLog.map((ev, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[11px]"
                      >
                        <div className="flex items-center justify-between font-mono">
                          <span
                            className={`font-bold ${
                              ev.inferenceSource === 'on_device'
                                ? 'text-emerald-400'
                                : ev.inferenceSource === 'in_cloud'
                                  ? 'text-indigo-400'
                                  : 'text-amber-300'
                            }`}
                          >
                            source: {ev.inferenceSource}
                          </span>
                          <span className="text-slate-400">
                            {ev.latencyMs}ms • {ev.bytesTransmitted} B sent
                          </span>
                        </div>
                        <div className="mt-0.5 text-slate-400">{ev.summary}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Reconciled Table + Unlimited CSV Export (Zero Paywall for Judges!) */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
                <div className="text-xs text-slate-300">
                  <strong className="text-white">{fileName}</strong> • Opening:{' '}
                  <span className="font-mono">${opening?.toFixed(2) ?? '—'}</span> → Closing:{' '}
                  <span className="font-mono text-emerald-400">${closing?.toFixed(2) ?? '—'}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={exportCsv}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" /> Export Reconciled CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setRows([])}
                    className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full min-w-[820px] divide-y divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-950 text-[11px] uppercase text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5">Date</th>
                      <th className="px-3 py-2.5">Raw Description (Local RAM)</th>
                      <th className="px-3 py-2.5 text-right">Debit</th>
                      <th className="px-3 py-2.5 text-right">Credit</th>
                      <th className="px-3 py-2.5 text-right">Balance</th>
                      <th className="px-3 py-2.5">Category</th>
                      <th className="px-3 py-2.5 text-center">Math</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-800/40">
                        <td className="px-3 py-2 font-mono text-slate-300">{r.date}</td>
                        <td className="px-3 py-2 text-slate-100">{r.rawDescription}</td>
                        <td className="px-3 py-2 text-right font-mono text-rose-400">
                          {r.debit ? r.debit.toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-400">
                          {r.credit ? r.credit.toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-200">
                          {r.balance ? r.balance.toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-emerald-300">
                            {r.category}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {r.reconciled && (
                            <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-400" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
