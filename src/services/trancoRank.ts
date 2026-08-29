import { fetchWithTimeout } from "./httpClient.js";
import { TRANCO_API_URL } from "../constants.js";
import type { TrancoRankResult } from "../types.js";

interface TrancoEntry {
  date: string;
  rank: number;
}

interface TrancoResponse {
  domain?: string;
  ranks?: TrancoEntry[];
}

const NOT_CHECKED: TrancoRankResult = {
  checked: false,
  ranked: null,
  rank: null
};

/**
 * Looks up a domain's rank in the Tranco top-1M list, a research-grade
 * traffic ranking that aggregates Alexa, Umbrella, Majestic, and Quantcast.
 * A ranked domain has meaningful real-world web traffic; absence from the
 * list is neutral (not a negative signal — many legitimate small businesses
 * won't crack the top 1M). No API key required.
 *
 * Returns the most recent rank entry. Never throws.
 */
export async function getTrancoRank(domain: string): Promise<TrancoRankResult> {
  try {
    const res = await fetchWithTimeout(`${TRANCO_API_URL}/${encodeURIComponent(domain)}`);

    // 404 = domain not in the list — neutral, not an error
    if (res.status === 404) {
      return { checked: true, ranked: false, rank: null };
    }

    if (!res.ok) {
      return NOT_CHECKED;
    }

    const data = (await res.json()) as TrancoResponse;
    const ranks = data.ranks ?? [];

    if (ranks.length === 0) {
      return { checked: true, ranked: false, rank: null };
    }

    // Ranks are returned newest-first; take the most recent entry
    const mostRecent = ranks.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )[0];

    return {
      checked: true,
      ranked: true,
      rank: mostRecent.rank
    };
  } catch {
    return NOT_CHECKED;
  }
}
