---
name: fpl-league-nft-shop-deployer
description: Create a reviewable txlink.stupidtech.net URL for deploying a minimal Fantasy Premier League league NFT shop from an FPL league URL and deployer wallet. Use when a user wants an agent to prepare a wallet-signable Juicebox V6 deploy txlink, use a .jb Juicebox draft only as internal deploy settings, set the project owner/operator to the deployer's wallet, default to Base, or generate the resulting static shop URL.
---

# FPL League NFT Shop Deployer

Use this skill to prepare a single reviewable `txlink.stupidtech.net` URL for an FPL league NFT shop deploy. The shop itself is a static site; this skill does not create a backend and does not design a deployment UI.

The deliverable is the txlink URL the deployer can open with their wallet. The `.jb` draft is only an internal source of deploy settings and an optional review artifact; do not stop by handing the user a `.jb` file when an exact txlink can be built.

## Builder Source

Use JuiceScan as the transaction builder reference. Do not look for, install, or depend on a Juicebox SDK. The needed deploy calls are already implemented in JuiceScan with plain `viem` ABI encoding.

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

## Local Validation

When this repo's scripts are available, run the dry-run validation before pinning metadata or building calldata:

```sh
node scripts/validate-fpl-shop-draft.mjs "https://fantasy.premierleague.com/en/leagues/143466/standings/c" "0x..."
```

This script fetches the league through FC-Footy, applies the same draft mutations, and fails if project metadata still contains placeholders, if token issuance is enabled, if either required NFT tier is missing, or if any NFT tier allows credit purchases.

## Source Draft

Use `assets/fpl-insert-league-name-shop.jb` as the source of truth for deploy settings. Treat it as a JuiceScan create-flow draft that must be converted into a wallet-signable txlink.

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
- Use the same image URI for the project logo and every NFT tier image unless the deployer explicitly provides replacements.
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

## Workflow

1. Parse the FPL classic league ID from `/leagues/{leagueId}/standings/c`.
2. Fetch the league through the FC-Footy proxy to verify it exists:
   - `https://fc-footy.vercel.app/api/fpl-league?leagueId={leagueId}`
3. If the league fetch fails, returns a non-2xx response, returns malformed JSON, or does not contain usable league standings/name data, stop. Do not deploy and do not output a txlink.
4. Show the deployer the league name, manager count, and target chain before building the transaction.
5. Load the bundled `.jb` draft and replace placeholders before building project metadata, pinning metadata, or building calldata:
   - `details.name`: `FPL {leagueName} Shop`
   - Replace the literal placeholder name `FPL [insert league name] Shop`; do not leave bracketed placeholder text in metadata or calldata.
   - `details.description`: `This shop is a companion to Fantasy Premier League team #{leagueId} - {leagueName}.`
   - Replace the literal placeholder description `This shop is a companion to Fantasy Premier League team #[insert] - [insert name]`.
   - `details.owner`: deployer wallet
   - `revOperator`: deployer wallet, even though the project type is custom
6. Enforce payment/token/NFT defaults:
   - `stages[*].tokenMode = "none"`
   - `stages[*].weight = "0"`
   - `collection.issueTokensForSplits = false`
   - every NFT tier has `flags.allowCredits = false`
   - the project logo URI and every NFT tier image URI match unless explicitly overridden
7. Set chain/network:
   - `base`: `network = "mainnet"`, `chainIds = [8453]`
   - `basesep`: `network = "testnet"`, `chainIds = [84532]`
8. Build project metadata only from the mutated draft state. In JuiceScan terms, call `buildMetadata(state.details, state.storeCategories)` after replacement, not before.
9. Preflight the draft and metadata. If any of these strings contain `[`, `]`, `insert`, `placeholder`, or the raw template values, stop and report the failed field. Do not pin metadata, build calldata, or output a txlink:
   - `state.details.name`
   - `state.details.description`
   - built project metadata `name`
   - built project metadata `description`
   - every NFT tier metadata `name` and `description`
10. Let the deployer review or edit the final draft only as a pre-transaction review step.
11. Build a fresh Juicebox V6 launch transaction using the JuiceScan create-flow logic listed in **Builder Source**. Do not reuse calldata from an already mined deployment and do not use a Juicebox SDK.
12. Use a fresh deploy salt, current `JBProjects.creationFee()`, and freshly pinned or explicitly supplied project/NFT metadata.
13. Simulate the transaction with `eth_call` from the deployer wallet. If simulation fails, do not output a txlink as signer-ready.
14. Produce a `txlink.stupidtech.net` URL for `eth_sendTransaction`. This is the primary output.
15. Produce the post-deploy static shop URL pattern:
   - `#base:{projectId}/fpl/{leagueId}`

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
- NFT tier metadata URI and encoded IPFS URI
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
   - `FPL {leagueName} Shop`
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

The generated shop is a single static app route:

```text
#<chainSlug>:<projectId>/fpl/<leagueId>
```

Example:

```text
#base:123/fpl/143466
```

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
