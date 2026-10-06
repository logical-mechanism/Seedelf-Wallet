// Restore a wallet from a 12-, 15- or 24-word phrase, one box per word with
// BIP39 autocomplete, then set a password. The phrase lives only in this
// component's state.

import { useState, type ReactNode } from "react";
import { useT } from "../../i18n";

import type { Status } from "../../shared/rpc";
import { call } from "../background";
import { PhraseInput, phraseProblem, useWordlist, WORD_COUNTS, type WordCount } from "../components/PhraseInput";
import { Screen } from "../components/Screen";
import { SetPassword } from "../components/SetPassword";
import { asSentence } from "../sentence";

const blank = (n: number) => Array<string>(n).fill("");

export function Restore({
  network,
  onBack,
  onDone,
}: {
  /** Which network it's restored on, and a way to change it: on the first step only. */
  network?: ReactNode;
  onBack: () => void;
  onDone: (s: Status) => void;
}) {
  const [count, setCount] = useState<WordCount>(24);
  const [words, setWords] = useState<string[]>(blank(24));
  const t = useT();
  const [step, setStep] = useState<"phrase" | "password">("phrase");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const list = useWordlist();

  // An edit makes the last check's message stale: it goes, and the boxes say what's wrong as they're typed
  // (chunk 23's review, R-2).
  function edit(next: string[]) {
    setWords(next);
    setError(undefined);
  }

  function changeCount(n: WordCount) {
    setCount(n);
    setWords((w) => Array.from({ length: n }, (_, i) => w[i] ?? ""));
    setError(undefined);
  }

  async function checkPhrase() {
    // A word off the list is named here, in the user's language: the worker's reason is core's English.
    const unknown = list.length ? words.findIndex((w) => !list.includes(w)) : -1;
    if (unknown >= 0) {
      setError(t("restore.warn.notAWord", { number: unknown + 1 }));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await call("validate-phrase", { phrase: words.join(" ") });
      setStep("password");
    } catch (e) {
      // Every word is on the list and the count is one the boxes allow, so what's left is the checksum: said
      // without the word, and without the word "checksum", the list read now if it hadn't loaded (chunk 23's
      // second review, FR-7).
      setError(list.length ? t("restore.warn.notAPhrase") : await phraseProblem(words, (e as Error).message));
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
      setError(asSentence((e as Error).message));
      setBusy(false);
    }
  }

  if (step === "password") {
    return (
      <Screen
        title={t("password.setTitle")}
        titleId="restore-title"
        onBack={() => setStep("phrase")}
        backDisabled={busy}
        aside={t("restore.step2")}
        error={error}
      >
        <SetPassword submitLabel={t("restore.restoreWallet")} busy={busy} onSubmit={restore} />
        {/* What's happening while the worker seals the vault: the wallet's first frames said nothing (chunk 23's
            second review, FR-2). */}
        {busy && (
          <p className="note center" role="status" data-testid="setting-up">
            {t("restore.settingUp")}
          </p>
        )}
      </Screen>
    );
  }

  return (
    <Screen
      title={t("restore.title")}
      titleId="restore-title"
      onBack={onBack}
      aside={t("restore.step1")}
      error={error}
      // After the boxes, never over them: a foot kept in view hid the last rows (chunk 23's review, R-1).
      footSticky={false}
      foot={
        <button className="primary" disabled={busy || words.some((w) => !w)} onClick={checkPhrase}>
          {t("common.continue")}
        </button>
      }
    >
      {network}
      <p className="note">{t("restore.note")}</p>
      {/* Above the boxes: the line that saves typing 24 words sat under the button (R-1). */}
      <p className="note" data-testid="restore-paste-tip">
        {t("restore.pasteTip")}
      </p>
      <div className="segmented" role="radiogroup" aria-label={t("restore.wordCount")}>
        {WORD_COUNTS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === count}
            className={n === count ? "segmented__item segmented__item--on" : "segmented__item"}
            onClick={() => changeCount(n)}
          >
            {t("restore.words", { number: n })}
          </button>
        ))}
      </div>
      <PhraseInput words={words} onChange={edit} onCountChange={changeCount} />
    </Screen>
  );
}
