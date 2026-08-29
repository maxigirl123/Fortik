import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDomainRegistration } from "../services/rdap.js";
import { getCertHistory } from "../services/certTransparency.js";
import { checkHttpsValid } from "../services/httpsCheck.js";
import { UrlhausBlocklist, GoogleSafeBrowsingBlocklist, CompositeBlocklist } from "../services/blocklist.js";
import { getCorporateRecord, getCorporateRecordByName, domainToBusinessName } from "../services/corporateRegistration.js";
import { extractLegalName } from "../services/legalNameExtractor.js";
import { getSamExclusion } from "../services/samGov.js";
import { getFdaEnforcement } from "../services/fdaEnforcement.js";
import { getTrancoRank } from "../services/trancoRank.js";
import { scoreStorefront, computeRecommendation } from "../scoring.js";
import { cache } from "../services/cache.js";
import { ESTABLISHED_DOMAIN_THRESHOLD_DAYS, DEFAULT_CACHE_TTL_SECONDS } from "../constants.js";
import type { StorefrontSignals, VerificationResult, CertHistory } from "../types.js";

const blocklist = new CompositeBlocklist([
  new UrlhausBlocklist(),
  new GoogleSafeBrowsingBlocklist()
]);

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

const VerifyStorefrontInputSchema = z
  .object({
    domain: z
      .string()
      .min(3)
      .max(253)
      .describe(
        "The bare domain of the storefront to verify, e.g. 'example-shop.com'. Strip protocol and path if given a full URL."
      )
  })
  .strict();

type VerifyStorefrontInput = z.infer<typeof VerifyStorefrontInputSchema>;

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

export async function runVerification(
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

export function registerVerifyStorefrontTool(server: McpServer): void {
  server.registerTool(
    "verify_storefront",
    {
      title: "Verify Storefront Legitimacy",
      description: `Checks whether a merchant storefront looks like the same legitimate entity it appeared to be recently, BEFORE an agent commits payment to it.

This is the mirror image of merchant-side agent-verification protocols (e.g. Visa's Trusted Agent Protocol): those let a merchant confirm an incoming agent is legitimate. This tool lets the AGENT confirm the MERCHANT is legitimate before paying.

It does NOT guarantee a storefront is safe - it is a fast, explainable pre-purchase signal built from free public data sources (domain registration history via RDAP, SSL certificate issuance history via Certificate Transparency logs, HTTPS validity, and a known-scam-domain check). Treat a "high" risk result as a strong reason to pause and get human confirmation before paying, and a "low" risk result as one input among others, not a guarantee.

Args:
  - domain (string): the bare domain of the storefront to check, e.g. "example-shop.com"

Returns:
  {
    "domain": string,
    "trustScore": number,       // 0-100, higher = more trustworthy
    "riskLevel": "low" | "medium" | "high" | "unknown",
    "confidence": "low" | "medium" | "high",  // how many signals could actually be resolved
    "reasons": string[],        // human-readable explanation for the score
    "recommendation": "proceed" | "pause_for_confirmation" | "do_not_proceed",
    "recommendationReason": string,  // one-line explanation of why this recommendation was made
    "signals": { ...raw signal data for audit/debugging... },
    "checkedAt": string         // ISO timestamp - this is a point-in-time result, do not cache it
  }

Recommendation values and suggested agent behavior:
  - "proceed": trust score is high with high confidence — complete the transaction silently, no user confirmation needed
  - "pause_for_confirmation": score is borderline or confidence is insufficient — pause and show recommendationReason to the user before completing payment
  - "do_not_proceed": domain matched a scam list or trust score is critically low — block the transaction and actively notify the user (do not fail silently)

Examples:
  - Use when: an agent is about to submit payment to a storefront it found via search or a marketplace listing
  - Use when: comparing several candidate storefronts for the same product before choosing one to buy from
  - Don't use when: verifying a well-known, previously-transacted-with merchant on every single repeat purchase - reserve for new or unfamiliar storefronts, since results are not meant to be cached long-term but also aren't needed for every routine repeat transaction

Error Handling:
  - Never throws - if a data source is unreachable, the affected signal is returned as null and "confidence" drops accordingly rather than failing the call`,
      inputSchema: VerifyStorefrontInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false, // point-in-time result; can legitimately change between calls
        openWorldHint: true
      }
    },
    async ({ domain }: VerifyStorefrontInput) => {
      const normalizedDomain = normalizeDomain(domain);
      const t0 = Date.now();

      const cached = await cache.get(normalizedDomain);
      if (cached) {
        console.error(
          `[storefront-guard] ${normalizedDomain} — cache HIT (${Date.now() - t0}ms)`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `${cached.domain}: trust score ${cached.trustScore}/100 (${cached.riskLevel} risk) — recommendation: ${cached.recommendation} (${cached.recommendationReason})\n${cached.reasons
                .map((r) => `- ${r}`)
                .join("\n")}`
            }
          ],
          structuredContent: cached as unknown as Record<string, unknown>
        };
      }

      const { result, fastPath } = await runVerification(domain);
      await cache.set(normalizedDomain, result, ttlSeconds);
      console.error(
        `[storefront-guard] ${normalizedDomain} — cache MISS, ${fastPath ? "fast path (skipped crt.sh)" : "full path"}, ${Date.now() - t0}ms`
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `${result.domain}: trust score ${result.trustScore}/100 (${result.riskLevel} risk) — recommendation: ${result.recommendation} (${result.recommendationReason})\n${result.reasons
              .map((r) => `- ${r}`)
              .join("\n")}`
          }
        ],
        structuredContent: result as unknown as Record<string, unknown>
      };
    }
  );
}
