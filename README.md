# VaultCSV Hybrid AI Studio (Web + Chrome Side-Panel Extension)

Open-source **Firebase AI Logic Hybrid Inference** companion studio & Chrome MV3 Side-Panel Extension for [VaultCSV](https://vaultcsv.com) — built for **#BuildHybridAI 2026**.

## What It Demonstrates

1. **100% Browser-Local PDF Statement Reconstruction & Penny-Exact Balance Math**: Parses bank statement PDFs locally in RAM via `pdf.js` and verifies `PrevBalance + Credit - Debit == CurrentBalance` in integer cents.
2. **Firebase AI Logic Hybrid Inference (`firebase/ai` + `firebase/app-check`)**:
   - `InferenceMode.ONLY_ON_DEVICE`: Runs Chrome's built-in **Gemini Nano** model locally with **0 bytes transmitted** (even with Wi-Fi physically turned off).
   - `InferenceMode.PREFER_ON_DEVICE` & `PREFER_IN_CLOUD`: Runs deterministic local PII scrubbing (`scrubPii()` in `src/hybridEngine.ts`) to strip account numbers, SSNs, dates, and running balances *before* any cloud fallback to `gemini-2.5-flash`.
   - **Live Telemetry & Provenance Log**: Displays exact `response.inferenceSource` (`on_device` vs `in_cloud`), millisecond latency, and outbound byte count side-by-side with a before/after PII scrubber diff.
3. **Dual Target Build (Web App + Chrome MV3 Side-Panel Extension)**:
   - `npm run build` compiles both the static Web App (`dist/`) and an unpacked Chrome Manifest V3 Side-Panel Extension (`chrome-extension-dist/`).

## Quick Start

```bash
npm install
cp .env.example .env.local # Add your Firebase Web config (or enter at runtime in the UI drawer)
npm run dev
```

### Load as Chrome Side-Panel Extension
```bash
npm run build
# Open chrome://extensions -> Enable Developer Mode -> Load unpacked -> select chrome-extension-dist/
```

## License
MIT — see [LICENSE](./LICENSE). Commercial multi-bank batch edition with `.QBO` / `.XLSX` exports available at [https://vaultcsv.com](https://vaultcsv.com).
