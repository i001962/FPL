# Buyer NFT Purchase Workflow

## Purpose

Use this reference when an account, buyer, or payment-capable agent wants to find an FPL league shop, inspect NFT tiers, read what each tier entitles them to, and buy one or more NFTs.

This workflow follows the static shop implementation in `static-shop-template/index.html` and the JuiceScan transaction patterns in `src/pay-component.js` and `src/component-base.js`: build an exact reviewable transaction, handle ERC-20 approval when needed, simulate the reviewed call, then send it from the buyer wallet.

## Required Buyer Inputs

Accept any of these as the starting point:

- Project route: `base:<projectId>` or `basesep:<projectId>`.
- Static shop URL with hash route: `https://.../index.html#base:<projectId>`.
- Manual-mode shop URL: `https://fpl.d33m.com/#<chainSlug>:<projectId>`.
- Project ID plus chain.
- FPL league ID or standings URL, only if shop discovery is available.
- Optional buyer wallet address.
- Selected FPL entry ID, after the buyer chooses the manager they want to back.

If the buyer gives only an FPL league and no project route, first try known project mappings and project metadata search surfaces available to the agent. If no shop can be resolved, say that a shop route or registry is required. Do not invent a project ID from a league ID.

## Find The League

The buyer must know both:

- the Juicebox shop route, such as `base:123`
- the FPL classic league ID, such as `143466`

Resolution order:

1. Parse route inputs:
   - `#<chainSlug>:<projectId>`
   - `?chain=<chainSlug>&projectId=<projectId>&leagueId=<leagueId>`
   - `#<chainSlug>:<projectId>/fpl/<leagueId>`
2. If the route has no league ID, read Juicebox project metadata:
   - `JBDirectory.controllerOf(projectId)`
   - project URI through the active controller's project URI registry when available
   - fallback to `JBProjects.tokenURI(projectId)` only if needed
3. Prefer machine-readable metadata fields:
   - `fpl.leagueId`
   - `fpl.league_id`
   - `leagueId`
   - `fplLeagueId`
   - `fpl_league_id`
   - `details.leagueId`
   - `details.fplLeagueId`
4. Use metadata tags as supporting evidence:
   - `fpl`
   - `fpl-league:<leagueId>`
5. As a weak fallback, parse a league ID from project metadata text. Report that this was inferred.
6. Load the FPL league leaderboard from a CORS-capable browser endpoint for the static app, or directly from FPL APIs for agents. The static template uses:
   ```text
   https://fc-footy.vercel.app/api/fpl-league?leagueId=<leagueId>&includeManagersInfo=1
   ```

The result for a buyer should show league name, league ID, manager rows, and the project route being bought from.

## Manual Mode

When a buyer wants to operate the shop themselves, provide the `fpl.d33m.com` manual-mode link:

```text
https://fpl.d33m.com/#<chainSlug>:<projectId>
```

Examples:

```text
https://fpl.d33m.com/#base:123
https://fpl.d33m.com/#basesep:19
```

Use this link for human browsing, wallet connection, manager selection, tier quantity selection, and checkout. Agents should still use direct FPL API and chain/RPC reads for inventory, holder, memo, and settlement work. Do not scrape `fpl.d33m.com` as the authoritative data source.

## Find NFT Tiers And Entitlements

Before a buyer pays, load active tier inventory and metadata. Use the same read sequence as `inspect-existing-shop.md`:

1. `JBDirectory.controllerOf(projectId)`
2. `currentRulesetOf(projectId)` from the controller
3. verify `metadata.useDataHookForPay = true`
4. resolve the active 721 hook:
   - normal path: `hook = ruleset.metadata.dataHook`
   - omnichain path: `tiered721HookOf(projectId, ruleset.id)` when the data hook is the omnichain deployer
5. from the hook:
   - `STORE()`
   - `METADATA_ID_TARGET()`
   - `pricingContext()`
6. from the store:
   - `tokenUriResolverOf(hook)`
   - `tiersOf(hook, [], false, 0, 200)`
7. for each nonzero-supply tier, keep:
   - tier ID
   - raw price
   - initial supply
   - remaining supply
   - `cantBuyWithCredits`
   - `encodedIpfsUri`
   - `resolvedUri`
8. resolve tier metadata in this order:
   - resolver `tokenUriOf(hook, tierId * 1_000_000_000)`
   - tier `resolvedUri`
   - IPFS URI reconstructed from `encodedIpfsUri`
9. read the metadata JSON and display:
   - `name`
   - `description`
   - `image`
   - optional `categoryName`

The tier `description` is the entitlement text. Do not summarize away material conditions. Show it before asking the buyer to approve or sign.

## Price And Quantity

The buyer can buy any quantity up to the tier's remaining supply. A quantity of `N` for one tier means the tier ID appears `N` times in the NFT mint metadata.

For each cart line:

```text
lineTotalRaw = paymentAmountRawForOneTier * quantity
```

For the whole cart:

```text
amount = sum(lineTotalRaw)
tierIds = [tierId repeated once per NFT being bought]
```

Examples:

- one `Full Season` tier ID `1`: `[1]`
- three `Game Week 1` tier ID `2`: `[2, 2, 2]`
- one `Full Season` and two `Game Week 1`: `[1, 2, 2]`

Do not allow quantity to exceed `remainingSupply` when remaining supply is nonzero. Treat `remainingSupply = 0` as sold out.

## Payment Amount Conversion

Do not assume `tier.price` is already in the payment token's decimals. The 721 hook's `pricingContext()` defines the pricing currency and decimals.

1. Read `pricingContext()` from the hook.
2. Resolve the accepted payment token and token decimals. For the FPL template this is normally USDC, but verify it from the shop/terminal context before telling the buyer.
3. If pricing currency equals payment currency, scale to token decimals.
4. Otherwise call:
   ```text
   JBPrices.pricePerUnitOf(projectId, paymentCurrency, pricingCurrency, paymentTokenDecimals)
   ```
5. Round up the converted payment amount:
   ```text
   paymentAmountRaw = (pricingAmount * pricePerUnit + 10^pricingDecimals - 1) / 10^pricingDecimals
   ```

Return both human-readable and raw amounts.

## Build The FPL Memo

The buyer must select an FPL manager row before checkout. The memo must be:

```text
fpl:league=<leagueId>;entry=<entryId>
```

Do not allow a freeform memo or freeform amount for the FPL buyer flow. This memo is evidence of which FPL entry was selected at purchase time; it is not proof that the wallet controls the FPL entry.

## Build The 721 Mint Metadata

Use the V6 721 pay metadata envelope used by the static template.

Inputs:

- `idTarget = hook.METADATA_ID_TARGET()`
- `tierIds = uint16[]`, with tier IDs repeated by quantity

Algorithm:

```text
tier721MetadataId = first4Bytes(idTarget) XOR first4Bytes(keccak256("pay"))
encodedTierData = abi.encode(bool allowOverspending = true, uint16[] tierIds)
metadata = 0x
  + 32 zero bytes
  + tier721MetadataId
  + 0x02
  + 27 zero bytes
  + encodedTierData without leading 0x
```

Fail if any selected tier ID is not an integer from `1` through `65535`.

## Build The Pay Transaction

The NFT checkout transaction is:

```text
JBMultiTerminal.pay(
  projectId,
  token,
  amount,
  beneficiary,
  minReturnedTokens,
  memo,
  metadata
)
```

For FPL NFT shops:

- `projectId`: Juicebox project ID
- `token`: accepted payment token, usually USDC for this template
- `amount`: total raw payment amount for the whole cart
- `beneficiary`: buyer wallet address, which receives the NFT
- `minReturnedTokens`: `0` for zero project-token issuance shops
- `memo`: `fpl:league=<leagueId>;entry=<entryId>`
- `metadata`: 721 mint metadata envelope with repeated tier IDs
- `to`: resolved `JBMultiTerminal` for the chain
- `value`: `0x0` for ERC-20 payments; native payments use raw native amount

If the payment token is ERC-20, first check:

```text
allowance(buyer, JBMultiTerminal)
```

If allowance is below `amount`, prepare and send or batch:

```text
ERC20.approve(JBMultiTerminal, amount)
```

Then simulate the exact `pay` transaction from the buyer wallet before sending. If simulation fails, do not present the transaction as signer-ready.

## Txlink / Chat Payment Route

For browser-wallet users, the static app sends the approval and pay transactions directly.

For chat-native or agent-mediated buyers, including buyers using the `paybot.xyz` plugin in Claude or ChatGPT, return a reviewable payment plan:

- chain ID
- project route
- selected FPL entry ID and memo
- tier IDs, tier names, quantities, and entitlement descriptions
- payment token
- raw and human amount
- approval transaction if needed
- `JBMultiTerminal.pay` transaction `{to,data,value,chainId}`

When a txlink is useful, use the JuiceScan txlink shape:

```text
https://txlink.stupidtech.net/?method=eth_sendTransaction&chainId=<chainId>&params=<json>
```

The `params` JSON must include `to`, `data`, and `value`. Omit `from` so the connected wallet supplies the signer.

Do not use `paybot.xyz`, txlinks, or memos as manager verification. They are payment routes and evidence channels only.
