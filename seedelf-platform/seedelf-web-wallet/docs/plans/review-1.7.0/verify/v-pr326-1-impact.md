# v-pr326-1-impact: pr326#1, Koios left off the Tor check

**Verdict: partly. Severity: low.** It's docs only, in a parked plan. No user is affected, and it doesn't gate 1.7.0.

The core point holds: the "still unchecked" line leaves out Koios, and the plan relies on Koios. "Every route above" overreaches. Two parts are overstated:
- The README doesn't contradict the line on giveme.my.
- "Per the README, Koios refuses Tor" overreads the README. The project's own privacy docs read it as "no onion service, exits unverified".

The fix is right in direction, but it shouldn't write "Koios no".

## Reachability

- **No user, site or attacker reaches this with the shipped build.** No Tor route exists. The owner parked the idea on 2026-10-27 (:333).
  - The store zip is `dist/` alone (`scripts/package.mjs:22`, `:116-117`), so `docs/` never ships.
- **The only reader it can mislead** is whoever picks Tor up. Per the tor-spike memory note, they start from this bullet.
- **Mitigated:** :333 links privacy.md's *Network*, and privacy.md:119 there says Koios's Tor exits are unchecked.

## What holds

**(a) Koios belongs on the list, for more reasons than the finding gives.**

- **:347:** "past it the wallet reads Koios, as it does whenever a part is busy, so Tor users get slower, never banned".
  - The premise describes shipped behaviour. `data-layer.ts:16-17`: "A part that fails stays on Koios for 5 minutes (or a 429's Retry-After, if longer)". `readFallback` (:117-123) returns `down: true` on a 429, and `NOT_SENT` (:127) includes 429.
  - So whether a Tor user past the bucket gets served is up to Koios. If Koios turns Tor exits away, every read in that hold fails. Under a sustained flood the bucket stays full, and that is a ban in effect.
- **Beyond the finding: preprod and Koios-only.**
  - Only mainnet has a `data` origin (`src/networks.ts:77`). Preprod is Koios alone, and Settings' Koios-only switch sends everything to Koios.
  - So any route that sends the private side through Tor on those paths needs Koios to take Tor exits. Otherwise the private side doesn't work there at all.
- **:337:** "it would hide users from Koios (when the wallet falls back to it)". This is weaker than the finding says.
  - If Koios turns Tor away, nothing of the user's reaches it, so the hiding still holds.
  - What fails is the fallback itself. That's an availability problem, not a privacy one.
- **History, to show it's in scope.**
  - The DoS sentence and the check item came from `a30deaf4` (2026-10-22), an ancestor of `babb8e76`, so they predate the range.
  - #326 (`a7abf961`) added "Every route above needs them to", "whichever route is taken" and the :337 Koios clause.
  - So #326 widened what relies on Koios while carrying the list forward without it. No later PR touched the passage.

**(c) "Every route above" is literally wrong** for *Split who sees what* (:344), which uses no Tor. It's also wrong for Nym's mixFetch, whose exits are Nym's. Nit.

## What doesn't hold

**(b) It isn't a contradiction.**
- :346 says giveme.my is unchecked "today".
- README.md:162's "`giveme.my` does support Tor access" is the owner's own sentence from 2025-04-30 (`8cba7a2f`, reworded in `4a868c17`; neither commit carries a Co-Authored-By trailer). Rechecking an 18-month-old claim is reasonable.
- "Tor access" may also mean an onion service, which is a different question from answering exits.
- So the README is worth citing, but the line isn't a defect on this count. Asking the owner is cheaper than running a check.

**"A Koios that, per the README, refuses Tor"** overreads the README.
- The privacy review read "`koios.rest` does not support Tor access" as "Koios has no onion service, and whether it accepts Tor exits is unverified" (`archive/plans/privacy-review.md:792`, §5.1).
- `4fb0ad81` carried that reading into privacy.md:119.
- So "effectively banned" is conditional on Koios refusing exits, not established. That's exactly why Koios belongs on the unchecked list.

## The fix

**Keep its direction, with one change: don't write "Koios no".**
- "Koios no" would harden the README into "Koios refuses Tor exits". That contradicts privacy.md:119 and the privacy review.
- Attribute the README's statements instead. Suggested :346:

> **Still unchecked: whether the data layer, giveme.my and Koios answer Tor exits today.** The Tor routes need the first two to, and Koios too wherever the private side reaches it through Tor (its fallback, Koios-only, preprod); for Nym, the same of Nym's exits. The root README (the owner, 2025) says giveme.my supports Tor access and Koios doesn't; privacy.md reads Koios's as no onion service, its exits unchecked. tor-js in Node needs no gateway, so it can be checked from the dev box with a few read-only requests.

**Optional, at :347:**
- Qualify "never banned" as "(if Koios takes Tor exits, above)".
- Even if Koios answers Tor exits, its public tier limits by IP address (brief rule 8). Through Tor those limits fall on each exit, which every Tor user shares, so "never banned" depends on that too. The pickup's check should look at both.

**What else it changes:** nothing in the build.
- It's within the owner's rules: no guard, no privacy note dropped, no release date or store status.
- It fits pr326#0's fix. There, Bring your own Tor's PAC can't split Koios by host, so that route reaches Koios directly. Koios answering Tor exits then matters only where Koios is reached through Tor (tor-js, Nym).
- It can go in with the release PR's docs pass or wait for the pickup. It's not a gate item.

## Trace

- `sed -n 331,347p post-release-roadmap.md` on HEAD `6bca8bec`: the lines match the finding (:337, :344, :346, :347).
- `git log -S`:
  - "so Tor users get slower, never banned" and "whether the data layer and giveme.my answer Tor exits" both came from `a30deaf4`; `git merge-base --is-ancestor a30deaf4 babb8e76` succeeds.
  - "Every route above needs them to", "hide users from Koios" and "whichever route is taken" came from `a7abf961`.
  - The README's "Tor access" came from `8cba7a2f`/`4a868c17` (logicalmechanism, 2025-04-30).
  - privacy.md's "whether it takes Tor exits is unchecked" came from `4fb0ad81` (2026-09-27, Claude co-authored).
- `git diff 5abd5470 6bca8bec` touches neither the Tor passage nor privacy.md:119.
- `git grep` finds no `.onion` address for giveme.my or Koios anywhere. `origin/web-wallet/tor-spike` is `a7abf961` alone.
- Nothing was run against a network. No scratch files were made.
