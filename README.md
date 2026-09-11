# JIAD Bukku MCP

Production remote MCP bridge for Jusni Iljas Al Djabbar Sdn Bhd.

This version runs directly on Cloudflare Workers and does **not** use Cloudflare Containers or Docker. It is intended to fit the Cloudflare Workers Free plan for normal JIAD usage.

Production endpoint:

`https://bukku.jusniiljas.com/mcp`

## Architecture

```text
ChatGPT
   |
   | HTTPS + Bearer token
   v
bukku.jusniiljas.com/mcp
   |
   v
Cloudflare Worker
   |
   v
Bukku API
```

The upstream Bukku source is pinned as a Git submodule under `vendor/bukku` so the existing tool registry can be reused while replacing the local stdio transport with Cloudflare's HTTP MCP handler.

## Security

The Worker expects three Cloudflare secrets:

- `BUKKU_API_TOKEN`
- `BUKKU_COMPANY_SUBDOMAIN`
- `MCP_AUTH_TOKEN`

No secret values belong in GitHub. `/mcp` requires `Authorization: Bearer <MCP_AUTH_TOKEN>`.

`BUKKU_COMPANY_SUBDOMAIN` must contain the company slug (for example, `jiad`). A matching HTTPS Bukku login URL is also accepted and normalized. Malformed configuration returns an authenticated HTTP 503 instead of sending an invalid company header to Bukku.

## Verify or rotate MCP authentication on Windows

With PowerShell 7 and Node.js 24, run `./scripts/mcp-token.ps1 -Rotate` to generate a cryptographic token, save it using Windows user-bound encryption, upload it through stdin, and verify that same value. The encrypted `.mcp-token.dpapi` file is ignored by Git and can only be decrypted by the same Windows user.

Run `./scripts/mcp-token.ps1` to verify again, or `./scripts/mcp-token.ps1 -Copy` to copy the token for your MCP client's Bearer authentication field without printing it. Rotation requires updating clients that used the previous token.

Secret uploads can briefly continue serving the previous value. Verification retries initialization on HTTP 401 for up to 55 seconds; do not repeatedly rotate while propagation is pending. It checks public health, rejection of missing/incorrect credentials, MCP initialization, ping, all tool pages, and read-only currency/contact calls. Accounting records and tokens are not printed. A persistent failure exits unsuccessfully.

Run `npm test` and `npm run typecheck` before deploying code changes.

## First-time setup

If you already cloned this repository before the Worker-only conversion, update it with:

```bash
git pull
git submodule update --init --recursive
npm install
```

If cloning fresh:

```bash
git clone --recurse-submodules https://github.com/anasmotawh/jiad-bukku-mcp.git
cd jiad-bukku-mcp
npm install
```

Authenticate Wrangler if needed:

```bash
npx wrangler login
```

Set secrets if they are not already present:

```bash
npx wrangler secret put BUKKU_API_TOKEN
npx wrangler secret put BUKKU_COMPANY_SUBDOMAIN
npx wrangler secret put MCP_AUTH_TOKEN
```

Deploy:

```bash
npm run deploy
```

Docker Desktop is not required for this version.

## Endpoints

- `GET /health` - Worker health check, no accounting data.
- `/mcp` - authenticated MCP endpoint.

## Upstream compatibility

The project currently reuses the upstream SDK v1 Bukku MCP server definitions through Cloudflare's `createLegacyMcpHandler` bridge. The upstream Bukku repository is pinned to commit `94c1a5c1668f451ef9b067b4d9d1fa73162a9401`.

Most Bukku tools are ordinary HTTP API operations and are suitable for Workers. The upstream file-upload tool still assumes a local filesystem path; that specific tool is not expected to work correctly in the Worker runtime until it is redesigned to accept uploaded bytes rather than a machine-local path.

## Cloudflare Free plan note

This project no longer declares Containers or Durable Objects. Cloudflare Workers Free limits still apply, particularly CPU time and daily request limits. If the full upstream tool registry proves too CPU-heavy during initialization, the next optimization is to split or lazily register tool groups rather than moving back to paid Containers.
