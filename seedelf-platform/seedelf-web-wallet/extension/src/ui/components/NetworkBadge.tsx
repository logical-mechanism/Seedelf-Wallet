// The network the wallet is on, on every screen (App.tsx): the top bar's
// badge, and while preprod is on, a strip under it saying that ADA there has
// no value. A mainnet build has both networks (Settings switches them), so
// test ADA must never pass for real ADA, in the wallet or in the connector's
// window.

import { NETWORKS, type NetworkName } from "../../networks";

export function NetworkBadge({ network }: { network: NetworkName }) {
  return (
    <span className={`badge badge--${network}`} data-testid="network">
      {NETWORKS[network].label.toUpperCase()}
    </span>
  );
}

/** What the strip says while preprod is on. */
export const TEST_NETWORK = "Preprod, Cardano's test network: ADA here is test ADA, with no value.";

export function TestNetworkStrip({ network }: { network: NetworkName }) {
  if (network !== "preprod") return null;
  return (
    <p className="network-strip" role="note" data-testid="test-network">
      {TEST_NETWORK}
    </p>
  );
}
