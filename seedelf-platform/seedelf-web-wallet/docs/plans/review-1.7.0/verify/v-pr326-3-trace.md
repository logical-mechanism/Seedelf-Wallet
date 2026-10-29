# v-pr326-3-trace: pr326#3, "neither open nor an exit" beside "anyone can use it"

**Verdict: partly. Severity: nit.** Confidence: high on the facts. What's left is a matter of wording.

## What holds

- **The two phrases are adjacent sub-bullets on HEAD.** Both come from PR #326's commit `a7abf961`. `git blame -L 333,341` shows no later PR changed the passage, #338 included.
  - :339: "The gateway is neither open nor an exit, but it is a proxy into Tor, and 26c's case for the droplet was that nothing passes through it;"
  - :340: "the gateway's address ships in the wallet, so anyone can use it, and its load and any abuse would land on the API every mainnet wallet reads."
- **The gateway doesn't authenticate clients.** I read tor-js's clone at `8977093` without running anything:
  - `crates/tor-js-gateway/src/tunnel.rs:237` `handle_connect` makes two checks only:
    - the target, through `validate_target` (:179). Its consensus allowlist check is at :205, which refuses with 403 "target is not an advertised Tor relay";
    - a free slot, through `gw.tracker.acquire(peer_ip, …)` (:259), which refuses with 429.
  - Nothing else gates the client. PROTOCOL.md:300 says KPS authenticates the server only: "The KPS handshake authenticates the server (certhash pin)".
  - The limits are `tunnel_per_ip: 16` (README:122, which also caps each KPS connection), `tunnel_max: 8192` (README:119), a 300 s idle timeout and a 3600 s lifetime. The finding's "only a limit of 16 tunnels per IP address" leaves out the global cap and the timeouts. That changes nothing.
- **So in the common sense of "open proxy", the gateway is open.** That sense is "a proxy any Internet user can use". A reader who holds it reads :339 and :340 as contradicting each other, and the finding's author did.

## Narrower or different than stated

1. **:339 is right in the sense it uses, which is tor-js's own.**
   - PROTOCOL.md:303–304 (§7, *Security considerations*), at the commit the doc pins: "CONNECT target validation (consensus allowlist, no local/reserved addresses) is what prevents the gateway from being an open proxy".
   - The doc states that basis itself, four lines earlier at :335: "It tunnels the client's already-encrypted bytes to relays the current consensus lists, and nowhere else (`CONNECT`, 16 tunnels an IP by default)".
   - The acceptable use policy uses "open" the same way in its other items. pr326's report quotes the live page: "open mail relays, open recursive domain name servers". There, "open" means a service that relays or resolves for anyone, to anywhere. A mail server that accepts anyone's mail only for its own domains isn't an open relay.
   - So in :339, "open" means "open proxy" in the destination sense, and :340 is about who can connect. The defect is that the word's sense isn't spelled out. The line itself isn't false.
2. **The scenario doesn't follow.**
   - Read alone, :339 still says in the same sentence "but it is a proxy into Tor, and 26c's case for the droplet was that nothing passes through it". The quote just before it ends in the policy's catch-all, "or other similar network services". :339 admits the conflict with the droplet's case; it doesn't play the risk down.
   - It is one of three sub-bullets under "On the API's droplet it's worse:", and :340 comes right after it.
   - The idea is parked (:333, the owner, 2026-10-27), so nothing is being weighed from it now.
   - What :340 adds is load and abuse landing on the API. That is a different risk from how the policy's wording classifies the gateway.
3. **The proposed fix goes too far.** The finding proposes "open to anyone, though it reaches only Tor relays, and not an exit". Placed right after "bans 'open proxies …'", it suggests the gateway is in the policy's first named category. tor-js's spec says its target validation exists to keep it out of that category. Nobody knows how DigitalOcean would classify it, and the doc shouldn't decide that either way.

## Repro

I wrote no scratch test. The question is what one word means in the notes for a parked idea, and no wallet code is involved.

- **The trace was read-only.** I read the upstream source at `89770931` (`.git/packed-refs` and `git rev-parse HEAD` both give it) in the spike's clone at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6b05df79-ccf4-4e6d-9648-1dad8d04a5d0/scratchpad/dl-torjs/tor-js`. Nothing in it was run or built.
- **I grepped `crates/tor-js-gateway/src/`** for auth, token, API key, client allowlist, whitelist and bearer. The only hits were the relay (destination) allowlist and the GitHub mirror's token.
- No network use. I created no scratch files, so there was nothing to delete.

## Fix advice

Keep "not an open proxy" and add, in one line, that anyone can connect. For example:

"The gateway isn't an exit, and it reaches only Tor relays (tor-js's own test for not being an open proxy), but anyone can connect to it: it is a proxy into Tor, and 26c's case for the droplet was that nothing passes through it;"

This isn't needed for 1.7.0: the passage is the notes on a parked idea, and nothing that ships depends on it.
