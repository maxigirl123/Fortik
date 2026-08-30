import { createMcpApp } from "./index.js";
import { createX402App } from "./x402Server.js";
import { createRestApp } from "./restServer.js";

const mcpPort  = parseInt(process.env.MCP_PORT  ?? "3000", 10);
const x402Port = parseInt(process.env.X402_PORT ?? "4021", 10);
const restPort = parseInt(process.env.REST_PORT ?? "4022", 10);

createMcpApp().listen(mcpPort, () => {
  console.error(`[mcp]  storefront-guard MCP+x402 running on :${mcpPort}/mcp`);
});

createX402App().listen(x402Port, () => {
  console.error(`[x402] storefront-guard x402 API   running on :${x402Port}/verify`);
});

createRestApp().listen(restPort, () => {
  console.error(`[rest] storefront-guard REST API   running on :${restPort}/verify`);
  console.error(`[rest] feedback endpoint           running on :${restPort}/feedback`);
});
