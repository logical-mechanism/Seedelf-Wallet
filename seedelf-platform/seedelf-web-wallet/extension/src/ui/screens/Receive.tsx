// Receive, one per Home tab.
//
// Cardano account: its address as a QR code and text, its ADA Handles (a
// name anyone can pay it by, found among its tokens: no request), and its
// stake address. This is how a new wallet gets its first ADA.
// Seedelf: your seedelfs, each with its whole name on one line (cut in the
// middle only when it doesn't fit), Copy, the ADA locked with it, and Remove.
// A name is what people pay privately; without one, the screen says to
// create it first.

import { useT } from "../../i18n";
import type { Account, SeedelfInfo } from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { Callout } from "../components/Callout";
import { CopyButton } from "../components/CopyButton";
import { CopyField } from "../components/CopyField";
import { TrashIcon } from "../components/Icons";
import { MiddleEllipsis } from "../components/MiddleEllipsis";
import { QrCode } from "../components/QrCode";
import { Screen } from "../components/Screen";
import { useAmounts } from "../preferences";

export function Receive({ account, handles, onBack }: { account: Account; handles: string[]; onBack: () => void }) {
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
      <p className="note">{t("receive.note.fund")}</p>
      <Callout tone="privacy">{t("receive.privacy.publicAddress")}</Callout>
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
      <CopyField
        label={t("receive.stake.label")}
        copyLabel={t("receive.stake.copy")}
        value={account.stakeAddress}
        testId="stake-address"
      />
    </Screen>
  );
}

export function ReceiveSeedelf({
  seedelfs,
  onBack,
  onCreate,
  createTitle,
  onRemove,
  removeTitle,
}: {
  seedelfs: SeedelfInfo[];
  onBack: () => void;
  onCreate: () => void;
  /** Why Create is disabled, if it is. */
  createTitle?: string;
  onRemove: (seedelf: SeedelfInfo) => void;
  /** Why Remove is disabled, if it is. */
  removeTitle?: string;
}) {
  const amounts = useAmounts();
  const t = useT();
  if (seedelfs.length === 0) {
    return (
      <Screen
        title={t("receive.title")}
        titleId="receive-seedelf-title"
        onBack={onBack}
        aside={t("receive.aside.private")}
        foot={
          <button type="button" className="primary" onClick={onCreate} disabled={!!createTitle} title={createTitle}>
            {t("receive.seedelfs.create")}
          </button>
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
      <p className="note">{t("receive.seedelfs.note")}</p>
      <section className="section" aria-labelledby="your-seedelfs">
        <h2 id="your-seedelfs">{t("receive.seedelfs.title")}</h2>
        <ul className="list" data-testid="seedelfs">
          {seedelfs.map((s) => {
            const tag = s.label ?? t("receive.seedelfs.thisOne");
            return (
              <li key={s.assetName} className="list__row" title={s.assetName}>
                {/* No tag, no stand-in: "Unnamed" could be someone's tag. */}
                <span className="list__name">{s.label ?? ""}</span>
                <span className="list__actions">
                  <span className="list__value" title={t("receive.seedelfs.locked")}>
                    {amounts.ada(s.lovelace)} ₳
                  </span>
                  <CopyButton value={s.assetName} label={t("receive.seedelfs.copyName", { tag })} />
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    aria-label={t("receive.seedelfs.remove", { tag })}
                    onClick={() => onRemove(s)}
                    disabled={!!removeTitle}
                    title={removeTitle ?? t("receive.seedelfs.removeThis")}
                  >
                    <TrashIcon size={14} />
                  </button>
                </span>
                <span className="list__full">
                  <MiddleEllipsis text={s.assetName} testId={`seedelf-name-${s.assetName}`} />
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <Callout tone="privacy">{t("receive.privacy.seedelfName")}</Callout>
    </Screen>
  );
}
