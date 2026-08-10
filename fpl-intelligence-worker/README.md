# FPL Intelligence MCP Worker

An independently deployable Cloudflare Worker that exposes public Fantasy Premier League analysis through MCP Streamable HTTP at `/mcp`.

It ports the useful FPL-facing surface of [`dohyung1/x402-fpl-api`](https://github.com/dohyung1/x402-fpl-api) to TypeScript/Workers. Access is gated by verified ownership of a Base ERC-721 collection, with a $0.05 USDC, 15-minute payment fallback. The Worker never signs or submits wallet transactions.

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

## NFT eligibility and authentication

All FPL analysis tools require a current access token. The gated collection is the CAIP-19 asset type:

```text
eip155:8453/erc721:0x4669162aa53b9052f73f1ca12e43f4be57cf40bf
```

This is a collection-level gate: the verified signer must have `balanceOf(wallet) > 0`. CAIP-19 supports an asset type without a token ID; add a token ID only when the policy should permit a specific NFT rather than any NFT in the collection.

1. Call `fpl_access_challenge` with the EVM wallet address.
2. Sign the exact returned message with that wallet—this is a message signature, not a transaction.
3. Call `fpl_verify_access` with the challenge and signature.
4. Set `Authorization: Bearer <accessToken>` (or `X-FPL-Access-Token`) on subsequent MCP HTTP requests.

The Worker verifies NFT ownership again on each protected call. NFT-derived tokens expire after five minutes; payment-derived tokens expire after 15 minutes. Configure the signing key before deploying:

```bash
npx wrangler secret put ACCESS_TOKEN_SECRET
```

HTTP clients should send `Authorization: Bearer <accessToken>`. Stateless MCP clients that cannot persist headers may instead include the token in every protected tool's arguments as `accessToken`; it is listed in each protected tool schema.

For a non-holder, `fpl_purchase_instructions` returns the exact Base ERC-20 approval and `JBMultiTerminal.pay(...)` calldata. It uses the supplied buyer address as the transaction beneficiary, so a successful mint can satisfy the gate. The Worker does not sign, simulate, or submit either transaction.

## Paid fallback (x402-style)

When no valid access token is supplied, protected tools return HTTP `402` with a Base payment quote. A non-holder can pay at least **$0.05 USDC** through `JBRouterTerminalRegistry.pay(...)` to Juicebox project `base:3`, with beneficiary `0xDf087B724174A3E4eD2338C0798193932E851F1b`.

After the payment is mined, the payer signs a fresh `fpl_access_challenge` and calls `fpl_verify_payment` with the signature and transaction hash. The Worker verifies the Base receipt and decoded router `pay()` fields, consumes that hash once using a Durable Object, and returns a 15-minute access token. It never signs, simulates, or broadcasts a payment transaction.

For example, a stateless caller uses the returned token on a protected call like:

```json
{"method":"tools/call","params":{"name":"captain_pick","arguments":{"accessToken":"<accessToken>"}}}
```

Payment verification needs an authenticated, archive-capable Base RPC endpoint. Store the Dwellir Base Mainnet archive URL as a Worker secret (do not commit it):

```bash
npx wrangler secret put BASE_RPC_URL
```

The Worker does not fall back to public RPC providers: archive receipt verification fails closed if this secret is unavailable.

## Browser clients and CORS

Remote MCP clients normally do not send an `Origin` header. If a browser-hosted MCP client does, configure an allow-list before deploying:

```bash
npx wrangler secret put ALLOWED_ORIGINS
# e.g. https://chatgpt.com,https://claude.ai
```

Requests with an `Origin` are rejected unless it is in that comma-separated list. This satisfies the Streamable HTTP origin-validation requirement while keeping non-browser MCP clients working.

Wallet signatures prove wallet control; the collection read proves current entitlement. Add rate limiting before broadly exposing the purchase or access endpoints.

## Operations

- FPL API data is cached at the edge for 120 seconds by default. Set `FPL_CACHE_TTL_SECONDS` in `wrangler.jsonc` (0–900) to adjust it.
- `live_points` uses a 30-second cache.
- FPL may block requests from certain networks. The Worker sends a browser-like `User-Agent`; test `/health` and a tool call after deployment.
- `/health` confirms the service state and whether an authenticated Base RPC URL is configured.
