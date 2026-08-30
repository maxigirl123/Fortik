import express from "express";
import { cache } from "./services/cache.js";
import { DEFAULT_CACHE_TTL_SECONDS } from "./constants.js";
import { build402Challenge, verifyAndSettlePayment } from "./x402.js";
import { runVerification, normalizeDomain } from "./verifier.js";

const ttlSeconds = parseInt(
  process.env.CACHE_TTL_SECONDS ?? String(DEFAULT_CACHE_TTL_SECONDS),
  10
);

export function createX402App(): express.Express {
  const app = express();
  app.use(express.json());

  app.post("/verify", async (req, res) => {
    const domain = req.body?.domain as string | undefined;
    if (!domain) {
      res.status(400).json({ error: "Missing required field: domain" });
      return;
    }

    const { paid, txHash } = await verifyAndSettlePayment(req.header("X-PAYMENT"));
    if (!paid) {
      res.status(402).json(build402Challenge());
      return;
    }

    const normalizedDomain = normalizeDomain(domain);
    const t0 = Date.now();

    const cached = await cache.get(normalizedDomain);
    if (cached) {
      console.error(`[x402] ${normalizedDomain} — cache HIT (${Date.now() - t0}ms)`);
      res.status(200).json({ ...cached, payment: { txHash } });
      return;
    }

    const { result, fastPath } = await runVerification(domain);
    await cache.set(normalizedDomain, result, ttlSeconds);
    console.error(`[x402] ${normalizedDomain} — cache MISS, ${fastPath ? "fast path" : "full path"}, ${Date.now() - t0}ms`);
    res.status(200).json({ ...result, payment: { txHash } });
  });

  return app;
}

// Standalone entry point
if (process.argv[1]?.endsWith("x402Server.js")) {
  const port = parseInt(process.env.X402_PORT ?? process.env.PORT ?? "4021", 10);
  createX402App().listen(port, () => {
    console.error(`storefront-guard x402 server running on :${port}/verify`);
  });
}
