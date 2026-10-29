// The Reels tab's contact sheet (docs/scroll-together.png) from the e2e flow's screenshots:
//   E2E_SHOTS=/tmp/shots node test/e2e/run.mjs --until="reels tab" && node scripts/contact-sheet.mjs /tmp/shots docs/scroll-together.png
import { createRequire } from 'node:module'; const { chromium } = createRequire(new URL('../', import.meta.url).pathname)('playwright');
import fs from 'node:fs';
const dir = process.argv[2]; const out = process.argv[3];
const img = (n) => `data:image/png;base64,${fs.readFileSync(`${dir}/${n}.png`).toString('base64')}`;
const fig = (n, cap, cls) => `<figure class="${cls}"><img src="${img(n)}"><figcaption>${cap}</figcaption></figure>`;
const html = `<!doctype html><html><body style="margin:0;background:#0d0c13;color:#ede9f5;font:15px system-ui,sans-serif;padding:24px;width:1452px;box-sizing:border-box">
<style>figure{margin:0}figcaption{margin-top:6px;font-size:13px;color:#b9b2c9}img{display:block;border-radius:10px;border:1px solid #2a2635}
.d img{width:692px}.p img{width:210px}.row{display:flex;gap:20px;margin-bottom:20px;align-items:flex-start}</style>
<h2 style="margin:0 0 4px">Hearth · Reels tab and scroll together</h2><p style="margin:0 0 18px;color:#b9b2c9">Stand-in players (the e2e test's fake TikTok and Instagram pages); desktop 1400×900 and a 390×844 phone.</p>
<div class="row">${fig('desktop-cover', 'Desktop: before the first tap ("Load when I tap")', 'd')}${fig('desktop-together', 'Desktop: scrolling together, who swiped', 'd')}</div>
<div class="row">${fig('desktop-reel', 'Desktop: an Instagram reel, ready check and countdown', 'd')}
${fig('phone-cover', 'Phone: full screen, before the tap', 'p')}${fig('phone-video', 'Phone: a TikTok, muted until a tap', 'p')}${fig('phone-add', 'Phone: + Add a link', 'p')}</div></body></html>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1452, height: 900 } });
await p.setContent(html); await p.screenshot({ path: out, fullPage: true }); await b.close();
