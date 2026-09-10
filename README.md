# JIAD Bukku MCP

Production remote MCP bridge for Jusni Iljas Al Djabbar Sdn Bhd.

This project runs the existing `@centry-digital/bukku-mcp` package inside a Cloudflare Container and exposes it through a Cloudflare Worker at:

`https://bukku.jusniiljas.com/mcp`

The design preserves the upstream Bukku MCP toolset while removing the dependency on a Windows PC or local Cloudflare Tunnel.

## Architecture

```text
ChatGPT
   |
   | HTTPS + Bearer token
   v
bukku.jusniiljas.com
   |
   v
Cloudflare Worker
   |
   | private Container binding
   v
Cloudflare Container
   |
   | supergateway: Streamable HTTP <-> stdio
   v
@centry-digital/bukku-mcp
   |
   v
Bukku API
```

## Security model

- `BUKKU_API_TOKEN` is stored only as a Cloudflare Worker secret and is passed to the private container at runtime.
- `BUKKU_COMPANY_SUBDOMAIN` is stored as a Cloudflare Worker secret.
- `MCP_AUTH_TOKEN` protects the public `/mcp` endpoint with Bearer authentication.
- No credentials are committed to GitHub.
- The Worker strips the external Authorization header before forwarding traffic to the container.
- The public `/health` endpoint contains no accounting data or secrets.

## Requirements

- Cloudflare Workers Paid plan with Containers enabled.
- `jusniiljas.com` must be an active Cloudflare zone in the same account used for deployment.
- Docker Desktop must be running for the initial `wrangler deploy` because Wrangler builds and pushes the container image.
- Node.js 20+.

## Initial deployment

```bash
npm install
npx wrangler login
```

Set the three production secrets. Wrangler will prompt for each value; do not place secret values directly in the command line or repository.

```bash
npx wrangler secret put BUKKU_API_TOKEN
npx wrangler secret put BUKKU_COMPANY_SUBDOMAIN
npx wrangler secret put MCP_AUTH_TOKEN
```

Deploy:

```bash
npm run deploy
```

Wrangler will build the Docker image, upload the Worker and Container, and attach the Worker to the `bukku.jusniiljas.com` custom domain.

## Endpoints

- `GET /health` - lightweight Worker health check. No authentication required.
- `/mcp` - MCP Streamable HTTP endpoint. Requires `Authorization: Bearer <MCP_AUTH_TOKEN>`.

All other routes return `404`.

## ChatGPT connector

Configure the remote MCP URL as:

```text
https://bukku.jusniiljas.com/mcp
```

Use Bearer-token authentication with the same value stored in the Cloudflare `MCP_AUTH_TOKEN` secret.

## Local development

Create a local `.dev.vars` file containing:

```text
BUKKU_API_TOKEN=...
BUKKU_COMPANY_SUBDOMAIN=...
MCP_AUTH_TOKEN=...
```

`.dev.vars` is ignored by Git and must never be committed.

Run:

```bash
npm run dev
```

Container development requires Docker.

## Upstream packages

- `@centry-digital/bukku-mcp` 2.0.3
- `supergateway` 3.4.3

The upstream Bukku MCP package is MIT licensed. This repository does not copy Bukku credentials or JIAD accounting data.
