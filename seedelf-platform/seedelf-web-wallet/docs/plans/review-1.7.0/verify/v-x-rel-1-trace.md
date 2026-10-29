# v-x-rel-1-trace: x-rel#1, traced on HEAD (6bca8bec)

**Verdict: partly. Severity: low (the finding said medium).**

## Summary

The code claim holds exactly. A scratch test drove the worker's real wiring on mainnet and showed it. #336 asks `api.koios.rest` for a pool new to the device while our server answers.

The doc contradiction is narrower than claimed. It's clear only where a doc lists the "even while ours answers" cases, or defines Koios's role as a data-layer part being down:

- the listing's Koios host row (`store/README.md:261`);
- the merged host box (`:269`);
- checklist item 9 (`development.md:162`);
- `privacy.md:22`.

The generic summaries say Koios is used "for anything ours can't answer". That's still literally true. Our server can't answer either request: the API refuses both shapes. 1.6.0's own precedent (the R2-3 copies read) left those summaries unchanged and named the exception only in the host row, the merged box and the policy's body.

The scenario also overstates. Nothing promises that "Koios never sees them on mainnet", and the policy discloses this exact request twice.

## The code path (confirmed)

1. `PoolDiscovery.refresh()` asks the private index for its pools: `const index = await this.deps.index?.(network); if (!index) return;` (`lovejoin-pools.ts:419-420`). `privateIndexClient` returns one only where there's a data origin (mainnet), Koios-only is off and the private part is up (`private-index.ts:368`). An `IndexDown` returns before `confirmed()` runs (`:426-428`).
2. `await this.keep(network, await this.confirmed(network, found));` (`:454`).
3. `confirmed()` filters the list to the pools the device doesn't keep (head start plus stored, `:566-569`). If any are left, it calls `const koios = this.deps.koios(network).koiosAlone();` (`:570`) and then `launched()` (`:573-577`).
4. `launched()` calls `koios.launches(...)`, which is `tx_info` (`:527`). For a launch that didn't register L, it also calls `koios.firstRegistrations(ask)`, which is `account_update_history` (`:550-551`).
5. On mainnet, `DataLayerKoios.koiosAlone()` returns `this.alone`, which is `new Koios(NETWORKS[network].koios, …)` (`data-layer.ts:214, 223-225`). `NETWORKS.mainnet.koios` is `https://api.koios.rest/api/v1` (`networks.ts:64`).

## The scratch test (`tests/zz-review-v-x-rel-1-trace-1.test.ts`, run alone, deleted)

**Setup.** The test builds the worker's wiring as `sw.ts:236` does: `chainClient(deps, () => DATA)` and `privateIndexClient(deps, () => DATA)`, with `koiosOnly: async () => false` and `DataParts` up. The network is `"mainnet"`.

- The fake index lists PR #163's token pool. Its rows are re-addressed to the holder's mainnet address (`0x71` + `HOLDER`), built by a BIP-173 encoder. The encoder was checked against the fixture's own preprod holder address first.
- Koios's fake answers the launch, not registering L, with L registered by an earlier block.
- Every request URL is recorded.

**Case 1** asserts what the summaries say: "a pool read sends `api.koios.rest` nothing". It has a precondition: the index answered `lovejoin/pools`, and the pool was verified and kept on mainnet.

- Result on HEAD: **FAILED**, as the finding predicts.
- Recorded requests:
  - `https://data.test/seedelf/v1/mainnet/lovejoin/pools`
  - `https://api.koios.rest/api/v1/tx_info?select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates`
  - `https://api.koios.rest/api/v1/account_update_history?select=stake_address,block_time&action_type=eq.registration`

**Case 2** gives the same list with the pool already in the head start.

- Result on HEAD: **PASSED**. No request to `api.koios.rest`, and the data layer was asked.
- This confirms the narrowness: only a pool new to the device triggers the request.

An earlier run that used the preprod-addressed rows on mainnet stopped at verification ("It isn't at Lovejoin's reference holder"). That's why the rows were re-addressed. The `tx_info` and `account_update_history` result is from the corrected run.

## The docs, one by one

### Stale: contradicted by the code

- **`store/README.md:261`, the Koios host row.** It says Koios reads "the new pools at Lovejoin's reference holder (the transactions that started them and their scripts' registrations) **while its own server hasn't listed them**". Since #336, the same two reads go out right after our server has listed a pool, while it answers. The row's only "Even while its own server answers" sentence names the copies' boxes read (R2-3).
- **`store/README.md:269`, the merged host box** (996 characters; the dashboard takes about 1,000). It says "and for **one** Lovejoin read its server doesn't cover". There are now two.
- **`development.md:162`, checklist item 9.** It says "`api.koios.rest` only for a part the data layer couldn't answer". "Part" is the data layer's public or private part. A tester who sees the confirmation with both parts up would log it as a fault. In practice it rarely fires during the check: the release's `npm run lovejoin-pools` bundles every pool shown then.
- **`privacy.md:22`.** It says "Koios for a part it can't answer". It has the same "part" framing. It was already imprecise since R2-3, and #336 added a second case. This is the design doc; its pools bullet at `:200` was updated by #336.

### Defensible as written: the owner's call, not a defect

These all say Koios is used on mainnet "for anything ours can't answer", or "whatever ours can't answer":

- `store/README.md:75`, `:163` and `:227`: the description in en, es and ja;
- `:334`: the test instructions;
- `store/privacy-policy.md:5` (the In short), `:7` and `:40`.

Our server can't answer either of #336's requests:

- **`tx_info`.** The data layer's `TxInfoBody::parts()` accepts only "the wallet's two shapes" (`seedelf-data/api/src/public/tx.rs:58-87`). The launch shape (`_certs: true` with no metadata, assets or withdrawals) matches neither and returns `NOT_ASKED`. `Query::none` (`:312`) also refuses its `select=`.
- **`account_update_history`.** The data layer's version takes only Delegation history's exact `select`, `action_type` and `order` (`account.rs:433-436`).
- **On purpose.** The wallet pins both calls to Koios: `DataLayerKoios.launches` and `firstRegistrations` go to `super` (`data-layer.ts:288-295`). The reason is that our server lists the pools, so "a check it answered would check nothing" (`privacy.md:200`).

**Precedent.** 1.6.0 shipped one Koios read made even while ours answers (R2-3, `lovejoin.ts:5702`). For that read, commit `478174f9` updated the host row and the merged box, and the policy's body says it at `:44`. The description, In short, `:7` and `:40` kept "can't answer".

### Accurate

- **The policy's pools paragraph (`:46`)** says: "a pool on that list this device hasn't seen before it confirms with **Koios** first, asking for the transaction that started it and, where that didn't register the pool's script, when it was registered".
- **Its 28 October entry (`:93`)** says: "...Koios sees it from your IP address, so it can tell you use Lovejoin". This meets the owner's rule 3.
- **`store/README.md:289`**, the data-usage line about financial information, is still right. The confirmation names only a pool's launch hash and its L stake address, the same for every wallet.

## Why low, not medium

**Not a leak against the policy.** The governing statement, the privacy policy, discloses this exact request in its body and in a dated Changes entry.

**The scenario overstates.** The store page and the In short don't promise that "Koios never sees them on mainnet". They say Koios answers what ours can't. In 1.6.0, Koios was already asked about a copy's boxes even while ours answered.

**Who reads the stale text.** The unambiguously stale lines are the dashboard's host-permission justification and the reviewer's test instructions, which Google reads and users don't, plus two internal docs.

**How often it fires.** Only for a mainnet token pool that's new to the device, or every pool again after Remove wallet. The request comes from Lovejoin use: the hub's `status()`, Lovejoin flows, and `withdrawDueNow` "only [for] a network with something of the wallet's open in Lovejoin" (`lovejoin.ts:6188`). Mainnet's bundled head start holds 0 pools (height 14110720, `src/lovejoin-pools.json`). The release refresh bundles any pool that exists by then.

## Side claims (confirmed)

- No manifest, permission or re-consent change is involved. `manifest.ts`, `networks.ts`, `scripts/package.mjs` and `src/lovejoin-pools.json` are unchanged in `babb8e76..6bca8bec`.
- `host_permissions: serviceHosts(networks)` (`manifest.ts:87`) includes `NETWORKS.mainnet.koios`.
- `package.mjs:46` refuses a mainnet build without `https://api.koios.rest/*`.

## Fix advice

**Required:**

- **`store/README.md:261`.** Replace "while its own server hasn't listed them" with an accurate scope, for example: "...when its own server can't answer, and, even while it answers, for a pool it lists that this device hasn't seen, to confirm it". Then update the rows' total at `:266` ("2,636 characters").
- **`store/README.md:269`.** The minimal accurate edit is "and for two Lovejoin reads its server doesn't cover". It goes from 996 to 997 characters, under the ~1,000 limit. The finding's "doesn't answer alone" wording would come to about 1,004. Update "at 996 characters" at `:266`.

**Should:**

- **`development.md:162`.** Add "or to confirm a Lovejoin pool it lists that this profile hasn't seen (`tx_info`, `account_update_history`)", so a tester doesn't log it as a fault.

**Optional:**

- **`privacy.md:22`.** Add the same clause.

**The owner's call:**

- **The generic summaries:** the description in three languages, `:334`, and the policy's `:5`, `:7` and `:40`.
- **What it would take:**
  - If the owner wants users to read it there, one clause in the policy's In short is enough. The 28 October entry already covers rule 3, so no new dated entry is needed.
  - Changing the description means editing es and ja too, with a blind back-translation of what changed (`store/README.md:114`).
- **No permission change.**
