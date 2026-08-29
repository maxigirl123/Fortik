import { fetchWithTimeout } from "./httpClient.js";
import { RDAP_BASE_URL, RECENT_CHANGE_WINDOW_DAYS } from "../constants.js";
import type { DomainRegistration } from "../types.js";

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}

interface RdapResponse {
  events?: RdapEvent[];
}

const NULL_REGISTRATION: DomainRegistration = {
  registeredAt: null,
  lastChangedAt: null,
  ageDays: null,
  changedRecently: null
};

function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

/**
 * Look up when a domain was registered and when its registration data was
 * last changed (renewal, transfer, or registrant change) via the public
 * RDAP protocol. RDAP is the modern, structured successor to WHOIS and
 * requires no API key for most TLDs.
 *
 * Returns a null-filled result (never throws) so a single unresolvable
 * lookup degrades the confidence of the overall verification rather than
 * failing the whole tool call.
 */
export async function getDomainRegistration(
  domain: string
): Promise<DomainRegistration> {
  try {
    const res = await fetchWithTimeout(`${RDAP_BASE_URL}${domain}`);
    if (!res.ok) {
      return NULL_REGISTRATION;
    }
    const data = (await res.json()) as RdapResponse;
    const events = data.events ?? [];

    const registration = events.find(
      (e) => e.eventAction === "registration"
    )?.eventDate;
    const lastChanged = events.find(
      (e) => e.eventAction === "last changed" || e.eventAction === "transfer"
    )?.eventDate;

    const registeredAt = registration ?? null;
    const lastChangedAt = lastChanged ?? registeredAt;

    return {
      registeredAt,
      lastChangedAt,
      ageDays: registeredAt ? daysSince(registeredAt) : null,
      changedRecently: lastChangedAt
        ? daysSince(lastChangedAt) <= RECENT_CHANGE_WINDOW_DAYS
        : null
    };
  } catch {
    return NULL_REGISTRATION;
  }
}
