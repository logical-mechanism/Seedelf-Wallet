import { useEffect, useState } from "react";

import { NETWORKS } from "../networks";
import type { Preview, Status } from "../shared/rpc";
import { call } from "./background";

const view: "popup" | "tab" =
  new URLSearchParams(location.search).get("view") === "tab" ? "tab" : "popup";

function openInTab() {
  void chrome.tabs.create({ url: chrome.runtime.getURL("index.html?view=tab") });
  window.close();
}

export function App() {
  const [status, setStatus] = useState<Status>();
  const [phrase, setPhrase] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call("status", {}).then(setStatus, (e: Error) => setError(e.message));
  }, []);

  async function derive(generate: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await call("preview", generate ? {} : { phrase });
      setPreview(result);
      if (result.generated) setPhrase(result.phrase);
    } catch (e) {
      setPreview(undefined);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const network = status ? NETWORKS[status.network] : undefined;

  return (
    <div className={`app app--${view}`}>
      <header className="topbar">
        <span className="wordmark">seedelf</span>
        {network && (
          <span className={`badge badge--${network.name}`} data-testid="network">
            {network.label.toUpperCase()}
          </span>
        )}
        {view === "popup" && (
          <button className="ghost" onClick={openInTab} title="Open in a full tab">
            Open in tab
          </button>
        )}
      </header>

      <main>
        <section className="card">
          <h1>Wallet core check</h1>
          <p className="note">
            Development preview: keys are derived by the Rust core inside the extension's
            service worker. Use test phrases only. This screen is replaced by onboarding next.
          </p>

          <label htmlFor="phrase">Recovery phrase</label>
          <textarea
            id="phrase"
            rows={5}
            spellCheck={false}
            autoComplete="off"
            placeholder="12, 15 or 24 words, or generate one"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
          />

          <div className="actions">
            <button onClick={() => derive(true)} disabled={busy}>
              Generate test phrase
            </button>
            <button className="secondary" onClick={() => derive(false)} disabled={busy || !phrase.trim()}>
              Derive
            </button>
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {preview && (
            <dl className="results">
              <Field label="Receive address (0/0)" value={preview.receiveAddress} testId="receive-address" />
              <Field label="Change address (1/0)" value={preview.changeAddress} testId="change-address" />
              <Field label="Stake address" value={preview.stakeAddress} testId="stake-address" />
              <Field label="Seedelf public value" value={preview.seedelfPublicValue} testId="seedelf-public-value" />
              <p className="timing">Derived in {preview.millis} ms</p>
            </dl>
          )}
        </section>
      </main>

      <footer className="footer">
        Seedelf Wallet {status?.version ?? ""} · {network?.label ?? "…"}
      </footer>
    </div>
  );
}

function Field({ label, value, testId }: { label: string; value: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="field">
      <dt>
        {label}
        <button
          className="copy"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
}
