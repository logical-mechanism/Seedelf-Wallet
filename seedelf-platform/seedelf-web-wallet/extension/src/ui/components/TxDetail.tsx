// The transaction view: the transaction itself, under every review and under
// the connector's sign window. Eternl is the model — a detail view with a way
// to read the CBOR.
//
// It is a modal of its own, for that one transaction, closed with Escape, a
// click around it or its Close button. Nothing of the transaction lives here:
// the worker holds the bytes and this asks for them by hash (tx-view.ts), so
// opening or closing it can't strand a signed transaction, and Send still
// sends exactly what was reviewed.
//
// What it leads with is where the value goes: what the transaction spends and
// what it pays, with the room; the fee, the validity, the certificates, the
// redeemers, the scripts and the metadata follow. The second tab is the raw
// CBOR, with a copy button, so the bytes can be taken to any other decoder.
//
// Nothing here links out. A click-through to an explorer would tell that
// explorer, from the user's own address, exactly which transaction they are
// reading — a third party that is otherwise not in this wallet's trust set at
// all. Copying the hash costs nothing and goes nowhere.

import { useEffect, useState, type ReactNode } from "react";

import type { NetworkName } from "../../networks";
import type { TxAsset, TxDetail as Detail, TxMetadatum, TxOutput, TxView } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "./Callout";
import { CopyButton } from "./CopyButton";
import { ExpandIcon, SpinnerIcon } from "./Icons";
import { Modal } from "./Modal";
import { Row, ReviewRows } from "./ReviewRows";
import { Tabs } from "./Tabs";
import { formatAda, formatQuantity, plural, shortHex } from "../format";
import { useNetwork } from "../network";
import { tokenDecimals, tokenText } from "../tokens";

/**
 * The control that opens the view, for a transaction the wallet is holding:
 * every review's, and a site's waiting for a signature. `label` names it where
 * "Transaction details" doesn't read right.
 */
export function TxDetailButton({
  txHash,
  label = "Transaction details",
  testId = "tx-detail",
}: {
  txHash: string;
  label?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="tx-detail__open">
        <button type="button" className="chip" onClick={() => setOpen(true)} data-testid={`${testId}-open`}>
          <ExpandIcon size={13} />
          {label}
        </button>
      </div>
      {open && <TxDetailModal txHash={txHash} testId={testId} onClose={() => setOpen(false)} />}
    </>
  );
}

type Tab = "transaction" | "cbor";

function TxDetailModal({ txHash, testId, onClose }: { txHash: string; testId: string; onClose: () => void }) {
  const network = useNetwork();
  const [view, setView] = useState<TxView>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("transaction");

  useEffect(() => {
    let gone = false;
    call("tx-detail", { txHash }).then(
      (answer) => !gone && setView(answer),
      (e: Error) => !gone && setError(e.message),
    );
    return () => {
      gone = true;
    };
  }, [txHash]);

  return (
    <Modal title="The transaction" titleId={`${testId}-title`} onClose={onClose}>
      <div className="stack" data-testid={testId}>
        <div className="tx-detail__hash">
          <code className="tx-detail__hash-value" data-testid={`${testId}-hash`} data-value={txHash} title={txHash}>
            {shortHex(txHash, 16, 8)}
          </code>
          <CopyButton value={txHash} label="Copy the transaction's id" />
        </div>
        {error && (
          <p className="error" role="alert" data-testid={`${testId}-error`}>
            {error}
          </p>
        )}
        {!view && !error && (
          <p className="note" data-testid={`${testId}-loading`}>
            <SpinnerIcon size={14} /> Reading it…
          </p>
        )}
        {view && (
          <>
            <Tabs<Tab>
              label="What to show of the transaction"
              prefix={`${testId}-`}
              value={tab}
              onChange={setTab}
              tabs={[
                { value: "transaction", label: "Transaction" },
                { value: "cbor", label: "Raw CBOR" },
              ]}
            />
            <div id={`${testId}-panel-${tab}`} role="tabpanel" aria-labelledby={`${testId}-tab-${tab}`} className="stack">
              {tab === "transaction" ? (
                <TxDetailBody detail={view.detail} network={network} testId={testId} />
              ) : (
                <Raw cbor={view.cbor} testId={testId} />
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** The bytes themselves, to take to any other decoder. */
function Raw({ cbor, testId }: { cbor: string; testId: string }) {
  return (
    <>
      <div className="field-row">
        <span className="note">{cbor.length / 2} bytes of CBOR, as hex</span>
        <CopyButton value={cbor} label="Copy the transaction's CBOR" />
      </div>
      <pre className="dapp-message" data-testid={`${testId}-cbor`} data-value={cbor}>
        {cbor}
      </pre>
      <p className="note">
        These are the bytes the wallet would sign and send, exactly as they are. Nothing was asked of the network to
        show them.
      </p>
    </>
  );
}

/** One section with a heading, when it has anything in it. */
function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id} className="tx-detail__heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** An outpoint, as the transaction names it. */
function Outpoints({ list, testId }: { list: Array<{ txHash: string; index: number }>; testId: string }) {
  return (
    <ul className="list" data-testid={testId}>
      {list.map((o) => (
        <li key={`${o.txHash}#${o.index}`} className="list__row">
          <code className="tx-detail__ref" data-value={`${o.txHash}#${o.index}`} title={`${o.txHash}#${o.index}`}>
            {shortHex(o.txHash, 12, 6)}#{o.index}
          </code>
          <CopyButton value={`${o.txHash}#${o.index}`} label="Copy the UTxO" />
        </li>
      ))}
    </ul>
  );
}

/** The transaction, field by field: exported for its tests. */
export function TxDetailBody({ detail: d, network, testId }: { detail: Detail; network: NetworkName; testId: string }) {
  const amount = (t: TxAsset) => {
    const q = BigInt(t.quantity);
    return formatQuantity((q < 0n ? -q : q).toString(), tokenDecimals(network, t));
  };
  const name = (t: TxAsset) => tokenText(network, t).label;
  return (
    <>
      {!d.valid && (
        <Callout tone="warn" testId={`${testId}-invalid`}>
          This transaction is marked to fail its contracts: if it is sent, its collateral is taken and its inputs stay
          where they are.
        </Callout>
      )}
      {d.unknown.length > 0 && (
        <Callout tone="warn" testId={`${testId}-unknown`}>
          It carries {plural(d.unknown.length, "field")} this version of the wallet has no name for, shown below as
          they are written. A newer Cardano, or a newer wallet, would name them.
        </Callout>
      )}

      <Section title={`Spends ${plural(d.inputs.length, "UTxO")}`} id={`${testId}-inputs`}>
        <Outpoints list={d.inputs} testId={`${testId}-input-list`} />
        <p className="note">
          What each one holds isn't in the transaction, and the wallet asks nobody: looking them up would tell whoever
          was asked which transaction you are reading.
        </p>
      </Section>

      <Section title={`Pays ${plural(d.outputs.length, "output")}`} id={`${testId}-outputs`}>
        <ul className="list" data-testid={`${testId}-output-list`}>
          {d.outputs.map((o) => (
            <Output key={o.index} output={o} amount={amount} name={name} />
          ))}
        </ul>
      </Section>

      {d.referenceInputs.length > 0 && (
        <Section title={`Reads ${plural(d.referenceInputs.length, "UTxO")}`} id={`${testId}-reference`}>
          <Outpoints list={d.referenceInputs} testId={`${testId}-reference-list`} />
          <p className="note">Read, not spent: a contract's script or its settings usually sit in one.</p>
        </Section>
      )}

      {d.collateral.length > 0 && (
        <Section title={`Collateral: ${plural(d.collateral.length, "UTxO")}`} id={`${testId}-collateral`}>
          <Outpoints list={d.collateral} testId={`${testId}-collateral-list`} />
          <ReviewRows testId={`${testId}-collateral-rows`}>
            {d.totalCollateral && <Row label="The most taken" value={`${formatAda(d.totalCollateral)} ₳`} />}
            {d.collateralReturn && (
              <Row label="Comes back" value={`${formatAda(d.collateralReturn.lovelace)} ₳`} />
            )}
          </ReviewRows>
        </Section>
      )}

      {d.mint.length > 0 && (
        <Section title="Mints and burns" id={`${testId}-mint`}>
          <ul className="list" data-testid={`${testId}-mint-list`}>
            {d.mint.map((t) => (
              <li key={`${t.policyId}.${t.assetName}`} className="list__row">
                <span className="tx-detail__name">
                  {name(t)}
                  <code className="tx-detail__ref" data-value={t.policyId} title={t.policyId}>
                    {shortHex(t.policyId, 10, 6)}
                  </code>
                </span>
                <span className="dapp-amount">
                  {BigInt(t.quantity) < 0n ? "−" : "+"}
                  {amount(t)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="The transaction" id={`${testId}-body`}>
        <ReviewRows testId={`${testId}-rows`}>
          <Row label="Network fee" value={`${formatAda(d.fee)} ₳`} strong />
          {d.validFrom !== null && <Row label="Valid from slot" value={String(d.validFrom)} />}
          {d.validUntil !== null && <Row label="Valid until slot" value={String(d.validUntil)} />}
          {d.networkId !== null && <Row label="Network" value={d.networkId === 1 ? "Mainnet" : "A test network"} />}
          <Row label="Size" value={`${d.size} bytes (${d.bodySize} of body)`} />
          {/* What matters is whether anything has signed it, not what else the
              witness set carries: a transaction with its redeemers and no
              signature is unsigned. */}
          <Row
            label="Signed"
            value={d.signatures.length ? `${plural(d.signatures.length, "signature")} so far` : "Not yet"}
          />
          {d.scriptDataHash && (
            <Row label="Script data hash" value={shortHex(d.scriptDataHash, 10, 6)} title={d.scriptDataHash} />
          )}
          {d.auxiliaryDataHash && (
            <Row label="Metadata hash" value={shortHex(d.auxiliaryDataHash, 10, 6)} title={d.auxiliaryDataHash} />
          )}
          {d.donation && <Row label="To the treasury" value={`${formatAda(d.donation)} ₳`} />}
          {d.treasuryValue && <Row label="The treasury, as it says" value={`${formatAda(d.treasuryValue)} ₳`} />}
        </ReviewRows>
      </Section>

      {d.certificates.length > 0 && (
        <Section title={plural(d.certificates.length, "Certificate")} id={`${testId}-certs`}>
          <ul className="list" data-testid={`${testId}-cert-list`}>
            {d.certificates.map((c, i) => (
              <li key={i} className="list__row tx-detail__wrap">
                <span className="tx-detail__name">{certificateWords(c.kind)}</span>
                <span className="dapp-amount">
                  {c.deposit && `${formatAda(c.deposit)} ₳ deposit`}
                  {c.refund && `${formatAda(c.refund)} ₳ back`}
                </span>
                {(c.pool || c.drep || c.credential || c.cold) && (
                  <span className="dapp-address">
                    {[c.pool, c.drep, c.credential?.hash, c.cold?.hash].filter(Boolean).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {d.withdrawals.length > 0 && (
        <Section title="Withdraws rewards" id={`${testId}-withdrawals`}>
          <ul className="list" data-testid={`${testId}-withdrawal-list`}>
            {d.withdrawals.map((w) => (
              <li key={w.address} className="list__row dapp-paid">
                <span className="dapp-address" data-value={w.address}>
                  {w.address}
                </span>
                <span className="dapp-amount">{formatAda(w.lovelace)} ₳</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(d.votes.length > 0 || d.proposals.length > 0) && (
        <Section title="Governance" id={`${testId}-governance`}>
          <ul className="list" data-testid={`${testId}-governance-list`}>
            {d.votes.map((v, i) => (
              <li key={`v${i}`} className="list__row tx-detail__wrap">
                <span className="tx-detail__name">
                  Votes {v.vote} as a {v.voter === "drep" ? "DRep" : v.voter === "pool" ? "stake pool" : "committee member"}
                </span>
                <span className="dapp-address">
                  {v.action.txHash}#{v.action.index}
                </span>
              </li>
            ))}
            {d.proposals.map((p, i) => (
              <li key={`p${i}`} className="list__row tx-detail__wrap">
                <span className="tx-detail__name">Proposes {proposalWords(p.action)}</span>
                <span className="dapp-amount">{formatAda(p.deposit)} ₳ deposit</span>
                <span className="dapp-address">{p.anchor.url}</span>
                {p.parameters.length > 0 && (
                  <span className="note">
                    {plural(p.parameters.length, "protocol parameter")}:{" "}
                    {p.parameters.map((u) => u.field).join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(d.redeemers.length > 0 || d.scripts.length > 0 || d.datums.length > 0 || d.requiredSigners.length > 0) && (
        <Section title="Contracts" id={`${testId}-contracts`}>
          {d.redeemers.length > 0 && (
            <ul className="list" data-testid={`${testId}-redeemer-list`}>
              {d.redeemers.map((r, i) => (
                <li key={i} className="list__row tx-detail__wrap">
                  <span className="tx-detail__name">
                    Runs a {redeemerWords(r.tag)} script, number {r.index}
                  </span>
                  <span className="dapp-amount">
                    {r.mem.toLocaleString()} mem · {r.steps.toLocaleString()} steps
                  </span>
                  <span className="dapp-address" data-value={r.data}>
                    {shortHex(r.data, 24, 12)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d.scripts.length > 0 && (
            <ul className="list" data-testid={`${testId}-script-list`}>
              {d.scripts.map((s, i) => (
                <li key={`${s.hash}${i}`} className="list__row tx-detail__wrap">
                  <span className="tx-detail__name">
                    {scriptWords(s.kind)}, {s.size} bytes, {scriptWhere(s.source)}
                  </span>
                  <CopyButton value={s.hash} label="Copy the script's hash" />
                  <code className="dapp-address" data-value={s.hash}>
                    {s.hash}
                  </code>
                </li>
              ))}
            </ul>
          )}
          {d.datums.length > 0 && (
            <ul className="list" data-testid={`${testId}-datum-list`}>
              {d.datums.map((datum) => (
                <li key={datum.hash} className="list__row tx-detail__wrap">
                  <span className="tx-detail__name">A datum, {datum.hex.length / 2} bytes</span>
                  <CopyButton value={datum.hex} label="Copy the datum" />
                  <code className="dapp-address" data-value={datum.hash}>
                    {datum.hash}
                  </code>
                </li>
              ))}
            </ul>
          )}
          {d.requiredSigners.length > 0 && (
            <ReviewRows testId={`${testId}-signers`}>
              {d.requiredSigners.map((hash) => (
                <Row key={hash} label="Must be signed by" value={shortHex(hash, 10, 6)} title={hash} />
              ))}
            </ReviewRows>
          )}
          <p className="note">
            The wallet shows a script by its hash, its kind and its size. It doesn't take one apart: what a contract
            does is its code, and reading that here would say more than it could prove.
          </p>
        </Section>
      )}

      {d.note && (
        <Section title="Its note" id={`${testId}-note`}>
          <pre className="dapp-message" data-testid={`${testId}-note-text`}>
            {d.note.join("\n")}
          </pre>
          <p className="note">A message on the transaction (CIP-20), which anyone can read.</p>
        </Section>
      )}

      {d.metadata.length > 0 && (
        <Section title="Metadata" id={`${testId}-metadata`}>
          <ul className="list" data-testid={`${testId}-metadata-list`}>
            {d.metadata.map((m) => (
              <li key={m.label} className="list__row tx-detail__wrap">
                <span className="tx-detail__name">Label {m.label}</span>
                <div className="tx-detail__tree">
                  <Metadatum value={m.value} />
                </div>
              </li>
            ))}
          </ul>
          <p className="note">Metadata is in the open: anyone reading the chain can read it.</p>
        </Section>
      )}

      {d.unknown.length > 0 && (
        <Section title="Not named by this wallet" id={`${testId}-unknown-fields`}>
          <ul className="list" data-testid={`${testId}-unknown-list`}>
            {d.unknown.map((u, i) => (
              <li key={i} className="list__row tx-detail__wrap">
                <span className="tx-detail__name">
                  {u.at === "body" ? "The body's" : u.at === "witnesses" ? "The witness set's" : "The metadata's"} field{" "}
                  {u.field}
                </span>
                <CopyButton value={u.hex} label="Copy the field" />
                <code className="dapp-address" data-value={u.hex}>
                  {u.hex}
                </code>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/** One output: the whole address on its own line, then what goes there. */
function Output({
  output: o,
  amount,
  name,
}: {
  output: TxOutput;
  amount: (t: TxAsset) => string;
  name: (t: TxAsset) => string;
}) {
  return (
    <li className="list__row dapp-paid">
      <span className="dapp-address" data-value={o.address.bech32}>
        {o.address.bech32}
      </span>
      <span className="note">
        {`#${o.index} · ${addressWords(o.address.kind, o.address.payment)}`}
        {o.address.seedelf && " · Seedelf Wallet's contract"}
        {o.register && (o.register.payable ? " · under a register" : " · a register nobody could spend")}
        {o.inlineDatum && !o.register && " · with a datum"}
        {o.datumHash && " · names a datum by its hash"}
        {o.scriptRef && ` · carries a ${scriptWords(o.scriptRef.kind)}`}
      </span>
      <span className="dapp-amount">
        {formatAda(o.lovelace)} ₳
        {o.assets.map((t) => (
          // The name can be anyone's choice, so the policy and the name in hex
          // stay within reach of it.
          <span key={`${t.policyId}.${t.assetName}`} className="note" title={`${t.policyId}.${t.assetName}`}>
            {amount(t)} {name(t)}
          </span>
        ))}
      </span>
    </li>
  );
}

/** A metadatum, as the tree it is. */
function Metadatum({ value }: { value: TxMetadatum }) {
  switch (value.type) {
    case "int":
      return <code className="tx-detail__leaf">{value.value}</code>;
    case "text":
      return <span className="tx-detail__leaf">{value.text}</span>;
    case "bytes":
      return (
        <code className="tx-detail__leaf" data-value={value.hex} title={value.hex}>
          {value.text ?? shortHex(value.hex, 16, 8)}
        </code>
      );
    case "list":
      return (
        <ul className="tx-detail__branch">
          {value.items.map((item, i) => (
            <li key={i}>
              <Metadatum value={item} />
            </li>
          ))}
        </ul>
      );
    case "map":
      return (
        <ul className="tx-detail__branch">
          {value.entries.map((entry, i) => (
            <li key={i}>
              <span className="tx-detail__key">
                <Metadatum value={entry.key} />
              </span>
              <Metadatum value={entry.value} />
            </li>
          ))}
        </ul>
      );
  }
}

/** A certificate's kind in words. An unknown one is shown as it came. */
export function certificateWords(kind: string): string {
  const words: Record<string, string> = {
    stakeRegistration: "Registers a stake key (the old way)",
    stakeDeregistration: "Stops a stake key's staking (the old way)",
    stakeDelegation: "Stakes with a pool",
    poolRegistration: "Registers a stake pool, or its new terms",
    poolRetirement: "Retires a stake pool",
    registration: "Registers a stake key",
    deregistration: "Stops a stake key's staking",
    voteDelegation: "Delegates the vote",
    stakeVoteDelegation: "Stakes with a pool and delegates the vote",
    stakeRegistrationDelegation: "Registers a stake key and stakes with a pool",
    voteRegistrationDelegation: "Registers a stake key and delegates the vote",
    stakeVoteRegistrationDelegation: "Registers a stake key, stakes with a pool and delegates the vote",
    committeeHotAuth: "Authorises a committee hot key",
    committeeColdResign: "Resigns a committee cold key",
    drepRegistration: "Registers a DRep",
    drepDeregistration: "Retires a DRep",
    drepUpdate: "Updates a DRep",
  };
  return words[kind] ?? kind;
}

/** A governance action's kind in words. */
export function proposalWords(action: string): string {
  const words: Record<string, string> = {
    parameterChange: "a protocol parameter change",
    hardFork: "a hard fork",
    treasuryWithdrawals: "withdrawals from the treasury",
    noConfidence: "no confidence in the committee",
    updateCommittee: "a change to the committee",
    newConstitution: "a new constitution",
    information: "information, which changes nothing",
  };
  return words[action] ?? action;
}

/** What a redeemer's tag is for. */
export function redeemerWords(tag: string): string {
  const words: Record<string, string> = {
    spend: "spending",
    mint: "minting",
    cert: "certificate",
    reward: "withdrawal",
    vote: "voting",
    propose: "proposal",
  };
  return words[tag] ?? `tag ${tag}`;
}

export function scriptWords(kind: string): string {
  return kind === "native" ? "native script" : `Plutus ${kind.replace("plutus", "")} script`;
}

function scriptWhere(source: string): string {
  return source === "output" ? "in an output" : source === "metadata" ? "in the metadata" : "in the witness set";
}

/** What an address is, from its own bytes. */
export function addressWords(kind: string, payment: string | null): string {
  if (kind === "byron") return "a Byron address";
  if (kind === "reward") return "a reward address";
  const who = payment === "script" ? "a contract" : "a key";
  const where = kind === "base" ? " that stakes" : kind === "pointer" ? " with a pointer" : "";
  return `${who}${where}`;
}
