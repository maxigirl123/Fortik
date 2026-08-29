import { fetchWithTimeout } from "./httpClient.js";
import { GLEIF_API_URL } from "../constants.js";
import type { CorporateRecord } from "../types.js";

interface GleifCompletion {
  type: string;
  attributes?: {
    value?: string;
  };
  relationships?: {
    "lei-records"?: {
      data?: {
        type: string;
        id: string;
      };
    };
  };
}

interface GleifResponse {
  data?: GleifCompletion[];
}

const NULL_RECORD: CorporateRecord = {
  searched: false,
  found: null,
  activeCount: null,
  topJurisdiction: null
};

/**
 * Derives a human-readable business name from a domain by stripping the TLD
 * and everything after the first dot, then replacing hyphens with spaces.
 * e.g. "shopify.com" → "shopify", "best-buy.com" → "best buy"
 */
export function domainToBusinessName(domain: string): string {
  const withoutPort = domain.split(":")[0];
  const bare = withoutPort.split(".")[0];
  return bare.replace(/-/g, " ");
}

/**
 * Searches the GLEIF (Global Legal Entity Identifier) database for registered
 * legal entities matching the business name. The LEI is an ISO-standard
 * identifier for legal entities participating in financial transactions —
 * presence in GLEIF means the entity is formally registered somewhere.
 *
 * No API key required. Never throws — a failed lookup returns the null-filled
 * result so confidence degrades rather than the whole verification failing.
 */
export async function getCorporateRecord(
  businessName: string
): Promise<CorporateRecord> {
  // Names under 5 chars are too short to produce meaningful matches
  if (businessName.length < 5) {
    return NULL_RECORD;
  }

  try {
    const url = new URL(GLEIF_API_URL);
    url.searchParams.set("field", "entity.legalName");
    url.searchParams.set("q", businessName);

    const res = await fetchWithTimeout(url.toString());

    if (!res.ok) {
      return NULL_RECORD;
    }

    const data = (await res.json()) as GleifResponse;
    const completions = data.data ?? [];

    if (completions.length === 0) {
      return {
        searched: true,
        found: false,
        activeCount: 0,
        topJurisdiction: null
      };
    }

    // Extract the top LEI ID as a jurisdiction proxy — the LEI prefix encodes
    // the issuing Local Operating Unit (LOU) which maps to a jurisdiction.
    const topLeiId =
      completions[0]?.relationships?.["lei-records"]?.data?.id ?? null;

    return {
      searched: true,
      found: true,
      activeCount: completions.length,
      topJurisdiction: topLeiId
    };
  } catch {
    return NULL_RECORD;
  }
}

/**
 * Searches GLEIF using an already-extracted legal name rather than a
 * domain-derived guess. Identical logic to getCorporateRecord but skips
 * domain-to-name conversion. If legalName is under 3 characters, returns the
 * null record immediately — too short to produce meaningful matches.
 */
export async function getCorporateRecordByName(
  legalName: string
): Promise<CorporateRecord> {
  if (legalName.length < 3) {
    return NULL_RECORD;
  }

  try {
    const url = new URL(GLEIF_API_URL);
    url.searchParams.set("field", "entity.legalName");
    url.searchParams.set("q", legalName);

    const res = await fetchWithTimeout(url.toString());

    if (!res.ok) {
      return NULL_RECORD;
    }

    const data = (await res.json()) as GleifResponse;
    const completions = data.data ?? [];

    if (completions.length === 0) {
      return {
        searched: true,
        found: false,
        activeCount: 0,
        topJurisdiction: null
      };
    }

    const topLeiId =
      completions[0]?.relationships?.["lei-records"]?.data?.id ?? null;

    return {
      searched: true,
      found: true,
      activeCount: completions.length,
      topJurisdiction: topLeiId
    };
  } catch {
    return NULL_RECORD;
  }
}
