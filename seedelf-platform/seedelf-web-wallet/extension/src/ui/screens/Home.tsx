// Home, in two tabs. Seedelf: the Seedelf balance, its tokens and your
// seedelfs. Cardano account: the account's balance and tokens, Receive and
// Move in. Until the wallet has a seedelf and a Seedelf
// balance, a checklist shows the order that keeps them apart: fund the
// account, create the seedelf, then move in (privacy.md, mint first).
// Balances come from the worker's last reading; it reads the chain again
// when that is over a minute old, or on Refresh. A sent move-in, seedelf
// mint, transfer, withdrawal or removal shows as a banner until the network
// confirms it.

import { useCallback, useEffect, useState } from "react";

import type { Account, Balances, PendingTx, SeedelfInfo } from "../../shared/rpc";
import { call } from "../background";
import { ActionButton } from "../components/ActionButton";
import { Callout } from "../components/Callout";
import { CopyButton } from "../components/CopyButton";
import { Splash, useSplash } from "../components/Splash";
import {
  DoneIcon,
  ExternalIcon,
  InfoIcon,
  MoveInIcon,
  ReceiveIcon,
  RefreshIcon,
  SendIcon,
  SpinnerIcon,
  SproutIcon,
  TrashIcon,
  WithdrawIcon,
} from "../components/Icons";
import { Tabs } from "../components/Tabs";
import { TokenList } from "../components/TokenList";
import { explorerUrl, formatAda, plural, shortHex, timeAgo } from "../format";
import { CreateSeedelf } from "./CreateSeedelf";
import { MoveIn } from "./MoveIn";
import { Receive } from "./Receive";
import { RemoveSeedelf } from "./RemoveSeedelf";
import { Tokens } from "./Tokens";
import { Transfer } from "./Transfer";
import { Withdraw } from "./Withdraw";

/** How the banner names a sent transaction, and says it's confirmed. */
const SENT: Record<PendingTx["kind"], string> = {
  "move-in": "Move-in",
  mint: "Seedelf mint",
  transfer: "Transfer",
  withdraw: "Withdrawal",
  remove: "Seedelf removal",
};
const CONFIRMED: Record<PendingTx["kind"], string> = {
  "move-in": "Move-in confirmed",
  mint: "Seedelf created",
  transfer: "Transfer confirmed",
  withdraw: "Withdrawal confirmed",
  remove: "Seedelf removed",
};

/** Read again on open when the last reading is older than this. */
const STALE_MS = 60_000;
/** How often to ask about a sent transaction. */
const WATCH_EVERY_MS = 15_000;

type Tab = "seedelf" | "cardano";

const BUSY = "Wait for the last transaction to confirm";

export function Home() {
  const [account, setAccount] = useState<Account>();
  const [balances, setBalances] = useState<Balances>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const [tab, setTab] = useState<Tab>("seedelf");
  const [screen, setScreen] = useState<"home" | "receive" | "move-in" | "create" | "transfer" | "withdraw">("home");
  const [removing, setRemoving] = useState<SeedelfInfo>();
  const [tokensOf, setTokensOf] = useState<Tab>();
  const [pending, setPending] = useState<PendingTx | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setReading(true);
    try {
      const b = await call("balances", { refresh });
      setBalances(b);
      setError(undefined);
      return b;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setReading(false);
      setNow(Date.now());
    }
  }, []);

  // Ask about the sent transaction; once it's confirmed, read the balances again.
  const watch = useCallback(async () => {
    try {
      const p = await call("pending-tx", {});
      if (!p) return;
      setPending(p);
      if (p.confirmations !== null) void load(true);
    } catch {
      // Koios hiccup: try again on the next tick.
    }
  }, [load]);

  useEffect(() => {
    call("account", {}).then(setAccount, (e: Error) => setError(e.message));
    void load(false).then((b) => {
      if (b && Date.now() - b.updatedAt > STALE_MS) void load(true);
    });
    void watch();
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(tick);
  }, [load, watch]);

  // Until the first reading (or its error), a splash covers the empty balances.
  const splash = useSplash(balances !== undefined || error !== undefined);

  const watching = pending !== null && pending.confirmations === null && now - pending.submittedAt < 10 * 60_000;
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => void watch(), WATCH_EVERY_MS);
    return () => clearInterval(timer);
  }, [watching, watch]);

  const sent = (p: PendingTx) => {
    setPending(p);
    setScreen("home");
    setRemoving(undefined);
  };
  const home = () => setScreen("home");
  if (screen === "receive" && account) return <Receive account={account} onBack={home} />;
  if (screen === "move-in" && balances) return <MoveIn cardano={balances.cardano} onCancel={home} onSent={sent} />;
  if (screen === "create" && balances) return <CreateSeedelf balances={balances} onCancel={home} onSent={sent} />;
  if (screen === "transfer" && balances) return <Transfer seedelf={balances.seedelf} onCancel={home} onSent={sent} />;
  if (screen === "withdraw" && balances) return <Withdraw seedelf={balances.seedelf} onCancel={home} onSent={sent} />;
  if (removing) {
    return <RemoveSeedelf seedelf={removing} onCancel={() => setRemoving(undefined)} onSent={sent} />;
  }
  if (tokensOf && balances) {
    const back = () => setTokensOf(undefined);
    return <Tokens network={balances.network} tokens={balances[tokensOf].tokens} of={tokensOf} onBack={back} />;
  }

  const seedelfs = balances?.seedelf.seedelfs ?? [];
  const canSpend = !!balances && balances.seedelf.utxos > 0 && !watching;
  const spendTitle = watching
    ? BUSY
    : balances && balances.seedelf.utxos === 0
      ? "Move some ADA in first: these are paid from your Seedelf balance"
      : undefined;
  const canCreate = !!balances && (balances.cardano.utxos > 0 || balances.seedelf.utxos > 0) && !watching;
  const createTitle = watching ? BUSY : balances && !canCreate ? "Fund your Cardano account first: it pays for the seedelf" : undefined;
  const canMoveIn = !!balances && balances.cardano.utxos > 0 && !watching;

  return (
    <>
      <Splash phase={splash} />
      <div className={splash === "wait" || splash === "show" ? "home home--hidden" : "home"}>
        {error && (
          <Callout tone="warn" role="alert">
            <div className="stack-tight">
              <strong>Couldn't read your balances</strong>
              <span>{error}</span>
              <button type="button" className="link align-start" onClick={() => void load(true)} disabled={reading}>
                {reading ? "Trying…" : "Try again"}
              </button>
            </div>
          </Callout>
        )}
        {pending && <Pending pending={pending} watching={watching} onDismiss={() => setPending(null)} />}

        <Tabs
          label="Balances"
          tabs={[
            { value: "seedelf", label: "Seedelf" },
            { value: "cardano", label: "Cardano account" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {/* Each panel has its own key, so its buttons are new, not restyled Seedelf ones. */}
        {tab === "seedelf" ? (
          <section key="seedelf" className="stack" role="tabpanel" id="panel-seedelf" aria-labelledby="tab-seedelf">
            <div className="hero">
              <h1 id="seedelf-balance" className="hero__label">
                Seedelf balance
              </h1>
              <Amount lovelace={balances?.seedelf.lovelace} testId="seedelf-lovelace" />
              <span className="hero__meta">{balances ? plural(balances.seedelf.utxos, "UTxO") : "\u00a0"}</span>
              <div className="hero__actions">
                <ActionButton
                  primary
                  icon={<SendIcon />}
                  label="Send"
                  name="Send to a seedelf"
                  onClick={() => setScreen("transfer")}
                  disabled={!canSpend}
                  title={spendTitle}
                />
                <ActionButton
                  icon={<WithdrawIcon />}
                  label="Withdraw"
                  onClick={() => setScreen("withdraw")}
                  disabled={!canSpend}
                  title={spendTitle}
                />
                <ActionButton
                  icon={<SproutIcon />}
                  label="Create"
                  name="Create a seedelf"
                  onClick={() => setScreen("create")}
                  disabled={!canCreate}
                  title={createTitle}
                />
              </div>
            </div>

            {balances && (seedelfs.length === 0 || balances.seedelf.utxos === 0) && (
              <GettingStarted
                balances={balances}
                watching={watching}
                onReceive={() => {
                  setTab("cardano");
                  setScreen("receive");
                }}
                onCreate={() => setScreen("create")}
                onMoveIn={() => setScreen("move-in")}
              />
            )}

            {balances && balances.seedelf.tokens.length > 0 && (
              <section className="section" aria-labelledby="seedelf-tokens-title">
                <h2 id="seedelf-tokens-title">Tokens</h2>
                <TokenList
                  network={balances.network}
                  tokens={balances.seedelf.tokens}
                  testId="seedelf-tokens"
                  onViewAll={() => setTokensOf("seedelf")}
                />
              </section>
            )}

            {seedelfs.length > 0 && (
              <section className="section" aria-labelledby="your-seedelfs">
                <h2 id="your-seedelfs">Your seedelfs</h2>
                <ul className="list" data-testid="seedelfs">
                  {seedelfs.map((s) => (
                    <li key={s.assetName} className="list__row" title={s.assetName}>
                      <span className="list__name">{s.label ?? "Unnamed"}</span>
                      <span className="list__value">{formatAda(s.lovelace)} ₳</span>
                      <code className="list__sub">{shortHex(s.assetName, 12, 6)}</code>
                      <span className="list__actions">
                        <CopyButton value={s.assetName} label={`Copy the name of ${s.label ?? "this seedelf"}`} />
                        <button
                          type="button"
                          className="icon-button icon-button--small"
                          aria-label={`Remove ${s.label ?? "this seedelf"}`}
                          onClick={() => setRemoving(s)}
                          disabled={watching}
                          title={watching ? BUSY : "Remove this seedelf"}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="note">Copy a seedelf's full name to give to anyone who wants to pay you.</p>
              </section>
            )}
          </section>
        ) : (
          <section key="cardano" className="stack" role="tabpanel" id="panel-cardano" aria-labelledby="tab-cardano">
            <div className="hero">
              <h1 id="cardano-account" className="hero__label">
                Cardano account
              </h1>
              <Amount lovelace={balances?.cardano.lovelace} testId="cardano-lovelace" />
              <span className="hero__meta">
                {balances ? `${plural(balances.cardano.addressesUsed, "address", "addresses")} used` : "\u00a0"}
              </span>
              <div className="hero__actions">
                <ActionButton
                  icon={<ReceiveIcon />}
                  label="Receive"
                  onClick={() => setScreen("receive")}
                  disabled={!account}
                />
                <ActionButton
                  primary
                  icon={<MoveInIcon />}
                  label="Move in"
                  onClick={() => setScreen("move-in")}
                  disabled={!canMoveIn}
                  title={watching ? BUSY : undefined}
                />
              </div>
            </div>

            {balances && seedelfs.length === 0 && (
              <Callout tone="privacy" testId="mint-first">
                Create your seedelf before moving money in: then what you move in isn't tied to it.
              </Callout>
            )}

            {balances && balances.cardano.tokens.length > 0 && (
              <section className="section" aria-labelledby="cardano-tokens-title">
                <h2 id="cardano-tokens-title">Tokens</h2>
                <TokenList
                  network={balances.network}
                  tokens={balances.cardano.tokens}
                  testId="cardano-tokens"
                  onViewAll={() => setTokensOf("cardano")}
                />
              </section>
            )}
          </section>
        )}

        <div className="refresh-row">
          <span className="note" data-testid="updated">
            {reading ? "Reading the chain…" : balances ? `Updated ${timeAgo(balances.updatedAt, now)}` : ""}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={() => void load(true)}
            disabled={reading}
            aria-label="Refresh"
            title="Read the chain again"
          >
            <span className={reading ? "spin" : "icon"}>
              <RefreshIcon size={15} />
            </span>
          </button>
        </div>
      </div>
    </>
  );
}

/** The order that keeps a new wallet's seedelf apart from what it moves in. */
function GettingStarted({
  balances,
  watching,
  onReceive,
  onCreate,
  onMoveIn,
}: {
  balances: Balances;
  watching: boolean;
  onReceive: () => void;
  onCreate: () => void;
  onMoveIn: () => void;
}) {
  const created = balances.seedelf.seedelfs.length > 0;
  const movedIn = balances.seedelf.utxos > 0;
  const funded = balances.cardano.utxos > 0 || created || movedIn;
  const steps = [
    {
      done: funded,
      title: "Fund your Cardano account",
      text: "Pay it from an exchange or another wallet.",
      action: "Receive",
      onClick: onReceive,
      disabled: false,
    },
    {
      done: created,
      title: "Create your seedelf",
      text: "Your Cardano account pays for it, before any money moves in.",
      action: "Create",
      onClick: onCreate,
      disabled: watching || !funded,
    },
    {
      done: movedIn,
      title: "Move ADA in",
      text: "What you move in afterwards isn't tied to your seedelf.",
      action: "Move in",
      onClick: onMoveIn,
      disabled: watching || balances.cardano.utxos === 0,
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <section className="section" aria-labelledby="getting-started">
      <h2 id="getting-started">Get started</h2>
      <ol className="steps" data-testid="getting-started">
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? "step step--done" : "step"}>
            <span className="step__icon">
              {s.done ? <DoneIcon size={20} /> : <span className="step__n">{i + 1}</span>}
            </span>
            <span className="step__title">
              {s.title}
              {s.done && <span className="sr-only"> (done)</span>}
            </span>
            {i === current ? (
              <button
                type="button"
                className="chip"
                onClick={s.onClick}
                disabled={s.disabled}
                title={watching && s.disabled ? BUSY : undefined}
              >
                {s.action}
              </button>
            ) : (
              <span />
            )}
            <p className="step__text">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Pending({ pending, watching, onDismiss }: { pending: PendingTx; watching: boolean; onDismiss: () => void }) {
  const confirmed = pending.confirmations !== null;
  const what = SENT[pending.kind];
  return (
    <section className={confirmed ? "callout callout--done" : "callout"} role="status" data-testid="pending-tx">
      <span className="callout__icon">
        {confirmed ? (
          <DoneIcon size={16} />
        ) : watching ? (
          <span className="spin">
            <SpinnerIcon size={16} />
          </span>
        ) : (
          <InfoIcon size={16} />
        )}
      </span>
      <div className="callout__body banner">
        <strong>
          {confirmed
            ? CONFIRMED[pending.kind]
            : watching
              ? `${what} sent. Waiting for the network…`
              : `${what} not confirmed yet`}
        </strong>
        <a href={explorerUrl(pending.network, pending.txHash)} target="_blank" rel="noreferrer" className="banner__link">
          {shortHex(pending.txHash, 10, 6)} on Cardanoscan
          <ExternalIcon size={12} />
        </a>
        {!watching && (
          <button type="button" className="link align-start" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </section>
  );
}

function Amount({ lovelace, testId }: { lovelace?: string; testId: string }) {
  return (
    <p className="amount" data-testid={testId}>
      {lovelace === undefined ? <span className="amount__placeholder">—</span> : formatAda(lovelace)}
      <span className="amount__unit"> ₳</span>
    </p>
  );
}
