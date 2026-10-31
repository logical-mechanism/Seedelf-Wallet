# Plans

**The work happens in chunks.** A chunk is one piece of work, from a session to a few: a number, a branch, and a plan in this folder. This folder holds the plans of the chunks being built now or next, and nothing else: if a file is here, it's live.

## Starting a chunk

- **A chunk starts when the owner picks it:** from [backlog.md](../backlog.md), from what users ask for, or from something new. Demand decides. The wallet is feature-complete for Cardano, and nothing in the backlog is a promise.
- **It takes the next number:** one past the highest `chunk-NN` here or in [../archive/plans/](../archive/plans/). Parts of one chunk take letters (26b, 26c).
- **A branch `web-wallet/<topic>` from `main`**, and a PR back into `main` ([development.md](../development.md#branching)). Never `web-wallet/<x>.<y>.<z>`: that's the tag namespace.
- **A plan here, `chunk-NN-<topic>.md`:** what a session is handed to build it, with the decisions made along the way. In the owner's words, "just prompts for you basically". It says what the owner decided, and when, in their words where they gave them.
- **Small fixes need no plan.** A fix PR, or a patch release, names its items from the backlog instead (1.4.1, 1.7.0's list, 1.7.1).

## While it's built

[development.md's rules for a change to the screens](../development.md#rules-for-a-change-to-the-screens) hold. Lace is inspiration, never a brand to copy. Every privacy note stays. Correctness UX is always in scope. Nothing new phones home without its own decision and a dated entry under the privacy policy's *Changes*. Every feature states its request cost. A renamed control updates the e2e tests and [flows.md](../flows.md) in the same commit. The name is Seedelf.

Status in a plan: ✅ done · 🚧 in progress · ⬜ not started · ⛔ blocked · ❓ needs the owner's call.

## When it lands

- **What still holds moves into the design docs** for its area: [architecture.md](../architecture.md), [flows.md](../flows.md), [privacy.md](../privacy.md), [keys-and-accounts.md](../keys-and-accounts.md), [development.md](../development.md). A decision, an invariant, a gotcha.
- **What it leaves open goes into [backlog.md](../backlog.md)**, a line in its area with the ID it's cited by; a backlog line it settles is deleted.
- **The plan moves to [../archive/plans/](../archive/plans/)**, ending with a record of what its PR did (the owner, 2026-10-04). A stale plan read as current is the one failure mode that costs real work, so none stays here once it's done.

## Releases

- **A release is cut when enough has landed to be worth one:** `1.x.0` for features, `1.x.y` for a fix, and a break on mainnet goes out alone as a patch. The web wallet's version line is its own, apart from the Rust workspace's 0.x (the root [CLAUDE.md](../../../../CLAUDE.md#release--versioning)).
- **The steps are [development.md's](../development.md#releasing-to-the-web-store)**, and the record goes in [releases.md](../releases.md).
- **The tag is `web-wallet/<version>`,** on the commit the uploaded zip was built from, pushed at the upload. [SECURITY.md](../../../../SECURITY.md)'s bounty scope is the latest such tag. The slash matters: [release.yml](../../../../.github/workflows/release.yml) ships signed CLI binaries off any tag without one.
- **The docs don't date releases or say what the store is doing** (the owner, 2026-10-04). Ask the owner when it matters.
