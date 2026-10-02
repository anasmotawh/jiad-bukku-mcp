import { createLegacyMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BukkuClient, type BukkuClientConfig } from "core";
import { companySubdomain } from "./config.js";
import { registerAllTools } from "../vendor/bukku/packages/mcp/src/tools/registry.js";

interface Env {
  BUKKU_API_TOKEN: string;
  BUKKU_COMPANY_SUBDOMAIN: string;
  MCP_AUTH_TOKEN: string;
  COMPOSIO_MCP_AUTH_TOKEN?: string;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Bearer realm="JIAD Bukku MCP"',
      "Cache-Control": "no-store",
    },
  });
}

function isAuthorized(request: Request, ...secrets: Array<string | undefined>): boolean {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return false;

  const token = header.slice(7);
  return secrets.some((secret) => Boolean(secret) && token === secret);
}

function mimeExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/xml": ".xml",
    "application/zip": ".zip",
  };
  return extensions[mimeType.toLowerCase()] ?? ".bin";
}

function safeFilename(value: string | null | undefined, mimeType: string): string {
  const fallback = `upload${mimeExtension(mimeType)}`;
  if (!value) return fallback;

  const clean = value
    .replace(/^["']|["']$/g, "")
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 180);

  return clean || fallback;
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;

  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      return utf8[1].trim();
    }
  }

  const plain = value.match(/filename="?([^";]+)"?/i);
  return plain?.[1]?.trim() ?? null;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;

  const octets = parts.map(Number);
  if (octets.some((value) => value < 0 || value > 255)) return false;

  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function assertSafeRemoteUrl(url: URL): void {
  if (url.protocol !== "https:") {
    throw new Error("Remote uploads must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Remote upload URLs must not contain embedded credentials.");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe8") ||
    host.startsWith("fe9") ||
    host.startsWith("fea") ||
    host.startsWith("feb") ||
    isPrivateIpv4(host)
  ) {
    throw new Error("Private or local network URLs are not allowed for uploads.");
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseDataUrl(source: string): { blob: Blob; filename: string; mimeType: string } {
  const comma = source.indexOf(",");
  if (!source.startsWith("data:") || comma < 0) {
    throw new Error("Invalid data URL.");
  }

  const metadata = source.slice(5, comma).split(";").filter(Boolean);
  const payload = source.slice(comma + 1);

  let mimeType = "application/octet-stream";
  let filename: string | null = null;
  let base64 = false;

  if (metadata[0]?.includes("/")) {
    mimeType = metadata.shift()!.toLowerCase();
  }

  for (const item of metadata) {
    if (item.toLowerCase() === "base64") {
      base64 = true;
    } else if (item.toLowerCase().startsWith("name=")) {
      const rawName = item.slice(5).replace(/^["']|["']$/g, "");
      try {
        filename = decodeURIComponent(rawName);
      } catch {
        filename = rawName;
      }
    }
  }

  const bytes = base64
    ? decodeBase64(payload)
    : new TextEncoder().encode(decodeURIComponent(payload));

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("File exceeds the 10 MB upload limit.");
  }

  const resolvedName = safeFilename(filename, mimeType);
  return {
    blob: new Blob([bytes], { type: mimeType }),
    filename: resolvedName,
    mimeType,
  };
}

async function fetchUploadSource(
  source: string,
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  if (source.startsWith("data:")) {
    return parseDataUrl(source);
  }

  let current: URL;
  try {
    current = new URL(source);
  } catch {
    throw new Error(
      "Local filesystem paths are unavailable in the remote Worker. Provide an HTTPS URL or a data: URL.",
    );
  }

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    assertSafeRemoteUrl(current);

    const response = await fetch(current.toString(), { redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) {
        throw new Error("Upload source redirected without a Location header.");
      }
      if (redirects === 3) {
        throw new Error("Upload source exceeded the redirect limit.");
      }
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Unable to download upload source (HTTP ${response.status}).`);
    }

    const declaredLength = Number(response.headers.get("Content-Length") ?? "0");
    if (declaredLength > MAX_UPLOAD_BYTES) {
      throw new Error("File exceeds the 10 MB upload limit.");
    }

    const blob = await response.blob();
    if (blob.size > MAX_UPLOAD_BYTES) {
      throw new Error("File exceeds the 10 MB upload limit.");
    }

    const mimeType = blob.type || "application/octet-stream";
    const contentDispositionName = filenameFromContentDisposition(
      response.headers.get("Content-Disposition"),
    );
    const urlName = decodeURIComponent(current.pathname.split("/").pop() || "");
    const filename = safeFilename(contentDispositionName || urlName, mimeType);

    return {
      blob: blob.type ? blob : new Blob([blob], { type: mimeType }),
      filename,
      mimeType,
    };
  }

  throw new Error("Unable to resolve upload source.");
}

class WorkerBukkuClient extends BukkuClient {
  private readonly uploadToken: string;
  private readonly uploadSubdomain: string;

  constructor(config: BukkuClientConfig) {
    super(config);
    this.uploadToken = config.apiToken;
    this.uploadSubdomain = config.companySubdomain;
  }

  async postMultipart(path: string, fileSource: string): Promise<unknown> {
    const { blob, filename, mimeType } = await fetchUploadSource(fileSource);

    const form = new FormData();
    form.append("file", new File([blob], filename, { type: mimeType }));

    const response = await fetch(new URL(path, "https://api.bukku.my").toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.uploadToken}`,
        "Company-Subdomain": this.uploadSubdomain,
        Accept: "application/json",
      },
      body: form,
    });

    if (!response.ok) {
      throw response;
    }

    return response.json();
  }
}

function createServer(env: Env): McpServer {
  const normalizedSubdomain = companySubdomain(env.BUKKU_COMPANY_SUBDOMAIN);
  const client = new WorkerBukkuClient({
    apiToken: env.BUKKU_API_TOKEN,
    companySubdomain: normalizedSubdomain,
  });

  const server = new McpServer({
    name: "jiad-bukku",
    version: "1.1.1",
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

    if (!isAuthorized(request, env.MCP_AUTH_TOKEN, env.COMPOSIO_MCP_AUTH_TOKEN)) {
      return unauthorized();
    }

    let server: McpServer;
    try {
      server = createServer(env);
    } catch {
      return Response.json(
        {
          error:
            "Bukku server configuration is invalid. Check the company subdomain and API token bindings.",
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    return createLegacyMcpHandler(server, {
      route: "/mcp",
      enableJsonResponse: true,
    })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
