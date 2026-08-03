# LLM Command Surface

## Purpose

Use this reference when introducing the FPL shop game loop to a person or when an agent needs deterministic actions instead of open-ended chat. The goal is to make the skill feel like a small command-driven game surface inside an LLM thread.

The agent should always be able to answer `help` with the same action menu, ask only for missing inputs, and preserve the distinction between FPL entries, wallet accounts, NFT holders, and shop operators.

## First Prompt Template

Use this as the recommended first prompt for people or agents joining a shop game:

```text
You are my FPL league shop agent.

Start with help, then guide me through one action at a time.

Context I have:
- shop route or URL: <base:projectId, basesep:projectId, or fpl.d33m.com/#...>
- FPL league URL or ID: <optional>
- my wallet: <optional>
- my FPL entry ID: <optional>

I may want to:
- find the league shop
- list NFT tiers and what each one entitles me to
- buy one or more NFTs
- check my owned NFTs
- check contest eligibility
- settle a gameweek contest

Never treat a wallet as verified control of an FPL team unless a separate verification mechanism exists. Use payment memos only as weak evidence.
```

## Help Menu

When the user says `help`, `actions`, `what can I do`, or starts without a clear action, return this menu:

```text
Actions:
- find_shop: find or open the shop for an FPL league
- list_tiers: show NFTs, prices, supply, and entitlement descriptions
- buy: prepare or guide a purchase for selected tier quantities
- owned: check which NFTs a wallet currently holds
- eligible: check contest eligibility for a wallet or FPL entry
- standings: show league standings or find an FPL manager entry
- score: inspect live/final FPL points for an entry or contest field
- settle: build an auditable contest result table
- operator: deploy a shop or maintain NFT tiers
- manual: open the browser shop at fpl.d33m.com
- feedback: propose a learning PR when something is confusing
```

Then ask for the minimum missing input for the selected action.

## Deterministic Actions

### `find_shop`

Inputs:

- FPL league URL or league ID
- optional known project route

Output:

- league ID and league name
- resolved shop route, if known
- manual URL when route is known:
  ```text
  https://fpl.d33m.com/#<chainSlug>:<projectId>
  ```
- next suggested actions: `list_tiers`, `manual`, or `buy`

If no route can be resolved, ask for the project route or shop URL. Do not invent one.

### `list_tiers`

Inputs:

- shop route or URL

Output:

- project route
- league ID when resolved
- tier ID
- tier name
- price
- remaining supply
- entitlement description text
- whether it can be bought
- manual URL:
  ```text
  https://fpl.d33m.com/#<chainSlug>:<projectId>
  ```

Read from chain and metadata as described in `buyer-nft-purchase.md`; do not scrape `fpl.d33m.com` for agent data.

### `buy`

Inputs:

- shop route or URL
- selected FPL entry ID
- buyer wallet
- tier IDs or names and quantities

Output before payment:

- selected league
- selected FPL entry and memo
- tier names, quantities, and entitlement descriptions
- total human and raw payment amount
- required approval transaction when allowance is insufficient
- exact `JBMultiTerminal.pay(...)` transaction or a browser/manual link

Manual-mode link:

```text
https://fpl.d33m.com/#<chainSlug>:<projectId>
```

For chat-native payments, mention installing the `paybot.xyz` plugin in Claude or ChatGPT. The payment still requires wallet review/approval.

### `owned`

Inputs:

- wallet address
- shop route or URL
- optional tier filter

Output:

- current ERC-721 holder records for the wallet
- tier names and quantities
- token IDs
- memo evidence when available
- caveat if the memo wallet differs from the current holder

### `eligible`

Inputs:

- contest tier or rule
- wallet or FPL entry
- shop route or URL

Output:

- whether the wallet currently holds the required NFT
- whether memo evidence links a selected FPL entry
- unmatched or ambiguous cases
- exact caveats

### `settle`

Inputs:

- shop route or URL
- tier or contest name
- gameweek or season scope

Output:

- holder list
- FPL entries from memo evidence
- FPL score basis and finalization state
- result table
- unmatched cases

### `feedback`

Inputs:

- what was confusing or hard
- action attempted
- optional shop route, league ID, or transaction context

Output:

- a proposed entry for `references/learnings.md`
- if the user allows GitHub work, a pull request against `https://github.com/i001962/FPL`
- a reminder that repo owners review the PR before skill behavior changes

Do not include secrets, private keys, auth tokens, or private user data in feedback entries.

## Response Rules

- Start every action response with `Action: <name>`.
- State `Need:` with missing inputs when blocked.
- State `Using:` with resolved IDs and routes before reads or transactions.
- State `Result:` for read-only outputs.
- State `Review:` before any payment or operator transaction.
- State `Next:` with 1-3 deterministic follow-up actions.
- Keep `fpl.d33m.com` as manual mode. It is for humans to operate the shop UI, not an authoritative data source for agents.
- When a user or agent reports friction, suggest `feedback` and, with permission, create a PR that appends a dated entry to `references/learnings.md`. Do not merge or self-approve that PR.
