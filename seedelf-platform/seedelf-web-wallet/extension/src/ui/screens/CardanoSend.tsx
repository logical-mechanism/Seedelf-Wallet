// Send from the Cardano account: pay any normal address, or an ADA Handle,
// as any Cardano wallet does; or someone's seedelf by its whole name, paid
// into Seedelf under a fresh copy of its register, like a move-in. Up to 20
// recipients at once, each with an amount and optional tokens (with tokens,
// the amount may stay empty: only the ADA they need goes); or the most
// possible (Max) to a single recipient, and an optional note (CIP-20's
// message, one line of 64 characters, which anyone can read). It's paid in
// the open; the privacy note says what that shows, and how to pay without
// that link. The worker builds and signs; nothing is sent until the user has
// reviewed it and pressed Send.

import { useState, type FormEvent } from "react";
import { useT } from "../../i18n";

import type { Balances, PendingTx, SendPaid, SendSummary } from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { call } from "../background";
import { BuildStage } from "../components/BuildStage";
import { AdaInput, MinimumHint, MinimumNote } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { DestinationInput, type DestinationRead, type KnownRead } from "../components/Destination";
import { HandleWarning } from "../components/HandleWarning";
import { LeftOutNote } from "../components/LeftOut";
import {
  AddRecipient,
  fieldId,
  heldFor,
  RecipientCard,
  type Draft,
  recipientAmounts,
  ReviewRecipients,
  TooMuchTogether,
  useRecipients,
} from "../components/Recipients";
import { Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TxDetailButton } from "../components/TxDetail";
import { TokenAmounts } from "../components/TokenAmounts";
import { TokenAmountRow } from "../components/TokenList";
import { adaWithTokens, formatAda, lockedAside, rewardsAside, shortHex, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { tokenQuantity } from "../tokens";

/** The longest note: one of CIP-20's lines, as Lace allows (core's `MAX_NOTE_CHARS`). */
const NOTE_MAX = 64;

export function CardanoSend({
  cardano,
  rewards,
  onCancel,
  onSent,
}: {
  /** What can pay: `lovelace` includes `rewards`. */
  cardano: Balances["cardano"];
  /** Staking rewards that ride along (lovelace), when any do. */
  rewards?: string;
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const network = useNetwork();
  const list = useRecipients();
  const t = useT();
  const [reads, setReads] = useState<Record<number, KnownRead>>({});
  const [max, setMax] = useState(false);
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState<SendSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Max pays a single recipient.
  const maxed = max && !list.several;
  const amounts = recipientAmounts(network, cardano.tokens, list.drafts, maxed);
  // A field's read counts only for the text it read.
  const { active } = useAccounts();
  const readOf = (d: Draft): DestinationRead =>
    reads[d.id]?.to === d.to.trim() ? reads[d.id]!.read : { state: "idle" };
  const found = list.drafts.every((d) => ["read", "seedelf"].includes(readOf(d).state));
  // Another of the user's own public accounts: allowed, and said (the owner,
  // 2026-10-02). A user may well want to move money between their own
  // accounts, and accounts aren't necessarily unlinked in the first place —
  // some of what the wallet already does links them. So the row says what the
  // payment reveals and the user decides, as every other known link does
  // (docs/privacy.md, *Known links*).
  const otherAccount = (r: DestinationRead) =>
    r.state === "read" && r.destination.ownAccount !== undefined && r.destination.ownAccount !== active
      ? r.destination.ownAccount
      : undefined;

  // The builder decides exactly (fee, change, collateral UTxOs); this catches the obvious case early.
  const tooMuch = !maxed && amounts.total > BigInt(cardano.lovelace);
  const ready = found && amounts.ok && !tooMuch;
  const toSeedelf = list.drafts.some((d) => readOf(d).state === "seedelf");

  async function review(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const payments = amounts.each.map(({ draft, lovelace, tokens }) => {
        const read = readOf(draft);
        return { to: read.state === "seedelf" ? read.seedelf.name : draft.to.trim(), lovelace: lovelace ?? null, tokens: tokens.sent };
      });
      setSummary(await call("send-build", { payments, note: note.trim() || undefined }));
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
      onSent(await call("send-submit", { txHash: summary.txHash }));
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
          <ToRows paid={p} />
          <Row label={t("common.amount")} value={`${formatAda(p.lovelace)} ₳`} strong />
          {p.tokens.map((t) => {
            const held = cardano.tokens.find((h) => key(h) === key(t));
            return <TokenAmountRow key={key(t)} label="" token={held ?? t} amount={tokenQuantity(network, { ...held, ...t })} />;
          })}
        </>
      );
    };
    return (
      <Screen
        title={t("withdraw.review.title")}
        titleId="send-review"
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
        <ReviewRecipients testId="send-review" payments={summary.payments} rows={recipientRows}>
          {summary.note && <Row label={t("activity.row.note")} value={summary.note} />}
          <Row label={t("review.fee")} value={`${formatAda(summary.fee)} ₳`} />
          <WithdrawalRow withdrawal={summary.withdrawal} />
          <Row label={t("review.backToPublic")} value={adaWithTokens(summary.changeLovelace, summary.changeTokens)} />
          <Row label={t("send.review.spent")} value={String(summary.inputs)} />
        </ReviewRecipients>
        <TxDetailButton txHash={summary.txHash} testId="send-tx" />
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
        {summary.payments.some((p) => p.own) && <OwnNote />}
        <LeftOutNote leftOut={summary.leftOut} testId="send-left-out" />
        <p className="note">
          {summary.payments.some((p) => p.seedelf) &&
            `${t(several ? "send.review.onlyOwnerEach" : "send.review.onlyOwnerThis")} `}
          {t("send.review.confirmTime")}
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title={t("home.action.send")}
      titleId="send-title"
      onBack={onCancel}
      aside={`${t("withdraw.asideAvailable", { amount: formatAda(cardano.lovelace) })}${rewardsAside(rewards)}${lockedAside(cardano)}`}
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
        const read = readOf(d);
        const withTokens = (amounts.each[i]?.tokens.sent.length ?? 0) > 0;
        return (
          <RecipientCard
            key={d.id}
            index={i}
            count={list.drafts.length}
            onRemove={() => {
              list.remove(d.id);
              setReads(({ [d.id]: _, ...rest }) => rest);
            }}
          >
            <DestinationInput
              id={fieldId("send-to", d, i)}
              value={d.to}
              onChange={(to) => list.update(d.id, { to })}
              known={reads[d.id]}
              onRead={(r) => setReads((all) => ({ ...all, [d.id]: r }))}
              seedelfs
              ownAccounts
            />
            {read.state === "read" &&
              read.destination.own &&
              (otherAccount(read) !== undefined ? <OtherAccountNote index={otherAccount(read)!} /> : <OwnNote />)}

            <div className="field">
              <label htmlFor={fieldId("send-amount", d, i)}>{t("common.amount")}</label>
              <AdaInput
                id={fieldId("send-amount", d, i)}
                value={d.amount}
                onChange={(amount) => list.update(d.id, { amount })}
                disabled={maxed}
                shown={t("common.max")}
                placeholder={withTokens ? t("common.minimum") : "0"}
                autoFocus={false}
              >
                {!list.several && (
                  <button type="button" className="chip" aria-pressed={max} onClick={() => setMax(!max)}>
                    {t("common.max")}
                  </button>
                )}
              </AdaInput>
              {!list.several && tooMuch && (
                <p className="field-note" data-testid="send-too-much">
                  {t("moveIn.tooMuch", { amount: formatAda(cardano.lovelace) })}
                </p>
              )}
            </div>
            {maxed ? (
              <p className="note" data-testid="send-max-note">
                {t(rewards ? "moveIn.maxNoteRewards" : "moveIn.maxNote")}
              </p>
            ) : (
              withTokens && <MinimumHint />
            )}

            <TokenAmounts
              held={heldFor(network, cardano.tokens, list.drafts, d)}
              typed={d.tokens}
              onChange={(tokens) => list.update(d.id, { tokens })}
            />
            {read.state === "seedelf" && <HandleWarning tokens={amounts.each[i]?.tokens.sent ?? []} />}
          </RecipientCard>
        );
      })}
      <AddRecipient
        count={list.drafts.length}
        onAdd={() => {
          setMax(false);
          list.add();
        }}
      />
      {list.several && (
        <TooMuchTogether
          total={amounts.total}
          available={cardano.lovelace}
          testId="send-too-much"
          where={t("send.availableInPublic")}
        />
      )}

      <div className="field">
        <label htmlFor="send-note">{t("send.note.label")}</label>
        <input
          id="send-note"
          value={note}
          // Characters, as core counts them: an input's maxLength counts UTF-16 units, so an emoji would count twice.
          onChange={(e) => setNote([...e.target.value].slice(0, NOTE_MAX).join(""))}
          autoComplete="off"
          // Not spell-checked, as no field in the wallet is: Chrome's enhanced
          // spell check would send the note to Google before it's sent, even
          // one never sent, and a note is unique enough to find its payment.
          spellCheck={false}
          placeholder={t("send.note.placeholder")}
          aria-describedby="send-note-hint"
        />
        <p className="note" id="send-note-hint" data-testid="send-note-hint">
          {t(toSeedelf ? "send.note.privacy.hintSeedelf" : "send.note.privacy.hint", { used: [...note].length, max: NOTE_MAX })}
        </p>
      </div>

      <Callout tone="privacy">
        {t(
          toSeedelf
            ? list.several
              ? "send.privacy.openSeedelfSeveral"
              : "send.privacy.openSeedelf"
            : list.several
              ? "send.privacy.openSeveral"
              : "send.privacy.open",
        )}
      </Callout>
    </Screen>
  );
}

/** Where one payment went: a Seedelf by tag and name, a $handle and its address, or an address. */
function ToRows({ paid }: { paid: SendPaid }) {
  const t = useT();
  if (paid.seedelf) {
    const { name, label } = paid.seedelf;
    return label ? (
      <>
        <Row label={t("destination.to")} value={label} strong />
        <Row label={t("utxos.seedelfName")} value={shortHex(name, 16, 8)} title={name} />
      </>
    ) : (
      <Row label={t("destination.to")} value={shortHex(name, 16, 8)} title={name} strong />
    );
  }
  return (
    <>
      <Row label={t("destination.to")} value={paid.handle ? `$${paid.handle}` : shortHex(paid.address, 16, 8)} title={paid.address} strong />
      {paid.handle && <Row label={t("utxos.address")} value={shortHex(paid.address, 16, 8)} title={paid.address} />}
    </>
  );
}

/** The staking rewards a payment from the account spent, when it did. */
export function WithdrawalRow({ withdrawal }: { withdrawal?: string }) {
  const t = useT();
  if (!withdrawal || BigInt(withdrawal) === 0n) return null;
  return <Row label={t("activity.row.rewardsSpent")} value={`${formatAda(withdrawal)} ₳`} />;
}

function OwnNote() {
  const t = useT();
  return (
    <Callout tone="warn" testId="send-own">
      {t("send.warn.ownAccount")}
    </Callout>
  );
}

/**
 * Another of the user's own public accounts: said, not refused (the owner,
 * 2026-10-02). Moving money between your own accounts is a thing people want
 * to do, and accounts aren't necessarily unlinked — so this is a known link
 * like any other: the wallet makes it visible and the user decides.
 */
function OtherAccountNote({ index }: { index: number }) {
  const t = useT();
  return (
    <Callout tone="privacy" testId="send-other-account">
      {t("send.privacy.otherAccount", { number: index + 1 })}
    </Callout>
  );
}
