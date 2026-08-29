export interface DomainRegistration {
  registeredAt: string | null; // ISO date, when the domain was first registered
  lastChangedAt: string | null; // ISO date, most recent registration event (renewal, transfer, registrant change)
  ageDays: number | null;
  changedRecently: boolean | null; // true if lastChangedAt is within RECENT_CHANGE_WINDOW_DAYS
}

export interface CertHistory {
  certCount: number;
  earliestIssuedAt: string | null;
  mostRecentIssuedAt: string | null;
  mostRecentIssuer: string | null;
  reissuedRecently: boolean | null; // true if mostRecentIssuedAt is within RECENT_CHANGE_WINDOW_DAYS
}

export interface CorporateRecord {
  searched: boolean;           // false if lookup failed entirely
  found: boolean | null;       // null if searched=false
  activeCount: number | null;  // number of active US registrations found
  topJurisdiction: string | null; // e.g. "us_de" from the first result
}

export interface SamExclusionResult {
  checked: boolean;          // false if key not configured or lookup failed
  excluded: boolean | null;  // null if checked=false; true if totalRecords > 0
  matchCount: number | null;
}

export interface FdaEnforcementResult {
  checked: boolean;
  hasAction: boolean | null;   // true if any of the 3 databases returned total > 0
  totalActions: number | null; // sum across all 3 databases
}

export interface TrancoRankResult {
  checked: boolean;
  ranked: boolean | null;  // null if lookup failed; false if not in top 1M
  rank: number | null;     // 1 = most popular; null if not ranked
}

export interface LegalNameExtraction {
  attempted: boolean;        // false if HTTPS check failed so we never tried
  legalName: string | null;  // the extracted name, null if not found
  legalNameWithSuffix: string | null; // full string including Inc./LLC/etc.
  source: string | null;     // e.g. "footer", "/terms", "/legal", "/about"
  noDisclosure: boolean;     // true if we loaded pages but found nothing — itself a risk signal
}

export interface StorefrontSignals {
  domain: string;
  httpsValid: boolean;
  registration: DomainRegistration;
  certHistory: CertHistory;
  knownScamMatch: boolean;
  corporateRecord: CorporateRecord;
  legalNameExtraction: LegalNameExtraction;
  gleifVerified: CorporateRecord;  // result of GLEIF lookup using the EXTRACTED name (not domain-derived)
  samExclusion: SamExclusionResult;
  fdaEnforcement: FdaEnforcementResult;
  trancoRank: TrancoRankResult;
}

export type RiskLevel = "low" | "medium" | "high" | "unknown";
export type Confidence = "low" | "medium" | "high";
export type Recommendation = "proceed" | "pause_for_confirmation" | "do_not_proceed";

export interface VerificationResult {
  domain: string;
  trustScore: number; // 0-100, higher = more trustworthy
  riskLevel: RiskLevel;
  confidence: Confidence;
  reasons: string[];
  recommendation: Recommendation;
  recommendationReason: string;
  signals: StorefrontSignals;
  checkedAt: string; // ISO timestamp - this result is a point-in-time snapshot, not cacheable
}
