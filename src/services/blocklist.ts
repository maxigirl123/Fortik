import { fetchWithTimeout } from "./httpClient.js";
import { URLHAUS_API_URL, GOOGLE_SAFE_BROWSING_API_URL } from "../constants.js";

/**
 * Blocklist provider interface. v1 ships with a tiny local sample list for
 * demonstration only - it is NOT a production fraud data source.
 *
 * Before charging real money against this signal, wire in a real feed, e.g.:
 *   - URLhaus (abuse.ch) - free, real-time malicious URL feed
 *   - Google Safe Browsing API - free tier, requires an API key
 *   - PhishTank - free, community-reported phishing feed
 *   - A licensed commercial scam-domain dataset, for higher recall
 *
 * Keeping this behind an interface means swapping the data source later
 * doesn't touch scoring or tool logic at all.
 */
export interface BlocklistProvider {
  check(domain: string): Promise<boolean>;
}

const SAMPLE_KNOWN_BAD_DOMAINS = new Set<string>([
  // Placeholder entries for local testing only.
  "definitely-not-a-scam-example.test"
]);

export class LocalSampleBlocklist implements BlocklistProvider {
  async check(domain: string): Promise<boolean> {
    return SAMPLE_KNOWN_BAD_DOMAINS.has(domain.toLowerCase());
  }
}

interface UrlhausResponse {
  query_status?: string;
}

interface SafeBrowsingResponse {
  matches?: unknown[];
}

/**
 * Checks a domain against the URLhaus feed (abuse.ch) in real time.
 * Returns true if URLhaus has the domain flagged as a known malicious host
 * (query_status === "is_host"), false in all other cases including errors.
 * Never throws — a failed check degrades to false so overall confidence
 * drops rather than failing the whole tool call.
 *
 * URLhaus requires an Auth-Key header (obtain a free key at https://urlhaus.abuse.ch/).
 * Set the URLHAUS_AUTH_KEY environment variable. Without a valid key the API
 * returns query_status "unknown_auth_key", which this class treats as false
 * (not confirmed malicious) — degrading gracefully rather than erroring out.
 */
export class UrlhausBlocklist implements BlocklistProvider {
  async check(domain: string): Promise<boolean> {
    try {
      const authKey = process.env.URLHAUS_AUTH_KEY;
      const extraHeaders: Record<string, string> = {};
      if (authKey) {
        extraHeaders["Auth-Key"] = authKey;
      }

      const res = await fetchWithTimeout(URLHAUS_API_URL, undefined, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...extraHeaders
        },
        body: `host=${encodeURIComponent(domain)}`
      });

      if (!res.ok) return false;

      const data = (await res.json()) as UrlhausResponse;
      return data.query_status === "is_host";
    } catch {
      return false;
    }
  }
}

/**
 * Checks a domain against Google Safe Browsing (v4 Lookup API).
 * Catches phishing, malware, and unwanted software — broader consumer-fraud
 * coverage than URLhaus alone. Requires GOOGLE_SAFE_BROWSING_API_KEY env var
 * (free tier, obtain at https://developers.google.com/safe-browsing).
 * Degrades gracefully to false if the key is missing or the call fails.
 */
export class GoogleSafeBrowsingBlocklist implements BlocklistProvider {
  async check(domain: string): Promise<boolean> {
    try {
      const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
      if (!apiKey) return false;

      const body = {
        client: { clientId: "storefront-guard", clientVersion: "0.1.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [
            { url: `https://${domain}` },
            { url: `http://${domain}` }
          ]
        }
      };

      const res = await fetchWithTimeout(
        `${GOOGLE_SAFE_BROWSING_API_URL}?key=${apiKey}`,
        undefined,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );

      if (!res.ok) return false;

      const data = (await res.json()) as SafeBrowsingResponse;
      return Array.isArray(data.matches) && data.matches.length > 0;
    } catch {
      return false;
    }
  }
}

/**
 * Runs multiple blocklist providers in parallel and returns true if any match.
 * Adding a new data source is just adding another provider here — scoring and
 * tool logic stay untouched.
 */
export class CompositeBlocklist implements BlocklistProvider {
  constructor(private readonly providers: BlocklistProvider[]) {}

  async check(domain: string): Promise<boolean> {
    const results = await Promise.all(this.providers.map((p) => p.check(domain)));
    return results.some(Boolean);
  }
}
