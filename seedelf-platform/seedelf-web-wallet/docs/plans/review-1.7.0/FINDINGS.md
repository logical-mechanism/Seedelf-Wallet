# 1.7.0's release review: the findings

Every finding of the review of #325–#338, at `6bca8bec`, with what its verifiers said and what the fixes did. The review's workflow was stopped before its synthesis (the lead's call, once the fix lanes reproduced every finding test-first), so this file is made from its findings and the fix lanes' reports (`fixes/<lane>.md`). The review's own reports are `reports/<id>.md`, its verifiers' `verify/v-<id>-<n>-<trace|impact>.md`, and the overflow sweep's `verify/ovf-*.md`.

**140 findings:** 85 low, 37 nit, 10 owner-call, 7 medium, 1 high.

## pr325#0

**low** · docs · confidence high · lane `docs-roadmap`

**"Done that way" leaves out two steps its own plan names: the status run and checklist item 9**

*Claim:* The record opens "Done that way" right after a plan line that names the deploy, then `status`, the curl checks, the package, e2e, checklist item 9, the upload and the record PR. It records the deploy, the curls, the package and e2e. It says nothing of the `status` run, which never happened, or of checklist item 9, the store build checked by hand on both networks. The packaging session handed item 9 to the owner, and its outcome is recorded nowhere.

*Scenario:* The 1.7.0 release, or an audit of 1.6.0, reads the record to learn whether the shipped build was checked by hand on mainnet. That is item 9, the only check of the store build against the real data layer and its host list (the worker's network panel). "Done that way" reads as yes. If item 9 was skipped, a mainnet-only fault in the shipped build went unchecked while the record says the plan was followed, and the next record, copied from this one, can drop item 9 silently. The missing `status` run itself loses nothing: the deploy printed `DEPLOYED 942e3bbc… (3b03a0e… kept as .prev)`, which is what `status` shows.

*Evidence:* - roadmap.md:62: "After the merge, in order: the API's deploy from the merge commit (Actions → Data layer deploy, `deploy`, then `status`) … then the package on the merge commit, e2e on it, checklist item 9, the upload (…), and the record PR."
- roadmap.md:63: "Done that way: PR #324 merged as `babb8e76`, and the API deployed from it first … The whole e2e suite, 104 tests, passed on it." No `status`, no item 9.
- `gh run list --workflow data-layer-deploy.yml`: on babb8e76 only 40440233291 (deploy); the next run, 40713719454 (2026-10-28, 641f751c), is also a deploy.
- Packaging session transcript (~/.claude/projects/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/09bbfc44-6eb2-4ce5-b309-893da54edab8.jsonl): "The owner does checklist item 9 locally".
- development.md:205: "…`deploy`, on `main`, approved, then a `status` run".
- development.md:244: "Then do checklist item 9 by hand on it."
- seedelf-data/deploy/README.md:146: "`status` prints the sha256 of the running binary and of `.prev`. The deploy run that installed a binary printed the same sha256 … in `DEPLOYED <sha256> (<the one before> kept as .prev)`".

*Fix:* Add one clause to roadmap.md:63: "checklist item 9 by hand, the owner's: <outcome>" (or "not run"), and "the deploy's own `DEPLOYED` line stood in for `status`". Separately, an owner's call: since the deploy prints what `status` does, either drop "then a `status` run" from development.md:205/:280 and the runbook's "after its `status` run", or keep running it.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/roadmap.md:62`, `seedelf-platform/seedelf-web-wallet/docs/roadmap.md:63`, `seedelf-platform/seedelf-web-wallet/docs/development.md:205`, `seedelf-platform/seedelf-web-wallet/docs/development.md:244`, `seedelf-platform/seedelf-web-wallet/docs/development.md:280`, `seedelf-platform/seedelf-web-wallet/docs/development.md:288`, `seedelf-data/deploy/README.md:146`

*Verified:* trace partly (nit); impact partly (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): gh run list shows only deploys after babb8e76

1.6.0's record now says no status run followed and item 9's and the db-sync tests' outcomes aren't recorded. Dropping development.md's status step is the owner's call.

## pr325#1

**nit** · release · confidence high · lane `docs-roadmap`

**The C compiler line is paraphrased, without its Ubuntu package revision**

*Claim:* development.md says to keep wasm/build.sh's last line, `C compiler: <first line of clang --version>`, for the record. The build printed `C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`, and the record says "Ubuntu clang 21.1.8". That drops the package revision, which is the part apt changes under a fixed upstream version.

*Scenario:* Someone rebuilds 1.6.0 to check the store's zip using a 21.1.8 from another revision or distribution. The record can't say whether their compiler is the one that built it. The same 2026-10-13 apt run that made 21.1.8 the default also moved clang-18 from 18.1.3-1ubuntu1 to 18.1.8-20ubuntu8, so revisions do change on this box. 1.5.0's record shortened its line the same way.

*Evidence:* - /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/09bbfc44-6eb2-4ce5-b309-893da54edab8/scratchpad/owner-package-1.6.0.log:283: "C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)".
- roadmap.md:63: "Ubuntu clang 21.1.8 (18.1.3 at 1.5.0: …)".
- development.md:248: "`wasm/build.sh`'s last line, `C compiler: <first line of clang --version>`".
- /var/log/dpkg.log: "2026-10-13 14:38:26 upgrade clang-18:amd64 1:18.1.3-1ubuntu1 1:18.1.8-20ubuntu8" and "2026-10-13 14:38:23 upgrade clang:amd64 1:18.0-59~exp2 1:21.1.6-71".

*Fix:* Copy the line as printed: "C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)".

*Files:* `seedelf-platform/seedelf-web-wallet/docs/roadmap.md:63`, `seedelf-platform/seedelf-web-wallet/docs/development.md:248`, `seedelf-platform/seedelf-web-wallet/docs/development.md:291`, `seedelf-platform/seedelf-web-wallet/wasm/build.sh:77`

*Verified:* verify partly (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): owner-package-1.6.0.log:283 and clone-package.log:197

The line as printed: C compiler: Ubuntu clang version 21.1.8 (6ubuntu1).

## pr326#0

**low** · privacy · confidence high · lane `docs-design`

**The cheaper routes' 'who sees what' claims miss traffic the code sends on the private side's behalf (shared submit part, per-part Koios fallback, one-time accounts on the public part)**

*Claim:* Three of the parked idea's privacy claims are contradicted by how the wallet routes requests today. (1) The 'Split who sees what' route says neither operator alone ties the public account to the private side. But it moves only the public account's reads. The public account's submits share the one 'submit' part with the private side's. And each part falls back to Koios on its own. (2) 'Bring your own Tor' routes 'our hosts alone'. Koios is one host for both sides, so the private side's Koios traffic would go direct. (3) The original shape's 'no request ties the two' leaves out private sessions' one-time accounts, which are read on the public part.

*Scenario:* Split, built as written: every send the wallet watches goes through submitWatched to DataLayerKoios.submitTx, while the 'submit' part is up. So the data layer keeps receiving the public account's transactions (its stake address and inputs, per privacy.md:114) from the same IP address as the private submits and giveme.my's requests. It ties them just as today. During any 5-minute outage of the private part, the private reads and submits go to Koios beside the public reads. If the pool was read from Koios, so does Koios's tx_info on which boxes are the wallet's (lovejoin.ts:5679, :5702). Bring your own Tor: in the same windows, under the Koios-only switch and on all of preprod (no data origin), private-side requests leave directly from the IP address that reads the public account.

*Evidence:* post-release-roadmap.md:344 "The public account's reads go to Koios, and the private side to the data layer and giveme.my, so neither operator alone ties the two."; :343 "a `chrome.proxy` PAC script that routes our hosts alone"; :333 "The shape was the private side alone through Tor (submits, giveme.my, the private index's reads), the public account's reads direct, so no request ties the two by an IP address." data-layer.ts:40 `export type Part = "public" | "private" | "submit";`; :393–394 `override async submitTx(...) { if (!(await this.uses("submit"))) return super.submitTx(txCbor);`; pending.ts:476 `submitted = await koios.submitTx(bytes);` (submitWatched); privacy.md:113 "Each part (the public routes, the private index, submits) goes to Koios on its own for 5 minutes when it can't answer"; :114 "The public side and submits tell it what they told Koios: the stake address, the transactions sent, from the IP address."; data-layer.ts:233–234 `private async read<R>(...) { if (!(await this.uses("public"))) return onKoios();` used by credentialUtxos (:244) and addressUtxos (:259); sessions.ts:2390 `koios.credentialUtxos([keyHash])`; lovejoin.ts:5679 "for those of `koios` (their pool came from Koios), its tx_info", :5702 `this.deps.koios(network).koiosAlone()`.

*Fix:* Add one clause to each route. Split: "the public account's submits and status checks go to Koios too (the `submit` part split in two), and the private side's per-part Koios fallback waits or is off; otherwise the split holds only while the data layer answers." Bring your own Tor: "Koios can't be split by host: the private side's Koios fallback, Koios-only and preprod leave direct." The shape: "and private sessions' one-time accounts, which are read on the public part."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:344`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:343`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:333`, `seedelf-platform/seedelf-web-wallet/extension/src/background/data-layer.ts:40`, `seedelf-platform/seedelf-web-wallet/extension/src/background/data-layer.ts:393`, `seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts:476`, `seedelf-platform/seedelf-web-wallet/extension/src/background/data-layer.ts:233`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2390`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:5702`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **fixed**. Test: docs-only: data-layer.ts Part = public|private|submit; submitTx/evaluate on submit; credentialUtxos, utxoInfo, usedStakeAddresses, accountTxs, txStatus via read() (public)

Tor entry: the shape names the private side's public-part reads; Bring your own Tor says Koios can't be split by host; Split says the parts must split by side and holds only while every part answers.

## pr326#1

**low** · docs · confidence high · lane `docs-design`

**The 'one check still owed' leaves out Koios, which the text relies on, and contradicts the root README on giveme.my**

*Claim:* The doc names one check still owed: whether the data layer and giveme.my answer Tor exits, which it says every route needs. Problems: (a) Two of the PR's own claims need Koios to answer Tor exits: a gateway 'hides users from Koios' on fallback, and past the rate-limit bucket 'the wallet reads Koios … never banned'. Yet Koios isn't on the list. privacy.md calls Koios unchecked, and the root README (the owner, 2025-04-30) says koios.rest does not support Tor access. (b) The same README line says giveme.my does support Tor access, while the PR lists giveme.my as unchecked. (c) 'Every route above' includes the split, which uses no Tor, and Nym's mixFetch, whose exits are Nym's.

*Scenario:* Whoever picks this up runs the dev-box check against the data layer and giveme.my only, finds both answer, and builds the DoS plan of a shared bucket for Tor exits with Koios past it. Tor users who pass the bucket then fall back to a Koios that, per the README, refuses Tor. They are effectively banned rather than slowed, and the private side's Koios fallback fails rather than hiding them. They also treat the split as gated on a Tor check it doesn't need. And they check giveme.my, which the owner runs and has already written supports Tor.

*Evidence:* post-release-roadmap.md:346 "Still unchecked: whether the data layer and giveme.my answer Tor exits today. Every route above needs them to."; :337 "it would hide users from Koios (when the wallet falls back to it)"; :347 "past it the wallet reads Koios, as it does whenever a part is busy, so Tor users get slower, never banned"; README.md:162 "`koios.rest` does not support Tor access. `giveme.my` does support Tor access but is not implemented at the CLI level." (git log -S: 8cba7a2f, logicalmechanism, 2025-04-30); privacy.md:119 "Koios has no onion service, and whether it takes Tor exits is unchecked".

*Fix:* Make the line "whether the data layer, giveme.my and Koios answer Tor exits", noting the README's two statements: Koios no, giveme.my yes, both the owner's from 2025. Narrow "Every route above" to "the Tor routes (for Nym, its exits)".

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:346`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:337`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:347`, `README.md:162`, `seedelf-platform/seedelf-web-wallet/docs/privacy.md:119`

*Verified:* trace partly (low); impact partly (low)

*Outcome (docs-design):* **partly**. Test: docs-only: root README.md:162

(a) Koios added to the owed check and (c) 'every route' narrowed to the Tor routes; (b) not a contradiction per its verifiers, so the README's 2025 lines are cited as maybe meaning onion services. :347 'never banned, as long as Koios takes Tor exits'.

## pr326#2

**low** · docs · confidence high · lane `docs-design`

**Bring-your-own-Tor assumes the `proxy` permission can be optional; Chrome doesn't allow it**

*Claim:* The route says the `proxy` permission would be 'asked for at the switch, if Chrome lets it be optional'. Chrome's permission rules exclude `proxy` from optional permissions, so it would be required on every install. chrome.proxy also sets Chrome's whole proxy configuration, not just the extension's requests, and only one extension can hold that setting at a time.

*Scenario:* The route is costed as an opt-in. Built, it adds `proxy` to every install's required permissions. Its warning, as Chrome's permissions list gives it, is 'Read and change all your data on all websites' (recalled, not checked offline). So the update disables the wallet for every user until they accept, to serve only users who already run Tor. That goes against the data layer's own rule: no install warning, nothing disabled on update. The PAC script also replaces a user's system or enterprise proxy for every host it doesn't route. And the route can't work at all while a VPN extension holds the proxy setting.

*Evidence:* post-release-roadmap.md:343 "It needs the `proxy` permission (asked for at the switch, if Chrome lets it be optional)"; extension/node_modules/@types/chrome/index.d.ts:9516–9530 "/** Source : https://developer.chrome.com/docs/extensions/reference/api/permissions */ type ManifestOptionalPermission = Exclude<ManifestPermission, | "debugger" | "declarativeNetRequest" | ... | "geolocation" | "proxy" | ...>"; @types/chrome proxy namespace: "Use the `chrome.proxy` API to manage Chrome's proxy settings"; manifest.ts:84 `permissions: ["storage", "alarms", "sidePanel", "scripting"]`; post-release-roadmap.md:290 "no install warning, and nothing disabled on update".

*Fix:* Replace the hedge with the answer: "`proxy` can't be optional in Chrome, so it would be a required permission for every user, with a full-access warning and a disable on update, and its PAC script takes over the browser's proxy setting."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:343`, `seedelf-platform/seedelf-web-wallet/extension/src/manifest.ts:84`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:290`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **fixed**. Test: docs-only: the trace verifier's run in Chrome for Testing 153 (permissions.request refuses proxy; all-sites warning)

proxy can't be optional: required at install with the all-sites warning, an update adding it disables the wallet for a user without the connector's grant; a PAC script sets the whole browser's proxy, one extension at a time, policy proxies can't be changed.

## pr326#3

**nit** · docs · confidence high · lane `docs-design`

**'Neither open nor an exit' sits beside 'anyone can use it'**

*Claim:* The doc says the gateway isn't an open proxy, then says its address ships in the wallet so anyone can use it. The gateway has no authentication, only a limit of 16 tunnels per IP address. So it is open to anyone; it just reaches only Tor relays.

*Scenario:* Reading :339 alone, the owner weighs the risk under DigitalOcean's acceptable use policy as smaller than :340 shows it to be.

*Evidence:* :339 "The gateway is neither open nor an exit, but it is a proxy into Tor"; :340 "the gateway's address ships in the wallet, so anyone can use it"; the gateway's README (clone at 8977093): `"tunnel_per_ip": 16`, with no authentication.

*Fix:* "open to anyone, though it reaches only Tor relays, and not an exit".

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:339`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:340`

*Verified:* verify partly (nit)

*Outcome (docs-design):* **fixed**. Test: docs-only

In its verifier's narrower form: 'no exit, nor open in tor-js's sense (it connects only to relays the consensus lists)', not 'open to anyone'.

## pr326#4

**nit** · docs · confidence high · lane `docs-design`

**tor-js's HTTPS runs on an alpha crypto provider, a cost the doc leaves out**

*Claim:* tor-js handles HTTPS inside its WebAssembly, using rustls with rustls-rustcrypto 0.0.2-alpha and a root-certificate bundle compiled in. With it, the private side's TLS to the data layer and giveme.my would no longer run on Chrome's TLS stack. The 'And in the extension' costs list only the offscreen document and the bundle size.

*Scenario:* A pick-up (the owner wants to 'approach this the right way') costs the route from :341 and never weighs that its TLS would run on an alpha, unaudited provider, with root certificates frozen at each release.

*Evidence:* tor-js clone at 8977093: crates/tor-js-wasm/Cargo.toml `rustls-rustcrypto = "0.0.2-alpha"`, `webpki-roots = "1.0.10"`; src/runtime.rs:8 "TLS: Uses rustls with rustls-rustcrypto (pure-Rust crypto for WASM)"; src/lib.rs:445 "the Mozilla CA bundle (compiled in via webpki-roots)".

*Fix:* Add one clause under 'And in the extension'.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:341`

*Verified:* verify confirmed (nit)

*Outcome (docs-design):* **fixed**. Test: docs-only: tor-js clone at 8977093 (Cargo.toml rustls-rustcrypto 0.0.2-alpha, webpki-roots 1.0.10; lib.rs with_root_certificates) and rustls 0.23.46 with_root_certificates -> new_without_revocation

One sentence under 'And in the extension'.

## pr326#5

**nit** · docs · confidence high · lane `docs-design`

**Two links work only by redirect, and the cited branch holds nothing of the spike**

*Claim:* github.com/privacy-ethereum/tor-js redirects to ethereum/tor-js, the repository tor-js's own package.json names. privreads.ethereum.foundation/workstreams/torjs redirects twice to reads.ethereum.foundation/workstreams/torjs/. And 'on `web-wallet/tor-spike`' points at a branch holding only this doc commit. The source the spike read exists only in a session scratchpad under /tmp.

*Scenario:* A later reader follows the branch expecting the spike's notes and finds only the roadmap edit. The redirects could break whenever their owners change them. The clone is lost at a reboot.

*Evidence:* curl -L: privacy-ethereum/tor-js → 200 at https://github.com/ethereum/tor-js (1 redirect); privreads… → 200 at https://reads.ethereum.foundation/workstreams/torjs/ (2 redirects, by way of redirects.ethquokkaops.io); package.json at 8977093 `"url": "git+https://github.com/ethereum/tor-js.git"`; gh api branches/web-wallet%2Ftor-spike → a7abf961; git log babb8e76..origin/web-wallet/tor-spike shows only a7abf961.

*Fix:* Link the canonical URLs. Drop 'on `web-wallet/tor-spike`', or say the 8977093 pin is the record. If the owner wants the clone kept, move it out of /tmp.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:334`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:345`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:333`

*Verified:* verify partly (nit)

*Outcome (docs-design):* **fixed**. Test: docs-only: GET of github.com/ethereum/tor-js and reads.ethereum.foundation/workstreams/torjs/ each 200 with no redirect

Links made canonical; the branch wording says it holds only this entry. The /tmp clone isn't a doc defect (owner's call to keep a copy).

## pr327#0

**low** · security · confidence high · lane `docs-design`

**Release-time token, DRep and pools refreshes fetch Koios through a Node whose built-in store still trusts emSign ECC Root CA - G3**

*Claim:* #327 closes GHSA-6q48-6c7w-9gw2 for the happy-path Python. Its body accounts for pip's store and the Rust crates' store, but not Node's.

- Node compiles in its own Mozilla store and uses it by default.
- The dev box's Node is v24.19.0, nvm's default lts/*, with no NODE_OPTIONS, NODE_EXTRA_CA_CERTS or NODE_USE_SYSTEM_CA set.
- That Node still trusts emSign ECC Root CA - G3 (and C1, C3), the root the advisory is about. The OS store and certifi 2026.10.23 no longer do.

The three refreshes the owner runs at every release (npm run tokens, npm run dreps, npm run lovejoin-pools) fetch api.koios.rest and preprod.koios.rest with Node's fetch. They write files that ship in the extension: src/tokens/registry.<network>.json, src/dreps/<network>.json and src/lovejoin-pools.json. Node doesn't check revocation, so revoking the eMudhra intermediates doesn't protect these fetches.

This isn't a code defect in any PR. It's a gap in the environment at the release step this review gates.

*Scenario:* 1. During 1.7.0's release prep on the dev box (which node → ~/.nvm/versions/node/v24.19.0), the owner runs npm run dreps (development.md, step 3).
2. An attacker on the network path to api.koios.rest holds one of the eight compromised eMudhra intermediate keys. They present a certificate for api.koios.rest that chains to G3, and Node's fetch accepts it.
3. Their forged drep_metadata answers give a well-known DRep a new name and give its old name to the attacker's DRep. The script writes them to src/dreps/mainnet.json; it keeps a committed name only for a DRep no pass names, so the rename gets through.
4. If the owner's diff skim misses the rename, 1.7.0 ships a list where searching that name finds only the attacker's DRep. drepSharing counts names on the bundled list and warns only when shared > 1 (Voting.tsx:444-448, 495), so it stays silent when the attacker's live metadata uses the same name.

The token refresh is narrower: the ticker must match (tokens.mjs:10), but decimals, name and logo come from the answer, and the owner reads that diff. The pools file is never a gate.

The attack needs an attacker on the network path, holding a compromised key, at the moment of the refresh. That's unlikely, but it's the advisory's exact threat, on the one Node path whose output ships.

*Evidence:* - node --help: "--use-bundled-ca  use bundled CA store (default)".
- On v24.19.0, tls.getCACertificates("default") contains the certificate with fingerprint256 86:A1:EC:BA:08:9C:4A:8D:3B:BE:27:34:C6:12:BA:34:1D:81:3E:04:3C:F9:E8:A8:62:CD:5C:57:A3:6B:BE:6B (emSign ECC Root CA - G3).
- With --use-system-ca the default store has 482 certificates (bundled 120 + system 362), and G3 is still trusted.
- nodejs/node src/node_root_certs.h: G3 present at v24.19.0 and v22.22.3; absent at v24.22.1, v24.22.2, v22.23.4 and v26.13.0.
- /etc/ssl/certs/ca-certificates.crt (ca-certificates 20260816ubuntu0.26.04.1) has no G3.
- scripts/tokens.mjs:24 `const KOIOS = { preprod: "https://preprod.koios.rest/api/v1", mainnet: "https://api.koios.rest/api/v1" };`, :30 `const response = await fetch(url, {`, and it writes at :103.
- scripts/dreps.mjs:50 `const response = await fetch(url, {`, :125 `writeFileSync(`${dir}${network}.json`, body);`.
- tests/lovejoin-pools-head-start.test.ts:63 `koios: () => new Koios(NETWORKS[network].koios),` leads to src/background/koios.ts:767 `(url, init) => fetch(url, init)`. vite.config.ts:145 sets `environment: "node"`.
- package.json:19-21 `"tokens": "node scripts/tokens.mjs"`, `"dreps": "node scripts/dreps.mjs"`, `"lovejoin-pools": "LOVEJOIN_POOLS_WRITE=1 vitest run ..."`.
- development.md:183-185 runs all three at release.
- src/ui/tokens.ts:13 `import mainnet from "../tokens/registry.mainnet.json";` and src/ui/dreps.ts:7 `import mainnet from "../dreps/mainnet.json";`.
- npm ci itself is safe: all 101 lockfile packages carry integrity.

*Fix:* No repo change. Before 1.7.0's refreshes, either:
- Put the release box on a Node whose built-in store dropped G3: v24.22.1 or later (`nvm install 24` gives v24.22.2), or v22.23.4 or v26.13.0, all checked at those tags.
- Or run the three refreshes with NODE_OPTIONS=--use-openssl-ca. Node then uses the OS store, which here has no G3; a real host still verified in that mode.

Not --use-system-ca: it adds the OS store to the bundled one, and G3 stays trusted (checked). Whether development.md's release steps should name a minimum Node is the owner's call.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/scripts/dreps.mjs:50`, `seedelf-platform/seedelf-web-wallet/extension/scripts/tokens.mjs:30`, `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-pools-head-start.test.ts:63`, `seedelf-platform/seedelf-web-wallet/extension/package.json:19`, `seedelf-platform/seedelf-web-wallet/docs/development.md:183`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **owner-call**. Test: none (release environment): on this box Node v24.19.0, NODE_OPTIONS unset, and the finding's one-liner reports G3 trusted by the default store

No repo change, as the finding says. The release prep's refreshes already ran on this Node; recommend re-running them with NODE_OPTIONS=--use-openssl-ca and confirming identical diffs.

## pr328#0

**nit** · security · confidence high · lane `docs-roadmap`

**The data layer's lock carries ctutils 0.4.3 (RUSTSEC-2026-0385) and tokio 1.53.2 (RUSTSEC-2026-0386), which Dependabot never raises**

*Claim:* The data layer serves the wallet. Its lock holds ctutils 0.4.3, under RUSTSEC-2026-0385 ('Non-constant-time mask generation and u128 comparisons', 2026-10-23, patched >= 0.4.4), and tokio 1.53.2, under RUSTSEC-2026-0386 (unsound AsyncFd constructors, patched >= 1.53.3). GitHub's global advisory database has no entry for either, so no Dependabot alert will ever appear. The ctutils compare is reachable, through Postgres SCRAM, but not exploitable. The tokio constructors have no caller. Not a blocker; a one-entry lock bump each clears them.

*Scenario:* Every new pooled connection from the API to home's Postgres logs in with scram-sha-256. postgres-protocol checks the server's signature through digest's Mac::verify_slice, whose constant-time compare is ctutils', and on 0.4.3 that compare may branch. Only the sender of the signature can time it: home's Postgres, or someone on the WireGuard path. The value compared, HMAC(ServerKey, AuthMessage) over the client's fresh nonce, changes on every connection, and a failed check closes the connection: one guess per value, nothing to accumulate, no key exposed. So there's no harm today. The cost is a RustSec report that isn't clean, for advisories no Dependabot alert will show. No crate in the data layer's graph, and nothing in api/src, calls the unsound AsyncFd constructors.

*Evidence:* - seedelf-data/Cargo.lock:275-276: `name = "ctutils"` / `version = "0.4.3"`.
- seedelf-data/Cargo.lock:1250-1251: `name = "tokio"` / `version = "1.53.2"`.
- cargo tree -i ctutils (seedelf-data): ctutils v0.4.3 ← digest v0.11.3 ← hmac v0.13.0 / md-5 / sha2 ← postgres-protocol v0.6.12 ← tokio-postgres v0.7.18 ← deadpool-postgres / seedelf-data-api.
- digest-0.11.3/src/mac.rs:144: `let choice = self.finalize_fixed().as_slice().ct_eq(tag);`
- postgres-protocol-0.6.12/src/authentication/sasl.rs:300: `hmac.verify_slice(&verifier)`
- pg_hba-seedelf.conf: `host <db-sync database> seedelf_reader <VPS wg0 address>/32 scram-sha-256`
- cargo deny check advisories (seedelf-data, RustSec cloned 2026-10-28): `error[vulnerability]: Non-constant-time mask generation and u128 comparisons … ctutils 0.4.3 … RUSTSEC-2026-0385` and `error[unsound]: AsyncFd::new and related constructors violate I/O safety … tokio 1.53.2 … RUSTSEC-2026-0386`.
- gh api "/advisories?ecosystem=rust&affects=ctutils" returns nothing.
- crates.io index: ctutils 0.4.4, 0.4.5 and 0.4.6 exist, with the same cmov ^0.5.3.
- tokio 1.53.3 exists; 1.54.0 is yanked (GHSA-5wjr-9356-4wc8).
- A grep for `AsyncFd::(new|with_interest|try_new|try_with_interest)` over the 175 registry crates (tokio excluded) and api/src finds nothing.

*Fix:* With the next data-layer change, through the deploy workflow: in seedelf-data, run `cargo update -p ctutils` (0.4.3 → 0.4.6; one entry, same cmov) and `cargo update -p tokio --precise 1.53.3` (or 1.54.1, never the yanked 1.54.0). No code change.

*Files:* `seedelf-data/Cargo.lock:275`, `seedelf-data/Cargo.lock:1250`, `seedelf-data/deploy/home/pg_hba-seedelf.conf:5`

*Verified:* verify partly (nit)

*Outcome (docs-roadmap):* **deferred**. Test: none: seedelf-data/ is off limits this pass

Recorded in Kept in mind with the cargo update lines for the data layer's next change.

## pr328#1

**nit** · docs · confidence high · lane `docs-roadmap`

**The roadmap's Step 0 record of what Dependabot doesn't raise is behind: rustls 'now 0.23.45', and no mention of crypto-bigint in the module**

*Claim:* Step 0 is the section that tracks advisories in the lock, including those Dependabot doesn't raise. It says the never-built rustls is 'now 0.23.45', and that only the CLI's h2 and spin stay open. After #328 the lock holds 0.23.46, and the four advisories it answers are recorded only as '(#328)' at line 35. RustSec now also flags crypto-bigint 0.5.5, which reaches the shipped module through uplc → k256 on wasm32 (RUSTSEC-2026-0387, patched only >= 0.7.6). It's harmless: k256 only verifies public signatures. It can't be fixed until uplc moves to k256 0.14. The data layer's two from N1 aren't recorded either.

*Scenario:* The next release's triage, or the owner, reads Step 0 to see where the advisories stand. It learns that rustls is at 0.23.45, that rand was 'the only flagged crate that reaches what users install', and that only the CLI's h2 and spin are open. It doesn't learn that the module now carries a RustSec-flagged crate, crypto-bigint 0.5.5 (unexploitable here, with no 0.5.x fix), or about the data layer's ctutils and tokio. It has to re-triage them from scratch, or misses them, because Dependabot will never alert on any of the three.

*Evidence:* - post-release-roadmap.md:93: "…GHSA-2mjx-qc3c-rqvc (RUSTSEC-2026-0285) on `rustls` 0.23.28, locked through the same never-built `reqwest` → `hyper-rustls` chain as `rustls-webpki` below, now 0.23.45. … What's still open is the CLI's `h2` and `spin` ([Kept in mind](#kept-in-mind)), which Dependabot doesn't raise."
- :89: rand, "The extension's WebAssembly — the only flagged crate that reaches what users install".
- Cargo.lock:2271: `version = "0.23.46"`.
- Cargo.lock:475-476: crypto-bigint 0.5.5.
- cargo tree -p seedelf-wasm --target wasm32-unknown-unknown -i crypto-bigint: crypto-bigint v0.5.5 ← elliptic-curve v0.13.8 ← ecdsa v0.16.9 / k256 v0.13.4 ← uplc v1.1.23 ← seedelf-core ← seedelf-wasm. It is in the wasm-release unit graph, and the module's strings include `crypto-bigint-0.5.5/src/uint/encoding.rs`.
- uplc-1.1.23/Cargo.toml:150-153: secp256k1 for non-wasm, k256 for `cfg(target_family="wasm")`.
- runtime.rs:1967 and 1980 use only `k256::ecdsa::{…PrehashVerifier}` and `k256::schnorr::{…PrehashVerifier}`.
- `git grep -E 'k256|secp256k1'` in seedelf-platform's own code finds nothing.
- gh api "/advisories?ecosystem=rust&affects=crypto-bigint" returns nothing.

*Fix:* One sentence in Step 0 after 'now 0.23.45', with no release date and no store status: "#328 took it to 0.23.46 for RUSTSEC-2026-0346 to -0349 (Dependabot #100–#103), still never built. RustSec, which Dependabot doesn't read, also flags `crypto-bigint` 0.5.5 in the WebAssembly (RUSTSEC-2026-0387, through uplc's `k256`, which only verifies public signatures; no 0.5 fix), and the data layer's `ctutils` and `tokio`."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:93`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:89`, `seedelf-platform/Cargo.lock:475`

*Verified:* verify partly (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): Cargo.lock, cargo tree -i crypto-bigint on wasm32, RustSec GETs

Step 0 says 0.23.46 since #328; Kept in mind records crypto-bigint, ctutils and tokio.

## pr329#0

**low** · docs · confidence high · lane `docs-roadmap`

**1.7.0's list still shows items 4–7 open, though #333, #335, #336 and #337 landed them**

*Claim:* On HEAD, item 4 is 🚧 with only its overflow half ticked, items 5, 6 and 7 are ⬜, and their five (1.7.0) *Kept in mind* entries still describe them as unbuilt candidates. Yet #333 (`b2c3940f`, the Bootstrap reserve priced from the parameters), #336 (`473b7f1a`, a listed pool confirmed from Koios, L included), #337 (`11e249d2`, *Bring the rest back now*) and #335 (`0bad0d52`, details for every part) all merged after #329. None of them touched `post-release-roadmap.md`. Item 2's 🚧 is right (finding 2), and items 3 and 8 are rightly ✅.

*Scenario:* The release-prep docs commit, or a later session choosing work from *Kept in mind*:
- reads "6. ⬜ An \"unmixed, now\" way out … The owner's calls first";
- reads :373, "it's a button and its words";
- builds a second way out beside #337's *Bring the rest back now*, or cuts 1.7.0 believing four items unbuilt.

Line :379 also still proposes "one `utxo_info` per newly listed pool", where #336 built `tx_info` plus `account_update_history`.

*Evidence:* - **The list:** `post-release-roadmap.md:38` `4. 🚧 **Two in core and WebAssembly:** the private Bootstrap's way back priced from the protocol parameters (`BOOTSTRAP_BACK_RESERVE`), … ✅ The overflow half: …`; :39 `5. ⬜ **A listed pool confirmed on chain, and L's registration checked…**`; :40 `6. ⬜ **An "unmixed, now" way out** … The owner's calls first: after how long it's offered, and its words.`; :41 `7. ⬜ **Transaction details for every part**`.
- **Kept in mind:** :373, :374, :378, :379 and :380 each still read `**… (1.7.0)**` with no ✅.
- **The four PRs:** `git diff --stat` of #333, #335, #336 and #337 lists no `post-release-roadmap.md`. #333's body: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit." #338's diff context still shows `5. ⬜`, `6. ⬜`, `7. ⬜` at its base (`11e249d2`).
- **The version:** `extension/package.json` `"version": "1.6.0"`.

*Fix:* In the release-prep docs commit:
- **Item 4 → ✅.** #333 added core's `bootstrap_back_reserve(params)`, with `BOOTSTRAP_BACK_RESERVE` now its 1.5 ₳ floor; the cap stays 96/64 at 6,465 lovelace a byte.
- **Item 5 → ✅.** #336 added `confirmed()`/`launched()` in `lovejoin-pools.ts`: a pool new to the device is kept once Koios's `tx_info` finds its launch, and `account_update_history` its L. The policy entry is dated 28 October 2026.
- **Item 6 → ✅.** #337 added *Bring the rest back now* after `TAIL_OFFER_MS` (an hour, the owner's), through `session-skip-collateral-mix`.
- **Item 7 → ✅.** #335 added the view's stepper, with `tx-view.ts` following `partHashes`.
- **Entries :373, :374 and :378–380:** strike each and prefix "✅ **1.7.0:**", as #330 and #332 did at :387–388.
- **Item 2:** keep 🚧 until the owner requires the check.
- **The version:** bump `package.json` to 1.7.0 when the version is cut.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:38`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:39`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:40`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:41`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:373`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:374`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:378`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:379`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:380`

*Verified:* trace confirmed (low); impact partly (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): as x-docs#0

Items 4-7 ✅; item 2 stays 🚧.

## pr329#1

**low** · ci · confidence high · lane `docs-roadmap`

**Item 2's remaining step, requiring the check, can't stop an early merge: every merge already bypasses main's protection**

*Claim:* Item 2 says: "a job that always reports …; then the owner turns the required check on in the branch's protection."

`main`'s classic protection requires one approving review and doesn't enforce admins. Every PR in the range (#323, and #329–#338) was merged by the owner with no review, so every merge used the admin bypass. That bypass also skips required status checks. Requiring *Web Wallet required* therefore wouldn't have held any of these merges.

In fact #329 to #337 each merged 9–53 minutes before its own Web Wallet run finished, and #338's run was still in progress 26 minutes after its merge. All finished runs passed. `web-wallet.yml` runs on `pull_request` only, so `main`'s merged tree is never tested.

*Scenario:* This is #323's case, which broke every private Bootstrap:
1. A PR whose Web Wallet run will fail is merged at once.
2. With item 2 ticked (the check required) but the one-review rule still forcing the admin bypass on every merge, the same bypass skips the required check.
3. `main` takes the failing change. No push-triggered run exists, so it looks green until a release review finds it.

*Evidence:* - **Protection** (`gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection`): `"required_status_checks":{…"contexts":[],…"checks":[]}`, `"required_approving_review_count":1`, `"enforce_admins":{…"enabled":false}`. No rulesets on `main`.
- **Merges:** #323 and #329–#338 all show `merged_by` logicalmechanism, reviews `[]`.
- **Run timings** (merged → Web Wallet run ended): #329 15:49:28 → 16:42:22; #330 16:22:22 → 16:58:35; #331 16:26:02 → 17:22:04; #332 16:25:43 → 17:23:50; #333 17:14:44 → 17:27:39; #335 17:14:00 → 18:03:01; #336 18:30:13 → 18:39:15; #337 18:30:28 → 19:14:40; #338 22:55:43 → still in_progress at 23:21:50Z.
- **The workflow:** `web-wallet.yml:9-10` `on:\n  pull_request:`.

*Fix:* The owner's, either of these:
- Set the required approvals to 0 (a sole maintainer can never approve their own PR, so the rule makes the bypass routine), require *Web Wallet required*, and turn on "Do not allow bypassing the above settings" (`enforce_admins`).
- Keep the bypass, but merge with `gh pr merge --auto`, which waits for required checks.

Then let item 2's text name what it actually takes.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:36`, `.github/workflows/web-wallet.yml:9`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-roadmap):* **partly**. Test: none (docs): the ci lane's live read of main's protection

Item 2 and a new (1.7.0) entry name what requiring takes (a rule the owner's merges can't pass by); the settings change is the owner's.

## pr329#2

**low** · docs · confidence high · lane `docs-roadmap`

**#324's call 7 (fx-may's call 1), recommended soon after 1.6.0, is on neither 1.7.0's list nor *Kept in mind***

*Claim:* 1.7.0's list is "what 1.6.0 left". #324's *Calls to look at* has seven calls, and six were carried:
- call 1 was decided;
- call 2 became item 6, call 4 item 4, call 6 item 2;
- call 3 was kept;
- call 5 is in *Left by chunk 34's sessions*.

Call 7 is in neither. It reads: "A review whose read of the 5 ₳ pool fails funds without the reserve (fx-may's call 1). *Recommended:* keep the reserve there, as Max does, soon after 1.6.0."

fx-may's own report asked for its calls to be added to the chunk 34 plan, but Session 12's *For the owner* (:966–974) never got this one. So #329's carry, made from the plan alone, missed it. fx-may calls the alternative "the more private default by the owner's rule". HEAD still funds without the reserve on a failed read.

*Scenario:* 1. Koios or the data layer fails the 5 ₳ pool's read while a private swap's review is built.
2. The swap is funded without the 1.5 ₳ reserve, though the private balance pays it.
3. At the return too little ADA alone is left for the collateral's mix.
4. The 5 ₳ comes back unmixed, with the rest, under the session's history.

The follow-up the gate recommended for soon after 1.6.0 is now tracked nowhere.

*Evidence:* - **#324's body, *Calls to look at*:** `7. **A review whose read of the 5 ₳ pool fails funds without the reserve** (fx-may's call 1). *Recommended:* keep the reserve there, as Max does, soon after 1.6.0.`
- **`git show 7e2d89ed:…/review-1.6.0/fixes/fx-may.md`:** `9. **OWNER-CALLS.md and the chunk 34 plan:** add the calls below.`, and later `To overturn: fund with the reserve on `may`. … It's the more private default by the owner's rule.`
- **`sessions.ts:4624`:** `if (pool === "failed") return (await lovejoin.collateralPoolTakes(network)) === "no" ? { reserve: 0n } : { reserve: 0n, may: true };`
- **The roadmap:** `grep -c fx-may post-release-roadmap.md` → 0.

*Fix:* Add it under *Left by 1.6.0's release review* as the owner's call, with #324's recommendation (fund with the reserve on `may`, as Max keeps it aside), or to 1.7.0's list if the owner wants it in this release. Whether to build it is the owner's call.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:33`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:966`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4624`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): sessions.ts tailReserve {reserve: 0n, may: true}, lovejoin.ts collateralPoolTakes in W

#324's call 7 carried under Left by 1.6.0's release review with #324's recommendation.

## pr329#3

**low** · docs · confidence high · lane `docs-roadmap`

**Archiving chunk 34's plan dropped open items its sessions left; *Kept in mind* doesn't carry them**

*Claim:* #329 says "Before the move, the plan's open items went into *Kept in mind*". Compared with the plan's text at the merge (byte-identical on HEAD), these appear nowhere in `post-release-roadmap.md`:
1. **Session 9's *Not fixed* (:1105):** a BadInputsUTxO from a lagging Koios at a waiting part's submit stops the rest, with no grace. Still so on HEAD.
2. **(:1106):** two windows pressing Send on the same review free each other's hold.
3. **(:1087):** the history-first refusal at about 2.5× (≈25 s); "narrowing history's own chain search is the owner's call".
4. **Session 11's *Left* (:1033):** `CollateralTail` repeats core's `Tail`. Still so.
5. **Fix round two's *Left open* (:1348):** below the floor, Mix again is refused with "Try again later" and a copy may never fill (still so). Also R2-1's aside, the hub's look racing the status read into a Koios scan on mainnet.
6. **The classic-only list (:1373):** its "on a swap's page, step 4's corrected words" is dropped from the carried bullet (:397).
7. **The owner's live db-sync tests (:654, :983; #324's *Before*):** nothing records them run (#325's record names only the deploy, the curls and the package).
8. **Session 5's open questions (:1255, :1259–1265):** L5's "Say so at review, or accept?", a stuck pool's hint, and a private-paid withdraw never signed live. These are reachable only through a pointer that calls them "calls Claude made … yours to overturn".

*Scenario:* `plans/README.md` says anything still open goes to *Kept in mind* before a plan is archived, so a later session takes that list as the whole open set. For example:
1. A lagging Koios backend answers BadInputsUTxO to part 2's submit seconds after part 1 landed.
2. `parts.ts` stops the rest as refused, and Home says "only partly sent".
3. The known gap is now listed nowhere live.

*Evidence:* - **Session 9's *Not fixed*:** plan :1105 `- A BadInputsUTxO from a lagging Koios node at a waiting part's submit still stops the rest, with no grace period.`; :1106 `- Two windows pressing Send on the same review at the same moment can still free each other's hold (older than this round).`
- **Session 11's *Left*:** :1033 `**Left:** WebAssembly's `CollateralTail` repeats core's `Tail`, for the builder extraction.`
- **Fix round two:** :1348 `… (and, aside, the hub's look can race the status read's `lovejoin/pools` call into a Koios scan on mainnet: pre-existing) … Left open: below the floor, Mix again is refused with "Try again later" in any pool, and a copy may never fill`.
- **The waiting part, on HEAD:** `parts.ts:470-471` `const behind = e instanceof CollateralError || (e instanceof KoiosBusyError && !e.maybeSent); if (behind && deps.now() - (seen ?? at) < GIVEME_BEHIND_MS) return;`, then :474 `stopWaiting(… "refused" …)`.
- **The duplication, on HEAD:** `wasm/src/lovejoin.rs:185` `pub(crate) struct CollateralTail { deposit, mix, leaf }` against `seedelf-core/src/lovejoin/mod.rs:2233` `pub struct Tail { deposit, mix, leaf }`.
- **The floor refusal, on HEAD:** `lovejoin.ts:3352` `… seedable ? POOL_BOOTSTRAP() : t("lj.tryLater")`.
- **The roadmap:** grep counts for "BadInputsUTxO", "Two windows", "chain search", "CollateralTail", "Try again later", "Koios scan", "step 4", "live db-sync" and "turned stuck" are all 0.

*Fix:* - Add each still-open item as a bullet under *Left by chunk 34's sessions*, or strike any the owner has settled.
- Name Session 5's as open questions rather than calls.
- Record the owner's live db-sync run as done, or carry it.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1105`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1106`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1087`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1033`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1348`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1373`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:654`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:983`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1255`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:391`

*Verified:* trace partly (low); impact confirmed (low)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): parts.ts step, lovejoin.ts floor, lovejoin-pools.ts refresh/look, wasm lovejoin.rs CollateralTail, Lovejoin.tsx reviewHint, ClaimAll.tsx in W

Items 1, 3, 4, 5a, 5b and 8 carried. Item 2 doesn't reproduce: each build replaces the kept review, and an older window's Send is a one-part stale refusal before splitParts holds anything. Item 6 was settled; item 7 recorded as unrecorded in 1.6.0's note.

## pr329#4

**low** · docs · confidence high · lane `docs-design`

**architecture.md:732 still says a listed pool's being finished is the server's word and its being on chain the ledger's to judge; #336 confirms both from Koios**

*Claim:* Since #336, a pool on the data layer's list that the device doesn't already hold is kept only once Koios's chain data confirms it, through `confirmed()` → `launched()`, the path the holder look shares. Koios must find the launch's `tx_info`, and L's registration by that launch or an earlier block.

`architecture.md`'s *Which pools are shown* still says two things that are no longer so:
- "that it's finished, and where its launch sits … are the server's word";
- "Whether a pool is on chain at all is the ledger's to judge, not the server's: … one a list names may never have been launched".

#336 updated `privacy.md` and the policy, not `architecture.md`. This touches 1.7.0's item 5 and its tick.

*Scenario:* A reader of the design doc believes a lying server can still hand over a never-launched pool, or one whose L isn't registered. They may also believe mainnet discovery from the data layer's list sends Koios nothing. Both are false since #336, and the second is a privacy fact the policy's 28 October entry now states.

*Evidence:* - **`architecture.md:732`:** `From the data layer's list, the wallet checks each pool is genuine and of a listed value, … that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below). Whether a pool is on chain at all is the ledger's to judge, not the server's: a pool verifies offline from any seed, so one a list names may never have been launched…`
- **#336's diff of `lovejoin-pools.ts`:** `await this.keep(network, await this.confirmed(network, found));` and `private async confirmed(...)`, documented as "a pool new to it only once Koios's chain data finds it as the holder's look would (launched)".
- **#336's diff stat:** `privacy.md`, `store/privacy-policy.md`, `lovejoin-pools.ts` and two tests; no `architecture.md`.

*Fix:* In the release-prep docs commit, say that a pool new to the device, from the data layer's list, is kept only once Koios confirms its launch and L's registration (`launched()`, shared with the holder look; 1.7.0). Being finished and being on chain are then checked, while which pool is earliest stays the server's word. Nothing checks L again after that (`usableNow`'s `registered: true`).

*Files:* `seedelf-platform/seedelf-web-wallet/docs/architecture.md:732`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:454`

*Verified:* trace confirmed (low); impact partly (low)

*Outcome (docs-design):* **fixed**. Test: docs-only: as x-docs#3

With its verifiers' corrections: launch place is now Koios's (pools lane pr336#0); ledger backstop sentence kept.

## pr329#5

**low** · docs · confidence high · lane `docs-design`

**development.md:13 and web-wallet.yml:135 say main's branch protection requires *Web Wallet required*; it requires no check**

*Claim:* Since #331, `development.md` and the workflow's comment state as fact that `main`'s protection requires the *Web Wallet required* job. The live protection lists no required check. 1.7.0's item 2 (:36) correctly says requiring it is still the owner's step.

*Scenario:* Whoever prepares the release reads `development.md`, takes item 2 as finished and ticks it ✅. Or a contributor relies on `main` refusing a PR whose check failed, which it doesn't (see finding 2).

*Evidence:* - **`development.md:13`:** `That job is the one `main`'s branch protection requires, so no path filter can leave a PR waiting on a check that never comes (1.7.0).`
- **`web-wallet.yml:135-136`:** `# The one check main requires (its branch protection names *Web Wallet\n  # required*; …`
- **The live protection** (`gh api …/branches/main/protection`): `"required_status_checks":{"strict":true,"contexts":[],…"checks":[]}`.

*Fix:* Say "is the one `main`'s branch protection is to require (1.7.0's item 2, the owner's step)" until the owner turns it on. Or have the owner turn it on before the release, so the words stand (with finding 2's caveat).

*Files:* `seedelf-platform/seedelf-web-wallet/docs/development.md:13`, `.github/workflows/web-wallet.yml:135`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **fixed**. Test: docs-only: as x-docs#4

Duplicate of x-docs#4; also added the ci lane's pr331#6 line (a PR editing web-wallet.yml decides its own green).

## pr329#6

**nit** · docs · confidence high · lane `docs-roadmap`

**The archived plan still says 'in progress' in places, and item 2 has no (1.7.0) entry the list's header promises**

*Claim:* The PR says the plan's status lines now say it's done. Its top status and 34g's row do, but other markers still read as live:
- the 34g heading (:910);
- "Start here (the next session)" and its *Next* paragraph (:914–918);
- Session 6's heading (:1153);
- the S0 and 34b rows still waiting on S0c's submit (:1487, :1491), though the rehearsal's first row says "S0c is settled".

Separately, the list's header says each item's detail is under *Kept in mind*, marked (1.7.0). Item 2 has no such entry; its detail is Session 12's call 6, now in the archive.

*Scenario:* A reader of the archived plan sees 34g in progress, and its *Next* list of the owner's steps. A reader of 1.7.0's list looks under *Kept in mind* for item 2's detail and finds none.

*Evidence:* - **:910:** `## 34g · The preprod rehearsal and the release (2026-10-18, in progress)`, while the steps row reads `([done](#34g--the-preprod-rehearsal-and-the-release-2026-10-18-in-progress))`.
- **:1153:** `#### Session 6: the owner's test by hand (2026-10-19, in progress; items 1–5 pushed)`.
- **:1487:** `**(c)** a preprod launch probe …: its evaluation ✅, the submit still to send`.
- **:1491:** `(cert 0; S0c's submit still to confirm it)`.
- **The rehearsal:** `S0c is settled: cert 0 registers mix_logic`.
- **The roadmap:** :33 `Each item's detail is under [Kept in mind](#kept-in-mind), marked **(1.7.0)**`, but `grep -F "(1.7.0)"` finds no entry for the required check.

*Fix:* - Rename the heading to "(2026-10-18)" and update its in-file anchors, or leave it, with the *Done* line explaining.
- Strike S0c's "still to send".
- Add a one-line (1.7.0) entry for item 2 pointing at `development.md#branching`.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:910`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:914`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1153`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1487`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1491`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:33`

*Verified:* verify confirmed (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs)

Heading and S0c rows fixed; item 2's (1.7.0) entry added.

## pr329#7

**nit** · docs · confidence high · lane `docs-roadmap`

**The archive's table of cited IDs has no row for chunk 34's own families, and their R3-n collide with 1.6.0's**

*Claim:* `archive/plans/README.md` lists every review whose IDs the code cites ("never renumbered"). Now that #329 has archived chunk 34's plan, its own families live there too, cited in code, but have no row:
- the rehearsal's R0–R12;
- 34g's review's MONEY, PRIV, DATA, UI and STATE ids;
- fix round two's MERGED-1–5, R2-1–4 and R3-1–3;
- the last review's WORKER, SCREENS, CROSS, PRIVACY and I18N-DOCS ids;
- calls 34–36.

Its R3-1–3 also share names with 1.6.0's R3-1–R3-31, which the table does list.

*Scenario:* A reader looking up "R3-1" in `lovejoin.ts` through the archive's table lands on 1.6.0's R3-1, which is a different finding from the one meant: chunk 34's fix round two's R3-1, a copy pool read at every pool read.

*Evidence:* - **`lovejoin.ts:2393`:** `(sortOut; fix round two's last review, R3-1)`, chunk 34's.
- **`SiteSessions.tsx:530`:** `Required, so no review can leave it out (R3-1).`, 1.6.0's (`CONFIRMED.md`'s R3-1 is in `DappApprovals.tsx`).
- **The archive README:** its table lists `review-1.6.0.md` with "the review of the fixes `R3-1`–`R3-31`", and no `chunk-34-token-pools.md` row.
- **Code citations:** `grep -E 'MERGED-[0-9]'` finds 50 in ts/tsx/rs files, and `\bR2-[0-9]` 27.

*Fix:* Add a row for `chunk-34-token-pools.md` naming its families and how to cite them ("chunk 34's fix round two, R3-1"), so they're never confused with 1.6.0's R3-n.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/archive/plans/README.md:13`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:2393`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:530`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:450`

*Verified:* verify confirmed (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): code citation grep

Row for chunk 34's families, with how to tell its R3-1..3 from 1.6.0's (bare ones of both exist in code).

## pr329#8

**owner-call** · docs · confidence low · lane `docs-roadmap`

**Item 8's Leios record no longer gives the mainnet hard fork's date, though it finds Dijkstra refuses every script transaction core builds**

*Claim:* #334's entry said Leios's "mainnet hard fork is targeted for late 2026". #338 replaced it with the run's findings, the first being that protocol version 12 refuses the wallet's script transactions as core builds them: list-form redeemers, and Shelley's cert 0 for a launch. Their fix is "a Pallas update, or patches in core, then a CLI release and a web wallet release, much later". The date that bounds how late "much later" may be is gone from the record. This is my suggestion, not a defect in the code.

*Scenario:* If Dijkstra reaches mainnet before that fix ships, every private spend, Lovejoin mix and pool launch the wallet builds is refused at submit, for every user. The record no longer shows when that could be.

*Evidence:* - **#338's diff:** removed `Musashi Dojo is the public testnet of Ouroboros Leios, which adds endorser blocks beside Praos's and whose mainnet hard fork is targeted for late 2026.`
- **`post-release-roadmap.md:406`:** `**Dijkstra refuses the wallet's script transactions as core builds them.** … The fix is a Pallas update, or patches in core, then a CLI release and a web wallet release, much later (the owner, 2026-10-28).`

*Fix:* The owner's call: keep the fork's expected date, or "not announced", beside "much later", so the release that must carry the fix is planned from it.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:405`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:406`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-roadmap):* **owner-call**. Test: none: owner's call

Recommend naming the trigger without a date: due before mainnet moves to protocol version 12.

## pr330#0

**low** · tests · confidence high · lane `traps`

**Nothing pins the restore scan handing its own trap on: #330's restore test mocks sessions.scan**

*Claim:* Site 1 (a restore's scan) is pinned only at the handler level. #330's test replaces `sessions.scan` with a mock that rejects with a trap. No test anywhere checks that the real scan hands a trap from its own WebAssembly calls (`hexOf`/`cip30Address` and `read`/`dexOrderAt` in `recoveredRecords`, `dexOrder` in `liveOrders`) on to its promise. That is the other half #330 relies on. Site 3 is pinned end to end by run-traps-review-fixes.test.ts:261 and :277; site 2 has no WebAssembly outside the queue.

*Scenario:* A later change makes `hexOf`, `read` or `liveOrders` in sessions.ts `return undefined` on any error, as such catches did before 1.6.0. Every test stays green. A real restore whose scan then traps in `cip30Address` or `dexOrderAt` leaves the wallet unlocked on the broken instance, which is the state #330 exists to close.

*Evidence:* handlers.test.ts:130 `vi.spyOn(ctx.sessions, "scan").mockImplementation((_, after) => { void after?.catch(() => undefined); return Promise.reject(fail()); })`. sessions.ts:2728-2733 `try { return dexOrderAt(wasm, network, hex, datum, address, form); } catch (e) { if (isTrap(e)) throw e; return undefined; }` (likewise `hexOf` at 2735-2742 and `liveOrders` at 3863-3866). Mutation M4, in a copy outside the tree, replaced the `if (isTrap(e)) throw e;` in `hexOf` and `read` with `void e;`. Result: restore-scan.test.ts and handlers.test.ts passed (63 tests), while my two scratch tests failed: A (the real scan rejects with a `RuntimeError`) and B (a restore whose real scan traps ends locked by trap). B also fails with only site 1's `unawaited` reverted (M3), so B pins #330 itself.

*Fix:* Add one end-to-end test.
- **In restore-scan.test.ts:** `signing(t, { wasm: { ...loadTestWasm(), cip30Address: () => { throw new WebAssembly.RuntimeError("unreachable"); } } as typeof wasm })`, with `usedWith(t, 0, [[SWAP_TX, …], [FUNDING_TX, …]])`, `swapped(t)` and `orderRow` as in "finds an order still open…". Expect `sessions.scan("preprod")` to reject with a `WebAssembly.RuntimeError`.
- **Through the handler:** `handle({ type: "restore-wallet", phrase, password }, ctx)` on a fresh `testBalances()`, with session 0's stake marked used. Then `vi.waitFor` the status `{ state: "locked", lockedBy: "trap" }`.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/tests/handlers.test.ts:128`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2727`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3863`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (traps):* **fixed**. Test: Tests only; no defect on HEAD. tests/restore-scan.test.ts, describe "a trap in the restore scan's own WebAssembly": it.each cip30Address/readDexOrder "hands on a trap in %s, reading what the session's swap paid, and writes nothing", and "locks the wallet when a restore's own scan traps there, the restore answered" (end to end through handle). tests/splash-remnant.test.ts: "is handed on, never read on from as no order: the scan fails, writing nothing" (liveOrders' read). All pass on HEAD. Mutations in a copy: M4a (hexOf) fails the cip30Address test and the end-to-end test; M4b (read) fails the readDexOrder test; M4c (liveOrders' read) fails the Splash test; M3 (unawaited reverted) fails the end-to-end test.

Pins all three catches the scan calls outside the wallet's queue, per the verifiers. The finding's own snippet pinned only hexOf and wouldn't typecheck (`as typeof wasm`). Its claim "as such catches did before 1.6.0" is wrong: these catches have rethrown since aef01f72/ce86c647.

## pr330#1

**low** · correctness · confidence high · lane `traps`

**tx-view's ownRegister swallows a trap inside the wallet's queue, so the wallet stays unlocked**

*Claim:* `ownRegister` runs inside `wallet.withKeys` (via `markYours`). Its bare `catch {}` returns `false` for any error, a trap from `keys.seedelf.isOwned` included, so `serial`'s guard (wallet.ts:577-590) never sees the trap and never locks. Lines 184-186 show the intent to hand a trap from `markYours` on, but this inner catch drops it first. This is pre-existing (8de4dc64, before 1.6.0), outside #330's three runs, and of the same class #330 and 1.6.0's L3 close: a trap dropped, leaving the wallet unlocked on a broken instance.

*Scenario:* The user opens Transaction details on a private payment's review, or a site's prompt shows its transaction, and `keys.seedelf.isOwned` traps. The details answer with the user's own change marked as someone else's. The wallet stays unlocked on the broken instance (`lockedBy` undefined) until another call traps. No trigger is known: `isOwned` runs only on points `decodeTx` already found payable.

*Evidence:* tx-view.ts:214-224: `function ownRegister(…) { const r = new wasm.Register(register.generator, register.publicValue); try { return keys.seedelf.isOwned(r); } catch { // Points that don't decode, … return false; } finally { r.free(); } }`. Called at tx-view.ts:247, inside `const active = await wallet.withKeys(async (keys) => {` (239). tx-view.ts:184-186: `await markYours(deps, network, detail).catch((e: unknown) => { if (isTrap(e)) throw e; });`. Scratch test in a copy outside the tree: build a transfer as tx-view.test.ts:113 does, spy `wasm.SeedelfKey.prototype.isOwned` to throw `new WebAssembly.RuntimeError("unreachable")`, call `txView`. On HEAD it answered with outputs `theirs,theirs`, state `unlocked`, `lockReason` undefined. With the fix it ended locked by trap, and tx-view.test.ts's 10 tests still passed.

*Fix:* In `ownRegister`, replace the bare catch:
```ts
} catch (e) {
  if (isTrap(e)) throw e;
  // Points that don't decode, or aren't in the prime-order subgroup, can't be anyone's to spend.
  return false;
}
```
`isTrap` is already imported in tx-view.ts. `serial` then locks (`lockedBy: "trap"`); line 184's catch takes the resulting `WalletLocked`, and the page follows the lock.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:214`, `seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:239`, `seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:184`

*Verified:* trace refuted (nit); impact refuted (nit)

*Outcome (traps):* **not-a-bug**. Test: None added to the tree. Two scratch tests outside it confirm the refutation: (1) a real out-of-bounds trap inside is_owned's body, through ownRegister's exact shape in wallet.withKeys, ends with the free's borrow error replacing `return false` and the wallet locked by trap; (2) a real stack overflow inside WebAssembly, at every depth tried, left ownRegister throwing an error isTrap counts, never returning false.

Refutation confirmed in source: wasm-bindgen 0.2.128's ref_from_abi raises the Rc count, and free (allow_delayed 0) runs try_unwrap, which throws "attempted to take ownership of Rust value while it was borrowed". The glue never schedules a reinit, so free's call guard is a no-op. Left as is. The explicit rethrow is an optional nit that changes nothing in the shipped build.

## pr331#0

**medium** · ci · confidence high · lane `ci`

**The required check #331 asks for is skipped by the owner's own merge path (admin bypass, enforce_admins off)**

*Claim:* The PR's goal ('Requiring the check on main stops that from happening again') needs a rule the owner's merges obey.

- main's classic protection requires 1 approving review with enforce_admins false.
- A self-authored PR can never meet that rule, so every merge in the range went through the admin bypass. GitHub: 'By default, the restrictions of a branch protection rule don't apply to people with admin permissions to the repository'.
- That bypass skips required status checks as well.
- The owner's step as written (Settings → Branches → main → Require status checks to pass) adds Web Wallet required to rules already bypassed on every merge, so it won't stop a merge mid-check.
- Strict mode (up to date) has had nothing to apply to, and PRs merged out of date: #331's head c5d19d3f lacks #332's merge 4610555a, and #337's head aa6f5fc2 lacks #336's merge 473b7f1a.

*Scenario:* 1. The owner requires Web Wallet required as instructed.
2. A 1.7.x fix PR opens, and its check runs for about an hour.
3. The merge box says 'Merging is blocked' (no approving review, required check pending). It offers the admin's bypass checkbox, which the owner ticks on every PR today.
4. Ticked, the PR merges at once. The check fails 40 minutes later.
5. main is red, and nothing runs on main to show it (development.md:15).

That is #323 again: a broken private Bootstrap that reached the release line.

*Evidence:* gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection: "required_status_checks":{"strict":true,"contexts":[],"checks":[]}, "required_approving_review_count":1, "enforce_admins":{"enabled":false}.

`gh api …/pulls/<n>/reviews` returns [] for #323, #324 and #330–#338, all merged_by logicalmechanism.

Merged vs the Web Wallet check finishing on the PR head (UTC, 2026-10-27/28):
- #326: 17:36:12 vs 18:10:20
- #328: 18:11:17 vs 18:47:05
- #329: 15:49:28 vs 16:42:21
- #330: 16:22:22 vs 16:58:35
- #331: 16:26:02 vs 17:21:57 (its own Web Wallet required reported at 17:22:03)
- #332: 16:25:43 vs 17:23:49
- #333: 17:14:44 vs 17:27:32
- #334: 17:13:35 vs 17:42:09
- #335: 17:14:00 vs 18:02:53
- #336: 18:30:13 vs 18:39:08
- #337: 18:30:28 vs 19:14:32
- #338: 22:55:43 vs 23:28:25

Only #325 waited (merged 17:36:00, check done 17:16:55).

The text this rests on:
- development.md:13: 'That job is the one `main`'s branch protection requires'.
- roadmap:36: 'left, the owner's: requiring it.'

*Fix:* Make the owner's step one their own merges can't skip, and word roadmap item 2 and development.md:13 to match. Either:

- (a) Settings → Branches → main: required approvals 0, tick 'Do not allow bypassing the above settings', and keep Web Wallet required and up to date. Optionally allow auto-merge, so 'Enable auto-merge' lands a PR the moment it's green.
- (b) Keep the classic rule, and add a branch ruleset on main that requires Web Wallet required with an empty bypass list.

Either way, the owner accepts the cost: with up to date enforced, each PR re-runs its ~1 h check after every other merge. That is also what makes main's tree tested as one.

If the owner keeps merging by bypass, the honest alternative is a run on main after each merge (push: branches: [main], with changes treating a push as platform=true). That is the owner's call.

*Files:* `.github/workflows/web-wallet.yml:135`, `seedelf-platform/seedelf-web-wallet/docs/development.md:13`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:36`

*Verified:* trace confirmed (low); impact confirmed (medium)

*Outcome (ci):* **owner-call**. Test: None: it's a GitHub setting. Reproduced live: 1 approval required, enforce_admins false; #325-#338 all had 0 reviews and were merged by the owner (an admin bypass each time); 12 of the 13 with a Web Wallet check merged before it finished. The owner's acceptance check: on the next PR that touches seedelf-platform/, the merge button is disabled with no bypass checkbox while the check runs.

The owner's exact steps are in owner_calls and in reports/ci.md (a ruleset with an empty bypass list is recommended). The workflow comment no longer says main requires the check.

## pr331#1

**low** · ci · confidence high · lane `ci`

**A rename out of seedelf-platform/ skips the check and turns Web Wallet required green**

*Claim:* changes reads only .filename, which for a rename is the new path, and ignores previous_filename (the old one). A PR that moves a file out of seedelf-platform/ gets platform=false, check skipped, and a green Web Wallet required, although it removed a file the check builds or reads. Renaming web-wallet.yml itself also gives platform=false.

*Scenario:* A PR moves the shared fixture seedelf-platform/seedelf-core/tests/fixtures/lovejoin-pool-vectors.json to a root fixtures/ folder, and updates seedelf-data's include_str!.

1. The API answers {filename: 'fixtures/lovejoin-pool-vectors.json', previous_filename: 'seedelf-platform/seedelf-core/tests/fixtures/lovejoin-pool-vectors.json', status: 'renamed'}, plus the seedelf-data file.
2. The grep finds no seedelf-platform/ line, so platform=false, check is skipped, and Web Wallet required is green. The data layer's check passes.
3. Merged, main's core vectors test and extension/tests/lovejoin-planner.test.ts:503, which readFileSync that path, fail.

*Evidence:* web-wallet.yml:27: `files=$(gh api --paginate "$FILES" --jq '.[].filename')`

web-wallet.yml:28: `if grep -q -E '^(seedelf-platform/|\.github/workflows/web-wallet\.yml$)' <<<"$files"`

PR #329's real API answer shows the shape: {"filename":"seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md","previous_filename":"seedelf-platform/seedelf-web-wallet/docs/plans/chunk-34-token-pools.md","status":"renamed"}.

The step run verbatim under bash -e, with a fake gh answering a rename out of the folder: platform=false. A deletion (status removed, filename = the old path) gives platform=true.

GitHub's docs are silent on how the old path filter treated renames, so this is not claimed as a regression. The repository's history has no rename out of seedelf-platform/ (git log --diff-filter=R), so the likelihood is low.

*Fix:* web-wallet.yml:27: `--jq '.[] | .filename, (.previous_filename // empty)'`.

*Files:* `.github/workflows/web-wallet.yml:27`, `.github/workflows/web-wallet.yml:28`, `seedelf-platform/seedelf-web-wallet/docs/development.md:13`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (ci):* **fixed**. Test: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/ci-lane/test_web_wallet_ci.py, group pr331#1: 'a move of the core vectors to fixtures/ ... runs the check', 'renaming the workflow itself runs the check', 'a rename out whose old path holds a tab', under bash -e and bash -eo pipefail. All six gave platform=false on HEAD's copy and give true now. Undoing the fix in a copy turns only this group red.

The changes step now reads previous_filename too: `.[] | [.filename, (.previous_filename // empty)] | @tsv`, split on the tab. Left as is: the grep still names web-wallet.yml literally. A PR that renames the workflow now runs the check, but it must also update that path.

## pr331#2

**low** · ci · confidence high · lane `ci`

**A base-branch change doesn't re-run the workflow, so a skip-green computed against the old base stands**

*Claim:* `on: pull_request:` with no types runs only on opened, synchronize and reopened. Changing a PR's base fires `edited`, so nothing re-runs.

The green Web Wallet required computed against the old base stays on the head commit, which is what branch protection reads. But the PR's file list, and so whether the check must run, depends on the base.

A re-run doesn't help either: it re-tests the original event's merge commit, since GITHUB_SHA doesn't change on a re-run.

*Scenario:* 1. web-wallet/b is cut from web-wallet/a, which carries a seedelf-platform/ change and was cut from main's head.
2. PR b→a adds only a root CLAUDE.md line. Its files are [CLAUDE.md], so check is skipped and Web Wallet required is green.
3. The owner retargets the PR to main. Its files now include a's seedelf-platform/ change, but no run happens.
4. b is already up to date with main, so even an enforced strict rule passes. a's change merges unchecked.

*Evidence:* web-wallet.yml:9-10: `on:` / `  pull_request:` with no types.

GitHub docs: 'By default, a workflow only runs when a pull_request event's activity type is opened, synchronize, or reopened'. A base change is the edited activity.

No PR since #266 has targeted anything but main (gh api pulls?state=all), hence the low likelihood.

*Fix:* Smallest: a line in development.md's Branching: 'after changing a PR's base, close and reopen it (or push) so its check runs against the new base.'

Or add edited to the types and let the whole workflow re-run on every edit. That is costly: each body edit re-runs the 1 h check.

Never gate `required` with an if that can skip it. GitHub says 'Required status checks must have a successful, skipped, or neutral status', so a skipped required check counts as passing.

*Files:* `.github/workflows/web-wallet.yml:9`, `seedelf-platform/seedelf-web-wallet/docs/development.md:13`

*Verified:* trace confirmed (low); impact partly (low)

*Outcome (ci):* **fixed**. Test: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/ci-lane/test_web_wallet_ci.py, group pr331#2: 'b into a (only CLAUDE.md against a) runs the check, so no skip-green survives a retarget to main', both shells. platform=false on HEAD, true now. Undoing the base rule turns only this group red.

Fixed in the workflow rather than only in a doc: a PR whose base isn't main always runs the check (BASE comes from github.event.pull_request.base.ref through env). So no skip-green computed against another base survives a retarget. Zero cost in practice: every PR since #266 targeted main. Left: the run that stands after a retarget was made on the merge into the old base. An optional development.md line covers that (in docs_notes).

## pr331#3

**low** · security · confidence high · lane `ci`

**check and the new required job run with a write-all GITHUB_TOKEN persisted in .git while check runs every dependency's scripts**

*Claim:* web-wallet.yml sets no top-level permissions, and the repository's default is write. So check, and since #331 required too, get a write-all token.

- actions/checkout@v4 persists the token in .git.
- check then runs every npm lifecycle script (npm ci), every crate's build script, and dtolnay/rust-toolchain@master, a moving ref.
- data-layer.yml drops both for exactly this reason.
- #331 scoped only `changes` down.

This predates the PR.

*Scenario:* A compromised dependency arrives through a lockfile-bump PR from a same-repo branch. Its install script reads the persisted token. With Statuses: write it posts a success named 'Web Wallet required' on the PR head, faking the gate; or it pushes to a branch, or edits PRs and issues.

*Evidence:* Job 122947931189 (check, run 40725597266) log: 'GITHUB_TOKEN Permissions: Actions: write … Checks: write … Contents: write … PullRequests: write … Statuses: write'. The required job (122981073437) shows the same.

`gh api repos/…/actions/permissions/workflow` returns {"default_workflow_permissions":"write"}.

web-wallet.yml:42: `- uses: actions/checkout@v4`, with no persist-credentials.

data-layer.yml:24-25: `permissions:` / `contents: read`. data-layer.yml:34-37: `persist-credentials: false`, under 'No token left in .git: the build runs every dependency's build script.'

*Fix:* - Add a top-level `permissions: { contents: read }` to web-wallet.yml. The changes job's own `pull-requests: read` still replaces it there.
- Add `with: persist-credentials: false` to check's checkout.

Nothing in check uses the token: rust-cache and setup-node's cache use the Actions runtime token.

*Files:* `.github/workflows/web-wallet.yml:9`, `.github/workflows/web-wallet.yml:42`, `.github/workflows/web-wallet.yml:85`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (ci):* **fixed**. Test: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/ci-lane/test_web_wallet_ci.py, group pr331#3: 'a read-only token at the top (contents: read)' and 'every checkout leaves no token in .git (persist-credentials: false)'. Both failed on HEAD and pass now. Each mutant turns only this group red.

Added a top-level `permissions: contents: read`, so check and required get read-only tokens; changes keeps its own pull-requests: read. Added `persist-credentials: false` on check's checkout, with data-layer.yml's comment. Nothing in check needs the token: no gh or networked git in build.sh, scripts or the npm scripts, and no git-sourced crates or npm packages. Pinning actions to SHAs is left with the owner (C56).

## pr331#4

**nit** · ci · confidence medium · lane `ci`

**A PR of over 3,000 files can skip the check silently (the API's cap; seedelf-platform/ sorts late)**

*Claim:* The PR files API returns at most 3,000 files, in path order. seedelf-platform/ sorts after .github/, the root files, seedelf-contracts/ and seedelf-data/. A PR past the cap whose seedelf-platform/ entries fall beyond the 3,000th gets platform=false, with nothing to say the list was cut.

*Scenario:* A PR vendors seedelf-data's crates (cargo vendor into seedelf-data/vendor/, thousands of files) and changes one line in seedelf-core. The first 3,000 entries are all vendor files, so the check is skipped and Web Wallet required is green.

*Evidence:* GitHub REST docs, List pull requests files: 'Responses include a maximum of 3000 files'.

PR #329's answer came back in path order.

git ls-files: 137 tracked files sort before seedelf-platform/.

The old path filter had the same 3,000 limit (workflow syntax docs), so this is not a regression.

*Fix:* Fail safe: pass github.event.pull_request.changed_files as CHANGED, and set platform=true when `wc -l <<<"$files"` is less than CHANGED. Adding `?per_page=100` also cuts a 3,000-file lookup from 100 calls to 30.

*Files:* `.github/workflows/web-wallet.yml:27`

*Verified:* verify confirmed (nit)

*Outcome (ci):* **fixed**. Test: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/ci-lane/test_web_wallet_ci.py, group pr331#4: '3,001 files, the seedelf-core line past the API's 3,000', 'the same with 3,000 renames listed (rows counted, not paths)', 'asks for 100 files a page'. All failed on HEAD and pass now. Undoing the count rule, counting paths instead of rows, or dropping per_page each turns only this group red.

The step now sets platform=true when the API listed fewer rows than the event's changed_files. It counts rows, not paths. It also asks for ?per_page=100, so 3,000 files take 30 calls, not 100. On real PRs the row count equals changed_files, a rename counting once (#329: 6=6; #324: 155=155 over 2 pages), so it doesn't fire on ordinary PRs. With changed_files empty, it falls back to the path test without failing the step.

## pr331#5

**nit** · docs · confidence high · lane `docs-design`

**development.md and the workflow comment say main's protection requires the job; it requires nothing yet**

*Claim:* Both texts state as fact what is the owner's still-pending step (roadmap:36).

- development.md:13: 'That job is the one `main`'s branch protection requires'.
- web-wallet.yml:135-136: 'The one check main requires (its branch protection names *Web Wallet required*…)'.

*Scenario:* A session reading Branching before the owner's step trusts that a green main is a checked main, or that a PR can't merge mid-check. Today neither is true.

*Evidence:* Branch protection: required_status_checks.contexts [] and checks []. roadmap:36: 'left, the owner's: requiring it.'

*Fix:* Until the owner's step is done, say the job is the one main's protection 'is to require (roadmap item 2)'. Word it together with F1's fix.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/development.md:13`, `.github/workflows/web-wallet.yml:135`

*Verified:* verify confirmed (nit)

*Outcome (ci):* **partly**. Test: None: it's a comment. Checked live instead: main's protection has contexts [] and checks [], enforcement_level non_admins, and no rulesets or rules.

Fixed the workflow comment: 'The one check for main's branch protection to require ... Requiring it is the owner's step in GitHub's settings (1.7.0's item 2).' Left: development.md:13 belongs to docs-design, which has the same finding id (and x-docs#4, pr329#5). Suggested matching words are in docs_notes.

*Outcome (docs-design):* **fixed**. Test: docs-only: as x-docs#4

Duplicate of x-docs#4; the workflow half was the ci lane's.

## pr331#6

**nit** · ci · confidence high · lane `ci`

**A PR that edits web-wallet.yml decides its own Web Wallet required**

*Claim:* A pull_request run uses the workflow from the PR's own merge commit. A PR, including a fork's, can rewrite `required` (say `exit 0`), and its required check goes green whatever check says. This is inherent to pull_request-based checks. The owner merges by hand, so it is a reading rule, not a code fix.

*Scenario:* A fork PR changes seedelf-core and sets required's script to `exit 0`. check fails, but Web Wallet required is green. Under an enforced rule (F1), the PR is mergeable.

*Evidence:* web-wallet.yml:140-155: the whole decision is the PR-controlled script `if [ "$CHANGES" != success ]; then exit 1; fi …`.

The grep at :28 makes check run on such a PR, but required's verdict is the PR's own.

*Fix:* A line in development.md's Branching: 'a PR that touches .github/workflows/ decides its own required check: read that diff before trusting it.'

*Files:* `.github/workflows/web-wallet.yml:140`

*Verified:* verify partly (nit)

*Outcome (ci):* **deferred**. Test: None: this is inherent to pull_request-triggered workflows. A PR runs its own copy of the workflow, so no change to the file can bind it.

The fix is a reading rule in development.md's Branching, which is the docs lane's file. The exact sentence is in docs_notes.

## pr331#7

**owner-call** · ci · confidence high · lane `ci`

**data-layer.yml keeps the never-reporting shape #331 removed, and its job name now collides with web-wallet's skipped check**

*Claim:* data-layer.yml still has a workflow-level paths filter.

- If its check is ever required, every PR outside its paths waits for good: 'checks associated with that workflow will remain in a Pending state'. Nothing is required today, so it's harmless now.
- Since #331, web-wallet.yml's `check` (no name:) reports skipped on every PR that doesn't touch seedelf-platform/, every data-layer-only PR included. A skipped required check counts as passing, so a required bare 'check' would be ambiguous.

*Scenario:* To keep main deployable, the owner requires 'check'.

- A wallet-only PR waits for ever on the data layer's check, which never runs.
- A data-layer-only PR carries two runs named check: the data layer's (red) and the wallet's (skipped, which counts as passing).

*Evidence:* data-layer.yml:5-22: `on: pull_request: paths: - "seedelf-data/**" …`. data-layer.yml:28: `check:`. web-wallet.yml:34: `check:` with `if: needs.changes.outputs.platform == 'true'`.

GitHub: required checks pass on 'successful, skipped, or neutral'.

The PR's own description gives this name clash as the reason for the new job's name.

*Fix:* If the owner ever wants the data layer gated:
- give data-layer.yml the same three-job shape, with its own name (Data layer required);
- give web-wallet's check a distinct `name:`.

*Files:* `.github/workflows/data-layer.yml:5`, `.github/workflows/data-layer.yml:28`, `.github/workflows/web-wallet.yml:34`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (ci):* **owner-call**. Test: None: not built. It was UNVERIFIED, so I reproduced it. data-layer.yml:5-22 has a workflow-level paths filter, so it never reports outside its paths. #324's head carries two check runs both named "check" (Data layer and Web Wallet). Since #331, web-wallet's check reports skipped on every PR outside seedelf-platform/.

data-layer.yml is untouched, and web-wallet's check gets no name: either, since that's part of this owner's call. The owner's step: require only 'Web Wallet required', never a bare 'check'. Gating the data layer would first need its three-job shape with its own name, plus a name: on web-wallet's check.

## pr332#0

**low** · docs · confidence high · lane `rust`

**The overflow-check line isn't the crate line the docs draw: core leaf and generic code called from seedelf-wasm still wraps, and some seedelf-wasm sums now trap**

*Claim:* On rustc 1.98.1 with wasm-release (opt-level z, fat LTO), an overflow assert survives only where the codegenning crate has checks on. A small call-free core function is codegen'd in seedelf-wasm without checks, because rustc's automatic cross-crate inlining hands it to the caller. So is any generic core function instantiated with seedelf-wasm's types or closures. The reverse also holds: seedelf-wasm's own `.iter().sum()` over an iterator type core already sums links to core's checked instance (shared generics) and traps. The PR's comments, CLAUDE.md, the roadmap and `MORE_THAN_THERE_IS` all state a crate-wide line.

*Scenario:* There's no live case today. The leaf core helpers seedelf-wasm calls (`Locked::total`, `slot_at`, `mix_fee_estimate`; `linear_fee` saturates) see only bounded values, and seedelf-wasm's plain sums go through its own closures or add usize counts. The hazard is the next change made by the documented rule. A developer adds a small helper in core on a pool datum value (say `p.denom * n`), leaves out `checked_mul` because CLAUDE.md says core traps, and calls it from seedelf-wasm. The store's module then wraps it to a small, false figure while every test build panics: 314-core#1 / x-release#7 again. Conversely, a seedelf-wasm sum the comments say wraps can trap and lock the wallet.

*Evidence:* I built HEAD's crates in a scratch copy with `cargo build --locked --target wasm32-unknown-unknown --profile wasm-release` and called probe exports from node. `seedelf_core::lovejoin::Locked{reference:u64::MAX,mix_box:1,..}.total()` (launch.rs:90-92 `self.reference + self.mix_box + self.mix_logic + self.deposit`, called from seedelf-wasm at lib.rs:2627 and 2713) RETURNED 0. Core's `total_computation_fee(&params, vec![(u64::MAX,u64::MAX);20])` threw RuntimeError: unreachable. seedelf-wasm's own `vec![u64::MAX,1].iter().sum::<u64>()` threw RuntimeError: unreachable; core makes the same `Sum<&u64>` instance, e.g. build.rs:1067 `lovelace: paid.iter().sum()`. seedelf-wasm's own `u64::MAX + 1` returned 0. In a two-crate wasm32 reproduction with the same profile, a plain leaf, an inline fn, a generic fn, an `impl Fn` fn and a leaf method all wrapped; functions holding a call (`sum`, `pow`, `div_ceil`, a helper) and an `#[inline(never)]` fn trapped. The docs: Cargo.toml:44 "Core, crypto and koios check integer overflow in the module"; CLAUDE.md:94 "Its per-package overrides check integer overflow in `seedelf-core`, `-crypto` and `-koios` (a trap that locks the wallet, not a wrapped sum), but not in `seedelf-wasm`"; mod.rs:1758-1760 "Since 1.7.0 the module checks core's … so one missed would trap and lock the wallet".

*Fix:* Correct the four statements (`Cargo.toml` comment, CLAUDE.md:94, roadmap:387, the `MORE_THAN_THERE_IS` doc) to the real rule. Core's arithmetic is checked where core's own code compiles it. A small call-free core function, or a generic one, that seedelf-wasm calls is compiled there and wraps. A sum seedelf-wasm makes over an iterator type core also sums may be checked. Keep the rule that holds both ways: values from outside the wallet are summed with `checked_*` in every crate. Optionally mention the overrides beside the profile's descriptions in architecture.md:99 and wasm/README.md:115.

*Files:* `seedelf-platform/Cargo.toml:44`, `seedelf-platform/CLAUDE.md:94`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:387`, `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1758`, `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:90`, `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:2627`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (rust):* **fixed**. Test: Docs and comments only; checked against both pr332#0 verifiers. wasm_profile_test.rs pins the overrides themselves.

The rule as the code has it: a check goes with the crate that compiles the code. A small call-free or generic core function compiled into seedelf-wasm wraps, and a seedelf-wasm sum can link core's checked copy, so no crate leans on the checks: outside values use checked_* and are refused in words. Roadmap:38 (the verifier's addition) and :387, and the MORE_THAN_THERE_IS doc, are updated too. 'LTO' was left as the profile's setting; per the trace verifier Cargo doesn't apply it to seedelf-wasm (not verified by me).

## pr332#1

**low** · tests · confidence high · lane `rust`

**Nothing fails if the wasm-release overflow overrides are removed**

*Claim:* The PR's behaviour has no test. Its probe was built and removed, and every existing test passes with or without the three `[profile.wasm-release.package.*]` sections. The Rust tests run in debug, checked either way, and the WebAssembly node tests and Vitest passed on the unchecked module before the PR.

*Scenario:* A tidy-up of Cargo.toml, or a toolchain bump that moves more of core into seedelf-wasm's codegen (F1), drops the checks. CI stays green, and the store's module wraps core's sums again.

*Evidence:* HEAD's crates built in scratch with the three sections removed contain 0 occurrences of "attempt to add with overflow", "attempt to subtract with overflow" and "attempt to multiply with overflow". The tree's HEAD module `wasm/pkg/seedelf_wasm_bg.wasm` has 1 of each (`grep -aoc`). Only overflow-checked code references those panic messages.

*Fix:* At the end of `wasm/build.sh`, beside its local-path check, add: `grep -aq "attempt to add with overflow" "$wasm" || { echo "The module carries no overflow check: Cargo.toml's wasm-release overrides are gone" >&2; exit 1; }`. It's crude: it says some code is checked, not which.

*Files:* `seedelf-platform/Cargo.toml:51`, `seedelf-platform/seedelf-web-wallet/wasm/build.sh:67`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (rust):* **fixed**. Test: seedelf-core/tests/wasm_profile_test.rs the_store_module_checks_overflow_in_core_crypto_and_koios: fails on a scratch manifest with only core's section removed (left: ["seedelf-core"]) and with all three removed; passes on the tree's. the_settings_are_read_in_each_form_cargo_takes covers the reader's TOML forms (every fixture valid per tomllib).

Reads Cargo.toml (package setting, else the profile's) and checks that build.sh builds with --profile wasm-release and binds that module. No new dependency. It reads settings, not codegen, so the codegen-boundary drift isn't caught. Optional: build.sh could check cargo's JSON artifact messages (overflow_checks per package); I didn't edit build.sh because I can't run it.

## pr333#0

**low** · money · confidence high · lane `bootstrap`

**The Bootstrap form's balance check still adds a fixed 2 ₳ FEE_ROOM, so it doesn't match the funding at a dearer byte, and the PR's test asserts the mismatched case**

*Claim:* The PR says the form's figure 'matches what the funding takes, at any price', but only the reserves follow the price: costs = boxes × box + (1.5 ₳ + back) + FEE_ROOM. FEE_ROOM is a fixed 2 ₳ for the funding's fee (about 0.23 ₳) and its change's Seedelf least (1.457 ₳ at 4,310; 2.185 ₳ at 6,465). From about 5,200 lovelace a byte up, the form calls a balance enough that the funding refuses. The PR's own test (line 506) asserts one such balance is enough.

*Scenario:* An empty wallet holds one private UTxO of exactly 305.3 ₳; the byte costs 6,465 lovelace; the user asks to Bootstrap 30 classic boxes. The form gets back = 1.8 ₳ and says not short. Pressing Bootstrap reaches Review, and the worker refuses: 'Not enough ADA in your private balance for this, its fee and the change.' 305.7 ₳ is refused too; 306.0 ₳ funds. No money moves, but this is the form-passes, Review-refuses gap MONEY-6 closed, back at a dearer byte.

*Evidence:* Lovejoin.tsx:3662-3663 `const reserves = DEPOSIT_RESERVE + (back === undefined ? BOOTSTRAP_BACK_LEAST : BigInt(back)); const costs = BigInt(putting) * BigInt(pool.box.lovelace) + reserves + FEE_ROOM;`. Lovejoin.tsx:207-211: FEE_ROOM is 'a Seedelf output's, 1.46 ₳ at today's 4,310 lovelace a byte, with room for a dearer byte', `const FEE_ROOM = 2_000_000n;`. lovejoin-release-rules.test.ts:506 `expect(bootstrapLimits(box, "private", ada(needs + 300_000n), 96, 30, dear).short).toBe(false);` (needs = 305 ₳). Scratch Vitest at 6,465 with owned:false: 305,300,000 refused ('Not enough ADA in your private balance for this, its fee and the change.'), 305,700,000 refused, 306,000,000 funded (fee 230,260, change 2,469,740, changeMinimum 2,185,170). At 4,310, 305,000,000 funded (change 1,769,740 against 1,456,780).

*Fix:* Have privateBootstrapBounds also return the funding's change least under the same parameters, and use it (plus a fee allowance) in FEE_ROOM's place once known. The WebAssembly already computes it as the funding summary's changeMinimum; a small export over minimum_seedelf_payment would do too. Fix line 506: 305.3 ₳ is short at 6,465 and 306 ₳ isn't. If the owner keeps the fixed room, the minimal fix is to correct the test and the PR's claim to 'at today's price'. The Mix stepper shares FEE_ROOM, but that's older and outside this PR.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3663`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:211`, `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-release-rules.test.ts:506`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (bootstrap):* **partly**. Test: None committed: wording only. Reproduced in a scratch Vitest in an outside copy, 30 classic boxes from one private UTxO. At 6,465 lovelace a byte, 305.3 and 305.7 ₳ show 'not short' on the form and the funding refuses them ('Not enough ADA in your private balance for this, its fee and the change.'); 306 ₳ funds. At 4,310 the form and the funding agree. Also at 4,310, 305 ₳ spread over 8 or more UTxOs is refused while the form passes it (1 to 7 UTxOs fund). That gap predates #333.

Fixed the false claims. privateBootstrapBounds' JSDoc no longer says the form matches the funding 'at any price of a byte': it counts the priced back, and its room for fee and change is the form's fixed FEE_ROOM. FEE_ROOM's comment no longer says 'room for a dearer byte': it can fall short from about 5,200 lovelace a byte, or when the funding spends many UTxOs. The test at line 506 is kept, with a comment saying what it pins. Pricing the room needs a new WebAssembly export and the lead's rebuild, and until then it would break typecheck and Vitest for every lane. The fee allowance is a product choice, so that part is an owner's call.

## pr333#1

**low** · tests · confidence high · lane `bootstrap`

**Nothing tests that the pool page passes the worker's `back` to bootstrapLimits; dropping it survives all 471 related tests**

*Claim:* The PR's 'If the form ignores back, the test fails' is true only of the pure helper. The screen tests render static markup, where the effect that sets privateBack never runs, and e2e runs at today's price, where back equals the 1.5 ₳ stand-in. So the page's wiring of the worker's figure has no test.

*Scenario:* A later edit drops privateBack from the bootstrapLimits call, or stops setting it from the 'lovejoin-bootstrap-most' answer. At a dearer byte the form under-counts by back − 1.5 ₳ again, the MONEY-6 gap the PR closed, and no test fails.

*Evidence:* A mutation in a copy outside the tree changed Lovejoin.tsx:3115 to `bootstrapLimits(pool, source, seedelf, privateMost, bootstrapBoxes)`. All 24 test files that render the pool page or reach bootstrapLimits still passed: 'Test Files 24 passed (24), Tests 471 passed (471)', including lovejoin-release-rules, lovejoin-session5-screens and screens. By contrast, mixFunding back on a fixed 1.5 ₳ failed with `expected '1500000' to be '1800000'`, and privateBootstrapBounds answering a fixed back failed with `expected { most: 96, back: '1500000' } to deeply equal { most: 96, back: '1800000' }`.

*Fix:* Add a screen test that runs effects (a client render) with the 'lovejoin-bootstrap-most' call answering { most: 96, back: '1800000' }. Give the private balance enough for the fixed 3 ₳ figure but not the 3.3 ₳ one, and assert lovejoin-bootstrap-why shows.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3115`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2683`

*Verified:* trace partly (low); impact confirmed (low)

*Outcome (bootstrap):* **fixed**. Test: extension/tests/screens-wiring-review-fixes.test.ts › 'holds the Bootstrap form from the private balance to the way back's reserve the worker priced, never the 1.5 ₳ that stands in (1.7.0's release review, pr333#1)'. In the outside copy, with the effect no longer storing back: tsc is clean and this is the only failure among 155 tests in the 7 files that reach the bounds. With line 3115 no longer passing back: tsc gives TS6133 and this test fails too. Passes on HEAD.

Uses the house vi.mock("react") seam, which runs PoolPage's effects. The pool is below its floor, so the form leads at 27 boxes, with 275 ₳ private. When lovejoin-bootstrap-most answers back 1500000, the form is enabled with no why. When it answers 1800000, lovejoin-bootstrap-why shows and Bootstrap is disabled. Another lane is editing the same file; only my it() block is mine.

## pr333#2

**low** · docs · confidence high · lane `docs-design`

**flows.md and architecture.md still say a dearer byte lowers the private Bootstrap's cap**

*Claim:* flows.md's Bootstrap bullet, which this PR edited, still gives the cap at 6,465 as 68 classic boxes; since #333 it's 96. The same bullet states the way back as a flat 1.5 ₳ ('1.5 ₳ for returning the rest', and the review row '(1.5 ₳, and what it doesn't use comes back)'), which is now today's figure only: 1.8 ₳ at 6,465. architecture.md:672 contradicts itself: 'fewer at a dearer byte', then 'so a dearer byte doesn't lower the cap'.

*Scenario:* A reader of flows.md expects a cap of 68 at 6,465 and a 1.5 ₳ way back. The wallet offers 96 and funds 1.8 ₳, which no doc line says.

*Evidence:* flows.md:523 'the wallet measures how many by building both, one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)' and 'one *For returning the rest* (1.5 ₳, and what it doesn't use comes back)'. architecture.md:672 'which builds both for each count: one deposit's most under today's parameters, fewer at a dearer byte)' … 'so a dearer byte doesn't lower the cap (1.8 ₳ at 6,465 lovelace a byte, where a fixed 1.5 ₳ held it to 68 classic boxes; 1.7.0)'. Scratch: the cap at 6,465 is 96 classic.

*Fix:* flows.md: say one deposit's most at a dearer byte too, and that the way back's reserve is priced from the parameters (1.5 ₳ today, 1.8 ₳ at 6,465); drop the '68'. architecture.md: drop 'fewer at a dearer byte'.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/flows.md:523`, `seedelf-platform/seedelf-web-wallet/docs/architecture.md:672`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **fixed**. Test: docs-only: core build.rs MAX_FEE 10 ₳; the bootstrap lane's new core test pins 51 at min_fee_b 2 ₳

Duplicate of x-docs#1's flows/architecture halves.

## pr333#3

**owner-call** · money · confidence medium · lane `bootstrap`

**A marked Bootstrap whose chain is built after the byte got dearer comes back directly with no box in and a second fee; the one-box-fewer rule covers only unmarked records**

*Claim:* This is my idea, not a defect of #333; it was true before it too. The reserve is priced at the review, but the chain is built when the funding lands, or after the next unlock if the wallet locked first. Once priced above the floor, the reserve leaves only 0.1 to 0.2 ₳ over at the cap (0.115 ₳ at 6,465, 0.097 ₳ at 8,000; 0.54 ₳ at today's floor). A parameter rise in between fails the sweep. The session then comes back directly: no box in, a second fee, and core's raw 'of these tokens' message for an output with none. The legacy rule (one box fewer, its ADA paying the way back) would carry it in, but it runs only for unmarked records.

*Scenario:* 96 classic boxes are funded at 4,310 (1.5 ₳ back, marked noCollateral as 1.6.0 and 1.7.0 both mark them), and the wallet locks before the funding lands. The byte goes to 6,465 at an epoch boundary. At the next unlock the chain fails and the whole 963 ₳ is swept back, less a fee, with no box in.

*Evidence:* Scratch Vitest B2 (marked, nothing else at the account): record.txs ['out','back'], mix.skipped 'the wallet couldn't build its chain: a Seedelf deposit of these tokens needs at least 2.185170 ADA', the chain asked with { collateral: 'none', boxes: 96 }, one transaction sent, 963000000 in and 962829439 swept back. The same record unmarked (C) went in with 95 boxes: ['out','deposit','back']. sessions.ts:4451 `if (boxes && record?.mix?.bootstrap && !record.mix.noCollateral && !collateral) {`.

*Fix:* For the owner to decide: apply the same 'one box fewer, that box's ADA paying the way back' to a marked Bootstrap whose paid funding is short of lovejoin.funding(boxes) + lovejoinBootstrapReserve(params) under the chain's parameters; or keep the direct return, but say why in the wallet's own words rather than core's.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4451`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4479`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (bootstrap):* **owner-call**. Test: None: not built, it's an owner's call. Code path confirmed by reading: the one-box-fewer branch at sessions.ts:4451 skips records with mix.noCollateral. The chain does fail at 96 boxes funded on 1.5 ₳ at 6,465 (x-mut-rs#4's reproduction), and leftOut wraps core's raw 'of these tokens' message.

Recommended: extend the one-box-fewer rule to marked Bootstraps whose paid funding is short under the chain's parameters, and word the direct return's reason in the wallet's words.

## pr333#4

**nit** · tests · confidence high · lane `bootstrap`

**Core's dear-byte token-pool assertions use LJTEST's 2 ₳ pool, which the ledger's minimum refuses at 6,465**

*Claim:* `bootstrap_most(&dear, &lj, true, 64) == 64` and `bootstraps(&dear, &lj, true, 64).is_some()` assert a cap and a built deposit for a pool whose boxes are below the ledger's minimum at that price. The worker refuses that pool (belowMinimum), and the ledger would refuse the deposit. Core's doc ('and 51 of LJTEST') and the PR's table ('was 68 / 51') cite the same impossible figure. The arithmetic still holds: the same token pool with 4.5 ₳ boxes gives 64 at 6,465, and its chain builds.

*Scenario:* A reader takes '64 of LJTEST at 6,465' as reachable. In fact LJTEST's pool takes no new box at that price.

*Evidence:* Scratch Rust: `lovejoin::usable` at 6,465 for LJTEST's 2 ₳ box gives Err('A box holds 2000000 lovelace, under the 2320935 the ledger asks of it now'); the 4.5 ₳ box is usable, and its real chain at the cap of 64 builds with 0.187 ₳ over. The PR's TS test comment says the same of its fixture: 'this fixture's token box is below the network's least at that price, so it takes no new box at all'.

*Fix:* In the dear case, use `Protocol { denom: 4_500_000, ..lj_pool() }` or another pool `usable` accepts. In mod.rs:1742 and the docs, say LJTEST takes no new box at 6,465 rather than '51 of LJTEST'.

*Files:* `seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs:1813`, `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1742`

*Verified:* verify confirmed (nit)

*Outcome (bootstrap):* **fixed**. Test: seedelf-core/tests/lovejoin_pools_test.rs › a_private_bootstrap_is_held_…: now asserts usable(&dear, &lj) is BelowMinimum (LJTEST's 2 ₳ box is under the 2,320,935 least at 6,465). The dear token case now runs on Protocol { denom: 4_500_000, ..lj_pool() }, which is usable there: a fixed 1.5 ₳ can't pay its 64, the cap is 64, and 64 builds. Passes on HEAD.

bootstrap_back_reserve's doc and the test comment now say '51 in a token pool', and that LJTEST's own pool takes no new box at 6,465. The TS comment's pointer to core's token case now holds.

## pr333#5

**nit** · ux · confidence high · lane `bootstrap`

**The form counts 1.5 ₳ for the way back until the worker answers, and whenever the bounds request fails**

*Claim:* Before 'lovejoin-bootstrap-most' answers, or after it fails (Koios or the data layer down), back is undefined and the form uses BOOTSTRAP_BACK_LEAST (1.5 ₳). At a dearer byte it's briefly optimistic.

*Scenario:* At 6,465 the user opens the form and presses Bootstrap before the bounds arrive (the first bisection of an epoch), with a balance between the 3 ₳ figure and the 3.3 ₳ one. Review then refuses in words. Nothing changes at today's price, where back is 1.5 ₳.

*Evidence:* Lovejoin.tsx:3662 `const reserves = DEPOSIT_RESERVE + (back === undefined ? BOOTSTRAP_BACK_LEAST : BigInt(back));`. On failure the effect runs `setPrivateBack(undefined)` (Lovejoin.tsx:2690-2693).

*Fix:* None needed. It fits the owner's rule against refusing more than the ledger does, and Review decides. Noted for completeness.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3662`

*Verified:* verify confirmed (nit)

*Outcome (bootstrap):* **not-a-bug**. Test: None: no change. The stand-in is already pinned at lovejoin-release-rules.test.ts lines 495-496 (no back given).

Accurate, and the finding itself says no fix is needed. The 1.5 ₳ stand-in applies only until the worker answers, or if the read fails. Review then refuses in words and no money moves. Refusing more would break 'refuse only what the ledger refuses'.

## pr334#0

**low** · docs · confidence high · lane `docs-roadmap`

**Item 8's entry calls the wallet's chain window four, but four-box chains go two at a time**

*Claim:* HEAD says the wallet sends a chain four at a time (pumpChain), and that sending it whole would save 120 to 245 s. A chain of four-box mixes is given window 2 (chainWindow(4) = CHAIN_WINDOW_FOUR). The 245 s was measured at a window of 4, which the wallet never uses for four-box mixes. The windows predate the range (b9c35f06, chunk 34e), so the text was wrong when written.

*Scenario:* Someone takes up the Leios change, reads 'a chain's window of four in flight', and raises or drops CHAIN_WINDOW. CHAIN_WINDOW_FOUR stays at 2, so a four-box chain (Settings' four-wide option) still goes two at a time. For a deposit and 5 mixes that is three trips through the queue, not the two the 245 s figure measured.

*Evidence:* roadmap.md:409: "a chain's window of four in flight (`pumpChain`) could be the whole chain, since four at a time, the rest waited for the queue again (120 to 245 s more)".
lovejoin.ts:300-302: `export const CHAIN_WINDOW_FOUR = 2;` ... `export const chainWindow = (width: number) => (width >= 4 ? CHAIN_WINDOW_FOUR : CHAIN_WINDOW);`
lovejoin.ts:4635: `...(built.width === 4 ? { window: chainWindow(4) } : {}),`
sessions.ts:4937: `const window = summary.lovejoin?.width === 4 ? { window: chainWindow(4) } : {};`
lovejoin-mix-width.md:149: "`CHAIN_WINDOW`, whose four in flight assume three mixes a block, and `CHAIN_WINDOW_FOUR`, two for four-box mixes (`chainWindow`)".
The run's record origin/web-wallet/leios-musashi:seedelf-leios/results/2026-10-28/1793219148-chain-w4-k4.json has "window": 4. Its first four landed at 153.0 s and mixes 4 and 5 at 397.9 and 398.9 s, which is the 245 s.

*Fix:* Line 409: "a chain's window in flight (`pumpChain`: four, two for four-box mixes, `chainWindow`) could be the whole chain: sent four at a time, the rest waited for the queue again (120 s more three wide, 245 s four wide; the wallet sends four wide two at a time, which wasn't run)."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:409`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:300`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4635`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4937`, `seedelf-platform/seedelf-web-wallet/docs/lovejoin-mix-width.md:149`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): chain-w3-k4/chain-w4-k4 records, lovejoin.ts:294-302



## pr334#1

**low** · docs · confidence high · lane `docs-roadmap`

**"Mended, all of it ran on Musashi", but no Lovejoin withdraw was ever sent**

*Claim:* The entry says everything ran once mended. The run never sent a withdraw, since one can't be mended after it's built. A withdraw, the transaction that brings a box back to the private balance, has never run under Dijkstra.

*Scenario:* The eventual Dijkstra fix (a Pallas update or core patches) is checked against this entry. "All of it ran" reads as covering withdraws, so the fix's check skips a live withdraw, the one transaction never tried under Dijkstra.

*Evidence:* roadmap.md:406: "Mended, all of it ran on Musashi, Seedelf's and Lovejoin's scripts unchanged. ... A withdraw can't be mended after it's built: its proofs bind every output."
The run's 20 records hold only payments, deposits, mixes and Seedelf spends (kinds counted per file).
The branch's seedelf-leios/README.md: "A Lovejoin withdraw can't be mended after the fact ... None was sent here."
The binding is real: seedelf-core/src/lovejoin/mod.rs:1168-1187, owner_context = blake2b_256(outputs || input refs || mix_box's hash).

*Fix:* "Mended, every Seedelf spend, deposit and mix ran on Musashi, scripts unchanged. No withdraw was sent, since one can't be mended after it's built (its proofs bind every output): it's the one the fix must try first."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:406`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): the 20 records hold no withdraw; README says none was sent



## pr334#2

**low** · release · confidence high · lane `docs-roadmap`

**The list on HEAD shows 1.7.0's items 4–7 as not done, though #333, #335, #336 and #337 merged**

*Claim:* #333, #335, #336 and #337 never touched the roadmap. HEAD's list reads: 1 done, 2 in progress, 3 done, 4 half done, 5 to 7 not started, 8 done. Their Kept in mind entries are unticked too, and 379–380 still describe the plan's Koios requests, not what #336 built. This is deliberate: #333 says "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit". Meanwhile #330, #331, #332 and #338 updated their own lines, so item 8, which ships nothing, is ticked while four wallet items look unbuilt.

*Scenario:* At the gate, someone reads "the version is cut once they're in" and sees items 5 to 7 not started. If the release-prep commit only ticks the list lines, 379–380 keep stating requests the wallet doesn't make (`utxo_info`, a batched `account_info`). That misstates the Koios cost the rules require every feature to state.

*Evidence:* roadmap.md:39-41: "5. ⬜ **A listed pool confirmed on chain, ...", "6. ⬜ **An "unmixed, now" way out** ... The owner's calls first: after how long it's offered, and its words.", "7. ⬜ **Transaction details for every part**".
roadmap.md:38: item 4 still marked "🚧", with only "✅ The overflow half".
roadmap.md:379: "one `utxo_info` per newly listed pool"; :380: "One batched `account_info` ...".
The code, lovejoin-pools.ts:520: "One `tx_info` request for every launch, and one `account_update_history` for the L its launch didn't register."
`git log babb8e76..6bca8bec -- docs/post-release-roadmap.md` shows no commit from #333, #335, #336 or #337.

*Fix:* In the release-prep docs commit:
- Tick items 4 to 7.
- Item 6 states the calls made (an hour, TAIL_OFFER_MS; Bring the rest back now) in place of "The owner's calls first".
- Lines 373, 374 and 378–380 become "✅ **1.7.0:**" entries, as 387–388 are.
- Rewrite 379–380 to what #336 built: Koios's tx_info per new launch, and account_update_history only for an L its launch didn't register.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:38`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:39`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:40`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:41`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:373`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:374`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:378`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:379`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:380`

*Verified:* trace confirmed (low); impact partly (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): as x-docs#0



## pr334#3

**owner-call** · release · confidence medium · lane `docs-roadmap`

**Nothing on HEAD ties the Dijkstra fix to the hard fork; #338 dropped #334's date for it**

*Claim:* My idea, not a defect. #334 said Leios's mainnet hard fork "is targeted for late 2026". #338 replaced that, and says the fix ships "much later (the owner, 2026-10-28)". From protocol version 12 the node refuses every transaction core builds with a script, yet nothing on HEAD says the fork is the deadline.

*Scenario:* Dijkstra reaches mainnet while the fix is still "much later". From that epoch the node refuses each Seedelf spend, session return, Lovejoin mix and withdraw, the collateral's mix, DEX order cancel and pool launch. Seedelf balances and Lovejoin boxes can't move until a fixed release clears store review: nothing is lost, but nothing moves meanwhile.

*Evidence:* #334 (`git show ae610284:seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md`, line 405): "Musashi Dojo is the public testnet of Ouroboros Leios, which adds endorser blocks beside Praos's and whose mainnet hard fork is targeted for late 2026."
HEAD :406: "protocol version 12 decodes only a map. ... The fix is a Pallas update, or patches in core, then a CLI release and a web wallet release, much later (the owner, 2026-10-28)."
pallas-txbuilder-0.35.1/src/conway.rs:218: `Redeemers::List(`.
seedelf-core/src/withdraw_zero.rs:117: `let redeemers = Redeemers::List(MaybeIndefArray::Def(redeemers));`.

*Fix:* Owner's call. Beside "much later", name the trigger without a date: "before Dijkstra's hard fork reaches mainnet, since from it every private spend is refused". Or leave it, if the owner knows the fork is far off.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:406`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-roadmap):* **owner-call**. Test: none: owner's call

Same recommendation as pr329#8.

## pr334#4

**nit** · docs · confidence high · lane `docs-roadmap`

**The 4-wide chain reads as five transactions; it was six (a deposit and 5 mixes)**

*Claim:* The doc gives the 3-wide chain's shape but not the 4-wide one's. "Four into an EB and the fifth into the next RB" then reads as five transactions. The chain was six, and five of them (the deposit and four mixes) went into the EB.

*Scenario:* A reader compares the two chains and takes the 4-wide one as a deposit and 4 mixes, with one transaction fewer in the EB than actually landed there.

*Evidence:* roadmap.md:407: "Sent whole, a 3-wide chain (a deposit and 4 mixes) went into one certified EB, and a 4-wide one went four into an EB and the fifth into the next RB's own body."
The record 1793218714-chain-w4-all.json: the deposit and mixes 1–4 are in certified EB 41417, and mix 5 is in RB 41419.

*Fix:* "and a 4-wide one (a deposit and 5 mixes) went five into an EB and the last mix into the next RB's own body."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:407`

*Verified:* verify confirmed (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): chain-w4-all.json



## pr334#5

**nit** · docs · confidence medium · lane `docs-roadmap`

**"Dijkstra's fees on reference inputs" can be read as the reference-script fee core already counts**

*Claim:* The two new Dijkstra parameters aren't named. "Core's fee doesn't count them" can be read as core underpricing today's mainnet spends, which read reference scripts. Core does price Conway's reference-script fee.

*Scenario:* A reader of the Leios entry concludes that core's fees on mainnet miss a reference-input charge today, and goes looking for an underpricing bug that isn't there.

*Evidence:* roadmap.md:409: "Dijkstra's fees on reference inputs are 0 on Musashi, and core's fee doesn't count them yet."
build.rs:66-76 prices `min_fee_ref_script_cost_per_byte` in tiers.
Musashi's protocol-parameters.json (on the branch): refInputsCostPerDatumByte 0, refInputsCostPerMultiAssetPolicy 0, minFeeRefScriptCostPerByte 15.

*Fix:* "Dijkstra's new fees on reference inputs (`refInputsCostPerDatumByte`, `refInputsCostPerMultiAssetPolicy`) are 0 on Musashi, and core's fee doesn't count them yet."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:409`, `seedelf-platform/seedelf-core/src/build.rs:57`

*Verified:* verify confirmed (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): Musashi protocol-parameters.json



## pr334#6

**nit** · docs · confidence high · lane `docs-roadmap`

**Item 8 sits under "what 1.6.0 left ... each item lands on main", though it is neither**

*Claim:* Item 8 isn't something 1.6.0 left. Only its docs land on main; its branch stays unmerged. Its Kept in mind entry sits in the group "Left by the chunks and the reviews". It promises no wallet change ("Nothing in the wallet"), so this is harmless now that it's ticked.

*Scenario:* A reader of 1.7.0's list takes item 8 as something the release ships or waits on, until they read its line.

*Evidence:* roadmap.md:33: "**Then 1.7.0: what 1.6.0 left, in small PRs** ... each item lands on `main` on its own branch and PR, and the version is cut once they're in".
roadmap.md:42: "Run on its own branch, `web-wallet/leios-musashi`, which stays unmerged to learn from".
roadmap.md:356 heads the group item 8's entry (:405) sits in: "**Left by the chunks and the reviews, moved here when [plans/](plans/) was archived (2026-10-04)**".

*Fix:* One clause at :33 ("item 8 is a test run on its own branch, not a wallet change"), or leave it.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:33`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:42`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:356`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:405`

*Verified:* verify partly (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs)

Header names the Leios run.

## pr335#0

**low** · ux · confidence high · lane `stepper`

**The stepper's index outlives a review rebuilt in place: 'Transaction 3 of 2' over the first part, Next unbounded**

*Claim:* `shown` is TxDetailModal's own state, and nothing resets or clamps it when `parts` or `txHash` change. TxDetailButton keeps `open` across a re-render of its review, and the modal has no key, so an open view outlives an in-place rebuild of its review. With fewer parts, `hash = many?.[shown] ?? txHash` falls back to the new first's hash. The label still says `shown + 1` of `many.length`, and Next is disabled only at exactly `shown === many.length - 1`, so it stays live past the end.

*Scenario:* 1. A Make public in 3 parts is refused at Send as stale.
2. 'Refresh and review again' rebuilds in place: the review and its Transaction details chip stay on screen and clickable while the parts are built and measured, which takes seconds.
3. The user opens the details and steps to 'Transaction 3 of 3'. The worker still holds the old records until the new build's keepParts.
4. The new review lands in 2 parts. The still-open modal reads 'Transaction 3 of 2' over the new first transaction, with both arrows enabled; Next goes on to '4 of 2', '5 of 2', and so on.

The same happens with a swap's switch or Change (Swaps.tsx:838), Lovejoin's buildAgain (Lovejoin.tsx:2984), a site's build again (DappApprovals.tsx:659) and Transfer's stale foot. No money is at risk: Send is behind the modal and never reads the view.

*Evidence:* TxDetail.tsx:
- :125 `const many = parts && parts.length > 1 ? parts : undefined;`
- :126 `const [shown, setShown] = useState(0);`
- :127 `const hash = many?.[shown] ?? txHash;`
- :159 `{tr("tx.partOf", { n: shown + 1, total: many.length })}`
- :165 `disabled={shown === many.length - 1}`
- :77-78 `{open && (<TxDetailModal txHash={txHash} parts={parts?.map((p) => p.txHash)} .../>)}`, with no key.

The rebuild is in place: Withdraw.tsx:129 `setSummary(await call("withdraw-build", { payments }));` and StaleReview.tsx:111 `ready ? void build() : toForm()`.

A scratch SSR render of the real TxDetailModal, with shown preset to 2 and parts of 2, gave `<output class="stepper__value" data-testid="tx-part">Transaction 3 of 2</output>`, neither arrow disabled, and `data-value` the first hash.

*Fix:* Clamp the index: `const at = many ? Math.min(shown, many.length - 1) : 0;`. Use `at` for the hash, the label and both ends, with `disabled={at >= many.length - 1}`. Also key the view by the review's first hash in TxDetailButton (`<TxDetailModal key={txHash} …/>`), so a rebuilt review opens on its first transaction.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:125`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:159`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:165`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:77`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx:129`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/StaleReview.tsx:97`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (stepper):* **fixed**. Test: tests/screens-wiring-review-fixes.test.ts › Transaction details' stepper › 'never stands past its last part…' (HEAD: 'Transaction 3 of 2' over the first's id, Next on), 'steps back from there to the one before it…' (HEAD: a dead Previous press), 'opens a review built again on its first transaction…' (HEAD: key undefined). All three fail on HEAD and pass now.

Clamped the index (const at = min(shown, parts-1)), used it for the hash, the label and both ends. The arrows now call setShown(at ∓ 1), so no press is dead after a shrink. TxDetailButton keys its view by txHash: a review built again in place gets a new first hash (new one-time key), so its view starts afresh on its first transaction.

## pr335#1

**low** · docs · confidence high · lane `docs-roadmap`

**The roadmap still lists item 7 as not done, and Kept in mind still says a review opens only the first part's**

*Claim:* #335 merged item 7, but post-release-roadmap.md on HEAD still shows it ⬜. Its Kept in mind bullet still describes the gap as open. #330, #331 and #332 each marked their own item; #333, #335, #336 and #337 didn't, and #338 updated only item 8. Also, the view's own descriptions (the tx-view paragraph in architecture.md and flows.md's 'Read the transaction' section) don't say that a payment in parts steps through each transaction. Only the storage-table row and the Send-in-parts paragraph say it.

*Scenario:* Someone reading the 1.7.0 list on the gate tree, the owner packaging 1.7.0 or the next session, takes item 7 as still to do and the gap as still present.

*Evidence:* post-release-roadmap.md:41: `7. ⬜ **Transaction details for every part** of a payment in parts.`

post-release-roadmap.md:374: `**Transaction details for every part (1.7.0)** of a payment in parts: a review opens only the first part's (321-parts-worker#5; …)`.

`git diff --stat <merge>^1 <merge> -- docs/post-release-roadmap.md` is empty for 0bad0d52 (#335), b2c3940f, 473b7f1a and 11e249d2, and non-empty for 81397dc4, 4610555a and 3b32b92e.

*Fix:* Mark item 7 ✅ with one line on what it did: a stepper in the view, and tx-view.ts following `partHashes`. Strike or drop the line-374 bullet. Optionally add one clause each to architecture.md:211 and flows.md's 'Read the transaction' section. Items 4's other half, 5 and 6 need the same.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:41`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:374`, `seedelf-platform/seedelf-web-wallet/docs/architecture.md:211`, `seedelf-platform/seedelf-web-wallet/docs/flows.md:253`

*Verified:* trace partly (nit); impact partly (nit)

*Outcome (docs-roadmap):* **partly**. Test: none (docs): tx-view.ts, TxDetail.tsx in W

Item 7 and its entry done; architecture.md:211 and flows.md are the docs-design lane's.

## pr335#2

**low** · tests · confidence high · lane `stepper`

**Only Make public's stepper is tested: the other four reviews' `parts` props could be dropped unnoticed**

*Claim:* Only Withdraw's wiring is exercised, by the e2e. The screen tests render TxDetailModal directly, never through TxDetailButton or a screen. The one-line `parts={…}` props on Send privately, a swap's funding, Lovejoin's private mix and a site's funding have no test.

*Scenario:* A later edit drops `parts` from the swap's funding review, or passes the wrong array. A swap funded in 2 parts is back to opening only its first transaction's details, which is the 321-parts-worker#5 gap, and every test still passes.

*Evidence:* grep over e2e/ and tests/ for 'tx-part', 'Next transaction', 'Previous transaction' and 'Transaction 1 of' finds only tests/tx-view-screen.test.ts:626-638 (TxDetailModal rendered directly) and e2e/extension.spec.ts:2662-2673 (withdraw-tx-*).

*Fix:* Add a cheap guard. For example, a source scan test: every screen whose summary type has `parts` passes it to its TxDetailButton. Or an e2e step on Send privately in parts.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:236`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:935`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3075`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:772`, `seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:2659`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (stepper):* **fixed**. Test: tests/screens-wiring-review-fixes.test.ts › 'Transaction details for every part, handed on by each review in parts' (Send privately, Make public, a swap's funding, a mix into Lovejoin from the private balance, a site's funding). They pass on HEAD, which has no defect. In a copy, dropping parts= on each screen fails exactly that case, and so does a wrong array (slice(1)).

Test only. Each case seeds its review over the seam and checks that TxDetailButton's {txHash, parts} equal the summary's. The seam's on() now also hands act the element's key (backwards compatible).

## pr335#3

**nit** · tests · confidence medium · lane `stepper`

**After Next, the e2e's 'Pays' and no-error checks aren't tied to the second part's read**

*Claim:* The modal clears the last part's view inside the effect, not as the index changes. That update runs at default priority, after the discrete click's commit. So one committed state shows the label 'Transaction 2 of 2' over part 1's body and id. After Next:
- `toContainText("Pays")` can match that stale body.
- `not.toHaveAttribute("data-value", first)` also passes while part 2 is loading.
- `withdraw-tx-error` `toHaveCount(0)` can then run before part 2's answer arrives.

*Scenario:* The later-part lookup regresses. In a run where Playwright's 'Pays' check lands before React's clearing render, the test passes while part 2's read ends in an error after the last assertion. In practice the queued render usually wins, which is why the author saw the e2e catch the bug, so this is about determinism.

*Evidence:* TxDetail.tsx:131-133 clears the view inside `useEffect(() => { let gone = false; setView(undefined); setError(undefined); call("tx-detail", { txHash: hash })…`, so the clear lands after the render that changed the label.

extension.spec.ts:2668-2672: `toHaveText("Transaction 2 of 2")`, then `toContainText("Pays")`, then `not.toHaveAttribute("data-value", first!)`, then Next disabled, then `withdraw-tx-error` `toHaveCount(0)`.

*Fix:* In the test, after the id changes, wait for `withdraw-tx-loading` to have count 0 before checking the error, or check a fact only part 2 has. In the component, render the body only when the view's own hash equals `hash`, which also removes the one-frame mismatch.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:2669`, `seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:2672`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:132`

*Verified:* verify confirmed (low)

*Outcome (stepper):* **fixed**. Test: The same seam test as x-mut-ts#6. On HEAD, one render showed the first's id and body under 'Transaction 2 of 2' (the one-frame mismatch); none does now. The e2e was edited but not run.

Component: view and error became one state {of, view?, error?}, shown only when of === the current hash, so no render shows another part's answer. The effect no longer clears; gone still drops late answers. e2e: after Next, it checks the id isn't first's, then that loading has count 0, then that the error has count 0, then 'Pays', then Next disabled. That ties both checks to part 2's own read.

## pr335#4

**nit** · ux · confidence high · lane `stepper`

**Keyboard focus drops to <body> when the focused arrow disables itself at an end**

*Claim:* Each arrow is disabled at its end while it may hold focus. The box stepper (Lovejoin.tsx:3232-3238) does the same. Otherwise screen-reader use is right: the arrows have aria-labels, the SVGs are aria-hidden, and `<output>` is a polite live region, so 'Transaction 2 of 2' is announced.

*Scenario:* A keyboard user presses Enter on Next at 'Transaction 1 of 2'. Next disables itself, focus goes to <body>, and Enter or Space then do nothing until Tab or Shift+Tab.

*Evidence:* Playwright, Chromium 153, a showModal() dialog with the same markup:
- before: next.
- After Enter at the end: `BODY | Transaction 2 of 2`.
- After Tab: copy (the next control). After Shift+Tab: prev.
- Escape still closes the dialog.

*Fix:* The owner's call, since it matches the box stepper. Either keep the arrows focusable with `aria-disabled`, or move focus to the other arrow on reaching an end.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:152`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:165`

*Verified:* verify confirmed (low)

*Outcome (stepper):* **owner-call**. Test: none: the finding defers it to the owner, since the box stepper (Lovejoin.tsx ~3232) behaves the same

Confirmed by its verifier: focus drops to <body> when the focused arrow disables itself at an end. Not built.

## pr335#5

**nit** · ux · confidence high · lane `stepper`

**During Send, and after a part fails, every part reads 'isn't one the wallet is holding. Review it again.'**

*Claim:* The view reaches later parts only through the first part's record. The watch removes that record as soon as the first part is taken (`session.remove(s.key)`). From then on no part is served, even those still kept under `<key>.<i>` while Send sends the rest. holdWaiting moves waiting parts to `seedelf.waitingPart.<hash>`, which the view never reads.

*Scenario:* 1. A Make public in 3 parts is sent; the details chip isn't disabled while Send is busy.
2. While part 2 goes through giveme.my and Koios, the user opens the details.
3. All three parts read 'That transaction isn't one the wallet is holding. Review it again.', including part 3 under `seedelf.withdraw.built.2`.

After a partial failure (`worker.parts.partly`) the same words are the right advice. No screen offers the view after a successful Send. Before the PR, part 1 read the same.

*Evidence:* pending.ts:522-525: `await take(deps, watched, async () => { await rememberSpent(...); await session.remove(s.key); });`.

tx-view.ts:158-161: `const part = partOf(record, wanted); if (part > 0) { const later = cborOf(await session.get<unknown>(partKey(key, part)), wanted, network); … }`. Without the first's record there are no `partHashes`, so `partOf` is -1.

The message is en.json `worker.txView.notHeld`.

*Fix:* None needed for the release. Optionally, disable the Transaction details chip while its review is sending.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts:524`, `seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:158`

*Verified:* verify confirmed (nit)

*Outcome (stepper):* **deferred**. Test: none: the trace verifier confirmed it, and the finding says no release fix is needed

Once part 1 is taken, the first's record (the only one with partHashes) is gone, so every part reads NOT_HELD during Send and after a partial failure. 'Review it again' is the right advice after a failure, Back is disabled during Send, and a successful Send replaces the review. Disabling the chip while sending is optional UX for later.

## pr336#0

**low** · correctness · confidence high · lane `pools`

**confirmed() checks the launch with Koios but keeps the server's reference row (datum) and launch position**

*Claim:* A token pool's scripts derive from its seed alone (policy, then mix_logic, then mix_box), so nothing offline pins the reference datum's box ADA, token or max fee. confirmed() runs launched() on the server's reference row and asks Koios tx_info for inputs and certificates only (no outputs). Koios confirms that the launch transaction exists and spent the seed, never the row the wallet keeps. It also returns the server's FoundPool, with the server's launch block and place, although launched() has Koios's. So the PR's 'as the holder's look would' and 'so devices can't disagree' don't hold against a lying server: the holder look reads the row from Koios.

*Scenario:* A compromised data layer lists pool A's real reference outpoint (launch T, seed S, L registered by T), with a datum saying 3 ₳ a box where the chain says 2 ₳. A mainnet device new to A keeps it after one tx_info, and its hub shows 3 ₳ boxes. A Bootstrap from that device deposits up to 96 boxes of 3 ₳ into A's real mix_box. Its reference input is A's real reference UTxO and a deposit runs no script, so the ledger takes it. No mix can ever take those boxes, since the Mix branch forces outputs at exactly the datum's value. They come back only by hand (Owner branch: proofs alone, 8131b1d), at both fees, with the deposit tied to its way back. Devices on the holder path keep the true 2 ₳. Likewise, a server-misplaced launch decides shown()'s order on this device even after Koios's holder look finds the true order.

*Evidence:* lovejoin-pools.ts:576 `fresh.map((p) => ({ row: p.ref.reference, scripts: p.ref.scripts ?? [] }))`; :583 `return found.filter((p) => known.has(...) || ok.has(...))` (the server's entries); koios.ts:942 `"select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates"`; templates.rs:124-126 `let policy = one_shot_mint.hash; let mix_logic = apply(MIX_LOGIC, vec![bytes(&policy), bytes(NFT_NAME)])?; let mix_box = apply(MIX_BOX, vec![bytes(&mix_logic.hash)])?;`; private-index.ts:393-401 (utxoOf takes address, value, datum and assets from the server's row). Scratch test in a copy: the fixture datum's `1a001e8480` (2 ₳) replaced by `1a002dc6c0` (3 ₳), Koios answering the real launch: one tx_info, then known() returned the pool with boxLovelace "3000000". With the server's launch at block 1, place 0 and Koios's at BLOCK, place 3, it was kept at {block: 1, index: 0}.

*Fix:* In confirmed(), read the fresh reference outpoints from Koios (koios.utxoInfo(refs), 60 a request: the request the roadmap's pool-exists entry proposed). Run launched() on Koios's rows and keep launched()'s pools, with Koios's row, seed and position; or drop a pool whose server row or position differs. That's one more request per batch, the same for every wallet, and the policy's 28 October entry would name it.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:576`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:582`, `seedelf-platform/seedelf-web-wallet/extension/src/background/koios.ts:942`, `seedelf-platform/seedelf-core/src/lovejoin/templates.rs:120`, `seedelf-platform/seedelf-web-wallet/extension/src/background/private-index.ts:393`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (pools):* **fixed**. Test: tests/lovejoin-discovery.test.ts > 'keeps a new pool as Koios's chain data has it, never as the list says: its datum, its scripts and its launch's place (1.7.0's release review, pr336#0)'. Before the fix, the pool was kept with the list's forged 3 ₳ box and its launch at block 1, place 0, and a pool whose script the list placed at an output the chain doesn't have was kept too. Now the pool is kept with 2 ₳ at block BLOCK, place 3, and the misplaced one isn't kept.

confirmed() reads the new pools' reference UTxO and both script outpoints from Koios (koios.utxoInfo, rows at the holder only). It runs launched() on Koios's rows and keeps the pools launched() returns. So the datum, the scripts' places and the launch's block and index are the chain's, as in the holder look. This adds one Koios utxo_info request per 20 new pools (3 outpoints a pool, 60 a request), only for pools new to the device. It is a data-handling change: the docs lane must name it in the policy's unreleased 28 October entry and in privacy.md. The fake Koios clients in three test files now answer utxo_info.

## pr336#1

**low** · perf · confidence high · lane `pools`

**A mainnet pool read now waits through Koios's retries while a newly listed pool is unconfirmed**

*Claim:* serviceDeps.pools awaits refresh(), which now awaits confirmed() on koiosAlone(): Koios's backend, with a 45 s read timeout, retries after 1 s and 3 s (one retry after a timeout), and a 429's hold of up to 60 s. Every non-quiet pool read waits through it, classic-pool flows included: a return's or mix's split/splitAll, poolNamed, the status read's ours(), madeBy. Before #336, refresh()'s only wait was the data layer's 10 s read with no retry.

*Scenario:* Mainnet, data layer up, Koios slow (each request times out), and someone launches a token pool that the data layer lists. A user brings a private session back through Lovejoin, even in the classic pool. The return's build goes split → readSet → deps.pools → refresh → confirmed: tx_info times out at 45 s, sleeps 1 s and times out again, so about 91 s before the build goes on (as long again in the rare case an account_update_history follows). The pool stays unconfirmed, so the next refresh (5 minutes on, or the first pool read after the worker restarts) waits again, until Koios answers.

*Evidence:* lovejoin-pools.ts:454 `await this.keep(network, await this.confirmed(network, found));`; :597-601 `await discovery.refresh(network).catch(...)`; koios.ts:429 `const TIMEOUT_MS = 45_000;`, :421 `RETRY_DELAYS_MS = [1000, 3000]`, :1373 `const delays = slow ? RETRY_DELAYS_MS.slice(0, 1) : RETRY_DELAYS_MS;`; data-layer.ts:49 `DATA_READ_TIMEOUT_MS = 10_000`, :85 `retries: false`; lovejoin.ts:6814 `const set = await this.readSet(network);` in split(), which a classic-pool return uses. Scratch test (copy): Koios answering 503 → `serviceDeps(found).pools(...)` took 4,028 ms (tx_info ×3) and kept nothing new.

*Fix:* Don't hold the read on the check. Either run it with a client that doesn't retry and has a short timeout (as the data layer's backend does), since a failed check only waits for the next list anyway; or start it without awaiting it, one in flight per network as scan() keeps `looking`, and let the next read take what it confirmed.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:454`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:597`, `seedelf-platform/seedelf-web-wallet/extension/src/background/koios.ts:1371`, `seedelf-platform/seedelf-web-wallet/extension/src/background/data-layer.ts:49`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:6814`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (pools):* **fixed**. Test: tests/lovejoin-discovery.test.ts > 'holds no pool read while Koios checks a pool new to the device: the pools kept before are read till it's kept (1.7.0's release review, pr336#1, x-priv#2)'. Before the fix, serviceDeps(d).pools was still pending after 1 s with Koios's tx_info held. Now it answers at once with the pools already held, and the new pool is read once Koios answers.

refresh() now starts the Koios check, one per network at a time, and returns without waiting for it. When the check ends, confirm() keeps what it confirmed. Pool reads go on with the pools kept before, so an unconfirmed pool is never shown. look() waits for the check, which keeps the Lovejoin page's grew answer (R10) and the pool start's look as they were. Existing tests that expected refresh() to keep the pool now call look() first.

## pr336#2

**low** · perf · confidence high · lane `pools`

**On a device with no record yet, each pool read during a slow check sends lovejoin/pools and the Koios check again**

*Claim:* refresh()'s throttle exception for a record without `listed` (Remove wallet's) assumes keep() writes right after the data layer answers. confirmed() now sits between `answered.set` and keep's first write. On a fresh install or after Remove wallet, with Koios slow, every non-quiet pool read in that window deletes `answered`, asks lovejoin/pools again, and starts another Koios check with its own retries.

*Scenario:* A fresh 1.7.0 install on mainnet (the bundled mainnet head start holds 0 pools), or right after Remove wallet. The data layer lists one token pool, and Koios is slow. The user opens Lovejoin, and the check starts. Then Refresh, a pool's page, or a running mix's session-advance (every 20 s) each send another lovejoin/pools and another tx_info. Each can wait up to about 91 s, and each holds its pool read.

*Evidence:* lovejoin-pools.ts:415 `if (!this.answered.has(network) || (await this.deps.local.get<Stored>(key(network)))?.listed !== undefined) return; this.answered.delete(network);`, :432 `this.answered.set(network, at);`, :454 (keep only after confirmed). Scratch test (copy): first pool read held at Koios, two more reads meanwhile → `data layer: 3 koios: tx_info,tx_info,tx_info`.

*Fix:* Allow one refresh in flight per network: a refresh that finds one running returns or awaits it, as scan() does with `looking`. Or have keep() write the list's `listed` before the check.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:410`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:432`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:454`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (pools):* **fixed**. Test: tests/lovejoin-discovery.test.ts > 'asks for the list and Koios once on a device with no record yet, however many pool reads come while Koios checks (1.7.0's release review, pr336#2)'. Before the fix it saw 3 lovejoin/pools calls and 2 tx_info; now 1 and 1, and no second check when the next list arrives 5 minutes later while Koios still hangs.

refresh() now calls await this.keep(network, []) right after the data layer answers, so the record has its list fingerprint and the throttle's exception holds again. Together with one check at a time per network, that stops the repeat requests. I removed each guard in turn: the test fails without the one-check guard ([2,2] against [1,1]) and without the keep (3 list calls).

## pr336#3

**low** · privacy · confidence medium · lane `docs-design`

**The device that started a pool is likely the first to ask Koios about it, which the policy doesn't cover**

*Claim:* Nothing tells discovery that this device built a launch, so a pool the user started is new to the device like any other. It's confirmed with Koios from the user's IP, usually first, since the starter is the one waiting to Bootstrap it. The policy seals 'the pools you started' on the device, and says the new request names nothing of yours. Before #336, on mainnet with our server up, Koios heard nothing of a launch. The same timing has existed on the Koios path since 1.6.0.

*Scenario:* Mainnet: a user starts a token pool from the private balance (giveme.my's collateral, so the chain ties it to no account). About 200 slots later the data layer lists it. The user's hub, open to Bootstrap the pool, reads pools, and confirmed() posts tx_info with the launch's hash to api.koios.rest from their IP. That's minutes after the launch, likely before any other device reads it, so Koios can guess this IP started the pool.

*Evidence:* lovejoin-launch.ts:243-244 `await this.deps.discovery.look(network); const known = await this.deps.discovery.known(network);` (no record of its own launch handed to discovery); lovejoin-pools.ts:567-568 (every listed pool not in the record is fresh); privacy-policy.md:28 'the pools you started … stay on your device only, encrypted like your contacts'; :93 'The same request for every wallet, only for pools new to the device, naming nothing of yours'.

*Fix:* Owner's call: either treat a pool whose launch this wallet built and saw land as known, so no Koios check, or add to the policy's 'Starting a pool' sentence that Koios may tell from the first check's timing.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:243`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:565`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:93`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:28`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **partly**. Test: docs-only: as x-priv#1

Duplicate of x-priv#1: disclosed; the code alternative is the owner's call.

## pr336#4

**low** · tests · confidence high · lane `pools`

**confirmed()'s trap rethrow has no test**

*Claim:* Mutation M5 (`catch (e) { standard = []; }`, traps swallowed) passes all 62 tests in lovejoin-discovery and lovejoin-merged-review. The one discovery trap test traps in refresh()'s verified(), and its Koios fake throws 'not asked here', so confirmed() is never reached.

*Scenario:* A later edit drops `if (isTrap(e)) throw e;`. A trap in lovejoinLaunchCheck during a data-layer check is then taken for Koios down: the pool is left out, and the wallet carries on with a broken WebAssembly instance instead of locking (314-wasm#0's rule, #330).

*Evidence:* lovejoin-pools.ts:578-581 `} catch (e) { if (isTrap(e)) throw e; standard = []; }`. Mutation run in a copy: M5 → 'Tests 62 passed (62)'.

*Fix:* Add the test below.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:578`, `seedelf-platform/seedelf-web-wallet/extension/tests/wasm-review-fixes.test.ts:118`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (pools):* **fixed**. Test: tests/lovejoin-discovery.test.ts > 'locks the wallet when WebAssembly traps under the check, never taking the trap for Koios down (1.7.0's release review, pr336#4, x-mut-ts#0)'. Before, the mutation that swallows the trap in confirmed() survived every test. Now that mutation fails the test, and so does a second one where confirm() never calls wallet.trapped. The file was restored byte for byte after both runs.

No request waits for the check any more, so a trap under it now locks the wallet through a new required dep, wallet: { trapped }, as other services lock on traps outside a request. sw.ts passes the worker's wallet. confirmed() still rethrows a trap. The dep is required so the compiler refuses wiring that leaves it out; seven test constructions got one line each.

## pr336#5

**low** · docs · confidence high · lane `docs-design`

**architecture.md and lovejoin-pools.ts's comments still describe mainnet discovery as it was before #336**

*Claim:* architecture.md:732 still says that from the data layer's list 'that it's finished, and where its launch sits … are the server's word', and that 'Whether a pool is on chain at all is the ledger's to judge, not the server's'. A new pool's launch and L are now Koios's. The Lovejoin 'What each costs' (:737) doesn't list the check's requests (rule 8). The module's header (:31-36), refresh()'s doc comment (:399-403) and its inline comment (:435-438) say the same as before.

*Scenario:* Someone reads architecture.md to judge how far the wallet trusts the data layer (what docs-small#1's fix wrote it for). They conclude that mainnet takes 'finished' on the server's word, and that mainnet discovery asks Koios nothing.

*Evidence:* architecture.md:732 '…that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below). Whether a pool is on chain at all is the ledger's to judge, not the server's…'; git log babb8e76..HEAD shows #336 didn't touch architecture.md; lovejoin-pools.ts:34-36 'so the ledger is the judge of that'.

*Fix:* At :732, say that Koios confirms a new pool's launch and L (confirmed), while its row and position stay the server's. At :737, add the cost: one tx_info per 20 new pools, and one account_update_history per 75 L's whose launch didn't register them, once per pool per device, again at each list while unconfirmed. Update the comments to match.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/architecture.md:732`, `seedelf-platform/seedelf-web-wallet/docs/architecture.md:737`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:31`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:435`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (pools):* **partly**. Test: None: a docs and comments finding. I checked the claim against the code; it held.

Same comment fixes as x-scen#4. architecture.md:732 and its cost note at :737 are left to the docs-design lane; docs_notes gives the exact request counts.

*Outcome (docs-design):* **fixed**. Test: docs-only: koios.ts TXS_PER_REQUEST 20, REFS_PER_REQUEST 60, CREDENTIALS_PER_REQUEST 75

:733 trust model and :738 cost (one utxo_info and one tx_info per 20 new pools, one account_update_history per 75 Ls; once a pool per device, again each list while unconfirmed). Comments fixed by the pools lane.

## pr336#6

**low** · docs · confidence medium · lane `docs-design`

**The policy's summary lines still say Koios is asked on mainnet only for what our server can't answer**

*Claim:* Since #336, Koios is asked on mainnet while our server answers: by every Lovejoin user's device, whenever a new pool is listed, to check our server's list. The detailed paragraph (:46) and the 28 October entry (:93) say so. The In short, the Cardano server's definition and the Koios bullet still say Koios gets only 'anything our server can't answer'.

*Scenario:* A mainnet user reads the In short and the Koios bullet, and believes Koios never sees their IP while our server works. At their next Lovejoin pool read after a new pool appears, Koios does.

*Evidence:* privacy-policy.md:5 '…and on mainnet for anything our server can't answer…'; :40 'Koios … everything on preprod, and on mainnet whatever ours can't answer, or everything with that switch on.'

*Fix:* Add to the Koios bullet (and optionally to the In short): 'and to check a new Lovejoin pool ours lists'.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:5`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:7`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:40`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **fixed**. Test: docs-only: as x-docs#2

In short (:5) and the Koios bullet (:40). :7 left alone, as the impact verifier advised.

## pr336#7

**nit** · docs · confidence high · lane `docs-roadmap`

**The roadmap still shows item 5 as open, and its two Kept in mind entries still describe the unbuilt plan**

*Claim:* Item 5 is still ⬜. The pool-exists and docs-small#1 entries still propose one utxo_info and a batched account_info, where #336 built tx_info and account_update_history through launched(). #330 and #332 ticked their own items in their PRs.

*Scenario:* The release prep reads the list and believes item 5 isn't done, or that the utxo_info plan was built.

*Evidence:* post-release-roadmap.md:39 '5. ⬜ **A listed pool confirmed on chain, and L's registration checked on the data layer's path**'; :379-380 the open entries.

*Fix:* Tick item 5, and mark both entries done with what was built, keeping F1's gap if it's left.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:39`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:379`

*Verified:* verify partly (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): as x-docs#0

Item 5 ticked; both entries rewritten to the requests built, with the gap left (checked once at first sight; pools held before 1.7.0).

## pr336#8

**owner-call** · docs · confidence high · lane `docs-design`

**The policy's Effective date is the merge day, 28 October 2026**

*Claim:* The Effective line and the new entry are dated 28 October 2026, the merge day. That's consistent with 1.6.0's practice (dated 26 October, shipped on the 27th) and with the policy's promise to update 'before the new version ships'. 1.7.0's release day may differ.

*Scenario:* 1.7.0 ships after 28 October. Until then, the policy on main describes a check that the store's 1.6.0 doesn't make.

*Evidence:* privacy-policy.md:3 '**Effective 28 October 2026** (… and a new Lovejoin pool confirmed with Koios …)'; :93 '- **28 October 2026:** on mainnet, a Lovejoin pool our server lists…'; the PR description: 'For 1.6.0 you set the policy's date at release, so move it if you want the release day instead.'

*Fix:* Owner's call: keep the date, or move both to the release day.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:3`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:93`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **owner-call**. Test: none (owner's call)

Dates untouched; recommendation in owner_calls.

## pr337#0

**low** · ux · confidence high · lane `tail`

**The way out and its 'still waiting for giveme.my' line show where nothing waits for giveme.my**

*Claim:* tailHeld keeps the hold through tailBuildable for a day from Tail.landed. Nothing marks the tail over when the session's rest comes back directly some other way: buildBack skips tailChain for a direct return, and restBack leaves out a chain whose tail box is out. The view then carries collateralHeld after the rest is already back. A site's session stays open until Disconnect, so its page shows the privacy callout 'The collateral's mix is still waiting for giveme.my…' and 'Bring the rest back now' from the hour until the day's end, though nothing can pay for that mix and nothing is held. The line's first sentence is also untrue while the mix waits for the pool (fewBoxes/noPool) rather than giveme.my.

*Scenario:* A site's session's return chain stops at the collateral's mix (giveme.my refused past its wait, or a lock cut it). The user then uses Bring everything back with its switch on 'directly' (shown when another pick has boxes). The direct return sweeps the deposit's change. In scratch R1 (backBuild(…, direct=true), then backSubmit), the view had collateralHeld {offerAt} at stage 'returning' and still at stage 'open' after the return landed. Past offerAt, the site's page shows the callout and the button though the account is empty. Pressing it only marks the tail over.

*Evidence:* lovejoin.ts:4131 `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`. sessions.ts:4386 `if (started && !direct && lovejoin) { const resumed = await lovejoin.tailChain(...)`: direct returns never touch the tail. sessions.ts:5617 `...(stage !== "closed" && tail ? { collateralHeld: tail } : {})`. SiteSessions.tsx:411 renders <CollateralHeldWayOut held={s.collateralHeld} …/> unconditionally. Scratch R1 output: 'R1 stage returning collateralHeld {"offerAt":1800000000000} now >= offerAt true' and 'R1 after landing: stage open collateralHeld {"offerAt":1800000000000}'.

*Fix:* Drop the hold from the view once a return of the rest went after the chain. chainView's `cut` already says exactly that (sessions.ts:6166): in view(), `...(stage !== "closed" && tail && !(s.chain && chainView(s.chain, txs).cut) ? { collateralHeld: tail } : {})`. Alternatively, mark the tail over where a plain return of a started session is sent. Rewording the first sentence so it doesn't name giveme.my is the owner's call (a critical key: a new value needs a blind back-translation).

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4131`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4386`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5617`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:411`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/ClaimAll.tsx:286`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (tail):* **fixed**. Test: tests/lovejoin-planner.test.ts > "holds nothing once the rest came back directly another way, its chain stopped at the mix, returning or landed (pr337#0)": on HEAD the view kept collateralHeld {offerAt} while returning and after landing; passes now

view() carries collateralHeld only while no return of the rest went after the session's chain (chainView(s.chain, txs).cut). The tail itself isn't ended, so two leftovers remain: Bring every box back now still leaves that box for up to a day (1.6.0 behaviour), and a site's session paid again the same day with no tail of its own can show the offer again. Both are listed as an owner's call.

## pr337#1

**low** · ux · confidence high · lane `tail`

**By hand, 'Bring the rest back now' brings nothing back, and the stop reason says the rest was brought back**

*Claim:* skipCollateralMix ends with advance(network, index, true). For a session that doesn't run itself (a site's, or a swap brought back by hand), step returns at once, so the press only stops the chain at the mix. The rest stays at the account until the user presses Bring it back, reviews and sends. Meanwhile the ChainRecord and the session's chain carry 'You brought the rest back without waiting for the collateral's mix, so the chain stopped there.', and the Lovejoin page's Chains row shows it. flows.md says the rest 'comes back directly'.

*Scenario:* A site's session whose return chain waits at the collateral's mix for giveme.my, past the hour. The user presses Bring the rest back now. In scratch R2, no transaction is submitted (3 before, 3 after). The page shows 'Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back'. The Lovejoin page's Chains row says 'Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there. Mix my boxes again mixes the boxes it didn't.' The rest is still at the account.

*Evidence:* sessions.ts:5537 `return this.advance(network, index, true);`. sessions.ts:3446 in step: `if (!s || !running(s)) return;` (running needs `!!s.auto`). en.json:920 "lj.tail.skipped": "You brought the rest back without waiting for the collateral's mix, so the chain stopped there." Scratch R2 output: 'R2 submitted before/after 3 3 stage open chain {…"stopped":"You brought the rest back without waiting for the collateral's mix, so the chain stopped there."}' and the chains rows carrying the same text.

*Fix:* On the by-hand pages (SiteSessions onSkip, Swaps' by-hand branch), open the return's review after the skip with buildBack(true), which now builds a plain return. Reword the machine-draft key lj.tail.skipped without the past tense, e.g. 'The rest comes back without the collateral's mix, so the chain stopped there.' (no back-translation needed). Add the by-hand step to flows.md.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5537`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3446`, `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:920`, `seedelf-platform/seedelf-web-wallet/docs/flows.md:522`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:414`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (tail):* **fixed**. Test: tests/lovejoin-planner.test.ts > "says the user chose not to wait, never that the rest came back, once a site's session's press stopped its chain (…)" (HEAD: "You brought the rest back…") and tests/screens-wiring-review-fixes.test.ts > "on a site's session: the press, the page read again, then its return's review" / "on a swap brought back by hand: the press, then its return's review" (HEAD: no session-back-build)

On pages brought back by hand, the press now opens the return's review, as Bring it back does. The new reviewAfterSkip rule decides it: no auto, nothing held, stage open, rest at the account, falling back to the page's own reading when a fresh worker has none. Each page's buildBack body became reviewBack, awaited inside the press's own act, so act is never nested. lj.tail.skipped is now "You chose not to wait for the collateral's mix, so the chain stopped there." in en, es and ja (machine drafts). Swaps and mixes that run themselves are unchanged.

## pr337#2

**low** · tests · confidence high · lane `tail`

**No test covers tailHeld's lock-cut branch or the skip for sessions that run themselves**

*Claim:* The PR's worker test only covers a chain still being sent (tailWaits) for a site's session. It doesn't cover the held state after a lock cut the chain (tailBuildable), which is the usual way a held chain ends. It doesn't cover the path for sessions that run themselves either: the skip, then advance('asked'), then act and bringBack, with the direct return in the same request. Nor does it cover the pages' wiring.

*Scenario:* Mutation M2 (in a scratchpad copy): remove `|| tailBuildable(c, this.deps.now())` from tailHeld. A session whose chain a lock cut then never offers the way out. All 41 collateral tests in lovejoin-planner.test.ts and collateral-held.test.ts still pass. A regression in the runs-itself path would also go unseen. Scratch R5 shows it works on HEAD: a mix session, after the skip, sent exactly one direct return spending the deposit's change, giveme.my not asked again, collateralHeld cleared.

*Evidence:* M2 run: 'Tests 16 passed | 63 skipped' (filter 'offers the rest back|collateral's mix') and later 41 collateral tests passing. Only the scratch tests that exercise tailBuildable (R1, R3, R4) failed under it. lovejoin-planner.test.ts:1791 is the PR's only worker test; it uses setUp's site's session with the chain pending.

*Fix:* Add (a) a lock-cut case: remove `${SESSION_CHAIN_PREFIX}preprod.0`, call lj.cuts, assert view.collateralHeld, move landed back TAIL_OFFER_MS, skip, assert the next backBuild has no collateralTail. Add (b) a mix session that runs itself (record with mix: {boxes: 1} and auto: {approved…}), held at the mix: after skipCollateralMix, exactly one direct return is submitted.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4131`, `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-planner.test.ts:1791`, `seedelf-platform/seedelf-web-wallet/extension/tests/collateral-held.test.ts:16`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (tail):* **fixed**. Test: tests/lovejoin-planner.test.ts > "offers the way out once a lock cut the chain while its mix waited, and the return after the press leaves that mix out (…)" fails with tailBuildable dropped from tailHeld (M2). "brings a mix's rest back directly in the press's own request, giveme.my not asked again (…)" fails when the press doesn't step (M3). Mutations were run in a copy outside the tree

Test-only. Both tests pass on HEAD and catch their mutations.

## pr337#3

**low** · correctness · confidence high · lane `tail`

**A press is lost while the runner builds that mix again: the new chain takes the tail on, not over**

*Claim:* skipCollateralMix runs tailHeld and tailOver outside the sessions' queue (serial). A runner step can read chain A's tail in tailChain/tailOf before the press, then go on to sendChain and recordChain. recordChain hands the tail on only if it isn't over yet, and records the new chain's tail from tailOf's copy without `over`. The new chain's mix then asks giveme.my again. The press's own response still offers the way out, since the new chain carries A's landed. The user must press a second time.

*Scenario:* A mix (or a swap) that runs itself, whose chain a lock cut while its collateral's mix waited, past the hour. The runner's step (alarm, page advance or unlock) builds that mix again, and the user presses Bring the rest back now meanwhile. Scratch R6 fired the real skipCollateralMix from inside the rebuild's buildCollateralMix. Result: A's tail over; chain B recorded with tail {tries: 2}, not over; giveme.my asked again (1 → 2); the press's response view still had collateralHeld. A review built before the press and sent after it does the same (scratch R4).

*Evidence:* sessions.ts:5527-5529 `const held = await this.deps.lovejoin?.tailHeld(network, index); if (held && this.deps.now() >= held.offerAt) { await this.deps.lovejoin!.tailOver(network, held.id);` (not in this.serial). lovejoin.ts:4998-5002 `const was = resumes ? s.chains.find((c) => c.id === resumes)?.tail : undefined; if (was && !was.over) { was.over = true; handedOn = true; }`. lovejoin.ts:4956-4968 builds the new Tail with no `over`. R6 output: 'R6 A over true B is new true B tail {"tries":2} asked 2 view held {"offerAt":1800000000000}'.

*Fix:* Run the press's tailHeld, tailOver and pump inside this.serial, then advance: queued behind the runner's step, tailHeld then finds chain B and marks it over. Or have recordChain record the new chain's tail as over when the tail it resumes was already ended, so witnessTail stops it at once.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5527`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4998`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4956`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (tail):* **fixed**. Test: tests/lovejoin-planner.test.ts > "never loses a press that came while the runner built that mix again: the chain it built stops at its mix (…)": the press fires from inside buildCollateralMix during the runner's step. On HEAD its answer still held, and the rebuilt chain's tail wasn't over; passes now

skipCollateralMix now runs whole in this.serial: tailHeld, tailOver, pump, then step("asked") and one() called directly. The press can't be lost; giveme.my can be asked at most once more, by the runner step already under way. I didn't take the recordChain variant: alone it leaves a window between the press's read and its write, and with the press serialized it would only change the two-window case (owner's call).

## pr337#4

**nit** · docs · confidence high · lane `docs-roadmap`

**privacy.md doesn't mention the user's way out; the roadmap still marks item 6 not done**

*Claim:* privacy.md, the design doc for the collateral's mix, still says the box waits unmixed only 'past that, or a day after the deposit landed'. It doesn't mention that from an hour after the deposit landed the user can choose to leave it unmixed and tied to the session. The 1.7.0 list still shows item 6 as ⬜ after #337 merged (items 5 and 7 too).

*Scenario:* A reader of privacy.md looking for every path that leaves a session's 5 ₳ box unmixed misses the new user-chosen path. The roadmap reads as if the way out isn't built.

*Evidence:* privacy.md:217 '…but for an hour at most where the deposit isn't on chain (most likely dropped); past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session…'. post-release-roadmap.md:40 '6. ⬜ **An "unmixed, now" way out** of a return held at its collateral's mix.' PR #337 changed only architecture.md and flows.md among the docs.

*Fix:* Add one clause to privacy.md's collateral paragraph: 'or sooner, from an hour after the deposit landed, where the user brings the rest back without it (Bring the rest back now)'. Mark item 6 ✅ when the list is next updated.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/privacy.md:217`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:40`

*Verified:* verify partly (nit)

*Outcome (docs-roadmap):* **partly**. Test: none (docs)

Item 6 and its entry done; privacy.md's clause is the docs-design lane's.

## pr337#5

**nit** · ux · confidence medium · lane `tail`

**Mix card renders an empty detail row before the hour; static pages show the offer only after a refresh**

*Claim:* MixCard wraps CollateralHeldWayOut in a token-row__detail div whenever collateralHeld is set, including the hour before offerAt when the component returns null. That leaves an empty grid row with its 4 px top margin. The component reads Date.now() only at render. The site's page and a by-hand swap's page don't poll, so a page opened before the hour never shows the button until Refresh.

*Scenario:* A mix held at its collateral's mix within its first hour: its card gets an empty detail row. A site's page opened at 55 minutes and left open: at 60 minutes nothing appears until the user presses Refresh.

*Evidence:* Lovejoin.tsx:2586-2590 `{s && s.collateralHeld && !isOver(s) && onSkipCollateral && ( <div className="token-row__detail"> <CollateralHeldWayOut …/> </div> )}`. LovejoinReturn.tsx:548 `if (!held || now < held.offerAt) return null;` with `now = Date.now()`. styles.css .token-row__detail has `margin: 4px 0 0`. Dapps.tsx has no sessions polling for a site's page.

*Fix:* Gate the wrapper on Date.now() >= s.collateralHeld.offerAt too, or move the wrapper into the component. Optionally re-render once at offerAt (a timeout to offerAt) on the static pages.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2586`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/LovejoinReturn.tsx:548`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:411`

*Verified:* verify partly (nit)

*Outcome (tail):* **fixed**. Test: (a) the same collateral-held mix-card tests as x-ui#2; (b) no test: not a bug

(a), the empty row before the hour, is fixed with x-ui#2. (b) is not a bug, as its verifier found: Home's unconditional 10 s tick re-renders Dapps, SiteSession and Session. Nothing is memoized, and babel-plugin-react-compiler is only an optional peer, not installed. CollateralHeldWayOut reads Date.now() each render, so the button appears within 10 s of offerAt without a Refresh.

## pr337#6

**nit** · correctness · confidence low · lane `tail`

**No offer where the deposit's landing was never recorded and the 5 ₳ pool drops out of the read set**

*Claim:* tailChain returns 'noPool' before it records Tail.landed, and tailHeld requires landed. A chain cut before its first witnessTail call (while its collateral's deposit was in flight), whose 5 ₳ pool is then missing from readSet, holds the return up to TAIL_KEEP_MS from its end with no way out offered.

*Scenario:* A lock while the collateral's deposit is in the mempool cuts the chain with landed unset. After a worker restart, discovery's known() fails, so readSet falls back to the empty in-memory `handed`. Each return build then throws lj.tail.noPool ('a day at most'), and tailHeld returns undefined, so no button shows.

*Evidence:* lovejoin.ts:4040-4041 `const pool = (await this.readSet(network, true)).find((p) => p.id === tail.pool); if (!pool?.ref) return "noPool";` comes before `tailLanded` at 4056/4063. lovejoin.ts:4130 `if (!c?.tail || c.tail.landed === undefined) return undefined;`.

*Fix:* In tailHeld, fall back to `c.tail.landed ?? c.ended` for offerAt when the chain ended, as tailBuildable already does.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4040`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4130`

*Verified:* verify refuted (nit)

*Outcome (tail):* **not-a-bug**. Test: none: refuted, and I checked it against the code

tailChain's quiet readSet(network, true) reads discovery's stored record (deps.known), which keeps a pool once handed over. It rejects only when storage can't be read, and the return then fails earlier with its own error. Even then, tailBuildable counts from landed ?? ended, so the return goes within the day, as lj.tail.noPool says. The proposed fix would offer the way out before the deposit is known in.

## pr338#0

**low** · docs · confidence high · lane `docs-roadmap`

**The roadmap says pumpChain's window is four; four-box chains go two at a time, and '120 to 245 s more' isn't a measured saving**

*Claim:* The roadmap says the wallet keeps four of a chain in flight. A chain of four-box mixes gets chainWindow(4) = CHAIN_WINDOW_FOUR = 2, both in a session's return and in a public mix. The 245 s comes from a run sent four at a time, which the wallet never does for four-box mixes; the harness's model never ran a window of two either.

The run's own totals also don't show the saving the sentence implies:
- 3 wide: 462 s sent whole, against 434 s four at a time.
- 4 wide: 388 s sent whole, against 399 s four at a time.

The 120 s and 245 s are the second wave's own waits. The expected gain comes from the model, not from the live runs. Confidence is high on the window and medium on the reading of the totals.

*Scenario:* 1. Someone takes up 'the window could be the whole chain' from this entry and raises CHAIN_WINDOW alone.
2. A user with Settings' Four boxes a mix still sends two at a time.
3. A deposit and 5 mixes makes three trips through the queue, not the two the entry describes.

Separately, anyone weighing the change against the live numbers finds that sending whole was no faster end to end.

*Evidence:* - post-release-roadmap.md:409: "a chain's window of four in flight (`pumpChain`) could be the whole chain, since four at a time, the rest waited for the queue again (120 to 245 s more)".
- lovejoin.ts:300-302: `export const CHAIN_WINDOW_FOUR = 2;` … `export const chainWindow = (width: number) => (width >= 4 ? CHAIN_WINDOW_FOUR : CHAIN_WINDOW);`
- lovejoin.ts:4635: `...(built.width === 4 ? { window: chainWindow(4) } : {}),`
- sessions.ts:4937: `const window = summary.lovejoin?.width === 4 ? { window: chainWindow(4) } : {};`
- lovejoin-mix-width.md:149: "`CHAIN_WINDOW_FOUR`, two for four-box mixes".
- Run records on origin/web-wallet/leios-musashi:
  - 1793219148-chain-w4-k4.json: "window": 4. The first four landed at 153.0 s, and mixes 4-5 at 397.9 and 398.9 s.
  - chain-w3-k4: four at 314.0 s, mix 4 at 434.1 s.
  - chain-w3-all: all at 461.3-462.2 s.
  - chain-w4-all: last at 388.2 s.
- Branch src/main.rs:260: `for window in [4, usize::MAX]`.

*Fix:* Rewrite :409's first sentence: "a chain's window in flight (`pumpChain`: four, two for four-box mixes) could be the whole chain. Sent four at a time, the rest went out once the first four landed and waited for the queue again (120 s more three wide, 245 s four wide; the wallet's own two at a time wasn't run). One run each didn't show it end to end; the model puts the gain at about two minutes under load."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:409`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:300`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:302`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4635`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4937`, `seedelf-platform/seedelf-web-wallet/docs/lovejoin-mix-width.md:149`

*Verified:* trace partly (low); impact partly (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): records and README's model line



## pr338#1

**low** · docs · confidence high · lane `docs-roadmap`

**'Mended, all of it ran on Musashi', but no Lovejoin withdraw was ever sent**

*Claim:* No Lovejoin withdraw went to Musashi. The run's README says so, and its 20 records hold only payments, deposits, mixes and Seedelf spends. A withdraw is the one transaction that can't be mended after it's built.

The entry's last sentence says a withdraw can't be mended, but not that one never ran. Token pools and giveme.my's collateral weren't on Musashi either.

*Scenario:* 1. The Dijkstra fix is later checked against this entry.
2. 'All of it ran' reads as covering withdraws.
3. The one transaction that takes a box out of the pool has never been tried under PV 12.

*Evidence:* - post-release-roadmap.md:406: "Mended, all of it ran on Musashi, Seedelf's and Lovejoin's scripts unchanged. … A withdraw can't be mended after it's built: its proofs bind every output."
- Branch README: "A Lovejoin withdraw can't be mended after the fact … None was sent here."
- Branch README, What wasn't tested: "A Lovejoin withdraw, which needs core to build it as a map, and giveme.my, which isn't on Musashi."

*Fix:* "Mended, every Seedelf spend, deposit, mix and a launch ran on Musashi, scripts unchanged. No withdraw was sent, since one can't be mended after it's built (its proofs bind every output), and neither a token pool nor giveme.my's collateral was run."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:406`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs)



## pr338#2

**low** · docs · confidence high · lane `docs-roadmap`

**'The fix is a Pallas update, or patches in core': core's patches are needed in every case, and no Pallas writes redeemers as a map**

*Claim:* The 'or' suggests a Pallas bump alone would do. It wouldn't, for three reasons:
- Core's zero-withdrawal patch writes the list itself, and it refuses a transaction whose redeemers are already a map. A Pallas that wrote maps would stop every Lovejoin mix and withdraw from building until withdraw_zero.rs changed too.
- The launch's certificate 7 and its Cert redeemer can only be core's patch. Pallas stages no certificates or withdrawals, in 0.35, 1.4 or main.
- No Pallas release writes redeemers as a map: 0.35.1 doesn't, and neither does txpipe/pallas main (latest release v1.4.0). A bump also has to move uplc with it.

*Scenario:* 1. Following the entry, a later session bumps Pallas to a release whose txbuilder writes Redeemers::Map.
2. WithdrawZero::patch bails with "The transaction's redeemers are a map, which this patch doesn't write".
3. Every mix, withdraw and session return through Lovejoin fails to build.
4. A pool's launch still writes certificate 0.

*Evidence:* - withdraw_zero.rs:104-106: `Some(Redeemers::List(list)) => list.to_vec(), Some(Redeemers::Map(_)) => { bail!("The transaction's redeemers are a map, which this patch doesn't write")`.
- withdraw_zero.rs:117: `let redeemers = Redeemers::List(MaybeIndefArray::Def(redeemers));`.
- withdraw_zero.rs header: "`pallas-txbuilder` 0.33 to 1.4 all write `withdrawals: None`".
- launch.rs:252: `Certificate::StakeRegistration(StakeCredential::ScriptHash(`.
- pallas-txbuilder-0.35.1/src/conway.rs:218: `Redeemers::List(`.
- txpipe/pallas main, pallas-txbuilder/src/conway.rs:227: `Redeemers::List(redeemers.clone())`; :254-255: `certificates: None, // TODO`, `withdrawals: None, // TODO`.
- CLAUDE.md:95: "Pallas can't stage certificates or withdrawals (… 1.4 is no different …)".
- CLAUDE.md:100: "`uplc` must be on the same Pallas".

*Fix:* "The fix is core's: `withdraw_zero.rs` and the builders' redeemers written as a map, and a launch's certificate 7 with a `Cert` redeemer, as patches, unless a later Pallas writes the map itself (with `uplc` on the same Pallas). Then a CLI release and a web wallet release, much later (the owner, 2026-10-28)."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:406`, `seedelf-platform/seedelf-core/src/withdraw_zero.rs:104`, `seedelf-platform/seedelf-core/src/withdraw_zero.rs:117`, `seedelf-platform/seedelf-core/src/lovejoin/launch.rs:252`, `seedelf-platform/CLAUDE.md:95`, `seedelf-platform/CLAUDE.md:100`

*Verified:* trace confirmed (low); impact partly (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): withdraw_zero.rs:104-117, launch.rs:252, CLAUDE.md's Pallas notes

Keeps the owner's plan (a Pallas update, much later) and adds that core's two patches change whatever Pallas writes.

## pr338#3

**low** · docs · confidence high · lane `docs-roadmap`

**'What Leios would change in the wallet' leaves out CIP-30, whose decoder refuses Dijkstra's three-element transaction shape**

*Claim:* The wallet reads a site's transaction for CIP-30 signTx, and shows it in Transaction details, with Pallas 0.35's Conway decoder. That decoder refuses Dijkstra's own three-element shape, [body, witnesses, auxiliary data], which the run saw IO's load use. It also can't read Dijkstra's new fields.

The run's README says this gap "only meets it where it reads others' from the chain". That misses CIP-30, where the transaction comes from a site, not the chain. The roadmap entry drops the point altogether.

Confidence is high on the code and medium on how much it matters, since it bites only once Dijkstra reaches mainnet.

*Scenario:* 1. Mainnet reaches Dijkstra.
2. A dApp whose library emits Dijkstra's shape asks the wallet to sign.
3. The wallet answers "The wallet can't read this transaction: unexpected type null at position 9: expected bool".
4. It can neither sign the transaction nor show its details.

*Evidence:* - cip30.rs:1029: `let tx = conway::Tx::decode_fragment(&bytes).map_err(|e| anyhow!("The wallet can't read this transaction: {e}"))?;`
- decode.rs:633: `let tx = conway::MintedTx::decode_fragment(&bytes)…`.
- Scratch test seedelf-core/tests/zz_review_pr338_1.rs (since deleted):
  - `[{0:[],1:[],2:0}, {}, true, null]` decodes.
  - `[{0:[],1:[],2:0}, {}, null]` is refused by conway::Tx and conway::MintedTx with "unexpected type null at position 9: expected bool".
- Pallas 0.35's PseudoTx has `#[n(2)] pub success: bool`.
- Branch README: "Dijkstra still takes it for a transaction sent to a node, beside its own three-element shape ([body, witnesses, metadata], which IO's load used)."

*Fix:* Add one clause to :409: "CIP-30 signing and Transaction details read a site's transaction with Pallas's Conway decoder, which refuses Dijkstra's three-element shape and its new fields."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:409`, `seedelf-platform/seedelf-web-wallet/wasm/src/cip30.rs:1029`, `seedelf-platform/seedelf-web-wallet/wasm/src/decode.rs:633`

*Verified:* trace partly (low); impact partly (low)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): cbor.ts:123/209, dapp.ts signTx/submitTx, cip30.rs:1029, decode.rs:633

The worker's own reader refuses the three-element shape first, for signTx, submitTx and a Minswap swap.

## pr338#4

**low** · release · confidence high · lane `docs-roadmap`

**HEAD's 1.7.0 list still shows items 4-7 open, and item 5's Kept-in-mind lines name Koios requests the wallet doesn't make**

*Claim:* #338 ticked item 8, which ships nothing. Items 4 (the Bootstrap half), 5, 6 and 7 still read 🚧 or ⬜, though #333, #335, #336 and #337 landed them, and their Kept-in-mind entries (:373, :374, :378-380) are still open.

That is agreed: #333 says "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit". But :379-380 name requests the wallet doesn't make (utxo_info, a batched account_info), so the release-prep commit must rewrite them, not just tick them. Also reported by pr334, its finding 3.

*Scenario:* 1. Release prep ticks items 4-7 and leaves :379-380 as they are.
2. The docs then state a Koios cost (utxo_info, account_info) for a feature that makes tx_info and account_update_history requests.
3. That goes against rule 8, which wants every feature's Koios cost stated right.

*Evidence:* - :39: "5. ⬜ **A listed pool confirmed on chain …**"; :40 "6. ⬜ …"; :41 "7. ⬜ …".
- :38: item 4 still 🚧, with only its overflow half ✅.
- :379: "one `utxo_info` per newly listed pool"; :380: "One batched `account_info` …".
- lovejoin-pools.ts:520: "`tx_info` request for every launch, and one `account_update_history` for the L its launch didn't register."
- #333's description: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."

*Fix:* In the release-prep docs commit:
- Tick items 4-7, and give item 6 the calls made (an hour, TAIL_OFFER_MS, Bring the rest back now).
- Turn :373, :374 and :378-380 into "✅ **1.7.0:**" entries, as :387-388 are.
- Rewrite :379-380 to #336's requests: tx_info per new launch, and account_update_history only for an L its launch didn't register.
- Leave item 2 at 🚧 until the owner requires the check.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:38`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:39`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:40`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:41`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:379`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:380`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:520`

*Verified:* trace confirmed (low); impact partly (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): as x-docs#0



## pr338#5

**owner-call** · release · confidence high · lane `docs-roadmap`

**Tie the Dijkstra fix to mainnet's protocol version 12, the ledger's own trigger; #338 dropped the only hint of a deadline**

*Claim:* This is my idea, not a defect. The refusal is gated on the protocol version, not on Leios. From PV 12, a node fails to decode list redeemers, so mainnet's hard fork to Dijkstra stops every script transaction the wallet builds, whether or not Leios comes with it.

#338 removed #334's "targeted for late 2026" for that fork, and HEAD now says only "much later" for the fix. Nothing records that the fork is the deadline. A fixed wallet also has to clear the Chrome Web Store's review before the fork. Also raised by pr334, its finding 4; the ledger evidence here is new.

*Scenario:* 1. Mainnet enacts PV 12 while the fix is still 'much later'.
2. Every Seedelf spend, session return, Lovejoin mix and withdraw, the collateral's mix, DEX cancel and pool launch is refused at submit.
3. Private balances and Lovejoin boxes can't move until a fixed wallet clears store review. The public account is unaffected. Nothing is lost, but nothing moves meanwhile.

*Evidence:* - cardano-ledger master, eras/alonzo/impl/src/Cardano/Ledger/Alonzo/TxWits.hs:568-577: `ifDecoderVersionAtLeast (natVersion @12) (fail "List encoding of redeemers not supported starting with PV 12") decodeListRedeemers`.
- #334's text (git show ae610284): "whose mainnet hard fork is targeted for late 2026".
- HEAD :406: "… then a CLI release and a web wallet release, much later (the owner, 2026-10-28)".

*Fix:* Owner's call. Name the trigger without a date: "due before mainnet's hard fork to protocol version 12, from which every private spend is refused". Or leave it, if the owner knows the fork is far off.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:405`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:406`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-roadmap):* **owner-call**. Test: none: owner's call

Same recommendation as pr329#8.

## pr338#6

**nit** · docs · confidence high · lane `docs-roadmap`

**The entry's fee note misses that Dijkstra makes the reference-script fee's stride and multiplier protocol parameters, which core hardcodes**

*Claim:* Line :409 names only Dijkstra's reference-input fees. Musashi's parameters also carry refScriptCostStride (25600) and refScriptCostMultiplier (1.2) as protocol parameters. Core prices reference scripts with Conway's fixed 25,600-byte tier and 6/5 step. The values are equal today, so nothing is wrong yet.

*Scenario:* 1. Governance under Dijkstra changes the stride or the multiplier.
2. Core's reference_script_fee prices every script spend with the old constants.
3. A fee priced too low is refused with FeeTooSmallUTxO.

*Evidence:* - build.rs:61-62: "How many bytes of reference script each of Conway's price tiers holds." `const REFERENCE_SCRIPT_TIER: u64 = 25_600;`.
- build.rs:88: `.map(|k| tier * 6u128.pow(k) * 5u128.pow(tiers - k))`.
- Branch musashi/protocol-parameters.json: refScriptCostStride 25600, refScriptCostMultiplier 1.2, refInputsCostPerDatumByte 0, refInputsCostPerMultiAssetPolicy 0.

*Fix:* Add to :409: "and the reference-script fee's stride and multiplier, Dijkstra's parameters, are Conway's constants in core."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:409`, `seedelf-platform/seedelf-core/src/build.rs:62`, `seedelf-platform/seedelf-core/src/build.rs:88`

*Verified:* verify confirmed (nit)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): build.rs:59-88 and Musashi's parameters

Also names maxRefScriptSizePerTx (core's MAX_REFERENCE_SCRIPT_BYTES).

## pr338#7

**nit** · docs · confidence high · lane `docs-roadmap`

**Four small figures in the entry don't match the run's records or README**

*Claim:* (a) :408 says "1.4 to 9 minutes", but the shortest wait in the records is 66 s, about 1.1 min.
(b) :408's "5.6× … 2.8×" are the four-box mix's ratios. A three-box mix, the default, comes out 6.3× and 3.1×.
(c) :407's "went four into an EB and the fifth into the next RB" reads as a five-transaction chain. It was six: a deposit and 5 mixes, of which the EB took five.
(d) :405 says seedelf-leios/ holds "a relay in Docker". The folder holds no relay; the harness drives IOG's image on the dev box.

*Scenario:* A reader quoting the entry gives the wrong lower bound for waits, the four-box ratio as the default's, and a five-transaction chain where there were six.

*Evidence:* - (a) 1793223847-chain-w3-all-depth3.json: the deposit was sent at 0.1 s and landed at 65.9 s (RB 41659, index 2).
- (b) README throughput table: "Lovejoin mix, 3 wide … 0.15 | 0.95 | 0.46" and "4 wide … 0.10 | 0.56 | 0.28".
- (c) 1793218714-chain-w4-all.json: the deposit and mixes 1-4 are in certified EB 41417; mix 5 is in RB 41418 by KleioScan.
- (d) README: "IOG's ghcr.io/…:rc-2026w43, run as leios-relay on the dev box".

*Fix:* (a) "about a minute to 9 minutes".
(b) "Ideally 5.6× (four-box) to 6.3× (three-box) mainnet's mixes a second; as Musashi ran, 2.8× to 3.1×".
(c) "a 4-wide one (a deposit and 5 mixes) went five into an EB and the last mix into the next RB's own body".
(d) "(core's builders by path, driving a relay in Docker)".

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:405`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:407`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:408`

*Verified:* verify partly (nit)

*Outcome (docs-roadmap):* **partly**. Test: none (docs): records (shortest wait 65.9 s, longest 526.2 s), README's table

(a), (b) and (c) fixed; (d) is not a bug: the parenthetical lists what the harness drives.

## x-merge#0

**medium** · money · confidence medium · lane `pools`

**A launch's copy refusal misses a pool the data layer lists but Koios hasn't confirmed (#336 × chunk 34's launch)**

*Claim:* LovejoinLaunchService.build refuses a launch whose values already have a pool, but it looks only at discovery.known() after discovery.look(). terms() builds its 'pools to join' list from known() too. Since #336, a pool on the data layer's list that's new to the device is kept only once Koios confirms its launch. While Koios can't answer, or doesn't know the launch yet, confirmed() keeps nothing new. refresh() still marks the list as answered, so look() doesn't fall back to the holder look either. Before #336, the listed pool was kept at that refresh and the copy was refused. Now the refusal and the join list are blind to it.

*Scenario:* 1. Mainnet, data layer up. Koios is down, or rate-limiting this IP (public tier, e.g. behind a VPN), or hasn't indexed the launch yet.
2. Pool P (token X, Q a box) was launched after the bundled head start, and the data layer lists it.
3. This device hasn't kept P: it was just restored, or every pool read since P was listed met Koios failing.
4. The user opens Start a pool for X at the suggested Q. The form offers no pool to join.
5. Review builds with no lj.launch.copy refusal, and Start the pool sends.
6. About 23 ₳ (reference UTxO, two scripts, stake deposit) never comes back. The new pool is a later launch of P's values, so it's never shown and takes no new box once P is known.

*Evidence:* lovejoin-launch.ts:243-250: `await this.deps.discovery.look(network); const known = await this.deps.discovery.known(network); const copy = known.find(...); if (copy) throw new Error(t("lj.launch.copy"));`

lovejoin-pools.ts:450: `await this.keep(network, await this.confirmed(network, found));`

lovejoin-pools.ts:576-582: `} catch (e) { if (isTrap(e)) throw e; standard = []; }` then `return found.filter((p) => known.has(...) || ok.has(...))`

refresh() sets `this.answered` before confirmed(), and look() returns without a holder scan while answered is within REFRESH_MS.

#336's own test (lovejoin-discovery.test.ts, 'keeps nothing new while Koios can't answer') shows known() stays [] with the data layer listing the pool. lovejoin-merged-review.test.ts:398-415 shows build refuses a copy only through discovery.known.

*Fix:* Keep the data layer's last list, verified offline but not yet Koios-confirmed, in discovery's memory beside known(). Have build's copy check and terms()' join list read it as well. A lying server could then cause only a false copy refusal, never a confirmed pool. The copy refusal is the owner's existing design (design session 1's 11/14), so widening its input isn't a new guard. Refusing with 'try again later' while Koios can't confirm would be a new refusal, so that is the owner's call.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:243`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:211`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:450`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:568`

*Verified:* trace confirmed (medium); impact confirmed (medium)

*Outcome (pools):* **fixed**. Test: tests/lovejoin-merged-review.test.ts > 'a start of the values of a pool the data layer lists, before Koios confirms it (1.7.0's release review, x-merge#0)' > 'is refused as a copy, though the pool isn't read or offered to join till Koios confirms it'. Before the fix, the build got past the copy check and failed at the next one ('Each box needs at least 3.88 ₳'); now it is refused with lj.launch.copy. Also tests/lovejoin-discovery.test.ts > 'holds the data layer's last list for a launch's copy check…', which failed before because lastListed didn't exist.

The copy check in LovejoinLaunchService.build now also reads discovery.lastListed(network): the data layer's last list, verified offline, kept in worker memory. Each answer replaces it and nothing clears it, so the data layer going down doesn't reopen the gap. It is never handed to a pool read. terms() and status.pools are unchanged: terms().pools is read by no screen, and an unconfirmed pool must never be shown. The discovery dep takes lastListed as optional, so the stubs in other lanes' files compile unchanged. This restores 1.6.0's input to the refusal, with no new words, key or request. A lying server could now cause a false copy refusal, never a kept pool.

## x-merge#1

**low** · correctness · confidence high · lane `traps`

**The alarm's run still drops a trap under a session's chain pump and settleReturns, and dapp.ts watchFunding drops one too**

*Claim:* runAll runs each non-stepped session's chain pump, and each return's settling, with .catch(() => undefined), so runs.ts' unlessTrap never sees a trap from them. pump's own catch first records the trap's raw message as the chain's stop reason (session record and Lovejoin record), then drops the pending chain. dapp.ts starts `void this.watchFunding(...)`, which calls WebAssembly through sessions.siteAccount, and its bare `catch {}` answers the site SITE_TRAPPED without locking.

architecture.md:53, as #330 rewrote it, says the worker's runs 'lock the wallet on a trap from any step' and that only 'the three runs a page's request starts and doesn't wait for' needed unawaited. #337's skip pumps the same chain and does hand a trap on, so the same trap locks under the button but not under the alarm. #332's premise, that a core overflow now traps and locks rather than wraps, doesn't hold on these paths.

This is pre-existing. 1.6.0's fixes/fx-cut-2.md noted 'runAll swallows a trap on the alarm's path ... (and pump, markCut)', but it was never carried into post-release-roadmap.md.

*Scenario:* A site's private session's return goes through Lovejoin, and its chain is pending in session storage. At the alarm's next run, a WebAssembly call under its pump traps: verifiedPool in watchOf's quiet readSet, or tailWitness' declaredCovers/finishLovejoinWithdraw. The result:
- the wallet stays unlocked on the broken instance;
- the chain is recorded as stopped with 'unreachable', in every language, and the Lovejoin page's chain list shows 'Why it stopped: unreachable';
- the pending chain is dropped.
The same trap under 'Bring the rest back now' would lock the wallet.

*Evidence:* sessions.ts:3368: `if (await this.pendingChain(network, s.index)) await this.serial(() => this.pump(network, s.index)).catch(() => undefined);`

sessions.ts:3377: `await this.serial(() => this.settleReturns(network, s.index)).catch(() => undefined);`

sessions.ts:5054-5061: `const why = e instanceof Error ? e.message : String(e); ... s.chain.stopped = why; ... chainEnded(network, id, why, ...)`

dapp.ts:1473-1476: `} catch { done(() => w.reject(siteError(APIError.InternalError, SITE_TRAPPED))); }`

Scratch test (chain-fixtures: withSession, backBuild, backSubmit; t.lovejoin.watchOf throwing WebAssembly.RuntimeError('unreachable'); runAll as runs.ts calls it) printed `{"watchOfCalls":1,"handedOn":"undefined","state":"unlocked","stopped":"unreachable"}` and `{"pendingAfter":"dropped"}`.

*Fix:* In runAll's pump and settleReturns loops, catch with `(e) => { if (isTrap(e)) throw e; }`. In pump's catch, rethrow a trap before anything is recorded, as step does: the lock then cuts the chain (cuts, CHAIN_CUT) rather than recording 'unreachable'. In watchFunding's catch, call wallet.trapped() on isTrap(e). Alternatively, narrow architecture.md:53 to what holds and track the gap in Kept in mind.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3368`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3377`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5053`, `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1424`, `seedelf-platform/seedelf-web-wallet/extension/src/background/dapp.ts:1473`, `seedelf-platform/seedelf-web-wallet/docs/architecture.md:53`

*Verified:* trace partly (low); impact partly (low)

*Outcome (traps):* **fixed**. Test: tests/session-trap.test.ts, describe "WebAssembly that traps under the alarm's run, as a chain or a return nothing steps comes back". Three tests failed before the fix and pass now: "locks the wallet when a site's return's chain traps as the alarm sends more of it, and the chain reads as a lock cut it" (before: wallet unlocked, chain stopped "unreachable"); "locks it when a chain traps under a mix's own step, the chain cut by the lock, not stopped for the trap's raw word" (before: stopped "unreachable"); "locks it when the look for a site's return, its history still to write, traps" (before: unlocked). A fourth guard test, "keeps a chain's other failures as they were...", passes before and after. In a copy outside the tree, removing either half of the fix fails its own tests.

Fixed the sessions.ts half. runAll's pump loop and settleReturns loop now hand a trap on (a local unlessTrap) to runs.ts, which locks; any other failure is still swallowed. pump's catch now rethrows a trap before recording anything, so the lock wipes the progress and the chain reads as CHAIN_CUT, never "unreachable". This holds on every pump path: alarm, step, backSubmit, skip. The dapp.ts watchFunding half is not a bug, so it's unchanged. All of its WebAssembly runs inside wallet.withKeys, and a scratch test confirmed the wallet locks by trap and the site hears SITE_TRAPPED. Related gap left unfixed, outside my functions: claimSubmit's per-return catch also swallows a trap (narrow reach); recommend `if (isTrap(e)) throw e;` there.

## x-merge#2

**low** · ux · confidence high · lane `tail`

**For a session brought back by hand, 'Bring the rest back now' only ends the wait; the docs and the stop reason say the rest came back**

*Claim:* skipCollateralMix marks the tail over, stops a chain still being sent, then calls advance(). step returns at once for a session that isn't running(), which requires s.auto. So for a site's session or a hand-run swap, nothing builds or sends the return: the rest waits at the account for 'Bring it back' and its review. #337's own test builds the return by hand after the skip (sessions.backBuild). Yet flows.md:522 says 'and the rest comes back directly', and the chain's stop reason, shown on the Lovejoin page's chain list, says 'You brought the rest back without waiting for the collateral's mix, so the chain stopped there.'

*Scenario:* A site's session's return has waited on giveme.my for over an hour. The user presses 'Bring the rest back now' on the site's page and assumes the money is on its way. It stays at the one-time account until they also press 'Bring it back' and send its review. Meanwhile the Lovejoin page says they brought it back.

*Evidence:* sessions.ts:1230-1231: `function running(s) { return !!s.auto && !s.closedAt && !s.auto.paused && !s.auto.failed; }`

sessions.ts:3219-3224: advance → step, and step does `if (!s || !running(s)) return;`

The lovejoin-planner.test.ts skip test ends with `const back = await sessions.backBuild("preprod", 0);`

flows.md:522: '...and the rest comes back directly'

en.json lj.tail.skipped: 'You brought the rest back without waiting for the collateral's mix, so the chain stopped there.'

*Fix:* The words are the owner's call:
- flows.md: 'by itself for a swap or a mix; at Bring it back for a session brought back by hand';
- lj.tail.skipped: a neutral reason that doesn't say the rest came back;
- or, on by-hand pages, open the return's review right after the skip.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5526`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1230`, `seedelf-platform/seedelf-web-wallet/docs/flows.md:522`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:965`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (tail):* **fixed**. Test: same tests as pr337#1 (duplicate)

Duplicate of pr337#1. Its auto-path coverage gap is covered by the planner test "brings a mix's rest back directly in the press's own request…".

## x-merge#3

**low** · docs · confidence high · lane `docs-design`

**privacy.md doesn't mention the new user-chosen way out, which leaves the 5 ₳ box unmixed**

*Claim:* privacy.md:217 says the collateral's box waits unmixed, tied to the session, only 'past that, or a day after the deposit landed'. #337 adds a user-chosen end from an hour after the deposit landed, with the same outcome. #337 updated architecture.md and flows.md but not privacy.md, the design doc for this ground (rule 3). The store policy describes no wait, so it needs no entry.

*Scenario:* Someone reading the design doc for when a session's collateral box is left unmixed concludes it happens only after a day. The user can now cause it after an hour.

*Evidence:* privacy.md:217: '...past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session as any deposit's box is, and Mix my boxes again takes it first.' There is no mention of Bring the rest back now or TAIL_OFFER_MS. git diff 11e249d2^1 11e249d2 --stat doesn't touch privacy.md.

*Fix:* Add one clause: 'or, from an hour after the deposit landed, when the user brings the rest back without it (Bring the rest back now)'.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/privacy.md:217`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **fixed**. Test: docs-only: as x-docs#8

Duplicate of x-docs#8; same edit.

## x-merge#4

**low** · docs · confidence high · lane `docs-roadmap`

**The 1.7.0 list and Kept in mind are stale after #333, #335, #336 and #337, and #336's planned request names differ from what was built**

*Claim:* Item 4 is still 🚧 with only the overflow half ticked, and items 5, 6 and 7 are ⬜. The Kept in mind entries at :373-374 and :378-380 are still written as open. :379 and :380 describe requests that weren't built ('one utxo_info', 'one batched account_info'): #336 asks tx_info (20 a request) and account_update_history, as privacy.md and the policy correctly say. #333's PR body says the ticks wait for the release-prep docs commit, so this is a reminder for that commit.

*Scenario:* The owner, or the release-prep author, reading the roadmap at HEAD sees items 5–7 as not started, and could copy the planned utxo_info/account_info wording into the release record.

*Evidence:* post-release-roadmap.md:42-45: '4. 🚧 ...', '5. ⬜ ...', '6. ⬜ ...', '7. ⬜ ...'

:379: 'one `utxo_info` per newly listed pool'

:380: 'One batched `account_info`'

lovejoin-pools.ts launched(): koios.launches (tx_info) and koios.firstRegistrations (account_update_history).

*Fix:* In the release-prep docs commit:
- tick items 4, 5, 6 and 7;
- mark :373, :374 and :378–380 done, as #330 and #332 did theirs;
- name #336's real requests;
- add finding 2's trap gap to Kept in mind if it isn't fixed.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:41`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:373`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:379`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): as x-docs#0; sessions.ts claimSubmit read in W

x-merge#1's trap gap is fixed by the traps lane; the claimSubmit gap still open in W is recorded as Left in item 3's entry (drop it if the lead adds the rethrow).

## x-overflow#0

**medium** · correctness · confidence high · lane `rust`

**A pool row the data layer lists with its NFT twice traps the store module at every pool list refresh: eval::resolve's unchecked += is a trap since #332**

*Claim:* resolve() is behind every resolve_row and resolve_reference. It adds each asset_list entry's quantity into a BTreeMap entry with a plain +=.

#332 made core's arithmetic checked in the store module. A row that names one token twice, with quantities summing past 2^64−1, now panics there: unreachable, isTrap, the wallet locks.

This is the only unchecked token sum left in core on rows from outside. utxos::assets_of and cip30's Amount refuse the same row in words.

Pool verification reaches it first, before any checked pass. protocol_of calls resolve_row(&pool.reference) (wasm lovejoin.rs:114), and resolve_reference for the script rows (166). The data layer's list arrives through isRow, which checks shape only, and utxoOf, which passes assets verbatim.

The chain can't produce such a row: db-sync and Koios list each asset once per output. It takes a data layer that lies, or a bug in it. That is the threat the pool list is built against: "each verified here again", plus #336's Koios confirmation in this release.

Before #332 the store build wrapped the sum: 2^64−1 + 2 is 1, so the doubled NFT read as one and the pool verified.

*Scenario:* Mainnet, data layer on (the default). The data layer's lovejoin/pools answer lists a pool with reference.assets = [[P,"6c6f76656a6f696e","18446744073709551615",0],[P,"6c6f76656a6f696e","2",0]].

Any pool read triggers PoolDiscovery.refresh → lovejoinVerifyPool → RuntimeError: unreachable. That includes the Lovejoin page's status, a swap review's room read, a run with a chain open, and a restore's copies read.

tried, serviceDeps.pools and readSet hand the trap on, so wallet.trapped() locks the wallet, under a page's request or a run alike.

- A device that kept a list before asks again after REFRESH_MS (5 min) or a worker restart, and locks again.
- A new or restored device has no `listed` in its record, so it asks again at every pool read (lovejoin-pools.ts:415). Opening Lovejoin locks it every time.

It stays that way until the user finds Settings' Koios-only.

*Evidence:* eval.rs:148–152: `*tokens.entry(hex::decode(&asset.policy_id)?).or_default().entry(hex::decode(&asset.asset_name)?).or_default() += quantity;`

wasm lovejoin.rs:114: `let reference = seedelf_core::eval::resolve_row(&pool.reference)?;`

private-index.ts:401: `asset_list: (row.assets ?? []).map(([policy_id, asset_name, quantity, decimals]) => ...` (isRow, 148–152, checks only that the entries are strings).

Scratch tests, now deleted:
- core, debug build: `eval::resolve_row: Some(("attempt to add with overflow", "seedelf-core/src/eval.rs:148"))`, while `utxos::assets_of: Err("Can't Add Assets: Can't Add Asset To Assets: Asset addition overflow")`.
- seedelf-wasm `lovejoin::verify_pool` on the pool as refresh builds it: panic at eval.rs:148. The NFT once → Ok. Twice as 1+1 → Err("It doesn't hold one Lovejoin NFT and ADA alone").
- Extension Vitest with the store module wasm/pkg through PoolDiscovery and serviceDeps(...).pools over a fake data layer:
  - `kept device, refresh: RuntimeError: unreachable isTrap: true`
  - `within REFRESH_MS: no trap`
  - `after REFRESH_MS: RuntimeError: unreachable isTrap: true`
  - `fresh device, read 1/2/3: RuntimeError: unreachable isTrap: true asked: 1/2/3`

*Fix:* In resolve(), add with checked_add and refuse in words, e.g.
```
let held = tokens.entry(..).or_default().entry(..).or_default();
*held = held.checked_add(quantity).with_context(|| format!("UTxO {}#{} holds more of a token than an output can", row.tx_hash, row.tx_index))?;
```
protocol_of then fails, and tried leaves the pool out, as it does any pool that doesn't verify.

That one change covers every resolve_row and resolve_reference caller. It is not a guard on the user: the ledger can't make such a row.

The same class at lower stakes: apart's lovelace sums (build.rs:2669, 2677, 2722) are unchecked too. Only an index reporting the user's contract UTxOs past 2^64 lovelace together reaches them, and only in a private send the user starts: one lock, not a loop.

*Files:* `seedelf-platform/seedelf-core/src/eval.rs:148`, `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:114`, `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:166`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:443`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:459`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:415`, `seedelf-platform/seedelf-web-wallet/extension/src/background/private-index.ts:401`, `seedelf-platform/Cargo.toml:51`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (rust):* **fixed**. Test: seedelf-core/tests/eval_test.rs a_row_naming_a_token_past_what_an_output_holds_is_refused_in_words (panicked at eval.rs:148:9 before, passes now); seedelf-core/tests/orders_test.rs a_reference_row_naming_a_token_past_what_an_output_holds_is_refused_in_words (the cancel's Koios reference row; panicked in resolve with the fix reverted, passes now); node test wasm/tests/lovejoin-pools.test.mjs 'a pool row naming its NFT twice…' (RuntimeError: unreachable on today's pkg; needs the lead's rebuild)

resolve() sums a row's token quantities with checked_add, refusing 'UTxO <hash>#<i> holds more of a token than one output can'. Covers every resolve_row/resolve_reference caller: pool verification, candidate, launch_check, measure_locally (buildRemove) and the cancel's reference row at orders.rs:793. The extension's tried/verifiedPool already leave out a pool refused in words, so no TS change.

## x-overflow#1

**low** · docs · confidence high · lane `rust`

**The docs say seedelf-wasm's sums on amounts are checked by hand (checked_add); most are plain + and .sum() that wrap in the store build**

*Claim:* CLAUDE.md:94 says seedelf-wasm's "sums on amounts are checked by hand (`checked_add`)". post-release-roadmap.md:387 says they "stay checked by hand (`checked_add`), as 314-core#1's are".

Only cip30.rs's Amount (136–152) and chain_from_account_at's `needed` (lovejoin.rs:2160) are checked. These are plain + or .sum(), which the store module leaves unchecked:
- Holdings::spare (lovejoin.rs:847–848)
- `total +=` (2127, 2178)
- owned_in's `boxes.len() as u64 * protocol.denom` (2490)
- `fees +=` (1866, 1871, 2272, 2413)
- holding_enough (lib.rs:3632–3635)
- Worth::apart's total (3766)

Each sums lovelace, which the ADA supply bounds (400× under 2^64), or real boxes. Token sums there are u128 or saturating. So no ledger value wraps today, but the docs claim a property the code doesn't have.

*Scenario:* A later change in seedelf-wasm sums a session's or the balance's token quantities in u64 with +. Because CLAUDE.md says this crate's sums are checked by hand, nobody asks for a check.

Three UTxOs of 2^63−1 of one token, which anyone can send to a session or a Seedelf, wrap that sum to a small false figure in the store build, unseen. Every test build would have panicked instead.

*Evidence:* CLAUDE.md:94: "...but not in `seedelf-wasm`: on the module's own crate the checks double the module, so its sums on amounts are checked by hand (`checked_add`)."

lovejoin.rs:847–848: `self.coins.iter().map(|(c, _)| c.lovelace).sum::<u64>() + self.tokens.iter().map(|(h, _)| h.lovelace).sum::<u64>()`

lovejoin.rs:2490: `lovelace: (boxes.len() as u64 * protocol.denom).to_string(),`

lib.rs:3632–3635: `let held: u64 = utxos.iter().map(|u| u.value.parse::<u64>().unwrap_or(0)).sum();`

*Fix:* Reword both docs to match the code: seedelf-wasm checks by hand (`checked_add`) where a sum can pass a u64, as cip30's Amount and a public chain's funding do. Its lovelace sums are bounded by the ADA supply, and its token sums are u128 or checked. A new u64 sum on token quantities must be checked.

*Files:* `seedelf-platform/CLAUDE.md:94`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:387`, `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:847`, `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs:2490`, `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:3632`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (rust):* **fixed**. Test: Docs only; the claim was checked against seedelf-wasm. Plain sums add lovelace/fees/counts (holding_enough, Worth::apart via adds, Holdings::spare, total +=); token totals are u128 (quantity_of, held, gone); checked by hand only in cip30 Amount and chain_from_account_at's needed.

CLAUDE.md and roadmap:387 now say seedelf-wasm checks where a sum can pass a u64, its other sums add counts, fees or lovelace (bounded by the ADA supply), its token totals are u128, and a new u64 token-quantity sum must be checked.

## x-priv#0

**low** · privacy · confidence high · lane `docs-design`

**The policy's and the store listing's summary lines still say Koios is only a mainnet fallback, though #336 asks it while our server answers**

*Claim:* #336's confirm (lovejoin-pools.ts `confirmed` via `koiosAlone()`) deliberately asks Koios on mainnet while the data layer answers. The policy's pools paragraph (:46) and its 28 October entry (:93) disclose this. The summary lines that define Koios's role on mainnet don't, and the store's Koios host row now describes the opposite case.

*Scenario:* A mainnet user with the data layer up, Koios-only off, reads the policy's In short or the store listing: Koios is a fallback for what our server can't answer. A new token pool is listed. Their first pool read sends Koios a `tx_info` naming its launch, from their IP, telling Koios this IP uses Seedelf Wallet's Lovejoin. A Web Store reviewer reading the Koios host justification is told the same fallback story.

*Evidence:* privacy-policy.md:5: "To work, the extension also talks to Koios, a public Cardano API: on preprod for everything, and on mainnet for anything our server can't answer, or for everything if you turn our server off in Settings."
privacy-policy.md:40: "Koios (...): everything on preprod, and on mainnet whatever ours can't answer, or everything with that switch on."
store/README.md:261 (Koios host row): "...the new pools at Lovejoin's reference holder (the transactions that started them and their scripts' registrations) while its own server hasn't listed them ... Even while its own server answers, Koios is asked what made the user's boxes in a later pool of the same box value as one shown, which that server doesn't cover."
:269: "and for one Lovejoin read its server doesn't cover."
:274: "Koios is the fallback".
:334: "Koios (api.koios.rest on mainnet when that server can't answer...)".
:75/:163/:227: "on mainnet for anything ours can't answer" (en/es/ja).
Against the code: lovejoin-pools.ts:454 `await this.keep(network, await this.confirmed(network, found));` and :570 `const koios = this.deps.koios(network).koiosAlone();`.

*Fix:* Name the confirm in each line. Policy :5 and :40, for example: "...and on mainnet for anything our server can't answer and to confirm a new Lovejoin pool it lists...". README:261: add "and, even while its own server answers, the transaction that started each pool that server lists that the device hasn't seen, and its script's registration", and fix "while its own server hasn't listed them". README:269: "two Lovejoin reads"; it's at 996 of about 1,000 characters, so trim elsewhere. README:274 and :334 to match. The description in all three languages. README:289 (financial information) stays as it is: the confirm sends nothing of the user's.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:5`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:40`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:75`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:163`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:227`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:261`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:269`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:274`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:334`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **fixed**. Test: docs-only: as x-docs#2; the finding's proposed test dropped, as its impact verifier advised

With the verifier's corrections: merged box reworded and recounted, README:266 counts, development.md item 9, and the critical key settings.koiosOnly.privacy.off (said Koios 'only when it can't'). Provenance set mtpe -> machine pending the lead's blind back-translation.

## x-priv#1

**low** · privacy · confidence medium · lane `docs-design`

**A launcher's device is likely the first to ask Koios about its own new pool; the new entry says the request names nothing of yours**

*Claim:* The launcher's device finds its own pool only through discovery, by design, so as not to single out its IP. Since #336, finding a pool on the data layer's path means asking Koios `tx_info` naming its launch, at the device's first pool read after the listing. The hub tells the launcher to look about 10 minutes after the block; other devices ask whenever they next read pools. So Koios, a third party, likely gets the first pool-named request about a new pool from its launcher's IP, minutes after the block. That hints who started a pool even where the chain hides the payer (a launch from the private balance). Before #336, on mainnet with our server up, no third party got a pool-named request from the launcher. The same timing existed only on the Koios holder look (preprod, Koios-only), where Koios had sent the launch itself.

*Scenario:* A user starts a token pool from their private balance on mainnet: a Seedelf spend under giveme.my's collateral, submitted through our server, so the chain doesn't show who paid. About 10 minutes later they reopen the Lovejoin page, as "shows here once a look finds it, about 10 minutes after its block" invites. The hub's read refreshes `lovejoin/pools`, which now lists the pool, and `confirmed` sends Koios `tx_info` for its launch from their IP. Few other devices read pools in that window, so Koios sees the launcher's IP ask first and can tie it to the launch, its Seedelf inputs and its change.

*Evidence:* lovejoin-launch.ts:6-9: "...every wallet finds it there (lovejoin-pools.ts), this one too. None is read sooner from the launcher's own record, which would single out the launcher's IP (§3)."
lovejoin-pools.ts:565-584 `confirmed`: `const fresh = found.filter((p) => !known.has(refOf(p.ref.reference)));` … `await this.launched(network, koios, fresh.map(...))` → `koios.launches([...tx hashes])` (:527).
en.json:1277: "A pool you started ({{when}}) shows here once a look finds it, about 10 minutes after its block."
privacy-policy.md:93: "The same request for every wallet, only for pools new to the device, naming nothing of yours; Koios sees it from your IP address, so it can tell you use Lovejoin."
privacy.md:200: "Koios's requests name pools every wallet reads, never one of the wallet's".
The token-pools plan's §3 (archive/plans/chunk-34-token-pools.md:307): "No read names your pool."

*Fix:* The owner's call, one of:
(a) Disclose it. The 28 October entry and privacy.md:200 say that for a pool you started, this device asks Koios about it too, usually first, which can tell Koios you started it. Reword "the same request for every wallet" to "for every device that hasn't seen that pool".
(b) Skip the Koios confirm for a pool whose launch the device's sealed `lovejoin.<network>` launch record shows it sent. The pool still joins only once the data layer lists it, so nothing is read sooner; only the Koios ask is dropped.
(c) Wait a random while before a first confirm.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:454`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:565`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-launch.ts:8`, `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:1277`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:93`, `seedelf-platform/seedelf-web-wallet/docs/privacy.md:200`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **partly**. Test: docs-only: DiscoveryDeps has no launch input; launches live only in the sealed Lovejoin record; the sent page says the pool shows about 10 minutes after its block

Disclosed (the finding's option a) so the unreleased 28 October entry and :46, privacy.md :200/:203 are true for what ships. Skipping Koios for the device's own launch is the owner's call.

## x-priv#2

**low** · perf · confidence high · lane `pools`

**A new pool's Koios confirm holds every pool read on the data layer's path until Koios answers or gives up (about 91 s on a hung Koios)**

*Claim:* `refresh` awaits `confirmed`, and every non-quiet pool read awaits `refresh` through `serviceDeps.pools`. That includes the Lovejoin hub's first read (`status` → `ours` → `readSet`), a swap's review, a mix, a Bootstrap form and a session's return. The confirm uses the real Koios client: a 45 s read timeout, one retry after a timeout (45 + 1 + 45 s), or 429 holds of up to 60 s each. So while a listed pool is new to the device and Koios is slow or unreachable, the first pool read of each 5-minute window waits about 91 s, or up to about 2 minutes, before going on with the pools already held. Before #336, the data layer's path never waited on Koios for the pool list.

*Scenario:* Mainnet, data layer up. Koios is hanging: overloaded, silently blocked on the user's network, or a VPN exit sharing Koios's per-IP tier gets 429s. A new token pool appears on `lovejoin/pools`. The user opens the Lovejoin page and its first read spins for about 91 s; a swap's Review that reads the pools waits the same. Five minutes later, again, until Koios answers.

*Evidence:* lovejoin-pools.ts:454 `await this.keep(network, await this.confirmed(network, found));`.
:598 `await discovery.refresh(network).catch(...)` inside `pools`.
lovejoin.ts:3130 `const pools = await this.readSet(network);` in `ours()`, which `status` calls.
koios.ts:429 `const TIMEOUT_MS = 45_000;`, :421 `const RETRY_DELAYS_MS = [1000, 3000];`, :1345 `signal: AbortSignal.timeout(this.backend.readTimeoutMs)`, :1373 `const delays = slow ? RETRY_DELAYS_MS.slice(0, 1) : RETRY_DELAYS_MS;`.
Scratch test tests/zz-review-x-priv-1.test.ts (deleted): with Koios's `tx_info` held by a gate, `serviceDeps(found).pools("preprod")` was still pending after `index.calls == ["lovejoin/pools"]` and Koios had been asked `["tx_info"]`, and resolved only once the gate opened.

*Fix:* Don't hold the read on it. Either start `confirmed` without awaiting it in `refresh` and keep what it confirms for the next read (the pools already held are read meanwhile, as the PR's "waits for the next list" intends), or give the confirm its own client with a short read timeout and `retries: false`.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:454`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:596`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:3130`, `seedelf-platform/seedelf-web-wallet/extension/src/background/koios.ts:1345`, `seedelf-platform/seedelf-web-wallet/extension/src/background/koios.ts:1373`

*Verified:* trace partly (low)

*Outcome (pools):* **fixed**. Test: Same test as pr336#1: tests/lovejoin-discovery.test.ts > 'holds no pool read while Koios checks a pool new to the device… (1.7.0's release review, pr336#1, x-priv#2)'. It failed before with the read held ('held up') and passes now.

Same fix as pr336#1: no pool read waits for the Koios check; only a look does. The hub's status read, swap reviews, mixes, Bootstrap forms, session returns and the alarm's runs all go on with the pools already kept.

## x-priv#3

**low** · ux · confidence medium · lane `tail`

**#337's critical privacy line says the collateral's mix "is still waiting for giveme.my" in states where the same page says the wait is the 5 ₳ pool**

*Claim:* `tailHeld` offers the way out under `tailWaits`, where the mix waits for giveme.my, and also under `tailBuildable`: the chain ended (a lock, a giveme.my refusal, a drawn box gone) and the mix may be built again. In the latter, the return's `tailChain` answers "noPool" or "fewBoxes", and the session's page shows that reason. From an hour after the deposit landed, the new callout tells the user giveme.my is the wait.
The callout's privacy half is accurate. The box at its deposit is tied to the session's one-time account, matching the policy ("can be tied to the session until it's mixed, as any box at its deposit can") and the existing "tied to this session" strings. Through the session it's tied only to what the session already is: its funding's private UTxOs and the rest's sweep.

*Scenario:* A swap's return through Lovejoin. The collateral's deposit lands, and a lock cuts the chain before the mix. At the unlock, the 5 ₳ pool has too few free boxes, so the swap's retry line reads "Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free for its collateral's mix yet…". An hour after the deposit, the same page adds "The collateral's mix is still waiting for giveme.my. Bring the rest back without it…".

*Evidence:* en.json:922: "lj.tail.privacy.wayOut": "The collateral's mix is still waiting for giveme.my. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."
en.json:915-916: the fewBoxes and noPool reasons.
lovejoin.ts:4131: `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`.
:4041: `if (!pool?.ref) return "noPool";`.
:4082: `... return "fewBoxes";`.
sessions.ts:4390: `if (typeof resumed === "string") throw new Error(tailWaiting(resumed));`.
Swaps.tsx:3205 shows the retry reason; Swaps.tsx:2513/2567 render `CollateralHeldWayOut`.

*Fix:* Drop the cause ("The collateral's mix hasn't gone yet."), or let `collateralHeld` carry why it's held and pick the sentence from it. It's a critical key, so re-run the blind back-translations and record them in verified-critical-{es,ja}.json.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:922`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4131`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4041`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4082`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4390`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (tail):* **fixed**. Test: tests/lovejoin-planner.test.ts > "says the collateral's mix hasn't gone, never that giveme.my is what it waits for, where it waits for the 5 ₳ pool's boxes (…)" (failed on HEAD: the line named giveme.my while the return waited on fewBoxes) and tests/collateral-held.test.ts > "names no cause of the wait in any language, and keeps 5 ₳ whole" (HEAD's en, es and ja all fail it)

lj.tail.privacy.wayOut's first sentence is now "The collateral's mix hasn't gone yet." (es "La mezcla del colateral aún no se ha hecho.", ja "コラテラルのミックスはまだできていません。"). It is true in every held state, and the privacy clause is unchanged. Critical key: es and ja need a blind back-translation.

## x-priv#4

**low** · docs · confidence high · lane `docs-design`

**architecture.md and lovejoin-pools.ts comments still say a listed pool's being on chain and finished is the server's word, with no mention of the Koios confirm or its cost**

*Claim:* #336 updated privacy.md and the policy, but not architecture.md. Its discovery paragraph says the data layer's list is taken on the server's word for being finished, and leaves being on chain to the ledger. The network section's token-pools bullet doesn't mention the Koios confirm or its Koios cost (rule 8). The file header and refresh's inline comment say the ledger is the judge.

*Scenario:* A maintainer reading architecture.md to change discovery, or to count mainnet's Koios requests, misses that the data layer's path now asks Koios at a pool read, and when.

*Evidence:* architecture.md:732: "...that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below). Whether a pool is on chain at all is the ledger's to judge, not the server's..."
architecture.md:287: "`lovejoin/pools` is the shown pools' list (`lovejoin-pools.ts`)."
lovejoin-pools.ts:33-35: "Verified offline, a pool may still not be on chain ..., so the ledger is the judge of that".
:436-437: "That the pool is on chain at all, the ledger checks".

*Fix:* Add to :732 and :287: a pool new to the device on the data layer's list is kept only once Koios confirms it (`confirmed`: its launch's `tx_info`, and `account_update_history` where the launch didn't register L), at the first refresh after it's listed and at each one after until Koios answers. Its cost: one `tx_info` per 20 new launches and one `account_update_history` per 75 Ls. Where its launch sits stays the server's word, since `confirmed` keeps the list's own `launch`. Update the two comments.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/architecture.md:732`, `seedelf-platform/seedelf-web-wallet/docs/architecture.md:287`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:31`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:436`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **fixed**. Test: docs-only: as x-docs#3

architecture.md :288 and :733. The lovejoin-pools.ts comments and the test comment (lovejoin-discovery.test.ts:302) were already fixed by the pools lane.

## x-priv#5

**low** · docs · confidence high · lane `docs-design`

**privacy.md and flows.md trail #337's way out and #333's priced reserve (flows.md still gives 68 boxes at 6,465 lovelace a byte)**

*Claim:* privacy.md, the design doc for this ground, ends the collateral mix's wait only at the day's end; #337 lets the user end it from an hour after the deposit landed, with the same outcome. privacy.md:198 says a private Bootstrap's way back is 1.5 ₳; #333 prices it from the parameters (at least 1.5 ₳, 1.8 ₳ at 6,465 lovelace a byte). flows.md:523 still says the cap is 68 classic boxes at 6,465 lovelace a byte, which #333 raised to 96, and gives the reserve as 1.5 ₳.

*Scenario:* A reader of privacy.md doesn't learn that the user can leave the 5 ₳ box unmixed after an hour. A reader of flows.md expects a 68-box cap and a 1.5 ₳ reserve at a dearer byte. The review row itself shows the computed figure (Lovejoin.tsx:3798), so only the docs are off.

*Evidence:* privacy.md:217: "...past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session as any deposit's box is, and Mix my boxes again takes it first."
privacy.md:198: "...1.5 ₳ for the deposit's fee and change, and 1.5 ₳ for its way back..."
flows.md:523: "...one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)... one *For returning the rest* (1.5 ₳, and what it doesn't use comes back)".
wasm/README.md:69 (updated by #333): "never less than 1.5 ₳ ... 1.8 ₳ at 6,465 lovelace a byte".

*Fix:* privacy.md:217: add "or once its page's Bring the rest back now is pressed, from an hour after the deposit landed (1.7.0)". privacy.md:198: "at least 1.5 ₳ for its way back, priced from the network's fees". flows.md:523: the cap at 6,465 lovelace a byte is now 96 (64 in a token pool), and the reserve is priced from the parameters, at least 1.5 ₳.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/privacy.md:217`, `seedelf-platform/seedelf-web-wallet/docs/privacy.md:198`, `seedelf-platform/seedelf-web-wallet/docs/flows.md:523`

*Verified:* trace confirmed (low); impact confirmed (low)

*Outcome (docs-design):* **fixed**. Test: docs-only: as x-docs#1 and x-docs#8

Duplicate of x-docs#1 and x-docs#8.

## x-priv#6

**owner-call** · docs · confidence high · lane `docs-design`

**The privacy policy's Effective date and its 28 October entry follow #336's merge day, not 1.7.0's release**

*Claim:* #336 set "Effective 28 October 2026" and dated its entry 28 October, the day #336 merged. 1.6.0's policy was dated its release PR's merge day: ef6af2bc, "1.6.0's privacy policy dated the merge day", the owner's "make the merge day today"; #324 merged 2026-10-26 19:44 PDT. 1.7.0 ships as small PRs on main, and the store and Settings link main's policy. So since #336 merged, the policy has described the Koios confirm while the store still serves 1.6.0, which doesn't make it: over-disclosure, and harmless. #336's description flags this for the owner.

*Scenario:* 1.7.0's release-prep commit lands on a later day. The policy then reads Effective 28 October for a behaviour first shipped that later day. Meanwhile 1.6.0 users reading main's policy see a Koios confirm their version doesn't make.

*Evidence:* privacy-policy.md:3: "**Effective 28 October 2026** (... and a new Lovejoin pool confirmed with Koios: see *Changes*)".
:91: "we'll update this page and its date, and list the change under Changes below, before the new version ships."
:93: "- **28 October 2026:** on mainnet, a Lovejoin pool our server lists...".
Git: f40ed2fc 2026-10-28 10:59 -0700 is the policy's only commit in the range; ef6af2bc 2026-10-26 19:06 -0700 is inside 1.6.0.
store/README.md:9: "The privacy policy is privacy-policy.md on `main`."

*Fix:* The owner decides: keep 28 October, or re-date the Effective line and the entry to 1.7.0's release-prep merge day.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:3`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:91`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:93`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **owner-call**. Test: none (owner's call)

Dates untouched; recommendation in owner_calls.

## x-ui#0

**low** · ux · confidence high · lane `tail`

**#337's way-out line says the mix 'is still waiting for giveme.my' where it's waiting for the pool's boxes, beside the page's own reason saying so**

*Claim:* tailHeld offers the way out in two states:
- tailWaits: the mix waits for giveme.my's signature;
- tailBuildable: the chain has ended, and the mix is to be built again, which waits on the pool (lj.tail.fewBoxes or lj.tail.noPool) for up to a day.

The critical line's first sentence names only giveme.my. In the second state it contradicts the reason the same page shows, as on the swap page's retry line, the mix card's detail, or the site page's Bring it back error. flows.md itself says the offer covers both states ('for giveme.my, or to be built again').

*Scenario:* 1. A site's session, a swap that runs itself, or a mix has a return chain stopped at its collateral's mix: giveme.my refused past its wait, or a lock cut the chain after the deposit landed.
2. Other people's mixes have since drawn the 5 ₳ pool's free boxes.
3. From an hour after the deposit landed, the swap's timeline reads 'Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free for its collateral's mix yet. The rest waits for that mix, a day at most.' The privacy callout under it reads 'The collateral's mix is still waiting for giveme.my.'
4. On the mix card, 'Why it stopped: giveme.my wouldn't back the collateral's mix…' sits above that same callout.
5. The user is told the wrong reason in an accuracy-critical line.

*Evidence:* lovejoin.ts:4131 `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`

sessions.ts:4390 `if (typeof resumed === "string") throw new Error(tailWaiting(resumed));`

en.json:922 "The collateral's mix is still waiting for giveme.my. Bring the rest back without it, …"

Scratch test A (stoppedAtMix, the pool's other boxes spent, landed moved back an hour) logged:
- the reason after the hour: "Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free for its collateral's mix yet. The rest waits for that mix, a day at most."
- collateralHeld: {"offerAt":1800000000000}
- the rendered CollateralHeldWayOut: "…The collateral's mix is still waiting for giveme.my. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed…"
- the chain's own stop reason: "giveme.my wouldn't back the collateral's mix, so the chain stopped there."

*Fix:* Reword the line for both states. For example: "The collateral's mix hasn't gone yet. Without it, its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again." This is shorter too, which fits rule 4.

The key is critical, so back-translate es and ja blind and note the round in verified-critical-{es,ja}.json. The exact wording is the owner's call.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4131`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4390`, `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:922`, `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:915`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/LovejoinReturn.tsx:551`, `seedelf-platform/seedelf-web-wallet/docs/flows.md:522`

*Verified:* trace confirmed (low)

*Outcome (tail):* **fixed**. Test: same tests as x-priv#3 (duplicate)

Duplicate of x-priv#3.

## x-ui#1

**low** · ux · confidence high · lane `tail`

**By hand, 'Bring the rest back now' brings nothing back, yet its stop reason says 'You brought the rest back'**

*Claim:* skipCollateralMix ends in advance(), whose step returns at once for a session that doesn't run itself (running needs s.auto). On a site's page or a by-hand swap's page, the press only marks the tail over and stops the chain. The rest stays at the account until the user presses Bring it back and then Send.

Meanwhile three texts say otherwise:
- the button, 'Bring the rest back now';
- the stop reason lj.tail.skipped, shown on the Lovejoin page's Chains row: 'You brought the rest back…';
- flows.md: 'and the rest comes back directly'.

The PR's own test builds the return by hand after the skip (lovejoin-planner.test.ts:1825).

*Scenario:* 1. A site's session's return chain waits at its collateral's mix for over an hour.
2. The user presses Bring the rest back now.
3. Nothing is sent.
4. The site page now reads 'Through Lovejoin: Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back'.
5. The Lovejoin page's Chains row reads 'Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there. Mix my boxes again mixes the boxes it didn't.' That stays false until the user brings the rest back.

*Evidence:* sessions.ts:5537 `return this.advance(network, index, true);`

sessions.ts:3446 `if (!s || !running(s)) return;`

sessions.ts:1231 `return !!s.auto && !s.closedAt && !s.auto.paused && !s.auto.failed;`

SiteSessions.tsx:416-417 `await call("session-skip-collateral-mix", { index: s.index }); onRefresh();`

Scratch test B (a site's session set up as in the PR's test; skip, then runAll) logged:
- `stage open → open`
- `txs ["out","deposit","mix","deposit"]` (no return)
- `chain.stopped` = "You brought the rest back without waiting for the collateral's mix, so the chain stopped there."
- `chainText(chain, true)` = "Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back"

*Fix:* - On the by-hand pages (SiteSessions onSkip, Swaps.tsx's by-hand branch), open the return's review after the skip (buildBack(true)), so the button does what it says, as Bring it back does.
- Reword lj.tail.skipped so it doesn't claim the return, e.g. 'You chose not to wait for the collateral's mix, so the chain stopped there.' It is a machine draft, not critical.
- Say in flows.md:522 that a session brought back by hand opens its review.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5537`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3446`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:1230`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:416`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:2567`, `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:920`, `seedelf-platform/seedelf-web-wallet/docs/flows.md:522`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **fixed**. Test: same tests as pr337#1; it was UNVERIFIED, and they reproduced it

Duplicate of pr337#1.

## x-ui#2

**nit** · ux · confidence high · lane `tail`

**Inside the mix card the way-out button inherits .token-row__detail's 12 px, and its wrapper renders an empty row before the hour**

*Claim:* MixCard wraps CollateralHeldWayOut in <div className="token-row__detail">. That class sets font-size 12px and colour var(--warn), and `button { font: inherit; }` passes the 12 px to the 48 px secondary pill. On the swap and site pages the same button is 14 px.

The wrapper also renders as soon as collateralHeld exists. During the hour before offerAt the component inside returns null, which leaves an empty grid row with its 4 px margin.

*Scenario:* A mix held at its collateral's mix shows its card on the Lovejoin page. Past the hour, the button label is 12 px, smaller than the same button on a swap's or site's page. Before the hour, an empty detail row adds a gap under the card.

*Evidence:* Lovejoin.tsx:2586-2590 `{s && s.collateralHeld && !isOver(s) && onSkipCollateral && (<div className="token-row__detail"><CollateralHeldWayOut …/></div>)}`

styles.css:3777-3786 `.token-row__detail { grid-column: 2 / -1; margin: 4px 0 0; font-size: 12px; … color: var(--warn); }`

styles.css:136-137 `button { font: inherit;`

The Chromium render of the static markup with src/ui/styles.css computed font-size 14px on the page and 12px in the card. Screenshot: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/x-ui-visual/card.png

*Fix:* Check offerAt in MixCard's condition. Render the way out in a cell of its own (grid-column: 2 / -1, no .token-row__detail), or give the button an explicit font-size.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2586`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/styles.css:3777`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/styles.css:136`

*Verified:* verify confirmed (nit)

*Outcome (tail):* **fixed**. Test: tests/collateral-held.test.ts > "adds nothing before the hour, not even an empty row" and "offers it from the hour, outside the detail line's 12 px": both failed on HEAD's MixCard

MixCard gates on the new wayOutOffered, which CollateralHeldWayOut uses too. The way out sits in a new .token-row__wide cell (grid-column 2 / -1, margin 4px 0 0) instead of .token-row__detail, so the button is at the page's 14 px.

## x-ui#3

**nit** · i18n · confidence high · lane `tail`

**The new critical line has a plain space before ₳ in en, es and ja, against the house's no-break-space rule**

*Claim:* lj.tail.privacy.wayOut writes '5 ₳' with U+0020 in all three languages. glossary.md:151 makes U+00A0 'the house's rule in every language', and its siblings lj.tail.waiting, lj.tail.fewBoxes and swaps.review.privacy.collateralMix follow that rule. About 48 older keys slip the same way; this one is new in the range.

*Scenario:* At some width, or in es or ja, the critical callout wraps between '5' and '₳', splitting the amount from its unit.

*Evidence:* In all three locales, the character before ₳ in lj.tail.privacy.wayOut is 0x20. In lj.tail.waiting and lj.tail.fewBoxes it is 0xa0.

glossary.md:151 "| an amount in ₳ | a no-break space (U+00A0) before ₳ | the same | the house's rule in every language (usability review V-7)…"

*Fix:* Use '5 ₳' in en, es and ja. Meaning is unchanged, so note it in the verified files' reviewer note. Better, fold it into the rewording of F1.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:922`, `seedelf-platform/seedelf-web-wallet/docs/i18n/glossary.md:151`

*Verified:* verify confirmed (nit)

*Outcome (tail):* **fixed**. Test: tests/collateral-held.test.ts > "names no cause of the wait in any language, and keeps 5 ₳ whole": HEAD has U+0020 before ₳ in en, es and ja

Folded into the rewording: a raw U+00A0 before ₳ in all three, as the house stores it, never escaped.

## x-ui#4

**nit** · ux · confidence high · lane `tail`

**On pages that don't poll, the way out never appears at its hour until the user refreshes**

*Claim:* CollateralHeldWayOut reads now = Date.now() at render and returns null before offerAt. The site's page and a by-hand swap's page have no timer, so the line and button show only after a Refresh or some other re-render, even though the view carries collateralHeld from the deposit's landing. A swap that runs itself (20 s) and the Lovejoin page (2 s) re-render on their own. pr337 #6 found the same.

*Scenario:* 1. A user opens a site's session page 50 minutes after the collateral's deposit landed.
2. They leave the page open past the hour.
3. No way out appears until they press Refresh, and nothing on the page says one is coming.

*Evidence:* LovejoinReturn.tsx:540 `now = Date.now(),`

LovejoinReturn.tsx:548 `if (!held || now < held.offerAt) return null;`

SiteSession has no setInterval. Dapps.tsx polls only while a scan runs (SCAN_DUE_EVERY_MS).

*Fix:* In CollateralHeldWayOut, schedule a one-shot re-render at offerAt: useEffect with setTimeout(held.offerAt - Date.now()) when that's positive.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/LovejoinReturn.tsx:540`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/LovejoinReturn.tsx:548`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:410`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **not-a-bug**. Test: none: every session page renders under Home (Home → Dapps → SiteSession/Swaps → Session), and Home's setInterval(setNow, 10_000) re-renders it

Same as pr337#5(b). The button needs only a render, which comes every 10 s.

## x-ui#5

**nit** · docs · confidence high · lane `docs-design`

**privacy.md doesn't record the user's new way out that leaves the collateral's box unmixed**

*Claim:* #337 updated flows.md and architecture.md, but privacy.md still says the box waits unmixed and tied to the session only 'past that, or a day after the deposit landed'. Rule 3 makes privacy.md the design doc for this ground. pr337 #5 found the same.

*Scenario:* A reader of privacy.md, looking for what can leave a session's collateral box unmixed and tied to it, misses the user's own choice from the hour on.

*Evidence:* privacy.md:217 "…past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session as any deposit's box is, and Mix my boxes again takes it first." Nothing in it mentions Bring the rest back now or TAIL_OFFER_MS (a grep finds none).

*Fix:* Add one clause: '…or sooner, an hour after the deposit landed, if the user brings the rest back without it (Bring the rest back now; 1.7.0).'

*Files:* `seedelf-platform/seedelf-web-wallet/docs/privacy.md:217`

*Verified:* verify confirmed (nit)

*Outcome (docs-design):* **fixed**. Test: docs-only: as x-docs#8

Duplicate of x-docs#8.

## x-docs#0

**low** · docs · confidence high · lane `docs-roadmap`

**Items 4–7 of the 1.7.0 list and five (1.7.0) Kept-in-mind entries still read as open, and two describe requests that weren't built**

*Claim:* #333, #335, #336 and #337 landed list items 4 (its Bootstrap half), 7, 5 and 6, but none of them touched the roadmap. The list still reads 🚧/⬜, and the Kept-in-mind entries describe the old behaviour as current. :379–380 propose `utxo_info` and a batched `account_info`, where #336 built `tx_info` per launch and `account_update_history` only for an L its launch didn't register. This is agreed: #333's description says the tick waits for the release-prep docs commit. This finding is the exact list for that commit.

*Scenario:* The release-prep commit ticks items 4–7 but leaves :379–380 as they are. The docs then state a Koios cost (rule 8) for requests the wallet never makes. A session picking work from Kept in mind reads "6. ⬜ … The owner's calls first" and builds a second way out beside #337's *Bring the rest back now*.

*Evidence:* post-release-roadmap.md:38: "4. 🚧 **Two in core and WebAssembly:** … ✅ The overflow half…"
:39: "5. ⬜ **A listed pool confirmed on chain…**"
:40: "6. ⬜ … The owner's calls first: after how long it's offered, and its words."
:41: "7. ⬜ **Transaction details for every part**"
:374: "a review opens only the first part's"
:378: "`BOOTSTRAP_BACK_RESERVE` is a fixed 1.5 ₳, so a dearer byte lowers the cap"
:379: "one `utxo_info` per newly listed pool"
:380: "One batched `account_info`…"

What was built: koios.ts:926 `launches` posts `tx_info`; koios.ts:954 `firstRegistrations` posts `account_update_history`.

#333's PR body: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."

*Fix:* In the release-prep docs commit:
- Tick items 4–7. Item 6 records the owner's calls: an hour (`TAIL_OFFER_MS`) and *Bring the rest back now*.
- Strike :373, :374, :378, :379 and :380 as "✅ **1.7.0:** …", as :387–388 do.
- Rewrite :379–380 to the requests made: `tx_info` per new pool's launch, and `account_update_history` for an L the launch didn't register.
- Keep item 2 at 🚧 until the owner requires the check.
- Item 5's tick should say what #336 closes: a lying server, and a launch not on chain when the device first sees it. `confirmed()` (lovejoin-pools.ts:565) checks a pool once, so a launch rolled back after that check stays kept (medium confidence).

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:38`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:39`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:40`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:41`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:373`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:374`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:378`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:379`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:380`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): checked against W's koios.ts utxoInfo/launches/firstRegistrations, lovejoin-pools.ts confirmed/launched, lovejoin.ts TAIL_OFFER_MS, tx-view.ts partHashes, core bootstrap_back_reserve

Items 4-7 ticked with PRs; the five (1.7.0) entries are now ✅ 1.7.0 entries over struck old text. Item 5 names utxo_info (the pools lane's pr336#0), tx_info and account_update_history, with counts; each entry has a Left: for the code lanes' owner's calls.

## x-docs#1

**low** · docs · confidence high · lane `docs-design`

**#333 left three doc statements its own fix made false (flows.md:523, architecture.md:672, privacy.md:198)**

*Claim:* #333 prices a private Bootstrap's way back from the parameters (1.8 ₳ at 6,465 lovelace a byte), so a dearer byte no longer lowers the cap. Three statements still say otherwise:
- flows.md:523, a bullet #333 itself edited, still gives the old cap of 68.
- architecture.md:672 contradicts the sentence #333 added to the same paragraph.
- privacy.md:198, which #333 didn't touch, gives the way back as a fixed 1.5 ₳.

*Scenario:* A reader, or the release-prep agent, checks the Bootstrap cap at 6,465 lovelace a byte. flows.md says 68 classic boxes, and the wallet offers 96 and funds 1.8 ₳ for the way back, which no doc line says. privacy.md says 1.5 ₳ for the way back where the review's *For returning the rest* row shows 1.8 ₳.

*Evidence:* - flows.md:523: "the wallet measures how many by building both, one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)"
- architecture.md:672: "one deposit's most under today's parameters, fewer at a dearer byte", then later in the same paragraph "so a dearer byte doesn't lower the cap (1.8 ₳ at 6,465 lovelace a byte…"
- privacy.md:198: "funded with the boxes, 1.5 ₳ for the deposit's fee and change, and 1.5 ₳ for its way back … (one deposit's most under today's)"
- seedelf-core/tests/lovejoin_pools_test.rs:1809 asserts `bootstrap_most(&dear, &classic, true, 96) == 96`. Running it printed "at a dearer byte: the way back's reserve is 1800000".
- The review row shows `summary.bootstrapReserve` (Lovejoin.tsx:3798).

*Fix:* - flows.md:523: "one deposit's most (96, or 64 in a token pool), the way back's reserve priced from the parameters (1.5 ₳ today, 1.8 ₳ at 6,465 lovelace a byte)". Also note that the *For returning the rest* row is 1.5 ₳ only at today's parameters.
- architecture.md:672: drop "fewer at a dearer byte".
- privacy.md:198: "at least 1.5 ₳ for its way back, priced from the parameters".

*Files:* `seedelf-platform/seedelf-web-wallet/docs/flows.md:523`, `seedelf-platform/seedelf-web-wallet/docs/architecture.md:672`, `seedelf-platform/seedelf-web-wallet/docs/privacy.md:198`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **fixed**. Test: docs-only (was UNVERIFIED, holds): checked against core bootstrap_back_reserve's doc, seedelf-core/tests/lovejoin_pools_test.rs:1843 (cap 96 at 6,465) and extension/tests/lovejoin-flows.test.ts:508 ({ most: 96, back: "1800000" })

flows.md:523 drops the 68 and says the way back's reserve is priced from the parameters (1.5 ₳ today, never less; 1.8 ₳ at 6,465); review row is that reserve. architecture.md:673 'one deposit's most, at a dearer byte too, fewer only where a deposit's fee would pass MAX_FEE's 10 ₳'. privacy.md:198 'at least 1.5 ₳ ... priced from the network's parameters'.

## x-docs#2

**low** · release · confidence high · lane `docs-design`

**The store's host-permission text doesn't cover #336's new mainnet Koios requests**

*Claim:* Since #336, on mainnet and while the wallet's own server answers, Koios is asked to confirm every pool that server lists which is new to the device: `tx_info` for its launch, and `account_update_history` for L. #336 updated the policy and privacy.md, but not the store listing's Koios justification. The per-host row limits pool-launch reads to pools the server "hasn't listed". The ~1,000-character text pasted into the dashboard says Koios covers "one Lovejoin read" the server doesn't; there are now two.

*Scenario:* At 1.7.0's upload the owner pastes store/README.md's host-permission text, as development.md step 11 says. The reviewer is told Koios is asked about new pools only while the wallet's own server hasn't listed them. Every mainnet wallet now asks Koios about each newly listed pool even while that server answers.

*Evidence:* - store/README.md:261: "…Lovejoin's pools, the new pools at Lovejoin's reference holder (the transactions that started them and their scripts' registrations) while its own server hasn't listed them… Even while its own server answers, Koios is asked what made the user's boxes in a later pool of the same box value as one shown, which that server doesn't cover."
- :269, the 996-character dashboard text: "…and for one Lovejoin read its server doesn't cover."
- lovejoin-pools.ts:454: `await this.keep(network, await this.confirmed(network, found));` on the data layer's path.
- :565–584, `confirmed()`: `this.deps.koios(network).koiosAlone()`, then `launched()`.
- privacy-policy.md:46 and :93 were updated in #336; store/README.md was not.

*Fix:* - :269: "and for two Lovejoin reads its server doesn't cover". That's 997 characters, still under the dashboard box's limit.
- :261: add "and, as its own server lists a pool the device hasn't seen, that pool's launch transaction and its script's registration".
- Optional: the policy's service list (privacy-policy.md:40, "on mainnet whatever ours can't answer") and the listing description (:75) simplify the same way, as they already did for the copies' read.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/store/README.md:261`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:269`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **fixed**. Test: docs-only (was UNVERIFIED, holds): lovejoin-pools.ts refresh -> confirm -> confirmed (koiosAlone().utxoInfo, launched: tx_info, account_update_history)

Koios host row names the confirm even while our server answers; merged dashboard box reworded to 'two Lovejoin reads even while its server answers' (998 chars); :266 counts updated to 2,802 and 998.

## x-docs#3

**low** · docs · confidence high · lane `docs-design`

**architecture.md:732 still calls a listed pool's launch the server's word, after #336**

*Claim:* The design doc's trust model for the data layer's pool list predates #336. It says being finished is the server's word, and being on chain is only the ledger's to judge. Since #336, a pool new to the device is kept only once Koios's `tx_info` finds its launch and L is registered by the launch or an earlier block. Only where the launch sits, and so which pool is earliest, is still the server's word.

*Scenario:* An agent or auditor reads architecture.md to learn what a lying data layer can do. It concludes the wallet takes an unlaunched or unfinished listed pool for good, and proposes the check #336 already made, or misjudges the threat model.

*Evidence:* architecture.md:732: "that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below). Whether a pool is on chain at all is the ledger's to judge, not the server's: a pool verifies offline from any seed, so one a list names may never have been launched, or its launch rolled back…"

The code: lovejoin-pools.ts:565 `confirmed()` → `launched()`. #336 touched only privacy.md and the policy among the docs.

*Fix:* Say that a pool from the list that's new to the device is confirmed through Koios before it's kept: its launch on chain (`tx_info`), and L registered (`account_update_history` where the launch didn't register it). Where its launch sits stays the server's word, and a launch rolled back after that check stays kept.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/architecture.md:732`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **fixed**. Test: docs-only (was UNVERIFIED, holds): checked against lovejoin-pools.ts confirmed/launched as the pools lane left them

Which pools are shown rewritten: a new listed pool is kept only once Koios's rows (utxo_info, tx_info, account_update_history) confirm it; only being listed and the crowds are the server's word; ledger backstop kept.

## x-docs#4

**low** · ci · confidence high · lane `docs-design`

**development.md and web-wallet.yml say main's protection requires *Web Wallet required*; it requires no check**

*Claim:* #331's doc line and the workflow's comment both state that main's branch protection requires the *Web Wallet required* job. Main's protection requires no status check at all. Roadmap item 2 (:36) correctly says requiring it is still the owner's step.

*Scenario:* A reader of the release procedure, the lead included, assumes a PR can't merge into main while *Web Wallet required* is red or pending. #330–#337 merged minutes apart without one combined CI run, and nothing in the protection stops that.

*Evidence:* - development.md:13: "That job is the one `main`'s branch protection requires, so no path filter can leave a PR waiting on a check that never comes (1.7.0)."
- web-wallet.yml:135: "# The one check main requires (its branch protection names *Web Wallet"
- `gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection` returns `"required_status_checks": {"strict": true, "contexts": [], "checks": []}` and `"enforce_admins": {"enabled": false}`.
- post-release-roadmap.md:36: "left, the owner's: requiring it."

*Fix:* Until the owner turns the requirement on, both should say "the one for `main`'s protection to require (1.7.0's item 2)". Or the owner requires the check, and the item and both lines then agree.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/development.md:13`, `.github/workflows/web-wallet.yml:135`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **fixed**. Test: docs-only (was UNVERIFIED, holds): the ci lane's live read of main's protection (contexts [], checks [])

development.md:13 now 'the one for main's branch protection to require; requiring it is the owner's step (1.7.0's item 2)'. The web-wallet.yml comment was fixed by the ci lane.

## x-docs#5

**low** · ux · confidence medium · lane `docs-design`

**The way-out's privacy line names giveme.my where the mix waits to be built again**

*Claim:* `tailHeld` offers *Bring the rest back now* in two kinds of state:
- tailWaits, where the mix waits for giveme.my;
- tailBuildable, where the chain stopped short of the mix (giveme.my refused, a drawn box gone, a lock) and the mix waits to be built again: for its box to be listed, the 5 ₳ pool to be read, or boxes to be free.
The new critical line always says the mix "is still waiting for giveme.my". flows.md:522 describes it correctly ("while the mix still waits (for giveme.my, or to be built again)"); the UI line doesn't.

*Scenario:* giveme.my refuses a session's collateral's mix, and the chain stops with "giveme.my wouldn't back the collateral's mix, so the chain stopped there.". An hour after the deposit landed, the session's page offers the way out with "The collateral's mix is still waiting for giveme.my." That's contradictory. In a wait for free boxes it says giveme.my beside lj.tail.fewBoxes' "hasn't enough of other people's boxes free".

*Evidence:* - en.json:922: "lj.tail.privacy.wayOut": "The collateral's mix is still waiting for giveme.my. Bring the rest back without it…"
- lovejoin.ts:4131: `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`
- LovejoinReturn.tsx: `if (!held || now < held.offerAt) return null;` then the line.
- A scratch test (deleted) in lovejoin-planner's `stoppedAtMix()` state logged:
  - record: `{"ended":true,"stoppedReason":"giveme.my wouldn't back the collateral's mix, so the chain stopped there.","tail":{…"tries":1,"landed":1800000000000}}`
  - view: `collateralHeld: {"offerAt":1800003600000}`

*Fix:* Make the first sentence hold in both states, for example "The collateral's mix hasn't gone yet." Keep the rest of the line as it is. It's a critical key, so es and ja need a fresh blind back-translation and the verified-critical records updated.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:922`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4131`, `seedelf-platform/seedelf-web-wallet/docs/flows.md:522`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **fixed**. Test: same tests as x-priv#3; it was UNVERIFIED, and the planner test reproduced it (fewBoxes state, held, line names giveme.my)

Duplicate of x-priv#3. flows.md already described both states correctly; only the UI line was wrong.

*Outcome (docs-design):* **fixed**. Test: fixed by the tail lane: lovejoin-planner.test.ts 'says the collateral's mix hasn't gone, never that giveme.my is what it waits for…' and collateral-held.test.ts 'names no cause of the wait in any language…'

The string change (lj.tail.privacy.wayOut) is the tail lane's; flows.md:522 now quotes the new line and the new stop reason.

## x-docs#6

**nit** · docs · confidence high · lane `docs-roadmap`

**The Leios entry overstates two things: "all of it ran" and "a window of four"**

*Claim:* "Mended, all of it ran on Musashi" includes Lovejoin withdraws, and none was sent: the branch's README says so. "A chain's window of four in flight (`pumpChain`)" is two for a chain of four-box mixes. The "245 s more" came from a 4-wide chain the harness sent four at a time, which the wallet never does.

*Scenario:* Someone takes up "the window could be the whole chain" and raises CHAIN_WINDOW alone. Four-wide chains still go two at a time, through three trips of the queue rather than the two the entry describes.

*Evidence:* - :406: "Mended, all of it ran on Musashi, Seedelf's and Lovejoin's scripts unchanged."
- The branch's seedelf-leios/README.md (git show): "A Lovejoin withdraw can't be mended after the fact … None was sent here."
- :409: "a chain's window of four in flight (`pumpChain`)"
- lovejoin.ts:300–302: `export const CHAIN_WINDOW_FOUR = 2;` … `chainWindow = (width) => (width >= 4 ? CHAIN_WINDOW_FOUR : CHAIN_WINDOW)`, used at sessions.ts:4937 and lovejoin.ts:4635.
- Overlaps pr338.

*Fix:* - :406: "every Seedelf spend, mix and launch ran on Musashi; a withdraw can't be mended after it's built, so none was sent".
- :409: "a chain's window in flight (four, or two for four-box mixes)".

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:406`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:409`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): branch README and 20 run records (git show); lovejoin.ts chainWindow/CHAIN_WINDOW_FOUR

What ran is now exact (no withdraw, giveme.my, token's pool or classic scripts); the window is four, or two for four-box mixes.

## x-docs#7

**nit** · docs · confidence high · lane `rust`

**The WebAssembly profile's docs overstate checked sums and omit the new overrides (#332)**

*Claim:* CLAUDE.md says seedelf-wasm's "sums on amounts are checked by hand (`checked_add`)". Many of its sums on lovelace are plain `+` or `.sum()`, which is safe only because chain amounts can't pass u64. Only the datum-controlled ones are checked. wasm/README.md:115 and architecture.md:99 describe `wasm-release` without its new per-package overflow checks.

*Scenario:* An agent adds a seedelf-wasm sum on a datum's amount (a pool's box ADA × count) with plain `+`. It trusts CLAUDE.md that the crate's amount sums are checked, and the store build wraps it silently.

*Evidence:* - CLAUDE.md:94: "but not in `seedelf-wasm`: … so its sums on amounts are checked by hand (`checked_add`)".
- Unchecked sums in seedelf-wasm: lovejoin.rs:847–848 `self.coins.iter().map(|(c, _)| c.lovelace).sum::<u64>() + …`, lovejoin.rs:2127 `total += held.lovelace;`, lovejoin.rs:2178 `total += lovelace(p);`, lib.rs:3766 `.sum()`.
- wasm/README.md:115: "`wasm-release` profile (`opt-level = \"z\"`, LTO, one codegen unit, stripped)", with no overflow checks mentioned.
- Overlaps pr332 (F1 and its note on :67).

*Fix:* - CLAUDE.md: "so a sum that could pass u64 (one on a datum's amount) is checked by hand (`checked_add`)".
- wasm/README.md:115 and architecture.md:99: add "and overflow checks in core, crypto and koios".

*Files:* `seedelf-platform/CLAUDE.md:94`, `seedelf-platform/seedelf-web-wallet/wasm/README.md:115`, `seedelf-platform/seedelf-web-wallet/docs/architecture.md:99`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (rust):* **fixed**. Test: Docs only

wasm/README.md:115 and architecture.md:99 (plus a new sub-bullet) now mention the overflow checks in core, crypto and koios and point to CLAUDE.md for where the line falls.

## x-docs#8

**nit** · docs · confidence high · lane `docs-design`

**privacy.md's collateral-mix paragraph doesn't name *Bring the rest back now***

*Claim:* privacy.md is the design doc for the privacy ground. Its paragraph on the session's collateral mix says the box waits unmixed and tied to the session if the mix can't go. It doesn't mention #337's control, which now leaves that box unmixed by the user's choice after an hour. flows.md:522 and architecture.md:633 both name it.

*Scenario:* Someone audits privacy.md for every path that leaves the collateral's 5 ₳ box unmixed and tied to its session. They miss the user-triggered one.

*Evidence:* privacy.md:217: "…They say it's mixed, giveme.my backing and seeing that mix and, if it can't go, its box waiting unmixed, tied to the session…". The paragraph has no mention of the way out, TAIL_OFFER_MS or *Bring the rest back now*. #337 changed no privacy doc ("No privacy policy entry. Nothing new is sent to anyone.").

*Fix:* One sentence: "An hour after its deposit, while the mix still waits, the session's page offers *Bring the rest back now*, which leaves that box unmixed and tied to the session at once, as the day's end would (1.7.0)."

*Files:* `seedelf-platform/seedelf-web-wallet/docs/privacy.md:217`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **fixed**. Test: docs-only: skipCollateralMix -> tailOver; offerAt = landed + TAIL_OFFER_MS

privacy.md:217 adds the user's way out (Bring the rest back now, from an hour after the deposit landed).

## x-docs#9

**nit** · docs · confidence high · lane `docs-roadmap`

**The archived chunk 34 plan still heads 34g "(2026-10-18, in progress)" under a ✅ status**

*Claim:* #329 marked the plan ✅ done, and relabelled the steps table's link to 34g as "done". The heading it points at still reads "in progress", and the section under it opens "Start here (the next session)". The archive isn't maintained, so this is cosmetic.

*Scenario:* An agent skimming the archived plan's outline sees "in progress" and "Start here (the next session)". It treats 1.6.0's gate as unfinished before reading #329's "Done:" line.

*Evidence:* - :910: "## 34g · The preprod rehearsal and the release (2026-10-18, in progress)"
- :914: "### Start here (the next session)"
- :1497: "the handoff note ([done](#34g--the-preprod-rehearsal-and-the-release-2026-10-18-in-progress))"

*Fix:* Leave the archive as it is, or retitle the heading "(2026-10-18)" and fix the anchor in the two links to it (:9 and :1497).

*Files:* `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:910`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:914`, `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-34-token-pools.md:1497`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-roadmap):* **fixed**. Test: none (docs): scripted anchor check, every in-file link resolves

34g heading without 'in progress', links at :9 and :1497 fixed; 'Start here (the next session)' is now 'The last handoff'; Session 6's heading too.

## x-docs#10

**owner-call** · privacy · confidence high · lane `docs-design`

**The privacy policy dates #336's change 28 October 2026, before it reaches users**

*Claim:* The policy's *Effective* line and its new *Changes* entry are dated 28 October 2026. That's the merge day, while the behaviour reaches users only with 1.7.0's upload. The wallet's Settings link points at main, so 1.6.0 users read it now. For 1.6.0 the owner set the policy's date at release. #336 raised this.

*Scenario:* 1.7.0 is uploaded days later. Until then, the policy main serves says a 1.6.0 wallet confirms new pools with Koios, which it doesn't. That's over-disclosure, harmless, but dated before it's true.

*Evidence:* - privacy-policy.md:3: "**Effective 28 October 2026** (… and a new Lovejoin pool confirmed with Koios: see *Changes*)"
- :93: "- **28 October 2026:** on mainnet, a Lovejoin pool our server lists…"
- #336's description: "For 1.6.0 you set the policy's date at release, so move it if you want the release day instead."

*Fix:* The owner's call: keep 28 October, or set both dates in the release-prep commit, as for 1.6.0.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:3`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:93`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **owner-call**. Test: none (owner's call)

Dates untouched; recommendation in owner_calls.

## x-rel#0

**high** · release · confidence high · lane `(the lead)`

**1.7.0 isn't set: package.json, package-lock and the procedure's lines still say 1.6.0**

*Claim:* The release branch is origin/main at 6bca8bec, and nothing in the range bumped the version. The store refuses an upload that isn't strictly higher than 1.6.0. `npm run package` names its zip from package.json, and package.mjs only checks that the build's version matches package.json, not that it's higher than the last upload.

*Scenario:* Part 2 runs on a release merge that lacks the bump. `npm run package` writes release/seedelf-wallet-1.6.0-mainnet.zip over the shipped 1.6.0 zip: release/ is gitignored, and the file on disk still hashes to the recorded 6d1219aa…. The dashboard then refuses the upload because the version isn't higher. The release stops, and the 1.6.0 zip has to be rebuilt from babb8e76.

*Evidence:* package.json:3 `"version": "1.6.0"`; package-lock.json:3 and :9 the same. development.md:181 `release_version=1.6.0`; :242 "With `package.json` at 1.6.0, that file is `extension/release/seedelf-wallet-1.6.0-mainnet.zip`." `git diff --stat babb8e76..6bca8bec -- extension/package.json` is empty. scripts/package.mjs:40-41: `if (manifest.version !== pkg.version) throw …`. `sha256sum release/seedelf-wallet-1.6.0-mainnet.zip` gives 6d1219aaa0c4…938f, the hash roadmap.md records for 1.6.0. `.gitignore:4 release/`.

*Fix:* On web-wallet/release-1.7.0, run `npm version 1.7.0 --no-git-tag-version` in extension/: a minor bump, as the list says, for two new controls. Change development.md:181 and :242 to 1.7.0 in the same commit as the refreshed lists (part 1). No test pins the package version: the status fixtures' version strings are independent.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/package.json:3`, `seedelf-platform/seedelf-web-wallet/extension/package-lock.json:3`, `seedelf-platform/seedelf-web-wallet/extension/package-lock.json:9`, `seedelf-platform/seedelf-web-wallet/docs/development.md:181`, `seedelf-platform/seedelf-web-wallet/docs/development.md:242`

*Verified:* trace partly (low); impact refuted (nit)

*Outcome (the lead):* **fixed** by the release prep: 1.7.0 set, with the token, DRep and pool lists refreshed (`chore(web-wallet): 1.7.0's version, DRep lists and the pools' head start`).

## x-rel#1

**medium** · privacy · confidence high · lane `docs-design`

**#336 asks Koios on mainnet while our server answers, but the listing, its host justifications, its test instructions and the policy's summaries still say otherwise**

*Claim:* `confirmed()` runs only on mainnet with the data layer up. For each pool on the server's list that the device hasn't kept, it asks api.koios.rest directly (`koiosAlone()`) for `tx_info`, and for `account_update_history` where the launch didn't register L. The policy's pools paragraph and its 28 October entry say so. Everything that summarises Koios's role on mainnet still says Koios is asked only for what our server can't answer: the store description in en, es and ja, the Koios host row, the merged host box, the test instructions, the policy's In short, line 7 and line 40, privacy.md:22, and checklist item 9. Koios is already a declared host (`host_permissions` from serviceHosts → NETWORKS.mainnet.koios; package.mjs refuses a store build without it), and manifest.ts didn't change in the range. So no permission, warning or re-consent is involved, only text.

*Scenario:* A user keeps "Read Cardano through Koios only" off so that Koios never sees them on mainnet, as the store page and the policy's In short promise. Someone launches a mainnet token pool after 1.7.0's head start. That user's next pool read sends Koios a tx_info from their IP, which tells Koios they use Lovejoin. That contradicts the summary on the listing. Checklist item 9 would also read such a request as a fault. How often: only for a pool new to the device. Mainnet's head start holds 0 pools today, and the release's refresh bundles any that exists by then.

*Evidence:* lovejoin-pools.ts:454 `await this.keep(network, await this.confirmed(network, found));` and :565 onward, `const koios = this.deps.koios(network).koiosAlone();`, then `launched()` → `koios.launches` (:527) and `koios.firstRegistrations` (:551). store/README.md:75: "Koios, a public Cardano API, reads and submits on preprod, and on mainnet for anything ours can't answer, or for everything if you turn ours off in Settings." :261's only "Even while its own server answers" case is the later-pool boxes. :269 (996 chars): "…and for one Lovejoin read its server doesn't cover." :334: "Koios (api.koios.rest on mainnet when that server can't answer, …)". privacy-policy.md:5: "on mainnet for anything our server can't answer, or for everything if you turn our server off in Settings." development.md:162: "`api.koios.rest` only for a part the data layer couldn't answer".

*Fix:* Add one clause wherever the claim appears, for example "and to confirm a Lovejoin pool ours lists that the wallet hasn't seen". Places: the description in all three languages, with a blind back-translation of what changed (store/README.md:114); the :261 row; the merged box, where the new clause must replace words to stay under ~1,000 characters (e.g. "and for two Lovejoin reads its server doesn't answer alone"); :334; the policy's :5, :7 and :40; privacy.md:22; and checklist item 9. No dashboard permission change.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:454`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:565`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:75`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:163`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:227`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:261`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:269`, `seedelf-platform/seedelf-web-wallet/docs/store/README.md:334`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:5`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:7`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:40`, `seedelf-platform/seedelf-web-wallet/docs/privacy.md:22`, `seedelf-platform/seedelf-web-wallet/docs/development.md:162`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **fixed**. Test: docs-only (was UNVERIFIED, holds): as x-docs#2

Description en/es/ja, Koios row, merged box, :274, test instructions, policy :5 and :40, privacy.md:22, checklist item 9. Policy :7 left as is (defines the Cardano server; the confirm is Koios by name). es/ja description sentences need the lead's blind back-translation.

## x-rel#2

**medium** · ci · confidence high · lane `ci`

**Item 2's owner step, as written, won't gate the release PR: main requires no check, and every merge is an admin bypass**

*Claim:* Main's protection requires no status check today, yet development.md:13 and the workflow's comment say it requires *Web Wallet required*. It also requires one approving review with enforce_admins off, so each of the 14 PRs merged through the owner's admin bypass, and by GitHub's default that bypass skips required checks too. Adding *Web Wallet required* as item 2 says therefore adds it to rules the owner's merges already bypass. In this range 12 of 14 PRs merged while their own check was still running. The combined tree was saved by chance: #338's run checked out a merge ref whose tree equals HEAD's, and it passed. So the release PR's run is the first one the procedure depends on, and nothing enforces waiting for it.

*Scenario:* The owner opens the release PR (the bump and the refreshed tokens, DReps and head start), turns the requirement on, and merges with the bypass checkbox, as for every PR in this range, while e2e is still running. If e2e then fails, for example on F4's mainnet grid, main is red after the merge. Part 2's `npm run e2e` would catch it only on the store build, and only after the merge. e2e:data and the preprod-only Vitest build run nowhere but CI.

*Evidence:* `gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection` returns required_status_checks {strict:true, contexts:[], checks:[]}, required_approving_review_count 1, enforce_admins {enabled:false}; `…/rulesets` returns []. Every PR from #325 to #338 shows reviewDecision REVIEW_REQUIRED, 0 reviews, merged by the owner. Merge time against check finish: #326 17:36:12Z/18:10:20Z, #328 18:11:17Z/18:47:05Z, #329 15:49:28Z/16:42:21Z, #330 16:22:22Z/16:58:35Z, #331 16:26:02Z/17:21:57Z, #332 16:25:43Z/17:23:49Z, #333 17:14:44Z/17:27:32Z, #334 17:13:35Z/17:42:09Z, #335 17:14:00Z/18:02:53Z, #336 18:30:13Z/18:39:08Z, #337 18:30:28Z/19:14:32Z, #338 22:55:43Z/23:28:25Z. Run 40780509816's log: "HEAD is now at 85f5070 Merge 62be5bc4… into 11e249d2…"; tree of 85f5070 = tree of 6bca8bec = 8bd149a83f3a…; every step success. development.md:13: "That job is the one `main`'s branch protection requires". web-wallet.yml:135: "The one check main requires (its branch protection names *Web Wallet required*…)".

*Fix:* The owner's call, before the release PR merges. Either (a) set required approvals to 0, tick "Do not allow bypassing the above settings" and require *Web Wallet required*: strict is already on, so each merge is tested up to date with main, and auto-merge can optionally be allowed. Or (b) add a branch ruleset on main that requires the check with no bypass actors. Until one is in, merge the release PR only once its check is green on every step (development.md:15). Have development.md:13 and web-wallet.yml:135 say "requires" only once it does. #331's report covers the same facts from that PR's side.

*Files:* `.github/workflows/web-wallet.yml:135`, `.github/workflows/web-wallet.yml:141`, `seedelf-platform/seedelf-web-wallet/docs/development.md:13`, `seedelf-platform/seedelf-web-wallet/docs/development.md:15`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:36`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (ci):* **owner-call**. Test: None: it's a GitHub setting. It was UNVERIFIED, so I verified it live and every fact holds: no required check; 1 approval with enforce_admins off; rulesets []; the merge times match to the second; HEAD's tree 8bd149a8 equals #338's head tree, which was cut from main's head 11e249d2.

The workflow comment half is fixed (shared with pr331#5). The settings are the owner's, with the same steps as pr331#0. development.md:13/:15 and roadmap:36 belong to the docs lanes. Until a setting is in, merge the release PR only once its check is green on every step.

## x-rel#3

**low** · release · confidence medium · lane `docs-roadmap`

**The release's refreshes haven't run since 1.6.0, and an e2e assumption breaks if mainnet's head start gains a token pool**

*Claim:* The last refresh was 8cd8ce08 (1.6.0's). What each touches: (1) `npm run tokens` writes src/tokens/registry.{mainnet,preprod}.json only, from real Koios; list.json is hand-kept. (2) `npm run dreps` writes src/dreps/{mainnet,preprod}.json, in up to three passes, refusing a loss over 5%. (3) `npm run lovejoin-pools` writes src/lovejoin-pools.json, reading the holder from its start on both networks through PoolDiscovery.scan → holder() → #336's launched(); the launch check moved there unchanged, so its result is the same. (4) The decimals script writes seedelf-data/api/data/token-decimals.json, and a deploy is due if it changes. Nothing in the range touches tokens, list.json, DReps or decimals, and the range's new tests inject headStart rather than read a bundled list, so the range makes none of these riskier. One older assumption: the e2e's mainnet case expects the classic pool's row on the hub ("Mainnet bundles none"). The hub turns into a grid once more than ADA's group exists.

*Scenario:* A mainnet token pool was launched after 2026-10-25. `npm run lovejoin-pools` bundles it into mainnet's head start, so the mainnet hub shows ADA's and the token's tiles. The e2e "a pool under its floor offers to bootstrap it" then fails at `getByTestId("lovejoin-pool-classic")…toContainText("Being started: 0 of 30 boxes")` on both builds in the release PR's CI. If the PR is merged by bypass before its check ends (F3), main goes red.

*Evidence:* src/lovejoin-pools.json: mainnet height 14110720, 0 pools; preprod 3 pools. extension.spec.ts:3201: "Mainnet bundles none: the hub's rows." :3389: `await expect(page.getByTestId("lovejoin-pool-classic")).toContainText("Being started: 0 of 30 boxes")`. Lovejoin.tsx:1995: `{groups.length > 1 ? (… <PoolGrid …/>) : (listed.map(… <PoolGroupList …/>))}`. tests/lovejoin-pools-head-start.test.ts: the writer uses `new PoolDiscovery({ local, wasm, koios: () => new Koios(NETWORKS[network].koios), now, headStart: () => ({ height: 0, pools: [] }) })` then `scan(network)`. `git log -1 -- src/tokens src/dreps src/lovejoin-pools.json` shows 8cd8ce08.

*Fix:* On the release branch, in order: `npm run tokens`, `npm run lovejoin-pools` (its test needs list.json unchanged since), `npm run dreps`, then seedelf-data/scripts/token-decimals.py on a fresh registry clone. Read each diff. If mainnet's head start gained a token pool, change the mainnet e2e's hub step to open ADA's tile first, in the same commit. If token-decimals.json changed, commit it and deploy the API after the merge (step 7). Record each outcome in the handoff note.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/lovejoin-pools.json`, `seedelf-platform/seedelf-web-wallet/extension/src/tokens/registry.mainnet.json`, `seedelf-platform/seedelf-web-wallet/extension/src/dreps/mainnet.json`, `seedelf-data/api/data/token-decimals.json`, `seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:3201`, `seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:3389`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1995`, `seedelf-platform/seedelf-web-wallet/docs/development.md:273`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-roadmap):* **deferred**. Test: none: the lead's release prep

The refreshes ran in W. Mainnet's bundled 5 ₳ pool joins ADA's group, so the hub stays rows, but extension.spec.ts:3204's comment is stale and lovejoin-1-5-0.test.ts fails on it. Outcomes go in the lead's handoff note.

## x-rel#4

**low** · tests · confidence high · lane `tail`

**#337's way out has never run against a chain: no e2e, no live preprod run, no checklist line**

*Claim:* *Bring the rest back now* (`session-skip-collateral-mix`) marks the tail over, stops a chain still being sent before giveme.my is asked again, brings the rest back directly, and leaves the 5 ₳ box unmixed in the pool. Its only coverage is unit tests over fakes (lovejoin-planner, collateral-held) and a check by eye. No e2e names it, it had no live run, and the checklist's collateral-mix line ends at "that mix waits for giveme.my". The owner's standing rule is that private spends run live on preprod before they're reported, never leaving the first real run to the owner.

*Scenario:* The first real press is a preprod tester's or the owner's, after the release. If the stop mid-send or the direct return misbehaves against the real chain (a race with giveme.my's witness and the mix's submit, say), the session waits out the day (TAIL_KEEP_MS) or stops in a state no test has seen. On mainnet the path is dormant until a 5 ₳ ADA pool holds 30 boxes that aren't the wallet's, which is why the severity is low.

*Evidence:* PR #337: "e2e can't reach this state under its fakes. On mainnet it stays dormant until a 5 ₳ ADA pool holds its floor of boxes." `grep -rn 'Bring the rest back now|skip-collateral-mix|collateral-held|wayOut' e2e/` finds nothing. lovejoin.ts:335 `export const TAIL_OFFER_MS = 60 * 60_000;` and :4132 `return { id: c.id, offerAt: c.tail.landed + TAIL_OFFER_MS };`. development.md:145 "…and that mix waits for giveme.my;".

*Fix:* In the release's preprod pass: take a private session's return with the 5 ₳ pool shown and the collateral mix on. Once the collateral's deposit lands, block www.giveme.my (DevTools → Network request blocking, or page.route in the live harness); the direct return itself needs no giveme.my. Wait the hour. Check the line and the button on a swap's page, a site's page and a mix's card, then press. The rest should come back directly, the chain should show "You brought the rest back without waiting…", and the 5 ₳ box should stay unmixed in the pool. Unblock giveme.my, and *Mix my boxes again* should move it. Add that as a line under checklist item 6.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:335`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4127`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/LovejoinReturn.tsx:536`, `seedelf-platform/seedelf-web-wallet/docs/development.md:145`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **deferred**. Test: none: no cheap e2e. The fakes serve only the classic pool (a 5 ₳ ADA pool's reference and scripts would need faking), and the hour runs on the service worker's own clock, which Playwright's page clock doesn't reach

The lead runs it live on preprod; development.md needs a checklist line (docs notes). Also: the release prep's lovejoin-pools.json now bundles a mainnet 5 ₳ ADA pool (dc6abe3b…). The collateral's mix and this way out are no longer dormant on mainnet once it shows, and tests/lovejoin-1-5-0.test.ts ("…but what a shown pool adds of its own") fails on its 'none on mainnet' expectation. That failure isn't this lane's.

## x-rel#5

**low** · docs · confidence high · lane `docs-design`

**The preprod checklist names none of 1.7.0's behaviours (#335's stepper, #333's priced reserve, #336's Koios check)**

*Claim:* development.md changed in the range only at line 13 (#331). #335's stepper is wired into five reviews (Send privately, Make public, a swap's, a site's and Lovejoin's private funding), but e2e steps through only Make public's two parts, and the checklist's Max line doesn't ask for the details. #333 changed the private Bootstrap's form (1.5 ₳ plus the priced `back`, which is 3 ₳ at today's parameters) and its funding sum. The existing Bootstrap line exercises it only if someone knows to look. Item 9's network-panel line misses #336's request (F2).

*Scenario:* The owner runs the checklist for 1.7.0 as written. Nobody ever opens a later part's details on Send privately or on a funding in parts. A private Bootstrap's form least and its review's funding are never compared. Item 9 flags a correct Koios request as a fault, or misses it.

*Evidence:* development.md:147: "**Max** on Send privately and on Make public from more than 20 UTxOs: the review's *Transactions* says how many it goes as, and Home follows each to the last;". :144: "a Bootstrap (*Help start the pool*, under Mix) from each side, then **Bring one back** and **Bring them all back**". e2e/extension.spec.ts:2662: `withdraw-tx-part` "Transaction 1 of 2", the only part-stepper e2e. `git diff babb8e76..6bca8bec -- docs/development.md` changes only line 13.

*Fix:* Item 6's Max line: add "…and Transaction details steps through each transaction ('Transaction 1 of N'), on Send privately and on a funding in parts too". The Bootstrap line: add "from the private balance, its form asks 3 ₳ beside the boxes at today's parameters, and the review's funding matches". Add F5's line after the collateral-mix line, and F2's clause in item 9.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/development.md:144`, `seedelf-platform/seedelf-web-wallet/docs/development.md:147`, `seedelf-platform/seedelf-web-wallet/docs/development.md:162`, `seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:2662`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **fixed**. Test: docs-only (was UNVERIFIED, holds): strings tx.partOf, lovejoin.review.returnRest, lj.tail.skipped; Lovejoin.tsx PrivateReview rows

One short line each: Max line + Transaction details stepper; private Bootstrap's For returning the rest 1.5 ₳; new way-out line (the tail lane's x-rel#4 checklist line); item 9's Koios confirm clause.

## x-rel#6

**low** · tests · confidence medium · lane `pools`

**#336's check runs only on mainnet with the data layer up, so no preprod run or e2e reaches it before mainnet's first new pool**

*Claim:* `confirmed()` sits only on the data layer's path. Preprod has no data layer and reads Koios alone, so its discovery takes the holder path and never runs `confirmed()`. The e2e data-layer fake lists no token pool, mainnet's head start holds none, and the live server lists none. So the glue between the server's list and the Koios check has run only in unit tests over fakes. Its failure mode is closed: a pool it can't confirm is never kept.

*Scenario:* A defect in that glue first shows when someone launches a mainnet token pool after the release. 1.7.0 wallets never show it, mix into it or read their boxes there, while 1.6.0 wallets do. Each 1.7.0 wallet also asks Koios again every five minutes (REFRESH_MS).

*Evidence:* lovejoin-pools.ts:454 `await this.keep(network, await this.confirmed(network, found));` is inside the data layer's list handling. networks.ts `dataOrigin()` returns undefined for a network with no `data` (preprod). PR #336: "No e2e test lists a token pool through the data layer." src/lovejoin-pools.json: mainnet has 0 pools.

*Fix:* Add an e2e:data case: the data layer fake's `lovejoin/pools` lists preprod's MIN pool re-tagged for mainnet (as store-images re-tags tokens), and the Koios fake answers its tx_info. Assert that the pool shows on the hub and that one tx_info reached api.koios.rest. Or accept the gap and say so in the handoff note.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:454`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:565`, `seedelf-platform/seedelf-web-wallet/extension/e2e/data-layer.ts`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (pools):* **deferred**. Test: None. I checked the claim (it was unverified): preprod has no data layer in networks.ts, the e2e data layer fake lists no token pool, and HEAD's mainnet head start holds 0 pools. The release prep's holds 1 (the 5 ₳ ADA pool), and bundled pools are never checked.

The gap is real. I can't build the e2e: it needs the Koios fake in e2e/support.ts, which the classifier doesn't let me read, plus a mainnet pool fixture, and I can't run e2e. Recommendation for the lead: add an e2e:data case in which the data layer fake lists a pool, and a context.route on the mainnet Koios host, registered after the fixture's own (later routes win), answers utxo_info and tx_info for its launch. Otherwise, record the gap in the handoff note. My new unit tests cover the same paths, over fakes only.

## x-rel#7

**low** · docs · confidence high · lane `docs-roadmap`

**The release-prep docs aren't in yet: the list's ticks, the handoff note, and the review folder that would trip part 2's clean-tree check**

*Claim:* Items 4 (the Bootstrap half), 5, 6 and 7 have merged (#333, #336, #337, #335) but still read 🚧/⬜, and their Kept-in-mind lines (:373, :374, :378–:380) aren't ticked. This is by design: #333 says "the 1.7.0 list's tick waits for the release-prep docs commit". roadmap.md has no 1.7.0 handoff note, which development.md's steps 2 and 3 expect to record each refresh's outcome. The review's working folder is untracked in the tree, and part 2 requires `git status --porcelain` to print nothing.

*Scenario:* The owner starts part 2 on main with docs/plans/review-1.7.0/ still in the tree. `git status --porcelain` prints `?? seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.0/`, so the clean-tree check fails, or it's waved through and the recorded commit no longer describes the tree the zip was built in. Meanwhile the list keeps saying ⬜ for items that shipped.

*Evidence:* post-release-roadmap.md:39 "5. ⬜ **A listed pool confirmed on chain…**", :40 "6. ⬜ **An 'unmixed, now' way out**", :41 "7. ⬜ **Transaction details for every part**". `grep -n 1.7.0 roadmap.md` finds nothing. `git status --porcelain` lists `?? seedelf-platform/seedelf-web-wallet/docs/plans/review-1.7.0/`. development.md:219: "with nothing changed or added (`git status --porcelain` prints nothing)".

*Fix:* In the release PR: tick items 4 to 7 (item 2 stays the owner's until F3 is settled), turn the Kept-in-mind lines into ✅ entries as :387 and :388 are, and add the 1.7.0 handoff note (refresh outcomes; the API not redeployed unless the decimals changed). Archive the review folder as 1.6.0's was (docs/archive/plans/review-1.6.0.md), or remove it before part 2.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:38`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:39`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:40`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:41`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:373`, `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:378`, `seedelf-platform/seedelf-web-wallet/docs/roadmap.md:49`, `seedelf-platform/seedelf-web-wallet/docs/development.md:219`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-roadmap):* **partly**. Test: none (docs)

Ticks and entries done. The 1.7.0 handoff note and the review folder's archive or removal are the lead's.

## x-rel#8

**owner-call** · privacy · confidence high · lane `docs-design`

**The privacy policy is dated 28 October (#336's merge day), while 1.6.0's was moved to its release PR's merge day**

*Claim:* #336 set "Effective 28 October 2026" and dated its Changes entry the same day. For 1.6.0, the owner moved both the Effective date and the release's entry to the release PR's merge day (ef6af2bc). #336's PR asks the same question. The two practices diverge if the release PR merges on another day.

*Scenario:* The release PR merges on, say, 30 October with the policy still at 28 October. The Changes entry then describes behaviour that no store version had on that date. That's harmless over-disclosure, and the policy's promise ("before the new version ships") still holds. But the date no longer marks the release, which it did for 1.6.0.

*Evidence:* privacy-policy.md:3 "**Effective 28 October 2026** (… and a new Lovejoin pool confirmed with Koios: see *Changes*)". The Changes entry: "**28 October 2026:** on mainnet, a Lovejoin pool our server lists…". ef6af2bc: "The owner, 2026-10-26: 'make the merge day today'… Effective 26 October 2026, its 1.6.0 entry dated the same". PR #336: "For 1.6.0 you set the policy's date at release, so move it if you want the release day instead."

*Fix:* The owner's call: keep 28 October, or move both the Effective line and the 28 October entry to the release PR's merge day in the release-prep commit, as 1.6.0's were.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:3`, `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md:93`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **owner-call**. Test: none (owner's call)

Dates untouched; recommendation in owner_calls.

## x-mut-ts#0

**medium** · tests · confidence high · lane `pools`

**#336: a trap under a listed pool's confirmation can be swallowed with every test and tsc green**

*Claim:* confirmed() rethrows a WebAssembly trap and treats anything else as Koios being down, but no test covers the rethrow. With `if (isTrap(e)) throw e;` removed, all 88 tests pass across lovejoin-discovery, lovejoin-discovery-review-fixes, lovejoin-merged-review, wasm-review-fixes, lovejoin-crediting-review-fixes and storage-privacy, and tsc passes too.

*Scenario:* On mainnet, the data layer lists a token pool this device hasn't seen. While its launch is confirmed against Koios's tx_info, lovejoinLaunchCheck traps: any panic, such as an overflow #332 now checks in core. Without the rethrow, the catch sets `standard = []` and refresh resolves. The pool read goes on and the worker keeps running on a broken WebAssembly instance with the wallet unlocked, the state #330 fixed for the unawaited runs. Koios's holder look (holder() → launched()) still throws the same trap, so only the data-layer path goes quiet. Likelihood is low, because lovejoinVerifyPool decodes the same row first, but this guard is what locks the wallet.

*Evidence:* lovejoin-pools.ts:578-581: `} catch (e) {` / `if (isTrap(e)) throw e;` / `standard = [];` / `}`. Mutation 336-trap-swallowed: 'Tests 88 passed (88)'. tsc: no error. Scratch test zz-3 fails under it ('× throws WebAssembly's trap out of refresh…') and passes on HEAD.

*Fix:* No code change. Add the test below to the describe #336 added in lovejoin-discovery.test.ts.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:579`, `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-discovery.test.ts:367`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (pools):* **fixed**. Test: Same test as pr336#4. Removing the trap rethrow in confirmed() now fails it; before, all 88 tests in the finding's six files passed with it removed.

The finding's suggested test (refresh() rejects with the trap) assumed refresh() waits for the check, which it no longer does. The test instead asserts that the wallet locks exactly once, that the pool read isn't held, and that nothing is kept.

## x-mut-ts#1

**low** · tests · confidence high · lane `tail`

**#337: the session's own view carries collateralHeld untested; #337's test can't tell**

*Claim:* one() builds the view that session-advance, session-resume, session-stop and session-skip-collateral-mix answer with, and it passes tailHeld's offer. Dropping that argument leaves all 38 tests of the tail describe green, and tsc too. #337's test reads collateralHeld only through sessions.list. It discards the before-hour skip's answer. Its `expect(after.collateralHeld).toBeUndefined()` passes whether or not one() ever sets the field.

*Scenario:* A mix is held at its collateral's mix past the hour. The Lovejoin page's timer for running mixes replaces each card with session-advance's answer, and a swap's page poll does the same. With the field gone from one(), *Bring the rest back now* would vanish from the card at every advance until the next list read, and from the swap's page after its first poll.

*Evidence:* sessions.ts:5505: `return this.view(network, s, address, this.seen.get(...), false, await this.stillWaiting(network, s), await this.tailHeld(network, s));`. lovejoin-planner.test.ts:1805: `await sessions.skipCollateralMix("preprod", 0);` (answer unused). Line 1815: `expect(after.collateralHeld).toBeUndefined();`. Lovejoin.tsx:1757: `call("session-advance", { index })` replaces mixes. Swaps.tsx:2145: `setS(await call("session-advance", { index, now }))`. Mutation 337-one-no-held: 'Tests 38 passed | 41 skipped (79)'. tsc: no error.

*Fix:* No code change. In #337's test, assert the answer of the skip made before the hour, and of an advance.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5505`, `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-planner.test.ts:1805`, `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-planner.test.ts:1815`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:1757`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:2145`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **fixed**. Test: tests/lovejoin-planner.test.ts > "offers the way out once a lock cut…" asserts the press's and an advance's answers carry collateralHeld before the hour; it fails with one() dropping the tailHeld argument

Test-only; no code change.

## x-mut-ts#2

**low** · tests · confidence high · lane `tail`

**#337: tailHeld's 'mix still waiting or buildable' condition has no test**

*Claim:* Removing `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;` leaves all 38 tail tests and tsc green. The closed-session guards are also untested: dropping `stage !== "closed"` and `s.closedAt` together passes everything. The landed check one line up is guarded by the typecheck instead: its deletion is TS18048.

*Scenario:* The collateral's mix has been witnessed and sent (`tail.scheduled`), and the return is waiting for it to land. Without the condition, the page offers *Bring the rest back now* under lj.tail.privacy.wayOut ('The collateral's mix is still waiting for giveme.my…'), which is false by then. Pressing it runs tailOver on a mix that already went.

*Evidence:* lovejoin.ts:4131 as quoted. Mutation 337-held-no-waits-check: 'Tests 38 passed | 41 skipped (79)', tsc ok. Mutation 337-view-closed-too: the same. Mutation 337-held-no-landed-check: no test notices; tsc reports `lovejoin.ts(4132,33): error TS18048: 'c.tail.landed' is possibly 'undefined'`.

*Fix:* No code change. Add the test below.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4131`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5616`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5510`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **fixed**. Test: tests/lovejoin-planner.test.ts > "holds nothing once its mix was sent, on a session that's over, or before its deposit was known in (x-mut-ts#2)". It fails under each mutation: the waits-or-buildable check deleted, both closed guards dropped, the landed check dropped (NaN offer, on a cut chain marked ended)

Test-only; no code change.

## x-mut-ts#3

**low** · tests · confidence high · lane `tail`

**#337: either of a swap's page's two ways out can be deleted with tests and tsc green**

*Claim:* No test renders a page with a collateralHeld view. Removing the way out from the mix card, both Swaps renders and the site's page, and dropping the Lovejoin page's hand-off, leaves 712 tests in 40 files green. Only tsc's TS6133 notices those deletions. It misses either Swaps render deleted alone, because skipCollateralMix stays used by the other.

*Scenario:* A swap brought back by hand has its return held at its collateral's mix past the hour, and Swaps.tsx:2567 has been deleted. Its page offers no way out, so the return waits for the mix to give up by itself, up to TAIL_KEEP_MS (a day).

*Evidence:* Swaps.tsx:2513 and :2567: `<CollateralHeldWayOut held={s.collateralHeld} busy={busy} onSkip={skipCollateralMix} />`. Mutation 337-ui-wiring-union: 'Tests 712 passed (712)'. Natural deletions N4 (line 2513 alone) and N5 (line 2567 alone): tsc ok. The other deletions are TS6133 errors.

*Fix:* No code change. Add seam tests, as R3-20 did for 1.6.0's screen fixes.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:2513`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:2567`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:411`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2586`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **fixed**. Test: tests/screens-wiring-review-fixes.test.ts > describe "the way out of a return held at its collateral's mix, wired (1.7.0's release review)": by-hand swap, swap that runs itself, site's session and mix card each fail with that page's CollateralHeldWayOut deleted

Test-only. It presses the real button (collateral-held-skip) through the house seam, and flushes microtasks to see what the press asks after its first answer.

## x-mut-ts#4

**low** · tests · confidence high · lane `bootstrap`

**#333: nothing holds the form's request to answer `back`; the typecheck can't either**

*Claim:* Putting the case back to 1.6.0's `privateBootstrapMost(...).then((most) => ({ most }))`, with no cast, leaves 66 tests and tsc green. handle() is typed `Promise<Requests[Message["type"]]["result"]>`, the union of every request's result, so no case's answer is checked against its own request. PoolPage storing and passing `back` has no test either. Those two deletions are TS6133 errors.

*Scenario:* At coins_per_utxo_size 6465 the way back's reserve is 1.8 ₳. If the answer lacks `back`, bootstrapLimits counts BOOTSTRAP_BACK_LEAST (1.5 ₳). A private balance of 275 ₳ for 27 classic boxes then shows Bootstrap enabled, and the funding refuses it after the press: bootstrap's call 1 comes back. No money moves.

*Evidence:* handlers.ts:592: `return ctx.lovejoin.privateBootstrapBounds(ctx.network, ...);`. rpc.ts:2985: `result: { most: number; back: string }`. Mutation 333-handler-most-only: 'Tests 66 passed (66)'. Natural form N2: tsc ok. 333-page-no-back-passed: only the scratch test fails (1 failed | 475 passed). 333-page-no-back-stored: 1 failed | 125 passed, again the scratch test alone.

*Fix:* No code change. Add a handler-level test, plus the PoolPage seam test below.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:592`, `seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts:2985`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2687`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3115`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (bootstrap):* **fixed**. Test: extension/tests/lovejoin-flows.test.ts › 'caps a Bootstrap from the private balance at what its funding pays…': new assertion `handle({ type: "lovejoin-bootstrap-most" }, ctx)` toEqual { most: 96, back: "1800000" }. Reproduced: with the handler put back to 1.6.0's `privateBootstrapMost(...).then((most) => ({ most }))`, tsc exits 0 and HEAD's other 154 tests pass; this assertion fails. Passes on HEAD.

Claim confirmed: handle() is typed as the union of every request's result, so the typecheck can't hold a case to its own answer. Added imports of handle and Context. The page half of this finding is covered by pr333#1's seam test.

## x-mut-ts#5

**low** · tests · confidence high · lane `stepper`

**#335: four of the five reviews hand their parts to Transaction details with no test**

*Claim:* Only Withdraw's hand-off is tested, in the e2e. Removing `parts={…}` from Transfer, the swap's funding, the private mix's funding and the site's funding leaves 803 tests in 34 files green, and tsc too.

*Scenario:* A private Send is too large for one transaction, so its review says *Transactions 2*. With `parts` gone, Transaction details opens on the first part alone with no stepper. 321-parts-worker#5 is back on four of the five screens.

*Evidence:* Transfer.tsx:236: `<TxDetailButton txHash={summary.txHash} parts={summary.parts} testId="transfer-tx" />`, and the same shape at Swaps.tsx:935, Lovejoin.tsx:3075 and DappApprovals.tsx:772. The e2e opens only `withdraw-tx` (extension.spec.ts:2657-2675). Mutation 335-screens-no-parts: 'Tests 803 passed (803)'. tsc ok.

*Fix:* No code change. Add a wiring test per review.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx:236`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:935`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:3075`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/DappApprovals.tsx:772`, `seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:2657`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (stepper):* **fixed**. Test: Same five tests as pr335#2. The claim is verified: with parts= dropped on the screens, every pre-existing test stays green and only the new case fails.

Duplicate of pr335#2. No code change.

## x-mut-ts#6

**low** · tests · confidence high · lane `stepper`

**#335: clearing the last part's view on a step is tested nowhere, e2e included**

*Claim:* Removing `setView(undefined); setError(undefined);` from the step's effect leaves 65 Vitest tests and tsc green. By reading, the e2e passes too: its assertions wait for the next part's id, which arrives either way. The step's fetch (`[hash]`) and Next disabled on the last part are covered by the e2e alone; Vitest's tx-view-screen tests are static renders.

*Scenario:* The user steps to part 2, and its read is slow or fails (NOT_HELD after the review was replaced, or a lock). Part 1's whole view stays under 'Transaction 2 of 2', with part 1's id in the hash row (data-value is view.detail.txHash), next to part 2's error.

*Evidence:* TxDetail.tsx:131-133: `// Another transaction of the payment: nothing of the last one's stays on screen while it's asked for.` / `setView(undefined);` / `setError(undefined);`. Mutation 335-modal-no-clear: 'Tests 65 passed (65)'. tsc ok.

*Fix:* No code change. Add the seam test below.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:132`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (stepper):* **fixed**. Test: tests/screens-wiring-review-fixes.test.ts › 'asks for the next as it steps, and shows nothing of the last one's under it meanwhile, not for one render'. The claim is verified: on HEAD's TxDetail with the clear removed, all 88 pre-existing tests that import TxDetail pass. The new test fails under the equivalent mutations of the new code: view not tied to its hash, effect keyed on txHash, Next on at the end.

A seam test with TxDetailModal's effects running: the first part's read answers, the second never does, and Next is pressed once the first's view is in. It expects both reads asked, 'Transaction 2 of 2', the second's id, loading, and Next off. It records every render's label, id and body.

## x-mut-ts#7

**low** · tests · confidence high · lane `tail`

**#337: the skip's rethrow of a trap under the pump is untested, though nothing can reach it today**

*Claim:* Swallowing the trap (`.catch(() => undefined)`) leaves all 38 tail tests and tsc green. On HEAD's path nothing can trap there. In the skip's state the chain has nothing in flight and its next transaction is the unwitnessed mix, so pumpChain goes straight to witnessTail, whose first check throws lj.tail.skipped before any WebAssembly runs.

*Scenario:* This only matters after a future change. If the pump ever ran WebAssembly before witnessTail's check (for instance a resend of something in flight), a trap during a by-hand session's skip would be swallowed. advance's step returns early for a session that doesn't run itself, so the wallet would stay unlocked on a broken instance. No reachable case on HEAD.

*Evidence:* sessions.ts:5532-5534: `await this.serial(() => this.pump(network, index)).catch((e: unknown) => { if (isTrap(e)) throw e; });`. sessions.ts:5144: `if (await lovejoin.tailIsOver(...)) throw new Error(t("lj.tail.skipped"));`. Mutation 337-skip-pump-trap-swallowed: 'Tests 38 passed | 41 skipped (79)'.

*Fix:* No code change. Add the test below so the guard survives a reorder.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5532`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5144`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **fixed**. Test: tests/lovejoin-planner.test.ts > "hands on a trap under the press's pump, never swallowing it (x-mut-ts#7)" fails when the press swallows a trap

Test-only. It still holds with the traps lane's change to pump, which now rethrows traps first.

## x-mut-rs#0

**low** · tests · confidence high · lane `bootstrap`

**Since #333 no test makes bootstrap_most's search bind: a cap that skips it passes every Rust and Vitest test**

*Claim:* Every committed assertion on `bootstrap_most` expects either the `most` it was asked or 0:
- the `most` asked: 96 and 12 classic, 64 in a token pool, and 96 and 64 at 6,465;
- 0: for `most` 0, and for a pool whose one box can't be paid.

#333 rewrote the only case where the cap bound below the ask (68 at 6,465). The TS tests ask 96 and 64 at fixture parameters, which fit. So the binary search, and the deposit-size and `MAX_FEE` limits it finds, are untested.

*Scenario:* A later simplification goes through CI green: `fits(most)` instead of the search, or an off-by-one in it.

Today the search binds only in two cases:
- a deposit's fee passes `MAX_FEE` (10 ₳). At `min_fee_a` 1,000 / `min_fee_b` 2 ₳ the cap is 51 classic / 38 LJTEST, and the broken one offers 96.
- `MAX_DEPOSIT_BOXES` is raised past one deposit's size (107 classic / 80 LJTEST today).

The worker asks `mostBootstrap` (96/64). In either case the form offers more boxes than a deposit can hold. The session is funded, its deposit is refused, and it comes back directly with no box in and a second fee.

*Evidence:* HEAD `mod.rs:2020-2032`:
```rust
if most == 0 || !fits(1)? { return Ok(0); }
let (mut low, mut high) = (1, most);
// … binary search …
Ok(low)
```
Before #333 (`git show b2c3940f^1:seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs:1778-1780`):
```rust
assert!((1..96).contains(&dear_most), "{dear_most}");
assert!(bootstraps(&dear, &classic, true, dear_most).is_some());
assert!(bootstraps(&dear, &classic, true, dear_most + 1).is_none());
```
HEAD `:1808-1811` asserts `bootstrap_most(&dear, &classic, true, 96) == 96`.

The mutant, in a copy: `if m == "M_RETURN_MOST" { return Ok(most); }` after the `fits(1)` check.
- It passes all 4 Rust tests that reach `bootstrap_most`.
- On a module rebuilt with it, 20 Vitest files pass: 591 tests.

Probe (HEAD against the mutant):
- asked 200 classic at today's parameters: 107 against 200. A 108-box deposit fails with "This transaction would be 16428 bytes, over the network's limit of 16384".
- fee 1,000 / 2 ₳, asked 96: 51 against 96. A 52-box deposit fails with "This transaction's fee would be 10.028000 ADA, over the wallet's limit of 10.000000 ADA".

*Fix:* One case where the cap binds, in `a_private_bootstrap_is_held_…` or a new test (under 1 s in debug):
```rust
let cap = lovejoin::bootstrap_most(&params(), &classic, true, 200).unwrap();
assert!((96..200).contains(&cap), "{cap}");
assert!(bootstraps(&params(), &classic, true, cap).is_some());
assert!(bootstraps(&params(), &classic, true, cap + 1).is_none());
```
The other surviving cap mutants (M_NO_SWEEP, M_BACK_MORE, M_DEPTH1) are equivalent and need nothing. With the priced reserve the sweep in `fits` can't fail where the deposit builds.

*Files:* `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:2020`, `seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs:1734`, `seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs:1808`, `seedelf-platform/seedelf-core/tests/lovejoin_planner_test.rs:620`, `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-flows.test.ts:499`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (bootstrap):* **fixed**. Test: seedelf-core/tests/lovejoin_pools_test.rs › the_most_a_private_bootstrap_puts_in_is_the_most_that_builds (new). In the outside copy, under M_RETURN_MOST, R_FEES_FIXED and R_DEPOSIT_FIXED: all 43 tests in lovejoin_pools_test.rs and lovejoin_planner_test.rs pass, and so do seedelf-wasm's 3 Bootstrap tests. The new test fails under all three (200 asked returns 200; the fee case gives 0). Passes on HEAD.

Asked for 200 at today's parameters, the cap is 107: that many builds, 108 doesn't (transaction size). At min_fee_a 1,000 and min_fee_b 2 ₳, the cap is 51: 51 builds, 52 doesn't (the wallet's 10 ₳ fee limit).

## x-mut-rs#1

**low** · tests · confidence high · lane `bootstrap`

**The way back's reserve is never tested with other fee parameters: hard-coding today's fees passes everything and brings #333's bug back for fees**

*Claim:* `bootstrap_back_reserve` follows two kinds of parameter:
- `coins_per_utxo_size` (the Seedelf output's least);
- `min_fee_a` / `min_fee_b` (the sweep's and the 16 KiB deposit's fees).

Every test moves only the first:
- both fixtures are 44 / 155,381 / 4,310, so the mainnet assertion at `:1787-1790` repeats `:1783-1786` on the same inputs;
- the core test's dear row is `coins_per_utxo_size * 3 / 2` alone;
- both TS dear rows set `coins_per_utxo_size: "6465"` alone;
- no test sets a fee field for this formula.

*Scenario:* A later edit drops the fee dependence (a constant for the 16 KiB deposit's fee, say) and CI stays green.

At a dearer byte with a dearer fee, a private Bootstrap is again held below one deposit's most. That's the regression #333 fixed (68 classic at 6,465), now for fees:
- 6,465 with `min_fee_a` 66: 75 classic / 56 LJTEST instead of 96 / 64;
- 6,465 with `min_fee_b` 300,000: 74 / 55.

No money is at risk: the cap and the funding share the figure.

*Evidence:* `mod.rs:1746`:
```rust
let sweep = linear_fee(params, TAIL_SWEEP_BYTES).max(crate::build::FIRST_DRAFT_FEE);
```
`mod.rs:1748`:
```rust
let deposit = linear_fee(params, crate::build::MAX_TX_SIZE);
```
Both fixtures: `min_fee_a` 44, `min_fee_b` 155381, `coins_per_utxo_size` "4310".

The dear rows:
- core test `:1797`: `coins_per_utxo_size: params().coins_per_utxo_size * 3 / 2, ..params()`;
- TS: `{ ...(epochParams[0] as object), coins_per_utxo_size: "6465" }` and `t.koios.params = { coins_per_utxo_size: "6465", epoch_no: 291 }`.

R_FEES_FIXED (sweep 200_000 and deposit 876_277 hard-coded) and R_DEPOSIT_FIXED both pass all 4 Rust tests. Probe, HEAD against R_FEES_FIXED (reserve, then cap classic / LJTEST):
- 6,465 with `min_fee_a` 55: 2.0 ₳, 96/64 against 1.8 ₳, 90/64.
- 6,465 with `min_fee_a` 66: 2.2 ₳, 96/64 against 1.8 ₳, 75/56.
- 6,465 with `min_fee_b` 300k: 2.1 ₳, 96/64 against 1.8 ₳, 74/55.
- `min_fee_a` 600: 10.4 ₳, 96/64 against 1.5 ₳, 9/7.

*Fix:* Add a row to the core test with both moved:
```rust
let dearer = ProtocolParameters { coins_per_utxo_size: params().coins_per_utxo_size * 3 / 2, min_fee_a: params().min_fee_a * 3 / 2, ..params() };
assert_eq!(lovejoin::bootstrap_back_reserve(&dearer).unwrap(), 2_200_000);
assert_eq!(lovejoin::bootstrap_most(&dearer, &classic, true, 96).unwrap(), 96);
assert!(bootstraps(&dearer, &classic, true, 96).is_some());
```

*Files:* `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1746`, `seedelf-platform/seedelf-core/src/lovejoin/mod.rs:1748`, `seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs:1783`, `seedelf-platform/seedelf-core/tests/lovejoin_pools_test.rs:1796`, `seedelf-platform/seedelf-core/tests/fixtures/epoch_params_mainnet.json:1`, `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-release-rules.test.ts:503`, `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-flows.test.ts:506`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (bootstrap):* **fixed**. Test: seedelf-core/tests/lovejoin_pools_test.rs › a_private_bootstrap_is_held_to_what_its_funding_pays_its_deposit_and_way_back_for: new row with a dearer fee (min_fee_a × 3/2) beside the dearer byte. It fails under R_FEES_FIXED and R_DEPOSIT_FIXED (left: 1800000) and passes on HEAD.

Asserts the reserve is 2,200,000 at those parameters, that the dearer byte's 1.8 ₳ can't pay 96 boxes there, and that the cap is still 96 and builds.

## x-mut-rs#2

**low** · tests · confidence high · lane `rust`

**Nothing fails without #332's wasm-release overflow overrides (pr332's F2, confirmed by rebuild)**

*Claim:* #332's three `[profile.wasm-release.package.*] overflow-checks = true` sections have no test:
- the Rust tests run the test profile, where overflow is checked either way;
- the WebAssembly node tests pass on a module without the sections;
- Vitest's assertions don't reach an overflow.

*Scenario:* A tidy-up of Cargo.toml (merging profiles, renaming a crate) drops the sections, and CI stays green. The store's module then wraps a u64 overflow to a small, false figure again, where every test build panics: x-release#7, the gap #332 closed.

*Evidence:* In a copy, with the three sections removed and the module rebuilt (`cargo build --profile wasm-release` + `wasm-bindgen`):
- "attempt to add with overflow", "… subtract …" and "… multiply …": 0 each, against 1 each with the sections (and 1 each in the tree's `pkg/seedelf_wasm_bg.wasm`);
- size: 3,206,077 bytes against 3,214,445 (983,009 against 987,533 gzipped);
- `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"`: tests 57, pass 57, fail 0.

*Fix:* Worth having. The cheapest fix that guards the store's zip itself is pr332's line at the end of `build.sh`, since `npm run package` runs build:store → build → build:wasm, which is `build.sh`:
```bash
grep -aq "attempt to add with overflow" "$wasm" || { echo "The module carries no overflow check: Cargo.toml's wasm-release overrides are gone" >&2; exit 1; }
```
A Cargo.toml text check beside `wasm/tests/readme_test.rs` would fail earlier, in CI's Rust tests. It would miss `build.sh` dropping the profile, which the grep catches.

*Files:* `seedelf-platform/Cargo.toml:44`, `seedelf-platform/seedelf-web-wallet/wasm/build.sh:61`, `seedelf-platform/seedelf-web-wallet/extension/package.json:6`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (rust):* **fixed**. Test: Same as pr332#1: seedelf-core/tests/wasm_profile_test.rs

Duplicate of pr332#1. The test runs in CI's cargo test --workspace on any seedelf-platform change, and also fails if build.sh drops the profile.

## x-mut-rs#3

**nit** · tests · confidence high · lane `bootstrap`

**lovejoinBootstrapReserve has no WebAssembly-level test, and its refusal of unreadable parameters is tested nowhere**

*Claim:* No Rust test and none of the 57 node tests call the new binding; only extension Vitest pins it. The node test covers its two sibling reserves, including the sibling's refusal of `"{}"`.

A binding that answers 1.5 ₳ to a row it can't read passes everything that runs on it:
- every Rust test;
- the 57 node tests;
- the 4 Vitest tests that call it.

*Scenario:* Not reachable today. Both callers first ask `lovejoinBootstrapMost` with the same row, and it refuses an unreadable one:
- `mixOutBuild` calls `privateBootstrapMost` at sessions.ts:2023, before `mixFunding` at :2030;
- `privateBootstrapBounds` (lovejoin.ts:2967-2969) does the same.

A new caller that asked for the reserve alone would fund on 1.5 ₳ from a row it couldn't read.

*Evidence:* `lovejoin-reserve.test.mjs:10`:
```js
import { lovejoinCollateralReserve, lovejoinDirectCollateralReserve } from "./wasm.mjs";
```
`:22`:
```js
assert.throws(() => lovejoinDirectCollateralReserve("{}"));
```
Rebuilt modules:
- **W_CONST:** two Vitest tests fail (`expected '1500000' to be '1800000'`).
- **W_SWALLOW:** 57/57 node tests and the 4 Vitest tests pass.

HEAD's module answers `1500000` at the fixture, `1800000` at 6465, and throws `Error: Missing min_fee_a` for `"{}"`.

*Fix:* Three lines in `lovejoin-reserve.test.mjs`:
- `lovejoinBootstrapReserve` at the fixture is `"1500000"`;
- at `coins_per_utxo_size: "6465"` it is `"1800000"`;
- `assert.throws(() => lovejoinBootstrapReserve("{}"))`.

*Files:* `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:5767`, `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin-reserve.test.mjs:10`, `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin-reserve.test.mjs:22`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (bootstrap):* **fixed**. Test: wasm/tests/lovejoin-reserve.test.mjs › 'a private Bootstrap's way back is priced from the parameters (1.7.0's release review, x-mut-rs#3)'. Passes on today's wasm/pkg (node --test: 2 of 2). W_SWALLOW couldn't be built (no WebAssembly builds allowed), so it was simulated by wrapping the real export in JS; the throws line then fails with 'Missing expected exception'.

Three asserts: '1500000' at the fixture, '1800000' at 6465, and a throw for '{}'. Grep confirmed no node or Rust test called the binding before. No Rust change was needed, so the lead's rebuild doesn't affect this test.

## x-mut-rs#4

**nit** · tests · confidence high · lane `bootstrap`

**WebAssembly Bootstrap tests fund the fixed 1.5 ₳ while saying they fund exactly as the worker does**

*Claim:* Since #333 the worker funds a private Bootstrap's way back with `lovejoinBootstrapReserve(params)`. Three seedelf-wasm tests documented as funding "exactly as the worker funds it" still add the constant `BOOTSTRAP_BACK_RESERVE`. At the fixture's parameters the two agree, so these tests reach none of #333's change.

*Scenario:* Two ways this goes wrong:
- **The fixture's row moves to a dearer byte:** these tests fund less than the worker and fail on a test bug.
- **The priced reserve falls under 1.5 ₳:** these tests don't notice; core's `:1783` does.

*Evidence:* `lovejoin_flows_test.rs:324-325`: "its session funded exactly as the worker funds it". `:356`:
```rust
let lovelace = funded.lovelace.parse::<u64>().unwrap() + lovejoin::BOOTSTRAP_BACK_RESERVE;
```
The same constant at `:519` and `lovejoin_test.rs:348`. `sessions.ts:2096`:
```ts
const back = mix.bootstrap ? BigInt(this.deps.wasm.lovejoinBootstrapReserve(JSON.stringify(params))) : 0n;
```
The mutation runs:
- R_CONST, M_FIXED_BACK and R_NO_FLOOR each pass both seedelf-wasm tests;
- only M_ZERO_BACK fails them (flows `:355`, lovejoin `:346`).

*Fix:* Fund with `seedelf_core::lovejoin::bootstrap_back_reserve(&ProtocolParameters::from_koios(&params()).unwrap()).unwrap()`, the worker's figure, in the three places.

*Files:* `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_flows_test.rs:356`, `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_flows_test.rs:519`, `seedelf-platform/seedelf-web-wallet/wasm/tests/lovejoin_test.rs:348`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:2096`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (bootstrap):* **fixed**. Test: wasm/tests/lovejoin_test.rs › a_bootstrap_with_no_collateral_deposits_and_sweeps_back and wasm/tests/lovejoin_flows_test.rs › a_private_bootstrap_of_a_token_pool_deposits_and_sweeps_back. In the outside copy with the fixture row moved to 6,465, HEAD's versions fail on their own funding ('96 boxes, funded 963000000: A Seedelf deposit of these tokens needs at least 2.185170 ADA', and the same for 64 token boxes funded 131000000). The fixed versions pass there (963.3 and 131.3 ₳, as the worker funds) and at the fixture.

All three places now fund bootstrap_back_reserve(&ProtocolParameters::from_koios(&params())), the worker's figure: a back_reserve() helper in the flows test and a local in lovejoin_test. fmt and clippy -p seedelf-wasm --all-targets -D warnings are clean.

## x-scen#0

**low** · correctness · confidence medium · lane `tail`

**A press of Bring the rest back now is lost if it lands while the runner rebuilds the collateral's mix**

*Claim:* skipCollateralMix reads tailHeld and writes tailOver outside the sessions queue (serial). The runner's step rebuilds a stopped chain's collateral's mix inside the queue: buildBack calls tailChain, which found the tail not over, and later recordChain. recordChain hands the tail over only when the old tail isn't over yet (`if (was && !was.over)`). A skip that lands between the two marks the old chain over, but the rebuilt chain keeps a live tail of its own (tries 2, landed carried over). That chain waits for giveme.my again, and the page offers the button again: the press did nothing.

*Scenario:* 1. An auto swap's return stops at its collateral's mix: a lock cut it, or giveme.my refused past GIVEME_BEHIND_MS. The hour since its deposit landed has passed, so the button shows.
2. The unlock wait ends, and the alarm's run or the page's own session-advance poll enters act → bringBack → buildBack → tailChain. That reads the 5 ₳ pool and builds in WebAssembly: a few seconds.
3. The user presses the button in that window. tailOver(old) is written, then recordChain sees was.over and doesn't hand over.
4. Skip's advance pumps the new chain, which asks giveme.my again, and the view returns with collateralHeld again (offerAt already past).
The user must press again, and meanwhile the return keeps waiting.

*Evidence:* sessions.ts:5527 `const held = await this.deps.lovejoin?.tailHeld(network, index);` and :5529 `await this.deps.lovejoin!.tailOver(network, held.id);` run outside serial; only :5537 `return this.advance(network, index, true);` is serialized. lovejoin.ts:4998-5001: `const was = resumes ? s.chains.find((c) => c.id === resumes)?.tail : undefined; if (was && !was.over) { was.over = true; handedOn = true; }`. The scratch test (rebuild built, then skipCollateralMix, then backSubmit) ended with the new chain's tail.over undefined, tries 2, and view.collateralHeld defined.

*Fix:* Run the skip's check-and-set inside the queue: this.serial(async () => { tailHeld; tailOver; pump; step(network, index, "asked"); return one(); }). Call pump, step and one directly, since serial isn't reentrant. Then a rebuild either finishes first and the skip marks the new chain over, or it finds the tail over and builds a plain return.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5526`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4127`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4999`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4387`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **fixed**. Test: same test as pr337#3; it was UNVERIFIED, and it reproduced on HEAD

Duplicate of pr337#3; this is its own proposed fix, the check-and-set in the queue.

## x-scen#1

**low** · ux · confidence high · lane `tail`

**On a session brought back by hand, the way out doesn't bring the rest back, yet the Lovejoin page says it did**

*Claim:* On a site's session, or a swap from before swaps ran themselves, Bring the rest back now only ends the wait. advance's step returns at once for a session that isn't running, so the rest stays at the one-time account until Bring it back and Send. Yet the chain's stop reason is lj.tail.skipped: "You brought the rest back without waiting for the collateral's mix, so the chain stopped there." The Lovejoin page shows it under Chains, and in Your mixes once the chain leaves Chains, while nothing has come back.

*Scenario:* A site's session's return waits at its collateral's mix for an hour, and the user presses the button on the site's page. That page then says "Stopped after N of M transactions; the rest stays at the account until you bring it back", which is right. The Lovejoin page says "Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there." A user reading the Lovejoin page takes the money as back in the private balance, but it stays at the session's account until they bring it back.

*Evidence:* sessions.ts:3446 `if (!s || !running(s)) return;` (advance's step). sessions.ts:5144 `throw new Error(t("lj.tail.skipped"))`, which becomes s.chain.stopped and the chain record's stopped. Lovejoin.tsx:965 `tr("lovejoin.chains.whyStopped", { why: withoutStop(c.stopped) })`. In the PR's own test (lovejoin-planner.test.ts:1814-1825), nothing is submitted after the skip, and the rest needs a separate backBuild.

*Fix:* Word the reason for what happened, e.g. "You chose not to wait for the collateral's mix, so the chain stopped there.", which is true for both kinds of session. Optionally, on a by-hand page the button could go on to build the return's review, as Bring it back does.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:920`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:965`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx:2535`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:3446`, `seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:5144`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **fixed**. Test: tests/lovejoin-planner.test.ts > "says the user chose not to wait, never that the rest came back, …": it checks the Lovejoin page's Chains row reason while the rest is still at the account. It was UNVERIFIED, and this test reproduced it

Duplicate of pr337#1; the reason is reworded.

## x-scen#2

**low** · ux · confidence high · lane `tail`

**The way out's critical note says the mix "is still waiting for giveme.my" in states where it isn't**

*Claim:* tailHeld offers the way out in Case B too, where the chain is no longer being sent and the mix is to be built again (tailBuildable). The mix may then be waiting for any of these:
- after a lock cut, the runner's unlock wait, or a by-hand Bring it back;
- a rebuild after giveme.my refused it past its wait;
- a 5 ₳ pool that can't be read or has too few free boxes (TailWait noPool or fewBoxes).
The critical note lj.tail.privacy.wayOut still opens with "The collateral's mix is still waiting for giveme.my."

*Scenario:* giveme.my refuses the mix past 3 minutes, so the chain stops with "giveme.my wouldn't back the collateral's mix, so the chain stopped there." An hour after the deposit, the site's page offers the way out under "The collateral's mix is still waiting for giveme.my…". The scratch test confirmed collateralHeld is set in exactly that state.

*Evidence:* lovejoin.ts:4131 `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;` (Case B is offered). en.json:922: "The collateral's mix is still waiting for giveme.my. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."

*Fix:* Open with words true in every offered state, e.g. "The collateral's mix hasn't gone yet.", and keep the rest of the note. It's a critical key, so it needs a new blind back-translation for es and ja.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/en.json:922`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:4131`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:1334`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **fixed**. Test: same tests as x-priv#3; it was UNVERIFIED and is reproduced the same way

Duplicate of x-priv#3.

## x-scen#3

**low** · docs · confidence high · lane `docs-design`

**flows.md's Bootstrap paragraph still describes the fixed way-back reserve that #333 replaced (68 boxes, 1.5 ₳ at 6,465)**

*Claim:* #333 changed only "3 ₳ of reserves" to "3 ₳ of reserves at today's prices" in this paragraph. It still says the payment carries "1.5 ₳ for returning the rest", that the cap is "one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)", and that the review's For returning the rest row reads 1.5 ₳. Since #333 that reserve is priced from the parameters (1.8 ₳ at 6,465), and the cap there is one deposit's most: 96.

*Scenario:* Someone checks the 6,465-lovelace case against flows.md, which says 68 boxes and 1.5 ₳. The wallet offers 96 boxes, and the review shows 1.8 ₳ For returning the rest.

*Evidence:* flows.md:523: "1.5 ₳ for returning the rest … (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)". `git diff --word-diff b2c3940f^1 b2c3940f -- docs/flows.md` shows only `[-reserves,-]{+reserves at today's prices,+}`. lovejoin-flows.test.ts:507 `expect(await lj.privateBootstrapBounds("preprod")).toEqual({ most: 96, back: "1800000" })`. lovejoin_pools_test.rs:1809 asserts bootstrap_most(&dear, &classic, true, 96) == 96. architecture.md was updated correctly ("1.8 ₳ at 6,465 … where a fixed 1.5 ₳ held it to 68").

*Fix:* Say the way back's reserve is priced from the network's parameters (1.5 ₳ today, never less), so one deposit's most goes at a dearer byte too, and drop the 68. The review row is that priced figure. privacy.md:198's "1.5 ₳ for its way back" can take "today" the same way.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/flows.md:523`, `seedelf-platform/seedelf-web-wallet/docs/privacy.md:198`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **fixed**. Test: docs-only (was UNVERIFIED, holds): as x-docs#1

Duplicate of x-docs#1.

## x-scen#4

**low** · docs · confidence high · lane `docs-design`

**architecture.md and lovejoin-pools.ts's header still say a listed pool's existence is the server's word and the ledger's, not Koios's**

*Claim:* #336 keeps a pool from the data layer's list that's new to the device only once Koios finds it: the launch's tx_info, and L's registration. It updated privacy.md and the policy but not architecture.md or the module's header comment, so both still describe the old trust.

*Scenario:* A maintainer reasoning about a lying server or a deep rollback reads architecture.md. It says a listed pool's being finished is the server's word and its being on chain the ledger's to judge, while the code now confirms both from Koios first.

*Evidence:* architecture.md:732: "that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below). Whether a pool is on chain at all is the ledger's to judge, not the server's". lovejoin-pools.ts:34: "so the ledger is the judge of that". refresh: `await this.keep(network, await this.confirmed(network, found));`.

*Fix:* Say a pool new to the device is kept only once Koios's chain data finds it as the holder look would (confirmed, then launched). Only its launch position stays the server's word, with the ledger's reference-input check still behind it.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/architecture.md:732`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:34`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (pools):* **partly**. Test: None: a docs and comments finding. I checked the claim against the code; it held.

Fixed the comments in lovejoin-pools.ts: the header's data-layer bullet, refresh()'s doc and inline comments, and confirmed()'s doc. They no longer say 'the ledger is the judge'; they describe the Koios check, its utxo_info rows, the background check and lastListed. docs/architecture.md:732 belongs to the docs-design lane, which has the same finding; the facts it needs are in docs_notes.

*Outcome (docs-design):* **fixed**. Test: docs-only (was UNVERIFIED, holds): as x-docs#3

Header comment fixed by the pools lane; architecture.md here.

## x-scen#5

**low** · docs · confidence high · lane `docs-design`

**privacy.md doesn't mention the new way out that leaves the collateral's box unmixed**

*Claim:* The privacy design doc says the session's 5 ₳ box waits unmixed and tied to the session only "past that, or a day after the deposit landed". Since #337 the user can choose that an hour after the deposit (Bring the rest back now), and Bring every box back now then takes the box unmixed. #337 updated flows.md and architecture.md, not privacy.md. The policy needs nothing, since no data handling changed.

*Scenario:* Someone checks privacy.md for when a session's 5 ₳ box can be left unmixed and tied to the session. It names a refusal, a lock or a day, never the user's own choice after an hour.

*Evidence:* `grep "Bring the rest back" docs/privacy.md` finds nothing. privacy.md:217: "past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session as any deposit's box is".

*Fix:* Add one clause: or, from an hour after its deposit landed, on the user's word (Bring the rest back now), the box waits the same way, tied to the session until mixed again.

*Files:* `seedelf-platform/seedelf-web-wallet/docs/privacy.md:217`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (docs-design):* **fixed**. Test: docs-only (was UNVERIFIED, holds): as x-docs#8

Duplicate of x-docs#8.

## x-scen#6

**low** · tests · confidence high · lane `tail`

**The way out has one worker test, for a by-hand session; auto sessions, Case B and the pages are untested**

*Claim:* The only worker test covers a site's session whose chain is still being sent (Case A). Nothing tests:
- an auto swap or mix, where the skip's advance must send the direct return at once;
- Case B, a stopped or cut chain whose mix is to be built again;
- where CollateralHeldWayOut is placed: Swaps (auto and by hand), SiteSessions, and MixCard with onSkipCollateral.
Only the component itself is rendered in a test.

*Scenario:* If skipCollateralMix stopped calling advance, an auto swap's rest would wait after the press, and no test would fail. If MixCard's condition went wrong, a mix's card would show no button, and no test would fail either.

*Evidence:* `grep -rln "collateralHeld|skipCollateralMix|collateral-held|session-skip-collateral-mix|TAIL_OFFER_MS" tests e2e` finds only lovejoin-planner.test.ts and collateral-held.test.ts.

*Fix:* Add a worker test with an auto mix session: skip after the hour, then assert the return is submitted in the same call. Add a Case B view-and-skip test, and a MixList render with a mix session carrying collateralHeld.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-planner.test.ts:1791`, `seedelf-platform/seedelf-web-wallet/extension/tests/collateral-held.test.ts`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **fixed**. Test: the two pr337#2 planner tests, plus tests/screens-wiring-review-fixes.test.ts's new describe (each page test fails with its render deleted) and tests/collateral-held.test.ts's mix-card tests

Test-only. It covers an auto mix session, Case B (lock cut), and the placements on Swaps (auto and by hand), SiteSessions and MixCard.

## x-scen#7

**nit** · ux · confidence high · lane `tail`

**On a page that doesn't poll, the way out appears only after a Refresh once its hour comes**

*Claim:* CollateralHeldWayOut reads `now = Date.now()` as it renders. The site's session page and a by-hand swap's page have no timer of their own (Dapps re-reads only on Refresh), so left open across the hour they never show the button. The auto swap page and the Lovejoin hub poll, so they do.

*Scenario:* The user opens the site's session page 59 minutes after the deposit and waits. The button never appears until they press Refresh.

*Evidence:* LovejoinReturn.tsx:540 `now = Date.now(),` and `if (!held || now < held.offerAt) return null;`. SiteSessions renders it with no interval. Dapps.tsx passes `onRefresh={() => void load(true)}` only.

*Fix:* Re-render at offerAt (a timeout in the component), or poll the site's page while its chain is held.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/ui/components/LovejoinReturn.tsx:540`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/SiteSessions.tsx:411`, `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Dapps.tsx:235`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (tail):* **not-a-bug**. Test: none: same reason as x-ui#4

Same as pr337#5(b).

## x-scen#8

**nit** · ux · confidence high · lane `stepper`

**After a payment's Send fails partway, the stepper opens no part, even the ones still kept**

*Claim:* submitWatched removes the kept record when the first part's submit succeeds, and that record is the one carrying partHashes. If a later part then fails, the review stays on screen with worker.parts.partly. Its Transaction details stepper finds no part: the first and the sent parts are gone, and those still kept under partKey can't be found without partHashes. Each says "That transaction isn't one the wallet is holding. Review it again."

*Scenario:* Send privately with Max over 40 UTxOs, and part 2 is refused, so the review shows "1 of 3 transactions went…". Transaction details then calls every part not held, part 3 included, though it's still kept.

*Evidence:* pending.ts:524 `await session.remove(s.key);` (s.key is the first part's key, sendParts i=0). tx-view.ts:157-161 finds a later part only via `partOf(record, wanted)` on the first part's record.

*Fix:* Leave it, since the error asks for a new review anyway. Or keep partHashes on each later part, so a part still kept stays viewable.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts:524`, `seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:150`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (stepper):* **deferred**. Test: A scratch test (deleted) reproduced it. Max over 41 UTxOs, part 2 refused at Send: '1 of 2 transactions went…'. Part 2 is still kept under seedelf.transfer.built.1 and the first's record is gone, yet txView says NOT_HELD for both parts.

Verified. Left as is, per the finding's first option: Send pressed again refuses as sent already (send → refuseSent), so the kept parts can never go from that review. Showing them would present transactions that never go, and 'Review it again' matches worker.parts.partly.

## x-upgrade#0

**medium** · correctness · confidence high · lane `rust`

**A pool row 1.6.0 kept, which verified only by wrapping a doubled NFT to one, traps 1.7.0's module on every pool read; Koios-only doesn't avoid it**

*Claim:* 1.6.0's module had no overflow checks, so eval::resolve's `+= quantity` wrapped. A data-layer reference row naming the pool's NFT twice (2^64-1 and 2) summed to 1 and verified. 1.6.0 had no Koios confirmation, so it kept the row verbatim (slim keeps ref.reference) in seedelf.lovejoinPools.<network>. 1.7.0 checks core's overflow (#332), so the same row now traps in lovejoinVerifyPool. Nothing in 1.7.0 re-examines it: it is 'known', so confirmed() and holder() skip it. known() hands it over from local storage with no request, so readSet's quiet reads and Settings' Koios-only reach it as well. x-overflow #1 names Koios-only as the way out for a row listed fresh; for a row already kept it isn't one.

*Scenario:* 1. During 1.6.0's life, a lying or compromised data layer lists a real pool's reference outpoint, seed and scripts with the NFT doubled, and a 1.6.0 mainnet device keeps it.
2. 1.7.0 installs.
3. Every pool read traps, rethrown by verifiedPool, and locks the wallet: the Lovejoin page, a swap review's room read, a session return's quiet look (tailChain, watchOf), a due Lovejoin withdraw in the alarm's run.
4. Unlock, and the next read locks it again.
5. Neither the server fixing its list nor Koios-only helps. Only Remove wallet clears it, by deleting the record, and until then the device can't bring its boxes back.

*Evidence:* git show babb8e76:seedelf-platform/Cargo.toml: [profile.wasm-release] has no overflow-checks; HEAD Cargo.toml:51-58 adds them for core, crypto and koios. eval.rs:148-152: `*tokens.entry(..).or_default().entry(..).or_default() += quantity;`. lovejoin-pools.ts:626 slim() copies p.ref.reference unchanged; :350 kept() reads stored pools; :568 and :498 skip known refs. lovejoin.ts:2736 `view = JSON.parse(this.deps.wasm.lovejoinVerifyPool(...))`, with `if (isTrap(e)) throw e;`.

A scratch test (tests/zz-review-x-upgrade-1.test.ts, deleted) used the real wasm/pkg and PoolDiscovery. Its setup: a stored 1.6.0-shaped record with preprod's bundled 5 ADA pool, its NFT listed as 18446744073709551615 and 2; index: async () => undefined (Koios-only); a Koios that records any call. Results:
- serviceDeps(d).known and .pools handed the row over, with asked = [].
- lovejoinVerifyPool on it: `RuntimeError: unreachable isTrap: true`.
- The control, with the NFT once, verified.

*Fix:* x-overflow #1's fix: checked_add in eval::resolve, refusing in words, so the kept row fails verification in words and verifiedPool leaves it out of the read set. It must be in the 1.7.0 build itself: a server-side fix can't reach a row already kept on the device.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:454`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:381`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:626`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:568`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:498`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:2709`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:2722`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts:2736`, `seedelf-platform/seedelf-core/src/eval.rs:148`, `seedelf-platform/Cargo.toml:51`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (rust):* **fixed**. Test: Same as x-overflow#0: the core eval_test and the node test. The finding's extension test with the real module over a stored 1.6.0 record was not written; it repeats the node test plus wasm-review-fixes.test.ts's 'A refusal in words is only a pool left out', and could only pass after the rebuild.

A row 1.6.0 kept, which verified only by wrapping, now fails verification in words inside the 1.7.0 module, so verifiedPool leaves it out of the read set with no lock, under Koios-only too.

## x-upgrade#1

**low** · ux · confidence high · lane `stepper`

**A payment in parts waiting when the update lands: the rest never go, and nothing says so once Koios took the part before**

*Claim:* The waiting record lives only in session storage (seedelf.waiting.<network>). A part's sealed copy, which carries `parts`, is dropped as soon as Koios takes it (unseal). After an ordinary submit of the part before, nothing durable says more parts are due. An update clears session storage with no lock countdown; the parts warning is the lock's alone. After the unlock, Home hears nothing, and the rest never go. handlers.ts's `stopped: "locked"` path needs a watch that survived the wipe, which only a maybe-sent one does. parts.ts's header says the part's progress is 'sealed with it, so Home says it went in part', but that holds only until Koios answers. Session fundings are covered by their record's `waits` parts going missed; plain Send and Make public aren't. This is pre-existing since 1.6.0. The 1.6.0 to 1.7.0 update is the first update that can land on a payment in parts, and it does so unprompted.

*Scenario:* 1. A 1.6.0 user sends tokens in parts, with part 2 chained to wait for part 1's block, then closes the window.
2. With the worker idle between alarm ticks, Chrome installs 1.7.0.
3. After unlocking, Home's banner is empty.
4. The payee got part 1 only, and part 2's tokens stay in the private balance. Nothing tells the user the payment stopped partway. The history shows part 1 with its own figures, so no amount is misstated.
5. The same happens after any closed browser and after every later update.

*Evidence:* parts.ts:8-17: 'The parts that wait are held in session storage...'. pending.ts:880: `if (taken) await unseal(deps, w);`. handlers.ts:246-250: the cut path needs `pending` from the watch.

A scratch test (tests/zz-review-x-upgrade-2.test.ts, deleted) ran on test wallet A's two-part shape through the worker's handler:
- Before: Home hears {"parts":{"sent":1,"total":2}}, 'Private payment not confirmed yet 1 more to go, once the one before lands.', and sealed maybeSent.preprod is undefined.
- Then: lock, session.clear(), a restarted worker's services, unlock.
- After: pending-tx is null. After part 1 lands, pump is false, 1 is submitted, and pending-tx is still null. parts-waiting is false.

*Fix:* Nothing in 1.7.0 can recover this update's own instance, because 1.6.0 left no trace of it. For a closed browser and later updates (the owner's call whether it belongs in 1.7.0):
- Seal a small record while parts wait: the first hash, sent, total and when. Write it with holdWaiting, and remove it when the last part goes or the parts stop.
- In pending-tx, read it when neither the watch nor the parts' record has the payment, and answer parts {sent, total, stopped: 'locked'}.
- Correct parts.ts's header: a part's `parts` is sealed only until Koios answers it.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/parts.ts:8`, `seedelf-platform/seedelf-web-wallet/extension/src/background/parts.ts:33`, `seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts:385`, `seedelf-platform/seedelf-web-wallet/extension/src/background/pending.ts:880`, `seedelf-platform/seedelf-web-wallet/extension/src/background/handlers.ts:237`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (stepper):* **partly**. Test: A scratch test (deleted) reproduced it on wallet A's two-part shape. Before the wipe, Home hears parts {sent:1,total:2} '…1 more to go…', and maybeSent.preprod is already unsealed. After lock/wipe, a restarted worker and unlock, pending-tx is null. After part 1 lands, pump is false, pending-tx is still null, and only 1 transaction was ever submitted.

Corrected parts.ts's header (comment only): a lock, a closed browser or an update wipes what waits, and only the lock is warned of. The watched part's progress is sealed only until Koios takes it or it's settled, so after a wipe nothing says the rest didn't go. The code fix (a sealed progress record) is the owner's call. Nothing in 1.7.0 can recover this update's own instances: 1.6.0 left no durable trace.

## x-upgrade#2

**owner-call** · privacy · confidence medium · lane `pools`

**Pools 1.6.0 took from the data layer are never confirmed: #336 checks only pools a device doesn't hold (my idea)**

*Claim:* 1.6.0's data-layer path kept every listed pool with no check that its launch is on chain or that L is registered. 1.7.0's confirmed() passes every pool the device already holds ('Pools already held aren't asked about again', #336's body), and holder() skips them too. 1.6.0's mainnet head start bundled no pool. So every token pool a 1.6.0 mainnet device holds came from the data layer (the default) or Koios's look, and the data layer's stay unconfirmed for good after the update. That is exactly the population #336 was written for. The honest data layer applies the same rule from db-sync (seedelf-data/api/src/lovejoin/db.rs). The residual risk is a server that lied, or db-sync on a fork later rolled back, during 1.6.0's life.

*Scenario:* A pool 1.6.0 took whose launch isn't on chain (rolled back), or whose L was never registered. After the update, 1.7.0 still shows it and offers it for new boxes. A deposit into it fails, or its boxes can't be mixed, while #336's check never runs for it.

*Evidence:* lovejoin-pools.ts:568 `const fresh = found.filter((p) => !known.has(refOf(p.ref.reference)));` and :583 `return found.filter((p) => known.has(refOf(p.ref.reference)) || ok.has(...))`. :498 `if (known.has(refOf(r)) || !holdsNft(r)) return [];`. `git show babb8e76:seedelf-platform/seedelf-web-wallet/extension/src/lovejoin-pools.json`: mainnet height 14110720, pools [] (0). 1.6.0's refresh: `await this.keep(network, found)` with no Koios check.

*Fix:* The owner's call. Options:
- Accept as is.
- On 1.7.0's first data-layer refresh per network, run launched() once over held pools not in the bundled head start, and mark them confirmed in the record. One that fails stays in the read set (STATE-2: the wallet's boxes may be there) but takes no new box, as a copy doesn't. The cost is one tx_info batch and at most one account_update_history, once.
- Also re-read held reference rows from Koios, in pr336 F1's direction. That would also replace a row like finding 1's with the chain's.

*Files:* `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:565`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:583`, `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin-pools.ts:498`

*Verified:* not by the review (stopped); the fix lane reproduced it first, or checked it against the code.

*Outcome (pools):* **owner-call**. Test: None: an owner's call, not built.

Recommendation: accept as is for 1.7.0. The only mainnet pool a 1.6.0 device can hold is the 5 ₳ ADA pool, which 1.7.0's head start carries as Koios read it at release. During 1.6.0 the data layer was ours and applied the same rule from db-sync. Marking a pool that fails a later check as taking no new box would be a new guard. If the owner wants more, the option that refuses nothing is to recheck held rows once with Koios and replace any that differ, or to let the head start's row win over a stored one for the same outpoint.

