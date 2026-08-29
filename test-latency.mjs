/**
 * test-latency.mjs
 *
 * Calls runVerification directly via the compiled dist output.
 * Run with:  node test-latency.mjs
 *
 * Latency logs go to stderr; we capture both here so everything shows up
 * in the terminal output.
 */

import { runVerification } from "./dist/tools/verifyStorefront.js";
import { cache } from "./dist/services/cache.js";
import { DEFAULT_CACHE_TTL_SECONDS } from "./dist/constants.js";

const domain = "google.com";
const ttl = DEFAULT_CACHE_TTL_SECONDS;

// --- First call (expected: cache MISS, full path for google.com since it is established) ---
console.log(`\n=== Call 1: ${domain} ===`);
const t1 = Date.now();
const { result: r1, fastPath: fp1 } = await runVerification(domain);

// Mirror what the tool handler does: store in cache
await cache.set(domain, r1, ttl);
const elapsed1 = Date.now() - t1;

console.log(`fastPath: ${fp1}`);
console.log(`elapsed: ${elapsed1}ms`);
console.log(`trustScore: ${r1.trustScore}  riskLevel: ${r1.riskLevel}  confidence: ${r1.confidence}`);
console.log(`reasons:`);
r1.reasons.forEach((r) => console.log(`  - ${r}`));

// --- Second call (expected: cache HIT) ---
console.log(`\n=== Call 2: ${domain} (should be cache HIT) ===`);
const t2 = Date.now();
const cached = await cache.get(domain);
const elapsed2 = Date.now() - t2;

if (cached) {
  console.log(`cache HIT in ${elapsed2}ms`);
  console.log(`trustScore: ${cached.trustScore}  riskLevel: ${cached.riskLevel}  confidence: ${cached.confidence}`);
} else {
  console.log(`cache MISS (unexpected) in ${elapsed2}ms`);
  const { result: r2, fastPath: fp2 } = await runVerification(domain);
  console.log(`fastPath: ${fp2}`);
  console.log(`trustScore: ${r2.trustScore}  riskLevel: ${r2.riskLevel}  confidence: ${r2.confidence}`);
}

console.log("\nDone.");
