# Chunk 31 · The collateral payment in Activity

The owner asked on 2026-10-12, from [post-release-roadmap.md](../../post-release-roadmap.md)'s [Kept in mind](../../post-release-roadmap.md#kept-in-mind): how Lace and Eternl handle a site asking for collateral when none is set, and, if anything, for the collateral payment to show right in Public activity.

**Status: ✅ built 2026-10-12** on `web-wallet/collateral-activity`, from `main` after #302. One PR: the build and the docs together, so this file went straight to the archive. What still holds is in [architecture.md](../../architecture.md) (*Activity*) and [flows.md](../../flows.md) (*Activity*, *Collateral*). The privacy policy has a dated entry: the wallet keeps something new on the device, though it sends nothing new.

## 1 · Set collateral, not Sent

**The gap.** Setting a collateral by payment pays 5 ₳ from the account to its own `0/0`. While it was on its way, Public activity named it from Home's watch (**Set collateral**); once in a block, `describe` read it from the chain alone, where it's a payment to itself that moved nothing but its fee, and named it **Sent**, with no one paid (or **Withdrew rewards** when it collected the staking rewards, as a staking account's payments do by default; 1.5.0's release review, C27). Any other transaction sent after it took the watch, so even a pending one could read **Sent**. The 1.4.1 re-check left it, since naming it needs the payment recorded as it's sent.

**What changed:**
- **The record** (`coin-control.ts`): each public account's sealed choices (`coins.<network>`, `Own`) keep `collateralPaid`, the hashes of the payments that set its collateral, the newest 20 (`COLLATERAL_PAID_KEPT`). `CoinControlService.sent`, which Send calls once the collateral payment is submitted, appends it. A reclaim, or a collateral chosen from a 5 ₳ UTxO already held (`use`), leaves the record as it is: that payment still set a collateral.
- **The lookup** (`collateralPayments`): the record, plus the collateral chosen now when a payment made it (`collateralSentAt` set; `use` clears it), so a wallet from before the record names its current collateral's payment too. It reads the store alone, asking no one.
- **The names** (`activity.ts`): `cardano` reads the active account's payments once a read, outside the wallet's lock, and hands them to `describe` (`collateral`, after the private history's own entries) and to `pendingEntries` (`PendingFrom.collateral`, ahead of the watch). A failed read only leaves them unnamed. The entry is what the chain says: the fee alone (direction none, 0 moved), with no one named, and `activity.title.collateral`, which every language already had.

**Not named:** a collateral payment the record doesn't have, which reads as before, **Sent** at its fee, or **Withdrew rewards** when it collected the rewards (C27): one sent from another device or before a restore, one older than the newest 20, or one another wallet with the phrase sent (Lace's is a payment to itself too). A heuristic (a payment to itself whose first output is a pure 5 ₳) would name those, and would also name a 5 ₳ the user sent themselves; left out, as a wrong name is worse than a plain one.

## 2 · What Lace and Eternl do

Looked at, nothing built. The roadmap said the connector "never offers to set a collateral, as Lace does": that was Lace 1.x.

- **Lace 2.x** (the `_reference/lace` checkout, extension 2.4.2): `getCollateral` answers the account's collateral UTxOs, or `null` with none, or with too little for the amount asked (`dapp-connector-cardano`'s `cardano-dapp-connector-api.ts`). No window. A collateral is set only from the account's settings, at 5 ₳: a pure 5 ₳ UTxO already held is marked with no transaction, or 5 ₳ is paid to the account's first address and its output marked. Its Activity names a Cardano transaction only **Send** or **Receive** by the account's net ADA (`map-transaction-to-activity.ts`), so the collateral payment is **Send**, as it was here.
- **Lace 1.x up to 1.19** opened a window on `getCollateral` with none set: "{dapp} requires {amount} ₳ collateral to proceed", locking spare pure-ADA UTxOs or paying the amount asked (5 ₳ by default) to its first address, with the password, then answering the site with the new UTxO; declined, it answered `Refused`. From 1.20 it answered `null`. Its Activity named a transaction whose inputs and outputs were all its own **Self Transaction**, which is how the collateral payment read.
- **Eternl** (closed source): collateral is set in Settings → Collateral. Since v1.11.17 (December 2023) it makes 3 ₳ collateral-sized UTxOs in ordinary sends, and may spend them when nothing else is left; Set Collateral still pays 3 ₳ to the account. Whether it opens a window on a site's `getCollateral`, and how its history names the payment, isn't documented anywhere found.
- **CIP-30** marks `getCollateral` deprecated: a wallet may leave it out.

So this wallet's `null` matches Lace today. A window would be a payment a site starts, behind the password; it waits for a site that needs it ([Kept in mind](../../post-release-roadmap.md#kept-in-mind)).

## Tests

- `tests/activity.test.ts` "names a collateral payment Set collateral, on its way and in a block, from its record, after a reclaim too": the pending entry with the watch gone, the confirmed one from a `tx_info` built from the submitted transaction (its 5 ₳ and change back to `0/0`, the rewards collected), its amount and CSV row, and a fresh read after a reclaim. It fails without the fix (`sent`).
- `tests/coin-control.test.ts` "records the payments that set it, for Activity, never a UTxO already held": the newest 20 kept, another account's apart, a reclaim and a held UTxO chosen leave the record and add nothing, and a wallet from before the record names its current collateral's payment.
