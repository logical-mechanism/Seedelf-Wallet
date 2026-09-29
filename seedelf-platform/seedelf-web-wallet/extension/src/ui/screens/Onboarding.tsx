// A new install: create a wallet or restore one. In the popup these open a
// full tab, because a popup closes as soon as the user clicks elsewhere,
// such as to find a pen for the recovery phrase. A build with both networks
// asks which first, so a preprod phrase is never restored on mainnet.

import { useState } from "react";

import type { Status } from "../../shared/rpc";
import { NetworkPicker, OnNetwork } from "../components/NetworkPicker";
import { openInTab, view } from "../view";
import { Create } from "./Create";
import { Restore } from "./Restore";

type Step = "welcome" | "create" | "restore";

export function Onboarding({
  status,
  start,
  onDone,
  onNetwork,
}: {
  status: Status;
  start?: "create" | "restore";
  onDone: (s: Status) => void;
  onNetwork: (s: Status) => void;
}) {
  const [step, setStep] = useState<Step>(view === "tab" && start ? start : "welcome");

  function go(next: "create" | "restore") {
    if (view === "panel") openInTab(next);
    else setStep(next);
  }

  if (step === "create" || step === "restore") {
    return (
      <>
        <OnNetwork status={status} doing={step} onChange={() => setStep("welcome")} />
        {step === "create" ? (
          <Create onBack={() => setStep("welcome")} onDone={onDone} />
        ) : (
          <Restore onBack={() => setStep("welcome")} onDone={onDone} />
        )}
      </>
    );
  }

  return (
    <section className="welcome">
      <img className="welcome__logo" src="/brand/wordmark-on-dark.png" alt="Seedelf Wallet" width={360} height={118} />
      <p className="welcome__lead">A private wallet for Cardano.</p>
      <div className="stack welcome__actions">
        <button className="primary" onClick={() => go("create")}>
          Create new wallet
        </button>
        <button className="secondary" onClick={() => go("restore")}>
          Restore wallet
        </button>
      </div>
      <NetworkPicker status={status} onChanged={onNetwork} />
    </section>
  );
}
