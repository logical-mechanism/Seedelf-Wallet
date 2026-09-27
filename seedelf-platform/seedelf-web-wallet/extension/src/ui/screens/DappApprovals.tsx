// The dApp connector's window (`?view=dapp`): what sites wait for, oldest
// first, one at a time. Connecting a site, signing its transaction (with
// what it does to the account, as WebAssembly read it), or signing its data
// (CIP-8). Nothing is signed until the user presses Sign, with the password
// typed too unless Settings says otherwise; closing the window declines
// everything. Once nothing's left, the worker closes it (it knows whether a
// request just came in).
//
// Connecting offers the public account or a private session (chunk 15c): a
// one-time account funded from the private balance, here, before the site
// gets it. Its funding is reviewed and sent from this window, which then
// waits for the network; closing it then doesn't undo the payment.

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import type { Balances, DappApproval, DappToken, DappTxSummary, SessionOutSummary } from "../../shared/rpc";
import { call, onDappChanged } from "../background";
import { AdaInput, lovelaceToSend, MinimumHint } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { Choice } from "../components/Choice";
import { ExternalIcon, GlobeIcon, SpinnerIcon } from "../components/Icons";
import { MiddleEllipsis } from "../components/MiddleEllipsis";
import { PasswordField } from "../components/PasswordField";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { certificateLine, paidTo, stakingComesBack, withdrawalLine } from "../dapp";
import { explorerUrl, formatAda, formatQuantity, plural, shortHex } from "../format";
import { useNetwork } from "../network";
import { tokenInfo, tokenLabel } from "../tokens";

/** How long an empty list waits before the window closes: a site's next request may be on its way. */
const CLOSE_AFTER_MS = 800;
/**
 * How long the buttons wait when another request takes the shown one's
 * place, so a click meant for that one can't answer this one.
 */
const HOLD_MS = 1_000;

/** How the request shown came to be: the next after the user's answer, or in the place of one that's gone. */
type Change = "next" | "replaced";

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

  // Empty: the worker closes the window, unless a request came in meanwhile,
  // which it would otherwise decline unseen; then it's shown.
  useEffect(() => {
    clearTimeout(closing.current);
    if (approvals?.length === 0 && !error) {
      closing.current = setTimeout(() => {
        call("dapp-close", {}).then((closed) => {
          if (!closed) load();
        }, load);
      }, CLOSE_AFTER_MS);
    }
    return () => clearTimeout(closing.current);
  }, [approvals, error, load]);

  const current = approvals?.[0];
  const needsPassword = !!current && current.kind !== "connect" && current.password;
  const [password, setPassword] = useState("");
  // Each request starts with an empty box.
  const currentId = current?.id;
  useEffect(() => setPassword(""), [currentId]);

  // Another request in the place of the one shown (the next, or one whose
  // page went away): it says so, and its buttons wait a moment.
  const shown = useRef<string>(undefined);
  const answered = useRef<string>(undefined);
  const [change, setChange] = useState<Change>();
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!currentId) return;
    const before = shown.current;
    shown.current = currentId;
    if (before === undefined || before === currentId) return;
    setChange(before === answered.current ? "next" : "replaced");
    setHeld(true);
    const timer = setTimeout(() => setHeld(false), HOLD_MS);
    return () => clearTimeout(timer);
  }, [currentId]);

  /** Answers the request shown: `extra` carries a private session's funding and the password it needs. */
  async function answer(approve: boolean, extra: { password?: string; fund?: { txHash: string } } = {}): Promise<boolean> {
    if (!current || busy || held || (approve && needsPassword && !password)) return false;
    answered.current = current.id;
    setBusy(true);
    setError(undefined);
    try {
      const result = await call("dapp-answer", {
        id: current.id,
        approve,
        ...(approve && needsPassword ? { password } : {}),
        ...extra,
      });
      if (result.error) {
        setError(result.error);
        setPassword("");
        return false;
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
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
  if (current.kind === "connect") {
    return (
      <ConnectRequest
        key={current.id}
        approval={current}
        more={more}
        busy={busy}
        held={held}
        change={change}
        error={error}
        onError={setError}
        onAnswer={answer}
      />
    );
  }
  const [title, action] = current.kind === "sign-tx" ? ["Sign a transaction", "Sign"] : ["Sign a message", "Sign"];

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
          <button type="button" className="secondary" onClick={() => answer(false)} disabled={busy || held}>
            Decline
          </button>
          <button
            type={needsPassword ? "submit" : "button"}
            className="primary"
            onClick={needsPassword ? undefined : () => answer(true)}
            disabled={busy || held || (needsPassword && !password)}
          >
            {busy ? "…" : action}
          </button>
        </div>
      }
    >
      <div className="stack" data-testid={`dapp-${current.kind}`}>
        <Changed change={change} />
        <Site origin={current.origin} title={current.title} session={current.session} />
        {current.kind === "sign-tx" && (
          <SignTx
            summary={current.summary}
            partial={current.partial}
            session={current.session !== undefined}
            collateralSpent={!!current.collateralSpent}
          />
        )}
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

/** Says the request shown isn't the one before: its buttons wait a moment meanwhile. */
function Changed({ change }: { change?: Change }) {
  if (change === "replaced") {
    return (
      <Callout tone="warn" testId="dapp-changed">
        The request you were reading is gone, and this one took its place. Read it before you answer.
      </Callout>
    );
  }
  if (change === "next") {
    return (
      <p className="note" data-testid="dapp-changed">
        The next request, in place of the one you answered.
      </p>
    );
  }
  return null;
}

/**
 * Who's asking: the origin, as Chrome reported it. The page's own title is
 * the site's to choose, so it's second. A site connected to a private
 * session says so.
 */
function Site({ origin, title, session }: { origin: string; title?: string; session?: number }) {
  const host = new URL(origin).host;
  return (
    <div className="dapp-site" data-testid="dapp-origin">
      <span className="dapp-site__icon">
        <GlobeIcon size={18} />
      </span>
      <span className="stack-tight">
        <strong>{host}</strong>
        <span className="note">{title && title !== host ? `${title} · ${origin}` : origin}</span>
        {session !== undefined && (
          <span className="dapp-site__session" data-testid="dapp-site-session">
            Connected to private session {session + 1}
          </span>
        )}
      </span>
    </div>
  );
}

type Connection = "public" | "private";

/**
 * A site asks to connect: to the public account, or to a private session
 * funded here first. A private session goes from its amount to its funding's
 * review (Send, with the password when it's on), then waits for the network.
 */
function ConnectRequest({
  approval,
  more,
  busy,
  held,
  change,
  error,
  onError,
  onAnswer,
}: {
  approval: Extract<DappApproval, { kind: "connect" }>;
  more: string;
  busy: boolean;
  /** Its buttons wait: it just took another request's place. */
  held: boolean;
  change?: Change;
  error?: string;
  onError: (error?: string) => void;
  onAnswer: (approve: boolean, extra?: { password?: string; fund?: { txHash: string } }) => Promise<boolean>;
}) {
  const network = useNetwork();
  const [connection, setConnection] = useState<Connection>("public");
  const [seedelf, setSeedelf] = useState<Balances["seedelf"]>();
  const [amount, setAmount] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [review, setReview] = useState<SessionOutSummary>();
  const [building, setBuilding] = useState(false);
  const [password, setPassword] = useState("");

  // What the private balance holds, for the amount and its tokens: the last reading, no request.
  useEffect(() => {
    if (connection !== "private" || seedelf) return;
    call("balances", {}).then(
      (b) => setSeedelf(b.seedelf),
      (e: Error) => onError(e.message),
    );
  }, [connection, seedelf, onError]);

  const host = new URL(approval.origin).host;
  const site = <Site origin={approval.origin} title={approval.title} />;

  // Sent: it waits for the network, and the site connects once Koios sees the money.
  if (approval.funding) {
    return (
      <Screen title="Funding a private session" titleId="dapp-title" aside={`For ${host}`} error={error}>
        <div className="stack" data-testid="dapp-funding">
          {site}
          <p className="dapp-waiting">
            <span className="spin">
              <SpinnerIcon size={16} />
            </span>
            Waiting for the network to confirm the funding of private session {approval.funding.index + 1}. It usually
            takes about a minute; the site connects once the money is there.
          </p>
          <a className="menu-link" href={explorerUrl(network, approval.funding.txHash)} target="_blank" rel="noreferrer">
            The funding on Cardanoscan <ExternalIcon size={12} />
          </a>
          <p className="note">You can close this window: the payment is sent, and closing doesn't undo it.</p>
        </div>
      </Screen>
    );
  }

  const tokens = seedelf ? tokenChoices(seedelf.tokens, typed) : undefined;
  const withTokens = (tokens?.sent.length ?? 0) > 0;
  const lovelace = lovelaceToSend(amount, withTokens);
  const tooMuch = !!seedelf && !!lovelace && BigInt(lovelace) > BigInt(seedelf.lovelace);
  const canReview = !!seedelf && !!lovelace && !tooMuch && !!tokens?.ok;

  async function build(e: FormEvent) {
    e.preventDefault();
    if (!canReview || building || held) return;
    setBuilding(true);
    onError(undefined);
    try {
      setReview(await call("dapp-private-build", { id: approval.id, lovelace: lovelace!, tokens: tokens!.sent }));
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!review || busy || (approval.password && !password)) return;
    const sent = await onAnswer(true, { fund: { txHash: review.txHash }, ...(approval.password ? { password } : {}) });
    if (!sent) setPassword("");
  }

  // The funding, built: what goes where, and Send.
  if (review) {
    const [forSite, collateral] = review.payments;
    const carried = (p: typeof forSite) =>
      p ? `${formatAda(p.lovelace)} ₳${p.tokens.length ? ` and ${plural(p.tokens.length, "token")}` : ""}` : "";
    return (
      <Screen
        onSubmit={send}
        title="Review the funding"
        titleId="dapp-title"
        onBack={() => {
          setReview(undefined);
          setPassword("");
        }}
        backDisabled={busy}
        aside={`A private session for ${host}. Nothing is sent until you press Send`}
        error={error}
        foot={
          <div className="actions">
            <button type="button" className="secondary" onClick={() => void onAnswer(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || (approval.password && !password)}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        }
      >
        <div className="stack" data-testid="dapp-funding-review">
          <ReviewRows testId="dapp-funding-rows">
            <Row label="To" value={`Private session ${review.index + 1}`} strong />
            <Row label="Account" value={shortHex(review.address, 16, 8)} title={review.address} />
            <Row label="For the site" value={carried(forSite)} strong />
            <Row label="Its collateral" value={`${formatAda(collateral?.lovelace ?? "0")} ₳`} />
            <Row label="Network fee" value={`${formatAda(review.fee.total)} ₳`} />
            <Row label="Back to your private balance" value={`${formatAda(review.changeLovelace)} ₳`} />
          </ReviewRows>
          <p className="note">
            The site sees this account as an ordinary wallet, and it's yours to top up or bring back from the dApps page.
            The collateral comes back with it.
          </p>
          <Callout tone="privacy" testId="dapp-funding-privacy">
            This payment links the private UTxOs it spends to the one-time account, as Make public does. The site then sees
            that account, never your public account or your private balance.
          </Callout>
          <p className="note">Send asks giveme.my to lend the collateral, then submits.</p>
          {approval.password && (
            <PasswordField id="dapp-funding-password" label="Your password, to send" value={password} onChange={setPassword} />
          )}
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={connection === "private" ? build : undefined}
      title="Connect a site"
      titleId="dapp-title"
      aside={`Nothing happens until you press ${connection === "private" ? "Review" : "Connect"}${more}`}
      error={error}
      foot={
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void onAnswer(false)}
            disabled={busy || building || held}
          >
            Cancel
          </button>
          {connection === "private" ? (
            <button type="submit" className="primary" disabled={!canReview || building || held}>
              {building ? "Building…" : "Review"}
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => void onAnswer(true)} disabled={busy || held}>
              {busy ? "…" : "Connect"}
            </button>
          )}
        </div>
      }
    >
      <div className="stack" data-testid="dapp-connect">
        <Changed change={change} />
        {site}
        <Choice<Connection>
          label="Connect it to"
          id="dapp-connection"
          value={connection}
          onChange={(c) => {
            setConnection(c);
            onError(undefined);
          }}
          options={[
            { value: "public", label: "Your public account" },
            { value: "private", label: "A private session" },
          ]}
        />
        {connection === "public" ? (
          <>
            <ul className="dapp-points">
              <li>It sees your public account: its addresses, its balance and its UTxOs.</li>
              <li>It can ask you to sign transactions and messages. Nothing is signed without you.</li>
            </ul>
            <Callout tone="privacy" testId="dapp-connect-privacy">
              Your private balance stays out of it: the site never sees your Seedelfs or their UTxOs. It does learn your
              public account, as any site you pay from it does.
            </Callout>
          </>
        ) : (
          <>
            <ul className="dapp-points" data-testid="dapp-private-points">
              <li>A new one-time account, funded from your private balance with what you choose here. The site sees only it.</li>
              <li>It stays this site's until you disconnect it. Top it up or bring it back from the dApps page.</li>
            </ul>
            <div className="field">
              <label htmlFor="dapp-private-amount">What to put in it</label>
              <AdaInput
                id="dapp-private-amount"
                value={amount}
                onChange={setAmount}
                placeholder={withTokens ? "Minimum" : "0"}
                autoFocus={false}
              />
              {seedelf && (
                <p className="note" data-testid="dapp-private-held">
                  {formatAda(seedelf.lovelace)} ₳ in your private balance, and 5 ₳ more goes in as the account's
                  collateral, which comes back.
                </p>
              )}
              {tooMuch && seedelf && (
                <p className="field-note">That's more than the {formatAda(seedelf.lovelace)} ₳ in your private balance.</p>
              )}
            </div>
            {withTokens && <MinimumHint />}
            {seedelf && <TokenAmounts held={seedelf.tokens} typed={typed} onChange={setTyped} />}
            <Callout tone="privacy" testId="dapp-private-privacy">
              Your public account never appears. Anyone can follow the money from your private balance into the one-time
              account, though, and what the site does with it is public, as any wallet's is.
            </Callout>
          </>
        )}
        <p className="note">You can disconnect it in Settings, under Connected sites.</p>
      </div>
    </Screen>
  );
}

function SignTx({
  summary: s,
  partial,
  session,
  collateralSpent,
}: {
  summary: DappTxSummary;
  partial: boolean;
  session: boolean;
  collateralSpent: boolean;
}) {
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
  const whose = session ? "your private session" : "your public account";
  const staking = BigInt(s.stakingLovelace);
  const back = stakingComesBack(s);
  const ownKey = s.paid.filter((p) => p.ownPaymentKey).length;

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
          label={`${session ? "Your private session" : "Your public account"} ${net < 0n ? "sends" : "gets"}`}
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
        {/* Rewards and a deposit back are the account's money too: counted above, and said so. */}
        {staking > 0n && <Row label="From your staking" value={`${formatAda(s.stakingLovelace)} ₳ (included)`} />}
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
              // The whole address on its own line: shortened, a lookalike's could read the same.
              <li key={i} className="list__row dapp-paid">
                <span className="dapp-address" data-value={p.address}>
                  {p.address}
                </span>
                <span className="note">{paidTo(p)}</span>
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

      {ownKey > 0 && (
        <Callout tone="warn" testId="dapp-own-key">
          It pays {plural(ownKey, "output")} to your payment key with a stake part that isn't yours. That isn't change,
          so it isn't counted as coming back: the money can still be spent from this wallet, but it earns staking
          rewards for someone else, or for no one.
        </Callout>
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
        <Callout
          tone={s.certificates.some((c) => c.own) || (staking > 0n && !back) ? "warn" : "info"}
          testId="dapp-staking"
        >
          <ul className="dapp-points">
            {s.certificates.map((c, i) => (
              <li key={i}>{certificateLine(c, back, whose)}</li>
            ))}
            {s.withdrawals.map((w, i) => (
              <li key={`w${i}`}>{withdrawalLine(w, back, whose)}</li>
            ))}
          </ul>
        </Callout>
      )}

      {collateralSpent && (
        <Callout tone="warn" testId="dapp-collateral-spent">
          It spends this private session's collateral as an ordinary payment, so the session has none left to put up
          for the site's contracts.
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
          It spends {plural(s.unknownInputs.length, "UTxO")} the wallet couldn't find, so what they hold can't be shown.
          Only your stake key signs here, and it spends none of them.
        </Callout>
      )}

      <Callout tone="privacy" testId="dapp-tx-privacy">
        {session
          ? "Signing ties this transaction to the session's one-time account. Your public account and your private balance aren't in it."
          : "Signing ties this transaction to your public account, as any payment from it. Your private balance isn't in it."}
      </Callout>
    </>
  );
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
