import { fetchWithTimeout } from "./httpClient.js";
import { SAM_GOV_API_URL } from "../constants.js";
import type { SamExclusionResult } from "../types.js";

interface SamGovResponse {
  totalRecords?: number;
  entityData?: unknown[];
}

const NOT_CHECKED: SamExclusionResult = {
  checked: false,
  excluded: null,
  matchCount: null
};

/**
 * Checks the SAM.gov federal exclusions list for a given business name.
 * Excluded entities are debarred or suspended from doing business with the
 * federal government, often due to fraud or serious contract violations —
 * a strong negative signal for any storefront.
 *
 * Requires a free API key from api.sam.gov set as SAM_GOV_API_KEY. Without
 * the key this returns { checked: false, excluded: null, matchCount: null }
 * rather than erroring. Never throws.
 */
export async function getSamExclusion(
  businessName: string
): Promise<SamExclusionResult> {
  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) {
    return NOT_CHECKED;
  }

  try {
    const url = new URL(SAM_GOV_API_URL);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("legalBusinessName", businessName);
    url.searchParams.set("exclusionStatusFlag", "Y");

    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) {
      return NOT_CHECKED;
    }

    const data = (await res.json()) as SamGovResponse;
    const total = data.totalRecords ?? 0;

    return {
      checked: true,
      excluded: total > 0,
      matchCount: total
    };
  } catch {
    return NOT_CHECKED;
  }
}
