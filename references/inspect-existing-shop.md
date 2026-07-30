# Inspect Existing FPL Shop Inventory

## Completion Rule

Project discovery is not the result. For every matching project, return its active tier inventory with:

- tier name and ID
- displayed and raw price, pricing currency/decimals, and accepted payment token when resolved
- initial supply, remaining supply, and whether it is currently available
- `cantBuyWithCredits`
- metadata description and image when available
- active hook and ruleset used for the read

Do not ask the user to transcribe frontend item cards. If reads fail, try every listed fallback and report the exact failed endpoint/call only after returning all data that did resolve.

## Known Base Sepolia Examples

These are examples, not a registry. Verify their live metadata and tiers before using them:

| Project | FPL league |
| --- | --- |
| `basesep:19` | `143466` Farcaster Fantasy League |
| `basesep:20` | `920` FPL Community on Clubhouse |
| `basesep:21` | `33289` Xabalanche CFC |

## RPC And Core Addresses

For Base Sepolia (`84532`), try each endpoint in this order:

1. `https://sepolia.base.org`
2. `https://sepolia-preconf.base.org`
3. `https://base-sepolia-rpc.publicnode.com`

Use the same `eth_call` sequence against each endpoint. Base Sepolia core addresses used by the FPL template are:

```text
JBDirectory:            0x5aff29060e023e6fb87be5596652b33c65af535b
Omnichain deployer:     0xb853758a70a6b4216c09f1d071ea2344aba0a34f
JBPrices:               0xad45e4627f068d1e6b21e5301870d807543a8401
USDC:                   0x036CbD53842c5426634e7929541eC2318f3dCF7e
USDC decimals:          6
```

The canonical read implementation and ABIs are in `static-shop-template/index.html`:

- ABIs: `CONTROLLER_OF_ABI`, `CURRENT_RULESET_ABI`, `OMNI_TIERED_HOOK_ABI`, `HOOK_STORE_ABI`, `HOOK_METADATA_ID_TARGET_ABI`, `TIER721_STORE_ABI`, `TIER721_PRICING_CONTEXT_ABI`, `TIER721_RESOLVER_ABI`
- flow: `resolveShopHook`, `loadProjectTiers`, and `resolveTierMedia`

Reuse that logic rather than guessing a controller, hook, or tier ABI.

## Required Read Sequence

For each `{chainId, projectId}`:

1. Read `JBDirectory.controllerOf(projectId)`.
2. Read `currentRulesetOf(projectId)` from that controller. Record the current ruleset ID and its metadata.
3. Check the ruleset metadata `useDataHookForPay` and `dataHook`.
4. Resolve the active 721 hook:
   - Normal path: `hook = dataHook`.
   - Omnichain path: if `dataHook` is the omnichain deployer, call `tiered721HookOf(projectId, rulesetId)` and use its `hook` result.
5. Read from the resolved hook:
   - `STORE()`
   - `METADATA_ID_TARGET()`
   - `pricingContext()`
6. Read from the store:
   - `tokenUriResolverOf(hook)`
   - `tiersOf(hook, [], false, 0, 200)`
7. Exclude tiers where `initialSupply` is zero. A tier is sold out when `remainingSupply` is zero; otherwise it is available.
8. For every tier, retain the raw tuple values. In particular, report `id`, `price`, `initialSupply`, `remainingSupply`, and `flags.cantBuyWithCredits`.
9. Resolve tier metadata in this order:
   - `tokenUriResolverOf(hook)` then `tokenUriOf(hook, tierId * 1_000_000_000)`
   - the tier `resolvedUri`
   - the IPFS URI reconstructed from `encodedIpfsUri`
10. Read metadata JSON. Use its `name`, `description`, and `image` when present; do not invent missing names.

## Price And Payment Rules

`tier.price` is denominated in the hook's `pricingContext()`, not automatically the amount of the payment token.

1. Read `pricingContext()` and record `currency` and `decimals`.
2. Identify the payment token from the current terminal/ruleset configuration. For the existing Base Sepolia FPL examples, the intended payment token is the USDC address above, but verify before advising a purchase.
3. If pricing currency equals payment currency, scale the raw tier price to payment-token decimals.
4. Otherwise read `JBPrices.pricePerUnitOf(projectId, paymentCurrency, pricingCurrency, paymentTokenDecimals)` and calculate the rounded-up payment amount exactly as the template does.
5. Return both the human price and raw values. Do not call a tier a USDC price unless the payment-token read confirms it.

## Failure Handling

If a direct RPC read fails:

1. Retry the same idempotent read against the next endpoint above.
2. Check the direct project page at `https://juicebox.money/v6/basesep:<projectId>` or the Base Sepolia explorer as a read-only verification fallback.
3. Do not use `fpl.d33m.com` as a data dependency; it is an optional rendering of these reads.
4. Do not respond with only project identity while omitting tier inventory. If every fallback fails, list the endpoint and contract method that failed, then return every other verified field.
