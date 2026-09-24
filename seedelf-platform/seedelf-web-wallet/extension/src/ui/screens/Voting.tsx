// Where the Cardano account's voting power goes, after Lace's governance tab:
// Always abstain and Always no confidence pinned, or a DRep, searched by name
// or ID in the wallet's own list (ui/dreps.ts: no requests), or pasted by ID.
// The DRep picked is looked up live (its status, voting power, and name from
// its metadata: two requests), since the ledger refuses one that isn't
// registered. Conway pays out no rewards from an account whose vote isn't
// delegated, so the Staking page and Home send the user here when rewards
// are locked.

import { useState, type FormEvent } from "react";

import { ALWAYS_ABSTAIN, ALWAYS_NO_CONFIDENCE, type DrepDetails } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CheckIcon, LandmarkIcon, SearchIcon } from "../components/Icons";
import { MiddleEllipsis } from "../components/MiddleEllipsis";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { drepList, isDrepId, searchDreps, type DrepEntry } from "../dreps";
import { formatAda, plural, shortHex, voteLabel } from "../format";
import { useNetwork } from "../network";
import { initials, tint } from "../tokens";

/** DReps shown at a time; "Show more" adds as many again. */
const PAGE = 20;

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
    text: "Someone who votes for you: search by name, or paste their DRep ID.",
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
  const [drep, setDrep] = useState<DrepDetails>();
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string>();

  const chosen =
    pick === "abstain" ? ALWAYS_ABSTAIN : pick === "no-confidence" ? ALWAYS_NO_CONFIDENCE : drep?.id;
  const same = chosen !== undefined && chosen === current;
  const retired = pick === "drep" && drep?.status === "retired";
  const why = blocked ?? (same ? "Your voting power already goes there" : retired ? "That DRep has retired" : undefined);

  async function lookUp(id: string) {
    if (!id || looking) return;
    setLooking(true);
    setLookError(undefined);
    setDrep(undefined);
    try {
      setDrep(await call("drep", { id }));
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

      {pick === "drep" &&
        (drep ? (
          <div className="stack-tight">
            <DrepCard drep={drep} />
            <button type="button" className="link align-start" onClick={() => setDrep(undefined)} disabled={busy}>
              Choose another DRep
            </button>
          </div>
        ) : (
          <DrepSearch looking={looking} error={lookError} onPick={(id) => void lookUp(id)} />
        ))}

      {!registered && (
        <p className="note">Your account isn't registered to stake yet: this registers it, with a 2 ₳ deposit that comes back when you stop.</p>
      )}
      <Callout tone="privacy">Where your voting power goes is public, and it names your Cardano account.</Callout>
    </Screen>
  );
}

/** The wallet's list of named DReps, searched on the device, or an ID pasted in. */
function DrepSearch({ looking, error, onPick }: { looking: boolean; error?: string; onPick: (id: string) => void }) {
  const { recorded, dreps } = drepList(useNetwork());
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const found = searchDreps(dreps, query);
  // A whole ID the list doesn't have (a DRep registered since, or CIP-105's form): looked up as pasted.
  const pasted = isDrepId(query) && !found.length ? query.trim() : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (pasted) onPick(pasted);
    else if (found.length === 1) onPick(found[0]!.id);
  }

  return (
    // A form of its own: Enter looks up a pasted ID, or the one DRep found.
    <form className="stack-tight" onSubmit={submit}>
      <label className="search">
        <SearchIcon size={16} />
        <input
          type="search"
          aria-label="Search DReps"
          placeholder="Name or DRep ID"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      {error && (
        <p className="field-note" role="alert">
          {error}
        </p>
      )}
      {pasted ? (
        <button type="submit" className="secondary" disabled={looking}>
          {looking ? "Looking…" : "Look up this ID"}
        </button>
      ) : found.length ? (
        <ul className="list" data-testid="drep-results">
          {found.slice(0, limit).map((d) => (
            <DrepRow key={d.id} drep={d} disabled={looking} onPick={onPick} />
          ))}
        </ul>
      ) : (
        <p className="note center">No DRep on the wallet's list matches “{query.trim()}”. Paste its whole ID instead.</p>
      )}
      {!pasted && found.length > limit && (
        <button type="button" className="secondary" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, found.length - limit)} more
        </button>
      )}
      <p className="note" data-testid="drep-list-note">
        {plural(dreps.length, "DRep")} with a name, from the wallet's list of {dateOf(recorded)}: searching it asks no one. For
        one who registered since, paste the whole ID.
      </p>
    </form>
  );
}

/** "24 Sep 2026" for the list's "2026-09-24". */
const dateOf = (day: string) =>
  day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "no date";

function DrepRow({ drep, disabled, onPick }: { drep: DrepEntry; disabled: boolean; onPick: (id: string) => void }) {
  return (
    <li>
      <button type="button" className="token-row" onClick={() => onPick(drep.id)} disabled={disabled} aria-label={drep.name}>
        <span className={`avatar avatar--tint-${tint(drep.id)}`} aria-hidden="true">
          {initials(drep.name)}
        </span>
        <span className="token-row__label">{drep.name}</span>
        <span />
        <span className="token-row__sub">{shortHex(drep.id, 12, 6)}</span>
      </button>
    </li>
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
      <MiddleEllipsis text={drep.id} />
      {drep.status !== "retired" && !drep.active && (
        <Callout tone="warn">
          This DRep hasn't voted lately, so its votes don't count until it does. Your rewards unlock either way.
        </Callout>
      )}
    </div>
  );
}
