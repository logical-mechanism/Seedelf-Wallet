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
import { type I18nKey, t, useT } from "../../i18n";

import type { NetworkName } from "../../networks";
import type { TxAsset, TxDetail as Detail, TxMetadatum, TxOutpoint, TxOutput, TxView } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "./Callout";
import { CopyButton } from "./CopyButton";
import { HintButton, HintText, useHint } from "./Hint";
import { PlutusTree } from "./PlutusTree";
import { ExpandIcon, SpinnerIcon } from "./Icons";
import { Modal } from "./Modal";
import { Row, ReviewRows } from "./ReviewRows";
import { Tabs } from "./Tabs";
import { formatAda, formatQuantity, shortHex } from "../format";
import { useNetwork } from "../network";
import { tokenDecimals, tokenText } from "../tokens";

/**
 * The control that opens the view, for a transaction the wallet is holding:
 * every review's, and a site's waiting for a signature. `label` names it where
 * "Transaction details" doesn't read right.
 */
export function TxDetailButton({
  txHash,
  label,
  testId = "tx-detail",
}: {
  txHash: string;
  label?: string;
  testId?: string;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="tx-detail__open">
        <button type="button" className="chip" onClick={() => setOpen(true)} data-testid={`${testId}-open`}>
          <ExpandIcon size={13} />
          {label ?? tr("tx.detailsButton")}
        </button>
      </div>
      {open && <TxDetailModal txHash={txHash} testId={testId} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * What the button says where a chain's first transaction is the one shown. It
 * can't be "Transaction details" when the review counts twelve of them: the
 * review shows the one the money goes in through, and names it (the owner,
 * 2026-10-01). A chain of one — a seed, a deposit with no mixes — is just its
 * transaction, so it keeps the plain label.
 */
export function entryLabel({ txs, again }: { txs: number; again?: boolean }): string | undefined {
  if (txs <= 1) return undefined;
  // Mixing its own boxes again puts nothing in: it begins at the first mix.
  return t(again ? "tx.entry.firstMix" : "tx.entry.deposit");
}

type Tab = "transaction" | "cbor";

function TxDetailModal({ txHash, testId, onClose }: { txHash: string; testId: string; onClose: () => void }) {
  const tr = useT();
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
    <Modal title={tr("tx.title")} titleId={`${testId}-title`} onClose={onClose}>
      <div className="stack" data-testid={testId}>
        {/* The id of the bytes shown, worked out from them, once they're here:
            the hash the view was asked for until then. They are the same for
            anything the wallet holds, and this way the id can't be one thing
            while the bytes under it are another. */}
        <div className="tx-detail__hash">
          <code
            className="tx-detail__hash-value"
            data-testid={`${testId}-hash`}
            data-value={view?.detail.txHash ?? txHash}
            title={view?.detail.txHash ?? txHash}
          >
            {shortHex(view?.detail.txHash ?? txHash, 16, 8)}
          </code>
          <CopyButton value={view?.detail.txHash ?? txHash} label={tr("tx.copyId")} />
        </div>
        {error && (
          <p className="error" role="alert" data-testid={`${testId}-error`}>
            {error}
          </p>
        )}
        {!view && !error && (
          <p className="note" data-testid={`${testId}-loading`}>
            <SpinnerIcon size={14} /> {tr("destination.reading")}
          </p>
        )}
        {view && (
          <>
            <Tabs<Tab>
              label={tr("tx.tabsLabel")}
              prefix={`${testId}-`}
              value={tab}
              onChange={setTab}
              tabs={[
                { value: "transaction", label: tr("tx.tab.transaction") },
                { value: "cbor", label: tr("tx.tab.cbor") },
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

/** What the raw bytes are, behind the icon beside them. */
const rawHint = () => t("tx.rawHint");

/** The bytes themselves, to take to any other decoder. */
function Raw({ cbor, testId }: { cbor: string; testId: string }) {
  const tr = useT();
  const { open, toggle, id } = useHint();
  return (
    <>
      <div className="field-row">
        <span className="note">{tr("tx.cborBytes", { bytes: cbor.length / 2 })}</span>
        <span className="tx-detail__head">
          <HintButton
            text={rawHint()}
            open={open}
            onToggle={toggle}
            controls={id}
            testId={`${testId}-cbor-hint`}
          />
          <CopyButton value={cbor} label={tr("tx.copyCbor")} />
        </span>
      </div>
      {open && <HintText text={rawHint()} id={id} testId={`${testId}-cbor-note`} />}
      <pre className="dapp-message" data-testid={`${testId}-cbor`} data-value={cbor}>
        {cbor}
      </pre>
    </>
  );
}

/**
 * One section with a heading, and what it holds. `hint` is the paragraph that
 * explains it: it sits behind an icon in the heading rather than under the rows,
 * where a few of them together crowded out what the section was for (the owner,
 * 2026-10-01). Hovering the icon shows it; clicking puts it on the page.
 */
function Section({ title, id, hint, children }: { title: string; id: string; hint?: string; children: ReactNode }) {
  const { open, toggle, id: hintId } = useHint();
  return (
    <section className="section" aria-labelledby={id}>
      <div className="tx-detail__head">
        <h2 id={id} className="tx-detail__heading">
          {title}
        </h2>
        {hint && <HintButton text={hint} open={open} onToggle={toggle} controls={hintId} testId={`${id}-hint`} />}
      </div>
      {hint && open && <HintText text={hint} id={hintId} testId={`${id}-hint-text`} />}
      {children}
    </section>
  );
}

/**
 * The outpoints of a list, as the transaction names them. Keyed by position:
 * nothing stops a transaction naming the same UTxO twice, and two rows sharing
 * a key would render as one.
 */
function Outpoints({ list, testId }: { list: TxOutpoint[]; testId: string }) {
  const tr = useT();
  return (
    <ul className="list" data-testid={testId}>
      {list.map((o, i) => (
        <li key={i} className="list__row">
          <code className="tx-detail__ref" data-value={`${o.txHash}#${o.index}`} title={`${o.txHash}#${o.index}`}>
            {shortHex(o.txHash, 12, 6)}#{o.index}
          </code>
          <CopyButton value={`${o.txHash}#${o.index}`} label={tr("tx.copyUtxo")} />
        </li>
      ))}
    </ul>
  );
}

/** The transaction, field by field: exported for its tests. */
export function TxDetailBody({ detail: d, network, testId }: { detail: Detail; network: NetworkName; testId: string }) {
  const tr = useT();
  const amount = (t: TxAsset) => {
    const q = BigInt(t.quantity);
    return formatQuantity((q < 0n ? -q : q).toString(), tokenDecimals(network, t));
  };
  const name = (t: TxAsset) => tokenText(network, t).label;
  return (
    <>
      {!d.valid && (
        <Callout tone="warn" testId={`${testId}-invalid`}>
          {tr("tx.warn.invalid")}
        </Callout>
      )}
      {d.metadataHashMatches === false && (
        <Callout tone="warn" testId={`${testId}-metadata-hash`}>
          {tr("tx.warn.metadataHash")}
        </Callout>
      )}
      {d.unknown.length > 0 && (
        <Callout tone="warn" testId={`${testId}-unknown`}>
          {tr("tx.warn.unknownFields", { count: d.unknown.length })}
        </Callout>
      )}

      <Section
        title={tr("tx.spends", { count: d.inputs.length })}
        id={`${testId}-inputs`}
        hint={tr("tx.privacy.inputsHint")}
      >
        <Outpoints list={d.inputs} testId={`${testId}-input-list`} />
      </Section>

      <Section title={tr("tx.paysOutputs", { count: d.outputs.length })} id={`${testId}-outputs`}>
        <ul className="list" data-testid={`${testId}-output-list`}>
          {d.outputs.map((o, i) => (
            <Output key={i} output={o} amount={amount} name={name} />
          ))}
        </ul>
      </Section>

      {d.referenceInputs.length > 0 && (
        <Section
          title={tr("tx.reads", { count: d.referenceInputs.length })}
          id={`${testId}-reference`}
          hint={tr("tx.referenceHint")}
        >
          <Outpoints list={d.referenceInputs} testId={`${testId}-reference-list`} />
        </Section>
      )}

      {(d.collateral.length > 0 || d.collateralReturn || d.totalCollateral) && (
        <Section
          title={d.collateral.length ? tr("tx.collateralCount", { count: d.collateral.length }) : tr("utxos.tag.collateral")}
          id={`${testId}-collateral`}
        >
          {d.collateral.length > 0 && <Outpoints list={d.collateral} testId={`${testId}-collateral-list`} />}
          <ReviewRows testId={`${testId}-collateral-rows`}>
            {d.totalCollateral && <Row label={tr("tx.mostTaken")} value={`${formatAda(d.totalCollateral)} ₳`} />}
            {d.collateralReturn && (
              <Row label={tr("tx.comesBack")} value={`${formatAda(d.collateralReturn.lovelace)} ₳`} />
            )}
          </ReviewRows>
        </Section>
      )}

      {d.mint.length > 0 && (
        <Section title={tr("tx.mints")} id={`${testId}-mint`}>
          <ul className="list" data-testid={`${testId}-mint-list`}>
            {d.mint.map((t, i) => (
              <li key={i} className="list__row">
                <span className="tx-detail__name">
                  {name(t)}
                  <span className="tx-detail__line">
                    <code className="tx-detail__ref" data-value={t.policyId} title={t.policyId}>
                      {shortHex(t.policyId, 10, 6)}
                    </code>
                    <CopyButton value={t.policyId} label={tr("tx.copyPolicyId")} />
                  </span>
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

      <Section title={tr("tx.title")} id={`${testId}-body`}>
        <ReviewRows testId={`${testId}-rows`}>
          <Row label={tr("review.fee")} value={`${formatAda(d.fee)} ₳`} strong />
          {d.validFrom !== null && <Row label={tr("tx.validFrom")} value={d.validFrom} />}
          {d.validUntil !== null && <Row label={tr("tx.validUntil")} value={d.validUntil} />}
          {d.networkId !== null && <Row label={tr("network.label")} value={d.networkId === 1 ? "Mainnet" : tr("tx.testNetwork")} />}
          <Row label={tr("tx.size")} value={tr("tx.sizeValue", { size: d.size, body: d.bodySize })} />
          {/* What matters is whether anything has signed it, not what else the
              witness set carries: a transaction with its redeemers and no
              signature is unsigned. */}
          <Row
            label={tr("tx.signed")}
            value={d.signatures.length ? tr("tx.signaturesSoFar", { count: d.signatures.length }) : tr("tx.notYet")}
          />
          {d.bootstrapWitnesses > 0 && (
            <Row label={tr("tx.byronWitnesses")} value={tr("tx.witnessCount", { count: d.bootstrapWitnesses })} />
          )}
          {d.scriptDataHash && (
            <Row label={tr("tx.scriptDataHash")} value={shortHex(d.scriptDataHash, 10, 6)} title={d.scriptDataHash} />
          )}
          {d.auxiliaryDataHash && (
            <Row label={tr("tx.metadataHash")} value={shortHex(d.auxiliaryDataHash, 10, 6)} title={d.auxiliaryDataHash} />
          )}
          {d.donation && <Row label={tr("tx.toTreasury")} value={`${formatAda(d.donation)} ₳`} />}
          {d.treasuryValue && <Row label={tr("tx.treasuryValue")} value={`${formatAda(d.treasuryValue)} ₳`} />}
        </ReviewRows>
      </Section>

      {d.certificates.length > 0 && (
        <Section title={tr("tx.certificates", { count: d.certificates.length })} id={`${testId}-certs`}>
          <ul className="list" data-testid={`${testId}-cert-list`}>
            {d.certificates.map((c, i) => (
              <li key={i} className="list__row tx-detail__wrap">
                <span className="tx-detail__name">{certificateWords(c.kind)}</span>
                <span className="dapp-amount">
                  {c.deposit && tr("tx.depositAmount", { amount: formatAda(c.deposit) })}
                  {c.refund && tr("tx.backAmount", { amount: formatAda(c.refund) })}
                </span>
                {(c.pool || c.drep) && (
                  <span className="dapp-address">{[c.pool, c.drep].filter(Boolean).join(" · ")}</span>
                )}
                <div className="tx-detail__tree">
                  <Fields of={c} skip={["kind", "pool", "drep", "deposit", "refund"]} labels={CERT_FIELDS} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {d.withdrawals.length > 0 && (
        <Section title={tr("tx.withdrawsRewards")} id={`${testId}-withdrawals`}>
          <ul className="list" data-testid={`${testId}-withdrawal-list`}>
            {d.withdrawals.map((w, i) => (
              <li key={i} className="list__row dapp-paid">
                <span className="tx-detail__line tx-detail__line--wide">
                  <span className="dapp-address" data-value={w.address}>
                    {w.address}
                  </span>
                  <CopyButton value={w.address} label={tr("tx.copyRewardAddress")} />
                </span>
                <span className="dapp-amount">{formatAda(w.lovelace)} ₳</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(d.votes.length > 0 || d.proposals.length > 0) && (
        <Section title={tr("tx.governance")} id={`${testId}-governance`}>
          <ul className="list" data-testid={`${testId}-governance-list`}>
            {d.votes.map((v, i) => (
              <li key={`v${i}`} className="list__row tx-detail__stack">
                <span className="tx-detail__name">
                  {tr("tx.votesAs", { vote: v.vote, voter: tr(v.voter === "drep" ? "tx.voter.drep" : v.voter === "pool" ? "tx.voter.pool" : "tx.voter.committee") })}
                </span>
                <span className="tx-detail__line">
                  <code
                    className="tx-detail__ref"
                    data-value={`${v.action.txHash}#${v.action.index}`}
                    title={`${v.action.txHash}#${v.action.index}`}
                  >
                    {shortHex(v.action.txHash, 12, 6)}#{v.action.index}
                  </code>
                  <CopyButton value={`${v.action.txHash}#${v.action.index}`} label={tr("tx.copyActionId")} />
                </span>
              </li>
            ))}
            {d.proposals.map((p, i) => (
              <li key={`p${i}`} className="list__row tx-detail__wrap">
                <span className="tx-detail__name">{tr("tx.proposes", { what: proposalWords(p.action) })}</span>
                <span className="dapp-amount">{tr("tx.depositAmount", { amount: formatAda(p.deposit) })}</span>
                <div className="tx-detail__tree">
                  <Fields
                    of={{ ...p, parameters: p.parameters.length ? p.parameters : null, withdrawals: p.withdrawals.length ? p.withdrawals : null }}
                    skip={["action", "deposit"]}
                    labels={PROPOSAL_FIELDS}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(d.redeemers.length > 0 || d.scripts.length > 0 || d.datums.length > 0 || d.requiredSigners.length > 0) && (
        <Section
          title={tr("tx.contracts")}
          id={`${testId}-contracts`}
          hint={tr("tx.contractsHint")}
        >
          {d.redeemers.length > 0 && (
            <ul className="list" data-testid={`${testId}-redeemer-list`}>
              {d.redeemers.map((r, i) => (
                <li key={i} className="list__row tx-detail__stack">
                  <span className="tx-detail__name">
                    {tr("tx.runsScript", { what: redeemerWords(r.tag), number: r.index })}
                  </span>
                  {/* Its own line, under the script it belongs to: a budget runs
                      to ten digits and more, and beside the words it squeezed
                      them to a column (the owner, 2026-10-01). */}
                  <span className="tx-detail__budget">
                    {/* Grouped through bigint: a budget can be bigger than a JavaScript number holds. */}
                    {tr("tx.budget", { mem: formatQuantity(r.mem, 0), steps: formatQuantity(r.steps, 0) })}
                  </span>
                  {r.argument ? (
                    <PlutusTree
                      label={tr("tx.itsArgument")}
                      hex={r.data}
                      value={r.argument}
                      testId={`${testId}-redeemer-${i}`}
                    />
                  ) : (
                    <span className="tx-detail__line">
                      <code className="tx-detail__ref" data-value={r.data} title={r.data}>
                        {shortHex(r.data, 24, 12)}
                      </code>
                      <CopyButton value={r.data} label={tr("tx.copyRedeemer")} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {d.scripts.length > 0 && (
            <ul className="list" data-testid={`${testId}-script-list`}>
              {d.scripts.map((s, i) => (
                <li key={`${s.hash}${i}`} className="list__row tx-detail__stack">
                  <span className="tx-detail__name">
                    {tr("tx.scriptLine", { kind: scriptWords(s.kind), size: s.size, where: scriptWhere(s.source) })}
                  </span>
                  <span className="tx-detail__line">
                    <code className="tx-detail__ref" data-value={s.hash} title={s.hash}>
                      {shortHex(s.hash, 12, 8)}
                    </code>
                    <CopyButton value={s.hash} label={tr("tx.copyScriptHash")} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d.datums.length > 0 && (
            <ul className="list" data-testid={`${testId}-datum-list`}>
              {d.datums.map((datum, i) => (
                <li key={i} className="list__row tx-detail__stack">
                  {/* Nothing here says whose datum it is: one in the witness set
                      belongs to whichever output names its hash, which could be
                      any contract at all. */}
                  <span className="tx-detail__name">{tr("tx.aDatum")}</span>
                  <span className="tx-detail__line">
                    <code className="tx-detail__ref" data-value={datum.hash} title={tr("tx.itsHash", { hash: datum.hash })}>
                      {shortHex(datum.hash, 12, 8)}
                    </code>
                    <CopyButton value={datum.hash} label={tr("tx.copyDatumHash")} />
                  </span>
                  <PlutusTree label={tr("tx.theDatum")} hex={datum.hex} value={datum.data} testId={`${testId}-datum-${i}`} />
                </li>
              ))}
            </ul>
          )}
          {d.requiredSigners.length > 0 && (
            <ReviewRows testId={`${testId}-signers`}>
              {d.requiredSigners.map((hash, i) => (
                <Row key={i} label={tr("tx.mustBeSignedBy")} value={shortHex(hash, 10, 6)} title={hash} />
              ))}
            </ReviewRows>
          )}
        </Section>
      )}

      {d.note && (
        <Section
          title={tr("tx.itsNote")}
          id={`${testId}-note`}
          hint={tr("tx.privacy.noteHint")}
        >
          <pre className="dapp-message" data-testid={`${testId}-note-text`}>
            {d.note.join("\n")}
          </pre>
        </Section>
      )}

      {d.metadata.length > 0 && (
        <Section
          title={tr("tx.metadata")}
          id={`${testId}-metadata`}
          hint={tr("tx.privacy.metadataHint")}
        >
          <ul className="list" data-testid={`${testId}-metadata-list`}>
            {d.metadata.map((m, i) => (
              <li key={i} className="list__row tx-detail__wrap">
                <span className="tx-detail__name">{tr("tx.metadataLabel", { label: m.label })}</span>
                <div className="tx-detail__tree">
                  <Metadatum value={m.value} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {d.unknown.length > 0 && (
        <Section title={tr("tx.notNamed")} id={`${testId}-unknown-fields`}>
          <ul className="list" data-testid={`${testId}-unknown-list`}>
            {d.unknown.map((u, i) => (
              <li key={i} className="list__row tx-detail__wrap">
                <span className="tx-detail__name">
                  {tr("tx.unknownField", {
                    where: tr(u.at === "body" ? "tx.where.body" : u.at === "witnesses" ? "tx.where.witnesses" : "tx.where.metadata"),
                    field: u.field,
                  })}
                </span>
                <CopyButton value={u.hex} label={tr("tx.copyField")} />
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

/**
 * One output: the whole address on its own line, then what goes there.
 *
 * The address is the one thing here read rather than carried — a payment is
 * checked by reading all of it — so it isn't shortened the way the ids are. The
 * button is for carrying it anyway (the owner, 2026-10-01).
 */
function Output({
  output: o,
  amount,
  name,
}: {
  output: TxOutput;
  amount: (t: TxAsset) => string;
  name: (t: TxAsset) => string;
}) {
  const tr = useT();
  return (
    <li className="list__row dapp-paid">
      <span className="tx-detail__line tx-detail__line--wide">
        <span className="dapp-address" data-value={o.address.bech32}>
          {o.address.bech32}
        </span>
        <CopyButton value={o.address.bech32} label={tr("tx.copyAddress")} />
      </span>
      <span className="note">
        {`#${o.index} · ${addressWords(o.address.kind, o.address.payment)}`}
        {/* `form` isn't shown: the CDDL calls the list and the map forms "equally
            valid and interchangeable", cardano-cli writes a list for any output
            that needs neither an inline datum nor a script, and the two mean
            exactly the same to the ledger. Saying it on every row would read as
            a warning about nothing. The Raw CBOR tab has the bytes. */}
        {o.address.seedelf && ` · ${tr("tx.out.seedelfContract")}`}
        {o.register && ` · ${tr(o.register.payable ? "tx.out.underRegister" : "tx.out.deadRegister")}`}
        {o.inlineDatum && !o.register && ` · ${tr("tx.out.withDatum")}`}
        {o.datumHash && ` · ${tr("tx.out.datumByHash")}`}
        {o.scriptRef && ` · ${tr("tx.out.carriesScript", { kind: scriptWords(o.scriptRef.kind) })}`}
      </span>
      <span className="dapp-amount">
        {formatAda(o.lovelace)} ₳
        {o.assets.map((t, i) => (
          // The name can be anyone's choice, so the policy and the name in hex
          // stay within reach of it.
          <span key={i} className="note" title={`${t.policyId}.${t.assetName}`}>
            {amount(t)} {name(t)}
          </span>
        ))}
      </span>
      {/* Whatever contract it is for: the shape is all that can be shown of it. */}
      {o.datum && o.inlineDatum && <PlutusTree label={tr("tx.itsDatum")} hex={o.inlineDatum} value={o.datum} />}
    </li>
  );
}

/**
 * Every field of a certificate or a proposal beyond the ones the row says in
 * words, each under its own name. It walks the object rather than naming the
 * fields it knows, so a field the decoder gains is never silently left out —
 * which is the same rule the decoder follows for the bytes.
 */
function Fields({ of, skip, labels }: { of: object; skip: string[]; labels: Record<string, I18nKey> }) {
  const tr = useT();
  const rows = Object.entries(of).filter(([key, value]) => !skip.includes(key) && value !== null && value !== undefined);
  if (!rows.length) return null;
  return (
    <ul className="tx-detail__branch">
      {rows.map(([key, value]) => (
        <li key={key}>
          {/* The table holds keys, not words: a field the table doesn't name
              keeps its own name, as it did. */}
          <span className="tx-detail__key">{labels[key] ? tr(labels[key]) : key}</span>
          <span className="tx-detail__leaf">{fieldText(value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One of those fields as text: an amount, a list, an anchor, a nested thing. */
function fieldText(value: unknown): string {
  if (Array.isArray(value)) return value.map(fieldText).join(", ");
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    // An anchor, a credential, an action id: the shapes the decoder makes.
    if (typeof o.url === "string") return `${o.url} (${String(o.contentHash)})`;
    if (typeof o.hash === "string") return `${String(o.kind)} ${String(o.hash)}`;
    if (typeof o.txHash === "string") return `${String(o.txHash)}#${String(o.index)}`;
    if (typeof o.field === "string") return `field ${String(o.field)}: ${String(o.hex)}`;
    if (typeof o.address === "string") return `${String(o.address)} ${formatAda(String(o.lovelace))} ₳`;
    return JSON.stringify(value);
  }
  return String(value);
}

/** The names the view gives a certificate's and a proposal's own fields. */
const CERT_FIELDS: Record<string, I18nKey> = {
  credential: "tx.certField.credential",
  cold: "tx.certField.cold",
  hot: "tx.certField.hot",
  vrfKeyHash: "tx.certField.vrfKeyHash",
  pledge: "tx.certField.pledge",
  cost: "tx.certField.cost",
  margin: "tx.certField.margin",
  rewardAccount: "tx.certField.rewardAccount",
  owners: "tx.certField.owners",
  relays: "tx.certField.relays",
  metadata: "tx.certField.metadata",
  anchor: "tx.certField.anchor",
  epoch: "tx.certField.epoch",
};

const PROPOSAL_FIELDS: Record<string, I18nKey> = {
  rewardAccount: "tx.proposalField.rewardAccount",
  follows: "tx.proposalField.follows",
  parameters: "tx.proposalField.parameters",
  withdrawals: "tx.proposalField.withdrawals",
  script: "tx.proposalField.script",
  version: "tx.proposalField.version",
  anchor: "tx.proposalField.anchor",
};

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
  const words: Record<string, I18nKey> = {
    stakeRegistration: "tx.cert.stakeRegistration",
    stakeDeregistration: "tx.cert.stakeDeregistration",
    stakeDelegation: "tx.cert.stakeDelegation",
    poolRegistration: "tx.cert.poolRegistration",
    poolRetirement: "tx.cert.poolRetirement",
    registration: "tx.cert.registration",
    deregistration: "tx.cert.deregistration",
    voteDelegation: "tx.cert.voteDelegation",
    stakeVoteDelegation: "tx.cert.stakeVoteDelegation",
    stakeRegistrationDelegation: "tx.cert.stakeRegistrationDelegation",
    voteRegistrationDelegation: "tx.cert.voteRegistrationDelegation",
    stakeVoteRegistrationDelegation: "tx.cert.stakeVoteRegistrationDelegation",
    committeeHotAuth: "tx.cert.committeeHotAuth",
    committeeColdResign: "tx.cert.committeeColdResign",
    drepRegistration: "tx.cert.drepRegistration",
    drepDeregistration: "tx.cert.drepDeregistration",
    drepUpdate: "tx.cert.drepUpdate",
  };
  const key = words[kind];
  return key ? t(key) : kind;
}

/** A governance action's kind in words. */
export function proposalWords(action: string): string {
  const words: Record<string, I18nKey> = {
    parameterChange: "tx.proposal.parameterChange",
    hardFork: "tx.proposal.hardFork",
    treasuryWithdrawals: "tx.proposal.treasuryWithdrawals",
    noConfidence: "tx.proposal.noConfidence",
    updateCommittee: "tx.proposal.updateCommittee",
    newConstitution: "tx.proposal.newConstitution",
    information: "tx.proposal.information",
  };
  const key = words[action];
  return key ? t(key) : action;
}

/** What a redeemer's tag is for. */
export function redeemerWords(tag: string): string {
  const words: Record<string, I18nKey> = {
    spend: "tx.redeemer.spend",
    mint: "tx.redeemer.mint",
    cert: "tx.redeemer.cert",
    reward: "tx.redeemer.reward",
    vote: "tx.redeemer.vote",
    propose: "tx.redeemer.propose",
  };
  const key = words[tag];
  return key ? t(key) : t("tx.redeemer.unknown", { tag });
}

export function scriptWords(kind: string): string {
  return kind === "native" ? t("tx.script.native") : t("tx.script.plutus", { version: kind.replace("plutus", "") });
}

function scriptWhere(source: string): string {
  return t(source === "output" ? "tx.scriptWhere.output" : source === "metadata" ? "tx.scriptWhere.metadata" : "tx.scriptWhere.witness");
}

/** What an address is, from its own bytes. */
export function addressWords(kind: string, payment: string | null): string {
  if (kind === "unreadable") return t("tx.address.unreadable");
  if (kind === "byron") return t("tx.address.byron");
  if (kind === "reward") return t("tx.address.reward");
  const who = t(payment === "script" ? "tx.address.contract" : "tx.address.key");
  if (kind === "base") return t("tx.address.thatStakes", { who });
  if (kind === "pointer") return t("tx.address.withPointer", { who });
  return who;
}
