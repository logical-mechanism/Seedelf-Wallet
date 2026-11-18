# Lane E4b

Returned by the workflow's agent `affb512f810d43027`, written here by the lead from its structured answer.

## Findings (2)

### e4b#1 · low · A site can keep the wallet from auto-locking: each connector window it opens counts as user activity when it mounts

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/App.tsx:94`
- **Who:** site · **Since:** fe8b7748 (chunk 15, the connector's window; the mount-time report is chunk 5's db18375c), before web-wallet/1.0.0 · **Confidence:** traced

**Scenario:**

Setup: the connector is on, the wallet is unlocked, auto-lock is at its 15-minute default, and the user has a tab open on https://s.example. s.example does not need to be connected. Every 14 minutes the site runs `cardano.seedelf.enable(); setTimeout(() => location.reload(), 3000)`. Each `enable()` makes the worker create the connector popup, focused. Its App mounts while the wallet is unlocked and sends `activity` at once, which moves `seedelf.lastActivity` to now. The reload ends the site's request: `gone()` records no refusal, and the empty window closes itself after 0.8 s. Result: while the user is away, the wallet never auto-locks for as long as that tab stays open. Someone at the machine can then send with no password (Send needs none once a review is signed). Also, a connected site's reads, which are refused once locked, keep being answered, so its polling outlasts the limit architecture.md names. The same reload also escapes the decline back-off (L35), so the focused popup can be opened as often as the site reloads.

**Evidence:**

1. ui/App.tsx:92-96: `useEffect(() => { if (!unlocked) return; reportActivity(); const events = ["pointerdown", "keydown"] ...` runs on every page's mount while unlocked, including `?view=dapp`. It isn't gated on `connectorWindow`.
2. ui/background.ts:111-119: `let lastActivity = 0; ... if (now - lastActivity < ACTIVITY_EVERY_MS) return; lastActivity = now; call("activity", {})`. A new window is a new page, so its first report always goes out.
3. background/handlers.ts:184-186: `case "activity": await wallet.touch();`. wallet.ts:360-365: touch sets SESSION_ACTIVITY = now while unlocked. wallet.ts:615-645: load() stays unlocked while `idle < lockAfter`.
4. background/dapp.ts:1059-1100: enable() for an unconnected, unrefused origin calls `this.ask(...)`, and ask (dapp.ts:~1590) calls `this.deps.window.show()`. dapp-window.ts:30 then runs `chrome.windows.create({ url: DAPP_PAGE, type: "popup", focused: true })`. No user gesture on the page is needed.
5. dapp.ts:874-889 gone(): removes the page's requests and rejects them with PAGE_GONE. It never calls refuseFor.
6. ui/screens/DappApprovals.tsx:101-113: with no approvals it calls `dapp-close` after CLOSE_AFTER_MS (800 ms, line 60). dapp.ts:748-760 closeWindow sets `closing`, and dapp.ts:765-770 windowClosed with nothing waiting returns with no refusal.
7. The only page the worker opens unasked is this window: grep for windows.create/tabs.create finds dapp-window.ts:30 alone; the other two are user clicks.
8. The docs promise the opposite. docs/architecture.md:556: "Reads are refused while locked, and a site's calls never count as activity, so auto-lock ends it". The calls themselves don't count: dapp.ts never calls touch, and pings return early at sw.ts:408. The window they open does.

**Fix:**

Count only input as activity in the connector window: skip the mount-time `reportActivity()` when `connectorWindow` is set and keep the pointerdown/keydown listeners. A user who answers a prompt clicks, and that click reports. Class: anything a site can make one of the wallet's pages do without input. The window's other automatic requests (status, dapp-approvals, preferences, accounts, lock-deadline, dapp-close) change no state. Test: render App at `?view=dapp` unlocked with a fake `call` and assert that no `activity` is sent before a pointerdown.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for reportActivity, auto-lock with site/window/connector/dapp, "activity", "keeps the wallet unlocked", "pop window" and spam. independent-review L35 and L36 (enable() spam: one connect per origin, a per-origin cap and a refusal after a decline) cover neither a page that reloads before the user answers nor activity. launch-review #17 is a different issue (a trapped instance kept pinging).

### e4b#2 · low · `dapp-approvals` answers while locked, with a waiting signature's summary and its ties to the wallet's other accounts and sessions

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:433`
- **Who:** nobody · **Since:** fe8b7748 (chunk 15) · **Confidence:** traced

**Scenario:**

A connected site's signTx waits in the connector window, the user walks away, and auto-lock locks the wallet. A lock leaves waiting approvals in place, and the window now shows Unlock. Anyone at the browser opens DevTools on that window and posts `{type: "dapp-approvals"}` on a `seedelf.ui` port. The worker answers with the site's origin and title and the full DappTxSummary: the account's own output addresses, what it pays, and `ties`/`staked`/`certified` (for example, that the transaction pays account 2 and touches private session 4). That is the wallet's own knowledge of which accounts and sessions are the user's, which the sealed records keep from anyone while locked. Nobody in the threat model reaches it: it needs a person at the locked browser with DevTools.

**Evidence:**

handlers.ts:433-434: `case "dapp-approvals": return ctx.dapp.approvals();` has no lock check. The handlers next to it do. handlers.ts:450-456: `// Which sites the user turned away is as private as which are connected: only for a wallet that's open.`, with `if ((await wallet.state()) !== "unlocked") throw new WalletLocked(...)` for dapp-declined and dapp-let-ask. nft-image does the same at 412-414. dapp.ts:629-633: approvals() returns `this.waiting.map(...)`. dapp.ts:725-736 stateChanged(): only no-wallet clears anything, and a lock returns at line 733 with `waiting` untouched. rpc.ts:1525-1555: a sign-tx approval carries `summary: DappTxSummary` (ownOutputs[].address, paid[].yours) plus `ties`, `staked` and `certified`. privacy.md:343 and architecture.md:550 say the declined sites are shown only while unlocked and refused while locked. Only DappApprovals asks `dapp-approvals` (ui grep), and App.tsx mounts it only while unlocked (the locked branch renders Unlock first), so a lock check breaks no screen.

**Fix:**

Refuse `dapp-approvals` while locked, as `dapp-declined` is refused. Class: answers that come from worker memory rather than sealed records. `dapp-unlocking` is deliberate, since the Unlock screen names those sites. `tx-detail` for a waiting site transaction is also deliberate: tx-view.ts:141-143 says the site's own bytes, and nothing is marked yours while locked.

**Known check:**

Searched backlog.md and archive/plans for dapp-approvals, approvals(), "while locked" with site/sign/approval/window, and privacy-review §2.11 (reads refused while locked, about the site's side, not the wallet's pages). Nothing covers waiting approvals answered to a page while locked.

## Guards (12)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-web-wallet/extension/src/background/ui-port.ts:28` | A content script (any site's renderer) or another extension from asking for a send, a reset, the phrase or anything else on the UI port: only this extension's own pages (sender.id plus a chrome-extension://<id>/ URL) are answered, and others are disconnected unanswered | tests/worker.test.ts (~line 145: "A content script (a site's page) and another extension are closed unanswered") |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sw.ts:364` | An iframe, a non-tab context or a port not opened by this extension's content script using the connector; and, at line 367, any origin but https or http on localhost/127.0.0.1. The origin is Chrome's, never the page's | none found for the refusals (tests/worker-language.test.ts drives only the accepted top-frame https shape) |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sw.ts:427` | Internal error text (Koios's words, the lock's, in the user's language) reaching a site: only a DappError's own failure goes out, and anything else becomes SITE_TRAPPED in English | tests/dapp-site-english.test.ts covers dapp.ts's side; sw.ts's own mapping: none found |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sw.ts:113` | Two background runs at once (the alarm and an unlock), which would send two withdraws or steps seconds apart; one asked during a run goes once more after it | none found |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/sw.ts:382` | A trapped WebAssembly instance staying unlocked under a page's request: the wallet locks and drops the keys (handlers.ts:48-52 does the same for unawaited runs) | tests/run-traps-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:259` | Remove wallet, while unlocked, under a maybe-sent payment, open sessions holding money, a Lovejoin chain being sent, a maybe-sent public mix, parts still to go or an unreadable network, unless `force` (the user saw the list) | tests/remove-wallet.test.ts, tests/remove-wallet-mix.test.ts, tests/parts-send-review-fixes.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:380` | Switching the public account while a payment may still go through or a public mix is being sent (a watch losing its account) | tests/lovejoin-planner.test.ts:2239 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:149` | Paying twice after Remove wallet and a restore: a kept maybe-sent payment of this phrase is watched again, and another phrase's is dropped (adoptKept; Lovejoin's at 151) | tests/mempool-watch.test.ts:172, tests/restore-scan.test.ts:955 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:273` | Losing a maybe-sent public mix's record across Remove wallet (keepOnReset, unlocked only) | tests/remove-wallet-mix.test.ts |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:356` | A site's signature read for the dApp account Settings just left being signed with the new account's keys: it's declined once the change is written | tests/handlers.test.ts:250 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:405` | Signing or connecting on a network the wallet has left: site requests from the old network are declined (sw.ts:346 does it again from storage.local.onChanged) | tests/dapp.test.ts (networkChanged); tests/handlers.test.ts:275-298 drive network-set |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:359` | Anything a site waits for going on after the connector is switched off (connectorOff); line 362 keeps the switch off without Chrome's access to sites | tests/dapp-reach.test.ts:118, tests/dapp-enable.test.ts:355 |

## Checked and holds

- The UI port answers only this extension's pages: a content script's sender.url is the site's page, never chrome-extension://<id>/, so a site's renderer can't reach any of the 130 requests.
- The manifest has no web_accessible_resources and no externally_connectable, and the worker has no onMessage, onMessageExternal or onConnectExternal listener. A web page can't load or frame an extension page, and another extension's connect or message goes to an event nothing listens to.
- The wallet's pages listen to runtime.onMessage only for the two broadcast events, which carry nothing and only trigger a re-read. Our bridge never calls runtime.sendMessage.
- Every name in REQUEST_LIST has a case in handle() and an entry in Requests: 130 each, diffed with a script. isMessage accepts only those names, and anything else gets an English 'unknown request'.
- handle()'s return type is the union of every result, so a case returning another request's type would still type-check. I spot-checked the forwarded services (coins.setLocked/use/reclaim, lovejoin.lookForPools, parts.shown, sessions.list/forget/scan/advance/stop/resume/skipCollateralMix): each returns its request's declared result.
- Errors and stage reports go only to the asking page's own port. Nothing logs payloads (one console.warn in data-layer.ts carries no payload). Broadcasts carry no data.
- No handler returns a private key or entropy. generate-phrase returns a fresh phrase, reveal-phrase needs the password and counts toward the back-off, check-phrase says only yes or no, and phrase-words gives only the length, unlocked only.
- Every handler that reads keys or sealed records goes through Wallet.withKeys, withAccount or withStoreKey, whose load() applies the auto-lock deadline first. Locked, they throw. reset-check, phrase-words, check-phrase, dapp-declined, dapp-let-ask and nft-image refuse while locked. Worker memory is the only exception (e4b#2).
- Auto-lock is enforced at every key use: touch() and every key use run load() first, so a missed alarm or a WebAssembly that fails to load only delays the wipe of session storage, and activity after the deadline can't bring the wallet back.
- All of sw.ts's listeners are registered synchronously at the top level. getContext drops a failed start. The sessions alarm stops while locked, and the auto-lock alarm stops with no entropy, without starting WebAssembly.
- A site's own CIP-30 calls never count as activity: dapp.ts never calls touch, and pings return before anything runs. The window they open does (e4b#1).
- The connector port check uses Chrome's sender (id, tab, frameId 0, origin), each port gets its own crypto.randomUUID session, and the scripts are registered with allFrames: false. An ad iframe or an http site gets nothing.
- sw.ts gives a site only a DappError's own failure. DappErrors built from other errors carry Chrome's window error text or WebAssembly's English address-check text (lib.rs from_json gives 'bad request: …' about the site's own arguments), never key material.
- The extension pages' CSP is script-src 'self' 'wasm-unsafe-eval' and the UI has no innerHTML, dangerouslySetInnerHTML or eval, so a site's title, datum or metadata shown in the connector window can't become code that reaches the UI port.
- preferences-set writes only validated fields (PreferencesService.set checks each one, and dappAccount excludes the one-time accounts' 24301'). network-set refuses a network the build lacks.
- The connector stays off where Chrome won't keep local storage from content scripts (guardedConnector). permissions.onRemoved turns it off and declines everything waiting, and Remove wallet does the same.
- The connector window's automatic requests are status, activity, dapp-approvals, preferences, accounts and lock-deadline, and only activity changes state. It reads balances only when the user picks a private session.
- tx-detail reads only bytes the worker holds, or a site's waiting transaction, and marks nothing as yours while locked.
- The bridge relays only messages from its own window and origin, and the method name is checked in the bridge and again in the worker.
- Waiting parts live in session storage, which a lock wipes, so Home's poll pumping parts (pending-tx, unlock=false) can't send anything at the moment of unlock.
- An object passed as `pool` where a handler forwards it raw can't become a made-up pool: lovejoin.poolNamed looks it up by id and throws.

## Notes

- create-wallet and restore-wallet run side effects before wallet.create refuses an existing vault. In handlers.ts:126-140, accounts.useFirst() sets the active account to 0 without the session-cache wipe that accounts.use does (WIPED_ON_SWITCH: the kept reading isn't tied to its account, so account N's balances would show as account 0's until Refresh), and SESSION_RESTORED is set or cleared. No UI path reaches this with a wallet present, because the welcome screens unmount on state-changed and the button is disabled while busy. A `wallet.state() === "no-wallet"` check at the top of the case would close it.
- dappSession (sw.ts:365) calls `new URL(sender.origin)`, which throws for an opaque origin ("null", a page served with a CSP sandbox). The listener throws before it adds onMessage or disconnects, so that page's calls hang forever (page.ts has no timeout) while its pings keep the worker up. Only the sandboxed site itself is affected. A try/catch with port.disconnect() would make it fail cleanly.
- storage-access.ts says the storage access level doesn't outlive the browser. If so, the connector's content scripts, registered with persistAcrossSessions, can run in tabs restored at browser start before the worker sets TRUSTED_CONTEXTS. In that window a compromised renderer could read chrome.storage.local, including the sealed vault, for offline guessing. The bridge itself never reads storage, and it needs a renderer exploit, which is out of scope. I couldn't verify Chrome's persistence offline.
- The page's `pool` argument is checked inconsistently. lovejoin-funding, withdraw-now, bring-all-back and bootstrap-most check `typeof === "string"`, while mix-private-build, again-build, again-public-build, mix-public-build and bootstrap-release (handlers.ts:545-581) pass it raw. It's harmless: poolNamed throws for a non-string, and only the wallet's pages send it.
- account-use's guard fails open on an unreadable network. atStake's catch (handlers.ts:643-645) replaces the network's entry with `unreadable` and drops a maybeSent it had already read; Remove wallet counts that entry, account-use doesn't. It needs a sealed record that won't open, and no money is at stake (the ledger refuses a double spend).
- account-use also refuses a switch while a private payment may still go through, because maybeSentOn is per network, not per account. The rpc.ts doc says 'something of that account's'. It's over-strict, UX only.
- For the owner on e4b#1: the same reload trick escapes the decline back-off. A page that goes away before the user answers records no refusal, so a site can pop the focused connect window as often as it reloads. The user's way out is closing the tab or the connector switch. Counting a page that goes away as a decline would change what dApps see on a reload, which is the owner's call.
- If the user allows the extension in incognito, sites there share the worker and the connected-sites record with the normal profile. dappSession doesn't look at sender.tab.incognito, so a site connected in a normal tab reads as connected in incognito too (isEnabled), which links the two visits. It's the user's opt-in. privacy.md doesn't mention it; a line could.
- handlers.ts imports `t` from ../i18n (index.tsx, React included), as 33 other background files do, while sw.ts's comment says it takes the engine alone to avoid React. Bundle size only.

## Coverage

Read in full, every line: shared/rpc.ts (3,323), background/sw.ts (459), background/handlers.ts (655), background/ui-port.ts (69). Also read in full: background/wallet.ts, accounts.ts, runs.ts, storage-access.ts, connector.ts, dapp-window.ts, wasm.ts, content/bridge.ts, content/page.ts, shared/dapp.ts, src/manifest.ts, ui/background.ts, ui/view.ts, shared/open-in.ts, and the built dist/manifest.json (read only). Read in part, where my files call them: dapp.ts (call/run, enable, ask, answer, approvals, stateChanged, closeWindow, windowClosed, networkChanged, dappAccountChanged, connectorOff, gone, sites, forget, disconnectSession, answerSite, failed, notSent, DappError), parts.ts (waitingOn, pumpParts, PartsService), preferences.ts (NetworkChoice, PreferencesService), tx-view.ts (txView), lovejoin.ts (poolChoice, poolNamed, fits, funding's head, publicBuild's head, withdrawDue, publicMaybe, chainsSending, publicChainsSending), sessions.ts (mixOutBuild, againBuild, the serial queue), pending.ts (maybeSentOn, adoptKept), balances.ts (account tagging), i18n/core.ts (startI18n), ui/App.tsx (lines 1-200), ui/screens/DappApprovals.tsx (load, auto-close, the balances read), wasm/src/lib.rs (from_json, dataSigner), wasm/src/cip30.rs (data_signer). Checked against docs/architecture.md and privacy.md for auto-lock and locked-state claims, and searched backlog.md and archive/plans for each candidate. I compared REQUEST_LIST, the Requests interface and handle()'s cases by script; scratch files are in the E4b scratch folder. Not reached: the services behind each handler in full (other lanes: E1-E7), dapp.ts's per-method argument handling (E3a), the screens beyond the connector window's automatic requests, and the Rust behind the WebAssembly calls. I ran no tests and built nothing.
