import { runVerification } from "./dist/tools/verifyStorefront.js";

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const DIM    = "\x1b[2m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";

function colorForRecommendation(r) {
  if (r === "proceed")               return GREEN;
  if (r === "pause_for_confirmation") return YELLOW;
  return RED;
}

function colorForRisk(r) {
  if (r === "low")    return GREEN;
  if (r === "medium") return YELLOW;
  return RED;
}

const domain = process.argv[2];
if (!domain) {
  console.error("Usage: node check.mjs <domain>");
  console.error("Example: node check.mjs amazon.com");
  process.exit(1);
}

console.log(`\n${CYAN}${BOLD}storefront-guard${RESET}  checking ${BOLD}${domain}${RESET}...\n`);

const { result } = await runVerification(domain);

const recColor  = colorForRecommendation(result.recommendation);
const riskColor = colorForRisk(result.riskLevel);

console.log(`${BOLD}RECOMMENDATION${RESET}  ${recColor}${BOLD}${result.recommendation.toUpperCase()}${RESET}`);
console.log(`${DIM}                ${result.recommendationReason}${RESET}\n`);
console.log(`Trust score     ${BOLD}${result.trustScore}/100${RESET}`);
console.log(`Risk level      ${riskColor}${result.riskLevel}${RESET}`);
console.log(`Confidence      ${result.confidence}\n`);
console.log(`${BOLD}Signals${RESET}`);
result.reasons.forEach((r) => console.log(`  ${DIM}·${RESET} ${r}`));
console.log(`\n${DIM}checked at ${result.checkedAt}${RESET}\n`);
