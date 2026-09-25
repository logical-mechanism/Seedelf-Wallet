# Chunk 15c: private CIP-30

Step 4 of [chunk 15](chunk-15-dapp-connector.md#the-steps): a site connects to a **private session** instead of the public account. The site talks standard CIP-30 to `window.cardano.seedelf` and sees an ordinary key account: a one-time account funded from the private balance. Nothing is asked of dApps.

**Why here (the user, 2026-09-25):** most people use dApps on the dApps' own sites, not in the wallet's dApp browser. Built on `web-wallet/dapp-connector`, in PR #262.

## Decided (the user, 2026-09-25)

1. **The choice is in the connect window,** public account or private session, remembered per site. *Connected sites* shows which one each site has.
2. **One session per site,** reused on every visit until it ends. Listings, orders and loans at the site stay reachable, and the site sees the same unlinked account each time, like a pen name.
3. **It's funded in the connect window, before the site gets the account.** You enter an amount (ADA, and tokens if you want). The wallet adds 5 ₳ of collateral, sends it, and waits until Koios sees it. Only then does `enable()` answer, so a site that reads the balance straight away sees the money.
4. **It's managed in a *Sites* part of the dApps page,** one row per private session, with Top up, Bring it back and Disconnect. A session holding a position on a site stays open until the position is closed there.

## Decided in the design (mine, for the user to overrule)

- **Bring it back doesn't end the session; Disconnect does.**
  - Something open at the site (a listing that sells, an order that fills) pays the account later. A session that closed at its return would stop being read, and that money would sit unseen until a restore scan.
  - So *Bring it back* sweeps what's there and leaves the site connected to an empty account, which Top up can fill again.
  - *Disconnect* ends it, and only once the account is empty. The next connect from that site starts a new session.
- **The funding asks for the password when `dappPassword` is on.** A site's request leads to it, as it does to a signature. Top up and Bring it back start in the wallet, not at a site, so they don't ask, as the wallet's own sends don't.
- **A session's stake key signs, too.** Some sites sign in with the reward address (`getRewardAddresses`, then `signData` with it). WebAssembly takes the stake key's index with the request (`stakeIndex`, `2/i` for session *i*, 0 for the public account).
- **Its collateral is the funding's 5 ₳ UTxO:** `getCollateral` gives it, and `getUtxos` leaves it out, as the public account's is left out.
- **One address:** `getUsedAddresses` and `getChangeAddress` give the session's address, and `getUnusedAddresses` gives none.
- **Closing the window while the funding confirms doesn't undo it:** the payment is sent. The site's `enable()` still answers once the money is there, and a site that went away finds itself connected next time.
- **Site sessions share the session book and its index sequence** with swaps, so no two one-time accounts ever share a key. Minswap's page lists only swaps, and the Sites part only site sessions.

## Design

**WebAssembly** (`wasm/src/cip30.rs`, `lib.rs`)
- `TxRequest` and `DataRequest` take `stakeIndex` (default 0).
- `OneTimeAccounts.rewardAddress(network, index)`.
- `sessionDataSigner` and `signSessionData`: CIP-8 with a session's keys.

**Worker**
- `sessions.ts`:
  - The record gains `site: { origin }`.
  - `siteOutBuild`/`siteOutSubmit`: the funding, as a swap's (Make public's builder, giveme.my).
  - `topUpBuild`/`topUpSubmit`: another funding payment into the same account.
  - `disconnect`: closes an empty site session.
  - A site session never closes by itself at its return.
- `dapp.ts`:
  - A connected site has `session?: index`. Every call resolves who it talks to (the public account, or session *i*): reads, collateral, addresses, signing (`inspectSessionTx`/`signSessionTx`, with the session's key and stake index), `signData`, submitting, and chaining (the signed outputs are kept per account).
  - The private connect:
    - `dapp-private-build` builds the funding for the connect waiting in the window.
    - `dapp-answer` with the funding's hash sends it, records the connection, and marks the request *funding*.
    - The worker reads the account every 10 s. Once it holds the funding, `enable()` answers.

**UI**
- **The connector's window:**
  - Connect gets *Public account* and *Private session*.
  - Private asks for the amount and tokens, then shows the funding review, with the password when it's on.
  - Then it waits: "Waiting for the network to confirm the funding".
  - A private session's signature says "Your private session sends", not the public account.
- **The dApps page gets *Sites*:** each private session's site, what its account holds, and its page, with Top up, Bring it back and Disconnect.
- **Settings' *Connected sites*** says *Private session* or *Public account* for each site.

## Built (2026-09-25)

- **WebAssembly:** `stakeIndex` on `TxRequest` and `DataRequest`, `OneTimeAccounts.rewardAddress`, `sessionDataSigner`/`signSessionData`. Rust 2 new tests (`session_test.rs`): a session signs data with its payment key and with its own stake key, and a withdrawal from its reward account with its stake key. Neither works with the public account's stake index.
- **Worker:**
  - `sessions.ts`: `site` records, `siteOutBuild`/`siteOutSubmit`, `topUpBuild`/`topUpSubmit`, `disconnect`, `siteAccount`, `accountUtxos`, and `buildFunding` shared with a swap's funding. A site's session doesn't close at its return.
  - `dapp.ts`: every path resolves the site's account. Also `privateBuild`, `answer(…, fund)`, the funding watch, and `disconnectSession`.
- **UI:**
  - The connector window: *Connect it to* your public account or a private session, the amount and tokens, the funding's review with the password, then the waiting screen. A signature says "Your private session".
  - `screens/SiteSessions.tsx`: the dApps page's *Sites*, each session's page, and Top up.
  - Minswap's page lists only swaps. *Connected sites* says each site's account.
- **Tests:** Vitest 5 in `dapp.test.ts`:
  - funded from the window, and `enable()` waits for the money, even with the window closed;
  - the site sees only the session's account;
  - signing with the session's keys, the stake key too;
  - a refused funding leaves the request waiting, and its unfunded session closes from the dApps page;
  - top-up and disconnect.

  Playwright 1: the connect window's private path up to giveme.my's recorded refusal, and the unfunded session under *Sites*, then disconnected.
- **Not tried live yet:** a real site on preprod connected to a private session. The e2e stops at giveme.my, whose real signature the fakes can't give.

## Out of scope here

- **The restore scan**, which finds sessions on a new device.
- **Moving a site between public and private** without disconnecting it.
- **More than one session per site.**
