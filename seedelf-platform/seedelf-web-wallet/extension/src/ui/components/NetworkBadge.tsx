// The network the wallet is on, on every screen (App.tsx): the top bar's
// badge, and while preprod is on, a strip under it saying that ADA there has
// no value. A mainnet build has both networks (Settings switches them), so
// test ADA must never pass for real ADA, in the wallet or in the connector's
// window.

import { NETWORKS, type NetworkName } from "../../networks";
import { useT } from "../../i18n";

export function NetworkBadge({ network }: { network: NetworkName }) {
  return (
    <span className={`badge badge--${network}`} data-testid="network">
      {NETWORKS[network].label.toUpperCase()}
    </span>
  );
}

/**
 * One line at the side panel's width: two lines cost every view about 50 px
 * (chunk 23's review, W-4). The badge beside the mark names the network.
 */
export function TestNetworkStrip({ network }: { network: NetworkName }) {
  const t = useT();
  if (network !== "preprod") return null;
  return (
    <p className="network-strip" role="note" data-testid="test-network">
      {t("network.testStrip")}
    </p>
  );
}
