// Per-process only — not shared across instances. Swap for a Redis-backed
// implementation if running multiple instances behind a load balancer.

import type { VerificationResult } from "../types.js";

export interface CacheProvider {
  get(domain: string): Promise<VerificationResult | null>;
  set(domain: string, result: VerificationResult, ttlSeconds: number): Promise<void>;
}

interface CacheEntry {
  result: VerificationResult;
  expiresAt: number;
}

export class InMemoryCache implements CacheProvider {
  private readonly store = new Map<string, CacheEntry>();

  async get(domain: string): Promise<VerificationResult | null> {
    const entry = this.store.get(domain);
    if (!entry) {
      return null;
    }
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(domain);
      return null;
    }
    return entry.result;
  }

  async set(domain: string, result: VerificationResult, ttlSeconds: number): Promise<void> {
    this.store.set(domain, {
      result,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }
}

export const cache = new InMemoryCache();
