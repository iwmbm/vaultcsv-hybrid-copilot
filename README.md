# VaultCSV Hybrid AI Studio (Web + Chrome MV3 Side-Panel Extension)

Open-source **AI-native financial ledger studio & Chrome Side-Panel Extension** powered by **Firebase AI Logic Hybrid Inference (`firebase/ai` + `firebase/app-check`)** — built for **#BuildHybridAI 2026**.

- **Commercial Flagship (50+ Banks + QuickBooks `.QBO` / `.XLSX`)**: [https://vaultcsv.com](https://vaultcsv.com)

---

## Why Hybrid AI Solves What Regexes Can't

Traditional PDF converters dump raw, cryptic bank strings (`POS DEBIT 4812 SQ *BLUE BTL #041 SAN FRAN`) and fail completely on unstructured SMS/email text or crumpled paper receipts. Meanwhile, accountants refuse to upload sensitive bank account numbers and balances to cloud LLMs.

**VaultCSV Hybrid AI Studio** puts **Firebase AI Logic Hybrid Inference** directly inside the ledger workflow:

1. **✨ 1-Click Magic Vendor & IRS Tax-Rule Enrichment**: Transforms cryptic bank memos inline into human vendor names (`Blue Bottle Coffee`), categories (`Meals & Dining`), recurring SaaS badges, and **IRS Schedule C deductibility rules** (`100% Deductible`, `50% Meals Rule`, or `Non-Deductible Tax Payment` warnings on `IRS EFTPS` rows) — with instant **1-Click Undo**.
2. **3-Way Multimodal & Unstructured Ingestion**:
   - **Bank PDF Statements**: Coordinate-reconstructed 100% locally in RAM (`pdf.js`) with integer-cent running-balance verification (`Prev + Credit - Debit == Balance`).
   - **Messy SMS / Email Bank Text**: Converts raw copy-pasted alerts & unformatted lines directly into structured rows.
   - **Receipt & Invoice Vision Scan**: Extracts vendor, date, amount, and meal/expense deductibility from receipt images via Firebase AI Logic multimodal inference.
3. **Natural-Language Table Command Bar (`⌘K`)**: Mutates and filters the live table directly in plain English (*"Show only recurring SaaS subscriptions"*, *"Flag non-deductible IRS & audit attention items"*, *"Tag all coffee & dining under 50% Meals Rule"*).
4. **Strict Airgap (`ONLY_ON_DEVICE`) vs PII-Scrubbed Hybrid (`PREFER_ON_DEVICE`)**:
   - `InferenceMode.ONLY_ON_DEVICE`: Runs Chrome's built-in **Gemini Nano** locally with **0 bytes transmitted** (works offline).
   - `InferenceMode.PREFER_ON_DEVICE`: Prioritizes on-device Gemini Nano; before any fallback to `gemini-2.5-flash` (protected by **Firebase App Check**), `scrubPii()` strips account numbers, SSNs/EINs, dates, and currency amounts locally in RAM, logging live `response.inferenceSource` and byte counts.
5. **Dual Target Build — Web App + Chrome Manifest V3 Side-Panel Extension**:
   - `npm run build` outputs both the static Web App (`dist/`) and a ready-to-load Chrome Side-Panel Extension (`chrome-extension-dist/`).

---

## Quick Start

```bash
npm install
cp .env.example .env.local # Optional: add VITE_FIREBASE_* keys (or enter at runtime via the top-right Keys button)
npm run dev
```

### Load as Chrome Manifest V3 Side-Panel Extension

```bash
npm run build
# Open chrome://extensions -> Enable Developer mode -> Load unpacked -> select chrome-extension-dist/
```

---

## License

MIT — see [LICENSE](./LICENSE).
