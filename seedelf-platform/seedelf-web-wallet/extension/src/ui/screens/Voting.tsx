// Where the Cardano account's voting power goes, after Lace's governance tab:
// Always abstain and Always no confidence pinned, or a DRep by its ID. A DRep
// is looked up first (its status, voting power, and name from its metadata:
// two requests), since the ledger refuses one that isn't registered. There's
// no list of DReps: that's a follow-up (docs/plans/chunk-13-staking.md).
// Conway pays out no rewards from an account whose vote isn't delegated, so
// the Staking page and Home send the user here when rewards are locked.

import { useState, type FormEvent } from "react";

import type { DrepDetails } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CheckIcon, LandmarkIcon } from "../components/Icons";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { ALWAYS_ABSTAIN, ALWAYS_NO_CONFIDENCE, formatAda, voteLabel } from "../format";

type Pick = "abstain" | "no-confidence" | "drep";

const OPTIONS: Array<{ value: Pick; title: string; text: string }> = [
  {
    value: "abstain",
    title: "Always abstain",
    text: "Your stake sits out every vote.",
  },
  {
    value: "no-confidence",
    title: "Always no confidence",
    text: "Your stake votes no confidence in the constitutional committee, every time.",
  },
  {
    value: "drep",
    title: "A DRep",
    text: "Someone who votes for you, by their DRep ID.",
  },
];

const pickOf = (drep: string | null): Pick =>
  drep === ALWAYS_NO_CONFIDENCE ? "no-confidence" : drep && drep !== ALWAYS_ABSTAIN ? "drep" : "abstain";

export function Voting({
  current,
  registered,
  blocked,
  busy,
  error,
  onBack,
  onVote,
}: {
  /** Where the vote goes now, as Koios names it. */
  current: string | null;
  registered: boolean;
  blocked?: string;
  /** Building the delegation. */
  busy: boolean;
  error?: string;
  onBack: () => void;
  /** The vote as Koios names it, and the DRep's name. */
  onVote: (drep: string, name?: string) => void;
}) {
  const [pick, setPick] = useState<Pick>(pickOf(current));
  const [id, setId] = useState(pickOf(current) === "drep" ? (current ?? "") : "");
  const [drep, setDrep] = useState<DrepDetails>();
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string>();

  const chosen =
    pick === "abstain" ? ALWAYS_ABSTAIN : pick === "no-confidence" ? ALWAYS_NO_CONFIDENCE : drep?.id;
  const same = chosen !== undefined && chosen === current;
  const retired = pick === "drep" && drep?.status === "retired";
  const why = blocked ?? (same ? "Your voting power already goes there" : retired ? "That DRep has retired" : undefined);

  async function lookUp(e: FormEvent) {
    e.preventDefault();
    if (!id.trim() || looking) return;
    setLooking(true);
    setLookError(undefined);
    setDrep(undefined);
    try {
      setDrep(await call("drep", { id: id.trim() }));
    } catch (err) {
      setLookError((err as Error).message);
    } finally {
      setLooking(false);
    }
  }

  return (
    <Screen
      title="Voting power"
      titleId="voting-title"
      onBack={onBack}
      backDisabled={busy}
      aside={`Now: ${voteLabel(current)}`}
      error={error}
      foot={
        <button
          type="button"
          className="primary"
          onClick={() => chosen && onVote(chosen, pick === "drep" ? drep?.name : undefined)}
          disabled={!chosen || !!why || busy}
          title={why}
        >
          {busy ? "Building…" : "Review"}
        </button>
      }
    >
      <p className="note">
        Cardano's governance votes on changes to the chain and on spending from its treasury. Your stake's voting power
        goes where you choose.
      </p>
      <ul className="list" role="radiogroup" aria-label="Where your voting power goes">
        {OPTIONS.map((o) => {
          const on = o.value === pick;
          return (
            <li key={o.value}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? "token-row token-row--on" : "token-row"}
                onClick={() => setPick(o.value)}
              >
                <span className="avatar avatar--contact" aria-hidden="true">
                  {on ? <CheckIcon size={16} /> : <LandmarkIcon size={16} />}
                </span>
                <span className="token-row__label">{o.title}</span>
                <span />
                <span className="token-row__sub wrap">{o.text}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {pick === "drep" && (
        <div className="stack-tight">
          {/* A form of its own: Enter looks the DRep up. */}
          <form className="stack-tight" onSubmit={lookUp}>
            <div className="field">
              <label htmlFor="drep-id">DRep ID</label>
              <textarea
                id="drep-id"
                className="seedelf-name"
                rows={2}
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setDrep(undefined);
                  setLookError(undefined);
                }}
                onKeyDown={(e) => {
                  // Enter looks it up, as in a one-line box.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="drep1…"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <button type="submit" className="secondary" disabled={!id.trim() || looking}>
              {looking ? "Looking…" : "Look up"}
            </button>
          </form>
          {lookError && (
            <p className="field-note" role="alert">
              {lookError}
            </p>
          )}
          {drep && <DrepCard drep={drep} />}
        </div>
      )}

      {!registered && (
        <p className="note">Your account isn't registered to stake yet: this registers it, with a 2 ₳ deposit that comes back when you stop.</p>
      )}
      <Callout tone="privacy">Where your voting power goes is public, and it names your Cardano account.</Callout>
    </Screen>
  );
}

function DrepCard({ drep }: { drep: DrepDetails }) {
  const status =
    drep.status === "retired"
      ? "Retired"
      : drep.active
        ? "Active"
        : `Inactive${drep.expiresEpoch !== null ? ` since epoch ${drep.expiresEpoch}` : ""}`;
  return (
    <div className="stack-tight" data-testid="drep-details">
      <ReviewRows testId="drep-facts">
        <Row label="Name" value={drep.name ?? "No name given"} strong />
        <Row label="Status" value={status} />
        <Row label="Voting power" value={`${formatAda(drep.votingPower)} ₳`} />
        <Row label="Delegators" value={drep.delegators.toLocaleString("en-US")} />
      </ReviewRows>
      {drep.status !== "retired" && !drep.active && (
        <Callout tone="warn">
          This DRep hasn't voted lately, so its votes don't count until it does. Your rewards unlock either way.
        </Callout>
      )}
    </div>
  );
}
