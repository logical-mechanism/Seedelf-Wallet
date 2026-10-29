# v-pr326-2-trace: `proxy` can't be an optional permission (pr326#2)

**Verdict: confirmed. Severity: low.** I settled it by experiment on Chrome for Testing 153.0.8010.12 (Playwright 1.63's build), headless. The probe was a throwaway extension in my scratchpad, not the wallet. It wrote nothing to the tree and sent nothing over the network. The core claim holds as stated. Four details in the scenario and the fix are narrower than written (see *What's narrower*).

## The tree (HEAD `6bca8bec`)

- `docs/post-release-roadmap.md:343`, added by `a7abf961` (PR #326) and unchanged since, says: "It needs the `proxy` permission (asked for at the switch, if Chrome lets it be optional)". `git grep` finds no other mention of the `proxy` permission or `chrome.proxy` in the web wallet's docs or source.
- `docs/post-release-roadmap.md:290`, on the data layer: "no install warning, and nothing disabled on update". The archived plan says the same (`archive/plans/chunk-26-data-layer.md:370`).
- `extension/src/manifest.ts:84` has `permissions: ["storage", "alarms", "sidePanel", "scripting"]`, and `:91` has `optional_host_permissions: DAPP_ORIGINS`. That list is `["https://*/*", "http://localhost/*", "http://127.0.0.1/*"]` (`src/shared/dapp.ts:15`), asked for only when the user turns the dApp connector on.
- `extension/node_modules/@types/chrome/index.d.ts:9516-9530` (0.3.0) cites `/** Source : https://developer.chrome.com/docs/extensions/reference/api/permissions */` and defines `type ManifestOptionalPermission = Exclude<ManifestPermission, ... | "proxy" | ...>`.
- At `:8903` it describes the API: "Use the `chrome.proxy` API to manage Chrome's proxy settings. This API relies on the ChromeSetting prototype".
- At `:12736` it defines the setting's levels of control, including "`not_controllable`: cannot be controlled by any extension".

## Probe 1: `proxy` declared optional

The probe declared `optional_permissions: ["proxy", "alarms"]` and `permissions: ["storage"]`. A real click (sent over CDP) on the extension's own page called `chrome.permissions.request`:

```
permissions.request({permissions: ["alarms"]}) -> resolved:true          (the control: no warning, so no prompt)
permissions.request({permissions: ["proxy"]})  -> rejected:Only permissions specified in the manifest may be requested.
granted after: {"origins":[],"permissions":["alarms","storage"]}
typeof chrome.proxy after: undefined
chrome://extensions (developerPrivate.getExtensionInfo): installWarnings [], manifestErrors []
```

Chrome drops `proxy` from `optional_permissions` when it reads the manifest, and does so silently: there's no install warning on chrome://extensions. A switch can never ask for it.

## The warnings, measured

These come from `chrome.management.getPermissionWarningsByManifest`, in the same browser. The wallet's permission set was read, never written, from the tree's `dist/manifest.json` (a 1.6.0 build): `permissions` plus `host_permissions`.

| Manifest | Chrome's warnings |
|---|---|
| `permissions: ["proxy"]` alone | "Read and change all your data on all websites" |
| `proxy` in `optional_permissions` only | none |
| the wallet as built | "Read and change your data on a number of websites" |
| the wallet + `proxy` | "Read and change all your data on all websites" |
| the wallet with `https://*/*` granted (dApp connector on) | "Read and change all your data on all websites" |
| the same + `proxy` | "Read and change all your data on all websites" |

The finding gave the warning text as "recalled, not checked offline". It is now checked, and it is exact.

## Probe 2: `proxy` required, two extensions

Extensions A and B each declared `permissions: ["proxy"]`. A PAC script routed one made-up host to `SOCKS5 127.0.0.1:9050` and sent everything else `DIRECT`. No request was made.

```
typeof chrome.proxy (required): object
before any set  | A: controllable_by_this_extension, mode system | B: controllable_by_this_extension, mode system
set from A ok   | A: controlled_by_this_extension, mode pac_script | B: controllable_by_this_extension, mode pac_script
set from B ok   | A: controlled_by_other_extensions, mode pac_script | B: controlled_by_this_extension, mode pac_script
```

This shows three things:

- Only the optional form is dropped: declared as required, `proxy` works.
- It is one setting for the whole profile. B sees A's PAC script, and the mode it replaces is `system`, which means Chrome stops following the operating system's proxy.
- One extension holds it at a time. The extension with higher precedence takes it, and the other is left at `controlled_by_other_extensions`.

## What holds

As the route is written, it can't be opt-in at the permission level:

- `proxy` would be a required permission on every install.
- Its warning is "Read and change all your data on all websites", where the wallet today shows "Read and change your data on a number of websites".
- `chrome.proxy` sets the browser's single proxy setting, not just the wallet's requests, and only one extension can hold it at a time.

That is the opposite of the bar the data layer set for itself at `:290`.

## What's narrower

1. **"Disables the wallet for every user":** more exactly, every user who hasn't turned the dApp connector on (it is off by default).
   - A user who granted `https://*/*` already carries the identical warning (measured above). Chrome counts no privilege increase when the granted set already reaches every host: that is Chromium's `IsHostPrivilegeIncrease`, recalled rather than read.
   - I did not test the update path itself.
   - Every new install sees the all-sites warning either way.
2. **"Replaces a user's system or enterprise proxy":**
   - System: yes. The mode goes from `system` to `pac_script`, and the PAC script answers `DIRECT` for every host it doesn't route, so the operating system's proxy stops applying to every request.
   - Enterprise: no. A proxy set by policy is `not_controllable` by any extension, so on such a machine the route simply doesn't apply.
3. **"Can't work at all while a VPN extension holds the proxy setting":** that holds only if the VPN or proxy extension has higher precedence (installed later). If it has lower precedence, the wallet takes the setting from it while the switch is on, which turns that VPN off for all traffic. Either way, the two can't run together.
4. **The fix's "full-access warning":** in Chrome, "full access" is a different and stronger message. Name the all-sites one.

## Severity

Low, as filed. This is a hedge in a parked, unbuilt route under *Kept in mind*. Nothing in 1.7.0's code or manifest touches it, and nothing ships from it. But the hedge has a known answer, and that answer changes the route's cost: what read as an opt-in becomes a warning every install pays and a disable on update for most users. That is the cost the owner weighs in choosing a route ("I want to approach this the right way").

## Fix

Replace the parenthesis with the answer and the side effects, for example:

> It needs the `proxy` permission, which Chrome won't take as optional: every install would carry it, with Chrome's "Read and change all your data on all websites" warning, and the update would disable the wallet, until accepted, for anyone who hasn't turned the dApp connector on. While the switch is on, its PAC script is the whole browser's proxy setting: the system proxy stops applying to every other host, only one extension can hold it (a proxy or VPN extension takes it or loses it by install order), and a proxy set by enterprise policy shuts it out.

My idea, for the owner if they want one: an opt-in form keeps the proxy outside the wallet. The user's own proxy setup (for example, a proxy extension they already run) routes the private side's hostname to Tor's SOCKS port. The route needs that hostname anyway, and the wallet's permissions stay as they are.

## Repro, for reference (the scratch files are deleted)

- **Probe 1's manifest:** `{"manifest_version":3,"background":{"service_worker":"sw.js"},"permissions":["storage"],"optional_permissions":["proxy","alarms"]}`.
- **Probe 1's page:** two buttons, each calling `chrome.permissions.request({permissions:[name]})`, clicked by Playwright. The worker called `chrome.management.getPermissionWarningsByManifest` on each manifest in the table.
- **Probe 2:** two copies, each declaring `permissions:["proxy"]`. Each called `chrome.proxy.settings.set({scope:"regular", value:{mode:"pac_script", pacScript:{data}}})` in turn, then `chrome.proxy.settings.get` from both.
- **Launch:** `chromium.launchPersistentContext(tmpProfile, {channel:"chromium", headless:true, args:["--disable-extensions-except=<ext>","--load-extension=<ext>"]})`, through the tree's `playwright-core` 1.63.0, imported by absolute path from a script in the scratchpad. Each throwaway profile was deleted at the end of its run.
