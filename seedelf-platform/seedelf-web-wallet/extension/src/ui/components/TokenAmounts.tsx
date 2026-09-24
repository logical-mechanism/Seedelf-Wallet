// Optional token amounts to send along, one box per token held, with each
// amount checked against the token's decimals and what's held.

import type { TokenAmount, TokenQuantity } from "../../shared/rpc";
import { formatQuantity, parseQuantity, tokenKey as key, tokenName } from "../format";

/** The token amounts typed so far: those to send, and what's wrong with any of them. */
export function tokenChoices(
  held: TokenAmount[],
  typed: Record<string, string>,
): { sent: TokenQuantity[]; problems: Record<string, string>; ok: boolean } {
  const sent: TokenQuantity[] = [];
  const problems: Record<string, string> = {};
  for (const t of held) {
    const text = (typed[key(t)] ?? "").trim();
    if (text === "") continue;
    const quantity = parseQuantity(text, t.decimals);
    if (quantity === undefined) {
      problems[key(t)] = t.decimals
        ? `Enter an amount with at most ${t.decimals} decimal places.`
        : "Enter a whole number.";
    } else if (BigInt(quantity) > BigInt(t.quantity)) {
      problems[key(t)] = `That's more than the ${formatQuantity(t.quantity, t.decimals)} you hold.`;
    } else if (quantity !== "0") {
      sent.push({ policyId: t.policyId, assetName: t.assetName, quantity });
    }
  }
  return { sent, problems, ok: Object.keys(problems).length === 0 };
}

export function TokenAmounts({
  held,
  typed,
  onChange,
}: {
  held: TokenAmount[];
  typed: Record<string, string>;
  onChange: (typed: Record<string, string>) => void;
}) {
  if (held.length === 0) return null;
  const { problems } = tokenChoices(held, typed);
  return (
    <fieldset className="token-picker">
      <legend>Send tokens too (optional)</legend>
      {held.map((t) => {
        const problem = problems[key(t)];
        return (
          <div key={key(t)} className="token-amount">
            <label className="token-amount__row">
              <span className="list__name">{tokenName(t.assetName)}</span>
              <input
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={typed[key(t)] ?? ""}
                onChange={(e) => onChange({ ...typed, [key(t)]: e.target.value })}
                aria-invalid={problem ? true : undefined}
                aria-label={`Amount of ${tokenName(t.assetName)}`}
              />
            </label>
            <span className="note">of {formatQuantity(t.quantity, t.decimals)}</span>
            {problem && <p className="field-note">{problem}</p>}
          </div>
        );
      })}
    </fieldset>
  );
}
