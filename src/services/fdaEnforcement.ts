import { fetchWithTimeout } from "./httpClient.js";
import { FDA_API_BASE_URL } from "../constants.js";
import type { FdaEnforcementResult } from "../types.js";

interface FdaResultsMeta {
  total?: number;
}

interface FdaMetaWrapper {
  results?: FdaResultsMeta;
}

interface FdaSuccessResponse {
  meta?: FdaMetaWrapper;
  results?: unknown[];
}

interface FdaErrorBody {
  error?: {
    code?: string;
  };
}

const NOT_CHECKED: FdaEnforcementResult = {
  checked: false,
  hasAction: null,
  totalActions: null
};

/**
 * Fetches a single FDA enforcement endpoint and returns the total record count.
 * A 404 response means zero results (the API returns NOT_FOUND rather than an
 * empty list when nothing matches), so we treat it as total = 0, not an error.
 * All other non-ok responses and network errors return null (lookup failed).
 */
async function queryFdaEndpoint(
  endpoint: string,
  businessName: string
): Promise<number | null> {
  try {
    const url = `${FDA_API_BASE_URL}/${endpoint}/enforcement.json?search=recalling_firm:"${encodeURIComponent(businessName)}"&limit=1`;
    const res = await fetchWithTimeout(url);

    if (res.status === 404) {
      // FDA returns 404 with NOT_FOUND code when the search matches nothing
      const body = (await res.json()) as FdaErrorBody;
      if (body.error?.code === "NOT_FOUND") {
        return 0;
      }
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as FdaSuccessResponse;
    return data.meta?.results?.total ?? 0;
  } catch {
    return null;
  }
}

/**
 * Checks all three FDA enforcement databases (food, drug, device) in parallel
 * for enforcement actions (recalls, warning letters) against a business
 * matching the given name. No API key required.
 *
 * Short names (< 5 characters) are skipped because they produce too many
 * false positives. Returns { checked: false } in that case.
 *
 * Never throws — a failed lookup on any database contributes 0 to the total
 * rather than failing the whole verification.
 */
export async function getFdaEnforcement(
  businessName: string
): Promise<FdaEnforcementResult> {
  // Short/generic names (≤ 7 chars) produce too many false positives —
  // "amazon" matches Amazon Herbs, "target" matches unrelated recall filers, etc.
  if (businessName.length <= 7) {
    return NOT_CHECKED;
  }

  try {
    const [foodTotal, drugTotal, deviceTotal] = await Promise.all([
      queryFdaEndpoint("food", businessName),
      queryFdaEndpoint("drug", businessName),
      queryFdaEndpoint("device", businessName)
    ]);

    // If all three failed (null), mark as unchecked
    if (foodTotal === null && drugTotal === null && deviceTotal === null) {
      return NOT_CHECKED;
    }

    const total =
      (foodTotal ?? 0) + (drugTotal ?? 0) + (deviceTotal ?? 0);

    return {
      checked: true,
      hasAction: total > 0,
      totalActions: total
    };
  } catch {
    return NOT_CHECKED;
  }
}
