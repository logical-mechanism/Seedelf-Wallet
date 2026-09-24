// Restore a wallet from a 12-, 15- or 24-word phrase, one box per word with
// BIP39 autocomplete, then set a password. The phrase lives only in this
// component's state.

import { useState } from "react";

import type { Status } from "../../shared/rpc";
import { call } from "../background";
import { PhraseInput, WORD_COUNTS, type WordCount } from "../components/PhraseInput";
import { SetPassword } from "../components/SetPassword";

const blank = (n: number) => Array<string>(n).fill("");

export function Restore({ onBack, onDone }: { onBack: () => void; onDone: (s: Status) => void }) {
  const [count, setCount] = useState<WordCount>(24);
  const [words, setWords] = useState<string[]>(blank(24));
  const [step, setStep] = useState<"phrase" | "password">("phrase");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function changeCount(n: WordCount) {
    setCount(n);
    setWords((w) => Array.from({ length: n }, (_, i) => w[i] ?? ""));
    setError(undefined);
  }

  async function checkPhrase() {
    setBusy(true);
    setError(undefined);
    try {
      await call("validate-phrase", { phrase: words.join(" ") });
      setStep("password");
    } catch (e) {
      setError(sentence((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function restore(password: string) {
    setBusy(true);
    setError(undefined);
    try {
      const status = await call("restore-wallet", { phrase: words.join(" "), password });
      setWords(blank(count));
      onDone(status);
    } catch (e) {
      setError(sentence((e as Error).message));
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <div className="step-header">
        <button type="button" className="link" onClick={step === "phrase" ? onBack : () => setStep("phrase")}>
          ← Back
        </button>
        <span className="note">Step {step === "phrase" ? 1 : 2} of 2</span>
      </div>

      {step === "phrase" ? (
        <>
          <h1>Restore a wallet</h1>
          <p className="note">
            Enter your recovery phrase. A phrase from Lace, Eternl or Yoroi also works: its first account becomes
            this wallet's Cardano account.
          </p>
          <div className="segmented" role="radiogroup" aria-label="Number of words">
            {WORD_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === count}
                className={n === count ? "segmented__item segmented__item--on" : "segmented__item"}
                onClick={() => changeCount(n)}
              >
                {n} words
              </button>
            ))}
          </div>
          <PhraseInput words={words} onChange={setWords} onCountChange={changeCount} />
          <p className="note">Tip: paste the whole phrase into any box.</p>
          <button className="primary" disabled={busy || words.some((w) => !w)} onClick={checkPhrase}>
            Continue
          </button>
        </>
      ) : (
        <>
          <h1>Set a password</h1>
          <SetPassword submitLabel="Restore wallet" busy={busy} onSubmit={restore} />
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

/** The Rust core's reasons are lower-case fragments; show them as sentences. */
function sentence(message: string): string {
  const text = message.charAt(0).toUpperCase() + message.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
