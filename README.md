# Fortik

**Real-time merchant verification for agentic commerce.** A shopping agent calls `verify_storefront` with a domain **before** paying, and gets back a trust score with a plain-English verdict the agent can act on — in under two seconds.

Fortik is the trust check AI shopping agents run before checkout. It doesn't ask merchants to register in advance — it gathers evidence directly, in the moment, from independent public sources.

**[fortik.io](https://fortik.io)**

This is the mirror image of merchant-side agent-verification protocols like
Visa's Trusted Agent Protocol: those let a *merchant* confirm an incoming
*agent* is legitimate. Fortik lets the *agent* confirm the *merchant* is
legitimate before committing payment.

## What it checks

- **Domain registration age & recent changes** — via free public RDAP
  lookups. A domain registered days ago, or one whose registration data
  changed in the last two weeks, is a red flag.
- **SSL certificate issuance history** — via free public Certificate
  Transparency logs (crt.sh). A cert reissued very recently on an
  otherwise long-established domain can indicate a takeover or hosting
  change, even when the domain itself looks old and trustworthy.
- **HTTPS validity** — does the site currently serve a valid cert at all.
- **Known-scam blocklist** — URLhaus and Google Safe Browsing.
- **Corporate registration** — US entity lookup via OpenCorporates.
- **Legal name verification** — GLEIF entity registry cross-check.
- **Web traffic rank** — Tranco top-1M ranking.
- **Federal exclusions** — SAM.gov debarment check.
- **FDA enforcement** — corroborating signal when other risks are present.

Every deduction from the trust score comes with a plain-English reason in
the `reasons` array — this is deliberately an explainable heuristic, not a
black-box model.

## Setup

Requires Node.js 18+.

```bash
npm install
npm run build
```

Copy `.env.example` to `.env` and fill in your keys.

## Running it

**As a local MCP server (stdio):**
```bash
npm start
```

**As a remote MCP server (streamable HTTP) with x402 payment:**
```bash
npm run start:http
# POST http://localhost:3000/mcp
```

**As a pay-per-call x402 HTTP API:**
```bash
npm run start:x402
# POST http://localhost:4021/verify   { "domain": "example-shop.com" }
```

**As a REST API (API key auth):**
```bash
npm run start:rest
# POST http://localhost:4022/verify   { "domain": "example-shop.com" }
# Header: X-API-KEY: your-key
```

**All three servers at once:**
```bash
npm run start:all
# MCP:  http://localhost:3000/mcp
# x402: http://localhost:4021/verify
# REST: http://localhost:4022/verify
```

## Feedback endpoint

Submit outcome data after a transaction to help build training data for future ML scoring:

```bash
POST http://localhost:4022/feedback
Header: X-API-KEY: your-key
Body: { "domain": "example-shop.com", "outcome": "legit" | "scam" }
```

## How to use the recommendation field

Every verification result includes a top-level `recommendation` string alongside the
numeric `trustScore`. Agents should branch on it rather than implementing their own
threshold logic against the raw score.

| Value | Suggested agent behavior |
|---|---|
| `proceed` | Complete the transaction silently. Trust score is low-risk with high confidence. |
| `pause_for_confirmation` | Stop before paying and show `recommendationReason` to the user. |
| `do_not_proceed` | Block the transaction and actively notify the user — do not fail silently. |

`recommendationReason` is a one-line plain-English explanation safe to show directly to users.

## Pricing

$0.01/call via x402. Set your wallet address in `PAY_TO_ADDRESS` and network in `X402_NETWORK` (default: `base`).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PAY_TO_ADDRESS` | Yes (x402) | Your wallet address for USDC payments |
| `X402_NETWORK` | No | Blockchain network (default: `base`) |
| `PRICE_USD` | No | Per-call price (default: `0.01`) |
| `API_KEYS` | Yes (REST) | Comma-separated valid API keys |
| `GOOGLE_SAFE_BROWSING_API_KEY` | No | Degrades gracefully if unset |
| `SAM_GOV_API_KEY` | No | Degrades gracefully if unset |
| `URLHAUS_AUTH_KEY` | No | Degrades gracefully if unset |
| `FEEDBACK_LOG` | No | Path for feedback JSONL log (default: `feedback.jsonl`) |
| `MCP_PORT` | No | MCP server port (default: `3000`) |
| `X402_PORT` | No | x402 server port (default: `4021`) |
| `REST_PORT` | No | REST API port (default: `4022`) |
