// YieldShifter — an autonomous yield agent with a written policy.
// Live data: Merkl API. Money movement: Stripe test mode. Audit: data/audit.jsonl
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 4242;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DATA = path.join(ROOT, 'data');
const POLICY_FILE = path.join(DATA, 'policy.json');
const AUDIT_FILE = path.join(DATA, 'audit.jsonl');
const STARTING_BALANCE = 1000; // fake USDC balance for the demo
fs.mkdirSync(DATA, { recursive: true });

if (STRIPE_KEY && !STRIPE_KEY.startsWith('sk_test_')) {
  console.error('Refusing to start: STRIPE_SECRET_KEY must be a test-mode key (sk_test_...)');
  process.exit(1);
}

const CHAINS = { 1: 'Ethereum', 10: 'Optimism', 137: 'Polygon', 143: 'Monad', 480: 'World Chain', 999: 'HyperEVM', 4: 'Ethereum', 8453: 'Base', 9745: 'Plasma', 42161: 'Arbitrum', 1672: 'Pharos', 5042: 'Arc', 56: 'BNB', 146: 'Sonic', 43114: 'Avalanche' };

// ---------- Policy ----------
// Risk profiles deliberately start at "High": DeFi is never low risk.
const PROFILES = {
  high: { label: 'High', minTvl: 10_000_000, maxApr: 15, maxPerPosition: 0.4, actions: ['LEND', 'HOLD'], maxPositions: 3 },
  very_high: { label: 'Very high', minTvl: 2_000_000, maxApr: 60, maxPerPosition: 0.5, actions: ['LEND', 'HOLD', 'POOL'], maxPositions: 3 },
};

function buildPolicy({ risk, cryptoCapPct }) {
  const p = PROFILES[risk];
  if (!p) throw new Error('unknown risk profile');
  const cap = Math.max(0, Math.min(100, Number(cryptoCapPct) || 0));
  return {
    risk, riskLabel: p.label,
    stablesOnly: cap === 0,
    cryptoCapPct: cap,
    minTvlUsd: p.minTvl,
    maxAprPct: p.maxApr,
    maxPerPositionPct: p.maxPerPosition * 100,
    allowedActions: p.actions,
    maxPositions: p.maxPositions,
    rebalanceThresholdPct: 1.0, // only move if APR improves by >= 1 percentage point
    neverBorrow: true,
    requireVerifiedTokens: true,
    disclosureAcceptedAt: new Date().toISOString(),
  };
}

const readPolicy = () => (fs.existsSync(POLICY_FILE) ? JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) : null);

// ---------- Audit trail ----------
function audit(event) {
  const row = { ts: new Date().toISOString(), id: crypto.randomUUID().slice(0, 8), ...event };
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(row) + '\n');
  return row;
}
const readAudit = () => (fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);

// ---------- Merkl ----------
let cache = { at: 0, opps: [] };
async function fetchMerkl() {
  if (Date.now() - cache.at < 5 * 60_000 && cache.opps.length) return cache.opps;
  const pages = await Promise.all([0, 1, 2, 3, 4].map(async (page) => {
    const r = await fetch(`https://api.merkl.xyz/v4/opportunities?status=LIVE&items=100&page=${page}&minimumTvl=1000000&sort=tvl&order=desc`);
    return r.ok ? r.json() : [];
  }));
  const seen = new Set();
  cache = { at: Date.now(), opps: pages.flat().filter((o) => !seen.has(o.id) && seen.add(o.id)) };
  return cache.opps;
}

// stable = pegged to ~$1, or a yield-bearing USD wrapper (price drifts above $1 as yield accrues)
const isStableToken = (t) => typeof t.price === 'number' && ((t.price > 0.985 && t.price < 1.015) || (/USD|GHO|DAI/i.test(t.symbol) && t.price > 0.985 && t.price < 1.3));

function classify(o) {
  const tokens = (o.tokens || []).filter((t) => t.type !== 'PROTOCOL' );
  const underlying = tokens.filter((t) => !/^(PT-|SY-|PLP-|YT-)/.test(t.symbol));
  const stable = underlying.length > 0 && underlying.every(isStableToken);
  return {
    id: o.id,
    name: o.name,
    protocol: o.protocol?.name || o.mainProtocol || o.type,
    chain: CHAINS[o.chainId] || `Chain ${o.chainId}`,
    action: o.action,
    apr: Number(o.apr || 0),
    tvl: Number(o.tvl || 0),
    tokens: tokens.map((t) => t.symbol),
    verified: tokens.every((t) => t.verified !== false),
    stable,
    url: `https://app.merkl.xyz/opportunities/${(o.chain?.name || CHAINS[o.chainId] || '').toLowerCase()}/${o.type}/${o.identifier}`,
  };
}

function screen(opps, policy) {
  const accepted = [], rejected = [];
  for (const raw of opps) {
    const o = classify(raw);
    let reason = null;
    if (/stock|equit|xstock|mag7/i.test(o.name + o.tokens.join(' '))) reason = 'Tokenised equities are outside a crypto-yield mandate';
    else if (o.action === 'BORROW') reason = 'Borrowing is forbidden by policy';
    else if (!policy.allowedActions.includes(o.action)) reason = `${o.action} not allowed at ${policy.riskLabel} risk`;
    else if (o.apr <= 0.5) reason = 'No meaningful live yield';
    else if (o.tvl < policy.minTvlUsd) reason = `TVL $${(o.tvl / 1e6).toFixed(1)}M below $${policy.minTvlUsd / 1e6}M minimum`;
    else if (o.apr > policy.maxAprPct) reason = `${o.apr.toFixed(1)}% APR exceeds ${policy.maxAprPct}% "too good to be true" ceiling`;
    else if (policy.requireVerifiedTokens && !o.verified) reason = 'Unverified token';
    else if (!o.stable && policy.stablesOnly) reason = `Crypto exposure (${o.tokens.join('/')}) — policy is stables only`;
    (reason ? rejected : accepted).push(reason ? { ...o, reason } : o);
  }
  accepted.sort((a, b) => b.apr - a.apr);
  return { accepted, rejected };
}

function allocate(accepted, policy, balance) {
  const picks = [];
  let cryptoUsed = 0;
  const cryptoBudget = (policy.cryptoCapPct / 100) * balance;
  const perCap = (policy.maxPerPositionPct / 100) * balance;
  const usedProtocols = new Set();
  // one crypto position (if allowed) + best stable positions, diversified by protocol
  const crypto = accepted.find((o) => !o.stable);
  if (crypto && cryptoBudget > 0) {
    const amt = Math.min(cryptoBudget, perCap);
    picks.push({ ...crypto, amount: amt, why: `Best crypto-exposed yield; sized to ${policy.cryptoCapPct}% crypto cap` });
    cryptoUsed += amt; usedProtocols.add(crypto.protocol);
  }
  let remaining = balance - cryptoUsed;
  for (const o of accepted.filter((x) => x.stable)) {
    if (picks.length >= policy.maxPositions + (crypto && cryptoBudget > 0 ? 1 : 0) || remaining < 1) break;
    if (usedProtocols.has(o.protocol + o.chain)) continue;
    const amt = Math.min(perCap, remaining);
    picks.push({ ...o, amount: amt, why: `Top stable APR passing policy; capped at ${policy.maxPerPositionPct}% per position` });
    usedProtocols.add(o.protocol + o.chain);
    remaining -= amt;
  }
  return picks.map((p) => ({ ...p, amount: Math.round(p.amount * 100) / 100 }));
}

// ---------- Stripe (test mode) ----------
async function stripe(pathname, params) {
  if (!STRIPE_KEY) {
    // no key: simulated object, clearly marked
    return { id: (pathname.includes('refund') ? 're_sim_' : 'pi_sim_') + crypto.randomBytes(8).toString('hex'), simulated: true, status: 'succeeded' };
  }
  const body = new URLSearchParams();
  const flat = (obj, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v && typeof v === 'object') flat(v, key); else body.append(key, String(v));
    }
  };
  flat(params);
  const r = await fetch(`https://api.stripe.com/v1/${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': crypto.randomUUID() },
    body,
  });
  const j = await r.json();
  if (j.error) throw new Error(`Stripe: ${j.error.message}`);
  return j;
}

async function moveFunds(pick, policy, kind = 'allocate') {
  const cents = Math.round(pick.amount * 100);
  const pi = await stripe('payment_intents', {
    amount: cents, currency: 'usd',
    payment_method: 'pm_card_visa', confirm: 'true',
    automatic_payment_methods: { enabled: 'true', allow_redirects: 'never' },
    description: `YieldShifter ${kind}: ${pick.amount} USDC -> ${pick.name}`.slice(0, 350),
    metadata: {
      agent: 'yieldshifter', kind, merkl_opportunity: pick.id, protocol: pick.protocol, chain: pick.chain,
      apr_pct: pick.apr.toFixed(2), tvl_usd: Math.round(pick.tvl), risk_profile: policy.riskLabel,
      reason: pick.why.slice(0, 450),
    },
  });
  return audit({ type: 'MOVE', kind, amount: pick.amount, to: pick.name, protocol: pick.protocol, chain: pick.chain, apr: pick.apr, merkl: pick.url, reason: pick.why, stripe: pi.id, simulated: !!pi.simulated });
}

async function withdraw(pos, reason) {
  const re = await stripe('refunds', { payment_intent: pos.stripe, metadata: { agent: 'yieldshifter', kind: 'withdraw', reason: reason.slice(0, 450) } });
  return audit({ type: 'MOVE', kind: 'withdraw', amount: pos.amount, from: pos.to, protocol: pos.protocol, reason, stripe: re.id, simulated: !!re.simulated });
}

// ---------- HTTP ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b ? JSON.parse(b) : {})); });
let positions = [];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/state') return json(res, 200, { policy: readPolicy(), stripeMode: STRIPE_KEY ? 'test' : 'simulated', balance: STARTING_BALANCE, positions });
    if (url.pathname === '/api/reset' && req.method === 'POST') { for (const f of [POLICY_FILE, AUDIT_FILE]) fs.rmSync(f, { force: true }); positions = []; return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/policy' && req.method === 'POST') {
      const policy = buildPolicy(await readBody(req));
      fs.writeFileSync(POLICY_FILE, JSON.stringify(policy, null, 2));
      audit({ type: 'POLICY', policy, reason: 'User completed onboarding and accepted UK crypto risk disclosure' });
      return json(res, 200, policy);
    }
    if (url.pathname === '/api/scan') {
      const policy = readPolicy();
      const opps = await fetchMerkl();
      const { accepted, rejected } = screen(opps, policy);
      const plan = allocate(accepted, policy, STARTING_BALANCE);
      audit({ type: 'SCAN', scanned: opps.length, accepted: accepted.length, rejected: rejected.length, reason: `Screened live Merkl opportunities against ${policy.riskLabel} risk policy` });
      return json(res, 200, { scanned: opps.length, accepted: accepted.slice(0, 12), rejected: rejected.filter((r) => r.apr > 5).sort((a, b) => b.apr - a.apr).slice(0, 8), plan });
    }
    if (url.pathname === '/api/execute' && req.method === 'POST') {
      const { plan } = await readBody(req);
      const policy = readPolicy();
      positions = [];
      for (const p of plan) positions.push({ ...(await moveFunds(p, policy)), id: p.id, tvl: p.tvl });
      return json(res, 200, { positions });
    }
    if (url.pathname === '/api/rebalance' && req.method === 'POST') {
      // Re-check yields. `simulateDropId` lets the demo fast-forward a week of APR decay.
      const { simulateDropId, dropTo } = await readBody(req);
      const policy = readPolicy();
      const { accepted } = screen(await fetchMerkl(), policy);
      const held = new Set(positions.map((p) => p.id));
      const pos = positions.find((p) => p.id === simulateDropId) || positions[positions.length - 1];
      const currentApr = dropTo ?? pos.apr;
      const better = accepted.find((o) => o.stable === true && !held.has(o.id) && o.apr - currentApr >= policy.rebalanceThresholdPct);
      if (!better) return json(res, 200, { moved: false, reason: 'No alternative beats threshold' });
      const reason = `APR on ${pos.to} fell from ${pos.apr.toFixed(1)}% to ${currentApr.toFixed(1)}%. ${better.name} pays ${better.apr.toFixed(1)}% (+${(better.apr - currentApr).toFixed(1)}pp > ${policy.rebalanceThresholdPct}pp threshold), passes all policy checks`;
      const w = await withdraw(pos, reason);
      const m = await moveFunds({ ...better, amount: pos.amount, why: reason }, policy, 'rebalance');
      positions = positions.filter((p) => p !== pos).concat({ ...m, id: better.id, tvl: better.tvl });
      return json(res, 200, { moved: true, from: { ...pos, apr: currentApr }, to: better, withdraw: w, deposit: m, reason, positions });
    }
    if (url.pathname === '/api/audit') return json(res, 200, readAudit());
    // static
    const file = path.join(ROOT, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e); json(res, 500, { error: e.message });
  }
});
server.listen(PORT, () => console.log(`YieldShifter on http://localhost:${PORT}  (Stripe: ${STRIPE_KEY ? 'TEST MODE' : 'simulated — set STRIPE_SECRET_KEY=sk_test_...'})`));
