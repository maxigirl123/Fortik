import express, { type Request, type Response, type NextFunction } from "express";
import { appendFileSync } from "fs";
import { cache } from "./services/cache.js";
import { DEFAULT_CACHE_TTL_SECONDS } from "./constants.js";
import { runVerification, normalizeDomain } from "./verifier.js";

const ttlSeconds = parseInt(
  process.env.CACHE_TTL_SECONDS ?? String(DEFAULT_CACHE_TTL_SECONDS),
  10
);

const FEEDBACK_LOG = process.env.FEEDBACK_LOG ?? "feedback.jsonl";

const validKeys = new Set(
  (process.env.API_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean)
);

function apiKeyGuard(req: Request, res: Response, next: NextFunction): void {
  const key = req.header("X-API-KEY");
  if (!key || !validKeys.has(key)) {
    res.status(401).json({ error: "Missing or invalid API key" });
    return;
  }
  next();
}

export function createRestApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(apiKeyGuard);

  app.post("/verify", async (req, res) => {
    const domain = req.body?.domain as string | undefined;
    if (!domain) {
      res.status(400).json({ error: "Missing required field: domain" });
      return;
    }

    const normalizedDomain = normalizeDomain(domain);
    const t0 = Date.now();

    const cached = await cache.get(normalizedDomain);
    if (cached) {
      console.error(`[rest] ${normalizedDomain} — cache HIT (${Date.now() - t0}ms)`);
      res.status(200).json(cached);
      return;
    }

    const { result, fastPath } = await runVerification(domain);
    await cache.set(normalizedDomain, result, ttlSeconds);
    console.error(`[rest] ${normalizedDomain} — cache MISS, ${fastPath ? "fast path" : "full path"}, ${Date.now() - t0}ms`);
    res.status(200).json(result);
  });

  // Feedback endpoint — logs outcome per domain for future ML training
  app.post("/feedback", (req, res) => {
    const { domain, outcome, transactionId, notes } = req.body ?? {};

    if (!domain || !outcome) {
      res.status(400).json({ error: "Missing required fields: domain, outcome" });
      return;
    }

    if (outcome !== "legit" && outcome !== "scam") {
      res.status(400).json({ error: "outcome must be 'legit' or 'scam'" });
      return;
    }

    const entry = {
      domain: normalizeDomain(domain),
      outcome,
      transactionId: transactionId ?? null,
      notes: notes ?? null,
      reportedAt: new Date().toISOString()
    };

    try {
      appendFileSync(FEEDBACK_LOG, JSON.stringify(entry) + "\n");
      console.error(`[feedback] ${entry.domain} — ${outcome}`);
      res.status(200).json({ recorded: true });
    } catch (err) {
      console.error("[feedback] write error:", err);
      res.status(500).json({ error: "Failed to record feedback" });
    }
  });

  return app;
}

// Standalone entry point
if (process.argv[1]?.endsWith("restServer.js")) {
  const port = parseInt(process.env.REST_PORT ?? process.env.PORT ?? "4022", 10);
  createRestApp().listen(port, () => {
    console.error(`storefront-guard REST API running on :${port}`);
  });
}
