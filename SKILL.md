---
name: fpl-league-nft-shop-deployer
description: Create a reviewable Juicebox V6 txlink for deploying a minimal Fantasy Premier League league NFT shop from an FPL league URL and deployer wallet. Use when a user wants an agent to deploy or prepare an FPL league NFT shop, use a .jb Juicebox draft, set the project owner/operator to the deployer's wallet, default to Base, generate a static shop URL, or produce a txlink.stupidtech.net transaction for wallet signing.
---

# FPL League NFT Shop Deployer

Use this skill to prepare a single reviewable Juicebox deploy transaction for an FPL league NFT shop. The shop itself is a static site; this skill does not create a backend and does not design a deployment UI.

## Source Draft

Use `assets/fpl-insert-league-name-shop.jb` as the source of truth for deploy settings. Treat it as a JuiceScan create-flow draft.

The draft is intentionally opinionated:

- Custom Juicebox project, not a revnet.
- Base is the production default; Base Sepolia is acceptable for tests.
- Accepts USDC.
- Uses project credits only; do not deploy or require a fungible token.
- Includes one initial NFT tier: `Full Season`, priced at `5`.
- Cash outs are disabled.
- Owner/operator should be the deployer wallet.
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
3. Show the deployer the league name, manager count, and target chain before building the transaction.
4. Load the bundled `.jb` draft and replace placeholders:
   - `details.name`: `FPL {leagueName} Shop`
   - `details.description`: `This shop is a companion to Fantasy Premier League league #{leagueId} - {leagueName}.`
   - `details.owner`: deployer wallet
   - `revOperator`: deployer wallet, even though the project type is custom
5. Set chain/network:
   - `base`: `network = "mainnet"`, `chainIds = [8453]`
   - `basesep`: `network = "testnet"`, `chainIds = [84532]`
6. Let the deployer review or edit the final draft. Keep the `.jb` JSON editable.
7. Build the exact Juicebox V6 launch transaction using the JuiceScan create-flow logic.
8. Produce a `txlink.stupidtech.net` URL for `eth_sendTransaction`.
9. Produce the post-deploy static shop URL pattern:
   - `#base:{projectId}/fpl/{leagueId}`

## Txlink Rules

Follow JuiceScan's txlink convention:

- Use `https://txlink.stupidtech.net/`.
- Set `method=eth_sendTransaction`.
- Set `chainId` to the chosen chain ID.
- Set `params` to JSON with `to`, `data`, and `value`.
- Do not include `from`; txlink should use the wallet that opens it.

The exact txlink cannot be produced from the raw `.jb` draft alone. First produce or resolve:

- final deployer wallet owner/operator fields
- final chain
- project metadata URI
- NFT tier metadata URI and encoded IPFS URI
- current `JBProjects.creationFee()`
- final contract address and calldata from the JuiceScan builder

If metadata still needs pinning, stop before txlink generation and report what must be pinned.

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
- any final `.jb` edits made
- txlink URL, if exact calldata is ready
- static shop URL pattern
- blockers, if metadata pinning, chain reads, or creation fee lookup are incomplete

Do not imply that the FPL manager to wallet link is verified. State that it is memo-based and weak.
