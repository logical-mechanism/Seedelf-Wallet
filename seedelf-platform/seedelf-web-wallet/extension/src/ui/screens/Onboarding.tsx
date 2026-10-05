// A new install: create a wallet or restore one. In the popup these open a
// full tab, because a popup closes as soon as the user clicks elsewhere,
// such as to find a pen for the recovery phrase. A build with both networks
// asks which first, so a preprod phrase is never restored on mainnet.

import { useState } from "react";
import { useT } from "../../i18n";

import type { Status } from "../../shared/rpc";
import { Callout } from "../components/Callout";
import { NetworkPicker, OnNetwork } from "../components/NetworkPicker";
import { openInTab, view } from "../view";
import { Create } from "./Create";
import { Restore } from "./Restore";

type Step = "welcome" | "create" | "restore";

export function Onboarding({
  status,
  start,
  removed,
  onDone,
  onNetwork,
}: {
  status: Status;
  start?: "create" | "restore";
  /** The wallet was just removed from Settings: said on the welcome screen. */
  removed?: boolean;
  onDone: (s: Status) => void;
  onNetwork: (s: Status) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>(view === "tab" && start ? start : "welcome");

  function go(next: "create" | "restore") {
    if (view === "panel") openInTab(next);
    else setStep(next);
  }

  if (step === "create" || step === "restore") {
    // Which network, with a way to change it, on the first step only: on every step it was a distraction mid-backup
    // (chunk 23's review, C-6). The badge in the top bar says it throughout.
    const network = <OnNetwork status={status} doing={step} onChange={() => setStep("welcome")} />;
    return step === "create" ? (
      <Create network={network} onBack={() => setStep("welcome")} onDone={onDone} />
    ) : (
      <Restore network={network} onBack={() => setStep("welcome")} onDone={onDone} />
    );
  }

  return (
    <section className="welcome">
      {removed && (
        <Callout testId="wallet-removed">
          {t("welcome.removed")}
        </Callout>
      )}
      <img className="welcome__logo" src="/brand/wordmark-on-dark.png" alt={t("app.name")} width={360} height={118} />
      <p className="welcome__lead">{t("welcome.lead")}</p>
      <div className="stack welcome__actions">
        <button className="primary" onClick={() => go("create")}>
          {t("welcome.create")}
        </button>
        <button className="secondary" onClick={() => go("restore")}>
          {t("welcome.restore")}
        </button>
        {/* Said before it happens: the panel closing under the cursor looked like a crash (chunk 23's review, W-2). */}
        {view === "panel" && (
          <p className="note center" data-testid="welcome-opens-tab">
            {t("welcome.opensTab")}
          </p>
        )}
      </div>
      <NetworkPicker status={status} onChanged={onNetwork} />
    </section>
  );
}
