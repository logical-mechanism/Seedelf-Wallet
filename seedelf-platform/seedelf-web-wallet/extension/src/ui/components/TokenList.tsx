import { useState } from "react";

import type { TokenAmount } from "../../shared/rpc";
import { formatQuantity, tokenName } from "../format";

const SHOWN = 5;

/** Native tokens with their amounts; long lists fold after five. */
export function TokenList({ tokens, testId }: { tokens: TokenAmount[]; testId: string }) {
  const [all, setAll] = useState(false);
  if (!tokens.length) return null;
  const shown = all ? tokens : tokens.slice(0, SHOWN);
  return (
    <div className="tokens" data-testid={testId}>
      <ul className="tokens__list">
        {shown.map((t) => (
          <li key={`${t.policyId}.${t.assetName}`} className="tokens__row" title={`${t.policyId}.${t.assetName}\n${t.fingerprint}`}>
            <span className="tokens__name">{tokenName(t.assetName)}</span>
            <span className="tokens__amount">{formatQuantity(t.quantity, t.decimals)}</span>
          </li>
        ))}
      </ul>
      {tokens.length > SHOWN && (
        <button type="button" className="link" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${tokens.length} tokens`}
        </button>
      )}
    </div>
  );
}
