// Create a wallet: show a new 24-word phrase once, confirm three of its
// words, set a password. Nothing is written until the password is set, so
// abandoning the flow leaves no wallet behind.
//
// The phrase lives only in this component's state; it's never persisted in
// the UI and it's dropped when the flow ends.

import { useEffect, useState, type ReactNode } from "react";
import { joinList, useT } from "../../i18n";

import type { Status } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { EyeIcon, EyeOffIcon } from "../components/Icons";
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

export function Create({
  network,
  onBack,
  onDone,
}: {
  /** Which network it's made on, and a way to change it: on the first step only. */
  network?: ReactNode;
  onBack: () => void;
  onDone: (s: Status) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>("reveal");
  const [phrase, setPhrase] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  // Seen once is enough to go on: hiding the words again needn't mean writing them down again (FR-5).
  const [seen, setSeen] = useState(false);
  const [positions, setPositions] = useState<number[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  // The confirm words that didn't match, each outlined until it's changed.
  const [wrong, setWrong] = useState<number[]>([]);
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
    setWrong([]);
    setError(undefined);
    setStep("confirm");
  }

  function checkConfirm() {
    // Every word that doesn't match, not only the first (chunk 23's review, C-4).
    const mismatched = positions.filter((p) => answers[p - 1] !== phrase[p - 1]);
    setWrong(mismatched);
    if (mismatched.length) {
      setError(t("create.warn.wordMismatch", { count: mismatched.length, numbers: joinList(mismatched.map(String)) }));
      return;
    }
    setError(undefined);
    setStep("password");
  }

  function answer(next: string[]) {
    // A word changed is a word to check again: its outline goes, and so does the message once none is left.
    const still = wrong.filter((p) => next[p - 1] === answers[p - 1]);
    setWrong(still);
    if (!still.length) setError(undefined);
    setAnswers(next);
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
        // After the words, never over them: a foot kept in view covered the last
        // row at a laptop's height, and its button looked like the end of the
        // phrase (chunk 23's review, C-2).
        footSticky={false}
        foot={
          // Hide covers the words again, for someone who comes up to the screen; beside the button, so the button
          // ends no lower than it did (chunk 23's second review, FR-5).
          <div className="actions">
            {revealed && (
              <button type="button" className="secondary" onClick={() => setRevealed(false)}>
                <EyeOffIcon size={16} />
                {t("create.phrase.hide")}
              </button>
            )}
            <button className="primary" disabled={!seen} onClick={startConfirm}>
              {t("create.phrase.written")}
            </button>
          </div>
        }
      >
        {network}
        <p className="note">{t("create.phrase.note")}</p>
        <Callout tone="warn">{t("create.phrase.warn.neverCopy")}</Callout>
        {/* Before the words, with the warning: under the button, nobody read it (C-3). */}
        <Callout>{t("create.phrase.onlyHere")}</Callout>
        <div className={revealed ? "phrase-reveal" : "phrase-reveal phrase-reveal--hidden"}>
          <PhraseGrid words={phrase} revealed={revealed} />
          {!revealed && (
            <button
              className="secondary phrase-reveal__button"
              onClick={() => {
                setRevealed(true);
                setSeen(true);
              }}
              disabled={!phrase.length}
            >
              <EyeIcon />
              {t("create.phrase.reveal")}
            </button>
          )}
        </div>
      </Screen>
    );
  }

  if (step === "confirm") {
    const filled = positions.every((p) => answers[p - 1]);
    return (
      <Screen
        title={t("create.confirm.title")}
        titleId="create-title"
        onBack={back}
        aside={aside}
        error={error}
        foot={
          <>
            <button className="primary" disabled={!filled} onClick={checkConfirm}>
              {t("create.confirm.button")}
            </button>
            {/* Why it can't be pressed yet, where a touch screen shows it (C-4). */}
            {!filled && <p className="note foot-note">{t("create.confirm.fillAll", { count: positions.length })}</p>}
          </>
        }
      >
        <p className="note">{t("create.confirm.enterWords", { words: joinList(positions.map(String)) })}</p>
        <PhraseInput words={answers} onChange={answer} positions={positions} wrong={wrong} />
      </Screen>
    );
  }

  return (
    <Screen
      title={t("password.setTitle")}
      titleId="create-title"
      onBack={back}
      backDisabled={busy}
      aside={aside}
      error={error}
    >
      <SetPassword submitLabel={t("create.createWallet")} busy={busy} onSubmit={create} />
      {/* What's happening while the worker seals the vault: the wallet's first frames said nothing (chunk 23's
          second review, FR-2). */}
      {busy && (
        <p className="note center" role="status" data-testid="setting-up">
          {t("create.settingUp")}
        </p>
      )}
    </Screen>
  );
}
