# FPL League NFT Shop Static Template

This is a copyable static app template for FPL league NFT shops. It is intentionally separate from the `fpl-league-nft-shop-deployer` skill so the skill can stay focused on deploy txlinks.

## Publishing

Publish the entire template directory after pushing its repository changes to `main`:

```sh
QSTORAGE_BUCKET=footy scripts/upload-static-shop-template-qstorage.sh
```

The script mirrors `static-shop-template/` to `s3://footy/static-shop-template/` with `--delete`, so QStorage exactly matches the local template folder without affecting any other bucket prefix.

## Route

Open the app with this hash route:

```text
#<chainSlug>:<projectId>
```

Example:

```text
#basesep:19
```

The app also accepts query parameters for local testing:

```text
?chain=base&projectId=123&leagueId=143466
```

The old explicit route also works for direct testing:

```text
#base:123/fpl/143466
```

When the league ID is not present in the route, the app first checks the bundled local mapping and then attempts to resolve the FPL league ID from Juicebox project metadata.

Optional tier overrides:

```text
?tiers=Full%20Season:5:USDC:1,Game%20Week%201:1:USDC:2
```

The tier fields are `name:price:currency:tierId`. `tierId` is the numeric Juicebox 721 tier ID that gets encoded into the V6 pay metadata.
The app normally reads tiers from the active Juicebox 721 hook; this override is for local testing or for projects whose RPC/metadata reads are unavailable.

Optional API override:

```text
?apiBase=https%3A%2F%2Fexample.com%2Fapi%2Ffpl-league%3FleagueId%3D
```

`apiBase` can also include `{leagueId}`:

```text
?apiBase=https%3A%2F%2Fexample.com%2Fapi%2Ffpl-league%2F%7BleagueId%7D
```

The league API must send:

```http
Access-Control-Allow-Origin: *
```

## Behavior

- Resolves known test project IDs locally. The bundled test mapping is `basesep:19 -> 143466`.
- Loads the FPL league leaderboard from `https://fc-footy.vercel.app/api/fpl-league` by default, or from the `apiBase` query parameter. The request includes `includeManagersInfo=1`.
- Renders each manager's compact club badge from the FC-Footy response's `club_badge_src`. The static app never calls the FPL entry endpoint directly.
- Reads the active Juicebox V6 721 shop from `JBDirectory -> controllerOf -> currentRulesetOf -> dataHook`, then loads all tiers with `tiersOf(...)`.
- Resolves tier thumbnails from the hook's `tokenUriResolverOf(...)`, `resolvedUri`, or encoded IPFS metadata.
- Reads project metadata from `JBDirectory.controllerOf(projectId) -> uriOf(projectId)`, falling back to `JBDirectory.PROJECTS().tokenURI(projectId)`, and shows its payment notice.
- Shows a compact header summary with NFT thumbnails, items sold, customer count, and the connected wallet's owned NFT counts when available.
- Lets buyers expand each NFT tier to read its metadata description when one is available.
- Converts each tier price into the exact USDC payment amount with `JBPrices.pricePerUnitOf(...)`, matching JuiceScan's V6 NFT checkout path.
- Requires the buyer to select a manager row.
- Lets the buyer add one or more NFT tiers to a cart.
- Shows an assertion that the buyer is claiming control of the selected FPL entry.
- Requires the buyer to confirm the selected FPL entry with a checkbox before checkout.
- Keeps the payment memo hidden in the UI after manager selection.
- Uses only the FPL entry ID as the Juicebox payment memo.
- Uses JuiceScan-style wallet affordances: provider picker when multiple injected wallets are detected, wallet-app handoff links when none are detected, connected account menu with copy address and disconnect, and remembered provider restore on refresh.
- Lets the buyer connect a browser wallet, approves USDC when needed, and calls `JBMultiTerminal.pay(projectId, token, amount, beneficiary, 0, memo, metadata)` once for the whole cart.
- Encodes cart items in the same V6 721 pay metadata envelope used by JuiceScan, repeating tier IDs by quantity.
- Clears the cart after the wallet returns a successful purchase transaction hash.
- Links to the matching Juicebox V6 project page as `Use on Juicebox`.
- Provides a minimal Claude link seeded with the Juicebox skills repo for creating a similar buyer page.

The app is a starter buyer page. It does not verify that the buyer controls the selected FPL manager entry.
