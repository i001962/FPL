# Skill Learnings

## Purpose

This file is the human-reviewed learning loop for the FPL league shop skill. Agents and people using the skill should propose updates here when something was confusing, brittle, under-specified, or hard to complete.

This is intentionally not a fully autonomous self-modifying process. Agents may open pull requests with observations and suggested changes, but repository owners review and decide whether to adjust the skill.

## When To Add A Learning

Add a learning when:

- a user could not tell which action to choose
- an agent needed information that the skill did not ask for up front
- an ID was easy to confuse, such as FPL league ID vs Juicebox project ID
- a transaction, tier read, holder scan, or FPL query needed an undocumented step
- the manual-mode shop link helped or failed to help
- `paybot.xyz`, txlink, browser wallet, or approval flow instructions were unclear
- the entitlement text, contest rule, or settlement result was ambiguous
- a fallback worked and should become a documented path

Do not add private keys, wallet secrets, auth tokens, unpublished user data, or raw private conversation text.

## PR Workflow

If an agent has GitHub access and the user allows it, the agent should:

1. Create a branch.
2. Add a new dated entry to this file.
3. Keep the entry factual and scoped to the observed friction.
4. If appropriate, propose edits to the relevant skill reference file.
5. Open a pull request against `https://github.com/i001962/FPL`.
6. Leave the PR for the repo owner to review. Do not merge it automatically unless the owner explicitly asks.

If the agent cannot open a PR, it should show the proposed learning entry to the user so they can file it manually.

## Entry Template

```md
## YYYY-MM-DD - Short Title

Context:
- Actor:
- Action:
- Inputs provided:

What was hard:
- 

What worked:
- 

Suggested skill change:
- 

Files likely affected:
- 

Review notes:
- This is a proposal only; repo owner should decide whether to update the skill.
```

## Open Learnings

Add new proposed learnings below this line.
