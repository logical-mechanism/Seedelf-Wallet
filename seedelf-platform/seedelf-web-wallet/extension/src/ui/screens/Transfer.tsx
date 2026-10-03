// Send, on the private side: pay seedelfs from the private (Seedelf) balance,
// up to 20 at once.
// Each recipient is pasted by full name (tags aren't unique), looked up in the
// wallet contract, and shown before anything is built. With tokens, an amount
// may stay empty: only the ADA they need goes. The worker builds the
// transfer, with Ogmios measuring its spends, and nothing is sent until the
// user has reviewed it and pressed Send.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useT } from "../../i18n";

import type { Balances, PendingTx, SeedelfLookup, TransferSummary } from "../../shared/rpc";
import { SEEDELF_NAME_RULE, seedelfName } from "../../shared/seedelf-name";
import { call } from "../background";
import { BuildStage } from "../components/BuildStage";
import { AdaInput, MinimumHint, MinimumNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { Clearable } from "../components/Clearable";
import { ContactEditor, ContactPicker, useContacts } from "../components/Contacts";
import {
  AddRecipient,
  fieldId,
  heldFor,
  RecipientCard,
  recipientAmounts,
  ReviewRecipients,
  TooMuchTogether,
  useRecipients,
} from "../components/Recipients";
import { Row } from "../components/ReviewRows";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { HandleWarning } from "../components/HandleWarning";
import { HistoriesNote } from "../components/HistoriesNote";
import { TokenAmounts } from "../components/TokenAmounts";
import { TokenAmountRow } from "../components/TokenList";
import { adaWithTokens, formatAda, lockedAside, shortHex, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { tokenQuantity } from "../tokens";

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
  const t = useT();
  const list = useRecipients();
  const [found, setFound] = useState<Record<number, Found>>({});
  const [summary, setSummary] = useState<TransferSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const amounts = recipientAmounts(network, seedelf.tokens, list.drafts, false);
  const foundOf = (id: number): Found => found[id] ?? { state: "idle" };
  // The builder decides exactly (fee, change); this catches the obvious case early.
  const tooMuch = amounts.total > BigInt(seedelf.lovelace);
  const ready = list.drafts.every((d) => foundOf(d.id).state === "found") && amounts.ok && !tooMuch;
  const available = t(seedelf.locked.utxos ? "withdraw.available" : "withdraw.inPrivate");

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const payments = amounts.each.map(({ draft, lovelace, tokens }) => {
        const f = foundOf(draft.id);
        return { to: f.state === "found" ? f.seedelf.name : draft.to, lovelace: lovelace!, tokens: tokens.sent };
      });
      setSummary(await call("transfer-build", { payments }));
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
    const several = summary.payments.length > 1;
    const recipientRows = (i: number) => {
      const p = summary.payments[i]!;
      return (
        <>
          {p.label ? (
            <>
              <Row label={t("destination.to")} value={p.label} strong />
              <Row label={t("utxos.seedelfName")} value={shortHex(p.to, 16, 8)} title={p.to} />
            </>
          ) : (
            <Row label={t("destination.to")} value={shortHex(p.to, 16, 8)} title={p.to} strong />
          )}
          <Row label={t("common.amount")} value={`${formatAda(p.lovelace)} ₳`} strong />
          {p.tokens.map((t) => {
            const held = seedelf.tokens.find((h) => key(h) === key(t));
            return <TokenAmountRow key={key(t)} label="" token={held ?? t} amount={tokenQuantity(network, { ...held, ...t })} />;
          })}
        </>
      );
    };
    return (
      <Screen
        title={t("withdraw.review.title")}
        titleId="transfer-review"
        onBack={() => setSummary(undefined)}
        backDisabled={busy}
        aside={t("review.nothingSent")}
        error={error}
        foot={
          <button type="button" className="primary" onClick={send} disabled={busy}>
            {busy ? t("common.sending") : t("common.send")}
          </button>
        }
      >
        <ReviewRecipients testId="transfer-review" payments={summary.payments} rows={recipientRows}>
          <Row label={t("review.fee")} value={`${formatAda(summary.fee.total)} ₳`} />
          <Row label={t("review.backToPrivate")} value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          <Row label={t("withdraw.review.spent")} value={String(summary.inputs)} />
        </ReviewRecipients>
        <TxDetailButton txHash={summary.txHash} testId="transfer-tx" />
        <HistoriesNote histories={summary.histories} testId="transfer-histories" />
        {summary.payments.map((p, i) => (
          <MinimumNote
            key={i}
            lovelace={p.lovelace}
            minimum={p.minimum}
            asked={amounts.each[i]?.lovelace ?? "0"}
            tokens={p.tokens.length}
            who={several ? t("recipients.nth", { number: i + 1 }) : undefined}
          />
        ))}
        {summary.payments.some((p) => p.toSelf) && (
          <Callout tone="warn" testId="transfer-to-self">
            {t(several ? "transfer.warn.toSelfSeveral" : "transfer.warn.toSelf")}
          </Callout>
        )}
        <p className="note">
          {t(several ? "transfer.review.noteEach" : "transfer.review.noteThis")}
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title={t("home.action.send")}
      titleId="transfer-title"
      onBack={onCancel}
      aside={
        seedelf.locked.utxos
          ? `${t("withdraw.asideAvailable", { amount: formatAda(seedelf.lovelace) })}${lockedAside(seedelf)}`
          : t("withdraw.asidePrivate", { amount: formatAda(seedelf.lovelace) })
      }
      error={error}
      foot={
        <>
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy ? t("common.building") : t("common.review")}
          </button>
          <BuildStage busy={busy} />
        </>
      }
    >
      {list.drafts.map((d, i) => {
        const f = foundOf(d.id);
        const e = amounts.each[i];
        const withTokens = (e?.tokens.sent.length ?? 0) > 0;
        return (
          <RecipientCard
            key={d.id}
            index={i}
            count={list.drafts.length}
            onRemove={() => {
              list.remove(d.id);
              setFound(({ [d.id]: _, ...rest }) => rest);
            }}
          >
            <SeedelfNameInput
              id={fieldId("transfer-to", d, i)}
              value={d.to}
              onChange={(to) => list.update(d.id, { to })}
              onFound={(result) => setFound((all) => ({ ...all, [d.id]: result }))}
            />
            {f.state === "found" && f.seedelf.own && (
              <Callout tone="warn" testId="transfer-own">
                {t("transfer.warn.ownSeedelf")}
              </Callout>
            )}

            <div className="field">
              <label htmlFor={fieldId("transfer-amount", d, i)}>{t("common.amount")}</label>
              <AdaInput
                id={fieldId("transfer-amount", d, i)}
                value={d.amount}
                onChange={(amount) => list.update(d.id, { amount })}
                placeholder={withTokens ? t("common.minimum") : "0"}
                autoFocus={false}
              />
              {!list.several && tooMuch && (
                <p className="field-note" data-testid="transfer-too-much">
                  {t("transfer.tooMuch", { amount: formatAda(seedelf.lovelace) })}
                </p>
              )}
            </div>
            {withTokens && <MinimumHint />}

            <TokenAmounts
              held={heldFor(network, seedelf.tokens, list.drafts, d)}
              typed={d.tokens}
              onChange={(tokens) => list.update(d.id, { tokens })}
            />
            <HandleWarning tokens={e?.tokens.sent ?? []} />
          </RecipientCard>
        );
      })}
      <AddRecipient count={list.drafts.length} onAdd={list.add} />
      {list.several && (
        <TooMuchTogether total={amounts.total} available={seedelf.lovelace} testId="transfer-too-much" where={available} />
      )}

      <Callout tone="privacy">
        {t("transfer.privacy.timing")}
      </Callout>
    </Screen>
  );
}

/** A seedelf's name, looked up once it's whole, with Contacts to pick from and to save it to; reports what it found. */
function SeedelfNameInput({
  id,
  value,
  onChange,
  onFound,
}: {
  id: string;
  value: string;
  onChange: (to: string) => void;
  onFound: (found: Found) => void;
}) {
  const t = useT();
  const [found, setFound] = useState<Found>({ state: "idle" });
  const [contacts, reloadContacts] = useContacts();
  const [contactModal, setContactModal] = useState<"pick" | "save">();
  const report = useRef(onFound);
  report.current = onFound;

  const name = seedelfName(value);
  const saved = name ? contacts?.find((c) => c.kind === "seedelf" && c.value === name) : undefined;
  const hasContacts = !!contacts?.some((c) => c.kind === "seedelf");
  const nameProblem = value.trim() !== "" && !name ? SEEDELF_NAME_RULE : undefined;

  // Look the seedelf up once a whole name is pasted.
  useEffect(() => {
    if (!name) {
      setFound({ state: "idle" });
      return;
    }
    let current = true;
    setFound({ state: "looking" });
    call("seedelf-lookup", { to: name }).then(
      (s) => current && setFound({ state: "found", seedelf: s }),
      (e: Error) => current && setFound({ state: "error", message: e.message }),
    );
    return () => {
      current = false;
    };
  }, [name]);
  useEffect(() => report.current(found), [found]);

  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id}>{t("utxos.seedelfName")}</label>
        {hasContacts && (
          <button type="button" className="link" onClick={() => setContactModal("pick")}>
            {t("destination.contacts")}
          </button>
        )}
      </div>
      {/* A seedelf's name is 68 characters: the hardest field in the wallet to
          clear by hand (the owner, 2026-10-02). */}
      <Clearable id={id} value={value} onClear={() => onChange("")} what={t("destination.what.recipient")}>
        <textarea
          id={id}
          className="seedelf-name"
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="5eed0e1f…"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          aria-invalid={nameProblem || found.state === "error" ? true : undefined}
          aria-describedby={`${id}-note`}
        />
      </Clearable>
      <div id={`${id}-note`} data-testid={`${id}-note`}>
        {nameProblem ? (
          <p className="field-note">{nameProblem}</p>
        ) : found.state === "looking" ? (
          <p className="note">{t("transfer.lookingUp")}</p>
        ) : found.state === "error" ? (
          <p className="field-note" role="alert">
            {found.message}
          </p>
        ) : found.state === "found" ? (
          <p className="note">
            {t("destination.found")}{" "}
            {found.seedelf.label && <><strong>{found.seedelf.label}</strong> · </>}
            <code>{shortHex(found.seedelf.name, 12, 6)}</code>
            {saved ? (
              <>{" · "}{t("destination.yourContact", { name: saved.name })}</>
            ) : (
              !found.seedelf.own &&
              contacts && (
                <>
                  {" · "}
                  <button type="button" className="link" onClick={() => setContactModal("save")}>
                    {t("destination.saveToContacts")}
                  </button>
                </>
              )
            )}
          </p>
        ) : (
          <p className="note">{t("transfer.pasteName")}</p>
        )}
      </div>
      {contactModal === "pick" && (
        <ContactPicker
          contacts={contacts ?? []}
          kind="seedelf"
          onClose={() => setContactModal(undefined)}
          onPick={(picked) => {
            onChange(picked);
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
    </div>
  );
}
