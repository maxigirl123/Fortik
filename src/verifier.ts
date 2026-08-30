import { getDomainRegistration } from "./services/rdap.js";
import { getCertHistory } from "./services/certTransparency.js";
import { checkHttpsValid } from "./services/httpsCheck.js";
import { UrlhausBlocklist, GoogleSafeBrowsingBlocklist, CompositeBlocklist } from "./services/blocklist.js";
import { getCorporateRecord, getCorporateRecordByName, domainToBusinessName } from "./services/corporateRegistration.js";
import { extractLegalName } from "./services/legalNameExtractor.js";
import { getSamExclusion } from "./services/samGov.js";
import { getFdaEnforcement } from "./services/fdaEnforcement.js";
import { getTrancoRank } from "./services/trancoRank.js";
import { scoreStorefront, computeRecommendation } from "./scoring.js";
import { ESTABLISHED_DOMAIN_THRESHOLD_DAYS } from "./constants.js";
import type { StorefrontSignals, VerificationResult, CertHistory } from "./types.js";

const NULL_CERT_HISTORY: CertHistory = {
  certCount: 0,
  earliestIssuedAt: null,
  mostRecentIssuedAt: null,
  mostRecentIssuer: null,
  reissuedRecently: null
};

const blocklist = new CompositeBlocklist([
  new UrlhausBlocklist(),
  new GoogleSafeBrowsingBlocklist()
]);

export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
}

export async function runVerification(
  domain: string
): Promise<{ result: VerificationResult; fastPath: boolean }> {
  const normalizedDomain = normalizeDomain(domain);
  const businessName = domainToBusinessName(normalizedDomain);

  const [registration, httpsValid, knownScamMatch, corporateRecord, samExclusion, fdaEnforcement, trancoRank] =
    await Promise.all([
      getDomainRegistration(normalizedDomain),
      checkHttpsValid(normalizedDomain),
      blocklist.check(normalizedDomain),
      getCorporateRecord(businessName),
      getSamExclusion(businessName),
      getFdaEnforcement(businessName),
      getTrancoRank(normalizedDomain)
    ]);

  const legalNameExtraction = await extractLegalName(normalizedDomain, httpsValid);
  const gleifVerified = await getCorporateRecordByName(
    legalNameExtraction.legalName ?? businessName
  );

  let certHistory: CertHistory;
  let fastPath: boolean;

  if (
    registration.ageDays !== null &&
    registration.ageDays > ESTABLISHED_DOMAIN_THRESHOLD_DAYS &&
    registration.changedRecently === false
  ) {
    certHistory = await getCertHistory(normalizedDomain);
    fastPath = false;
  } else {
    certHistory = NULL_CERT_HISTORY;
    fastPath = true;
  }

  const signals: StorefrontSignals = {
    domain: normalizedDomain,
    httpsValid,
    registration,
    certHistory,
    knownScamMatch,
    corporateRecord,
    legalNameExtraction,
    gleifVerified,
    samExclusion,
    fdaEnforcement,
    trancoRank
  };

  const { trustScore, riskLevel, confidence, reasons } = scoreStorefront(signals);
  const { recommendation, recommendationReason } = computeRecommendation(
    trustScore,
    confidence,
    knownScamMatch
  );

  const result: VerificationResult = {
    domain: normalizedDomain,
    trustScore,
    riskLevel,
    confidence,
    reasons,
    recommendation,
    recommendationReason,
    signals,
    checkedAt: new Date().toISOString()
  };

  return { result, fastPath };
}
