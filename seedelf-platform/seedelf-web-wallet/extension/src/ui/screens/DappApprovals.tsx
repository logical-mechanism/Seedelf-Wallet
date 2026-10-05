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
import { joinSentences, t, useT } from "../../i18n";

import type { Balances, DappApproval, DappToken, DappTxSummary, SessionOutSummary } from "../../shared/rpc";
import { accountNumberAndName, useAccounts } from "../accounts";
import { call, onDappChanged } from "../background";
import { AdaInput, lovelaceToSend, MinimumHint } from "../components/AdaInput";
import { Callout } from "../components/Callout";
import { HistoriesNote } from "../components/HistoriesNote";
import { PaidRows } from "../components/PaidRows";
import { Choice } from "../components/Choice";
import { ExplorerLink } from "../components/ExplorerLink";
import { GlobeIcon, SpinnerIcon } from "../components/Icons";
import { PasswordField } from "../components/PasswordField";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { TxDetailButton } from "../components/TxDetail";
import { TokenAmounts, tokenChoices } from "../components/TokenAmounts";
import { TokenAmountRow, TokenAmountText } from "../components/TokenList";
import { certificateLine, paidTo, signingTies, stakingComesBack, tiesLine, withdrawalLine } from "../dapp";
import { formatAda, formatQuantity, shortHex } from "../format";
import { useNetwork } from "../network";
import { usePreferences } from "../preferences";
import { tokenDecimals, tokenText } from "../tokens";

/** How long an empty list waits before the window closes: a site's next request may be on its way. */
const CLOSE_AFTER_MS = 800;
/**
 * How long the buttons wait when another request takes the shown one's
 * place, so a click meant for that one can't answer this one.
 */
const HOLD_MS = 1_000;

/**
 * Which public account a site connected to it gets, by its number and name,
 * when the wallet has more than one: sites always use the one Settings →
 * Sites chooses, whichever is on screen, so "your public account" alone
 * could mean an account the screen isn't showing (chunk 23). Undefined with
 * one account, where there's nothing to tell apart.
 */
function useSiteAccount(): string | undefined {
  const { accounts, several } = useAccounts();
  const { prefs, loaded } = usePreferences();
  if (!several || !loaded) return undefined;
  return accountNumberAndName(accounts.find((a) => a.index === prefs.dappAccount) ?? { index: prefs.dappAccount });
}

/** How the request shown came to be: the next after the user's answer, or in the place of one that's gone. */
type Change = "next" | "replaced";

export function DappApprovals() {
  const tr = useT();
  const siteAccount = useSiteAccount();
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
  async function answer(
    approve: boolean,
    extra: { password?: string; fund?: { txHash: string }; governance?: boolean } = {},
  ): Promise<boolean> {
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
          {tr(approvals ? "dappUi.nothingWaiting" : "dappUi.loading")}
        </p>
      </Screen>
    );
  }

  const more = approvals!.length > 1 ? tr("dappUi.oneOf", { total: approvals!.length }) : "";
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
  const title = tr(current.kind === "sign-tx" ? "dappUi.signTxTitle" : "dappUi.signDataTitle");
  const action = tr("dappUi.sign");

  return (
    <Screen
      title={title}
      titleId="dapp-title"
      aside={`${tr("dappUi.nothingUntil", { action })}${more}`}
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
            {tr("dappUi.decline")}
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
        <Site
          origin={current.origin}
          title={current.title}
          session={current.session}
          account={current.session === undefined ? siteAccount : undefined}
        />
        {current.kind === "sign-tx" && (
          <SignTx
            summary={current.summary}
            partial={current.partial}
            session={current.session !== undefined}
            collateralSpent={!!current.collateralSpent}
            ties={current.ties}
          />
        )}
        {current.kind === "sign-data" && (
          <SignData address={current.address} signer={current.key} payload={current.payload} text={current.text} />
        )}
        {/* Under what it signs, and never focused first: the review is read before the password is typed. */}
        {needsPassword && (
          <PasswordField id="dapp-password" label={tr("dappUi.passwordLabel")} value={password} onChange={setPassword} />
        )}
      </div>
    </Screen>
  );
}

/** Says the request shown isn't the one before: its buttons wait a moment meanwhile. */
function Changed({ change }: { change?: Change }) {
  const tr = useT();
  if (change === "replaced") {
    return (
      <Callout tone="warn" testId="dapp-changed">
        {tr("dappUi.warn.replaced")}
      </Callout>
    );
  }
  if (change === "next") {
    return (
      <p className="note" data-testid="dapp-changed">
        {tr("dappUi.nextRequest")}
      </p>
    );
  }
  return null;
}

/**
 * Who's asking: the origin, as Chrome reported it. The page's own title is
 * the site's to choose, so it's second. A site connected to a private
 * session says so, and one connected to the public account names it when
 * there's more than one (`account`). Exported for its tests.
 */
export function Site({ origin, title, session, account }: { origin: string; title?: string; session?: number; account?: string }) {
  const tr = useT();
  const host = new URL(origin).host;
  return (
    <div className="dapp-site" data-testid="dapp-origin">
      <span className="dapp-site__icon">
        <GlobeIcon size={18} />
      </span>
      <span className="stack-tight">
        <strong>{host}</strong>
        <span className="note">{title && title !== host ? tr("dappUi.titleAndOrigin", { title, origin }) : origin}</span>
        {session !== undefined && (
          <span className="dapp-site__session" data-testid="dapp-site-session">
            {tr("dappUi.connectedToSession", { number: session + 1 })}
          </span>
        )}
        {session === undefined && account && (
          <span className="dapp-site__session" data-testid="dapp-site-account">
            {tr("dappUi.connectedToAccount", { account })}
          </span>
        )}
      </span>
    </div>
  );
}

type Connection = "public" | "private";

// What each connection lets a site learn (privacy review §2.12): what the
// wallet gives it, and what it can find out anyway, on chain or from the
// browser. Exported for their tests.

/** Under "Your public account". */
export const PUBLIC_PRIVACY = () => t("dappUi.privacy.publicAccount");

/** Under "A private session". */
export const PRIVATE_SESSION_PRIVACY = () => t("dappUi.privacy.privateSession");

/** On a private session's funding, which leaves `changeLovelace` in the private balance. */
export function fundingPrivacy(changeLovelace: string): string {
  if (BigInt(changeLovelace) > 0n) return t("dappUi.privacy.fundingWithChange", { ada: formatAda(changeLovelace) });
  return t("dappUi.privacy.funding");
}

/**
 * A site asks to connect: to the public account, or to a private session
 * funded here first. Neither is chosen for the user (privacy review §3.3):
 * each says what it costs, and Connect waits for a choice, since what a
 * site sees of the public account can't be taken back. A private session
 * goes from its amount to its funding's review (Send, with the password when
 * it's on), then waits for the network. Exported for its tests.
 */
export function ConnectRequest({
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
  onAnswer: (approve: boolean, extra?: { password?: string; fund?: { txHash: string }; governance?: boolean }) => Promise<boolean>;
}) {
  const tr = useT();
  const network = useNetwork();
  const siteAccount = useSiteAccount();
  const [connection, setConnection] = useState<Connection>();
  // Asked for, governance goes with the public account only when switched on: off, as the most private choice is.
  const [governance, setGovernance] = useState(false);
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
  // Asking for governance alone, it's connected already: to the dApp account, named as a signature's window names it.
  const connectedSite = <Site origin={approval.origin} title={approval.title} account={siteAccount} />;

  // Sent: it waits for the network, and the site connects once Koios sees the money.
  if (approval.funding) {
    return (
      <Screen
        title={tr("dappUi.fundingTitle")}
        titleId="dapp-title"
        aside={tr("dappUi.forSite", { host })}
        error={error}
      >
        <div className="stack" data-testid="dapp-funding">
          {site}
          <p className="dapp-waiting">
            <span className="spin">
              <SpinnerIcon size={16} />
            </span>
            {tr("dappUi.waitingForFunding", { number: approval.funding.index + 1 })}
          </p>
          <ExplorerLink network={network} tx={approval.funding.txHash} private>
            {tr("dappUi.fundingOnCardanoscan")}
          </ExplorerLink>
          <p className="note">{tr("dappUi.canClose")}</p>
        </div>
      </Screen>
    );
  }

  // Connected already, it asks for governance alone (CIP-95): its account is the dApp account's, as before.
  if (approval.connected) {
    return (
      <Screen
        title={tr("dappUi.governanceTitle")}
        titleId="dapp-title"
        aside={`${tr("dappUi.nothingUntil", { action: tr("dappUi.allow") })}${more}`}
        error={error}
        foot={
          <div className="actions">
            <button type="button" className="secondary" onClick={() => void onAnswer(false)} disabled={busy || held}>
              {tr("dappUi.cancel")}
            </button>
            <button type="button" className="primary" onClick={() => void onAnswer(true)} disabled={busy || held}>
              {busy ? "…" : tr("dappUi.allow")}
            </button>
          </div>
        }
      >
        <div className="stack" data-testid="dapp-governance">
          <Changed change={change} />
          {connectedSite}
          <p className="note">{tr("dappUi.governance.asks")}</p>
          <Callout tone="privacy" testId="dapp-governance-privacy">
            {tr("dappUi.privacy.governance")}
          </Callout>
        </div>
      </Screen>
    );
  }

  const tokens = seedelf ? tokenChoices(network, seedelf.tokens, typed) : undefined;
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
    return (
      <Screen
        onSubmit={send}
        title={tr("dappUi.reviewFunding")}
        titleId="dapp-title"
        hint={tr("dappUi.ordinaryWallet")}
        hintTestId="dapp-funding-note"
        onBack={() => {
          setReview(undefined);
          setPassword("");
        }}
        backDisabled={busy}
        aside={tr("dappUi.fundingAside", { host })}
        error={error}
        foot={
          <div className="actions">
            <button type="button" className="secondary" onClick={() => void onAnswer(false)} disabled={busy}>
              {tr("dappUi.cancel")}
            </button>
            <button type="submit" className="primary" disabled={busy || (approval.password && !password)}>
              {busy ? tr("common.sending") : tr("common.send")}
            </button>
          </div>
        }
      >
        <div className="stack" data-testid="dapp-funding-review">
          <ReviewRows testId="dapp-funding-rows">
            <Row label={tr("lovejoin.review.to")} value={tr("lovejoin.privateSession", { number: review.index + 1 })} strong />
            <Row label={tr("lovejoin.review.account")} value={shortHex(review.address, 16, 8)} title={review.address} />
            <PaidRows label={tr("dappUi.forTheSite")} paid={forSite} />
            <Row label={tr("lovejoin.review.itsCollateral")} value={`${formatAda(collateral?.lovelace ?? "0")} ₳`} />
            <Row label={tr("review.fee")} value={`${formatAda(review.fee.total)} ₳`} />
            <Row label={tr("review.backToPrivate")} value={`${formatAda(review.changeLovelace)} ₳`} />
          </ReviewRows>
          <TxDetailButton txHash={review.txHash} testId="dapp-funding-tx" />
          <Callout tone="privacy" testId="dapp-funding-privacy">
            {fundingPrivacy(review.changeLovelace)}
          </Callout>
          <HistoriesNote histories={review.histories} session={review.index} testId="dapp-funding-histories" />
          <p className="note">{tr("swaps.review.givemeNote")}</p>
          {approval.password && (
            <PasswordField
              id="dapp-funding-password"
              label={tr("dappUi.passwordToSend")}
              value={password}
              onChange={setPassword}
            />
          )}
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      onSubmit={connection === "private" ? build : undefined}
      title={tr("dappUi.connectTitle")}
      titleId="dapp-title"
      hint={tr("dappUi.disconnectInSettings")}
      hintTestId="dapp-disconnect-note"
      aside={
        connection
          ? `${tr("dappUi.nothingUntil", { action: tr(connection === "private" ? "common.review" : "dappUi.connect") })}${more}`
          : `${tr("dappUi.chooseWhatItSees")}${more}`
      }
      error={error}
      foot={
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void onAnswer(false)}
            disabled={busy || building || held}
          >
            {tr("dappUi.cancel")}
          </button>
          {connection === "private" ? (
            <button type="submit" className="primary" disabled={!canReview || building || held}>
              {tr(building ? "common.building" : "common.review")}
            </button>
          ) : (
            // Only once the public account is chosen: never one press from the window opening.
            <button
              type="button"
              className="primary"
              onClick={() => void onAnswer(true, approval.governance ? { governance } : {})}
              disabled={busy || held || connection !== "public"}
            >
              {busy ? "…" : tr("dappUi.connect")}
            </button>
          )}
        </div>
      }
    >
      <div className="stack" data-testid="dapp-connect">
        <Changed change={change} />
        {site}
        <Choice<Connection>
          label={tr("dappUi.connectItTo")}
          id="dapp-connection"
          value={connection}
          onChange={(c) => {
            setConnection(c);
            onError(undefined);
          }}
          options={[
            { value: "public", label: tr("dappUi.publicAccount") },
            { value: "private", label: tr("dappUi.privateSession") },
          ]}
        />
        {connection === undefined ? (
          <ul className="dapp-points" data-testid="dapp-connect-costs">
            <li>
              <strong>
                {siteAccount ? tr("dappUi.cost.publicLabelNamed", { account: siteAccount }) : tr("dappUi.cost.publicLabel")}
              </strong>{" "}
              {tr("dappUi.cost.public")}
            </li>
            <li>
              <strong>{tr("dappUi.cost.privateLabel")}</strong> {tr("dappUi.cost.private")}
            </li>
          </ul>
        ) : connection === "public" ? (
          <>
            <ul className="dapp-points">
              {siteAccount && <li data-testid="dapp-connect-account">{tr("dappUi.public.which", { account: siteAccount })}</li>}
              <li>{tr("dappUi.public.sees")}</li>
              <li>{tr("dappUi.public.asks")}</li>
            </ul>
            <Callout tone="privacy" testId="dapp-connect-privacy">
              {PUBLIC_PRIVACY()}
            </Callout>
            {approval.governance && (
              <>
                <div className="setting-row" data-testid="dapp-governance-switch">
                  <span className="stack-tight">
                    <span id="dapp-governance-label">{tr("dappUi.governance.switch")}</span>
                    <span className="note" id="dapp-governance-note">
                      {tr(governance ? "dappUi.governance.on" : "dappUi.governance.off")}
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className="switch"
                    aria-checked={governance}
                    aria-labelledby="dapp-governance-label"
                    aria-describedby="dapp-governance-note"
                    onClick={() => setGovernance(!governance)}
                    disabled={busy || held}
                  />
                </div>
                <Callout tone="privacy" testId="dapp-governance-privacy">
                  {tr("dappUi.privacy.governance")}
                </Callout>
              </>
            )}
          </>
        ) : (
          <>
            <ul className="dapp-points" data-testid="dapp-private-points">
              <li>{tr("dappUi.private.account")}</li>
              <li>{tr("dappUi.private.stays")}</li>
              {approval.governance && <li data-testid="dapp-private-no-governance">{tr("dappUi.private.noGovernance")}</li>}
            </ul>
            <div className="field">
              <label htmlFor="dapp-private-amount">{tr("dappUi.whatToPutIn")}</label>
              <AdaInput
                id="dapp-private-amount"
                value={amount}
                onChange={setAmount}
                placeholder={withTokens ? tr("sites.topUp.minimum") : "0"}
                autoFocus={false}
              />
              {seedelf && (
                <p className="note" data-testid="dapp-private-held">
                  {tr("dappUi.heldAndCollateral", { ada: formatAda(seedelf.lovelace) })}
                </p>
              )}
              {tooMuch && seedelf && (
                <p className="field-note">{tr("sites.topUp.tooMuch", { held: formatAda(seedelf.lovelace) })}</p>
              )}
            </div>
            {withTokens && <MinimumHint />}
            {seedelf && <TokenAmounts held={seedelf.tokens} typed={typed} onChange={setTyped} />}
            <Callout tone="privacy" testId="dapp-private-privacy">
              {PRIVATE_SESSION_PRIVACY()}
            </Callout>
          </>
        )}
      </div>
    </Screen>
  );
}

/** What a site's transaction does, as WebAssembly read it: exported for its tests. */
export function SignTx({
  summary: s,
  partial,
  session,
  collateralSpent,
  ties,
}: {
  summary: DappTxSummary;
  partial: boolean;
  session: boolean;
  collateralSpent: boolean;
  /** The wallet's other accounts it moves money with (independent review M12); undefined when unchecked. */
  ties?: Array<"account" | number>;
}) {
  const tr = useT();
  const network = useNetwork();
  const net = BigInt(s.netLovelace);
  // A token's amount without its sign, in its units: the rows say which way it goes.
  const amount = (t: DappToken) => {
    const q = BigInt(t.quantity);
    return formatQuantity((q < 0n ? -q : q).toString(), tokenDecimals(network, t));
  };
  // Tokens named like ADA or a listed token that aren't: each is shown by its fingerprint, and said here too.
  const lookalikes = new Map<string, string>();
  for (const t of [...s.netTokens, ...s.paid.flatMap((p) => p.tokens), ...s.mint]) {
    const posesAs = tokenText(network, t).posesAs;
    if (posesAs) lookalikes.set(`${t.policyId}.${t.assetName}`, posesAs);
  }
  const lookalikeNames = [...new Set(lookalikes.values())].join(tr("histories.list.and"));
  const keys = s.signs.filter((k) => k !== "stake" && k !== "drep").length;
  const stake = s.signs.includes("stake");
  const drep = s.signs.includes("drep");
  const signers = [
    keys ? tr("dappUi.paymentKeys", { count: keys }) : "",
    stake ? tr("dappUi.yourStakeKey") : "",
    drep ? tr("dappUi.yourDrepKey") : "",
  ]
    .filter(Boolean)
    .join(tr("histories.list.and"));
  const whose = tr(session ? "dappUi.whose.warn.session" : "dappUi.whose.warn.account");
  const staking = BigInt(s.stakingLovelace);
  const back = stakingComesBack(s);
  const ownKey = s.paid.filter((p) => p.ownPaymentKey).length;

  const notes: ReactNode[] = [];
  if (s.scripts) notes.push(tr("dappUi.note.scripts"));
  if (s.referenceInputs) notes.push(tr("dappUi.note.reads", { count: s.referenceInputs }));
  if (s.votes && s.votes > (s.ownVotes ?? 0)) notes.push(tr("dappUi.note.votes", { count: s.votes - (s.ownVotes ?? 0) }));
  if (s.proposals) notes.push(tr("dappUi.note.proposals", { count: s.proposals }));
  if (s.donation) notes.push(tr("dappUi.note.donates", { ada: formatAda(s.donation) }));
  if (s.metadata && !s.note) notes.push(tr("dappUi.note.metadata"));

  return (
    <>
      <ReviewRows testId="dapp-tx-net">
        <Row
          label={tr(
            session
              ? net < 0n
                ? "dappUi.net.sessionSends"
                : "dappUi.net.sessionGets"
              : net < 0n
                ? "dappUi.net.accountSends"
                : "dappUi.net.accountGets",
          )}
          value={`${formatAda((net < 0n ? -net : net).toString())} ₳`}
          strong
        />
        {s.netTokens.map((t) => (
          <TokenAmountRow
            key={`${t.policyId}.${t.assetName}`}
            label={tr(BigInt(t.quantity) < 0n ? "dappUi.sends" : "dappUi.gets")}
            token={t}
            amount={amount(t)}
          />
        ))}
        {/* Rewards and a deposit back are the account's money too: counted above, and said so. */}
        {staking > 0n && (
          <Row label={tr("dappUi.fromStaking")} value={tr("dappUi.included", { ada: formatAda(s.stakingLovelace) })} />
        )}
        <Row
          label={tr("review.fee")}
          value={s.ownInputs ? tr("dappUi.included", { ada: formatAda(s.fee) }) : `${formatAda(s.fee)} ₳`}
        />
        {s.collateral && s.collateral.own > 0 && (
          <Row label={tr("swaps.tx.collateralAtRisk")} value={`${formatAda(s.collateral.atRisk)} ₳`} />
        )}
        <Row label={tr("dappUi.signsWith")} value={signers} />
      </ReviewRows>

      {s.paid.length > 0 && (
        <section className="section" aria-labelledby="dapp-paid-title">
          <h2 id="dapp-paid-title">{tr("dappUi.pays")}</h2>
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
                      <TokenAmountText token={t} amount={amount(t)} />
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lookalikes.size > 0 && (
        <Callout tone="warn" testId="dapp-lookalike">
          {joinSentences([
            tr(lookalikes.size === 1 ? "dappUi.warn.lookalike" : "dappUi.warn.lookalikes", { names: lookalikeNames }),
            tr("dappUi.warn.anyName"),
          ])}
        </Callout>
      )}
      {ownKey > 0 && (
        <Callout tone="warn" testId="dapp-own-key">
          {tr("dappUi.warn.ownKey", { count: ownKey })}
        </Callout>
      )}
      {s.paid.some((p) => p.seedelf === "none") && (
        <Callout tone="warn" testId="dapp-seedelf-unsafe">
          {tr("dappUi.warn.noRegister")}
        </Callout>
      )}
      {s.paid.some((p) => p.seedelf === "register") && (
        <Callout tone="privacy" testId="dapp-seedelf-payment">
          {tr(session ? "dappUi.privacy.paysSeedelfSession" : "dappUi.privacy.paysSeedelfAccount")}
        </Callout>
      )}
      {ties && ties.length > 0 && (
        <Callout tone="warn" testId="dapp-ties">
          {tiesLine(ties, session)}
        </Callout>
      )}

      {s.mint.length > 0 && (
        <ReviewRows testId="dapp-mint">
          {s.mint.map((t) => (
            <TokenAmountRow
              key={`${t.policyId}.${t.assetName}`}
              label={tr(BigInt(t.quantity) < 0n ? "dappUi.burns" : "dappUi.mints")}
              token={t}
              amount={amount(t)}
            />
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

      {(s.ownVotes ?? 0) > 0 && (
        <Callout tone="privacy" testId="dapp-own-votes">
          {tr("dappUi.privacy.ownVotes", { count: s.ownVotes })}
        </Callout>
      )}

      {collateralSpent && (
        <Callout tone="warn" testId="dapp-collateral-spent">
          {tr("dappUi.warn.collateralSpent")}
        </Callout>
      )}
      {s.collateral && s.collateral.own > 0 && (
        <p className="note" data-testid="dapp-collateral">
          {tr("dappUi.collateralNote", { ada: formatAda(s.collateral.atRisk) })}
        </p>
      )}

      {s.note && (
        <div className="stack-tight">
          <span className="note">{tr("dappUi.itsNote")}</span>
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
          {tr("dappUi.partial")}
        </Callout>
      )}
      {s.unknownInputs.length > 0 && (
        <Callout tone="warn" testId="dapp-unknown">
          {tr("dappUi.warn.unknownInputs", { count: s.unknownInputs.length })}
        </Callout>
      )}

      <Callout tone="privacy" testId="dapp-tx-privacy">
        {signingTies(
          ties,
          session,
          s.paid.some((p) => p.seedelf === "register"),
        )}
      </Callout>
      {/* The site built these bytes, not the wallet: this is where reading them
          matters most. It asks the worker for them while the request waits. */}
      <TxDetailButton txHash={s.txHash} testId="dapp-tx" />
    </>
  );
}

/** What a site asks the account's key to sign (CIP-8): exported for its tests. */
export function SignData({
  address,
  signer,
  payload,
  text,
}: {
  address: string;
  signer: "payment" | "stake" | "drep";
  payload: string;
  text?: string;
}) {
  const tr = useT();
  return (
    <>
      <ReviewRows testId="dapp-data">
        <Row
          label={tr("dappUi.with")}
          value={tr(signer === "stake" ? "dappUi.stakeKey" : signer === "drep" ? "dappUi.drepKey" : "dappUi.paymentKey")}
        />
      </ReviewRows>
      {/* The whole address on its own line, as the Pays rows show it: shortened, a lookalike's could read the same. */}
      <div className="stack-tight">
        <span className="note">{tr(signer === "drep" ? "dappUi.forTheDrep" : "dappUi.forTheAddress")}</span>
        <span className="dapp-address" data-testid="dapp-data-address" data-value={address}>
          {address}
        </span>
      </div>
      <div className="stack-tight">
        <span className="note">{tr(text === undefined ? "dappUi.dataHex" : "dappUi.theMessage")}</span>
        <pre className="dapp-message" data-testid="dapp-data-message">
          {text ?? payload}
        </pre>
      </div>
      <Callout tone="info" testId="dapp-data-note">
        {tr("dappUi.signDataNote")}
      </Callout>
    </>
  );
}
