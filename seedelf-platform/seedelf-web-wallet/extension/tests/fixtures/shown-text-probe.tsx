// shown-text.test.ts reads this file to check its own check: each piece of
// English a person would read is caught, and keys, names, symbols and code
// are left alone. Never rendered.
import type { ReactNode } from "react";

import { t } from "../../src/i18n";

function Screen({ title, aside, children }: { title: string; aside?: string; children?: ReactNode }) {
  return (
    <section aria-label={aside}>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

export function Probe({ index, mainnet }: { index: number; mainnet: boolean }) {
  return (
    <Screen title="Settings" aside={t("app.settings")}>
      <p className="note">Your balance</p>
      <p>{t("settings.wallet")}</p>
      <button type="button" aria-label="Close" title={t("common.close")} data-testid="close-button">
        ×
      </button>
      <input placeholder={mainnet ? "Address" : t("destination.placeholder", { address: "addr1…" })} />
      <span className="plutus__name" title={`${index} key`}>
        {index}
      </span>
      <span>{"Unknown"}</span>
      <span>Seedelf</span>
      <span title="Lovejoin">₳ · 10</span>
      <span>{t("tx.vote.yes", { voter: "DRep" })}</span>
      <span>{t("tx.vote.no", { voter: "stake pool" })}</span>
    </Screen>
  );
}
