# v-pr326-2-impact: bring-your-own-Tor's `proxy` permission can't be optional (`pr326#2`)

**Verdict: confirmed. Severity: low** (as filed). Docs only, and it doesn't block the release.

## What was checked

- **The doc on HEAD (`6bca8bec`).** `post-release-roadmap.md:343` says: "It needs the `proxy` permission (asked for at the switch, if Chrome lets it be optional) and a hostname of its own for the private side". `git blame` puts the line at `a7abf961`, #326's commit. Nothing has changed it since: #338 didn't touch it.
- **Chrome's permissions API page** says: "Most Chrome extension permissions can be specified as optional, with the following exceptions". The exceptions are debugger, declarativeNetRequest, devtools, geolocation, mdns, **proxy**, tts, ttsEngine and wallpaper.
- **Chromium's source** (`extensions/common/permissions/extensions_api_permissions.cc`, fetched from main) has `{APIPermissionID::kProxy, "proxy", APIPermissionInfo::kFlagImpliesFullURLAccess | APIPermissionInfo::kFlagCannotBeOptional}`.
- **`@types/chrome`** in `extension/node_modules/@types/chrome/index.d.ts:9516–9530` also leaves `"proxy"` out of `ManifestOptionalPermission`.
- **Chrome's permissions list**
  - `proxy` shows the warning "Read and change all your data on all websites." That wording is now checked: the finding only recalled it.
  - `storage`, `alarms`, `sidePanel` and `scripting` show no warning.
- **Chrome's permission warnings page** says that when an update adds a permission that brings a new warning, "the extension will be disabled until the user accepts the new permission."
- **Chrome's `types` API page**
  - The layers, in rising precedence: the OS's system settings, then the command line, then extensions, then policies. "policies might overrule any changes that you specify with your extension."
  - Between extensions: "the extension installed most recently takes precedence over the other extensions". `levelOfControl` reports which one holds the setting.
- **The wallet's install today**
  - `manifest.ts:84`: `permissions: ["storage", "alarms", "sidePanel", "scripting"]`, none of which shows a warning.
  - `:87`: `host_permissions: serviceHosts(networks)`, which is api.koios.rest, www.giveme.my, api.coingecko.com and preprod.koios.rest. Chrome warns for these sites only.
  - `:91`: `https://*/*` is optional, asked for only when the user turns on the dApp connector.
  - The docs treat "no new warning at install" as a design value in several places: `architecture.md:28`, `:399` and `:666` ("no host permission, no new warning at install"), `store/README.md:274` and `:276`, the IPFS comment in `networks.ts`, and `post-release-roadmap.md:290`.

## Can it happen?

- **Not in the shipped build.** No `proxy` permission or `chrome.proxy` call exists in `src/`, and the route is a parked idea that was never built. The defect is in the doc: it costs the route as an opt-in "asked for at the switch". Chrome only allows `proxy` as a required permission.
- **Who it would mislead.** The owner, when they come back to Tor "the right way". Also an agent told to start from the spike's findings. That reader would see the route listed under *Cheaper ways* as "Real Tor, with no gateway and nothing added to the bundle", with a permission the user would grant only at the switch. They would learn otherwise only when building it.

### The scenario, made more exact

- **"Disables the wallet for every user."** That is true for everyone who hasn't turned on the dApp connector.
  - Users who have turned it on already granted `https://*/*`, and Chrome warns for that as access to all sites.
  - Chromium's privilege-increase check (`chrome_permission_message_provider.cc`) probably spares those users. `IsHostPrivilegeIncrease` returns false when the granted set already reaches all hosts. `IsAPIOrManifestPrivilegeIncrease` compares the warning strings, and the string would be the same.
  - This comes from reading the source, not from a test. Either way the install prompt for every new user becomes the all-sites warning.
- **"Replaces a user's system or enterprise proxy."**
  - A proxy set in the operating system is replaced: extensions outrank system settings, and the PAC script's `DIRECT` sends every other site direct.
  - A proxy set by Chrome policy outranks the extension. On such a browser the switch can't take effect at all.
- **"Can't work while a VPN extension holds the setting."** What happens depends on which was installed last.
  - If the proxy or VPN extension was installed after the wallet, it wins. The switch then does nothing, and the private side goes direct, unless the wallet reads `levelOfControl` and says so.
  - If it was installed before the wallet, the wallet's PAC script overrides it for every site. The user's other browsing goes `DIRECT` for as long as the switch is on.
  - Either way the two conflict, which is a privacy cost the route doesn't mention.
- **"The data layer's own rule."** Line 290 records what the data layer achieved, not a stated rule. The docs do hold "no new warning at install" as a value throughout, so the comparison stands.

## Severity: low

- **Matches the brief's scale.** The brief rates "a misleading doc" as low.
- **Not medium.** Nothing is shipped or built, and the doc marks its own uncertainty.
- **Not nit.** The hedge has a known answer, and that answer turns the route from an opt-in into a cost every user pays. That cost is a full-access warning at install, and the wallet disabled on the update that adds it. Avoiding install warnings is what this codebase designs around, and this doc is where the owner will weigh the routes.

## The fix

Each clause of the proposed text checks out against Chrome's docs and Chromium's source. It needs three changes:

1. **Name the warning** ("Read and change all your data on all websites") instead of "a full-access warning". The docs elsewhere name warnings exactly.
2. **Say that only one extension holds the setting** (whichever was installed last). The finding claims this, but its proposed text drops it.
3. **Edit once with `pr326#0`.** That finding's clause, "Koios can't be split by host: the private side's Koios fallback, Koios-only and preprod leave direct", goes in the same bullet. Keep the hostname clause too.

Suggested wording for the middle of `:343`:

> It needs the `proxy` permission, which Chrome won't let be optional: every install would ask for it, with "Read and change all your data on all websites", and the update that adds it disables the wallet until it's accepted. It needs a hostname of its own for the private side too, since a PAC script sees an `https` URL's host, not its path. And `chrome.proxy` sets the whole browser's proxy, held by one extension at a time (the one installed last): the PAC script routes every other site too (`DIRECT` where a system proxy was).

**Optional, the owner's call (my idea, not part of the fix).** If the opt-in matters, two designs would keep it:
- **A companion extension that holds `proxy`.** Only the people who install it see its warning, and the wallet's own permissions stay as they are.
- **An optional `nativeMessaging` permission with a small native helper** that relays the private side to the local SOCKS port.
  - Chromium gives `nativeMessaging` no `kFlagCannotBeOptional`, and its warning is "Communicate with cooperating native applications".
  - It doesn't take over the browser's proxy, but the user has to install a program.

I haven't checked either beyond those flags.

**What else the fix changes.** Nothing outside the doc.
- No code, test or i18n key changes.
- No privacy policy entry: nothing handles data differently.
- No test reads this doc's text: `tests/activity.test.ts` mentions it only in comments.
- No dates and no store status.
- It can ride in the 1.7.0 release PR or any later docs PR.

## Housekeeping

I created no scratch files. Network use was read-only fetches of four Chrome developer pages (permissions API, permissions list, permission warnings, types; two of them asked twice) and three Chromium source files. There were no Koios requests.
