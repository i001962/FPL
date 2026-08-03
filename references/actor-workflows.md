# FPL Shop Actor Workflows

## Purpose

Use this reference when a request is about what a person, wallet, FPL manager, or agent is trying to do around an FPL league NFT shop. Start by classifying the actor and the requested action, then route to the narrowest workflow that completes the job.

The same human can occupy multiple roles. A deployer is normally also the shop owner/operator. A buyer or contest entrant might or might not manage an FPL team. A wallet can hold an NFT without being the wallet that originally selected an FPL entry in the payment memo.

## Actors

### Deployer / Shop Owner / Operator

This actor controls or is expected to control the Juicebox project owner/operator wallet.

They want to:

- Create a league shop for an FPL classic league.
- Choose the target chain, defaulting to Base for production and Base Sepolia for tests.
- Set owner/operator wallet fields.
- Review league metadata, project metadata, NFT tier metadata, prices, supply, and images before signing.
- Receive a signer-ready txlink or have an explicitly authorized agent wallet send the transaction after review.
- Publish a project-specific static buyer page after deployment.
- Add, remove, or update contest tiers on an existing shop.
- Inspect live shop inventory, availability, holder counts, and whether tiers can be bought with credits.
- Settle operational questions such as which wallet receives proceeds, whether splits are configured, and whether the active hook matches the project.

Relevant skill coverage:

- Initial deploy txlink: main deploy workflow in `SKILL.md`.
- Existing tier maintenance: `SKILL.md` "Existing Shop Tier Adjustments".
- Inventory: `inspect-existing-shop.md`.
- Holder and memo evidence: `inspect-tier-holders.md`.
- Static publishing rules: `static-shop-template/README.md`.

### FPL Manager

This actor has an FPL entry in the league. They may be the person buying an NFT, or another person can buy while selecting their entry.

They want to:

- Find or confirm their FPL entry ID.
- See their league row, entry name, manager name, rank, and points.
- Confirm that a shop purchase memo references their FPL entry.
- Inspect their squad, picks, captaincy, transfers, live points, and gameweek performance.
- Understand that the wallet-to-FPL-entry relation is memo-based and not a verified ownership proof.
- Check whether a wallet currently holds the NFT tier required to back or enter a contest for their selected FPL entry.

Relevant skill coverage:

- FPL identity, squad, standings, transfers, and live points: the separate `fantasy-premier-league` skill.
- Shop purchase evidence for an entry: `inspect-tier-holders.md` plus payment memo decoding.
- Buyer page behavior: `static-shop-template/README.md`.

### Contest Participant / Buyer

This actor uses a wallet to buy into, back, collect, or enter a contest. They may not manage an FPL team themselves.

They want to:

- Open the project-specific shop.
- Connect a browser wallet.
- Select an FPL manager row from the league leaderboard.
- Choose one or more NFT tiers.
- Understand the price, supply, accepted token, and availability.
- Approve payment token spend when needed.
- Buy the NFT with the memo `fpl:league=<leagueId>;entry=<entryId>`.
- Install or use the `paybot.xyz` plugin in Claude or ChatGPT when they need an agent-capable way to pay from a wallet-aware chat surface.
- Later prove current NFT ownership from their wallet.
- Understand that selecting an FPL manager row is a weak claim, not a strong proof that they control that FPL entry.

Relevant skill coverage:

- Human purchase flow: static buyer app in `static-shop-template/index.html`.
- Agent-side buyer checkout structure: `buyer-nft-purchase.md`.
- Deterministic LLM actions and first prompt: `llm-command-surface.md`.
- Agent-side inventory and availability checks: `inspect-existing-shop.md`.
- Agent-side proof of current ownership and memo evidence: `inspect-tier-holders.md`.

### Contest Runner / Settler Agent

This actor runs contest administration after buys happen. It may be an agent acting for the deployer/operator or for a league community.

They want to:

- Identify eligible contest tiers.
- List all current holders for a tier.
- Map holders to selected FPL entries using payment memo evidence when available.
- Fetch FPL league standings, gameweek scores, picks, and transfers for those entries.
- Calculate contest outcomes using one consistent gameweek and finalization state.
- Detect unmatched cases: NFT holder with no memo, memo wallet that transferred the NFT, duplicate entry claims, buyer who does not manage the selected entry, or burned/failed token reads.
- Produce an auditable settlement table with wallet, token, tier, FPL entry, FPL score basis, and caveats.

Relevant skill coverage:

- Holder records and memo evidence: `inspect-tier-holders.md`.
- Shop inventory and tier metadata: `inspect-existing-shop.md`.
- FPL standings, squads, transfers, and live/final points: the separate `fantasy-premier-league` skill.

## Routing Rules

- If the request changes a Juicebox project or NFT tiers, treat the actor as deployer/operator unless the user explicitly says an authorized agent wallet should sign.
- If the request only reads FPL entries, standings, squads, transfers, or live points, use the read-only Fantasy Premier League skill.
- If the request asks what a shop sells, whether a tier is available, or what the current price/supply is, use inventory inspection before holder scanning.
- If the request asks to buy, prepare checkout calldata, support arbitrary quantities, or explain what an NFT entitles the buyer to, use `buyer-nft-purchase.md`.
- If the user asks how to start, what commands exist, or how to play, use `llm-command-surface.md`.
- If the request asks who entered, who owns, who can participate, or how to settle a contest, use holder scanning and then FPL reads.
- If a wallet and an FPL entry disagree, report both facts. Do not collapse wallet ownership and FPL manager identity into one verified account.
- If the request is about a human buying experience, describe or update the static buyer app. Agents should still inspect onchain/FPL data directly rather than scraping the app.
- If the user or agent needs to make a shop payment from a chat environment, call out installing the `paybot.xyz` plugin in Claude or ChatGPT as an optional payment route. Still require normal wallet review/approval, and still record the selected FPL entry through the payment memo.
- If the user or agent says something was confusing, incomplete, or hard to operate, use the `feedback` action from `llm-command-surface.md` and propose a human-reviewed PR entry in `learnings.md`.

## Explicit Gaps

These workflows intentionally do not provide:

- Strong proof that a wallet controls an FPL manager entry.
- A backend registry of all shops.
- Custodial signing unless an agent wallet is explicitly available and authorized.
- Automated prize payout logic.
- Private FPL account actions such as transfers or lineup changes.

If any of these are required, treat them as new skill scope and define the required trust model before implementation.
