# FPL Intelligence MCP Worker

An independently deployable Cloudflare Worker that exposes public Fantasy Premier League analysis through MCP Streamable HTTP at `/mcp`.

It ports the useful FPL-facing surface of [`dohyung1/x402-fpl-api`](https://github.com/dohyung1/x402-fpl-api) to TypeScript/Workers. It supports walletless access passes via OAuth, as well as verified ownership of a Base ERC-721 collection and a $0.05 USDC payment fallback. The Worker never signs or submits wallet transactions.

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

## Walletless access passes (no email or wallet)

The Worker includes its own OAuth authorization server and pass store. It uses the existing Durable Object SQLite storage, so there is no Docker container, email provider, or separate database to operate.

An access pass is a private bearer credential. The Worker stores only a SHA-256 hash, expiry, and revocation state—not an email address, name, wallet, or pass plaintext. On first connection, an OAuth-capable MCP host redirects the user to `/authorize`; they enter their pass on that page and the host receives a one-hour `fpl:read` token plus a rotating refresh token. The token is checked against the pass store on every protected MCP call, so revocation takes effect immediately.

Before deploying, configure the signing key and a strong issuer secret:

```bash
npx wrangler secret put ACCESS_TOKEN_SECRET
npx wrangler secret put ACCESS_PASS_ISSUER_SECRET
```

The host must use Authorization Code + PKCE (`S256`). The Worker uses dynamic client registration, so ChatGPT can register its own exact callback URL during setup. It advertises `fpl:read` and `offline_access`, and supports refresh-token rotation. Its discovery endpoints are `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.

Create a pass through the administrator endpoint; it returns the plaintext only once, so deliver it privately to the recipient:

```bash
curl -X POST https://mcp.fpl.d33m.com/admin/access-passes \
  -H "Authorization: Bearer <ACCESS_PASS_ISSUER_SECRET>" \
  -H "Content-Type: application/json" \
  --data '{"expiresInDays":30}'
```

Revoke a lost or shared pass immediately:

```bash
curl -X DELETE https://mcp.fpl.d33m.com/admin/access-passes/<passId> \
  -H "Authorization: Bearer <ACCESS_PASS_ISSUER_SECRET>"
```

Do not ask users to paste passes into their chat prompts. They should enter them only on the Worker-hosted OAuth page. Restrict the admin endpoint at the Cloudflare edge and add rate limiting before broad distribution; it is intentionally an operator-only endpoint.

## NFT eligibility and authentication

All FPL analysis tools require a current access token. Holding an NFT from either accepted Base ERC-721 collection grants access:

```text
eip155:8453/erc721:0x4669162aa53b9052f73f1ca12e43f4be57cf40bf
eip155:8453/erc721:0x70935a3594d2e287cfc6bdfdaea7de209e4636d8
```

This is a collection-level gate: the verified signer must have `balanceOf(wallet) > 0` for at least one accepted collection. The linked Juicebox project is `base:10`; its live V6 tier inventory marks a tier as an FPL access option when its metadata description contains `OG` or `FPL`. CAIP-19 supports an asset type without a token ID; add a token ID only when the policy should permit a specific NFT rather than any NFT in the collection.

1. Call `fpl_access_challenge` with the EVM wallet address.
2. Sign the exact returned message with that wallet—this is a message signature, not a transaction.
3. Call `fpl_verify_access` with the challenge and signature.
4. Set `Authorization: Bearer <accessToken>` (or `X-FPL-Access-Token`) on subsequent MCP HTTP requests.

The Worker verifies NFT ownership again on each protected call. NFT-derived tokens expire after five minutes; payment-derived tokens expire after 15 minutes. Configure the signing key before deploying:

```bash
npx wrangler secret put ACCESS_TOKEN_SECRET
```

HTTP clients should send `Authorization: Bearer <accessToken>`. Stateless MCP clients that cannot persist headers may instead include the token in every protected tool's arguments as `accessToken`; it is listed in each protected tool schema.

Agents should call the free `fpl_access_options` tool before their first protected FPL call. It returns both access routes: the NFT verification flow and the $0.05 USDC Juicebox payment fallback.

For a non-holder, `fpl_access_nft_inventory` (also available under the legacy `fpl_purchase_instructions` name) resolves the active Juicebox V6 controller, 721 hook, tier store, current prices/supply, and IPFS metadata for project `base:10`. Read the returned tier descriptions and choose a currently available tier marked `eligibleForFplAccess`. The Worker deliberately does not quote a fixed SLOPSHOP amount or return stale checkout calldata; a V6-aware checkout must use the current tier, payment asset, terminal, and buyer wallet as beneficiary.

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
- During preseason or before FPL publishes gameweek picks, squad-dependent tools return `status: "fpl_gameweek_data_unpublished"` with `access: "accepted"` instead of treating FPL `404` responses as NFT/auth failures.
- FPL may block requests from certain networks. The Worker sends a browser-like `User-Agent`; test `/health` and a tool call after deployment.
- `/health` confirms the service state and whether an authenticated Base RPC URL is configured.
