// The network a wallet is created or restored on, chosen on the welcome
// screen before any phrase, in a build that has both. It's a small dropdown
// under Create and Restore: few people change it, but it must be there before
// a phrase goes in. Nothing is on either network yet, so it moves at once;
// Settings' switch (NetworkSection) asks first, because there it moves a
// wallet that has balances, history and sites. On preprod the strip under the
// top bar says its ADA has no value.

import { useState } from "react";
import { t, useT } from "../../i18n";

import { NETWORKS, type NetworkName } from "../../networks";
import type { Status } from "../../shared/rpc";
import { call } from "../background";

/**
 * What each network is, said under the choice here and in Settings.
 *
 * Getters, not plain strings, so the shape stays `Record<NetworkName, string>`
 * for everything that reads it while the words come from the current language
 * at the moment they're read.
 */
export const NETWORK_NOTE: Record<NetworkName, string> = {
  get preprod() {
    return t("network.privacy.preprod");
  },
  get mainnet() {
    return t("network.mainnet");
  },
};

export function NetworkPicker({ status, onChanged }: { status: Status; onChanged: (status: Status) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (status.networks.length < 2) return null;

  async function move(network: NetworkName) {
    setBusy(true);
    setError(undefined);
    try {
      // Every screen starts afresh on the new network (App keys them by it).
      onChanged(await call("network-set", { network }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="network-picker" data-testid="onboarding-network">
      <label className="network-picker__label" htmlFor="onboarding-network-select">
        {t("network.label")}
      </label>
      <select
        id="onboarding-network-select"
        aria-label={t("network.ariaLabel")}
        value={status.network}
        disabled={busy}
        onChange={(e) => {
          const n = e.target.value as NetworkName;
          if (n !== status.network) void move(n);
        }}
      >
        {status.networks.map((n) => (
          <option key={n} value={n}>
            {NETWORKS[n].label}
          </option>
        ))}
      </select>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The network a create or restore is on, with the way back to change it,
 * over those screens: "Forgot password" opens Restore without the welcome.
 */
export function OnNetwork({
  status,
  doing,
  onChange,
}: {
  status: Status;
  doing: "create" | "restore";
  onChange: () => void;
}) {
  const t = useT();
  if (status.networks.length < 2) return null;
  return (
    <p className="note onboarding-on-network" data-testid="onboarding-on-network">
      {t(doing === "create" ? "network.creatingOn" : "network.restoringOn", { network: NETWORKS[status.network].label })}{" "}
      <button type="button" className="link" onClick={onChange}>
        {t("network.change")}
      </button>
    </p>
  );
}
