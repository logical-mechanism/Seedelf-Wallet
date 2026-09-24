// Receive: the Cardano account's address as a QR code and text, and its
// stake address. This is how a new wallet gets its first ADA.

import type { Account } from "../../shared/rpc";
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
