import express from "express";
import { getDomainRegistration } from "./services/rdap.js";
import { getCertHistory } from "./services/certTransparency.js";
import { checkHttpsValid } from "./services/httpsCheck.js";
import { UrlhausBlocklist } from "./services/blocklist.js";
import { getCorporateRecord, getCorporateRecordByName, domainToBusinessName } from "./services/corporateRegistration.js";
import { extractLegalName } from "./services/legalNameExtractor.js";
import { getSamExclusion } from "./services/samGov.js";
import { getFdaEnforcement } from "./services/fdaEnforcement.js";
import { getTrancoRank } from "./services/trancoRank.js";
import { scoreStorefront, computeRecommendation } from "./scoring.js";
import { fetchWithTimeout } from "./services/httpClient.js";
import { cache } from "./services/cache.js";
import { X402_FACILITATOR_URL, ESTABLISHED_DOMAIN_THRESHOLD_DAYS, DEFAULT_CACHE_TTL_SECONDS } from "./constants.js";
import type { StorefrontSignals, VerificationResult, CertHistory } from "./types.js";

/**
 * Pay-per-call HTTP endpoint implementing the x402 challenge/response shape:
 *   1. Agent calls POST /verify with no payment -> we return 402 with price
 *   2. Agent signs a payment authorization and retries with X-PAYMENT header
 *   3. We verify + settle the payment via the x402 facilitator, then return
 *      the verification result
 */

const PRICE_USD = process.env.PRICE_USD ?? "0.02";
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS ?? "0xYOUR_WALLET_ADDRESS_HERE";
const NETWORK = process.env.X402_NETWORK ?? "base";
const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL ?? X402_FACILITATOR_URL;

const ttlSeconds = parseInt(
  process.env.CACHE_TTL_SECONDS ?? String(DEFAULT_CACHE_TTL_SECONDS),
  10
);

const NULL_CERT_HISTORY: CertHistory = {
  certCount: 0,
  earliestIssuedAt: null,
  mostRecentIssuedAt: null,
  mostRecentIssuer: null,
  reissuedRecently: null
};

const blocklist = new UrlhausBlocklist();

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

async function runVerification(
  domain: string
): Promise<{ result: VerificationResult; fastPath: boolean }> {
  const normalizedDomain = normalizeDomain(domain);
  const businessName = domainToBusinessName(normalizedDomain);

  // Step A: run everything except cert history in parallel
  const [registration, httpsValid, knownScamMatch, corporateRecord, samExclusion, fdaEnforcement, trancoRank] =
    await Promise.all([
      getDomainRegistration(normalizedDomain),
      checkHttpsValid(normalizedDomain),
      blocklist.check(normalizedDomain),
      getCorporateRecord(businessName),
      getSamExclusion(businessName),
      getFdaEnforcement(businessName),
      getTrancoRank(normalizedDomain)
    ]);

  // Step A2: extract legal name from the storefront pages (requires httpsValid from Step A)
  const legalNameExtraction = await extractLegalName(normalizedDomain, httpsValid);

  // Step A3: GLEIF lookup using the extracted legal name; fall back to domain-derived name
  const gleifVerified = await getCorporateRecordByName(
    legalNameExtraction.legalName ?? businessName
  );

  // Step B: conditionally fetch cert history only for established, stable domains
  let certHistory: CertHistory;
  let fastPath: boolean;

  if (
    registration.ageDays !== null &&
    registration.ageDays > ESTABLISHED_DOMAIN_THRESHOLD_DAYS &&
    registration.changedRecently === false
  ) {
    certHistory = await getCertHistory(normalizedDomain);
    fastPath = false;
  } else {
    certHistory = NULL_CERT_HISTORY;
    fastPath = true;
  }

  const signals: StorefrontSignals = {
    domain: normalizedDomain,
    httpsValid,
    registration,
    certHistory,
    knownScamMatch,
    corporateRecord,
    legalNameExtraction,
    gleifVerified,
    samExclusion,
    fdaEnforcement,
    trancoRank
  };

  const { trustScore, riskLevel, confidence, reasons } = scoreStorefront(signals);
  const { recommendation, recommendationReason } = computeRecommendation(
    trustScore,
    confidence,
    knownScamMatch
  );

  const result: VerificationResult = {
    domain: normalizedDomain,
    trustScore,
    riskLevel,
    confidence,
    reasons,
    recommendation,
    recommendationReason,
    signals,
    checkedAt: new Date().toISOString()
  };

  return { result, fastPath };
}

// Shared payment requirements object — reused by build402Challenge() and
// verifyAndSettlePayment() so the facilitator always receives the exact same
// requirements object that was sent in the 402 challenge.
const PAYMENT_REQUIREMENTS = {
  scheme: "exact",
  network: NETWORK,
  maxAmountRequired: `$${PRICE_USD}`,
  payTo: PAY_TO_ADDRESS,
  resource: "/verify",
  description: "Storefront legitimacy pre-purchase check"
} as const;

function build402Challenge() {
  return {
    x402Version: 1,
    accepts: [PAYMENT_REQUIREMENTS]
  };
}

interface FacilitatorVerifyResponse {
  isValid: boolean;
  invalidReason: string | null;
}

interface FacilitatorSettleResponse {
  success: boolean;
  txHash: string;
  networkId: string;
}

/**
 * Verifies the agent's signed payment authorization with the x402 facilitator
 * and, if valid, settles the USDC transfer on-chain.
 *
 * Step 1 — POST to <facilitator>/verify: checks the signed payment header is
 * cryptographically valid and the amount/payee match requirements.
 * Step 2 — POST to <facilitator>/settle: submits the on-chain settlement and
 * returns the transaction hash.
 *
 * Returns { paid: false } on any validation failure or network error so the
 * caller can return 402 rather than propagating a 500.
 */
async function verifyAndSettlePayment(
  paymentHeader: string | undefined
): Promise<{ paid: boolean; txHash?: string }> {
  if (!paymentHeader) {
    return { paid: false };
  }

  const facilitatorBody = {
    x402Version: 1,
    paymentHeader,
    paymentRequirements: PAYMENT_REQUIREMENTS
  };

  try {
    // Step 1: verify
    const verifyRes = await fetchWithTimeout(
      `${FACILITATOR_URL}/verify`,
      undefined,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(facilitatorBody)
      }
    );
    if (!verifyRes.ok) return { paid: false };

    const verifyData = (await verifyRes.json()) as FacilitatorVerifyResponse;
    if (!verifyData.isValid) return { paid: false };

    // Step 2: settle
    const settleRes = await fetchWithTimeout(
      `${FACILITATOR_URL}/settle`,
      undefined,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(facilitatorBody)
      }
    );
    if (!settleRes.ok) return { paid: false };

    const settleData = (await settleRes.json()) as FacilitatorSettleResponse;
    if (!settleData.success) return { paid: false };

    return { paid: true, txHash: settleData.txHash };
  } catch {
    // Network or parse error — return 402, not 500
    return { paid: false };
  }
}

const app = express();
app.use(express.json());

app.post("/verify", async (req, res) => {
  const domain = req.body?.domain as string | undefined;
  if (!domain) {
    res.status(400).json({ error: "Missing required field: domain" });
    return;
  }

  const paymentHeader = req.header("X-PAYMENT");
  const { paid, txHash } = await verifyAndSettlePayment(paymentHeader);

  if (!paid) {
    res.status(402).json(build402Challenge());
    return;
  }

  const normalizedDomain = normalizeDomain(domain);
  const t0 = Date.now();

  const cached = await cache.get(normalizedDomain);
  if (cached) {
    console.error(`[x402] ${normalizedDomain} — cache HIT (${Date.now() - t0}ms)`);
    res.status(200).json({ ...cached, payment: { txHash } });
    return;
  }

  const { result, fastPath } = await runVerification(domain);
  await cache.set(normalizedDomain, result, ttlSeconds);
  console.error(
    `[x402] ${normalizedDomain} — cache MISS, ${fastPath ? "fast path" : "full path"}, ${Date.now() - t0}ms`
  );
  res.status(200).json({ ...result, payment: { txHash } });
});

const port = parseInt(process.env.PORT ?? "4021", 10);
app.listen(port, () => {
  console.error(`storefront-guard x402 API running on :${port}/verify`);
});
