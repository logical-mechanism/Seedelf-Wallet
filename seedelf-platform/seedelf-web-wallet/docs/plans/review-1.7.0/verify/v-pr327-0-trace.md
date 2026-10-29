# v-pr327-0-trace: pr327#0, the release refreshes' Node trusts emSign ECC Root CA - G3

**Verdict: confirmed. Severity: low.** Every factual claim holds on this box and on HEAD (`6bca8bec`), and none of the code defends against it. A few details are slightly off (below). None of them narrows the finding.

It's an environment gap at the release step, not a defect in any PR in #325 to #338. Nothing in the range touched `scripts/`, `src/tokens`, `src/dreps`, `src/lovejoin-pools.json` or the head-start test. The only change to `development.md` in the range is the CI paragraph.

## The decisive test (offline, no real host)

I forged chains in `scratchpad/review/v-pr327-0-trace/` with the openssl CLI:

- **The G3 chain.** A leaf for `localhost` under an intermediate whose issuer DN and Authority Key Identifier are G3's (`7C:5D:02:84:…:63:42`), signed by a P-384 key of ours.
- **The C3 control.** The same, naming emSign ECC Root CA - C3.
- **The unknown-root control.** A chain to a root in no store.

`openssl verify` against the real G3 gives `error 7 at 1 depth lookup: certificate signature failure`: OpenSSL found G3 as the anchor, and only the signature failed. An attacker with a real compromised G3-chained intermediate passes that step.

A local HTTPS server presented each chain, and Node fetched it:

| Client | G3 chain | C3 chain | unknown root |
|---|---|---|---|
| `node` v24.19.0 (as `npm run tokens`/`dreps`) | CERT_SIGNATURE_FAILURE (G3 trusted) | CERT_SIGNATURE_FAILURE | UNABLE_TO_GET_ISSUER_CERT_LOCALLY |
| `--use-system-ca` | CERT_SIGNATURE_FAILURE (G3 trusted) | CERT_SIGNATURE_FAILURE | UNABLE_TO_GET_ISSUER |
| `--use-openssl-ca` / `NODE_OPTIONS=--use-openssl-ca` | **UNABLE_TO_GET_ISSUER** (G3 absent) | CERT_SIGNATURE_FAILURE (OS store in use) | UNABLE_TO_GET_ISSUER |
| v22.22.3 | CERT_SIGNATURE_FAILURE | | |

The scratch test `extension/tests/zz-review-v-pr327-0-trace-1.test.ts` ran the same check inside Vitest, the environment `npm run lovejoin-pools` writes from (`vite.config.ts:145` `environment: "node"`):

1. G3 is not in `tls.getCACertificates("default")`.
2. Global `fetch` doesn't find G3 for the forged chain.
3. `new Koios(base)` with its default fetchFn (`koios.ts:767` `(url, init) => fetch(url, init)`, as `lovejoin-pools-head-start.test.ts:63` builds it) doesn't find G3 either. `tipSlot()` was watched on `globalThis.fetch` while still calling the real fetch.
4. A control: the unknown root is refused.

**On HEAD with the box's Node: 3 of 4 fail.** Assertion 1 got `true`. Assertions 2 and 3 got `CERT_SIGNATURE_FAILURE`, three times for the Koios client's retries. The control passes.

**With `NODE_OPTIONS=--use-openssl-ca`: all 4 pass.** The test is deleted.

Last, `node --use-openssl-ca` against a real host (github.com) gave `authorized: true`. Node's static OpenSSL has `OPENSSLDIR: "/etc/ssl"`, and `/etc/ssl/certs` has no link for G3's subject hash `14bc7599`.

## The claims, checked

- **The Node.** `which node` gives `~/.nvm/versions/node/v24.19.0`, and `~/.nvm/alias/default` is `lts/*` (→ `lts/krypton` → v24.19.0, aliases last refreshed Aug 15). NODE_OPTIONS, NODE_EXTRA_CA_CERTS, NODE_USE_SYSTEM_CA and SSL_CERT_* are unset, and neither the profile nor the project sets them. There's no `.nvmrc`. `engines` is `"node": ">=22"`, and `node --help` says `--use-bundled-ca  use bundled CA store (default)`.
- **The stores.** The bundled store has 120 certificates and holds G3 (`86:A1:EC:BA:…:6B`), plus G1, C1 and C3. With `--use-system-ca` the default store has 482, G3 included.
- **Node's tags.** `gh api` read `node_root_certs.h` at each tag. G3 is present at v24.19.0 and v22.22.3, and absent at v24.22.1, v24.22.2, v22.23.4 and v26.13.0, where G1 is the only emSign root left. v24.22.1's notes: "crypto: update root certificates to NSS 3.131.1". v24.22.2 is the newest v24 (2026-10-28).
- **The OS store.** It's `ca-certificates 20260816ubuntu0.26.04.1`, and its changelog (2026-10-20) says "Blacklist … emSign ECC Root CA - G3 due to intermediate cert compromise". `/etc/ca-certificates.conf:153` has `!mozilla/emSign_ECC_Root_CA_-_G3.crt`, and the bundle has no G3.
- **The fetches.**
  - `scripts/tokens.mjs`: `:24` KOIOS, `:30` `await fetch(url, {`, `:103` writeFileSync.
  - `scripts/dreps.mjs`: `:29` KOIOS, `:50` `await fetch(url, {`, `:125` writeFileSync.
  - These two are the only fetching files in `scripts/`. `package.mjs` and `third-party.mjs` don't fetch.
- **The release steps.** `package.json:19-21` defines the three scripts, and `development.md:183-185` runs all three at release.
- **What ships.** `src/ui/tokens.ts:13` and `src/ui/dreps.ts:7` import the two lists, and `src/background/lovejoin-pools.ts:57` imports `../lovejoin-pools.json`.
- **The DRep rename gets through.** `dreps.mjs:107-112` keeps a committed name only `if (registered.has(id) && !named.has(id))`, so a forged name wins. `MAX_LOSS` (`:114`) only bounds the count. The release step (`development.md:275`) is "Skim the diff for anything odd".
- **No warning.** `src/ui/screens/Voting.tsx:444-448` (`drepSharing`) and `:495` (`{shared > 1 && (`). With the well-known DRep renamed away and the attacker's DRep listed under its old name, the warning stays silent: `listed` is true, and `shared` is 1.
- **The token refresh.** The ticker must match, and decimals, name and logo come from the answer. The "also claimed by" check reads the same Koios.
- **The pools file.** It's never a gate: the head-start test verifies each bundled pool from the bundled templates. A forged file could still omit pools or overstate `height`, so new installs would look from too late. That's a denial, not a loss.
- **npm ci.** All 101 lockfile packages carry `integrity`, and none resolves outside registry.npmjs.org.

## What's slightly off

1. **"(and C1, C3) … The OS store and certifi 2026.10.23 no longer do."** The OS store still trusts C1 and C3, since Ubuntu blacklisted G3 alone. The advisory concerns G3 only ("Eight eMudhra intermediate CA certificates that chain to this root"). Only certifi dropped C1 and C3.
2. **Citations.**
   - The ticker check is `tokens.mjs:87-89`; `:10` is the header comment.
   - `Voting.tsx` is `src/ui/screens/Voting.tsx`.
3. **"That's unlikely" understates it a little.** In the discuss.python.org thread the advisory cites, tiran's reply says "All 8 eMudhra CAs had private keys with d < 256". I didn't verify that. If it's right, the "holds a compromised key" precondition is open to anyone, and only the on-path position at refresh time is left. It's still low: the attacker needs a targeted on-path position at the moment of the refresh, plus a diff skim that misses the change, and the harm is to bundled lists (DRep search and warning, token display data, the pools head start), not funds directly.
4. **1.6.0's refresh had the same exposure.** It ran on 2026-10-25 (`8cd8ce08`), after the advisory (10-20) and after Node's fix (10-21), on the same v24.19.0. Its diff was tiny: tokens unchanged, one DRep added (GNP1_DRep), one preprod pool. 1.7.0's refresh on a fixed Node also re-checks those committed lists, since a fresh pass overrides a committed name.

## Fix advice (no repo change)

- **The finder's check proves nothing under `--use-openssl-ca`.** In that mode `tls.getCACertificates("default")` is empty, so it exits 0 regardless. It's a valid check for the Node-upgrade route only. For the OpenSSL-CA route, check `/etc/ssl/certs` for hash `14bc7599`, or use a forged-chain fetch like the one above.
- **Pin the default to 24, not `lts/*`.** Node 26 became LTS today (v26.13.0 'Lithium', 2026-10-28). nvm 0.39.5 rewrites `lts/*` from the full remote index on any `nvm install` (`nvm.sh:1508-1527`). So after `nvm install 24`, the default `lts/*` would point at an uninstalled 26, and there's no system node. Use `nvm install 24 && nvm alias default 24`. That also keeps the packaging inside `development.md:287`'s "Official Node builds 20 to 24 zip alike".
- **Or leave Node alone** and prefix only the three refreshes with `NODE_OPTIONS=--use-openssl-ca`. Shown above to drop G3 and still verify real hosts.
- **A minimum Node in `development.md`'s step 1 is the owner's call.** The finding says the same.

## Aside, not the wallet (for cli_notes if wanted)

\#327's body says pip "has used the OS store via truststore since 24.2". The same forum thread (tiran) says pip < 26.2.2 always loads its vendored certifi *in addition to* the system store, so it keeps trusting G3 whatever the OS does. The happy-path venv here has neither pip nor certifi installed, so there's nothing to check locally.

Scratch files deleted: the in-tree test and `scratchpad/review/v-pr327-0-trace/`. `zz-review-v-pr327-0-impact-1.test.ts` is another agent's and was left alone.
