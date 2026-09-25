// The dApp connector's window (`?view=dapp`): what sites wait for, oldest
// first, one at a time. Connecting a site, signing its transaction (with
// what it does to the public account, as WebAssembly read it), or signing
// its data (CIP-8). Nothing is signed until the user presses Sign, with the
// password typed too unless Settings says otherwise; closing the window
// declines everything. It closes itself once nothing's left.

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import type { DappApproval, DappToken, DappTxSummary } from "../../shared/rpc";
import { call, onDappChanged } from "../background";
import { Callout } from "../components/Callout";
import { GlobeIcon } from "../components/Icons";
import { MiddleEllipsis } from "../components/MiddleEllipsis";
import { PasswordField } from "../components/PasswordField";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { formatAda, formatQuantity, plural, voteLabel } from "../format";
import { useNetwork } from "../network";
import { tokenInfo, tokenLabel } from "../tokens";

/** How long an empty list waits before the window closes: a site's next request may be on its way. */
const CLOSE_AFTER_MS = 800;

export function DappApprovals() {
  const [approvals, setApprovals] = useState<DappApproval[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(() => {
    call("dapp-approvals", {}).then(setApprovals, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    return onDappChanged(load);
  }, [load]);

  useEffect(() => {
    clearTimeout(closing.current);
    if (approvals?.length === 0 && !error) closing.current = setTimeout(() => window.close(), CLOSE_AFTER_MS);
    return () => clearTimeout(closing.current);
  }, [approvals, error]);

  const current = approvals?.[0];
  const needsPassword = !!current && current.kind !== "connect" && current.password;
  const [password, setPassword] = useState("");
  // Each request starts with an empty box.
  const currentId = current?.id;
  useEffect(() => setPassword(""), [currentId]);

  async function answer(approve: boolean) {
    if (!current || busy || (approve && needsPassword && !password)) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await call("dapp-answer", {
        id: current.id,
        approve,
        ...(approve && needsPassword ? { password } : {}),
      });
      if (result.error) {
        setError(result.error);
        setPassword("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      load();
    }
  }

  if (!current) {
    return (
      <Screen title="Seedelf Wallet" titleId="dapp-title" error={error}>
        <p className="note center" data-testid="dapp-empty">
          {approvals ? "Nothing's waiting." : "Loading…"}
        </p>
      </Screen>
    );
  }

  const more = approvals!.length > 1 ? ` · 1 of ${approvals!.length}` : "";
  const [title, action] =
    current.kind === "connect"
      ? ["Connect a site", "Connect"]
      : current.kind === "sign-tx"
        ? ["Sign a transaction", "Sign"]
        : ["Sign a message", "Sign"];

  return (
    <Screen
      title={title}
      titleId="dapp-title"
      aside={`Nothing happens until you press ${action}${more}`}
      error={error}
      // With the password, Enter in its box signs, as it unlocks elsewhere.
      onSubmit={
        needsPassword
          ? (e: FormEvent) => {
              e.preventDefault();
              void answer(true);
            }
          : undefined
      }
      foot={
        <div className="actions">
          <button type="button" className="secondary" onClick={() => answer(false)} disabled={busy}>
            {current.kind === "connect" ? "Cancel" : "Decline"}
          </button>
          <button
            type={needsPassword ? "submit" : "button"}
            className="primary"
            onClick={needsPassword ? undefined : () => answer(true)}
            disabled={busy || (needsPassword && !password)}
          >
            {busy ? "…" : action}
          </button>
        </div>
      }
    >
      <div className="stack" data-testid={`dapp-${current.kind}`}>
        <Site origin={current.origin} title={current.title} />
        {current.kind === "connect" && <Connect />}
        {current.kind === "sign-tx" && <SignTx summary={current.summary} partial={current.partial} />}
        {current.kind === "sign-data" && (
          <SignData address={current.address} signer={current.key} payload={current.payload} text={current.text} />
        )}
        {/* Under what it signs, and never focused first: the review is read before the password is typed. */}
        {needsPassword && (
          <PasswordField id="dapp-password" label="Your password, to sign" value={password} onChange={setPassword} />
        )}
      </div>
    </Screen>
  );
}

/** Who's asking: the origin, as Chrome reported it. The page's own title is the site's to choose, so it's second. */
function Site({ origin, title }: { origin: string; title?: string }) {
  const host = new URL(origin).host;
  return (
    <div className="dapp-site" data-testid="dapp-origin">
      <span className="dapp-site__icon">
        <GlobeIcon size={18} />
      </span>
      <span className="stack-tight">
        <strong>{host}</strong>
        <span className="note">{title && title !== host ? `${title} · ${origin}` : origin}</span>
      </span>
    </div>
  );
}

function Connect() {
  return (
    <>
      <ul className="dapp-points">
        <li>It sees your public account: its addresses, its balance and its UTxOs.</li>
        <li>It can ask you to sign transactions and messages. Nothing is signed without you.</li>
      </ul>
      <Callout tone="privacy" testId="dapp-connect-privacy">
        Your private balance stays out of it: the site never sees your Seedelfs or their UTxOs. It does learn your public
        account, as any site you pay from it does.
      </Callout>
      <p className="note">You can disconnect it in Settings, under Connected sites.</p>
    </>
  );
}

function SignTx({ summary: s, partial }: { summary: DappTxSummary; partial: boolean }) {
  const network = useNetwork();
  const net = BigInt(s.netLovelace);
  const token = (t: DappToken) => {
    const q = BigInt(t.quantity);
    const decimals = tokenInfo(network, t)?.decimals ?? 0;
    return `${formatQuantity((q < 0n ? -q : q).toString(), decimals)} ${tokenLabel(network, t)}`;
  };
  const keys = s.signs.filter((k) => k !== "stake").length;
  const stake = s.signs.includes("stake");
  const signers = [keys ? plural(keys, "payment key") : "", stake ? "your stake key" : ""].filter(Boolean).join(" and ");

  const notes: ReactNode[] = [];
  if (s.scripts) notes.push("It runs smart contracts.");
  if (s.referenceInputs) notes.push(`It reads ${plural(s.referenceInputs, "UTxO")} it doesn't spend.`);
  if (s.votes) notes.push(`It casts ${plural(s.votes, "governance vote")}.`);
  if (s.proposals) notes.push(`It makes ${plural(s.proposals, "governance proposal")}.`);
  if (s.donation) notes.push(`It donates ${formatAda(s.donation)} ₳ to the treasury.`);
  if (s.metadata && !s.note) notes.push("It carries metadata, which anyone can read.");

  return (
    <>
      <ReviewRows testId="dapp-tx-net">
        <Row
          label={net < 0n ? "Your public account sends" : "Your public account gets"}
          value={`${formatAda((net < 0n ? -net : net).toString())} ₳`}
          strong
        />
        {s.netTokens.map((t) => (
          <Row
            key={`${t.policyId}.${t.assetName}`}
            label={BigInt(t.quantity) < 0n ? "Sends" : "Gets"}
            value={token(t)}
          />
        ))}
        <Row label="Network fee" value={`${formatAda(s.fee)} ₳${s.ownInputs ? " (included)" : ""}`} />
        {s.collateral && s.collateral.own > 0 && (
          <Row label="Collateral at risk" value={`${formatAda(s.collateral.atRisk)} ₳`} />
        )}
        <Row label="Signs with" value={signers} />
      </ReviewRows>

      {s.paid.length > 0 && (
        <section className="section" aria-labelledby="dapp-paid-title">
          <h2 id="dapp-paid-title">Pays</h2>
          <ul className="list" data-testid="dapp-paid">
            {s.paid.map((p, i) => (
              <li key={i} className="list__row">
                <span className="stack-tight">
                  <MiddleEllipsis text={p.address} />
                  <span className="note">
                    {[p.seedelf ? "Seedelf Wallet's contract" : p.script ? "A contract" : "An address", p.datum ? "with data" : ""]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
                <span className="dapp-amount">
                  {formatAda(p.lovelace)} ₳
                  {p.tokens.map((t) => (
                    <span key={`${t.policyId}.${t.assetName}`} className="note">
                      {token(t)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.paid.some((p) => p.seedelf === "none") && (
        <Callout tone="warn" testId="dapp-seedelf-unsafe">
          It pays Seedelf Wallet's contract without a register: whatever goes there, anyone can take.
        </Callout>
      )}
      {s.paid.some((p) => p.seedelf === "register") && (
        <Callout tone="privacy" testId="dapp-seedelf-payment">
          It pays a Seedelf. Nothing on chain says whose, but it comes from your public account in the open.
        </Callout>
      )}

      {s.mint.length > 0 && (
        <ReviewRows testId="dapp-mint">
          {s.mint.map((t) => (
            <Row key={`${t.policyId}.${t.assetName}`} label={BigInt(t.quantity) < 0n ? "Burns" : "Mints"} value={token(t)} />
          ))}
        </ReviewRows>
      )}

      {(s.certificates.length > 0 || s.withdrawals.length > 0) && (
        <Callout tone={s.certificates.some((c) => c.own) ? "warn" : "info"} testId="dapp-staking">
          <ul className="dapp-points">
            {s.certificates.map((c, i) => (
              <li key={i}>{certificate(c)}</li>
            ))}
            {s.withdrawals.map((w, i) => (
              <li key={`w${i}`}>
                {w.own
                  ? `Withdraws your staking rewards: ${formatAda(w.lovelace)} ₳.`
                  : `Withdraws ${formatAda(w.lovelace)} ₳ from a contract's reward account.`}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {s.collateral && s.collateral.own > 0 && (
        <p className="note" data-testid="dapp-collateral">
          Your collateral goes along: the network keeps up to {formatAda(s.collateral.atRisk)} ₳ of it only if a contract
          refuses the transaction.
        </p>
      )}

      {s.note && (
        <div className="stack-tight">
          <span className="note">Its note, which anyone can read</span>
          <pre className="dapp-message" data-testid="dapp-note">
            {s.note.join("\n")}
          </pre>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="dapp-points note" data-testid="dapp-notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {partial && !s.complete && (
        <Callout tone="info" testId="dapp-partial">
          The site asked for your part only: others sign it too before it's sent.
        </Callout>
      )}
      {s.unknownInputs.length > 0 && (
        <Callout tone="warn" testId="dapp-unknown">
          It spends {plural(s.unknownInputs.length, "UTxO")} the wallet couldn't find, so what it takes from others can't
          be shown.
        </Callout>
      )}

      <Callout tone="privacy" testId="dapp-tx-privacy">
        Signing ties this transaction to your public account, as any payment from it. Your private balance isn't in it.
      </Callout>
    </>
  );
}

/** A certificate in a sentence: the account's own staking, or someone else's. */
function certificate(c: DappTxSummary["certificates"][number]): string {
  if (!c.own) {
    if (c.kind === "pool") return "A stake pool's certificate.";
    if (c.kind === "drep") return "A DRep's certificate.";
    if (c.kind === "committee") return "A constitutional committee certificate.";
    return "A certificate for a stake key that isn't yours.";
  }
  const parts: string[] = [];
  if (c.kind.startsWith("register")) parts.push(`Registers your stake key${c.deposit ? ` (a ${formatAda(c.deposit)} ₳ deposit)` : ""}`);
  if (c.kind === "unregister") parts.push(`Stops your staking${c.refund ? ` (the ${formatAda(c.refund)} ₳ deposit back)` : ""}`);
  if (c.pool) parts.push(`stakes with ${c.pool}`);
  if (c.drep) parts.push(`delegates your vote: ${voteLabel(c.drep)}`);
  const sentence = parts.join(", ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function SignData({
  address,
  signer,
  payload,
  text,
}: {
  address: string;
  signer: "payment" | "stake";
  payload: string;
  text?: string;
}) {
  return (
    <>
      <ReviewRows testId="dapp-data">
        <Row label="With" value={signer === "stake" ? "Your stake key" : "Your payment key"} />
      </ReviewRows>
      <div className="stack-tight">
        <span className="note">For the address</span>
        <MiddleEllipsis text={address} testId="dapp-data-address" />
      </div>
      <div className="stack-tight">
        <span className="note">{text === undefined ? "The data (hex)" : "The message"}</span>
        <pre className="dapp-message" data-testid="dapp-data-message">
          {text ?? payload}
        </pre>
      </div>
      <Callout tone="info" testId="dapp-data-note">
        Signing proves to the site that you hold this address's key, usually to sign in. It moves no money.
      </Callout>
    </>
  );
}
