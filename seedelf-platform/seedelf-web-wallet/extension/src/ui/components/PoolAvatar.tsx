// A Lovejoin pool's avatar (chunk 34's 34f): ₳ for ADA's pools, the token's
// listed logo, or two letters, as the token lists show a token.

import { useNetwork } from "../network";
import { assetFingerprint, tokenDecimals, viewToken } from "../tokens";
import { TokenAvatar } from "./TokenList";

export function PoolAvatar({ token }: { token?: { policyId: string; assetName: string } }) {
  const network = useNetwork();
  if (!token) {
    return (
      <span className="avatar avatar--ada" aria-hidden="true">
        ₳
      </span>
    );
  }
  return <TokenAvatar view={viewToken(network, { ...token, quantity: "0", decimals: tokenDecimals(network, token), fingerprint: assetFingerprint(token) })} />;
}
