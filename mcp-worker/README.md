# FPL League Shop MCP Worker

Cloudflare Worker MCP server and MCP App for the first FPL shop workflow:

- `fpl_shop`: opens an interactive manager standings table in an MCP Apps-capable host.
- `fpl_standings`: resolves a Juicebox project route such as `base:9`, then returns its public FPL classic-league standings.
- `fpl_prepare_buy`: validates a selected manager, builds `fpl:league=<leagueId>;entry=<entryId>`, and returns its live purchasable tier options.
- `fpl_create_purchase_transaction`: creates a simulated, unsigned USDC approval/pay plan for any connected wallet.

The server is intentionally non-custodial. It never signs or submits a payment. It simulates the unsigned transaction plan from the PayBox wallet address, and the payment memo is not proof that a wallet controls an FPL entry.

## Configure

Optionally set a default Juicebox project route:

```bash
npx wrangler secret put FPL_DEFAULT_PROJECT_ROUTE
```

`FPL_DEFAULT_PROJECT_ROUTE` must look like `base:123` or `basesep:19`. The Worker reads the project's Juicebox metadata to resolve `fpl.leagueId`, with the project token URI as a fallback.

## Wallet Checkout

The host agent must keep wallet actions explicit:

1. Call `fpl_prepare_buy` to validate the FPL manager and read the live tier IDs.
2. Get the connected wallet address and call `fpl_create_purchase_transaction` with that address and selected tier IDs.
3. Show the returned USDC approval (when needed) and `JBMultiTerminal.pay(...)` transactions for review, then have the user's wallet connector submit them.

The Worker cannot call a peer wallet MCP server directly. It returns wallet-agnostic raw transaction objects for the host agent to pass to the user's selected wallet connector.

## Develop and deploy

```bash
npm install
npm run check
npm run dev
npm run deploy
```

The Worker serves MCP at `/mcp`, health at `/health`, and the built MCP App HTML as a static asset. `npm run build` is part of `dev` and `deploy` so the App resource is available through the Worker asset binding.

## Continuous Deployment

GitHub Actions deploys the Worker after every push to `main` that changes
`mcp-worker/**`. The workflow type-checks the Worker before running
`npm run deploy`.

Configure these GitHub Actions repository secrets before the first CI deploy:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with permission to edit
  Workers for this account.
- `CLOUDFLARE_ACCOUNT_ID`: `a4472f9c5ab168b04a1b651cab7466c1`.

The workflow can also be run manually from the Actions tab.

For a production custom domain, replace wildcard CORS with a specific allowed MCP host and add OAuth before exposing payment-adjacent workflows broadly.
