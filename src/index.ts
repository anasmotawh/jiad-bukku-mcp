import { createLegacyMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BukkuClient } from "core";
import { registerAllTools } from "../vendor/bukku/packages/mcp/src/tools/registry.js";

interface Env {
  BUKKU_API_TOKEN: string;
  BUKKU_COMPANY_SUBDOMAIN: string;
  MCP_AUTH_TOKEN: string;
}

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Bearer realm="JIAD Bukku MCP"',
      "Cache-Control": "no-store",
    },
  });
}

function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return header.slice(7) === secret;
}

function createServer(env: Env): McpServer {
  const client = new BukkuClient({
    apiToken: env.BUKKU_API_TOKEN,
    companySubdomain: env.BUKKU_COMPANY_SUBDOMAIN,
  });

  const server = new McpServer({
    name: "jiad-bukku",
    version: "1.1.0",
  });

  registerAllTools(server, client);
  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json(
        {
          ok: true,
          service: "jiad-bukku-mcp",
          runtime: "cloudflare-workers",
          timestamp: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    if (!isAuthorized(request, env.MCP_AUTH_TOKEN)) {
      return unauthorized();
    }

    // The upstream Bukku project currently uses MCP SDK v1. Cloudflare's
    // legacy handler provides Streamable HTTP compatibility without a
    // Container or Durable Object. A fresh server is created per request.
    const server = createServer(env);
    return createLegacyMcpHandler(server, {
      route: "/mcp",
      enableJsonResponse: true,
      corsOptions: false,
    })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
