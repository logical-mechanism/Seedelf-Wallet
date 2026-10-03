// Tokens to bring along, after Lace's "Add assets": Add tokens opens a
// searchable picker, and only the picked tokens get an amount box, with Max
// for all of it and × to take it off again. A box takes the token's decimals
// (tokenDecimals: the wallet's list's, then Koios's, as every list and review
// reads them) and never more than the wallet holds (sanitizeAmount, as ADA
// takes its 45 billion), with commas that regroup as it's typed. A wallet
// with hundreds of tokens never lists them all in the form.

import { useMemo, useState } from "react";
import { t, useT } from "../../i18n";

import type { NetworkName } from "../../networks";
import type { TokenAmount, TokenQuantity } from "../../shared/rpc";
import { formatQuantity, parseQuantity, sanitizeAmount, tokenKey as key, type AmountRules } from "../format";
import { useNetwork } from "../network";
import { searchTokens, sortTokens, tokenDecimals, tokenLabel, viewToken } from "../tokens";
import { AmountField } from "./AmountField";
import { CheckIcon, CloseIcon, SearchIcon } from "./Icons";
import { Modal } from "./Modal";
import { TokenAvatar } from "./TokenList";

/** How many search results the picker shows at once. */
const SHOWN = 100;

/** A token's amount box: its decimals (`tokenDecimals`), and at most what the wallet holds. */
export function tokenRules(token: TokenAmount, label: string, decimals: number): AmountRules {
  return {
    decimals,
    max: BigInt(token.quantity),
    notANumber: t(decimals ? "token.amount.notANumber" : "token.amount.notAWholeNumber"),
    tooPrecise: decimals ? t("token.amount.tooPrecise", { label, decimals }) : t("token.amount.wholeUnits", { label }),
    tooMuch: t("token.amount.tooMuch", { amount: formatQuantity(token.quantity, decimals), label }),
  };
}

/**
 * The token amounts typed so far: those to send, and what's wrong with any
 * of them. Each is read with the decimals its box shows (`tokenDecimals` on
 * `network`), so what's sent is what was typed.
 */
export function tokenChoices(
  network: NetworkName,
  held: TokenAmount[],
  typed: Record<string, string>,
): { sent: TokenQuantity[]; problems: Record<string, string>; ok: boolean } {
  const sent: TokenQuantity[] = [];
  const problems: Record<string, string> = {};
  for (const token of held) {
    const text = (typed[key(token)] ?? "").trim();
    if (text === "") continue;
    const decimals = tokenDecimals(network, token);
    const quantity = parseQuantity(text, decimals);
    if (quantity === undefined) {
      problems[key(token)] = decimals ? t("token.amount.atMostDecimals", { decimals }) : t("token.amount.wholeNumber");
    } else if (BigInt(quantity) > BigInt(token.quantity)) {
      problems[key(token)] = t("token.amount.tooMuchPlain", { amount: formatQuantity(token.quantity, decimals) });
    } else if (quantity !== "0") {
      sent.push({ policyId: token.policyId, assetName: token.assetName, quantity });
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
  legend,
}: {
  held: TokenAmount[];
  typed: Record<string, string>;
  onChange: (typed: Record<string, string>) => void;
  legend?: string;
}) {
  const tr = useT();
  const network = useNetwork();
  const [picking, setPicking] = useState(false);
  // What the last edit of each box changed or refused.
  const [notes, setNotes] = useState<Record<string, string | undefined>>({});
  if (held.length === 0) return null;
  const { problems } = tokenChoices(network, held, typed);
  const picked = held.filter((t) => key(t) in typed);
  const left = held.length - picked.length;

  return (
    <fieldset className="token-picker">
      <legend>{legend ?? tr("token.sendTooLegend")}</legend>
      {picked.map((t) => {
        const problem = problems[key(t)] ?? notes[key(t)];
        const label = tokenLabel(network, t);
        const decimals = tokenDecimals(network, t);
        const all = formatQuantity(t.quantity, decimals);
        const set = (value: string, note?: string) => {
          setNotes({ ...notes, [key(t)]: note });
          onChange({ ...typed, [key(t)]: value });
        };
        return (
          <div key={key(t)} className="token-amount">
            <label className="token-amount__row">
              <span className="list__name">{label}</span>
              <AmountField
                placeholder="0"
                value={typed[key(t)] ?? ""}
                clean={(previous, text) => sanitizeAmount(previous, text, tokenRules(t, label, decimals))}
                onChange={set}
                aria-invalid={problems[key(t)] ? true : undefined}
                aria-label={tr("token.amountOf", { label })}
              />
            </label>
            <div className="token-amount__foot">
              <span className="note">{tr("token.ofAll", { all })}</span>
              <span className="token-amount__actions">
                <button
                  type="button"
                  className="chip"
                  aria-label={tr("token.allOf", { label })}
                  onClick={() => set(all)}
                >
                  {tr("common.max")}
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  aria-label={tr("recipients.takeOffWhat", { what: label })}
                  title={tr("recipients.takeOff")}
                  onClick={() => {
                    const { [key(t)]: _, ...rest } = typed;
                    setNotes({ ...notes, [key(t)]: undefined });
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
          {tr(picked.length ? "token.addMore" : "token.add")}
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
  const tr = useT();
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
      title={tr("token.add")}
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
            {tr(query.trim() ? "token.selectAllFound" : "token.selectAll")}
          </button>
          <button type="button" className="primary" onClick={() => onPick([...chosen])} disabled={!chosen.size}>
            {chosen.size ? tr("token.addCount", { count: chosen.size }) : tr("token.addPlain")}
          </button>
        </>
      }
    >
      <label className="search">
        <SearchIcon size={16} />
        <input
          type="search"
          aria-label={tr("tokens.search")}
          placeholder={tr("tokens.searchPlaceholder")}
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
        <p className="note center empty">{tr("tokens.noneMatch", { query: query.trim() })}</p>
      )}
      {found.length > SHOWN && (
        <p className="note center">
          {tr("token.showing", { shown: SHOWN, total: found.length })}
        </p>
      )}
    </Modal>
  );
}
