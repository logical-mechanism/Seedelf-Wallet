// Where the Cardano account's voting power goes, after Lace's governance tab:
// Always abstain and Always no confidence pinned, or a DRep, searched by name
// or ID in the wallet's own list (ui/dreps.ts: no requests), or pasted by ID.
// The DRep picked is looked up live (its status, voting power, and name from
// its metadata: two requests), since the ledger refuses one that isn't
// registered. Conway pays out no rewards from an account whose vote isn't
// delegated, so the Staking page and Home send the user here when rewards
// are locked. Names are the DReps' own: two with the same one (or one that
// only looks the same) are flagged, so is a DRep off the list using a listed
// one's name, and every row shows enough of the ID to tell them apart
// (launch review #59).

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { type I18nKey, joinList, t, useT } from "../../i18n";

import { ALWAYS_ABSTAIN, ALWAYS_NO_CONFIDENCE, type DrepDetails, type OwnDrep } from "../../shared/rpc";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CheckIcon, LandmarkIcon, SearchIcon, UsersIcon, WalletIcon, WarnIcon } from "../components/Icons";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { drepList, isDrepId, searchDreps, type DrepEntry } from "../dreps";
import { formatAda, nameSkeleton, plainName, sharedNames, sharing, shortId, voteLabel } from "../format";
import { useNetwork } from "../network";
import { initials, tint } from "../tokens";
import { ReadFailed } from "./Staking";

/** DReps shown at a time; "Show more" adds as many again. */
const PAGE = 20;

export type Pick = "abstain" | "no-confidence" | "own" | "drep";

/** An icon each, where all four shared one bank (chunk 23's second review, ST-12). */
const OPTIONS = [
  { value: "abstain", title: "vote.abstain.title", text: "vote.abstain.text", Icon: LandmarkIcon },
  { value: "no-confidence", title: "vote.noConfidence.title", text: "vote.noConfidence.text", Icon: WarnIcon },
  // The account as its own DRep (chunk 21): whether it is one yet or not, so it never has to find itself.
  { value: "own", title: "drep.yourOwn", text: "vote.own.text", Icon: WalletIcon },
  { value: "drep", title: "vote.drep.title", text: "vote.drep.text", Icon: UsersIcon },
] as const satisfies Array<{ value: Pick; title: I18nKey; text: I18nKey; Icon: typeof LandmarkIcon }>;

/**
 * What Voting power was showing: the choice, the DRep picked and the search.
 * Kept by the Staking page, so Back from the review returns to them: it reset
 * to Always abstain, and the search and the pick had to be made again
 * (chunk 23's second review, ST-11).
 */
export interface VoteView {
  pick: Pick;
  drep?: DrepDetails;
  query: string;
}

/** Which choice the vote's delegation is now: the account's own DRep (`ownId`), when it goes there. */
export const pickOf = (drep: string | null, ownId?: string): Pick =>
  drep === ALWAYS_NO_CONFIDENCE
    ? "no-confidence"
    : ownId !== undefined && drep === ownId
      ? "own"
      : drep && drep !== ALWAYS_ABSTAIN
        ? "drep"
        : "abstain";

export function Voting({
  current,
  registered,
  blocked,
  busy,
  error,
  view,
  onView,
  onBack,
  onVote,
  own,
  ownError,
  onBecome,
}: {
  /** Where the vote goes now, as Koios names it. */
  current: string | null;
  registered: boolean;
  blocked?: string;
  /** Building the delegation. */
  busy: boolean;
  error?: string;
  /** What was showing before a review, to show again. */
  view?: VoteView;
  onView?: (view: VoteView) => void;
  onBack: () => void;
  /**
   * The vote as Koios names it, the DRep's name, how many DReps share that
   * name (`drepSharing`), and whether the DRep is inactive, which its review
   * says again (GV-5).
   */
  onVote: (drep: string, name?: string, shared?: DrepShared, inactive?: boolean) => void;
  /** The account's own DRep, as the Staking page read it (no request here); undefined while it reads. */
  own?: OwnDrep;
  ownError?: string;
  /** Opens Become a DRep: for "Your own DRep" before the account is one. */
  onBecome: () => void;
}) {
  const t = useT();
  const network = useNetwork();
  const { dreps } = drepList(network);
  const shared = useMemo(() => sharedNames(dreps, (d) => d.name), [dreps]);
  const [pick, setPick] = useState<Pick>(view?.pick ?? pickOf(current, own?.id));
  // The account's DRep read after this opened: a vote already on it is "Your own DRep".
  const ownId = own?.id;
  useEffect(() => {
    if (ownId !== undefined && current === ownId) setPick((p) => (p === "drep" ? "own" : p));
  }, [ownId, current]);
  /** The account's own DRep, when it's registered: the only one a vote can go to. */
  const registeredOwn = own?.status === "registered" ? own : undefined;
  const ownRegistered = registeredOwn !== undefined;
  const [drep, setDrep] = useState<DrepDetails | undefined>(view?.drep);
  const [query, setQuery] = useState(view?.query ?? "");
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string>();
  useEffect(() => onView?.({ pick, drep, query }), [pick, drep, query]);

  const chosen =
    pick === "abstain"
      ? ALWAYS_ABSTAIN
      : pick === "no-confidence"
        ? ALWAYS_NO_CONFIDENCE
        : pick === "own"
          ? registeredOwn?.id
          : drep?.id;
  const same = chosen !== undefined && chosen === current;
  const retired = pick === "drep" && drep?.status === "retired";
  const drepShared = drep ? drepSharing(dreps, shared, drep) : NOT_SHARED;
  // Your own DRep before the account is one: the foot opens Become a DRep, where it was a Review that couldn't be
  // pressed, its reason below the fold (chunk 23's second review, GV-3).
  const becomeFirst = pick === "own" && own !== undefined && !ownRegistered;
  const why = blocked ?? (same ? t("vote.alreadyThere") : retired ? t("vote.drepRetired") : undefined);
  const ownName = own && current === own.id ? t("drep.yourOwn") : undefined;

  async function lookUp(id: string) {
    if (!id || looking) return;
    setLooking(true);
    setLookError(undefined);
    setDrep(undefined);
    try {
      const found = await call("drep", { id });
      // The account's own DRep, found by its ID: it's the choice above.
      if (registeredOwn && found.id === registeredOwn.id) {
        setPick("own");
        return;
      }
      setDrep(found);
    } catch (err) {
      setLookError((err as Error).message);
    } finally {
      setLooking(false);
    }
  }

  return (
    <Screen
      title={t("activity.row.votingPower")}
      titleId="voting-title"
      onBack={onBack}
      hint={t("vote.note")}
      hintTestId="vote-note"
      backDisabled={busy}
      aside={t("vote.now", { what: voteLabel(current, ownName) })}
      error={error}
      foot={
        becomeFirst ? (
          <button type="button" className="primary" onClick={onBecome} disabled={!!blocked || busy} title={blocked}>
            {t("drep.become")}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() =>
              chosen &&
              onVote(
                chosen,
                pick === "own" ? t("drep.yourOwn") : pick === "drep" && drep?.name ? plainName(drep.name) : undefined,
                pick === "drep" ? drepShared : undefined,
                pick === "drep" && drep !== undefined && drep.status !== "retired" && !drep.active,
              )
            }
            disabled={!chosen || !!why || busy}
            title={why}
          >
            {busy ? t("common.building") : t("common.review")}
          </button>
        )
      }
    >
      <ul className="list" role="radiogroup" aria-label={t("vote.whereLabel")}>
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
                  {on ? <CheckIcon size={16} /> : <o.Icon size={16} />}
                </span>
                <span className="token-row__label">{t(o.title)}</span>
                <span />
                <span className="token-row__sub wrap">{t(o.text)}</span>
              </button>
              {/* Where this account stands as a DRep, under its own option rather than after the list (GV-3). */}
              {o.value === "own" && on && <OwnStanding own={own} ownError={ownError} />}
            </li>
          );
        })}
      </ul>

      {pick === "drep" &&
        (drep ? (
          <div className="stack-tight">
            <DrepCard drep={drep} shared={drepShared.shared} listed={drepShared.listed} />
            <button type="button" className="link align-start" onClick={() => setDrep(undefined)} disabled={busy}>
              {t("vote.chooseAnother")}
            </button>
          </div>
        ) : (
          <DrepSearch
            shared={shared}
            query={query}
            onQuery={setQuery}
            looking={looking}
            error={lookError}
            onPick={(id) => void lookUp(id)}
          />
        ))}

      {!registered && <p className="note">{t("vote.notRegistered")}</p>}
      <Callout tone="privacy">{t("vote.privacy.public")}</Callout>
    </Screen>
  );
}

/** The account's own DRep under its option: its standing, or what becoming one costs (the foot opens it). */
function OwnStanding({ own, ownError }: { own?: OwnDrep; ownError?: string }) {
  const t = useT();
  const registeredOwn = own?.status === "registered" ? own : undefined;
  return (
    <div className="stack-tight option-detail" data-testid="own-drep">
      {!own ? (
        ownError ? (
          // What failed in plain words, the service's own under Details, as the Staking page says it (ST-10).
          <ReadFailed what={t("drep.readFailed")} detail={ownError} testId="own-drep-failed" />
        ) : (
          <p className="note">{t("drep.reading")}</p>
        )
      ) : registeredOwn ? (
        <>
          <ReviewRows testId="own-drep-facts">
            <Row
              label={t("vote.statusLabel")}
              value={registeredOwn.active ? t("vote.status.active") : t("vote.status.inactive")}
              strong
            />
            <Row label={t("activity.row.votingPower")} value={`${formatAda(registeredOwn.votingPower)}\u00a0₳`} />
          </ReviewRows>
          <p className="note mono-id" data-testid="own-drep-id">
            {registeredOwn.id}
          </p>
          {!registeredOwn.active && <Callout tone="warn">{t("vote.warn.inactive")}</Callout>}
        </>
      ) : (
        <p className="note" data-testid="own-drep-not-yet">
          {own.depositNow ? t("vote.own.notYet", { amount: formatAda(own.depositNow) }) : t("vote.own.notYetUnknown")}
        </p>
      )}
    </div>
  );
}

/** The wallet's list of named DReps, searched on the device, or an ID pasted in. */
function DrepSearch({
  shared,
  query,
  onQuery,
  looking,
  error,
  onPick,
}: {
  shared: Map<string, number>;
  /** The search, kept by Voting so Back from a review finds it as it was. */
  query: string;
  onQuery: (query: string) => void;
  looking: boolean;
  error?: string;
  onPick: (id: string) => void;
}) {
  const t = useT();
  const { recorded, dreps } = drepList(useNetwork());
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
          aria-label={t("vote.search")}
          placeholder={t("vote.searchPlaceholder")}
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
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
          {looking ? t("vote.looking") : t("vote.lookUp")}
        </button>
      ) : found.length ? (
        <ul className="list" data-testid="drep-results">
          {found.slice(0, limit).map((d) => (
            <DrepRow key={d.id} drep={d} shared={sharing(shared, d.name) > 1} disabled={looking} onPick={onPick} />
          ))}
        </ul>
      ) : (
        <p className="note center">{t("vote.noneMatch", { query: query.trim() })}</p>
      )}
      {!pasted && found.length > limit && (
        <button type="button" className="secondary" onClick={() => setLimit(limit + PAGE)}>
          {t("tokens.showMore", { number: Math.min(PAGE, found.length - limit) })}
        </button>
      )}
      <p className="note" data-testid="drep-list-note">
        {t("vote.listNote", { count: dreps.length, date: dateOf(recorded) })}
      </p>
    </form>
  );
}

/** "24 Sep 2026" for the list's "2026-09-24". */
const dateOf = (day: string) =>
  day
    ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : t("vote.noDate");

/**
 * One DRep on the list: its name, flagged when another uses it too, and
 * enough of its ID to tell them apart. The list holds names and IDs only, so
 * a DRep's standing is read once it's picked. The flag has a line of its own,
 * where it ran into the name (V-11).
 */
export function DrepRow({
  drep,
  shared,
  disabled,
  onPick,
}: {
  drep: DrepEntry;
  /** Another DRep on the list has this name, or one that looks the same. */
  shared: boolean;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const t = useT();
  const name = plainName(drep.name);
  return (
    <li>
      <button
        type="button"
        className="token-row"
        onClick={() => onPick(drep.id)}
        disabled={disabled}
        aria-label={joinList([`${name}${shared ? t("vote.row.sharedName") : ""}`, shortId(drep.id)])}
      >
        <span className={`avatar avatar--tint-${tint(drep.id)}`} aria-hidden="true">
          {initials(name)}
        </span>
        <span className="token-row__label">{name}</span>
        <span />
        <span className="token-row__sub mono-id">{shortId(drep.id)}</span>
        {shared && (
          <span className="token-row__tags">
            <span className="utxo-tag utxo-tag--warn">{t("vote.sharedNameTag")}</span>
          </span>
        )}
      </button>
    </li>
  );
}

/** How many DReps use the name the picked one shows (`drepSharing`). */
export interface DrepShared {
  shared: number;
  /** The list has the DRep under that name. When it doesn't, `shared` counts the DRep too. */
  listed: boolean;
}

const NOT_SHARED: DrepShared = { shared: 0, listed: true };

/**
 * How many DReps use the name the picked one shows, its live one, for its
 * card and review: those on the list, and the DRep itself when the list
 * doesn't have it under that name (one registered since, or one that took
 * another's name since). So one that copies the name of a DRep on the list
 * is flagged too. None for a DRep with no name.
 */
export function drepSharing(dreps: DrepEntry[], shared: Map<string, number>, drep: DrepDetails): DrepShared {
  if (!drep.name) return NOT_SHARED;
  const entry = dreps.find((d) => d.id === drep.id);
  const listed = entry !== undefined && nameSkeleton(entry.name) === nameSkeleton(drep.name);
  return { shared: sharing(shared, drep.name) + (listed ? 0 : 1), listed };
}

/**
 * Who else uses a DRep's name, for its card's and review's warning: "2 DReps on
 * the wallet's list use this name…". Named `.warn.`: the warning puts it in from
 * here, where the critical-set deriver, which reads only the JSX, can't see it.
 */
export function sharedDrepName({ shared, listed }: DrepShared): string {
  if (listed) return t("vote.sharedName.warn.listed", { count: shared });
  const others = shared - 1;
  return t("vote.sharedName.warn.unlisted", { count: others });
}

/**
 * The DRep picked, looked up live; `shared` and `listed`: `drepSharing`'s.
 * An inactive DRep's warning comes first, where it was buried after the
 * name's (GV-5).
 */
export function DrepCard({ drep, shared = 0, listed = true }: { drep: DrepDetails; shared?: number; listed?: boolean }) {
  const t = useT();
  const status =
    drep.status === "retired"
      ? t("vote.status.retired")
      : drep.active
        ? t("vote.status.active")
        : drep.expiresEpoch !== null
          ? t("vote.status.inactiveSince", { epoch: drep.expiresEpoch })
          : t("vote.status.inactive");
  return (
    <div className="stack-tight" data-testid="drep-details">
      {drep.status !== "retired" && !drep.active && (
        <Callout tone="warn" testId="drep-inactive">
          {t("vote.warn.inactive")}
        </Callout>
      )}
      <ReviewRows testId="drep-facts">
        <Row label={t("contacts.nameLabel")} value={drep.name ? plainName(drep.name) : t("vote.noName")} strong />
        <Row label={t("vote.statusLabel")} value={status} />
        <Row label={t("activity.row.votingPower")} value={`${formatAda(drep.votingPower)}\u00a0₳`} />
        <Row label={t("pool.delegators")} value={drep.delegators.toLocaleString("en-US")} />
      </ReviewRows>
      <p className="note mono-id" data-testid="drep-id">
        {drep.id}
      </p>
      {shared > 1 && (
        <Callout tone="warn" testId="drep-shared-name">
          {t("vote.warn.sharedName", { shared: sharedDrepName({ shared, listed }) })}
        </Callout>
      )}
    </div>
  );
}
