// The network a wallet is created or restored on, chosen on the welcome
// screen before any phrase, in a build that has both (the store's). Nothing
// is on either network yet, so it moves at once; Settings' switch
// (NetworkSection) asks first, because there it moves a wallet that has
// balances, history and sites.

import { useState } from "react";

import { NETWORKS, type NetworkName } from "../../networks";
import type { Status } from "../../shared/rpc";
import { call } from "../background";
import { Choice } from "./Choice";

/** What each network is, said under the choice here and in Settings. */
export const NETWORK_NOTE: Record<NetworkName, string> = {
  preprod: "Preprod: Cardano's test network, for trying the wallet out. ADA here is test ADA, with no value.",
  mainnet: "Mainnet: Cardano's real network. ADA here is real money.",
};

export function NetworkPicker({ status, onChanged }: { status: Status; onChanged: (status: Status) => void }) {
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
    <div className="stack network-picker" data-testid="onboarding-network">
      <Choice<NetworkName>
        label="Cardano network"
        id="onboarding-network-label"
        options={status.networks.map((n) => ({ value: n, label: NETWORKS[n].label, disabled: busy }))}
        value={status.network}
        onChange={(n) => {
          if (n !== status.network) void move(n);
        }}
      />
      <p className="note" data-testid="onboarding-network-note">
        {NETWORK_NOTE[status.network]}
      </p>
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
  if (status.networks.length < 2) return null;
  return (
    <p className="note onboarding-on-network" data-testid="onboarding-on-network">
      {doing === "create" ? "Creating" : "Restoring"} a wallet on {NETWORKS[status.network].label}.{" "}
      <button type="button" className="link" onClick={onChange}>
        Change network
      </button>
    </p>
  );
}
