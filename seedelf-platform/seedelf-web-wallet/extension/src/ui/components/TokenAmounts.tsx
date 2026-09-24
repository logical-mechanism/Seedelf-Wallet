// Tokens to bring along, after Lace's "Add assets": Add tokens opens a
// searchable picker, and only the picked tokens get an amount box, each
// checked against its decimals and what's held, with Max for all of it and ×
// to take it off again. A wallet with hundreds of tokens never lists them all
// in the form.

import { useMemo, useState } from "react";

import type { TokenAmount, TokenQuantity } from "../../shared/rpc";
import { formatQuantity, parseQuantity, plural, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { searchTokens, sortTokens, tokenLabel, viewToken } from "../tokens";
import { CheckIcon, CloseIcon, SearchIcon } from "./Icons";
import { Modal } from "./Modal";
import { TokenAvatar } from "./TokenList";

/** How many search results the picker shows at once. */
const SHOWN = 100;

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

/**
 * The picked tokens are the keys of `typed` (an empty box is picked, but
 * sends nothing yet).
 */
export function TokenAmounts({
  held,
  typed,
  onChange,
  legend = "Send tokens too (optional)",
}: {
  held: TokenAmount[];
  typed: Record<string, string>;
  onChange: (typed: Record<string, string>) => void;
  legend?: string;
}) {
  const network = useNetwork();
  const [picking, setPicking] = useState(false);
  if (held.length === 0) return null;
  const { problems } = tokenChoices(held, typed);
  const picked = held.filter((t) => key(t) in typed);
  const left = held.length - picked.length;

  return (
    <fieldset className="token-picker">
      <legend>{legend}</legend>
      {picked.map((t) => {
        const problem = problems[key(t)];
        const label = tokenLabel(network, t);
        const all = formatQuantity(t.quantity, t.decimals);
        return (
          <div key={key(t)} className="token-amount">
            <label className="token-amount__row">
              <span className="list__name">{label}</span>
              <input
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={typed[key(t)] ?? ""}
                onChange={(e) => onChange({ ...typed, [key(t)]: e.target.value })}
                aria-invalid={problem ? true : undefined}
                aria-label={`Amount of ${label}`}
              />
            </label>
            <div className="token-amount__foot">
              <span className="note">of {all}</span>
              <span className="token-amount__actions">
                <button
                  type="button"
                  className="chip"
                  aria-label={`All of ${label}`}
                  onClick={() => onChange({ ...typed, [key(t)]: all })}
                >
                  Max
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  aria-label={`Take ${label} off`}
                  title="Take it off"
                  onClick={() => {
                    const { [key(t)]: _, ...rest } = typed;
                    onChange(rest);
                  }}
                >
                  <CloseIcon size={14} />
                </button>
              </span>
            </div>
            {problem && <p className="field-note">{problem}</p>}
          </div>
        );
      })}
      {left > 0 && (
        <button type="button" className="secondary" onClick={() => setPicking(true)}>
          {picked.length ? "Add more tokens" : "Add tokens"}
        </button>
      )}
      {picking && (
        <TokenPicker
          tokens={held.filter((t) => !(key(t) in typed))}
          onClose={() => setPicking(false)}
          onPick={(keys) => {
            setPicking(false);
            onChange({ ...typed, ...Object.fromEntries(keys.map((k) => [k, ""])) });
          }}
        />
      )}
    </fieldset>
  );
}

/** Lace's "Add assets": search, tap to select, then add them all at once. */
function TokenPicker({
  tokens,
  onClose,
  onPick,
}: {
  tokens: TokenAmount[];
  onClose: () => void;
  onPick: (keys: string[]) => void;
}) {
  const network = useNetwork();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const views = useMemo(() => sortTokens(tokens.map((t) => viewToken(network, t)), "name"), [network, tokens]);
  const found = searchTokens(views, query);
  const toggle = (k: string) => {
    const next = new Set(chosen);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setChosen(next);
  };

  return (
    <Modal
      title="Add tokens"
      titleId="add-tokens-title"
      onClose={onClose}
      foot={
        <>
          <button
            type="button"
            className="secondary"
            onClick={() => setChosen(new Set([...chosen, ...found.map((v) => key(v.token))]))}
            disabled={found.every((v) => chosen.has(key(v.token)))}
          >
            Select all{query.trim() ? " found" : ""}
          </button>
          <button type="button" className="primary" onClick={() => onPick([...chosen])} disabled={!chosen.size}>
            {chosen.size ? `Add ${plural(chosen.size, "token")}` : "Add"}
          </button>
        </>
      }
    >
      <label className="search">
        <SearchIcon size={16} />
        <input
          type="search"
          aria-label="Search tokens"
          placeholder="Name, ticker or ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      </label>
      {found.length ? (
        <ul className="list" data-testid="token-picker">
          {found.slice(0, SHOWN).map((v) => {
            const on = chosen.has(key(v.token));
            return (
              <li key={key(v.token)}>
                <button
                  type="button"
                  className={on ? "token-row token-row--on" : "token-row"}
                  aria-pressed={on}
                  aria-label={v.label}
                  onClick={() => toggle(key(v.token))}
                >
                  <TokenAvatar view={v} />
                  <span className="token-row__label">{v.label}</span>
                  <span className="token-row__amount">{on ? <CheckIcon size={16} /> : v.amount}</span>
                  <span className="token-row__sub">{v.sub}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="note center empty">No tokens match “{query.trim()}”.</p>
      )}
      {found.length > SHOWN && (
        <p className="note center">
          Showing {SHOWN} of {found.length}. Search to narrow them down.
        </p>
      )}
    </Modal>
  );
}
