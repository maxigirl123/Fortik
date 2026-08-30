import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cache } from "../services/cache.js";
import { DEFAULT_CACHE_TTL_SECONDS } from "../constants.js";
import { runVerification, normalizeDomain } from "../verifier.js";

const ttlSeconds = parseInt(
  process.env.CACHE_TTL_SECONDS ?? String(DEFAULT_CACHE_TTL_SECONDS),
  10
);

const VerifyStorefrontInputSchema = z.object({
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
