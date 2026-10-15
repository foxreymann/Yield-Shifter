import { chromium } from 'playwright';
import path from 'node:path';
const b = await chromium.launch();
const dir = path.resolve('brand');
let p = await b.newPage({ viewport: { width: 512, height: 512 } });
for (const s of [1024, 512, 256]) { await p.setViewportSize({ width: s, height: s }); await p.goto('file://' + path.resolve('public/icon.svg')); await p.screenshot({ path: `${dir}/icon-${s}.png`, omitBackground: true }); }
p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('file://' + dir + '/thumb.html'); await p.waitForTimeout(800);
await p.screenshot({ path: `${dir}/thumbnail-1280x720.png` });
await b.close();
