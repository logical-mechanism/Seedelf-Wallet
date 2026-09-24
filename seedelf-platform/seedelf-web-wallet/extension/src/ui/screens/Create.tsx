// Create a wallet: show a new 24-word phrase once, confirm three of its
// words, set a password. Nothing is written until the password is set, so
// abandoning the flow leaves no wallet behind.
//
// The phrase lives only in this component's state; it's never persisted in
// the UI and it's dropped when the flow ends.

import { useEffect, useState } from "react";

import type { Status } from "../../shared/rpc";
import { call } from "../background";
import { PhraseInput } from "../components/PhraseInput";
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
      setError(`Word ${wrong} doesn't match. Check your written copy.`);
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

  return (
    <section className="card stack">
      <StepHeader step={step} onBack={step === "reveal" ? onBack : () => setStep(step === "password" ? "confirm" : "reveal")} />

      {step === "reveal" && (
        <>
          <h1>Your recovery phrase</h1>
          <p className="note">
            Write these 24 words on paper, in order, and keep it somewhere safe. They are the only way to
            restore this wallet. Anyone who has them can take your funds.
          </p>
          <div className="callout callout--warn">
            Don't copy the phrase into a screenshot, a chat, an email or a cloud note, and never type it into a
            website.
          </div>
          <div className="callout">
            This phrase restores your seedelfs only in a Seedelf wallet. Other Cardano wallets will show your
            Cardano account and nothing else.
          </div>
          <div className={revealed ? "phrase-reveal" : "phrase-reveal phrase-reveal--hidden"}>
            <ol className="phrase-grid" data-testid="recovery-phrase" aria-hidden={!revealed}>
              {phrase.map((word, i) => (
                <li className="word word--static" key={i}>
                  <span className="word__n">{i + 1}</span>
                  <span className="word__text">{revealed ? word : "••••••"}</span>
                </li>
              ))}
            </ol>
            {!revealed && (
              <button className="secondary phrase-reveal__button" onClick={() => setRevealed(true)} disabled={!phrase.length}>
                Reveal phrase
              </button>
            )}
          </div>
          <button className="primary" disabled={!revealed} onClick={startConfirm}>
            I've written it down
          </button>
        </>
      )}

      {step === "confirm" && (
        <>
          <h1>Confirm your phrase</h1>
          <p className="note">Enter words {positions.join(", ")} from your written copy.</p>
          <PhraseInput words={answers} onChange={setAnswers} positions={positions} />
          <button
            className="primary"
            disabled={positions.some((p) => !answers[p - 1])}
            onClick={checkConfirm}
          >
            Confirm
          </button>
        </>
      )}

      {step === "password" && (
        <>
          <h1>Set a password</h1>
          <SetPassword submitLabel="Create wallet" busy={busy} onSubmit={create} />
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function StepHeader({ step, onBack }: { step: Step; onBack: () => void }) {
  const steps: Step[] = ["reveal", "confirm", "password"];
  return (
    <div className="step-header">
      <button type="button" className="link" onClick={onBack}>
        ← Back
      </button>
      <span className="note">
        Step {steps.indexOf(step) + 1} of {steps.length}
      </span>
    </div>
  );
}
