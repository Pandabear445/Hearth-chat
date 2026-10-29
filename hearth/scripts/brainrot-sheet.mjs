// Brainrot mode's contact sheet (docs/brainrot.png) from the e2e flow's screenshots:
//   E2E_SHOTS=/tmp/shots node test/e2e/run.mjs --until="brainrot" && node scripts/brainrot-sheet.mjs /tmp/shots docs/brainrot.png
// Drawn at 0.76 scale, which keeps the PNG well under 1 MB.
import { createRequire } from 'node:module'; const { chromium } = createRequire(new URL('../', import.meta.url).pathname)('playwright');
import fs from 'node:fs';
const dir = process.argv[2]; const out = process.argv[3];
const img = (n) => `data:image/png;base64,${fs.readFileSync(`${dir}/br-${n}.png`).toString('base64')}`;
const fig = (n, cap, cls) => `<figure class="${cls}"><img src="${img(n)}"><figcaption>${cap}</figcaption></figure>`;
const html = `<!doctype html><html><body style="margin:0;background:#0d0c13;color:#ede9f5;font:15px system-ui,sans-serif;padding:24px;width:1452px;box-sizing:border-box">
<style>figure{margin:0}figcaption{margin-top:6px;font-size:13px;color:#b9b2c9}img{display:block;border-radius:10px;border:1px solid #2a2635}
.d img{width:692px}.p img{width:200px}.row{display:flex;gap:20px;margin-bottom:20px;align-items:flex-start}</style>
<h2 style="margin:0 0 4px">Hearth · Brainrot mode</h2><p style="margin:0 0 18px;color:#b9b2c9">Original gameplay drawn in code (Block Parkour, Rail Runner) under the content; stand-in TikTok players (the e2e test's fake pages); desktop 1400×900 and a 390×844 phone.</p>
<div class="row">${fig('desktop-reels', 'Reels tab, desktop (member list open, so below): Rail Runner, stimulation 3', 'd')}${fig('desktop-together', 'Scrolling together: turned on for everyone, Bob joined in', 'd')}</div>
<div class="row">${fig('desktop-watch', 'Watch together on a wide screen: gameplay beside the shared video, its title as captions', 'd')}${fig('phone-parkour', 'Phone: 50/50, Block Parkour', 'p')}${fig('phone-runner', 'Phone: Rail Runner', 'p')}</div>
<div class="row">${fig('desktop-call', 'A call: gameplay under the tiles', 'd')}</div></body></html>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1452, height: 900 }, deviceScaleFactor: 0.76 });
await p.setContent(html); await p.screenshot({ path: out, fullPage: true }); await b.close();
console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
