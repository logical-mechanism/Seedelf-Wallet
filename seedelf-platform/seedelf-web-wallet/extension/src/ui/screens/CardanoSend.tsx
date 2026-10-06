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
import { joinSentences, useT } from "../../i18n";

import type { Balances, PendingTx, SendPaid, SendSummary } from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { call } from "../background";
import { BuildStage } from "../components/BuildStage";
import { AdaInput, amountText, MinimumHint, MinimumNote } from "../components/AdaInput";
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
  ReviewWait,
  TooMuchTogether,
  type ToState,
  useRecipients,
  waitingFor,
} from "../components/Recipients";
import { Row } from "../components/ReviewRows";
import { RewardsRow, RewardsSetting, TotalRows } from "../components/ReviewTotals";
import { Screen } from "../components/Screen";
import { TxDetailButton } from "../components/TxDetail";
import { TokenAmounts } from "../components/TokenAmounts";
import { TokenAmountRow } from "../components/TokenList";
import { adaText, lockedAside, rewardsAside, tokenKey as key } from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { tokenQuantity } from "../tokens";

/** The longest note: one of CIP-20's lines, as Lace allows (core's `MAX_NOTE_CHARS`). */
const NOTE_MAX = 64;

export function CardanoSend({
  cardano,
  rewards,
  total,
  picked,
  to,
  amount,
  onCancel,
  onSent,
}: {
  /** What can pay: `lovelace` includes `rewards`. */
  cardano: Balances["cardano"];
  /** Staking rewards that ride along (lovelace), when any do. */
  rewards?: string;
  /** All the account holds, as Home shows it (locked UTxOs and rewards in): the review's balance after. */
  total?: string;
  /** Tokens picked already, from a token's details: each asks for its amount. */
  picked?: Record<string, string>;
  /** An address, and the amount typed, handed on from private Send, which pays only Seedelfs (blind test §9.7). */
  to?: string;
  amount?: string;
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const network = useNetwork();
  const list = useRecipients(to, picked, amount);
  const t = useT();
  const [reads, setReads] = useState<Record<number, KnownRead>>({});
  const [max, setMax] = useState(false);
  const [note, setNote] = useState("");
  // A pasted note longer than a note can be is cut to fit, and says so (chunk 23's second review, PY-12).
  const [noteCut, setNoteCut] = useState(false);
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
  // What the form shows of the balance: masked while balances are hidden, as Home's is (chunk 23's second
  // review, HM-9). The review shows what's sent in full, since it's read before sending.
  const shown = useAmounts();
  const toState = (d: Draft): ToState => {
    const state = readOf(d).state;
    if (d.to.trim() === "") return "empty";
    return state === "error" ? "bad" : state === "read" || state === "seedelf" ? "ok" : "reading";
  };
  const waiting = amounts.each.map((e) =>
    waitingFor({
      to: toState(e.draft),
      amount: e.draft.amount,
      tokensPicked: Object.keys(e.draft.tokens).length > 0,
      tokensOk: e.tokens.ok,
      max: maxed,
    }),
  );

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
    // A payment to this same account comes straight back: it isn't leaving.
    const leaving = summary.payments.reduce(
      (sum, p) => (p.own && p.ownAccount === active ? sum : sum + BigInt(p.lovelace)),
      BigInt(summary.fee),
    );
    // Tokens leave too, unless they come straight back: the total says how many kinds (PY-5).
    const tokenKinds = new Set(
      summary.payments.filter((p) => !(p.own && p.ownAccount === active)).flatMap((p) => p.tokens.map(key)),
    ).size;
    const recipientRows = (i: number) => {
      const p = summary.payments[i]!;
      return (
        <>
          <ToRows paid={p} />
          <Row
            label={t("common.amount")}
            value={amountText(p.lovelace, p.minimum, amounts.each[i]?.lovelace ?? "0")}
            strong
          />
          {/* Labelled once, over the first: a row with no label read as part of the amount's (PY-14). */}
          {p.tokens.map((tk, n) => {
            const held = cardano.tokens.find((h) => key(h) === key(tk));
            return (
              <TokenAmountRow
                key={key(tk)}
                label={n === 0 ? t("review.tokens") : ""}
                token={held ?? tk}
                amount={tokenQuantity(network, { ...held, ...tk })}
              />
            );
          })}
        </>
      );
    };
    return (
      <Screen
        title={t("withdraw.review.title")}
        titleId="send-review"
        review
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
          <Row label={t("review.fee")} value={adaText(summary.fee)} />
          <RewardsRow withdrawal={summary.withdrawal} />
          <TotalRows side="public" leaving={leaving} before={total} tokens={tokenKinds} />
        </ReviewRecipients>
        <TxDetailButton txHash={summary.txHash} testId="send-tx" />
        <RewardsSetting withdrawal={summary.withdrawal} />
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
        {/* With several, each own one by its number: "your own public account" didn't say which it meant (PY-5).
            Another of the user's accounts says what paying it shows, as the form did: it doesn't come back here. */}
        {summary.payments.map((p, i) =>
          !p.own ? null : p.ownAccount !== undefined && p.ownAccount !== active ? (
            <OtherAccountNote key={i} index={p.ownAccount} />
          ) : (
            <OwnNote key={i} nth={several ? i + 1 : undefined} />
          ),
        )}
        <LeftOutNote leftOut={summary.leftOut} testId="send-left-out" />
        <p className="note">
          {joinSentences([
            summary.payments.some((p) => p.seedelf) && t(several ? "send.review.onlyOwnerEach" : "send.review.onlyOwnerThis"),
            t("send.review.confirmTime"),
          ])}
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
      aside={`${t("withdraw.asideAvailable", { amount: shown.ada(cardano.lovelace) })}${rewardsAside(rewards, shown.ada)}${lockedAside(cardano, shown.ada)}`}
      error={error}
      foot={
        <>
          <BuildStage busy={busy} />
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy ? t("common.building") : t("common.review")}
          </button>
          {!ready && <ReviewWait reasons={waiting} tooMuch={tooMuch} busy={busy} />}
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
                shown={t("common.maxUpTo", { amount: shown.ada(cardano.lovelace) })}
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
                  {t("moveIn.tooMuch", { amount: shown.ada(cardano.lovelace) })}
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
          onChange={(e) => {
            const chars = [...e.target.value];
            setNoteCut(chars.length > NOTE_MAX);
            setNote(chars.slice(0, NOTE_MAX).join(""));
          }}
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
        {noteCut && (
          <p className="field-note" data-testid="send-note-cut">
            {t("send.note.cut", { max: NOTE_MAX })}
          </p>
        )}
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

/**
 * Where one payment went: a Seedelf by tag and whole name, a $handle and its
 * whole address, or a whole address. Never shortened: a shortened address is
 * what an address poisoner's lookalike matches (chunk 23's review, S-4).
 */
function ToRows({ paid }: { paid: SendPaid }) {
  const t = useT();
  if (paid.seedelf) {
    const { name, label } = paid.seedelf;
    return label ? (
      <>
        <Row label={t("destination.to")} value={label} strong />
        <Row label={t("utxos.seedelfName")} value={name} whole />
      </>
    ) : (
      <Row label={t("destination.to")} value={name} whole />
    );
  }
  return paid.handle ? (
    <>
      <Row label={t("destination.to")} value={`$${paid.handle}`} strong />
      <Row label={t("utxos.address")} value={paid.address} whole />
    </>
  ) : (
    <Row label={t("destination.to")} value={paid.address} whole />
  );
}

/** This account's own address: `nth` names which recipient, on a review with several. */
function OwnNote({ nth }: { nth?: number }) {
  const t = useT();
  return (
    <Callout tone="warn" testId="send-own">
      {nth === undefined ? t("send.warn.ownAccount") : t("send.warn.ownAccountNth", { number: nth })}
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
