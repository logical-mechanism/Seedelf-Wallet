// Receive, one per Home tab.
//
// Cardano account: its address as a QR code and text, and its stake address.
// This is how a new wallet gets its first ADA.
// Seedelf: your seedelfs, each with its whole name on one line (cut in the
// middle only when it doesn't fit), Copy, the ADA locked with it, and Remove.
// A name is what people pay privately; without one, the screen says to
// create it first.

import type { Account, SeedelfInfo } from "../../shared/rpc";
import { Callout } from "../components/Callout";
import { CopyButton } from "../components/CopyButton";
import { CopyField } from "../components/CopyField";
import { TrashIcon } from "../components/Icons";
import { MiddleEllipsis } from "../components/MiddleEllipsis";
import { QrCode } from "../components/QrCode";
import { Screen } from "../components/Screen";
import { formatAda } from "../format";

export function Receive({ account, onBack }: { account: Account; onBack: () => void }) {
  return (
    <Screen title="Receive" titleId="receive-title" onBack={onBack} aside="Into your Cardano account">
      <div className="qr-wrap">
        <QrCode text={account.receiveAddress} maxSize={200} label="QR code of the receive address" />
      </div>
      <CopyField label="Receive address" value={account.receiveAddress} testId="receive-address" />
      <p className="note">
        Anything that can pay a Cardano address can fund this wallet: scan the code from a phone wallet, or copy the
        address.
      </p>
      <Callout tone="privacy">
        This is an ordinary Cardano address: anyone can see what it receives. To be paid privately, give out one of your
        seedelfs' names instead.
      </Callout>
      <CopyField label="Stake address" value={account.stakeAddress} testId="stake-address" />
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
  if (seedelfs.length === 0) {
    return (
      <Screen
        title="Receive"
        titleId="receive-seedelf-title"
        onBack={onBack}
        aside="Into your Seedelf balance"
        foot={
          <button type="button" className="primary" onClick={onCreate} disabled={!!createTitle} title={createTitle}>
            Create a seedelf
          </button>
        }
      >
        <p className="note" data-testid="receive-no-seedelf">
          People pay a seedelf's name, and you don't have a seedelf yet. Create one first: your Cardano account pays for
          it.
        </p>
      </Screen>
    );
  }
  return (
    <Screen title="Receive" titleId="receive-seedelf-title" onBack={onBack} aside="Into your Seedelf balance">
      <p className="note">
        Give out a seedelf's whole name: tags aren't unique. Anyone with a Seedelf wallet can pay it, and nobody can tell
        the payment is yours.
      </p>
      <section className="section" aria-labelledby="your-seedelfs">
        <h2 id="your-seedelfs">Your seedelfs</h2>
        <ul className="list" data-testid="seedelfs">
          {seedelfs.map((s) => {
            const tag = s.label ?? "this seedelf";
            return (
              <li key={s.assetName} className="list__row" title={s.assetName}>
                <span className="list__name">{s.label ?? "Unnamed"}</span>
                <span className="list__actions">
                  <span className="list__value" title="Locked with it: Remove gives it back">
                    {formatAda(s.lovelace)} ₳
                  </span>
                  <CopyButton value={s.assetName} label={`Copy the name of ${tag}`} />
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    aria-label={`Remove ${tag}`}
                    onClick={() => onRemove(s)}
                    disabled={!!removeTitle}
                    title={removeTitle ?? "Remove this seedelf"}
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
      <Callout tone="privacy">
        A seedelf's name is public, and linked to whatever paid to create it. What's paid to it isn't.
      </Callout>
    </Screen>
  );
}
