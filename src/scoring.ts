import {
  ESTABLISHED_DOMAIN_THRESHOLD_DAYS,
  NEW_DOMAIN_THRESHOLD_DAYS
} from "./constants.js";
import type {
  Confidence,
  RiskLevel,
  Recommendation,
  StorefrontSignals
} from "./types.js";

interface ScoringOutcome {
  trustScore: number;
  riskLevel: RiskLevel;
  confidence: Confidence;
  reasons: string[];
}

/**
 * Combines raw signals into a trust score. This is a transparent, additive
 * heuristic on purpose - every point deducted has a stated reason attached,
 * so an agent (or the developer who configured it) can see exactly why a
 * storefront was flagged rather than trusting an opaque number.
 *
 * This is NOT a fraud-ML model. It is a fast, explainable pre-filter meant
 * to catch the cheapest, most common signal of a compromised or freshly
 * stood-up scam storefront: things changed very recently on a domain that
 * is presenting itself as established.
 */
export function scoreStorefront(signals: StorefrontSignals): ScoringOutcome {
  const reasons: string[] = [];

  if (signals.knownScamMatch) {
    return {
      trustScore: 2,
      riskLevel: "high",
      confidence: "high",
      reasons: ["Domain matches a known scam/malicious domain list"]
    };
  }

  if (signals.samExclusion.excluded === true) {
    return {
      trustScore: 3,
      riskLevel: "high",
      confidence: "high",
      reasons: [
        "Business appears on the federal SAM.gov exclusions list (debarred or suspended from doing business)"
      ]
    };
  }

  // No HTTPS is a hard payment blocker — payment data cannot be safely
  // transmitted without TLS, regardless of any other positive signals.
  if (!signals.httpsValid) {
    return {
      trustScore: 5,
      riskLevel: "high",
      confidence: "high",
      reasons: [
        "Site does not serve valid HTTPS — payment data cannot be safely transmitted; do not proceed"
      ]
    };
  }

  let score = 70; // neutral baseline when a signal can't be resolved
  let resolvedSignals = 0;
  let paymentRiskCount = 0; // tracks how many payment-critical signals are bad

  const { registration } = signals;
  if (registration.ageDays !== null) {
    resolvedSignals++;
    if (registration.ageDays < NEW_DOMAIN_THRESHOLD_DAYS) {
      score -= 30;
      paymentRiskCount++;
      reasons.push(
        `Domain was registered only ${registration.ageDays} day(s) ago`
      );
    } else if (registration.ageDays > ESTABLISHED_DOMAIN_THRESHOLD_DAYS) {
      score += 10;
      reasons.push(
        `Domain has been registered for ${Math.floor(
          registration.ageDays / 365
        )}+ year(s)`
      );
    }
  }

  if (registration.changedRecently) {
    resolvedSignals++;
    score -= 25;
    paymentRiskCount++;
    reasons.push(
      "Domain registration data changed within the last two weeks"
    );
  } else if (registration.changedRecently === false) {
    resolvedSignals++;
  }

  const { certHistory } = signals;
  if (certHistory.reissuedRecently !== null) {
    resolvedSignals++;
    const domainIsEstablished =
      registration.ageDays !== null &&
      registration.ageDays > ESTABLISHED_DOMAIN_THRESHOLD_DAYS;
    if (certHistory.reissuedRecently && domainIsEstablished) {
      score -= 15;
      reasons.push(
        "SSL certificate was reissued within the last two weeks on an otherwise long-established domain - possible takeover or hosting change"
      );
    }
  }

  if (signals.corporateRecord.searched === true && signals.corporateRecord.found === false) {
    score -= 15;
    paymentRiskCount++;
    resolvedSignals++;
    reasons.push(
      "No active US corporate registration found matching this domain name — may be unregistered or operating as a sole proprietor"
    );
  } else if (signals.corporateRecord.found === true) {
    score += 10;
    resolvedSignals++;
    reasons.push(
      `Active US corporate registration found (${signals.corporateRecord.activeCount} jurisdiction(s))`
    );
  }

  // Legal name disclosure + GLEIF verification using the extracted name
  if (signals.legalNameExtraction.attempted) {
    const { legalName, noDisclosure } = signals.legalNameExtraction;
    const { gleifVerified } = signals;

    if (legalName !== null && gleifVerified.found === true) {
      score += 15;
      resolvedSignals++;
      reasons.push(
        `Legal business name '${legalName}' disclosed on site and verified in GLEIF entity registry`
      );
    } else if (
      legalName !== null &&
      gleifVerified.found === false &&
      gleifVerified.searched === true
    ) {
      score -= 15;
      paymentRiskCount++;
      resolvedSignals++;
      reasons.push(
        `Legal business name '${legalName}' disclosed on site but not found in GLEIF entity registry`
      );
    } else if (noDisclosure === true) {
      score -= 10;
      paymentRiskCount++;
      resolvedSignals++;
      reasons.push(
        "No legal business name found on site — legitimate storefronts are typically required to disclose their registered entity name"
      );
    }
  }

  const { trancoRank } = signals;
  if (trancoRank.checked && trancoRank.ranked && trancoRank.rank !== null) {
    resolvedSignals++;
    if (trancoRank.rank <= 1_000) {
      score += 20;
      reasons.push(`Domain ranks #${trancoRank.rank} globally — household-name traffic level`);
    } else if (trancoRank.rank <= 10_000) {
      score += 15;
      reasons.push(`Domain ranks #${trancoRank.rank} globally — high traffic`);
    } else if (trancoRank.rank <= 100_000) {
      score += 10;
      reasons.push(`Domain ranks #${trancoRank.rank} globally — established web presence`);
    } else {
      score += 5;
      reasons.push(`Domain ranks #${trancoRank.rank} globally — present in top 1M sites`);
    }
  }
  // Not ranked is neutral — many legitimate small businesses won't crack top 1M

  if (signals.fdaEnforcement.hasAction === true) {
    resolvedSignals++;
    // FDA is treated as a corroborating signal only — the domain-derived business
    // name is too fuzzy to penalise a standalone clean domain. Only deduct points
    // if at least one other risk indicator is already present.
    const hasOtherRisk =
      !signals.httpsValid ||
      (registration.ageDays !== null &&
        registration.ageDays < NEW_DOMAIN_THRESHOLD_DAYS) ||
      registration.changedRecently === true ||
      (signals.corporateRecord.searched === true &&
        signals.corporateRecord.found === false);

    if (hasOtherRisk) {
      score -= 20;
      reasons.push(
        `FDA enforcement action(s) found for a business matching this domain name (${signals.fdaEnforcement.totalActions} total)`
      );
    }
  }

  // Compound payment-risk penalty: multiple bad signals together are worse
  // than their individual weights suggest — a site with no corp record AND
  // no legal name AND a new domain is almost certainly not safe to pay.
  if (paymentRiskCount >= 2) {
    score -= 15;
    reasons.push(
      `${paymentRiskCount} payment-critical risk signals present — combined risk is elevated`
    );
  }

  score = Math.max(0, Math.min(100, score));

  const riskLevel: RiskLevel =
    score >= 70 ? "low" : score >= 40 ? "medium" : "high";

  // Confidence reflects how many independent signals could actually be
  // resolved, not how good the score looks - a clean score built on zero
  // resolvable signals should not be presented as confidently safe.
  const confidence: Confidence =
    resolvedSignals >= 3 ? "high" : resolvedSignals >= 1 ? "medium" : "low";

  if (reasons.length === 0) {
    reasons.push("No risk signals found in available data sources");
  }

  return { trustScore: score, riskLevel, confidence, reasons };
}

export function computeRecommendation(
  trustScore: number,
  confidence: Confidence,
  knownScamMatch: boolean
): { recommendation: Recommendation; recommendationReason: string } {
  if (knownScamMatch) {
    return {
      recommendation: "do_not_proceed",
      recommendationReason: "Domain matches a known scam/malicious domain list"
    };
  }
  if (trustScore < 45) {
    return {
      recommendation: "do_not_proceed",
      recommendationReason: "Trust score is in the high-risk range"
    };
  }
  if (trustScore >= 70 && confidence === "high") {
    return {
      recommendation: "proceed",
      recommendationReason: "Trust score is in the low-risk range with high confidence"
    };
  }
  return {
    recommendation: "pause_for_confirmation",
    recommendationReason:
      confidence !== "high"
        ? "Not enough signals could be resolved to reach high confidence"
        : "Trust score is in the medium-risk range"
  };
}
