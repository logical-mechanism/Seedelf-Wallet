// What one payment of a review carries: its ADA on a row of its own, then
// each token with its amount and name, as the Send, Transfer and Withdraw
// reviews list them. A count of tokens alone would let a mistyped amount, or
// Max, go out unseen at the last check (independent review L37).

import type { TokenQuantity } from "../../shared/rpc";
import { formatAda, tokenKey } from "../format";
import { useNetwork } from "../network";
import { tokenQuantity } from "../tokens";
import { Row } from "./ReviewRows";
import { TokenAmountRow } from "./TokenList";

export function PaidRows({ label, paid }: { label: string; paid?: { lovelace: string; tokens: TokenQuantity[] } }) {
  const network = useNetwork();
  return (
    <>
      <Row label={label} value={`${formatAda(paid?.lovelace ?? "0")} ₳`} strong />
      {paid?.tokens.map((t) => (
        <TokenAmountRow key={tokenKey(t)} label="" token={t} amount={tokenQuantity(network, t)} />
      ))}
    </>
  );
}
