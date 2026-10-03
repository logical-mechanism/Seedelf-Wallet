// Remove a seedelf: burn its token and free the ADA locked with it. That ADA
// goes back by default to the side that paid for the seedelf, when the wallet
// knows (SeedelfInfo.paidBy, background/minted-by.ts): the Cardano account for
// one it paid for, which links to it anyway; the Seedelf balance for a
// stealth mint, whose ADA sent to the account would tie the account to the
// seedelf's name and the private UTxOs that paid for it (privacy review
// §3.2). When the wallet doesn't know (a restore, another browser), nothing
// is chosen, and Review waits for the user to pick. Each side's note says
// what it links for this seedelf. Nothing is sent until the user has
// reviewed it and pressed Send.
//
// **Which account paid matters, not only which side** (chunk 18). The mint is
// public, so it already links the Seedelf to the account that paid for it.
// Sending the freed ADA to a *different* account links that one to the
// Seedelf's name too, and anyone can join the two by the name — so the two
// accounts are tied together. `paidByAccount` says which paid, and the note
// warns when the wallet has since moved to another.

import { useState, type FormEvent } from "react";

import type { MintSource, PendingTx, RemoveSummary, RemoveTo, SeedelfInfo } from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { call } from "../background";
import { BuildStage } from "../components/BuildStage";
import { Callout } from "../components/Callout";
import { Choice } from "../components/Choice";
import { ReviewRows, Row } from "../components/ReviewRows";
import { TxDetailButton } from "../components/TxDetail";
import { Screen } from "../components/Screen";
import { formatAda, shortHex } from "../format";

const DESTINATIONS: Record<RemoveTo, string> = { account: "Public account", seedelf: "Private balance" };

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
      text:
        `Account ${accounts.paidByAccount + 1} paid for this Seedelf, and the wallet is on Account ${accounts.active + 1}. ` +
        "The mint already links the Seedelf's name to the account that paid, so sending its ADA here links this account to " +
        `that name as well — and anyone can tie your two accounts together through it. Switch to Account ${accounts.paidByAccount + 1} ` +
        "first, or send it to your private balance instead.",
    };
  }
  if (to === undefined) {
    return {
      tone: "privacy",
      text:
        "Choose where the freed ADA goes. This wallet doesn't know who paid for this Seedelf, as when it was minted in " +
        "another browser or before a restore. Send it back to the side that paid, so it links nothing new.",
    };
  }
  if (to === paidBy) {
    return {
      tone: "privacy",
      text:
        to === "account"
          ? `Back where this Seedelf's ADA came from: ${
              accounts?.several && accounts.paidByAccount !== undefined ? `Account ${accounts.paidByAccount + 1}` : "your public account"
            } paid for it, so this links nothing new.`
          : "Back where this Seedelf's ADA came from: your private balance paid for it, so this links nothing new.",
    };
  }
  if (to === "account") {
    return paidBy === "seedelf"
      ? {
          tone: "warn",
          text:
            "Your private balance paid for this Seedelf. Sending its ADA to your public account ties the account to the " +
            "Seedelf's name, and through the mint to the private UTxOs that paid for it and their change.",
        }
      : {
          tone: "privacy",
          text:
            "This links nothing new only if your public account paid for this Seedelf. If your private balance did, it ties " +
            "the account to the Seedelf's name, and through the mint to the private UTxOs that paid for it.",
        };
  }
  return paidBy === "account"
    ? {
        tone: "warn",
        text:
          "Your public account paid for this Seedelf. Sending its ADA to your private balance ties the Seedelf's name, and so " +
          "your account, to the new UTxO, and to whatever it's later spent with.",
      }
    : {
        tone: "privacy",
        text:
          "For a Seedelf you minted from your private balance. For one your public account paid for, this ties the " +
          "Seedelf's name to the new UTxO, and to whatever it's later spent with.",
      };
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
  // The side that paid for it, when the wallet knows; nothing otherwise.
  const [to, setTo] = useState<RemoveTo | undefined>(seedelf.paidBy);
  const [summary, setSummary] = useState<RemoveSummary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const name = seedelf.label ?? "a Seedelf";
  const { active, several } = useAccounts();
  const note = removeNote(to, seedelf.paidBy, { paidByAccount: seedelf.paidByAccount, active, several });

  async function review(e: FormEvent) {
    e.preventDefault();
    if (busy || !to) return;
    setBusy(true);
    setError(undefined);
    try {
      setSummary(await call("remove-build", { name: seedelf.assetName, to }));
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
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <Screen
        title="Review the removal"
        titleId="remove-review"
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
        <ReviewRows testId="remove-review">
          {summary.label && <Row label="Seedelf" value={summary.label} strong />}
          <Row label="Token name" value={shortHex(summary.name, 16, 8)} title={summary.name} strong={!summary.label} />
          <Row label={`Back to your ${DESTINATIONS[summary.to].toLowerCase()}`} value={`${formatAda(summary.lovelace)} ₳`} strong />
          <Row label="Network fee" value={`${formatAda(summary.fee.total)} ₳`} />
        </ReviewRows>
        <TxDetailButton txHash={summary.txHash} testId="remove-tx" />
        <p className="note">
          The token is burned. Send asks giveme.my to lend the collateral, then submits. It takes about a minute for the
          network to confirm.
        </p>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={review}
      title={`Remove ${name}`}
      titleId="remove-title"
      onBack={onCancel}
      aside={`${formatAda(seedelf.lovelace)} ₳ locked with it`}
      error={error}
      foot={
        <>
          <button type="submit" className="primary" disabled={busy || !to} title={to ? undefined : "Choose where the freed ADA goes"}>
            {busy ? "Building…" : "Review"}
          </button>
          <BuildStage busy={busy} />
        </>
      }
    >
      <p className="note">
        Removing burns the Seedelf's token and frees the ADA locked with it, less the fee. Payments already sent to it
        stay yours; after this, nobody can pay it by name.
      </p>
      <code className="copy-field__value" title={seedelf.assetName}>
        {seedelf.assetName}
      </code>

      <Choice
        label="Send what's freed to"
        id="remove-to"
        value={to}
        onChange={setTo}
        options={(["account", "seedelf"] as const).map((d) => ({ value: d, label: DESTINATIONS[d] }))}
      />
      <Callout tone={note.tone} testId="remove-to-note">
        {note.text}
      </Callout>
    </Screen>
  );
}
