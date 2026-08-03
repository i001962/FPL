# Inspect FPL Shop NFT Tier Holders

## Completion Rule

For contest and exocortex workflows, return holder data as structured records. Do not stop at aggregate counts or frontend screenshots.

For every requested project and tier, return:

- `chainId` and `chainSlug`
- `projectId`
- resolved 721 `hook`
- `tierId` and tier name when resolved
- NFT `tokenId`
- tier serial number
- current `owner`
- optional payment memo evidence, when available

Also summarize:

- unique holder count per tier
- quantity held by each owner per tier
- whether the scan was complete or capped
- any RPC/log endpoints that failed

## Required Inputs

Accept any of these inputs:

- direct route, such as `basesep:19`
- project ID plus chain
- FPL league standings URL or league ID, if project discovery is needed first
- optional tier name or tier ID filter
- optional wallet address filter

If the user gives only an FPL league, first run the shop discovery and tier inventory workflow in [inspect-existing-shop.md](inspect-existing-shop.md), then scan holders for the matching project.

## Holder Scan Sequence

1. Resolve the active Juicebox V6 721 hook using the same sequence as [inspect-existing-shop.md](inspect-existing-shop.md):
   - `JBDirectory.controllerOf(projectId)`
   - `currentRulesetOf(projectId)` from the controller
   - ruleset `dataHook`
   - omnichain `tiered721HookOf(projectId, rulesetId)` when the data hook is the omnichain deployer
2. Load active tiers with `STORE()` then `tiersOf(hook, [], false, 0, 200)`.
3. For each selected tier, calculate sold supply:
   ```text
   sold = initialSupply - remainingSupply
   ```
4. For each serial from `1` through `sold`, calculate the token ID:
   ```text
   tokenId = tierId * 1_000_000_000 + serial
   ```
5. Read `ownerOf(tokenId)` from the resolved 721 hook.
6. Exclude zero addresses and failed/burned token reads, but report how many serials failed.
7. Group results by tier and owner.

This mirrors the static app's aggregate scan, but agents must retain the full records instead of only counting customers.

## Memo And FPL Entry Evidence

Current static buyer pages send payment memos in this format:

```text
fpl:league=<leagueId>;entry=<entryId>
```

Older purchases may have used only the raw FPL entry ID as the memo. Treat both formats as weak claims, not verified FPL manager ownership.

When an agent needs to map NFT holders to FPL entries:

1. Query the relevant Juicebox terminal payment logs for the project and buyer/beneficiary where possible.
2. Decode the payment memo and keep only memos that match either:
   - `fpl:league=<leagueId>;entry=<entryId>`
   - a numeric legacy entry ID, only when the project metadata has the same `fpl.leagueId`
3. Join memo evidence to holder records by wallet address.
4. If a wallet holds an NFT but no matching memo is found, return the holder with `fplEntryId: null` instead of guessing.
5. If a memo names an FPL entry but the NFT was transferred to another wallet, report both the memo wallet and current owner.

Do not claim the FPL manager-to-wallet link is verified. It is memo-based and can be stale after transfers.

## Output Shape

Use a shape like:

```json
{
  "project": {
    "chainId": 84532,
    "chainSlug": "basesep",
    "projectId": "19",
    "hook": "0x..."
  },
  "holders": [
    {
      "tierId": 1,
      "tierName": "Full Season",
      "serial": 1,
      "tokenId": "1000000001",
      "owner": "0x...",
      "fplEntryId": "12345",
      "memo": "fpl:league=143466;entry=12345",
      "memoSource": "payment-log"
    }
  ],
  "summary": {
    "scanComplete": true,
    "uniqueHolders": 1,
    "byTier": [
      {
        "tierId": 1,
        "uniqueHolders": 1,
        "itemsHeld": 1
      }
    ]
  }
}
```

If memo logs cannot be read, still return the holder list and say that FPL entry mapping is unavailable.
