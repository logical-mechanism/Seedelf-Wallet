# v-x-docs-2-trace: the store's host-permission text doesn't cover #336's Koios requests

**Verdict:** confirmed. **Severity:** low, as filed. **Confidence:** high.

I traced the path on HEAD (`6bca8bec`), and a scratch test wired the way `sw.ts` wires discovery failed on the doc's claim, on mainnet. One detail is narrower than the finding says, and one fix wording could be tighter (both below).

## The path, traced on HEAD

1. **The server answers.** `refresh()` returns early unless the private index is up: `const index = await this.deps.index?.(network); if (!index) return;` (`lovejoin-pools.ts:419-420`). `privateIndexClient` (`private-index.ts:368`) gives one only when the network has a data origin (mainnet), Koios-only is off, and the private part is up. So everything below happens only while our server answers.
2. **Koios is asked after the list is in.** Once the list is verified offline, `await this.keep(network, await this.confirmed(network, found));` runs (`lovejoin-pools.ts:454`).
3. **`confirmed()` asks Koios directly.** It's at `:565-584`. A pool already in the bundled head start or the device's record is never asked about. For every other pool, it calls `const koios = this.deps.koios(network).koiosAlone();` (`:570`) and then `this.launched(...)`.
   - On mainnet, `koios` is `DataLayerKoios`. Its `koiosAlone()` returns `this.alone = new Koios(NETWORKS[network].koios, …)` (`data-layer.ts:214, 223-225`), which is `https://api.koios.rest/api/v1` (`networks.ts:64`).
   - `DataLayerKoios` doesn't route either request to our server: "Pool discovery's, on Koios alone" (`data-layer.ts:287-295`).
4. **The two requests.** `launched()` calls `koios.launches` (POST `tx_info`, `koios.ts:926-946`) for every new pool. It calls `koios.firstRegistrations` (POST `account_update_history`, `koios.ts:954-964`) only for an L that the launch didn't register itself: `const ask = found.filter((f) => !f.registers)…` (`lovejoin-pools.ts:550-551`).
5. **Who triggers it.**
   - "Known" means the bundled head start plus the device's own record (`:347-352`).
   - Mainnet's head start on HEAD holds **no pool** (`src/lovejoin-pools.json`: height 14110720, `pools: []`), and Remove wallet deletes the device's record.
   - So a fresh install, or a wallet removed and restored, asks Koios about every listed pool the next head start doesn't bundle. An older device asks about each new pool once it's listed.
   - A pool Koios can't confirm yet is asked about again at the next list.

## The docs

- **#336 left the store listing alone.** It touched `docs/privacy.md`, `docs/store/privacy-policy.md` (`:3`, `:46`, and the new *Changes* entry at `:93`), `lovejoin-pools.ts` and two tests (`git diff --stat 473b7f1a^1 473b7f1a`). Nothing in `docs/store/README.md` changed.
- **The listing's Koios text was last written before #336.** `:261` and `:269` were last changed in `fc8561c7` (2026-10-25). That's the 1.6.0 text.
  - **`:261`, the per-host row:** "…the new pools at Lovejoin's reference holder (the transactions that started them and their scripts' registrations) while its own server hasn't listed them… Even while its own server answers, Koios is asked what made the user's boxes in a later pool of the same box value as one shown, which that server doesn't cover."
    - The confirm asks those same two things about pools the server **has** listed.
    - The one "even while its own server answers" exception the row names is the copies' read (`lovejoin.ts:5702`, `inputsOf`, still on Koios alone).
  - **`:269`, the merged text for the dashboard box:** "…and for one Lovejoin read its server doesn't cover." There are two now. Counted, it's 996 characters.
- **The project does keep this text exact per release.**
  - `fad05e27` is titled "the dashboard's host-permission text says what Koios is asked in 1.6.0".
  - `store/README.md:11` says "the justifications and the policy say … what Koios and giveme.my … can still see".
  - 1.7.0's item 5 (`post-release-roadmap.md:39`) asked for a privacy-policy entry and nothing for the listing, which is how it slipped.
- **Only one copy of each.** These two phrases appear nowhere else in `docs/`, and the Privacy tab's text isn't localised.

## The scratch test

`extension/tests/zz-review-v-x-docs-2-trace-1.test.ts`, run alone, then deleted.

**How it was wired.** `PoolDiscovery` was built as `sw.ts:236` builds it:
- `koios: chainClient(deps, origin)` and `index: privateIndexClient(deps, origin)`, with the origin `https://data.test`.
- `tests/fake-index.ts` answered `lovejoin/pools` with Lovejoin's preprod token pool.
- On mainnet, the reference and script rows were moved to the holder's mainnet address (`addr1w…`, header 0x71, encoded in the test). The test checked its encoder against the fixture's preprod address.
- Koios's fake gave the launch with no certificates (so L wasn't registered by it), and L registered a block earlier.
- Every request was recorded by host and path.

**What it asserted.**
- Our server was asked (`["data.test","pools"]`), and the pool was kept (`known()` = `[ID]`).
- Then the doc's claim: no request to any other host.

**Result on HEAD:** 2 failed, 1 passed (the encoder check).
- **mainnet:** received `[["api.koios.rest","tx_info"],["api.koios.rest","account_update_history"]]`.
- **preprod** (with a data origin forced): the same requests, to `preprod.koios.rest`.
- The repo's own tests show the same with a launch that registers L: `expect(k.calls.map((c) => c.path)).toEqual(["tx_info"])` (`lovejoin-discovery.test.ts:288-290, 356-357`).

## Where the finding is narrower than it says

- **`account_update_history` isn't asked for every new pool.** It goes only where the launch didn't register L. A standard launch registers L itself, so for most pools only `tx_info` is asked. The privacy policy's `:46`/`:93` already say "where that transaction didn't register the pool's script".
- **The scenario's "the owner pastes it" is loose.** `development.md:290` (step 11) says to copy the listing's text only "if the listing's text … changed". Since `store/README.md` didn't change, the dashboard keeps 1.6.0's identical text. The outcome is the same either way: at 1.7.0's review, the box says "one Lovejoin read".
- **What the reviewer reads by default is `:269`, the merged box.** `:261` is the fuller answer if a reviewer asks about the Koios host (`:272`).

## On the fix

- **`:269`:** "for one Lovejoin read" → "for two Lovejoin reads" comes to 997 characters, which I counted. That's as long as 1.6.0's own 997-character text (`fad05e27`), so it fits.
  - "Its server doesn't cover" holds, because `DataLayerKoios` never routes these to our server.
  - If the owner would rather not imply our server lacks the data (it has `tx_info` and `account_update_history` routes), "and for two Lovejoin reads it never asks its server" is also 997 characters. It's true of both reads.
- **`:261`:** put the new clause in the "Even while its own server answers, …" sentence, not in the list framed "whenever its own server can't answer". For example: "…which that server doesn't cover; and, for a pool that server lists which the device hasn't seen, the transaction that started it and, where that didn't register its script, the registration, so the server that lists a pool doesn't vouch for it." This row has no length limit.
- **Optional, the same simplification already made for the copies' read:**
  - `privacy-policy.md:5` and `:40` ("on mainnet whatever ours can't answer");
  - the listing's description, `store/README.md:75` (and its es/ja at `:163`, `:227`);
  - the test instructions, `:334` ("api.koios.rest on mainnet when that server can't answer").
- **Duplicates:** `verify/v-pr336-6-impact.md` names pr336 F7, x-priv#1 and x-rel F2 as the same drift in the policy's summary lines. One edit pass covers them all.

## Safety

- No tracked file was edited.
- The scratch test and the scratchpad files are deleted.
- No network was used; every request went to in-process fakes.
