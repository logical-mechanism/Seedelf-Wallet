// Receive, one per Home tab.
//
// Cardano account: its address as a QR code and text, its ADA Handles (a
// name anyone can pay it by, found among its tokens: no request), and its
// stake address. This is how a new wallet gets its first ADA.
// Seedelf: your seedelfs, each a card whose whole name is the thing to share,
// with Copy and a QR code, its tag (public, and anyone's to pick) and the ADA
// locked with it under that, and Remove apart from Copy (chunk 23's review,
// SE-1, SE-2: the bold tag read as the thing to give out, and a trash icon sat
// beside Copy). Without one, the screen says to create it first, and when the
// public account can't pay for it yet, why and where to fund it (H-3).
//
// Chunk 23's second review: the private one leads with who can pay a Seedelf,
// above the QR code: only someone using Seedelf Wallet (RX-1). Remove sits
// behind each card's Manage, with what removing does, since the screen is one
// opened to copy a name (RX-2). The public one's note that anyone can watch
// the address is a warning, amber, not the teal of a reassurance, and links to
// the Seedelfs' names it suggests instead (RX-4).

import { useState } from "react";
import { useT } from "../../i18n";
import type { Account, SeedelfInfo } from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { Callout } from "../components/Callout";
import { CopyButton } from "../components/CopyButton";
import { CopyField } from "../components/CopyField";
import { QrCode } from "../components/QrCode";
import { Screen } from "../components/Screen";
import { useAmounts } from "../preferences";

export function Receive({
  account,
  handles,
  onBack,
  onPrivate,
}: {
  account: Account;
  handles: string[];
  onBack: () => void;
  /** Private Receive, where the Seedelfs' names are. */
  onPrivate?: () => void;
}) {
  // Which account's address this is, once there is more than one: paying the
  // wrong account's address is money in the wrong place, not a lost payment,
  // but it is still worth naming.
  const { several, name } = useAccounts();
  const t = useT();
  return (
    <Screen
      title={t("receive.title")}
      titleId="receive-title"
      onBack={onBack}
      hint={t("receive.note.fund")}
      hintTestId="receive-fund-note"
      aside={several ? t("receive.aside.named", { name }) : t("receive.aside.account")}
    >
      <div className="qr-wrap">
        <QrCode text={account.receiveAddress} maxSize={200} label={t("receive.qr.label")} />
      </div>
      <CopyField
        label={t("receive.address.label")}
        copyLabel={t("receive.address.copy")}
        value={account.receiveAddress}
        testId="receive-address"
      />
      <Callout tone="warn" testId="receive-public-note">
        <div className="stack-tight">
          <span>{t("receive.privacy.publicAddress")}</span>
          {onPrivate && (
            <button type="button" className="link align-start" onClick={onPrivate}>
              {t("receive.showSeedelfs")}
            </button>
          )}
        </div>
      </Callout>
      {handles.length > 0 && (
        <section className="section" aria-labelledby="your-handles">
          <h2 id="your-handles">{t("receive.handles.title")}</h2>
          <ul className="list" data-testid="handles">
            {handles.map((h) => (
              <li key={h} className="list__row">
                <span className="list__name">${h}</span>
                <span className="list__actions">
                  <CopyButton value={`$${h}`} label={t("receive.handles.copy", { handle: h })} />
                </span>
              </li>
            ))}
          </ul>
          {/* One sentence a form, not "this handle"/"one of these" dropped into
              a shared one: which words a count changes isn't English's choice
              to make for every language. */}
          <p className="note">{t("receive.handles.note", { count: handles.length })}</p>
        </section>
      )}
      {/* Behind a disclosure: beside the receive address, with its own Copy, it was taken for one, and an exchange
          refuses a stake address (chunk 23's review, RC-1). */}
      <details className="disclosure" data-testid="stake-address-details">
        <summary>{t("receive.stake.advanced")}</summary>
        <div className="stack">
          <p className="note">{t("receive.stake.what")}</p>
          <CopyField
            label={t("receive.stake.label")}
            copyLabel={t("receive.stake.copy")}
            value={account.stakeAddress}
            testId="stake-address"
          />
        </div>
      </details>
    </Screen>
  );
}

export function ReceiveSeedelf({
  seedelfs,
  onBack,
  onCreate,
  createTitle,
  onFund,
  onPublic,
  onRemove,
  removeTitle,
}: {
  seedelfs: SeedelfInfo[];
  onBack: () => void;
  onCreate: () => void;
  /** Why Create is disabled, if it is. */
  createTitle?: string;
  /** The public account is empty: where to fund it, since it pays for a Seedelf. */
  onFund?: () => void;
  /** The public address, for someone who can't pay a Seedelf. */
  onPublic?: () => void;
  onRemove: (seedelf: SeedelfInfo) => void;
  /** Why Remove is disabled, if it is. */
  removeTitle?: string;
}) {
  const t = useT();
  if (seedelfs.length === 0) {
    return (
      <Screen
        title={t("receive.title")}
        titleId="receive-seedelf-title"
        onBack={onBack}
        aside={t("receive.aside.private")}
        foot={
          <>
            <button type="button" className="primary" onClick={onCreate} disabled={!!createTitle} title={createTitle}>
              {t("receive.seedelfs.create")}
            </button>
            {/* Why it can't be pressed, and the way on: no dead end (H-3). */}
            {createTitle && (
              <p className="note foot-note" data-testid="receive-create-reason">
                {createTitle}
              </p>
            )}
            {createTitle && onFund && (
              <button type="button" className="secondary" onClick={onFund}>
                {t("receive.seedelfs.showPublic")}
              </button>
            )}
          </>
        }
      >
        <p className="note" data-testid="receive-no-seedelf">
          {t("receive.seedelfs.none")}
        </p>
      </Screen>
    );
  }
  return (
    <Screen title={t("receive.title")} titleId="receive-seedelf-title" onBack={onBack} aside={t("receive.aside.private")}>
      {/* Who can pay it, first: given to a friend on another wallet, or to an exchange, a name can't work, and this was
          the middle of a paragraph (RX-1). */}
      <div className="stack-tight" data-testid="receive-who-can-pay">
        <p className="receive__who">{t("receive.seedelfs.warn.whoCanPay")}</p>
        {onPublic && (
          <button type="button" className="link align-start" onClick={onPublic}>
            {t("receive.seedelfs.showPublic")}
          </button>
        )}
      </div>
      <p className="note">{t("receive.seedelfs.note")}</p>
      <ul className="receive-cards" data-testid="seedelfs" aria-label={t("receive.seedelfs.title")}>
        {seedelfs.map((s) => (
          <SeedelfCard key={s.assetName} seedelf={s} only={seedelfs.length === 1} onRemove={onRemove} removeTitle={removeTitle} />
        ))}
      </ul>
      <Callout tone="privacy">{t("receive.privacy.seedelfName")}</Callout>
    </Screen>
  );
}

/**
 * One Seedelf: its whole name first, as the thing to share, with Copy and a QR
 * code; then its tag, said to be public and anyone's to choose, and the ADA
 * locked with it; Remove last, behind Manage, with what it does. With several,
 * each QR code waits for its button.
 */
function SeedelfCard({
  seedelf: s,
  only,
  onRemove,
  removeTitle,
}: {
  seedelf: SeedelfInfo;
  only: boolean;
  onRemove: (seedelf: SeedelfInfo) => void;
  removeTitle?: string;
}) {
  const t = useT();
  const amounts = useAmounts();
  const [qr, setQr] = useState(only);
  const tag = s.label ?? t("receive.seedelfs.thisOne");
  return (
    <li className="section receive-card">
      {qr && (
        <div className="qr-wrap">
          <QrCode text={s.assetName} maxSize={180} label={t("receive.seedelfs.qrLabel", { tag })} />
        </div>
      )}
      <CopyField
        label={t("receive.seedelfs.nameLabel")}
        copyLabel={t("receive.seedelfs.copyName", { tag })}
        value={s.assetName}
        testId={`seedelf-name-${s.assetName}`}
      />
      <p className="note" data-testid={`seedelf-about-${s.assetName}`}>
        {/* No tag, no stand-in: "Unnamed" could be someone's tag. */}
        {s.label ? `${t("receive.seedelfs.tag", { tag: s.label })} · ` : ""}
        {t("receive.seedelfs.deposit", { amount: amounts.ada(s.lovelace) })}
      </p>
      {!only && (
        <div className="receive-card__actions">
          <button type="button" className="link" aria-expanded={qr} onClick={() => setQr(!qr)}>
            {t(qr ? "receive.seedelfs.hideQr" : "receive.seedelfs.showQr")}
          </button>
        </div>
      )}
      {/* Behind Manage: a screen opened to copy a name had its removal one tap from Copy (RX-2). Why it can't be
          pressed while a transaction confirms is said here, not only in a tooltip (HM-3). */}
      <details className="disclosure" data-testid={`seedelf-manage-${s.assetName}`}>
        <summary>{t("receive.seedelfs.manage")}</summary>
        <div className="stack-tight">
          <p className="note">{t("receive.seedelfs.removeWhat")}</p>
          <button
            type="button"
            className="link link--quiet align-start"
            onClick={() => onRemove(s)}
            disabled={!!removeTitle}
            title={removeTitle}
          >
            {t("receive.seedelfs.remove", { tag })}
          </button>
          {removeTitle && <p className="note">{removeTitle}</p>}
        </div>
      </details>
    </li>
  );
}
