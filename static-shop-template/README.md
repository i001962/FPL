# FPL League NFT Shop Static Template

This is a copyable project-specific static app template for FPL league NFT shops. It is intentionally separate from the `fpl-league-nft-shop-deployer` skill so the skill can stay focused on deploy txlinks.

`find.html` preserves the previous league registry concept and copy as an orphaned reference page. It is not part of the supported project-specific buyer app. Its directory lookup expects a separate registry API/proxy to provide its shop list.

`deploy.html` is a lightweight checkout page for paying `basesep:12`. It asks for a league ID, loads league data through the configured browser-readable FPL API, connects a wallet, approves USDC when needed, and pays `$2.00` USDC to the Juicebox project with the payment memo set to the loaded league ID.

## Publishing

Pushing changes to `main` publishes the entire template directory through GitHub Actions. Configure the repository Actions secrets `QSTORAGE_ACCESS_KEY_ID` and `QSTORAGE_SECRET_ACCESS_KEY` first. The workflow uses path-style S3 requests and mirrors `static-shop-template/` to `s3://footy/static-shop-template/` with `--delete`, so QStorage exactly matches the local template folder without affecting any other bucket prefix.

For a deliberate local recovery only:

```sh
QSTORAGE_BUCKET=footy scripts/upload-static-shop-template-qstorage.sh
```

## Route

Set `DEFAULT_PROJECT_ROUTE` near the top of `index.html` to the deployed project route before publishing a project-specific copy. This makes the bare app URL open its shop without a fragment while preserving the reusable hash-route behavior.

If `DEFAULT_PROJECT_ROUTE` is blank and no hash or query route is supplied, the app shows a configuration error. It does not include a global FPL shop directory or proxy.

Open the app with this hash route to select or override a project:

```text
#<chainSlug>:<projectId>
```

Example:

```text
#basesep:19
```

For example, after setting `DEFAULT_PROJECT_ROUTE = 'basesep:19'`, both of these load project 19:

```text
https://example.com/index.html
https://example.com/index.html#basesep:19
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
- Loads the FPL league leaderboard in the browser from `https://fc-footy.vercel.app/api/fpl-league` by default, or from the `apiBase` query parameter. The request includes `includeManagersInfo=1`.
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

The app is a starter buyer page. It does not verify that the buyer controls the selected FPL manager entry.
