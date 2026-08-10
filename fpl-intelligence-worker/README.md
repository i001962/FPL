# FPL Intelligence MCP Worker

An independently deployable Cloudflare Worker that exposes public Fantasy Premier League analysis through MCP Streamable HTTP at `/mcp`.

It ports the useful FPL-facing surface of [`dohyung1/x402-fpl-api`](https://github.com/dohyung1/x402-fpl-api) to TypeScript/Workers. It deliberately has no x402, Web3, payment verification, wallet handling, or NFT eligibility logic.

## Included tools

`captain_pick`, `transfer_suggestions`, `player_comparison`, `is_hit_worth_it`, `chip_strategy`, `differential_finder`, `fixture_outlook`, `price_predictions`, `live_points`, `rival_tracker`, `league_analyzer`, `squad_scout`, and `fpl_manager_hub`.

The analysis uses public FPL data and transparent heuristics. It is not a claim of proprietary expected-points modelling or guaranteed price changes.

## Install and deploy

```bash
cd fpl-intelligence-worker
npm install
npm run check
npm run dev
npm run deploy
```

Connect an MCP client to `https://<worker>.<account>.workers.dev/mcp` using Streamable HTTP.

## Browser clients and authentication

Remote MCP clients normally do not send an `Origin` header. If a browser-hosted MCP client does, configure an allow-list before deploying:

```bash
npx wrangler secret put ALLOWED_ORIGINS
# e.g. https://chatgpt.com,https://claude.ai
```

Requests with an `Origin` are rejected unless it is in that comma-separated list. This satisfies the Streamable HTTP origin-validation requirement while keeping non-browser MCP clients working.

This Worker intentionally has no authentication yet. Before exposing it to untrusted users, add OAuth or another authentication layer and rate limiting. The planned NFT eligibility gate belongs in an explicit tool/middleware layer; it should not be inferred from a wallet address or FPL team ID.

## Operations

- FPL API data is cached at the edge for 120 seconds by default. Set `FPL_CACHE_TTL_SECONDS` in `wrangler.jsonc` (0–900) to adjust it.
- `live_points` uses a 30-second cache.
- FPL may block requests from certain networks. The Worker sends a browser-like `User-Agent`; test `/health` and a tool call after deployment.
- `/health` confirms the service state and that payments/eligibility are intentionally disabled.

