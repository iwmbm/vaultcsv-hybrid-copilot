import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const pub = path.join(root, 'public');

fs.mkdirSync(pub, { recursive: true });
fs.copyFileSync(src, path.join(pub, 'pdf.worker.min.mjs'));

// Copy sample PDFs & brand favicon from sibling vaultcsv workspace if available
const siblingPub = path.resolve(root, '..', 'vaultcsv', 'public');
if (fs.existsSync(path.join(siblingPub, 'favicon.svg'))) {
  fs.copyFileSync(path.join(siblingPub, 'favicon.svg'), path.join(pub, 'favicon.svg'));
}
if (fs.existsSync(path.join(siblingPub, 'favicon-48x48.png'))) {
  fs.copyFileSync(path.join(siblingPub, 'favicon-48x48.png'), path.join(pub, 'icon-48.png'));
}
if (fs.existsSync(path.join(siblingPub, 'icon-192.png'))) {
  fs.copyFileSync(path.join(siblingPub, 'icon-192.png'), path.join(pub, 'icon-128.png'));
}
const samplesSrc = path.join(siblingPub, 'samples');
const samplesDest = path.join(pub, 'samples');
if (fs.existsSync(samplesSrc)) {
  fs.mkdirSync(samplesDest, { recursive: true });
  for (const f of fs.readdirSync(samplesSrc)) {
    if (f.endsWith('.pdf')) {
      fs.copyFileSync(path.join(samplesSrc, f), path.join(samplesDest, f));
    }
  }
}
console.log('Prepared public/ assets and local pdf.worker.min.mjs');
