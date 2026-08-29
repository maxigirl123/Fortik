import { fetchWithTimeout } from "./httpClient.js";
import { CRTSH_BASE_URL, RECENT_CHANGE_WINDOW_DAYS } from "../constants.js";
import type { CertHistory } from "../types.js";

interface CrtShEntry {
  issuer_name?: string;
  entry_timestamp?: string;
  not_before?: string;
}

const NULL_CERT_HISTORY: CertHistory = {
  certCount: 0,
  earliestIssuedAt: null,
  mostRecentIssuedAt: null,
  mostRecentIssuer: null,
  reissuedRecently: null
};

function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

/**
 * Look up a domain's SSL/TLS certificate issuance history via crt.sh,
 * a free public interface over the Certificate Transparency logs every
 * publicly trusted certificate authority is required to publish to.
 *
 * The key fraud signal this surfaces: a certificate reissued very recently
 * on a domain that is otherwise long-established can indicate the domain
 * changed hands (new operator, new hosting, possible takeover) even though
 * the domain registration itself looks old and trustworthy.
 *
 * Never throws - returns a null-filled result on any failure so the caller
 * can lower confidence instead of failing the whole verification.
 */
export async function getCertHistory(domain: string): Promise<CertHistory> {
  try {
    const res = await fetchWithTimeout(
      `${CRTSH_BASE_URL}?q=${encodeURIComponent(domain)}&output=json`
    );
    if (!res.ok) {
      return NULL_CERT_HISTORY;
    }

    const raw = (await res.json()) as CrtShEntry[];
    if (!Array.isArray(raw) || raw.length === 0) {
      return NULL_CERT_HISTORY;
    }

    const dated = raw
      .map((e) => ({
        issuer: e.issuer_name ?? null,
        date: e.not_before ?? e.entry_timestamp ?? null
      }))
      .filter((e): e is { issuer: string | null; date: string } => !!e.date)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (dated.length === 0) {
      return NULL_CERT_HISTORY;
    }

    const earliest = dated[0];
    const mostRecent = dated[dated.length - 1];

    return {
      certCount: dated.length,
      earliestIssuedAt: earliest.date,
      mostRecentIssuedAt: mostRecent.date,
      mostRecentIssuer: mostRecent.issuer,
      reissuedRecently: daysSince(mostRecent.date) <= RECENT_CHANGE_WINDOW_DAYS
    };
  } catch {
    return NULL_CERT_HISTORY;
  }
}
