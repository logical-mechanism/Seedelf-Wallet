import { useState } from "react";

import type { TokenAmount } from "../../shared/rpc";
import { formatQuantity, tokenKey, tokenName } from "../format";

const SHOWN = 5;

/** Native tokens with their amounts; long lists fold after five. */
export function TokenList({ tokens, testId }: { tokens: TokenAmount[]; testId: string }) {
  const [all, setAll] = useState(false);
  if (!tokens.length) return null;
  const shown = all ? tokens : tokens.slice(0, SHOWN);
  return (
    <div className="stack-tight" data-testid={testId}>
      <ul className="list">
        {shown.map((t) => (
          <li key={tokenKey(t)} className="list__row" title={`${tokenKey(t)}\n${t.fingerprint}`}>
            <span className="list__name">{tokenName(t.assetName)}</span>
            <span className="list__value">{formatQuantity(t.quantity, t.decimals)}</span>
          </li>
        ))}
      </ul>
      {tokens.length > SHOWN && (
        <button type="button" className="link show-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${tokens.length} tokens`}
        </button>
      )}
    </div>
  );
}
