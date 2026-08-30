import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response, type NextFunction } from "express";
import { registerVerifyStorefrontTool } from "./tools/verifyStorefront.js";
import { build402Challenge, verifyAndSettlePayment } from "./x402.js";

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "storefront-guard-mcp-server",
    version: "0.3.0"
  });
  registerVerifyStorefrontTool(server);
  return server;
}

export async function startMcpStdio(): Promise<void> {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function x402Guard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { paid } = await verifyAndSettlePayment(req.header("X-PAYMENT"));
  if (!paid) {
    res.status(402).json(build402Challenge());
    return;
  }
  next();
}

export function createMcpApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.post("/mcp", x402Guard, async (req, res) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}

// Standalone entry point
const transport = process.env.TRANSPORT ?? "stdio";
if (transport === "http") {
  const port = parseInt(process.env.MCP_PORT ?? process.env.PORT ?? "3000", 10);
  createMcpApp().listen(port, () => {
    console.error(`storefront-guard MCP+x402 server running on :${port}/mcp`);
  });
} else {
  startMcpStdio().catch((err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
}
