// Unlock with the password. The worker enforces the back-off after wrong
// passwords; this screen only shows the countdown. In the connector's
// window it says a site is waiting: what it asks comes after.

import { useEffect, useState, type FormEvent } from "react";

import type { Status } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { PasswordField } from "../components/PasswordField";
import { Screen } from "../components/Screen";
import { connectorWindow } from "../view";

export function Unlock({
  retryAfterMs,
  onUnlocked,
  onForgot,
}: {
  retryAfterMs: number;
  onUnlocked: () => void;
  onForgot: () => void;
}) {
  const [password, setPassword] = useState("");
  const [waitUntil, setWaitUntil] = useState(() => Date.now() + retryAfterMs);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const waitMs = Math.max(0, waitUntil - now);
  const waiting = waitMs > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [waiting]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || waitMs > 0 || !password) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await call("unlock", { password });
      if (result.unlocked) {
        setPassword("");
        onUnlocked();
        return;
      }
      setWaitUntil(Date.now() + result.retryAfterMs);
      setNow(Date.now());
      if (result.wrongPassword) {
        setPassword("");
        setError("Wrong password.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="unlock">
      <img className="unlock__emblem" src="/brand/emblem.png" alt="" width={88} height={88} />
      <h1>Welcome back</h1>
      {connectorWindow && (
        <p className="note center" data-testid="unlock-site">
          A site is waiting for Seedelf Wallet. Unlock to see what it asks.
        </p>
      )}
      <form className="stack unlock__form" onSubmit={submit}>
        <PasswordField id="password" value={password} onChange={setPassword} autoFocus />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {waitMs > 0 && (
          <p className="note" data-testid="retry-after">
            Try again in {Math.ceil(waitMs / 1000)} s.
          </p>
        )}
        <button type="submit" className="primary" disabled={busy || waitMs > 0 || !password}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
      <button type="button" className="link" onClick={onForgot}>
        Forgot password? Restore from your phrase
      </button>
    </section>
  );
}

const CONFIRM_TEXT = "delete wallet";

/** Deletes the vault so the wallet can be restored from its phrase. */
export function Reset({ onCancel, onReset }: { onCancel: () => void; onReset: (s: Status) => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function reset() {
    setBusy(true);
    try {
      onReset(await call("reset-wallet", {}));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const confirmed = typed.trim().toLowerCase() === CONFIRM_TEXT;
  return (
    <Screen
      title="Restore from your phrase"
      titleId="reset-title"
      onBack={onCancel}
      backDisabled={busy}
      error={error}
      foot={
        <div className="actions">
          <button className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger" onClick={reset} disabled={busy || !confirmed}>
            Delete and restore
          </button>
        </div>
      }
    >
      <p className="note">
        Without the password, the only way back in is your recovery phrase. This deletes the wallet from this browser,
        then you restore it from the phrase and choose a new password.
      </p>
      <Callout tone="warn">
        If you don't have your recovery phrase, stop here. Deleting the wallet without it loses your funds for good.
      </Callout>
      <div className="field">
        <label htmlFor="confirm-reset">
          Type <strong>{CONFIRM_TEXT}</strong> to confirm
        </label>
        <input
          id="confirm-reset"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
    </Screen>
  );
}
