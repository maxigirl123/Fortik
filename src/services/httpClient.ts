import { FETCH_TIMEOUT_MS } from "../constants.js";

/**
 * Fetch with a hard timeout so a slow or unresponsive public data source
 * never causes the whole verification tool call to hang. Callers are
 * expected to catch failures and degrade gracefully (return nulls, lower
 * confidence) rather than surface a raw network error to the agent.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
  init: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { headers: extraHeaders, ...restInit } = init;
    const response = await fetch(url, {
      ...restInit,
      signal: controller.signal,
      headers: {
        "User-Agent": "storefront-guard-mcp-server/0.1.0",
        ...(extraHeaders as Record<string, string> | undefined)
      }
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}
