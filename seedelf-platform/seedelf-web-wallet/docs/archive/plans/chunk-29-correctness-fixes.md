# Chunk 29 · Three small correctness fixes

The owner picked these for 1.5.0 on 2026-10-11, from [post-release-roadmap.md](../../post-release-roadmap.md): the stake key's signature over the other network's transaction ([Kept in mind](../../post-release-roadmap.md#kept-in-mind), the launch review's *Still open* #5), a public site's prompt not naming another of the wallet's public accounts (Kept in mind, the release review's C05, its public half), and Minswap's quote not held to the amount typed (the usability review's DX-8, [open question 5](../../post-release-roadmap.md#open-questions-for-the-owner)).

**Status: ✅ built 2026-10-11** on `web-wallet/correctness-fixes`, from `main` after #300. One PR: the plan, the build and the docs together, so this file went straight to the archive. What still holds is in [architecture.md](../../architecture.md) (*Signing*, the connector's `ties`, and the swap's estimate) and [flows.md](../../flows.md) (the connector's transaction prompt, and the swap's quote). The privacy policy is unchanged: nothing new is sent or kept.

## 1 · The stake key never signs what could be the other network's

**The hole.** A certificate and a required signer name no network, and the account's keys are the same on both. The stake key is the one key that signs over inputs the wallet can't find (a site's zero withdrawal), so a site connected while the wallet was on preprod could hand it a mainnet transaction, its inputs and fee the site's own there, that delegates, votes or deregisters the account's mainnet stake. The prompt showed each certificate, but as the preprod account's.

**What closes it** (`cip30.rs` `inspect`): a signature is refused when nothing ties the transaction to the wallet's network: no output, no withdrawal, no network ID, and no input or collateral the wallet found. Each of the first three names a network, the wallet already refuses each that names the other, and the ledger refuses each on any network but its own (`WrongNetwork`, `WrongNetworkWithdrawal`, `WrongNetworkInTxBody`). An input found was this network's. So the other network's transaction could only ever be one that pays no one.

- **Wider than the roadmap's sketch,** which refused the account's own certificates while any input was unknown. That would also refuse a delegation a site pays for from a UTxO not on chain yet, which the ledger already holds to this network by its outputs, and would leave a required signer's stake key, which a script on the other network could take as its owner's say-so. The rule here refuses exactly the transactions that could be the other network's.
- **What the roadmap said wrong:** a deregistration's 2 ₳ refund couldn't be "paid where the site likes". An output to the other network's address is refused by the wallet, and one to this network's makes the transaction invalid there, so the refund could only have gone to the fee.
- **Nothing else changes for the stake key:** a site's zero withdrawal over inputs the wallet can't find is signed as before, tied to this network by its reward address.
- **The words** stay English, as the Rust core's do: "Nothing in this transaction ties it to preprod: it pays no one, withdraws nothing, names no network and spends nothing the wallet can find. Your stake key is the same on every network, so its signature could change your staking on mainnet. The wallet won't sign it."

## 2 · A public site's prompt names another public account

**The gap.** For a site on the public account, the worker matched what a transaction pays against the private sessions alone (`ties`), so a payment to another of the wallet's public accounts read "An address", with no warning that signing ties the two on chain. Transaction details named it.

**What changed:**
- **`DappTie`** (`shared/rpc.ts`) is `{ account: number } | number`: a public account by index, or a private session. A session's prompt said "account" for any public account; it now says which too.
- **`ties`** (`dapp.ts`) matches every public account the wallet knows, by its payment keys (0 to 19 on both chains, and the reading's past that for the one on screen) and its stake key, less the site's own when it's on the public account (`view.account`, the dApp account the request is read for). An address can tie two: one account's payment key under another's stake key. Public accounts come first in the list, then sessions, each once.
- **The words:** with several accounts, "Your public account, Account 3 · Savings" under the output (`dappUi.paid.accountNamed`, the one new string, machine-translated as `dappUi.publicAccountNamed` is), and "It moves money between Account 1 and Account 3 · Savings" in the warning, both by number and name as the connector's windows name the site's account (`accountNumberAndName`). With one account, as before. `accounts.numbered` joined the guard's shared words: it's an account's name inside a warning, as `accountPicker.numbered` is.

## 3 · Minswap's quote is held to what was asked

**The gap.** The wallet took Minswap's estimate as it came, so a quote for another amount would have the user approve the minimum that amount gets, then pay the amount typed: 500 ₳ with the minimum for 1 ₳, which a front-runner could take nearly all of.

**What changed** (`sessions.ts`): `quotesTheAsk` refuses an estimate whose `amount_in`, `token_in` or `token_out` isn't what was asked, or whose paths don't each run from one token to the other with their `amount_in` adding up to the amount. `routeOf`, which every estimate goes through, checks it: a quote says so ("Minswap's quote was for a different amount or pair from the one asked, so the wallet won't swap on it. Try again in a moment.", `sess.otherQuote`), Review it myself refuses, and the runner builds nothing and tries again later, a retry rather than a pause, since nothing went out.

**Why a strict check is safe:** the roadmap held it back in case Minswap rounds `amount_in`, which only a live quote could show. Nine mainnet quotes on 2026-10-11 gave it back exactly, from 7 lovelace to 250,000 ₳ split over two DEXes and 98,765 ₳ over seven, each route's paths summing to it to the unit, for ADA→MIN, ADA→SNEK, ADA→iUSD, and MIN, SNEK and iUSD back to ADA. A quote moves nothing and costs nothing.

**The fakes** answered the recorded 10 ₳ quote whatever was asked, which is how DX-8 saw "906.5941 MIN" for both 1 and 500 ₳. Both now answer it for the amount and tokens asked (`tests/fixtures/minswap-echo.ts`), sharing the amount over the recorded paths, as Minswap does; what it gets stays the recording's. The unit fake's `echo: false` keeps the old answer, for the test that it's refused.

## Tests

- `wasm/tests/cip30_test.rs` `the_stake_key_never_signs_what_could_be_the_other_networks`: a delegation, a vote delegation, a deregistration and a stake key named as a required signer, each over an input the wallet can't find and paying no one, are refused on preprod and on mainnet, signed with `partialSign` or not; each is signed once an output, a network ID, a withdrawal or an input found ties it; someone else's certificate is shown, not refused. It fails without the fix.
- `tests/dapp-ties-accounts.test.ts`: a public site's prompt names accounts 2 and 3 by any address of their keys, both at once in order, never the site's own, and the account on screen when sites use another; a session's names the account it pays by index. `tests/dapp-ties.test.ts`: the words, by number and name with several accounts and as before with one.
- `tests/swap-quote-ask.test.ts`: `quotesTheAsk` against another amount, pair, paths that don't add up or don't end on the tokens, none, and an amount that isn't a number; a split route that adds up passes. A quote for another amount is refused and the same ask quoted right goes; a funded swap builds no order, nor does Review it myself, until Minswap quotes what was asked, then the order goes.

## Left for later

- **Minswap's `build-tx` quotes again on its side.** The order it builds is still read for its owner, receivers and script (chunk 24, Step 3), and its funding bounded by what was approved, but its minimum isn't read back from the order: the review's warning that the wallet relies on Minswap for it stays.
