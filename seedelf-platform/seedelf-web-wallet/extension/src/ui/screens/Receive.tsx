// Receive, one per Home tab.
//
// Cardano account: its address as a QR code and text, and its stake address.
// This is how a new wallet gets its first ADA.
// Seedelf: the full names of your seedelfs, each with Copy. A name is what
// people pay privately; without one, the screen says to create it first.

import type { Account, SeedelfInfo } from "../../shared/rpc";
import { Callout } from "../components/Callout";
import { CopyField } from "../components/CopyField";
import { QrCode } from "../components/QrCode";
import { Screen } from "../components/Screen";

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
}: {
  seedelfs: SeedelfInfo[];
  onBack: () => void;
  onCreate: () => void;
  /** Why Create is disabled, if it is. */
  createTitle?: string;
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
      <div className="stack" data-testid="receive-seedelfs">
        {seedelfs.map((s) => (
          <CopyField
            key={s.assetName}
            label={s.label ?? "Unnamed seedelf"}
            value={s.assetName}
            copyLabel={`Copy the name of ${s.label ?? "this seedelf"}`}
            testId={`receive-seedelf-${s.assetName}`}
          />
        ))}
      </div>
      <Callout tone="privacy">
        A seedelf's name is public, and linked to whatever paid to create it. What's paid to it isn't.
      </Callout>
    </Screen>
  );
}
