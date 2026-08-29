import { fetchWithTimeout } from "./httpClient.js";

/**
 * Confirms the domain currently serves over HTTPS with a valid, trusted
 * certificate chain (fetch() itself rejects invalid/self-signed/expired
 * certs, so a successful response is sufficient evidence here).
 *
 * Returns false on any failure - including timeouts, DNS failures, and
 * cert errors - since all of those are themselves signals a storefront
 * is not currently trustworthy to pay.
 */
export async function checkHttpsValid(domain: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`https://${domain}`);
    return res.status < 500;
  } catch {
    return false;
  }
}
