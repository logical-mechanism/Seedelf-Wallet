// Create a wallet: show a new 24-word phrase once, confirm three of its
// words, set a password. Nothing is written until the password is set, so
// abandoning the flow leaves no wallet behind.
//
// The phrase lives only in this component's state; it's never persisted in
// the UI and it's dropped when the flow ends.

import { useEffect, useState } from "react";
import { useT } from "../../i18n";

import type { Status } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { EyeIcon } from "../components/Icons";
import { PhraseGrid } from "../components/PhraseGrid";
import { PhraseInput } from "../components/PhraseInput";
import { Screen } from "../components/Screen";
import { SetPassword } from "../components/SetPassword";

const CONFIRM_WORDS = 3;

/** `n` distinct random positions in 1..count, ascending. */
function randomPositions(count: number, n: number): number[] {
  const picked = new Set<number>();
  const buf = new Uint32Array(1);
  while (picked.size < n) {
    crypto.getRandomValues(buf);
    picked.add((buf[0]! % count) + 1);
  }
  return [...picked].sort((a, b) => a - b);
}

type Step = "reveal" | "confirm" | "password";

export function Create({ onBack, onDone }: { onBack: () => void; onDone: (s: Status) => void }) {
  const t = useT();
  const [step, setStep] = useState<Step>("reveal");
  const [phrase, setPhrase] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [positions, setPositions] = useState<number[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    call("generate-phrase", {}).then(
      ({ phrase }) => setPhrase(phrase.split(" ")),
      (e: Error) => setError(e.message),
    );
  }, []);

  function startConfirm() {
    setPositions(randomPositions(phrase.length, CONFIRM_WORDS));
    setAnswers(Array<string>(phrase.length).fill(""));
    setError(undefined);
    setStep("confirm");
  }

  function checkConfirm() {
    const wrong = positions.find((p) => answers[p - 1] !== phrase[p - 1]);
    if (wrong) {
      setError(t("create.wordMismatch", { number: wrong }));
      return;
    }
    setError(undefined);
    setStep("password");
  }

  async function create(password: string) {
    setBusy(true);
    setError(undefined);
    try {
      const status = await call("create-wallet", { phrase: phrase.join(" "), password });
      setPhrase([]);
      onDone(status);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const steps: Step[] = ["reveal", "confirm", "password"];
  const aside = t("create.stepOf", { step: steps.indexOf(step) + 1, total: steps.length });
  const back = step === "reveal" ? onBack : () => setStep(step === "password" ? "confirm" : "reveal");

  if (step === "reveal") {
    return (
      <Screen
        title={t("create.phrase.title")}
        titleId="create-title"
        onBack={back}
        aside={aside}
        error={error}
        foot={
          <button className="primary" disabled={!revealed} onClick={startConfirm}>
            {t("create.phrase.written")}
          </button>
        }
      >
        <p className="note">{t("create.phrase.note")}</p>
        <Callout tone="warn">{t("create.phrase.warn.neverCopy")}</Callout>
        <div className={revealed ? "phrase-reveal" : "phrase-reveal phrase-reveal--hidden"}>
          <PhraseGrid words={phrase} revealed={revealed} />
          {!revealed && (
            <button className="secondary phrase-reveal__button" onClick={() => setRevealed(true)} disabled={!phrase.length}>
              <EyeIcon />
              {t("create.phrase.reveal")}
            </button>
          )}
        </div>
        <Callout>{t("create.phrase.onlyHere")}</Callout>
      </Screen>
    );
  }

  if (step === "confirm") {
    return (
      <Screen
        title={t("create.confirm.title")}
        titleId="create-title"
        onBack={back}
        aside={aside}
        error={error}
        foot={
          <button className="primary" disabled={positions.some((p) => !answers[p - 1])} onClick={checkConfirm}>
            {t("create.confirm.button")}
          </button>
        }
      >
        <p className="note">{t("create.confirm.enterWords", { words: positions.join(", ") })}</p>
        <PhraseInput words={answers} onChange={setAnswers} positions={positions} />
      </Screen>
    );
  }

  return (
    <Screen title={t("password.setTitle")} titleId="create-title" onBack={back} aside={aside} error={error}>
      <SetPassword submitLabel={t("create.createWallet")} busy={busy} onSubmit={create} />
    </Screen>
  );
}
