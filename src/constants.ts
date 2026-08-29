// How recent counts as "suspiciously recent" for a registration or cert change.
// A change inside this window on an otherwise-established domain is the core
// signal for "this may have changed hands since the agent last trusted it."
export const RECENT_CHANGE_WINDOW_DAYS = 14;

// Domains younger than this are treated as inherently higher risk regardless
// of other signals - most legitimate storefronts an agent shops at are not
// brand new.
export const NEW_DOMAIN_THRESHOLD_DAYS = 30;

export const ESTABLISHED_DOMAIN_THRESHOLD_DAYS = 365;

export const RDAP_BASE_URL = "https://rdap.org/domain/";
export const CRTSH_BASE_URL = "https://crt.sh/";
export const URLHAUS_API_URL = "https://urlhaus-api.abuse.ch/v1/host/";
export const GOOGLE_SAFE_BROWSING_API_URL = "https://safebrowsing.googleapis.com/v4/threatMatches:find";
export const X402_FACILITATOR_URL = "https://x402.org/facilitator";

// Network calls to free public data sources should never hang a tool call
// indefinitely - an agent calling this expects an answer in seconds.
export const FETCH_TIMEOUT_MS = 2000;

export const GLEIF_API_URL = "https://api.gleif.org/api/v1/fuzzycompletions";
export const SAM_GOV_API_URL = "https://api.sam.gov/entity-information/v3/entities";
export const FDA_API_BASE_URL = "https://api.fda.gov";

export const TRANCO_API_URL = "https://tranco-list.eu/api/ranks/domain";

export const DEFAULT_CACHE_TTL_SECONDS = 1800; // 30 minutes
