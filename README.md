# YieldShifter

**Track: Agents that spend.** An autonomous yield agent that puts idle stablecoins to work on [Merkl](https://app.merkl.xyz/). It moves every dollar through **Stripe test mode** inside a written policy and explains why each move happened.

## What does it do?

YieldShifter manages a 1,000 USDC balance for you (a demo balance):

1. **On first run it writes your policy.** It asks for your risk profile: **High** or **Very high**. There is no "low", because DeFi is never low risk. It then asks whether you want **stables only** or will **allow crypto exposure up to X%**.
2. **It shows the UK risk warning before anything moves.** *"Don't invest unless you're prepared to lose all the money you invest."* Every position can go to zero, stablecoins can de-peg and DeFi protocols are often hacked. You must tick an explicit acknowledgement.
3. **Your answers become a written policy**, saved to `data/policy.json`. It sets minimum TVL, a per-position cap, the allowed actions (lend / hold / pool), a "too good to be true" APR ceiling, no borrowing ever, no tokenised equities, verified tokens only and a rebalance threshold. The agent never asks again.
4. **It finds the best yields for your profile.** It scans ~300 **live** Merkl opportunities (TVL ≥ $1M) in real time and screens each one against the policy. Every rejection gets a logged reason (for example "TVL $1.4M below $2M minimum" or "Unverified token").
5. **It moves your funds on its own.** It builds a diversified allocation (crypto sized to your cap, at most one position per protocol) and executes it **without asking**, because the plan is within policy. Each deposit is a **Stripe test-mode PaymentIntent**. Its metadata carries the Merkl opportunity id, protocol, chain, APR, TVL, risk profile and the plain-English reason.
6. **It rebalances to keep the yield optimal.** On each check, if a Merkl campaign winds down and a position's APR falls, the agent finds a better opportunity that passes policy and beats the +1pp threshold. It **refunds** the old position through Stripe and opens a new PaymentIntent, with the reason attached.
7. **It explains every pound.** Every policy change, scan and money movement goes to `data/audit.jsonl`, with the Stripe object id and the reason, and appears live in the UI.

## How it maps to the judging

| Criterion | How |
|---|---|
| Works end to end | Live Merkl API data, real Stripe test-mode PaymentIntents and Refunds |
| Autonomy with control | Explicit written policy plus guardrails. The agent acts without approval only inside the policy |
| Explains every pound | Reason on every Stripe object (metadata) and an append-only audit log |
| Product & creativity | A risk-first onboarding with the FCA-style warning, and APR-decay rebalancing |

## Run it

```bash
export STRIPE_SECRET_KEY=sk_test_...   # test mode only; the server refuses live keys
npm start                              # http://localhost:4242
```

Without a key it runs with simulated Stripe ids, clearly labelled.

### Regenerate the demo video

```bash
npm i                     # playwright
export ELEVEN=...         # ElevenLabs API key (narration, voice "George")
export STRIPE_SECRET_KEY=sk_test_...
npm run demo              # -> out/yieldshifter-demo.mp4
```

`scripts/voiceover.json` holds the narration script. `scripts/record.mjs` drives the real UI in Chromium and logs when each narration line should start. `scripts/build-video.sh` mixes the two together.

## Stack

Node (no runtime deps) · Merkl API v4 · Stripe REST API (test mode) · ElevenLabs TTS · Playwright + ffmpeg for the video.

*Not financial advice. Demo with a fake balance; no real money moves.*
