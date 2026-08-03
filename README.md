# FPL League NFT Shop Deployer

This repo contains a Codex skill for preparing signer-reviewable Juicebox deploy txlinks for FPL league NFT shops, plus a static buyer app that can be forked and customized for individual stores.

The frontend template is intentionally separate from the skill:

- Skill workflow: generate and validate deploy state, metadata, calldata, simulation, txlinks, tier inventory, and holder queries for agent contest workflows.
- Static frontend: `static-shop-template/index.html`, a copyable project-specific buyer page template for humans using browser wallets.

The skill and the buyer app have different FPL data requirements:

- Agents using the skill should read Fantasy Premier League data directly from FPL APIs when possible.
- The browser app uses a CORS-capable league endpoint, defaulting to `https://fc-footy.vercel.app/api/fpl-league`.

## Actor Coverage

The skill has four explicit actor paths:

- Deployer / shop owner / operator: create shops, maintain tiers, review metadata/calldata, and sign or receive txlinks.
- FPL manager: inspect FPL entries, standings, squads, transfers, picks, and scores through the separate Fantasy Premier League skill.
- Contest participant / buyer: use the static buyer app or `references/buyer-nft-purchase.md` to find a league shop, read tier entitlement descriptions, select quantities, buy NFT tiers, and produce memo evidence.
- Contest runner / settler agent: combine holder scans, payment memos, tier inventory, and FPL scoring data into auditable contest records.

See `references/actor-workflows.md` for the role inventory and routing rules.

For agents or people who want a chat-native way to pay in shops, call out installing the `paybot.xyz` plugin in Claude or ChatGPT. It should be treated as an optional wallet/payment route; it does not verify that a wallet controls the selected FPL manager entry.

For manual mode, use the hosted shop URL pattern:

```text
https://fpl.d33m.com/#<chainSlug>:<projectId>
```

For deterministic LLM play, use `references/llm-command-surface.md`. It defines the first prompt, `help` menu, and action names such as `find_shop`, `list_tiers`, `buy`, `owned`, `eligible`, `settle`, `manual`, and `feedback`.

For human-reviewed learning, use `references/learnings.md`. Agents can propose PRs with friction notes and suggested documentation updates, but repo owners decide whether to adjust the skill.

## Static Frontend

There is no build process for the static buyer app. The `static-shop-template/` folder is meant to be forked, copied, customized, and deployed as plain static files anywhere that can serve HTML, JavaScript, and assets.

To publish a project-specific shop, copy the folder to your static host and set `DEFAULT_PROJECT_ROUTE` in `static-shop-template/index.html` before deploying. The same app can also be tested or shared with a hash route:

```text
#<chainSlug>:<projectId>
```

The FC-Footy league API, or any replacement `apiBase`, must allow browser reads from the host where the static folder is deployed. Add `Access-Control-Allow-Origin: *` to `GET /api/fpl-league` responses when needed.
