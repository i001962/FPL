---
name: fpl-league-nft-shop-deployer
description: Create a reviewable txlink.stupidtech.net URL for deploying or maintaining a minimal Fantasy Premier League league NFT shop. Use when a user wants an agent to prepare a wallet-signable Juicebox V6 deploy txlink, use a .jb Juicebox draft only as internal deploy settings, set the project owner/operator to the deployer's wallet, default to Base, generate the resulting static shop URL, or add/remove NFT tiers in an existing shop.
---

# FPL League NFT Shop Deployer

Use this skill to prepare reviewable `txlink.stupidtech.net` URLs for FPL league NFT shop deploys and existing-shop NFT tier maintenance. The shop itself is a static site; this skill does not create a backend and does not generate or design a frontend during deploy work.

The deliverable is either a completed wallet transaction sent by the acting agent from an authorized wallet, or a txlink URL the deployer/operator can open with their own wallet. The `.jb` draft is only an internal source of deploy settings and an optional review artifact; do not stop by handing the user a `.jb` file when an exact txlink can be built.

## Signing And Handoff

For deploys and existing-shop maintenance, always choose one of these paths before building calldata:

- **Agent wallet path**: if the acting agent has an authorized wallet for the target chain and the user explicitly wants the agent to send the transaction, prepare, simulate, show the decoded transaction for review, then send it from that wallet only after approval.
- **Operator txlink path**: if the acting agent does not have a wallet, should not custody/sign, or the user/deployer/operator should sign, prepare and simulate the exact transaction and return a `txlink.stupidtech.net` URL for the operator wallet.

Do not leave the user with only instructions, ABI fragments, metadata JSON, or a `.jb` file when a concrete transaction can be sent or represented as a txlink.

## Frontend Template

Do not create frontend code as part of this skill's txlink workflow. A copyable static frontend template is maintained separately in this repo at:

```text
static-shop-template/index.html
```

The template is intended to be uploaded once to QStorage and reused by league deployers who want a starter buyer page. After the template is uploaded, record the public app URL here:

```text
https://qstorage.quilibrium.com/footy/static-shop-template/index.html
```

Until the QStorage URL is filled in, reference the local `static-shop-template/index.html` artifact as the source to upload or copy. The deploy skill should still return the post-deploy route pattern:

```text
#<chainSlug>:<projectId>
```

Example copied onto the pinned template:

```text
https://qstorage.quilibrium.com/footy/static-shop-template/index.html#basesep:19
```

The template is a starter UI only. It resolves known test project IDs locally, loads the FPL leaderboard through FC-Footy, requires a manager and tier selection, derives `fpl:league={leagueId};entry={entryId}`, and points the buyer to the Juicebox project page. It does not replace the signer-reviewed deploy txlink, and it does not make the FPL manager-to-wallet link strong.

For a project-specific hosted copy, set `DEFAULT_PROJECT_ROUTE` in the copied template to the deployed `chainSlug:projectId` before publishing. The page must then load that project with no URL fragment, while an explicit `#<chainSlug>:<projectId>` fragment continues to override the default for reusable multi-project hosting.

The league data endpoint used by the template must allow browser reads from the QStorage origin. If FC-Footy is used, `GET /api/fpl-league` must send `Access-Control-Allow-Origin: *`. The template also accepts an `apiBase` query parameter for another CORS-capable endpoint.

## Static Template Release

When changing the reusable static buyer app or its QStorage upload script, release it in this order:

1. Validate the changed static HTML/JavaScript.
2. Commit only the intended template, script, skill, workflow, and documentation changes, then push `main` to GitHub.
3. Let `.github/workflows/deploy-static-shop-template.yml` publish the template. Configure these repository Actions secrets before the first release:
   - `QSTORAGE_ACCESS_KEY_ID`
   - `QSTORAGE_SECRET_ACCESS_KEY`
   The workflow uses path-style S3 requests, QStorage's documented `q-world-1` signing region, and runs `aws s3 sync --delete` from `static-shop-template/` to `s3://footy/static-shop-template/`. It uploads the full folder tree and deletes only stale files inside that prefix. Never sync to `s3://footy/`, which could delete unrelated bucket contents.
4. Confirm the GitHub Actions run succeeds and the public app URL returns HTTP 200:
   ```text
   https://qstorage.quilibrium.com/footy/static-shop-template/index.html
   ```

Do not use a local QStorage credential as the normal release path. Do not claim the static template release is complete until the GitHub push, Actions run, and QStorage verification all succeed. Keep the repository skill and the installed Codex skill copy in sync whenever this workflow changes.

## Builder Source

Use JuiceScan as the transaction builder reference. Do not look for, install, or depend on a Juicebox SDK. The needed deploy calls are already implemented in JuiceScan with plain `viem` ABI encoding.

Assume the acting agent may have access to a browser and can use the Juicebox/JuiceScan deployer webapp as the primary builder when local builder files are unavailable or slower than using the app directly. Prefer the webapp when it can produce or expose the exact deploy transaction for wallet review/signing. Browser-driven use is acceptable if the agent can inspect the resulting transaction request, decoded call, metadata URIs, target contract, value, chain ID, and any simulation or wallet warning before producing a txlink.

When using the deployer webapp:

- Open the create/deploy flow in the browser and populate it from the mutated FPL draft state, not from unresolved placeholders.
- Use the browser's devtools/network/app state, exported draft, wallet transaction preview, or txlink/share output to capture the exact `{to,data,value,chainId}` request.
- Confirm the deployer wallet is owner/operator and that the selected chain matches the requested target.
- Confirm project metadata and every NFT tier metadata URI reflect the resolved league and tier values.
- Confirm the app simulation/wallet preview does not warn that the transaction is likely to fail.
- If the webapp only prepares an unsigned wallet prompt and does not expose transaction data or txlink parameters, stop and report that browser access alone was insufficient.

Use these JuiceScan files and functions:

- `src/create-flow.js`
  - `buildLaunchArgs(state, chainId, owner, projectUri, salt, deployStart)`
  - `build721Config(state, projectUri, chainId)`
  - `buildMetadata(details, storeCategories)`
  - `deploySalt(...)`
  - `creationFeeOf(chainId)` if available locally; otherwise mirror the small `JBProjects.creationFee()` read from this file.
  - test export `__test` exposes most pure builder helpers.
- `src/component-base.js`
  - `buildTxLinkEntries(payload)` shows the canonical txlink shape.
- `src/ipfs-pin.js`
  - `pinJson(obj, name)`
  - `encodeIpfsUriToBytes32(uri)`
- `src/nft721-build.js`
  - `build721TierMetadata(...)`

If JuiceScan is not already local, clone `https://github.com/mejango/juicescan` or fetch the unminified static bundle and inspect those files. Installing JuiceScan's own dependencies is acceptable only to run its existing builder/tests. Do not install a separate Juicebox SDK or generate calldata from third-party abstractions.

For this FPL shop, the expected deploy path is the single-chain NFT shop path:

```text
JB721TiersHookProjectDeployer.launchProjectFor(
  owner,
  build721Config(state, projectUri, chainId),
  { projectUri, rulesetConfigurations, terminalConfigurations, memo: "" },
  JBController address,
  fresh salt
)
```

If the deployer explicitly chooses multiple chains, JuiceScan's omnichain `launchProjectFor` path produces one txlink per chain. Do not collapse multiple chain deploys into one JSON-RPC request.

## Metadata Pinning

Unique project and NFT tier JSON metadata must be pinned for each league shop because names/descriptions include the league and tier details. Reuse the default pinned image URI already in the `.jb` draft for `image`/`logoUri`, but still create fresh JSON metadata for:

- project metadata
- `Full Season` tier metadata
- `Game Week 1` tier metadata

Choose the pinning path explicitly:

1. Prefer the Footy app pinning endpoint when reachable:

   ```http
   POST https://fc-footy.vercel.app/api/ipfs/pin-json
   Authorization: Bearer madeskills
   Content-Type: application/json
   ```

   Request body:

   ```json
   {
     "name": "fpl-143466-project.json",
     "json": {
       "name": "FPL Farcaster Fantasy League Shop",
       "projectTagline": "Buy in for more fun",
       "description": "This shop is a companion to Fantasy Premier League team #143466 - Farcaster Fantasy League.",
       "logoUri": "ipfs://...",
       "infoUri": "",
       "twitter": "",
       "discord": "",
       "telegram": "",
       "tags": ["fpl", "fpl-league:143466"],
       "fpl": {
         "leagueId": "143466"
       }
     }
   }
   ```

   Use the returned `uri` field as the `ipfs://...` metadata URI. The endpoint handles Pinata auth server-side; do not send `PINATA_JWT` to it.
2. If `PINATA_JWT` or an equivalent Pinata API credential is available locally, use JuiceScan's `pinJson(obj, name)` flow.
3. If the acting agent has a wallet/payment capability for Base USDC, it may use Pinata's x402 public pinning flow, such as `https://402.pinata.cloud/v1/pin/public`, with `@x402/fetch`/`@x402/axios` or equivalent x402 client code.
4. If the acting agent does not have a wallet/payment capability, do not assume it can use x402 directly. Create a user handoff instead:
   - write or display the exact JSON metadata payloads that need pinning
   - identify the required Pinata x402 endpoint and payment network/token
   - use a txlink handoff for any EVM payment transaction only when the x402/payment flow exposes a concrete `{to,data,value,chainId}` transaction payload
   - otherwise stop before deploy txlink generation and ask the user to run the x402 pinning step in a wallet-capable environment or provide the resulting IPFS URIs

Do not output a deploy txlink until all three metadata URIs are known and the NFT tier metadata URI has been converted with `encodeIpfsUriToBytes32(uri)`.

## Local Validation

When this repo's scripts are available, run the dry-run validation before pinning metadata or building calldata:

```sh
node scripts/validate-fpl-shop-draft.mjs "https://fantasy.premierleague.com/en/leagues/143466/standings/c" "0x..."
```

For one-off tier price edits, validate the temporary deploy-state override without editing the bundled asset:

```sh
node scripts/validate-fpl-shop-draft.mjs "https://fantasy.premierleague.com/en/leagues/143466/standings/c" "0x..." --tier-price "Game Week 1=1"
```

This script fetches the league through FC-Footy, applies the same draft mutations, and fails if project metadata still contains placeholders, if token issuance is enabled, if either required NFT tier is missing, or if any NFT tier allows credit purchases.

## Existing Shop Tier Adjustments

Use this workflow when the operator wants to remove an NFT tier from an existing shop or add a new NFT tier after deploy. The output is one or more wallet-signable txlinks that call the existing shop's `JB721TiersHook.adjustTiers(tiersToAdd, tierIdsToRemove)`.

Default to the existing-shop path for requests like "add Game Week 3" unless the operator explicitly says the shop has not been deployed yet or asks to change the initial deploy transaction. Keep the operator prompt short: once the project/shop can be inferred, ask only for the new tier's price, description, and image choice. Use the defaults below for everything else and show them in the review step.

1. Resolve the exact shop hook before building calldata:
   - read `JBDirectory.controllerOf(projectId)`
   - read `currentRulesetOf(projectId)` from the controller
   - use the active pay data hook or omnichain tiered hook resolution described in the static template
   - confirm the final `to` address is the project's `JB721TiersHook`, not a project controller, terminal, or unrelated contract
2. For tier removals, ask the operator for the tier IDs to remove and show the tier names/metadata before encoding. Do not remove a tier unless the operator confirms the exact IDs. If a tier has `cantBeRemoved = true`, report that it cannot be removed and do not include it in `tierIdsToRemove`.
3. For each new NFT tier, infer the tier name from the request when possible, such as `Game Week 3` from "add Game Week 3". Ask the operator only for values that cannot be inferred:
   - price
   - description; offer a default like `Game Week 3 buy-in is eligible for gameweek rewards split.`
   - image choice: reuse an existing/default image, provide an `ipfs://...` image URI or file, or have the agent generate and pin one
   Do not ask for supply, split recipient, or split percent unless existing shop data cannot be read or the operator explicitly wants to change them.
4. Defaults for added tiers:
   - Treat the request as an existing deployed shop `adjustTiers` change, not an initial deploy edit.
   - Use unlimited sale supply by default: `initialSupply = 999999999`.
   - Use the existing shop/default tier split configuration by default. Read a comparable existing tier or shop settings and reuse its split recipient, split percent, project ID, `preferAddToBalance`, `lockedUntil`, and hook. If no existing split can be read, ask for the split beneficiary before continuing.
   - Use `votingUnits = 0`, `reserveFrequency = 0`, `reserveBeneficiary = 0x0000000000000000000000000000000000000000`, `category = 0`, and `discountPercent = 0` unless explicitly requested otherwise.
5. Image handling for new tiers:
   - If the operator provides an image URI or file, use it after confirming it renders.
   - If no image is provided, offer to generate one, then get operator approval before pinning.
   - Pin image assets first when needed, then pin the tier JSON metadata with `name`, `description`, and `image`.
   - Convert the final tier metadata `ipfs://...` URI to `encodedIpfsUri` with JuiceScan's `encodeIpfsUriToBytes32(uri)` path.
6. Price handling:
   - Do not invent a price. Ask for one if missing.
   - Confirm the displayed human price and the encoded `uint104 price` units before txlink generation.
   - If the shop prices tiers in USD with 6 decimals, `1` USDC-like dollar is encoded as `1000000`; otherwise read the hook's pricing context and use that unit system.
7. New tier flags must prevent credit claims:
   - `allowOwnerMint = false` unless explicitly requested
   - `useReserveBeneficiaryAsDefault = false`
   - `transfersPausable = false` unless explicitly requested
   - `useVotingUnits = false` unless explicitly requested
   - `cantBeRemoved = false` unless the operator intentionally wants the tier permanent
   - `cantIncreaseDiscountPercent = true`
   - `cantBuyWithCredits = true`
8. Splits:
   - Show every split recipient address, percent, project ID, `preferAddToBalance`, `lockedUntil`, and hook.
   - Do not default a fund recipient silently. If the split beneficiary is missing, ask for it.
   - A single 100% payout split is encoded with `percent = 1000000000`.
9. Build `adjustTiers` calldata with:
   ```text
   adjustTiers(
     tiersToAdd: JB721TierConfig[],
     tierIdsToRemove: uint256[]
   )
   ```
   Each `JB721TierConfig` must include `price`, `initialSupply`, `votingUnits`, `reserveFrequency`, `reserveBeneficiary`, `encodedIpfsUri`, `category`, `discountPercent`, `flags`, `splitPercent`, and `splits`.
10. Preflight before returning txlinks:
   - Decode the calldata and show the operator the exact add/remove changes.
   - Confirm `cantBuyWithCredits = true` for every added tier.
   - Confirm native `value = 0x0`.
   - Simulate the transaction with `eth_call` from the operator wallet.
   - If simulation fails, do not output the txlink as signer-ready.
11. Txlink output for tier adjustments:
    - `to` is the resolved `JB721TiersHook` address.
    - `data` is the encoded `adjustTiers` call.
    - `value` is `0x0`.
    - `chainId` is the target chain.
    - Omit `from` in the txlink params so the connected wallet supplies the signer.

## Source Draft

Use `assets/fpl-insert-league-name-shop.jb` as the source of truth for deploy settings. Treat it as a JuiceScan create-flow draft that must be converted into a wallet-signable txlink.

For an individual deploy request, do not edit `assets/fpl-insert-league-name-shop.jb` unless the user explicitly asks to change the default skill/template in the repo. Load the draft into memory, clone it into a temporary deploy state, apply league/wallet/chain/tier edits to that deploy state, then build metadata and calldata from the mutated deploy state. If a review artifact is useful, write a generated draft under `drafts/` or `/tmp`, not back into `assets/`.

The draft is intentionally opinionated:

- Custom Juicebox project, not a revnet.
- Base is the production default; Base Sepolia is acceptable for tests.
- Accepts USDC.
- Accepts payments but does not issue project tokens when paid.
- Does not deploy or require a fungible project token.
- Includes two initial NFT tiers:
  - `Full Season`, priced at `5`.
  - `Game Week 1`, priced at `5`.
- NFT tiers must not be buyable with credits. Set every tier's `flags.allowCredits` to `false`.
- Cash outs are disabled.
- Owner/operator should be the deployer wallet.
- Use the same default pinned image URI for the project logo and every NFT tier image unless the deployer explicitly provides replacements. This URI is already in the `.jb` draft and can be reused; do not block txlink creation just to pin new image files.
- The generated shop links FPL managers to buyers only through the Juicebox payment memo.

## Required Inputs

Ask for missing values only when they cannot be inferred:

- FPL league URL, for example `https://fantasy.premierleague.com/en/leagues/143466/standings/c`.
- Deployer wallet address.
- Target chain, default `base` / chain ID `8453`.

Optional edits:

- League display name.
- NFT tier name, description, price, supply, image, or split recipients.
- Project tagline or description.
- Project metadata links/socials: `infoUri`, `twitter`, `discord`, `telegram`. Ask for these when preparing metadata, but do not require them. Include all four keys in project metadata even when the values are blank strings.

Apply optional edits to the temporary deploy state only. Example: if the user says “change the price of Game Week 1 NFT to $1 and build me the txlink,” set only the deploy state's `nfts[]` item with `name === "Game Week 1"` to `price = "1"` before validation/pinning/calldata. Do not modify the bundled asset or commit a template change for that one-off deploy.

## Workflow

1. Parse the FPL classic league ID from `/leagues/{leagueId}/standings/c`.
2. Fetch the league through the FC-Footy proxy to verify it exists:
   - `https://fc-footy.vercel.app/api/fpl-league?leagueId={leagueId}`
3. If the league fetch fails, returns a non-2xx response, returns malformed JSON, or does not contain usable league standings/name data, stop. Do not deploy and do not output a txlink.
4. Show the deployer the league name, manager count, and target chain before building the transaction.
5. Load the bundled `.jb` draft and replace placeholders before building project metadata, pinning metadata, or building calldata:
   - `details.name`: `{normalizedLeagueName} Shop`, where `{normalizedLeagueName}` is `{leagueName}` if it already starts with `FPL`, otherwise `FPL {leagueName}`. Do not produce doubled names such as `FPL FPL Community on Clubhouse Shop`.
   - Replace the literal placeholder name `FPL [insert league name] Shop`; do not leave bracketed placeholder text in metadata or calldata.
   - `details.description`: `This shop is a companion to Fantasy Premier League team #{leagueId} - {leagueName}.`
   - Replace the literal placeholder description `This shop is a companion to Fantasy Premier League team #[insert] - [insert name]`.
   - Ask the deployer for optional project metadata `infoUri`, `twitter`, `discord`, and `telegram`. If omitted, set each to `""`; do not omit the keys from metadata.
   - Project metadata must include canonical machine-readable FPL context:
     ```json
     {
       "infoUri": "",
       "twitter": "",
       "discord": "",
       "telegram": "",
       "tags": ["fpl", "fpl-league:{leagueId}"],
       "fpl": {
         "leagueId": "{leagueId}"
       }
     }
     ```
     Keep the description human-readable, but do not rely on parsing the description for the league ID.
   - `details.owner`: deployer wallet
   - `revOperator`: deployer wallet, even though the project type is custom
6. Enforce payment/token/NFT defaults:
   - `stages[*].tokenMode = "none"`
   - `stages[*].weight = "0"`
   - `collection.issueTokensForSplits = false`
   - every NFT tier has `flags.allowCredits = false`
   - every NFT tier uses `state.details.logoUri` as `imageUri` unless explicitly overridden
   - if the default image URI is used, tell the deployer the project and NFT images can be changed later in Juicebox/Juicebox Money
7. Set chain/network:
   - `base`: `network = "mainnet"`, `chainIds = [8453]`
   - `basesep`: `network = "testnet"`, `chainIds = [84532]`
8. Build project metadata only from the mutated draft state. In JuiceScan terms, call `buildMetadata(state.details, state.storeCategories)` after replacement, not before.
9. Preflight the draft and metadata. If any of these strings contain `[`, `]`, `insert`, `placeholder`, or the raw template values, stop and report the failed field. Do not pin metadata, build calldata, or output a txlink:
   - `state.details.name`
   - `state.details.description`
   - built project metadata `name`
   - built project metadata `description`
   - built project metadata includes `infoUri`, `twitter`, `discord`, and `telegram` keys, with blank strings when unset
   - built project metadata `fpl.leagueId` exactly matches the resolved numeric league ID as a string
   - built project metadata `tags` is exactly `['fpl', 'fpl-league:{leagueId}']`, with `{leagueId}` replaced by the resolved numeric ID
   - every NFT tier metadata `name` and `description`
10. Let the deployer review or edit the final draft only as a pre-transaction review step.
11. Build a fresh Juicebox V6 launch transaction using the JuiceScan create-flow logic listed in **Builder Source**. Do not reuse calldata from an already mined deployment and do not use a Juicebox SDK.
12. Use a fresh deploy salt, current `JBProjects.creationFee()`, and freshly pinned or explicitly supplied project/NFT metadata. Follow **Metadata Pinning**; do not assume the agent has a wallet for x402.
13. Simulate the transaction with `eth_call` from the deployer wallet. If simulation fails, do not output a txlink as signer-ready.
14. Produce a `txlink.stupidtech.net` URL for `eth_sendTransaction`. This is the primary output.
15. Produce the post-deploy static shop URL pattern:
   - `#base:{projectId}`

Do not finish with only `.jb` JSON. If exact calldata is ready, output the txlink. If exact calldata is not ready, report the specific blocker that prevents txlink generation.

## Txlink Rules

Follow JuiceScan's txlink convention:

- Use `https://txlink.stupidtech.net/`.
- Set `method=eth_sendTransaction`.
- Set `chainId` to the chosen chain ID.
- Set `params` to JSON with `to`, `data`, and `value`.
- Do not include `from`; txlink should use the wallet that opens it.

Build the deploy txlink from a JuiceScan launch plan:

```js
const plan = buildLaunchArgs(state, chainId, owner, projectUri, salt, deployStart);
plan.value = await creationFeeOf(chainId);
const data = encodeFunctionData({
  abi: plan.abi,
  functionName: plan.functionName || 'launchProjectFor',
  args: plan.args,
});
const params = {
  to: plan.address,
  data,
  value: '0x' + BigInt(plan.value).toString(16),
};
const url = new URL('https://txlink.stupidtech.net/');
url.searchParams.set('method', 'eth_sendTransaction');
url.searchParams.set('chainId', String(chainId));
url.searchParams.set('params', JSON.stringify(params));
```

Before returning the URL, simulate the same `{ to, data, value }` with `eth_call` or JuiceScan's `simulateTransaction` path from the deployer wallet. A warning such as "This transaction is likely to fail" means the URL is not done.

The txlink represents the exact deploy transaction. The deployer can review it with their LLM or inspect the decoded transaction before signing, but the final artifact remains a URL, not a `.jb` file.

The exact txlink cannot be produced from the raw `.jb` draft alone. First produce or resolve:

- final deployer wallet owner/operator fields
- final chain
- project metadata URI
- NFT tier metadata URI and encoded IPFS URI. Use the existing pinned default image URI inside newly built tier metadata when no custom image was supplied; only the small JSON metadata needs to be pinned for the league/tier names and descriptions.
- current `JBProjects.creationFee()`
- final contract address and calldata from the JuiceScan builder

If metadata still needs pinning, stop before txlink generation and report what must be pinned. Once pinned, resume and generate the txlink.

## Transaction Template Rules

A previously successful deploy transaction can be useful as a template, but it is not itself the txlink.

Never create a deploy txlink by copying the raw calldata from a mined deploy transaction. A Juicebox deploy can include one-time deploy parameters such as salts, project/accounting state, fee values, signatures, or deterministic contract deployment inputs. Replaying that calldata is likely to revert.

When the user provides a successful transaction hash or decoded JuiceScan/Juicebox transaction example:

1. Fetch and decode the transaction.
2. Treat the decoded call shape, target contract, and known metadata values as canonical inputs.
3. Parse the FPL league URL and fetch the league through FC-Footy.
4. Replace project strings with the resolved league:
   - `{normalizedLeagueName} Shop`, where `{normalizedLeagueName}` is `{leagueName}` if it already starts with `FPL`, otherwise `FPL {leagueName}`
   - `This shop is a companion to Fantasy Premier League team #{leagueId} - {leagueName}.`
5. Rebuild and repin project metadata from the resolved league values. Do not reuse a template `projectUri` if its metadata still says `FPL [insert league name] Shop`.
6. Preflight decoded/rebuilt metadata. If any project or NFT metadata field contains `[`, `]`, `insert`, `placeholder`, or the raw template values, stop and report the failed field.
7. Replace every owner/operator/beneficiary field that is meant to belong to the deployer wallet. Do this through decoded ABI arguments or JuiceScan builder state, not by hex string search/replace.
8. Preserve intentional split recipients unless the user asks to change them.
9. Generate a new salt or use JuiceScan's current launch builder so deterministic deployment inputs are fresh.
10. Read the current creation fee from the selected chain.
11. Encode fresh calldata for the same launch function.
12. Simulate the fresh transaction with `eth_call` from the deployer wallet.
13. Only then output the txlink.

If you cannot decode the transaction or cannot rebuild fresh calldata, say that explicitly. Do not hand back a txlink built from replayed calldata.

## Decoded Transaction Examples

If the user provides a decoded JuiceScan/Juicebox transaction example, treat it as canonical transaction-building input. Do not block on `PINATA_JWT` or empty `.jb` metadata fields when the example already includes:

- target chain and chain ID
- deploy contract address
- `launchProjectFor` arguments
- `projectUri` / `contractUri`
- NFT `encodedIpfsUri`
- `JBProjects.creationFee()` / transaction value
- controller address and salt
- example calldata

In this case:

1. Extract the decoded transaction fields from the example.
2. Update only the requested fields, typically owner/operator wallet and project/shop display strings.
3. Encode fresh calldata for the same `launchProjectFor` overload.
4. Verify the generated placeholder calldata matches the provided example before applying substitutions when an example calldata field is available.
5. Build the txlink from `{to, data, value}` and `chainId`.

Do not tell the user there is no valid txlink solely because the `.jb` draft has `nfts[0].metaUri` or `nfts[0].encodedIpfsUri` empty if the decoded transaction example already supplies the final metadata URI and encoded IPFS URI.

## Static Shop Rules

The generated shop accepts a hash route:

```text
#<chainSlug>:<projectId>
```

Example:

```text
#basesep:19
```

When a deployer publishes a project-specific copy, set its `DEFAULT_PROJECT_ROUTE` to the deployed `chainSlug:projectId` so the bare app URL loads that shop. Keep hash routes enabled as an override for shared or multi-project copies. Leave `DEFAULT_PROJECT_ROUTE` blank for a shared directory deployment; it then opens the league finder and queries the same-origin Bendystraw proxy at `/api/shops`.

For testing, the static template maps `basesep:19` to FPL league `143466` locally. Production shops must include `fpl.leagueId` and the indexed tags `fpl` plus `fpl-league:{leagueId}` in project metadata. The directory uses Bendystraw's `tags_has` filter to locate a league shop, then verifies `metadata.fpl.leagueId`; a temporary description fallback only supports legacy untagged projects. For Juicebox V6, read project metadata from the active controller via `JBDirectory.controllerOf(projectId)` then `IJBProjectUriRegistry.uriOf(projectId)`; `JBProjects.tokenURI(projectId)` may be empty.

Buyer flow:

1. Load the FPL league leaderboard from FC-Footy.
2. Require the buyer to select a manager row from the leaderboard.
3. Derive the payment memo from the selected row:
   - `fpl:league={leagueId};entry={entryId}`
4. Derive the payment amount from the selected NFT tier price.
5. Do not allow a freeform memo or freeform amount in v1.
6. Let the buyer approve USDC when needed, then buy the NFT.
7. Mark NFT ownership by matching onchain payment/NFT data to memo entry IDs.

## Output Format

Return:

- league ID and league name used
- deployer wallet used as owner/operator
- target chain
- txlink URL for the exact deploy transaction
- static shop URL pattern
- blockers only if metadata pinning, chain reads, or creation fee lookup prevent txlink generation

Do not provide a `.jb` file as the main result. Mention any `.jb` edits only as supporting context for the txlink.

Do not imply that the FPL manager to wallet link is verified. State that it is memo-based and weak.
