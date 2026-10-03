// A datum, or a redeemer's argument, as a tree that opens: every node of it,
// however big or deep, with nothing counted off (the owner, 2026-10-01 — "what
// if someone needs to read out the whole thing").
//
// **Nothing is assumed about the contract it came from.** There is no schema to
// read a datum against: it means whatever the contract that reads it says it
// means. So this shows exactly the shape CBOR holds — constructors by their
// number, lists, maps, byte strings, whole numbers — and names nothing.
//
// **A collapsed branch isn't drawn at all.** That is what lets the whole datum
// through: a node renders its children only once it's open, so a datum of tens of
// thousands of nodes costs nothing until someone opens that part of it. Expand
// all is there for whoever wants the lot.
//
// **Copy JSON** gives it in Plutus data's detailed schema — `{"constructor": n,
// "fields": […]}`, `{"bytes": "…"}`, `{"int": n}`, `{"list": […]}`,
// `{"map": [{"k": …, "v": …}]}` — which is the form cardano-cli, Blockfrost and
// Koios all speak, so it can go straight into another tool.

import { createContext, useContext, useId, useState } from "react";
import { type I18nKey, t, useT } from "../../i18n";

import type { TxPlutus } from "../../shared/rpc";
import { CopyButton } from "./CopyButton";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import { formatQuantity, shortHex } from "../format";

/**
 * How many of something, grouped: a datum can hold thousands of fields, and
 * "2,000 fields" reads where "2000 fields" doesn't. Through bigint, as every
 * number in this view is.
 */
function count(n: number, key: I18nKey): string {
  // `count` picks the form, `n` is what's shown: the separated number, not the
  // raw one i18next would interpolate for `count`.
  return t(key, { count: n, n: formatQuantity(String(n), 0) });
}

/**
 * Every node of one tree opened or closed at once. The generation changes, and
 * each node that hasn't been touched since follows `open`; touching one pins it
 * to the generation again, so a branch opened by hand stays as it was left.
 */
interface AllOf {
  generation: number;
  open: boolean;
}

const AllContext = createContext<AllOf>({ generation: 0, open: false });

/** How many levels start open, where the branch is small enough to be worth it. */
const OPEN_DEPTH = 2;
/** A branch with more children than this starts closed, however shallow it is. */
const OPEN_ITEMS = 24;

/** The children of a node, whatever kind it is: none for a leaf. */
function childrenOf(value: TxPlutus): TxPlutus[] {
  switch (value.type) {
    case "constr":
      return value.fields;
    case "list":
      return value.items;
    case "map":
      return value.entries.flatMap((e) => [e.key, e.value]);
    default:
      return [];
  }
}

/** What a node says of itself, open or closed. */
function labelOf(value: TxPlutus): string {
  switch (value.type) {
    case "constr":
      return t("tx.plutus.constructor", {
        index: value.constructorIndex,
        fields: count(value.fields.length, "tx.plutus.fields"),
      });
    case "list":
      return count(value.items.length, "tx.plutus.items");
    case "map":
      return count(value.entries.length, "tx.plutus.pairs");
    default:
      return "";
  }
}

/** One node: a leaf, or a branch with a control that opens it. */
function Node({ value, depth, name }: { value: TxPlutus; depth: number; name?: string }) {
  const all = useContext(AllContext);
  const children = childrenOf(value);
  const starts = depth < OPEN_DEPTH && children.length <= OPEN_ITEMS;
  const [own, setOwn] = useState({ open: starts, generation: all.generation });
  const open = own.generation === all.generation ? own.open : all.open;
  const id = useId();

  if (!children.length) {
    return (
      <div className="plutus__row">
        {name !== undefined && <span className="plutus__name">{name}</span>}
        <Leaf value={value} />
      </div>
    );
  }
  return (
    <div className="plutus__branch">
      <div className="plutus__row">
        {name !== undefined && <span className="plutus__name">{name}</span>}
        <button
          type="button"
          className="plutus__toggle"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOwn({ open: !open, generation: all.generation })}
        >
          {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          {labelOf(value)}
        </button>
      </div>
      {open && (
        <div className="plutus__children" id={id}>
          {value.type === "map"
            ? value.entries.map((entry, i) => (
                <div key={i} className="plutus__pair">
                  <Node value={entry.key} depth={depth + 1} name={`${i} key`} />
                  <Node value={entry.value} depth={depth + 1} name={`${i} value`} />
                </div>
              ))
            : children.map((child, i) => <Node key={i} value={child} depth={depth + 1} name={String(i)} />)}
        </div>
      )}
    </div>
  );
}

/** A number, or bytes: the whole value is on the element, for copying and hover. */
function Leaf({ value }: { value: TxPlutus }) {
  const tr = useT();
  if (value.type === "int") {
    return <code className="plutus__leaf">{value.value}</code>;
  }
  if (value.type === "bytes") {
    const bytes = value.hex.length / 2;
    return (
      <code className="plutus__leaf" data-value={value.hex} title={tr("tx.hexBytes", { hex: value.hex, count: bytes })}>
        {value.text ?? shortHex(value.hex, 20, 10)}
        <span className="plutus__size"> {count(bytes, "tx.plutus.bytes")}</span>
      </code>
    );
  }
  // A constructor, list or map with nothing in it.
  return <span className="plutus__leaf note">{labelOf(value) || tr("tx.plutus.empty")}</span>;
}

/**
 * Plutus data in its detailed schema, the form cardano-cli, Blockfrost and Koios
 * all use, so what is copied can be read by any of them.
 */
export function plutusJson(value: TxPlutus): unknown {
  switch (value.type) {
    case "constr":
      return { constructor: Number(value.constructorIndex), fields: value.fields.map(plutusJson) };
    case "list":
      return { list: value.items.map(plutusJson) };
    case "map":
      return { map: value.entries.map((e) => ({ k: plutusJson(e.key), v: plutusJson(e.value) })) };
    case "int":
      return { int: value.value };
    case "bytes":
      return { bytes: value.hex };
  }
}

/** How many nodes a tree holds, for what the heading says of it. */
export function plutusNodes(value: TxPlutus): number {
  return 1 + childrenOf(value).reduce((count, child) => count + plutusNodes(child), 0);
}

/**
 * A datum or a redeemer's argument: what it is, how to take it away, and the
 * tree. `hex` is the bytes it was read from.
 */
export function PlutusTree({
  label,
  hex,
  value,
  testId,
}: {
  label: string;
  hex: string;
  value: TxPlutus;
  testId?: string;
}) {
  const tr = useT();
  const [all, setAll] = useState<AllOf>({ generation: 0, open: false });
  const nodes = plutusNodes(value);
  return (
    <div className="plutus" data-testid={testId}>
      <div className="field-row">
        <span className="note">
          {tr("tx.plutus.summary", {
            label,
            bytes: count(hex.length / 2, "tx.plutus.bytes"),
            nodes: count(nodes, "tx.plutus.nodes"),
          })}
        </span>
        <span className="plutus__actions">
          <button
            type="button"
            className="chip"
            onClick={() => setAll({ generation: all.generation + 1, open: !all.open })}
            data-testid={testId && `${testId}-all`}
          >
            {tr(all.open ? "tx.collapseAll" : "tx.expandAll")}
          </button>
          <CopyButton value={hex} label={tr("tx.copyAsCbor", { what: label.toLowerCase() })} what="CBOR" />
          <CopyButton
            value={JSON.stringify(plutusJson(value), null, 2)}
            label={tr("tx.copyAsJson", { what: label.toLowerCase() })}
            what="JSON"
          />
        </span>
      </div>
      <AllContext.Provider value={all}>
        <Node value={value} depth={0} />
      </AllContext.Provider>
    </div>
  );
}
