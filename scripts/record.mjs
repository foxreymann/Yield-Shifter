// Drives the real agent UI in Chromium, records video, and logs when each narration clip should start.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://localhost:4242';
const W = 1280, H = 720;
const dur = (id) => Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 out/voice/${id}.mp3`)) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await fetch(`${BASE}/api/reset`, { method: 'POST' });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: 'out/raw', size: { width: W, height: H } } });
const t0 = Date.now();
const page = await ctx.newPage();
const timeline = [];
const say = (id) => { timeline.push({ id, at: Date.now() - t0 }); return sleep(dur(id)); };
const ev = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`${BASE}/?demo`);
await ev(() => demo.title(true));
await page.waitForTimeout(1200);

await say('s1_intro'); await sleep(300);
await ev(() => { demo.title(false); startAgent(); });

await page.waitForSelector('#risk-very_high');
let a = say('s2_risk');
await sleep(3500); await ev(() => demo.moveTo('#risk-high'));
await sleep(1200); await ev(() => demo.moveTo('#risk-very_high'));
await a; await ev(() => demo.click('#risk-very_high'));

await page.waitForSelector('#allowCrypto');
a = say('s3_exposure');
await sleep(1500); await ev(() => demo.moveTo('#stables'));
await sleep(900); await ev(() => demo.moveTo('#cap'));
await a; await ev(() => demo.click('#allowCrypto'));

await page.waitForSelector('#ack');
a = say('s4_warning');
await sleep(dur('s4_warning') - 2600); await ev(() => demo.click('#ack'));
await a; await ev(() => demo.click('#accept'));

await page.waitForFunction(() => document.querySelector('#policyFile').textContent);
await sleep(1500);
a = say('s5_policy');
await sleep(1500); await ev(() => demo.moveTo('#policy'));
await a; await ev(() => release('scan'));

a = say('s6_scan');
await a; await page.waitForFunction(() => release('execute'));

a = say('s7_execute');
await sleep(4000); await ev(() => demo.moveTo('#positions'));
await a; await page.waitForFunction(() => window.__investDone); await sleep(800);

await page.waitForFunction(() => release('rebalance'));
a = say('s8_rebalance');
await a; await page.waitForFunction(() => window.__rebalanceDone); await sleep(600);

a = say('s9_audit');
await ev(() => { document.querySelector('#audit').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
await sleep(800); await ev(() => demo.moveTo('#audit'));
await sleep(dur('s9_audit') - 2400); await ev(() => demo.title(true));
await a; await sleep(2200);

const total = Date.now() - t0;
const video = page.video();
await ctx.close(); await browser.close();
fs.copyFileSync(await video.path(), 'out/raw.webm');
fs.writeFileSync('out/timeline.json', JSON.stringify({ total, timeline }, null, 2));
console.log('recorded', (total / 1000).toFixed(1) + 's', timeline);
