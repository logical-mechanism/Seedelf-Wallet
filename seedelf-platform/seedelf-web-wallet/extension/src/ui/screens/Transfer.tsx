// Send to a seedelf: pay someone's seedelf from the Seedelf balance. The
// recipient is pasted by full name (tags aren't unique), looked up in the
// wallet contract, and shown before anything is built. The worker builds the
// transfer, with Ogmios measuring its spends, and nothing is sent until the
// user has reviewed it and pressed Send.

import { useEffect, useState, type FormEvent } from "react";

import type { Balances, PendingTx, SeedelfLookup, TransferSummary } from "../../shared/rpc";
import { SEEDELF_NAME_RULE, seedelfName } from "../../shared/seedelf-name";
import { call } from "../background";
import { AdaInput, RoundNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { ContactEditor, ContactPicker, useContacts } from "../components/Contacts";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { adaWithTokens, formatAda, formatQuantity, parseAda, shortHex, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { tokenLabel } from "../tokens";

type Found = { state: "idle" } | { state: "looking" } | { state: "found"; seedelf: SeedelfLookup } | { state: "error"; message: string };

export function Transfer({
  seedelf,
  onCancel,
  onSent,
}: {
  seedelf: Balances["seedelf"];
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const network = useNetwork();
  const [to, setTo] = useState("");
  const [found, setFound] = useState<Found>({ state: "idle" });
  const [amount, setAmount] = useState("");
  const [tokenAmounts, setTokenAmounts] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<TransferSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [contacts, reloadContacts] = useContacts();
  const [contactModal, setContactModal] = useState<"pick" | "save">();

  const name = seedelfName(to);
  const saved = name ? contacts?.find((c) => c.kind === "seedelf" && c.value === name) : undefined;
  const hasContacts = !!contacts?.some((c) => c.kind === "seedelf");
  const nameProblem = to.trim() !== "" && !name ? SEEDELF_NAME_RULE : undefined;

  // Look the seedelf up once a whole name is pasted.
  useEffect(() => {
    if (!name) {
      setFound({ state: "idle" });
      return;
    }
    let current = true;
    setFound({ state: "looking" });
    call("transfer-lookup", { to: name }).then(
      (s) => current && setFound({ state: "found", seedelf: s }),
      (e: Error) => current && setFound({ state: "error", message: e.message }),
    );
    return () => {
      current = false;
    };
  }, [name]);

  const lovelace = parseAda(amount);
  const round = typeof lovelace === "string" && BigInt(lovelace) % 1_000_000n === 0n;
  // The builder decides exactly (fee, change); this catches the obvious case early.
  const tooMuch = typeof lovelace === "string" && BigInt(lovelace) > BigInt(seedelf.lovelace);
  const tokens = tokenChoices(seedelf.tokens, tokenAmounts);
  const ready =
    found.state === "found" && typeof lovelace === "string" && lovelace !== "0" && !tooMuch && tokens.ok;

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || !name || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setSummary(await call("transfer-build", { to: name, lovelace, tokens: tokens.sent }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!summary || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      onSent(await call("transfer-submit", { txHash: summary.txHash }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <Screen
        title="Review the transfer"
        titleId="transfer-review"
        onBack={() => setSummary(undefined)}
        backDisabled={busy}
        aside="Nothing is sent until you press Send"
        error={error}
        foot={
          <button type="button" className="primary" onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send"}
          </button>
        }
      >
        <ReviewRows testId="transfer-review">
          <Row label="To" value={summary.label ?? "Unnamed seedelf"} strong />
          <Row label="Seedelf name" value={shortHex(summary.to, 16, 8)} title={summary.to} />
          <Row label="Amount" value={`${formatAda(summary.lovelace)} ₳`} strong />
          {summary.tokens.map((t) => {
            const held = seedelf.tokens.find((h) => key(h) === key(t));
            return (
              <Row
                key={key(t)}
                label=""
                value={`${formatQuantity(t.quantity, held?.decimals ?? 0)} ${tokenLabel(network, t)}`}
              />
            );
          })}
          <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
          <Row label="Back to your Seedelf balance" value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          <Row label="Seedelf UTxOs spent" value={String(summary.inputs)} />
        </ReviewRows>
        {summary.toSelf && (
          <Callout tone="warn" testId="transfer-to-self">
            This seedelf is yours: the payment comes back to your Seedelf balance, less the fee.
          </Callout>
        )}
        <p className="note">
          Only the owner of this seedelf can spend the payment, and it can't be linked to their seedelf by looking at the
          chain. Send asks giveme.my to lend the collateral, then submits. It takes about a minute for the network to
          confirm.
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title="Send to a seedelf"
      titleId="transfer-title"
      onBack={onCancel}
      aside={`${formatAda(seedelf.lovelace)} ₳ in your Seedelf balance`}
      error={error}
      foot={
        <button type="submit" className="primary" disabled={!ready || busy}>
          {busy ? "Building…" : "Review"}
        </button>
      }
    >
      <div className="field">
        <div className="field-row">
          <label htmlFor="transfer-to">Seedelf name</label>
          {hasContacts && (
            <button type="button" className="link" onClick={() => setContactModal("pick")}>
              Contacts
            </button>
          )}
        </div>
        <textarea
          id="transfer-to"
          className="seedelf-name"
          rows={2}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="5eed0e1f…"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          aria-invalid={nameProblem || found.state === "error" ? true : undefined}
          aria-describedby="transfer-to-note"
        />
        <div id="transfer-to-note" data-testid="transfer-to-note">
          {nameProblem ? (
            <p className="field-note">{nameProblem}</p>
          ) : found.state === "looking" ? (
            <p className="note">Looking it up…</p>
          ) : found.state === "error" ? (
            <p className="field-note" role="alert">
              {found.message}
            </p>
          ) : found.state === "found" ? (
            <p className="note">
              Found: <strong>{found.seedelf.label ?? "Unnamed"}</strong> · <code>{shortHex(found.seedelf.name, 12, 6)}</code>
              {saved ? (
                <> · your contact {saved.name}</>
              ) : (
                !found.seedelf.own &&
                contacts && (
                  <>
                    {" · "}
                    <button type="button" className="link" onClick={() => setContactModal("save")}>
                      Save to contacts
                    </button>
                  </>
                )
              )}
            </p>
          ) : (
            <p className="note">
              Paste the whole name the recipient gave you. Tags aren't unique, so the name is what counts.
            </p>
          )}
        </div>
      </div>
      {found.state === "found" && found.seedelf.own && (
        <Callout tone="warn" testId="transfer-own">
          This seedelf is yours. Paying it moves money in a circle and costs a fee.
        </Callout>
      )}

      <div className="field">
        <label htmlFor="transfer-amount">Amount</label>
        <AdaInput id="transfer-amount" value={amount} onChange={setAmount} autoFocus={false} />
        {tooMuch && (
          <p className="field-note" data-testid="transfer-too-much">
            That's more than the {formatAda(seedelf.lovelace)} ₳ in your Seedelf balance.
          </p>
        )}
      </div>
      <RoundNote warn={!!lovelace && !round}>
        Round amounts, like 100 ₳, are harder to match to the move-in that paid for them.
      </RoundNote>

      <TokenAmounts held={seedelf.tokens} typed={tokenAmounts} onChange={setTokenAmounts} />

      <Callout tone="privacy">
        Sending right after moving in is easy to match by timing: the move-in and the payment sit close together on chain.
      </Callout>
      {contactModal === "pick" && (
        <ContactPicker
          contacts={contacts ?? []}
          kind="seedelf"
          onClose={() => setContactModal(undefined)}
          onPick={(value) => {
            setTo(value);
            setContactModal(undefined);
          }}
        />
      )}
      {contactModal === "save" && name && (
        <ContactEditor
          value={name}
          onClose={() => setContactModal(undefined)}
          onSaved={(next) => {
            reloadContacts(next);
            setContactModal(undefined);
          }}
        />
      )}
    </Screen>
  );
}
