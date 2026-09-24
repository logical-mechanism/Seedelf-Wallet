// A new install: create a wallet or restore one. In the popup these open a
// full tab, because a popup closes as soon as the user clicks elsewhere,
// such as to find a pen for the recovery phrase.

import { useState } from "react";

import type { Status } from "../../shared/rpc";
import { openInTab, view } from "../view";
import { Create } from "./Create";
import { Restore } from "./Restore";

type Step = "welcome" | "create" | "restore";

export function Onboarding({ start, onDone }: { start?: "create" | "restore"; onDone: (s: Status) => void }) {
  const [step, setStep] = useState<Step>(view === "tab" && start ? start : "welcome");

  function go(next: "create" | "restore") {
    if (view === "popup") openInTab(next);
    else setStep(next);
  }

  if (step === "create") return <Create onBack={() => setStep("welcome")} onDone={onDone} />;
  if (step === "restore") return <Restore onBack={() => setStep("welcome")} onDone={onDone} />;

  return (
    <section className="welcome">
      <img className="welcome__logo" src="/brand/wordmark-on-dark.png" alt="Seedelf Wallet" width={360} height={118} />
      <p className="welcome__lead">A private wallet for Cardano.</p>
      <p className="note welcome__text">
        Payments to your seedelfs can't be linked to you, and spending them doesn't reveal who you are.
      </p>
      <div className="stack welcome__actions">
        <button className="primary" onClick={() => go("create")}>
          Create new wallet
        </button>
        <button className="secondary" onClick={() => go("restore")}>
          Restore wallet
        </button>
      </div>
    </section>
  );
}
