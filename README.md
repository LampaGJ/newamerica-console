# New America research console

Static page (no build step, no external assets). Serve site-src/console/ from any static host (for example GitHub Pages), then enter the server URL and token under Settings. They are saved in the browser's localStorage only.

## Run the server

    NA_HTTP_PORT=8787 NA_HTTP_TOKEN=<token> NA_CORS_ORIGINS=https://lampagj.github.io npx tsx src/mcp/main.ts

NA_CORS_ORIGINS must list the origin that serves the page.

## Expose it over HTTPS

    share add newamerica-mcp 8787

Use the printed URL as the Server URL. The console calls <url>/mcp and <url>/healthz.

## Local check

Open index.html directly. "Test connection" hits /healthz and runs the MCP initialize handshake.
