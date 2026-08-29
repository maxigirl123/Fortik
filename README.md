# storefront-guard-mcp-server

Agent-side merchant verification. A shopping agent calls `verify_storefront`
with a domain **before** paying, and gets back a trust score built from
free public data sources.

This is the mirror image of merchant-side agent-verification protocols like
Visa's Trusted Agent Protocol: those let a *merchant* confirm an incoming
*agent* is legitimate. This tool lets the *agent* confirm the *merchant* is
legitimate before committing payment - a gap that, as of this writing, no
major payment network or fraud-prevention vendor has shipped a fix for.

## What v1 actually checks

- **Domain registration age & recent changes** — via free public RDAP
  lookups. A domain registered days ago, or one whose registration data
  changed in the last two weeks, is a red flag.
- **SSL certificate issuance history** — via free public Certificate
  Transparency logs (crt.sh). A cert reissued very recently on an
  otherwise long-established domain can indicate a takeover or hosting
  change, even when the domain itself looks old and trustworthy.
- **HTTPS validity** — does the site currently serve a valid cert at all.
- **Known-scam blocklist** — v1 ships a placeholder local list only. See
  "Before charging real money" below.

Every deduction from the trust score comes with a plain-English reason in
the `reasons` array — this is deliberately an explainable heuristic, not a
black-box model.

## Setup

Requires Node.js 18+ (for native `fetch`).

```bash
npm install
npm run build
```

## Running it

**As a local MCP server (stdio)** — for installing directly into an agent
framework's tool config:
```bash
npm start
```

**As a remote MCP server (streamable HTTP)**:
```bash
npm run start:http
# POST http://localhost:3000/mcp
```

**As a pay-per-call x402 HTTP API**:
```bash
npm run start:x402
# POST http://localhost:4021/verify   { "domain": "example-shop.com" }
```

## Before charging real money on this, do these things

This is a v1 scaffold, not a finished fraud product. Specifically:

1. **Wire the blocklist to a real feed.** `src/services/blocklist.ts`
   defines a `BlocklistProvider` interface with one placeholder
   implementation. Swap in URLhaus, Google Safe Browsing, PhishTank, or a
   licensed dataset — this is the single highest-leverage upgrade.
2. **Wire real x402 payment settlement.** `src/x402Server.ts` has a
   `verifyAndSettlePayment` stub that currently accepts any non-empty
   `X-PAYMENT` header as paid. Replace it with a real call to an x402
   facilitator's verify/settle endpoints before this touches real USDC.
3. **Set your real payout address.** `PAY_TO_ADDRESS` env var — currently
   a placeholder.
4. **Consider a historical snapshot store.** The biggest accuracy upgrade
   beyond v1: store each domain's signals over time so "changed vs. what we
   saw last week" becomes a direct diff instead of an inference from RDAP/
   cert timestamps alone.
5. **Get it in front of real agent traffic.** A perfect scorer nobody calls
   earns nothing — see distribution notes from the product discussion this
   was scoped in.

## How to use the recommendation field

Every verification result includes a top-level `recommendation` string alongside the
numeric `trustScore`. It is the primary action signal — agents should branch on it
rather than implementing their own threshold logic against the raw score.

| Value | Suggested agent behavior |
|---|---|
| `proceed` | Complete the transaction silently. Trust score is in the low-risk range **and** confidence is high — no user confirmation needed. |
| `pause_for_confirmation` | Stop before paying and show `recommendationReason` to the user. This fires when the score is borderline (40–69) **or** when not enough signals could be resolved to be confident in a higher score. The user should decide. |
| `do_not_proceed` | Block the transaction and **actively notify** the user — do not fail silently. This fires on a known-scam domain match or a critically low trust score (< 40). The user should know their agent almost paid a flagged storefront. |

`recommendationReason` is a one-line plain-English explanation that is safe to show
directly to users in a confirmation dialog or notification.

## Pricing starting point

$0.02/call is a reasonable v1 anchor — cheap enough that an agent doesn't
think twice before a purchase of any real size, in the same range as
ForgeMesh's own per-call pricing for comparable signal/attestation tools.
Revisit once you know your actual cost per call for the real blocklist feed.
