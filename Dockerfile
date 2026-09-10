FROM node:20-slim

WORKDIR /app

RUN npm install --omit=dev --no-audit --no-fund \
    @centry-digital/bukku-mcp@2.0.3 \
    supergateway@3.4.3

EXPOSE 8000

CMD ["npx", "supergateway", "--stdio", "npx bukku-mcp", "--outputTransport", "streamableHttp", "--port", "8000", "--streamableHttpPath", "/mcp", "--healthEndpoint", "/healthz", "--logLevel", "info"]
