# New America research console

Static page (no build step, no external assets). Serve site-src/console/ from any static host (for example GitHub Pages), then enter the server URL and token under Settings. They are saved in the browser's localStorage only.

Shareable link: append the token in the URL fragment, `https://<host>/newamerica-console/#token=<token>` (optionally `&server=<url>`). The fragment is never sent to the static host or logged; the page stores both values and removes them from the address bar. `?token=` works too but shows up in server logs, so prefer `#`. Anyone holding that link can use your server: share it as you would the token.

## Run the server

    NA_HTTP_PORT=8787 NA_HTTP_TOKEN=<token> NA_CORS_ORIGINS=https://lampagj.github.io npx tsx src/mcp/main.ts

NA_CORS_ORIGINS must list the origin that serves the page.

## Expose it over HTTPS

    share add newamerica-mcp 8787

Use the printed URL as the Server URL. The console calls <url>/mcp and <url>/healthz.

## Local check

Open index.html directly. "Test connection" hits /healthz and runs the MCP initialize handshake.
