import { Container, getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

interface Env {
  BUKKU_MCP_CONTAINER: DurableObjectNamespace<BukkuMcpContainer>;
  BUKKU_API_TOKEN: string;
  BUKKU_COMPANY_SUBDOMAIN: string;
  MCP_AUTH_TOKEN: string;
}

export class BukkuMcpContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "30m";
  envVars = {
    BUKKU_API_TOKEN: env.BUKKU_API_TOKEN,
    BUKKU_COMPANY_SUBDOMAIN: env.BUKKU_COMPANY_SUBDOMAIN,
  };
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
  if (!header || !header.startsWith("Bearer ")) return false;
  return header.slice(7) === secret;
}

export default {
  async fetch(request: Request, workerEnv: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({
        ok: true,
        service: "jiad-bukku-mcp",
        timestamp: new Date().toISOString(),
      }, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    if (!isAuthorized(request, workerEnv.MCP_AUTH_TOKEN)) {
      return unauthorized();
    }

    const container = getContainer(workerEnv.BUKKU_MCP_CONTAINER);

    // Do not forward the public bearer token to the internal MCP process.
    const headers = new Headers(request.headers);
    headers.delete("Authorization");

    const forwarded = new Request(request, { headers });
    return container.fetch(forwarded);
  },
};
