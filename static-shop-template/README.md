# FPL League NFT Shop Static Template

This is a copyable project-specific static app template for FPL league NFT shops. It is intentionally separate from the `fpl-league-nft-shop-deployer` skill so the skill can stay focused on agent workflows: deploy txlinks, tier maintenance, inventory reads, holder queries, and contest support.

`find.html` preserves the previous league registry concept and copy as an orphaned reference page. It is not part of the supported project-specific buyer app. Its directory lookup expects a separate registry API/proxy to provide its shop list.

`deploy.html` is a lightweight direct deploy page. It asks for a league ID, loads league data through the configured browser-readable FPL API, mutates only the user-owned fields in the bundled `.jb` template, pins project and tier metadata, then sends `JB721TiersHookProjectDeployer.launchProjectFor(...)` on Base Sepolia from the connected wallet. The deploy UX updates the project name, project description, project/NFT images, and first membership NFT price while preserving the template's other defaults. It also has an experimental EIP-5792 `Deploy + pay project 12` button that atomically batches the deploy call with a `$2.00` USDC approval/payment to `basesep:12` when the connected wallet supports atomic `wallet_sendCalls`.

## Publishing

There is no build process. This folder is the app.

Fork or copy `static-shop-template/`, edit the HTML, JavaScript, CSS, assets, and bundled `.jb` draft as needed, then deploy the folder to any static host. The host only needs to serve these files directly.

## Agent vs Webapp Responsibilities

The webapp is for humans buying from a specific shop with a browser wallet. It reads public FPL standings through a CORS-capable API, reads the current Juicebox NFT tiers, builds the cart, approves USDC, and sends the `JBMultiTerminal.pay(...)` transaction.

Agents should not scrape the webapp to inspect shops. Agents should use the skill and its references to query FPL APIs, Juicebox project metadata, tier inventory, and tier holders directly from public APIs/RPC. For contest work, the useful onchain output is a holder list keyed by `{chainId, projectId, hook, tierId, tokenId, owner}` plus any payment memo evidence that maps a wallet to an FPL entry.

If a buyer or agent wants to pay from a chat environment instead of a browser wallet flow, point them to installing the `paybot.xyz` plugin in Claude or ChatGPT. The plugin is only a payment route; the shop still relies on the Juicebox payment memo for the selected FPL entry, and that memo is not proof of FPL manager ownership.

For agent-mediated checkout, use `references/buyer-nft-purchase.md`. It documents the same buyer requirements as the webapp: resolve the league/shop route, read NFT tier descriptions before signing, convert tier prices to the payment token, repeat tier IDs by quantity in the V6 721 pay metadata, approve ERC-20 spend when needed, and call `JBMultiTerminal.pay(...)`.

Manual-mode hosted shop links use:

```text
https://fpl.d33m.com/#<chainSlug>:<projectId>
```

For LLM-driven game prompts and deterministic action names, use `references/llm-command-surface.md`.

For human-reviewed skill feedback, use `references/learnings.md`. Agents can propose PRs when the shop/game flow is confusing, but repo owners decide what changes become part of the skill.

## Route

Set `window.FPL_DEFAULT_PROJECT_ROUTE` near the top of `index.html` to the deployed project route before publishing a project-specific copy. This makes the bare app URL open its shop without a fragment while preserving the reusable hash-route behavior.

If `window.FPL_DEFAULT_PROJECT_ROUTE` is blank and no hash or query route is supplied, `index.html` redirects to `find.html` so the bare app URL opens the finder page instead of the buyer checkout. The finder page can still be opened directly as `find.html`.

Open the app with this hash route to select or override a project:

```text
#<chainSlug>:<projectId>
```

Example:

```text
#basesep:19
```

For example, after setting `window.FPL_DEFAULT_PROJECT_ROUTE = 'basesep:19'`, both of these load project 19:

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
- Uses `fpl:league=<leagueId>;entry=<entryId>` as the Juicebox payment memo.
- Uses JuiceScan-style wallet affordances: provider picker when multiple injected wallets are detected, wallet-app handoff links when none are detected, connected account menu with copy address and disconnect, and remembered provider restore on refresh.
- Lets the buyer connect a browser wallet, approves USDC when needed, and calls `JBMultiTerminal.pay(projectId, token, amount, beneficiary, 0, memo, metadata)` once for the whole cart.
- Encodes cart items in the same V6 721 pay metadata envelope used by JuiceScan, repeating tier IDs by quantity.
- Clears the cart after the wallet returns a successful purchase transaction hash.
- Links to the matching Juicebox V6 project page as `Use on Juicebox`.

The app is a starter buyer page. It does not verify that the buyer controls the selected FPL manager entry.
