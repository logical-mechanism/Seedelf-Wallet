# Verify `pr326#4` (trace): tor-js's HTTPS runs on an alpha crypto provider, a cost the doc leaves out

**Verdict: confirmed. Severity: nit** (as filed). It's a parked idea in a roadmap doc, so nothing in 1.7.0 changes.

I tried to refute it three ways, and none held:
- tor-js might reach TLS some other way, or let the caller choose it;
- another doc on HEAD might already weigh it;
- "alpha, unaudited" might overstate the crate.

## The trace (tor-js clone at `8977093`, read as text, nothing run)

The clone is the spike's: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6b05df79-ccf4-4e6d-9648-1dad8d04a5d0/scratchpad/dl-torjs/tor-js`, `git log -1` = `8977093`, `package.json` `"version": "0.4.3"`.

The route the doc costs is `client.fetch()` on an `https://` URL to the data layer or giveme.my. It runs:

1. `crates/tor-js-wasm/src/lib.rs:326-328`: `TorClient::fetch` passes `self.tls_config` to `fetch_impl`.
2. `lib.rs:441`: that config is always `tls_config: make_tls_config(),`.
3. `lib.rs:445-452`: "Build a rustls ClientConfig with the Mozilla CA bundle (compiled in via webpki-roots)". The config is built with `rustls_rustcrypto::provider()` and `root_store.extend(webpki_roots::TLS_SERVER_ROOTS…)`.
4. `lib.rs:538`: `let is_https = url.scheme() == "https";`, then `:558` calls `fetch::fetch_headers(…, is_https, host, Some(tls_config))`.
5. `fetch.rs:636-664` (the connect at `:641-650`): `if is_https { … futures_rustls::TlsConnector::from(tls_config) … connector.connect(server_name, stream) }`. The TLS runs over the Tor stream, inside the WebAssembly.
6. **Nothing from JS can change this.** `TorClientOptions` (`lib.rs:223-231`) holds only `connect`, `storage` and `fast_bootstrap`, so the provider and the roots are fixed.
7. `Cargo.toml:41-45`: "TLS for HTTPS over DataStream (rustls with pure-Rust crypto for WASM)", `rustls-rustcrypto = "0.0.2-alpha"`, `webpki-roots = "1.0.10"`.
8. `Cargo.lock` locks the same versions: rustls-rustcrypto `0.0.2-alpha` (checksum `f1205294…5557`), webpki-roots `1.0.10`, rustls `0.23.46`.
9. `src/runtime.rs:8` is as quoted: "TLS: Uses rustls with rustls-rustcrypto (pure-Rust crypto for WASM)".

**Roots fixed at each release.** `src/entryPoints/wasm-file/index.ts` loads the npm package's prebuilt `../../tor_js_bg.wasm` from beside the module. So the roots are those of whichever tor-js release the wallet bundles, at the wallet's release. Chrome's root store updates on its own schedule.

**More than the finding said:**
- **No revocation check.** In rustls 0.23.46 (the locked version, read from the local cargo registry), `src/client/builder.rs:51-61` has `with_root_certificates` build `WebPkiServerVerifier::new_without_revocation(root_store, algorithms)`.
- **No Certificate Transparency policy.** rustls has none: only the SCT extension's enum value appears in its source.

**"Alpha, unaudited."** I fetched the published crate once from static.crates.io (read-only). Its sha256 equals the lock's checksum. Its `README.md` says:
- :12: "⚠️USE THIS AT YOUR OWN RISK! DO NOT USE THIS IN PRODUCTION⚠️";
- :14: "only few selected TLS suites implemented … neither did rustls nor RustCrypto packages were formally verified and certified with FIPS compliance".

So "alpha" is literal. "Unaudited" is the reviewer's word: the crate's own warning is stronger.

tor-js's README (:9-15) adds "Experimental" and "It is your responsibilty to decide whether tor-js meets your security requirements."

**Today, by contrast,** every request the wallet makes runs on Chrome's TLS:
- `seedelf-koios/Cargo.toml:15`: `reqwest = { version = "0.12.9", features = ["json"] }`, whose wasm32 client is the browser's fetch;
- post-release-roadmap.md:95: the rustls chain "genuinely never builds".

## The doc on HEAD

- post-release-roadmap.md:341, *And in the extension*, lists three things:
  - the offscreen document (no `RTCPeerConnection` in the worker);
  - the CDN entry being remote code, so `tor-js/wasm-file` would be bundled;
  - 1.9 MB gzipped.
  It says nothing about TLS.
- The only TLS mention in the whole Tor bullet (:333-347) is the gateway's "no domain or TLS certificate" (:335).
- `git grep` over HEAD's docs and both READMEs finds no `rustcrypto`, `webpki`, "CA bundle", "root cert" or "Chrome's TLS".
- No PR after #326 touched the Tor text (`git diff 5abd5470 6bca8bec` on the roadmap leaves it alone).

## The scratch test

`extension/tests/zz-review-v-pr326-4-trace-1.test.ts`, run alone with `npx vitest run`, then deleted. Result: **2 failed | 1 passed**.

- ✓ The clone half. It asserts:
  - the Cargo.toml pins;
  - `rustls_rustcrypto::provider()` and `webpki_roots::TLS_SERVER_ROOTS` in `make_tls_config`;
  - `tls_config: make_tls_config(),`;
  - the `is_https` branch;
  - fetch.rs's `TlsConnector::from(tls_config)`;
  - no `tls`, `root` or `cert` field in `TorClientOptions`.

  It passed for real, not skipped: the evidence holds.
- × The doc half, which fails on HEAD if the finding is real:
  - the `**And in the extension:**` line matching `/rustls|rustcrypto|TLS|root cert|certificate/i`;
  - the whole Tor bullet matching `/rustls|rustcrypto|webpki|root cert|CA bundle|Mozilla|Chrome's TLS/i`.

  Both failed: the omission is real.

## Narrowing, for the fix

**The cost is specific to clearnet `https` through tor-js:**
- An onion service reached over `http://` takes the `else` branch (`fetch.rs:665`, after the TLS branch at `:636-664`): no rustls. The onion address authenticates the service, through Arti's onion-service client in the same WebAssembly. So it's still not Chrome's TLS, but it's not the alpha provider either.
- #326 removed the old text's "Onion services for the data layer and giveme.my are then possible". :334 now says only "`.onion` included".

**Bring your own Tor (:343) keeps Chrome's TLS.** Chrome's own stack does TLS end to end through the SOCKS proxy. That's a point in that route's favour, and the doc doesn't make it.

**Why it matters more over Tor than direct.** For a clearnet host, TLS is the only thing between the Tor exit relay and:
- the private side's requests (submits' CBOR, giveme.my's requests, the private index's cursor);
- the answers the wallet acts on.

A weak provider fails exactly where the route most needs TLS.

**Not a separate cost:** tor-js's Tor link to the guard (`runtime.rs:618-652`, `WasmTlsConnector`) uses the same provider, with WebPKI skipped by design (`:677`: "Skip cert validation — Tor validates via CERTS cells"). That's normal for Tor, and the circuit's own crypto sits on top.

## Fix advice

One clause at the end of :341, for example:

> "Its HTTPS would be its own too: rustls on `rustls-rustcrypto` 0.0.2-alpha (its README: "DO NOT USE THIS IN PRODUCTION"), with Mozilla's roots compiled in and no revocation check, so for a clearnet host the private side's TLS, all that stands between it and a Tor exit, would leave Chrome's, its roots as old as the tor-js bundled. An onion service over `http://` skips it, and bringing your own Tor keeps Chrome's."

Quote the crate rather than say "unaudited".

## Not checked

- npm's 0.4.3 tarball against the clone (the brief rules out installing it). The `wasm-file` entry's prebuilt WebAssembly is assumed built from the same lock.
- Whether webpki-roots 1.0.10 holds the roots that the data layer's and giveme.my's certificates chain to. That needs a TLS handshake with the owner's mainnet host, which the brief rules out.
- The RustCrypto primitives' own audit history (the finding is about the provider crate, whose README is quoted above).

**Network use:** one GET of `rustls-rustcrypto-0.0.2-alpha.crate` from static.crates.io, checksum-verified, README read as text, deleted.
