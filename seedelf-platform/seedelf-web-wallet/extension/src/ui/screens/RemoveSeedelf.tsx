// Remove a seedelf: burn its token and free the ADA locked with it. That ADA
// goes back by default to the side that paid for the seedelf, when the wallet
// knows (SeedelfInfo.paidBy, background/minted-by.ts): the Cardano account for
// one it paid for, which links to it anyway; the Seedelf balance for a
// stealth mint, whose ADA sent to the account would tie the account to the
// seedelf's name and the private UTxOs that paid for it (privacy review
// §3.2). When the wallet doesn't know (a restore, another browser), nothing
// is chosen, and Review waits for the user to pick: either side can make a
// link the user didn't choose, so the wallet won't make it for them. The note
// says which is the safer guess (chunk 23's second review, RX-3), and each
// side's card says in a line what it links for this seedelf, the note under
// them in full. Nothing is sent until the user has reviewed it and pressed
// Remove Seedelf.
//
// **Which account paid matters, not only which side** (chunk 18). The mint is
// public, so it already links the Seedelf to the account that paid for it.
// Sending the freed ADA to a *different* account links that one to the
// Seedelf's name too, and anyone can join the two by the name — so the two
// accounts are tied together. `paidByAccount` says which paid, and the note
// warns when the wallet has since moved to another.

import { useState, type FormEvent } from "react";
import { type I18nKey, t, useT } from "../../i18n";

import type { MintSource, PendingTx, RemoveSummary, RemoveTo, SeedelfInfo } from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { call, isStale } from "../background";
import { BuildStage } from "../components/BuildStage";
import { Callout } from "../components/Callout";
import { GivemeNote } from "../components/GivemeNote";
import { ShieldIcon, WalletIcon } from "../components/Icons";
import { RadioCards } from "../components/RadioCards";
import { ReviewRows, Row } from "../components/ReviewRows";
import { RenewedNote, StaleFoot, useStale } from "../components/StaleReview";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { formatAda } from "../format";

/** Where the freed ADA goes. Keys: the review's "Back to your …" is a whole key, not this one lowercased. */
const DESTINATIONS = { account: "mint.source.account", seedelf: "mint.source.seedelf" } as const satisfies Record<RemoveTo, I18nKey>;

/**
 * What sending the freed ADA to `to` links, for a Seedelf `paidBy` paid for;
 * a warning where it links something new.
 *
 * `accounts`: which public account paid (`paidByAccount`) and which the
 * wallet is on now (`active`), when there is more than one to tell apart.
 * Where they differ, sending to the public account ties the two accounts
 * together, which is the strongest warning here.
 */
export function removeNote(
  to: RemoveTo | undefined,
  paidBy: MintSource | undefined,
  accounts?: { paidByAccount?: number; active: number; several: boolean },
): { tone: "privacy" | "warn"; text: string } {
  // Said before anything else: a different account's is the one case where
  // removing to "the public account" ties two of the user's accounts
  // together, in the open, and the default would have done it quietly.
  if (
    to === "account" &&
    paidBy === "account" &&
    accounts?.several &&
    accounts.paidByAccount !== undefined &&
    accounts.paidByAccount !== accounts.active
  ) {
    return {
      tone: "warn",
      text: t("remove.warn.otherAccount", { paid: accounts.paidByAccount + 1, active: accounts.active + 1 }),
    };
  }
  if (to === undefined) {
    return {
      tone: "privacy",
      text: t("remove.privacy.unknownPayer"),
    };
  }
  if (to === paidBy) {
    return {
      tone: "privacy",
      text:
        to === "account"
          ? t("remove.privacy.backToAccount", {
              // `.privacy.` as the note is: the screen shows `note.text`, so
              // the critical-set deriver never sees this key in the JSX.
              whose:
                accounts?.several && accounts.paidByAccount !== undefined
                  ? t("accountPicker.numbered", { number: accounts.paidByAccount + 1 })
                  : t("remove.privacy.yourPublicAccount"),
            })
          : t("remove.privacy.backToPrivate"),
    };
  }
  if (to === "account") {
    return paidBy === "seedelf"
      ? {
          tone: "warn",
          text: t("remove.warn.privatePaid"),
        }
      : {
          tone: "privacy",
          text: t("remove.privacy.maybeAccountPaid"),
        };
  }
  return paidBy === "account"
    ? {
        tone: "warn",
        text: t("remove.warn.accountPaid"),
      }
    : {
        tone: "privacy",
        text: t("remove.privacy.maybePrivatePaid"),
      };
}

/**
 * What sending the freed ADA to `to` links, in a line, for the card that
 * offers it: nothing new back to the side that paid, a link otherwise, and
 * which side it's safe for when the wallet doesn't know who paid
 * (chunk 23's second review, RX-3).
 */
export function removeOption(to: RemoveTo, paidBy: MintSource | undefined): string {
  if (paidBy === undefined) return t(to === "account" ? "remove.privacy.option.ifAccountPaid" : "remove.privacy.option.ifPrivatePaid");
  if (to === paidBy) return t("remove.privacy.option.nothingNew");
  return t(to === "account" ? "remove.privacy.option.tiesAccount" : "remove.privacy.option.tiesName");
}

export function RemoveSeedelf({
  seedelf,
  onCancel,
  onSent,
}: {
  seedelf: SeedelfInfo;
  onCancel: () => void;
  onSent: (pending: PendingTx) => void;
}) {
  const t = useT();
  // The side that paid for it, when the wallet knows; nothing otherwise.
  const [to, setTo] = useState<RemoveTo | undefined>(seedelf.paidBy);
  const [summary, setSummary] = useState<RemoveSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The worker's words for a review that can't go as it is: Remove gives way to building it again.
  const stale = useStale();
  const name = seedelf.label ?? t("remove.aSeedelf");
  const { active, several } = useAccounts();
  const note = removeNote(to, seedelf.paidBy, { paidByAccount: seedelf.paidByAccount, active, several });

  function review(e: FormEvent) {
    e.preventDefault();
    void build();
  }

  async function build() {
    if (busy || !to) return;
    setBusy(true);
    setError(undefined);
    // A refusal stays, its foot saying it's building, until the new review is in (chunk 23's second review, PY-1).
    try {
      setSummary(await call("remove-build", { name: seedelf.assetName, to }));
      stale.built();
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
      onSent(await call("remove-submit", { txHash: summary.txHash }));
    } catch (err) {
      if (isStale(err)) stale.refused(err);
      else setError((err as Error).message);
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <Screen
        title={t("remove.review.title")}
        titleId="remove-review"
        review
        onBack={() => {
          // The review's error is the review's: the form it goes back to starts clean, as a swap's does.
          setSummary(undefined);
          setError(undefined);
          stale.clear();
        }}
        backDisabled={busy}
        aside={t("review.nothingUntil", { action: t("remove.review.button") })}
        error={error}
        foot={
          stale.detail !== undefined ? (
            <StaleFoot detail={stale.detail} by={stale.by} busy={busy} onAgain={() => void build()} />
          ) : (
            <>
              <RenewedNote renewed={stale.renewed} />
              {/* The screen's own verb: every review's button used to say Send (chunk 23's review, S-7). Red, as Stop
                  staking's and Remove wallet's are: the Seedelf's name can't be paid again once it's gone
                  (chunk 23's second review, V-3). */}
              <button type="button" className="danger" onClick={send} disabled={busy}>
                {busy ? t("common.sending") : t("remove.review.button")}
              </button>
            </>
          )
        }
      >
        <ReviewRows testId="remove-review">
          {summary.label && <Row label={t("activity.row.seedelf")} value={summary.label} strong />}
          <Row label={t("utxos.seedelfName")} value={summary.name} whole />
          {/* What comes back, not change: its own words, as "Back to your …" now names a change output nowhere. */}
          <Row label={t(summary.to === "account" ? "remove.review.toPublic" : "remove.review.toPrivate")} value={`${formatAda(summary.lovelace)}\u00a0₳`} strong />
          <Row label={t("review.fee")} value={`${formatAda(summary.fee.total)}\u00a0₳`} />
        </ReviewRows>
        <TxDetailButton txHash={summary.txHash} testId="remove-tx" />
        <p className="note">
          {t("remove.review.note")}
        </p>
        <GivemeNote />
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title={t("remove.title", { name })}
      titleId="remove-title"
      onBack={onCancel}
      aside={t("remove.aside", { amount: formatAda(seedelf.lovelace) })}
      error={error}
      foot={
        <>
          <BuildStage busy={busy} />
          <button type="submit" className="primary" disabled={busy || !to} title={to ? undefined : t("remove.chooseWhere")}>
            {busy ? t("common.building") : t("common.review")}
          </button>
          {/* Why Review waits, where a touch screen shows it (chunk 23's review, H-1). */}
          {!to && <p className="note foot-note">{t("remove.chooseWhere")}</p>}
        </>
      }
    >
      <p className="note">
        {t("remove.note")}
      </p>
      <code className="copy-field__value" title={seedelf.assetName}>
        {seedelf.assetName}
      </code>

      {/* Cards, not a pill switch: where the ADA goes decides what it links (chunk 23's review, V-4). Each says what
          it links in a line, the note under them in full (chunk 23's second review, RX-3). */}
      <RadioCards
        label={t("remove.sendFreedTo")}
        id="remove-to"
        value={to}
        onChange={setTo}
        options={(["account", "seedelf"] as const).map((d) => ({
          value: d,
          label: t(DESTINATIONS[d]),
          text: removeOption(d, seedelf.paidBy),
          icon: d === "account" ? <WalletIcon size={16} /> : <ShieldIcon size={16} />,
        }))}
      />
      <Callout tone={note.tone} testId="remove-to-note">
        {note.text}
      </Callout>
    </Screen>
  );
}
