# FPL League Shop MCP Worker

Cloudflare Worker MCP server and MCP App for the first FPL shop workflow:

- `fpl_shop`: opens an interactive manager standings table in an MCP Apps-capable host.
- `fpl_standings`: returns public FPL classic-league standings.
- `fpl_prepare_buy`: validates a selected manager, builds `fpl:league=<leagueId>;entry=<entryId>`, and creates a manual Juicebox shop handoff.

The server is intentionally non-custodial. It never signs, simulates, or submits a payment, and the payment memo is not proof that a wallet controls an FPL entry.

## Configure

Set a league and, once a Juicebox shop is deployed, its project route:

```bash
npx wrangler secret put FPL_LEAGUE_ID
npx wrangler secret put FPL_DEFAULT_PROJECT_ROUTE
```

`FPL_DEFAULT_PROJECT_ROUTE` must look like `base:123` or `basesep:19`. `FPL_SHOP_URL` defaults to `https://fpl.d33m.com/` and can be changed in `wrangler.jsonc` for a project-specific static shop.

## Develop and deploy

```bash
npm install
npm run check
npm run dev
npm run deploy
```

The Worker serves MCP at `/mcp`, health at `/health`, and the built MCP App HTML as a static asset. `npm run build` is part of `dev` and `deploy` so the App resource is available through the Worker asset binding.

For a production custom domain, replace wildcard CORS with a specific allowed MCP host and add OAuth before exposing payment-adjacent workflows broadly.
