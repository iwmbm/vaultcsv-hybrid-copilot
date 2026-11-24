import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const extDir = path.join(root, 'chrome-extension-dist');

fs.rmSync(extDir, { recursive: true, force: true });
fs.cpSync(dist, extDir, { recursive: true });

const manifest = {
  manifest_version: 3,
  name: 'VaultCSV Hybrid AI Financial Copilot',
  version: '1.0.0',
  description:
    'Audit bank statement PDFs locally with penny-exact math and Firebase AI Logic Hybrid Inference (Gemini Nano on-device + PII-scrubbed fallback).',
  icons: {
    '48': 'icon-48.png',
    '128': 'icon-128.png',
  },
  action: {
    default_title: 'Open VaultCSV Hybrid Copilot',
  },
  side_panel: {
    default_path: 'index.html',
  },
  permissions: ['sidePanel'],
  background: {
    service_worker: 'sw.js',
  },
};

fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  path.join(extDir, 'sw.js'),
  `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});\n`
);

console.log('Packaged Chrome MV3 Side-Panel Extension -> chrome-extension-dist/');
