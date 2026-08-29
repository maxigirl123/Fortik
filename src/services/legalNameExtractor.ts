import { fetchWithTimeout } from "./httpClient.js";
import type { LegalNameExtraction } from "../types.js";

const PAGE_FETCH_TIMEOUT_MS = 4000;

const NULL_NOT_ATTEMPTED: LegalNameExtraction = {
  attempted: false,
  legalName: null,
  legalNameWithSuffix: null,
  source: null,
  noDisclosure: false
};

const NULL_NO_DISCLOSURE: LegalNameExtraction = {
  attempted: true,
  legalName: null,
  legalNameWithSuffix: null,
  source: null,
  noDisclosure: true
};

/**
 * Strips HTML tags from raw HTML, collapsing whitespace so regex patterns can
 * run cleanly against the visible text.
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

/**
 * Extracts the footer/bottom-of-page section from raw HTML. Returns the last
 * 25% of the body text plus any content inside <footer> tags, so copyright
 * notices buried at the bottom of long pages are still captured.
 */
function extractFooterRegion(html: string): string {
  const parts: string[] = [];

  // Grab everything inside <footer>...</footer> tags (case-insensitive)
  const footerTagRe = /<footer[\s>][\s\S]*?<\/footer>/gi;
  let m: RegExpExecArray | null;
  while ((m = footerTagRe.exec(html)) !== null) {
    parts.push(m[0]);
  }

  // Also take the last 25% of the raw HTML body
  const tail = html.slice(Math.floor(html.length * 0.75));
  parts.push(tail);

  return parts.join(" ");
}

interface ExtractionMatch {
  legalName: string;
  legalNameWithSuffix: string;
}

// Legal suffix words that should never be treated as a company name on their own.
const LEGAL_SUFFIX_TERMS = new Set([
  "inc", "llc", "ltd", "corp", "co", "lp", "llp", "gmbh", "plc", "bv",
  "incorporated", "limited", "corporation", "company"
]);

/**
 * Runs the three structured regex patterns against stripped plain text.
 * Returns the first match found, or null if none fire.
 */
function runPatterns(text: string): ExtractionMatch | null {
  // Pattern 1 — copyright line (most reliable)
  // Dot is intentionally excluded from the name char class so that "Inc." or
  // "Ltd." are never absorbed into the name group.
  const copyrightRe =
    /(?:©|(?:copyright)\s*©?)\s*(?:\d{4}[-–]\d{2,4}\s+|(?:\d{4},?\s+)+)?([A-Z][A-Za-z0-9\s&',\-]{2,60}?)\s*(Inc\.?|LLC\.?|Ltd\.?|Corp\.?|Co\.?|L\.P\.?|LLP\.?|GmbH|PLC|B\.V\.)/gi;

  // Pattern 1: try all matches and return first valid one.
  // The 'i' flag makes [A-Z] match lowercase — we post-filter with /^[A-Z]/.
  let match = copyrightRe.exec(text);
  while (match !== null) {
    const rawName = (match[1] ?? "").trim().replace(/^[^A-Za-z]+/, "");
    const suffix = (match[2] ?? "").trim();
    const normalizedName = rawName.toLowerCase().replace(/\./g, "");
    if (
      rawName.length >= 3 &&
      rawName.split(/\s+/).length <= 5 &&
      /^[A-Z]/.test(rawName) &&
      !LEGAL_SUFFIX_TERMS.has(normalizedName)
    ) {
      return {
        legalName: rawName,
        legalNameWithSuffix: `${rawName} ${suffix}`.trim()
      };
    }
    match = copyrightRe.exec(text);
  }

  // Pattern 2 — "a [State/Type] corporation/company" formation clause.
  // Left-anchored to sentence boundaries (start of line or ". ") with the 'm'
  // flag. The 'i' flag makes terminal keywords case-insensitive but also lets
  // [A-Z] match lowercase — we correct via /^[A-Z]/ post-filter. Word count
  // cap (≤5) prevents capturing prose phrases like "Forum United States or
  // Canada Shopify Inc, a corporation" when a long clause precedes the name.
  const formationRe =
    /(?:^|\.\s+)([A-Z][A-Za-z0-9\s&',]{2,60}?),?\s+a\s+(?:[A-Za-z]+\s+)?(?:corporation|company|limited liability company|LLC|limited partnership)/gim;

  let match2 = formationRe.exec(text);
  while (match2 !== null) {
    const rawName = (match2[1] ?? "").trim().replace(/^[^A-Za-z]+/, "");
    const normalizedName2 = rawName.toLowerCase().replace(/\./g, "");
    if (
      rawName.length >= 3 &&
      rawName.split(/\s+/).length <= 5 &&
      /^[A-Z]/.test(rawName) &&
      !LEGAL_SUFFIX_TERMS.has(normalizedName2)
    ) {
      return {
        legalName: rawName,
        legalNameWithSuffix: rawName
      };
    }
    match2 = formationRe.exec(text);
  }

  // Pattern 3 — "registered in" / "company number" disclosure (common EU/UK)
  const registrationRe =
    /(?:registered\s+(?:in|office)|company\s+(?:number|no\.?|registration))[:\s]+([A-Z][A-Za-z0-9\s&',\-]{2,60})/gi;

  const match3 = registrationRe.exec(text);
  if (match3) {
    const rawName = (match3[1] ?? "").trim().replace(/^[^A-Za-z]+/, "");
    const normalizedName3 = rawName.toLowerCase().replace(/\./g, "");
    if (
      rawName.length >= 3 &&
      rawName.split(/\s+/).length <= 5 &&
      /^[A-Z]/.test(rawName) &&
      !LEGAL_SUFFIX_TERMS.has(normalizedName3)
    ) {
      return {
        legalName: rawName,
        legalNameWithSuffix: rawName
      };
    }
  }

  return null;
}

/**
 * Fetches a single URL and attempts to extract a legal name from it.
 * Returns null if the page could not be fetched (non-200 or network error).
 */
async function tryPage(
  url: string,
  region: "footer" | "full"
): Promise<{ match: ExtractionMatch | null; loaded: boolean }> {
  try {
    const res = await fetchWithTimeout(url, PAGE_FETCH_TIMEOUT_MS);
    if (!res.ok) {
      return { match: null, loaded: false };
    }

    const html = await res.text();
    const section = region === "footer" ? extractFooterRegion(html) : html;
    const text = stripTags(section);
    const match = runPatterns(text);
    return { match, loaded: true };
  } catch {
    return { match: null, loaded: false };
  }
}

/**
 * Tries a list of URL paths in order, returning the first one that returns
 * HTTP 200. Returns null if all fail.
 */
async function tryPaths(
  domain: string,
  paths: string[]
): Promise<{ match: ExtractionMatch | null; path: string | null; loaded: boolean }> {
  for (const path of paths) {
    const url = `https://${domain}${path}`;
    const { match, loaded } = await tryPage(url, "full");
    if (loaded) {
      return { match, path, loaded: true };
    }
  }
  return { match: null, path: null, loaded: false };
}

/**
 * Checks 4 page locations in priority order for a disclosed legal business name.
 * Stops as soon as a match is found. Only run if httpsValid is true.
 *
 * Priority:
 *   1. Homepage footer region
 *   2. /terms, /terms-of-service, /terms-and-conditions
 *   3. /legal
 *   4. /about, /about-us
 */
export async function extractLegalName(
  domain: string,
  httpsValid: boolean
): Promise<LegalNameExtraction> {
  if (!httpsValid) {
    return NULL_NOT_ATTEMPTED;
  }

  try {
    let atLeastOnePageLoaded = false;

    // Location 1: homepage footer
    {
      const url = `https://${domain}`;
      const { match, loaded } = await tryPage(url, "footer");
      if (loaded) {
        atLeastOnePageLoaded = true;
        if (match) {
          return {
            attempted: true,
            legalName: match.legalName,
            legalNameWithSuffix: match.legalNameWithSuffix,
            source: "footer",
            noDisclosure: false
          };
        }
      }
    }

    // Location 2: terms pages
    {
      const { match, path, loaded } = await tryPaths(domain, [
        "/terms",
        "/terms-of-service",
        "/terms-and-conditions"
      ]);
      if (loaded) {
        atLeastOnePageLoaded = true;
        if (match && path) {
          return {
            attempted: true,
            legalName: match.legalName,
            legalNameWithSuffix: match.legalNameWithSuffix,
            source: path,
            noDisclosure: false
          };
        }
      }
    }

    // Location 3: /legal
    {
      const { match, path, loaded } = await tryPaths(domain, ["/legal"]);
      if (loaded) {
        atLeastOnePageLoaded = true;
        if (match && path) {
          return {
            attempted: true,
            legalName: match.legalName,
            legalNameWithSuffix: match.legalNameWithSuffix,
            source: path,
            noDisclosure: false
          };
        }
      }
    }

    // Location 4: about pages
    {
      const { match, path, loaded } = await tryPaths(domain, [
        "/about",
        "/about-us"
      ]);
      if (loaded) {
        atLeastOnePageLoaded = true;
        if (match && path) {
          return {
            attempted: true,
            legalName: match.legalName,
            legalNameWithSuffix: match.legalNameWithSuffix,
            source: path,
            noDisclosure: false
          };
        }
      }
    }

    if (atLeastOnePageLoaded) {
      return NULL_NO_DISCLOSURE;
    }

    // No pages loaded at all
    return {
      attempted: true,
      legalName: null,
      legalNameWithSuffix: null,
      source: null,
      noDisclosure: false
    };
  } catch {
    return {
      attempted: true,
      legalName: null,
      legalNameWithSuffix: null,
      source: null,
      noDisclosure: false
    };
  }
}
