// The public account as its own DRep (chunk 21), from the Staking page:
// become one, keep a profile, vote on the live governance actions, retire.
// Lace has no screens of its own for this (it hands GovTool the DRep key over
// CIP-95); these are the wallet's, so no site sees the key. Every change is
// built and signed by the worker and reviewed on the Staking page: nothing is
// sent until the user presses the review's button.
//
// What each reads: the DRep card, one `drep_info` (and `epoch_params` for the
// deposit, or `drep_metadata` for the profile's check); Governance actions,
// `proposal_list` (kept an hour on the device), `drep_info` and, for a DRep,
// `vote_list`. Writing a profile asks no one: the wallet writes the file and
// its hash, the user publishes it, and the wallet never fetches it. An
// action's full text is a link the user opens in a tab, never fetched here.

import { useEffect, useState } from "react";
import { type I18nKey, useT } from "../../i18n";

import { epochAt, IPFS_GATEWAY, type NetworkName } from "../../networks";
import type {
  Anchor,
  DrepProfileFile,
  DrepProfileRequest,
  GovAction,
  GovActionType,
  GovernanceView,
  GovVote,
  OwnDrep,
  StakeInfo,
} from "../../shared/rpc";
import { useAccounts } from "../accounts";
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CopyField } from "../components/CopyField";
import { ExplorerLink } from "../components/ExplorerLink";
import { ChevronRightIcon, DownloadIcon, ExternalIcon, LandmarkIcon } from "../components/Icons";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Hinted } from "../components/Hint";
import { Screen } from "../components/Screen";
import { dayText, epochEnds, formatAda, shortId, voteLabel } from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";
import { type Building, drepNeeds, KEY_DEPOSIT, ReadFailed } from "./Staking";

/** CIP-119's limits, in characters, as WebAssembly checks them too. */
export const MAX_GIVEN_NAME = 80;
export const MAX_PROFILE_TEXT = 1000;
/** The ledger's limit on an anchor's address, in bytes. */
export const MAX_ANCHOR_URL = 128;

const TYPES = {
  ParameterChange: "gov.type.parameterChange",
  HardForkInitiation: "gov.type.hardFork",
  TreasuryWithdrawals: "gov.type.treasury",
  NoConfidence: "gov.type.noConfidence",
  NewCommittee: "gov.type.committee",
  NewConstitution: "gov.type.constitution",
  InfoAction: "gov.type.info",
} as const satisfies Record<GovActionType, I18nKey>;

/** What a type means, behind the ⓘ by an action's title, where its name alone says little (GV-8). */
const GLOSSES = {
  InfoAction: "gov.gloss.info",
  TreasuryWithdrawals: "gov.gloss.treasury",
  NoConfidence: "gov.gloss.noConfidence",
  NewCommittee: "gov.gloss.committee",
} as const satisfies Partial<Record<GovActionType, I18nKey>>;

const VOTES = {
  yes: "gov.vote.yes",
  no: "gov.vote.no",
  abstain: "gov.vote.abstain",
} as const satisfies Record<GovVote, I18nKey>;

/** An action's type in words; one the ledger added since, as Koios names it. */
export function useActionType(): (type: string) => string {
  const t = useT();
  return (type) => (type in TYPES ? t(TYPES[type as GovActionType]) : type);
}

export function useVoteLabel(): (vote: GovVote) => string {
  const t = useT();
  return (vote) => t(VOTES[vote]);
}

/**
 * Votes this page sent, by network, public account and action, until a list
 * read from Koios shows them (chunk 23's second review, GV-6). Koios lists a
 * vote once it's on chain, so for the minutes between, the action said "Not
 * voted". Kept for the page's life only: after a reload the list says what
 * Koios says. The account is in the key because the map outlives the screens,
 * which start afresh on another account: each account is its own DRep, and one's
 * vote showed as another's.
 */
const sentVotes = new Map<string, GovVote>();
const sentKey = (network: NetworkName, account: number, id: string) => `${network}:${account}:${id}`;

export function rememberVote(network: NetworkName, account: number, id: string, vote: GovVote): void {
  sentVotes.set(sentKey(network, account, id), vote);
}

/** The vote this page sent on `id` from `account`, while it isn't the vote the list shows. */
export function sentVote(network: NetworkName, account: number, id: string, shown?: GovVote): GovVote | undefined {
  const sent = sentVotes.get(sentKey(network, account, id));
  return sent !== shown ? sent : undefined;
}

/** Forgets the sent votes a list read from Koios shows: they're on chain. */
function forgetShown(network: NetworkName, account: number, votes: Record<string, GovVote>): void {
  for (const [id, vote] of Object.entries(votes)) {
    if (sentVotes.get(sentKey(network, account, id)) === vote) sentVotes.delete(sentKey(network, account, id));
  }
}

/** A CID a gateway takes: v0 (`Qm…`), or v1 in base32 (`b…`), as anchors give them. */
const ANCHOR_CID = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,200})$/;

/**
 * Where Chrome can open an anchor's text, for the user to read in a tab: an
 * IPFS one (`ipfs://`, or a gateway's https address for a CID) through the
 * IPFS gateway the wallet already uses for an NFT's image (networks.ts
 * IPFS_GATEWAY). The wallet fetches none of it: it's a link, like the
 * explorer's (GV-2). Any other address is a host the proposer chose, which
 * the wallet doesn't send anyone to: it's given to copy, as an NFT's image on
 * another server is (privacy.md), and so is anything over http.
 */
export function readableUrl(url: string): string | undefined {
  const raw = url.trim();
  const subdomain = /^https:\/\/([0-9a-z]+)\.ipfs\.[^/?#\s]+(\/[^?#\s]*)?$/i.exec(raw);
  const at =
    /^ipfs:\/\/(?:ipfs\/)?([^?#\s]+)$/i.exec(raw)?.[1] ??
    (subdomain ? `${subdomain[1]}${subdomain[2] ?? ""}` : /^https:\/\/[^/?#\s@]+\/ipfs\/([^?#\s]+)$/i.exec(raw)?.[1]);
  if (!at) return undefined;
  const [cid, ...path] = at.split("/");
  if (!cid || !ANCHOR_CID.test(cid)) return undefined;
  const parts = path.filter((p) => p && p !== "." && p !== "..").map(encodeURIComponent);
  return `${IPFS_GATEWAY}/ipfs/${[cid, ...parts].join("/")}`;
}

/** What a profile's address must be: one the ledger takes, with nothing to misread. Undefined when it's fine. */
export function anchorUrlProblem(url: string): I18nKey | undefined {
  const trimmed = url.trim();
  if (!trimmed) return "drep.form.urlNeeded";
  if (/\s/.test(trimmed)) return "drep.form.urlSpaces";
  if (new TextEncoder().encode(trimmed).length > MAX_ANCHOR_URL) return "drep.form.urlTooLong";
  if (!/^(https?|ipfs):\/\/\S+$/i.test(trimmed)) return "drep.form.urlScheme";
  return undefined;
}

/** The DRep card on the Staking page: what being one means, or where this one stands. */
export function DrepCard({
  drep,
  error,
  onRetry,
  staking,
  blocked,
  building,
  onBecome,
  onActions,
  onProfile,
  onRetire,
  onDelegateOwn,
}: {
  drep?: OwnDrep;
  error?: string;
  /** Reads the DRep again, after a failed read. */
  onRetry?: () => void;
  staking: StakeInfo;
  blocked?: string;
  /** The control a build was started from, if any: only it says it's preparing (ST-1). */
  building?: Building;
  onBecome: () => void;
  onActions: () => void;
  onProfile: () => void;
  onRetire: () => void;
  /** Delegates the account's voting power to its own DRep, when it goes elsewhere. */
  onDelegateOwn: () => void;
}) {
  const t = useT();
  const network = useNetwork();
  const amounts = useAmounts();
  const busy = building !== undefined;
  const registered = drep?.status === "registered";
  return (
    <section className="section" aria-labelledby="drep-title" data-testid="drep-card">
      {/* What a DRep is, for an account that isn't one: behind the icon, the deposit on the page. Unread, the
          heading takes no side: a DRep whose read failed was offered "Be your own DRep" (ST-10). */}
      {drep && !registered ? (
        <Hinted text={t("drep.none.text")} testId="drep-none-text">
          <h2 id="drep-title">{t("drep.beOne")}</h2>
        </Hinted>
      ) : (
        <h2 id="drep-title">{t("drep.title")}</h2>
      )}
      {!drep ? (
        error ? (
          <>
            <ReadFailed what={t("drep.readFailed")} detail={error} onRetry={onRetry} testId="drep-read-failed" />
            {/* The actions are read on their own, so they're still there to read. */}
            <button type="button" className="secondary" onClick={onActions} disabled={busy}>
              {t("drep.actions")}
            </button>
          </>
        ) : (
          <p className="note">{t("drep.reading")}</p>
        )
      ) : registered ? (
        <>
          <ReviewRows testId="drep-facts">
            <Row
              label={t("drep.status")}
              value={
                drep.active && drep.expiresEpoch !== null
                  ? t("drep.status.active", { epoch: drep.expiresEpoch, date: epochEnds(network, drep.expiresEpoch) })
                  : t("drep.status.inactive")
              }
              strong
            />
            <Row label={t("drep.votingPower")} value={`${amounts.ada(drep.votingPower)}\u00a0₳`} />
            <Row label={t("drep.delegators")} value={drep.delegators.toLocaleString("en-US")} />
            <Row label={t("drep.profile")} value={drep.profile ? (drep.profile.name ?? shortId(drep.profile.url)) : t("drep.profile.none")} title={drep.profile?.url} />
            <Row label={t("activity.row.deposit")} value={`${formatAda(drep.deposit)}\u00a0₳`} />
          </ReviewRows>
          {/* What "active until" asks of it (GV-7). */}
          {drep.active && (
            <p className="note" data-testid="drep-duty">
              {t("drep.duty")}
            </p>
          )}
          <CopyField label={t("staking.drepId")} copyLabel={t("drep.copyId")} value={drep.id} display={shortId(drep.id)} testId="drep-id" />
          {!drep.active && (
            <Callout tone="warn" testId="drep-inactive">
              {t("drep.warn.inactive")}
            </Callout>
          )}
          {drep.profile?.valid === false && (
            <Callout tone="warn" testId="drep-profile-invalid">
              {t("drep.warn.profileInvalid")}
            </Callout>
          )}
          {staking.drep !== drep.id && (
            <div className="stack-tight" data-testid="drep-not-own-vote">
              <p className="note">{t("drep.notOwnVote", { current: voteLabel(staking.drep) })}</p>
              <button type="button" className="secondary align-start" onClick={onDelegateOwn} disabled={!!blocked || busy} title={blocked}>
                {building === "delegate-own" ? t("drep.building.delegateOwn") : t("drep.delegateOwn")}
              </button>
            </div>
          )}
          <button type="button" className="primary" onClick={onActions} disabled={busy}>
            {t("drep.actions")}
          </button>
          <ul className="list">
            <li>
              <button type="button" className="menu-row" onClick={onProfile} disabled={!!blocked || busy} title={blocked}>
                <span className="menu-row__icon">
                  <LandmarkIcon size={16} />
                </span>
                <span>{t("drep.editProfile")}</span>
                <ChevronRightIcon size={16} />
              </button>
            </li>
            <li>
              {/* Red, as Stop staking's is: its review lists what ends (chunk 23's second review, ST-3, V-3). No
                  bin: retiring deletes nothing, and gives the deposit back. */}
              <button
                type="button"
                className="menu-row menu-row--danger"
                onClick={onRetire}
                disabled={!!blocked || busy}
                title={blocked}
              >
                <span className="menu-row__icon">
                  <LandmarkIcon size={16} />
                </span>
                <span>{building === "retire" ? t("drep.building.retire") : t("drep.retire")}</span>
                <ChevronRightIcon size={16} />
              </button>
            </li>
          </ul>
        </>
      ) : (
        <>
          {drep.status === "retired" && <p className="note">{t("drep.retired.text")}</p>}
          <p className="note" data-testid="drep-deposit-note">
            {drep.depositNow
              ? t("drep.none.deposit", { amount: formatAda(drep.depositNow) })
              : t("drep.none.depositUnknown")}
          </p>
          <div className="actions">
            {/* Secondary: it locks a deposit and few need it, so it isn't the page's brightest button (chunk 23's
                review, ST-2). */}
            <button type="button" className="secondary" onClick={onBecome} disabled={!!blocked || busy} title={blocked}>
              {t("drep.become")}
            </button>
            <button type="button" className="secondary" onClick={onActions} disabled={busy}>
              {t("drep.actions")}
            </button>
          </div>
        </>
      )}
      {/* That private money carries no voting power is said in the page's own privacy note, which said the same
          beside this one (chunk 23's second review, ST-7); Become a DRep keeps it. */}
    </section>
  );
}

/** Becoming the account's own DRep: the self-delegation (on), and a profile only if one is asked for. */
export function BecomeDrep({
  drep,
  staking,
  spendable,
  blocked,
  busy,
  error,
  onBack,
  onReview,
}: {
  drep: OwnDrep;
  staking: StakeInfo;
  /** What the account can spend (lovelace, rewards aside), as Home read it: checked against the deposit first. */
  spendable?: string;
  blocked?: string;
  busy: boolean;
  error?: string;
  onBack: () => void;
  onReview: (delegate: boolean, anchor?: Anchor) => void;
}) {
  const t = useT();
  const amounts = useAmounts();
  const [delegate, setDelegate] = useState(true);
  const [withProfile, setWithProfile] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>();
  const ready = !withProfile || anchor !== undefined;
  // Too little for the deposit, said before Review rather than after a 10 s build with no amounts (GV-7).
  const need = drep.depositNow ? drepNeeds(drep.depositNow, delegate, staking.registered) : undefined;
  const locks = drep.depositNow ? BigInt(drep.depositNow) + (delegate && !staking.registered ? KEY_DEPOSIT : 0n) : 0n;
  const short =
    need !== undefined && spendable !== undefined && BigInt(spendable) <= need
      ? t("drep.register.short", {
          need: formatAda(need.toString()),
          deposit: formatAda(locks.toString()),
          have: amounts.ada(spendable),
        })
      : undefined;
  const why = blocked ?? short ?? (ready ? undefined : t("drep.form.finishFirst"));
  return (
    <Screen
      title={t("drep.register.title")}
      titleId="drep-register-title"
      hint={t("drep.none.text")}
      hintTestId="drep-register-note"
      onBack={onBack}
      backDisabled={busy}
      error={error}
      foot={
        <button
          type="button"
          className="primary"
          onClick={() => onReview(delegate, withProfile ? anchor : undefined)}
          disabled={!!why || busy}
          title={why}
        >
          {busy ? t("common.building") : t("drep.register.review")}
        </button>
      }
    >
      <p className="note">
        {drep.depositNow ? t("drep.none.deposit", { amount: formatAda(drep.depositNow) }) : t("drep.none.depositUnknown")}
      </p>
      {short && (
        <p className="field-note" data-testid="drep-register-short">
          {short}
        </p>
      )}
      <p className="note" data-testid="drep-register-duty">
        {t("drep.duty")}
      </p>
      <div className="setting-row">
        <span className="stack-tight">
          <span id="drep-delegate-label">{t("drep.register.delegate")}</span>
          <span className="note" id="drep-delegate-note" data-testid="drep-delegate-note">
            {delegate
              ? t("drep.register.delegateOn", { current: voteLabel(staking.drep) })
              : t("drep.register.delegateOff", { current: voteLabel(staking.drep) })}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={delegate}
          aria-labelledby="drep-delegate-label"
          aria-describedby="drep-delegate-note"
          onClick={() => setDelegate(!delegate)}
          disabled={busy}
        />
      </div>

      <section className="section" aria-labelledby="drep-profile-title">
        <Hinted text={t("drep.register.profileNote")} testId="drep-profile-note">
          <h2 id="drep-profile-title">{t("drep.register.profile")}</h2>
        </Hinted>
        {withProfile ? (
          <>
            <ProfileForm onAnchor={setAnchor} busy={busy} />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setWithProfile(false);
                setAnchor(undefined);
              }}
              disabled={busy}
            >
              {t("drep.register.noProfile")}
            </button>
          </>
        ) : (
          <button type="button" className="secondary" onClick={() => setWithProfile(true)} disabled={busy}>
            {t("drep.register.addProfile")}
          </button>
        )}
      </section>

      <Callout tone="privacy" testId="drep-public">
        {t("drep.privacy.public")}
      </Callout>
      <Callout tone="privacy">{t("drep.privacy.noPower")}</Callout>
    </Screen>
  );
}

/** Changing the DRep's profile, or taking it away: an update keeps the DRep active, as a vote does. */
export function DrepProfileEdit({
  drep,
  blocked,
  building,
  error,
  onBack,
  onReview,
}: {
  drep: OwnDrep;
  blocked?: string;
  /** Which of the two buttons a build was started from: only it says so (ST-1). */
  building?: Building;
  error?: string;
  onBack: () => void;
  onReview: (anchor?: Anchor) => void;
}) {
  const t = useT();
  const busy = building !== undefined;
  const [anchor, setAnchor] = useState<Anchor>();
  return (
    <Screen title={t("drep.update.title")} titleId="drep-update-title" onBack={onBack} backDisabled={busy} error={error}>
      <ReviewRows testId="drep-profile-now">
        <Row
          label={t("drep.update.now")}
          value={drep.profile ? (drep.profile.name ?? shortId(drep.profile.url)) : t("drep.profile.none")}
          title={drep.profile?.url}
          strong
        />
      </ReviewRows>
      {drep.profile && <CopyField label={t("drep.update.url")} copyLabel={t("gov.copyAddress")} value={drep.profile.url} testId="drep-profile-url" />}
      <p className="note">{t("drep.update.note")}</p>
      <ProfileForm onAnchor={setAnchor} busy={busy} />
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => anchor && onReview(anchor)}
          disabled={!anchor || !!blocked || busy}
          title={blocked ?? (anchor ? undefined : t("drep.form.finishFirst"))}
        >
          {building === "review" ? t("common.building") : t("drep.update.review")}
        </button>
        {drep.profile && (
          <button type="button" className="secondary" onClick={() => onReview(undefined)} disabled={!!blocked || busy} title={blocked}>
            {building === "remove-profile" ? t("common.building") : t("drep.update.remove")}
          </button>
        )}
      </div>
      <Callout tone="privacy">{t("drep.privacy.profile")}</Callout>
    </Screen>
  );
}

const EMPTY_PROFILE: DrepProfileRequest = { givenName: "", objectives: "", motivations: "", qualifications: "", doNotList: true };

/**
 * A profile: CIP-119's name and three texts, written into a file by the
 * wallet for the user to publish. The anchor (`onAnchor`) is there only once
 * the file is written, matches the text on screen, and where it's published
 * is given. An edit after writing marks the file out of date, keeping the
 * address given, where it used to clear the file and hide the address with it
 * (GV-7); written again, a file that came out different says so, since the
 * one published at that address no longer matches.
 */
function ProfileForm({ onAnchor, busy }: { onAnchor: (anchor?: Anchor) => void; busy: boolean }) {
  const t = useT();
  const [profile, setProfile] = useState<DrepProfileRequest>(EMPTY_PROFILE);
  const [file, setFile] = useState<DrepProfileFile>();
  // The text changed since the file was written: the file isn't the profile any more.
  const [stale, setStale] = useState(false);
  // Written again with an address already given, and the file came out different.
  const [changed, setChanged] = useState(false);
  const [url, setUrl] = useState("");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string>();

  const chars = (s?: string) => [...(s ?? "")].length;
  const problem: I18nKey | undefined = !profile.givenName.trim()
    ? "drep.form.nameNeeded"
    : chars(profile.givenName.trim()) > MAX_GIVEN_NAME
      ? "drep.form.nameTooLong"
      : [profile.objectives, profile.motivations, profile.qualifications].some((x) => chars(x?.trim()) > MAX_PROFILE_TEXT)
        ? "drep.form.textTooLong"
        : undefined;
  const urlProblem = file ? anchorUrlProblem(url) : undefined;

  useEffect(() => {
    onAnchor(file && !stale && !anchorUrlProblem(url) ? { url: url.trim(), hash: file.hash } : undefined);
  }, [file, stale, url, onAnchor]);

  const edit = (change: Partial<DrepProfileRequest>) => {
    setProfile({ ...profile, ...change });
    if (file) setStale(true);
  };

  async function write() {
    if (problem || writing) return;
    setWriting(true);
    setError(undefined);
    try {
      // The fields are locked meanwhile, so the file is the text on screen.
      const next = await call("drep-profile", { profile });
      setChanged(file !== undefined && next.hash !== file.hash && url.trim() !== "");
      setFile(next);
      setStale(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWriting(false);
    }
  }

  function save() {
    if (!file) return;
    const href = URL.createObjectURL(new Blob([file.file], { type: "application/ld+json" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = "drep-profile.jsonld";
    a.click();
    URL.revokeObjectURL(href);
  }

  const text = (key: "objectives" | "motivations" | "qualifications", label: I18nKey) => (
    <div className="field">
      <label htmlFor={`drep-${key}`}>{t(label)}</label>
      <textarea
        id={`drep-${key}`}
        rows={3}
        value={profile[key] ?? ""}
        onChange={(e) => edit({ [key]: e.target.value })}
        autoComplete="off"
        spellCheck={false}
        disabled={busy || writing}
      />
    </div>
  );

  const writeButton = (
    <button type="button" className="secondary" onClick={() => void write()} disabled={!!problem || writing || busy}>
      {t(file ? "drep.form.writeAgain" : "drep.form.write")}
    </button>
  );

  return (
    <div className="stack" data-testid="drep-profile-form">
      <div className="field">
        <label htmlFor="drep-name">{t("drep.form.name")}</label>
        <input
          id="drep-name"
          value={profile.givenName}
          onChange={(e) => edit({ givenName: e.target.value })}
          autoComplete="off"
          // As every field in the wallet: Chrome's enhanced spell check would send it to Google.
          spellCheck={false}
          disabled={busy || writing}
        />
      </div>
      {text("objectives", "drep.form.objectives")}
      {text("motivations", "drep.form.motivations")}
      {text("qualifications", "drep.form.qualifications")}
      <div className="setting-row">
        <span className="stack-tight">
          <span id="drep-do-not-list-label">{t("drep.form.doNotList")}</span>
          <span className="note" id="drep-do-not-list-note">
            {t(profile.doNotList ? "drep.form.doNotListOn" : "drep.form.doNotListOff")}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={profile.doNotList}
          aria-labelledby="drep-do-not-list-label"
          aria-describedby="drep-do-not-list-note"
          onClick={() => edit({ doNotList: !profile.doNotList })}
          disabled={busy || writing}
        />
      </div>
      {problem && profile !== EMPTY_PROFILE && <p className="field-note">{t(problem, { most: problem === "drep.form.nameTooLong" ? MAX_GIVEN_NAME : MAX_PROFILE_TEXT })}</p>}
      {error && <p className="field-note">{error}</p>}
      {!file ? (
        writeButton
      ) : (
        <div className="stack-tight" data-testid="drep-profile-file">
          {stale ? (
            <>
              <p className="field-note" data-testid="drep-profile-stale">
                {t("drep.form.stale")}
              </p>
              {writeButton}
            </>
          ) : (
            <>
              <p className="note">{t("drep.form.publish")}</p>
              <button type="button" className="secondary" onClick={save} disabled={busy}>
                <DownloadIcon size={14} /> {t("drep.form.save")}
              </button>
              <CopyField label={t("drep.form.hash")} copyLabel={t("drep.form.copyHash")} value={file.hash} display={shortId(file.hash)} testId="drep-profile-hash" />
            </>
          )}
          <div className="field">
            <label htmlFor="drep-url">{t("drep.form.url")}</label>
            <input
              id="drep-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setChanged(false);
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={url && urlProblem ? true : undefined}
              aria-describedby="drep-url-note"
              disabled={busy}
            />
            <p className={url && urlProblem ? "field-note" : "note"} id="drep-url-note" data-testid="drep-url-note">
              {url && urlProblem
                ? t(urlProblem, { most: MAX_ANCHOR_URL })
                : changed && !stale
                  ? t("drep.form.fileChanged")
                  : t("drep.form.urlNote", { most: MAX_ANCHOR_URL })}
            </p>
          </div>
        </div>
      )}
      <Callout tone="privacy" testId="drep-profile-public">
        {t("drep.privacy.profile")}
      </Callout>
    </div>
  );
}

/** "12 Sept 2026", as the wallet writes an epoch's end (format.ts `epochEnds`). */
const dayOf = dayText;

/**
 * An action told apart from its neighbours at a glance: its transaction's first characters and its index. The vote's
 * review names it the same way (Staking.tsx), as Transaction details begins it. A word joiner keeps it on one line:
 * the review broke it after the ellipsis, "53fbef38…" over "#0" (the pass-two visual review).
 */
export const shortAction = (a: Pick<GovAction, "txHash" | "index">) => `${a.txHash.slice(0, 8)}…\u2060#${a.index}`;

/** What a treasury withdrawal pays out, all of it. */
const paidOut = (a: GovAction) => (a.withdrawals ?? []).reduce((sum, w) => sum + BigInt(w.amount), 0n);

/**
 * The live governance actions: each one's own words (as Koios read them from
 * its anchor), when it closes, and this DRep's vote on it. A DRep votes from
 * an action's details; anyone else reads them, with Become a DRep.
 */
export function GovActions({
  building,
  blocked,
  waiting = false,
  sent,
  error,
  onBack,
  onBecome,
  onVote,
  view,
  onView,
  open,
  onOpen,
}: {
  /** The vote a build was started from, if any: only its button says so (ST-1). */
  building?: Building;
  blocked?: string;
  /** A transaction is on its way: a vote this page sent and Koios doesn't list yet is said to be (GV-6). */
  waiting?: boolean;
  /** The vote just sent from the action open. */
  sent?: { id: string; vote: GovVote };
  error?: string;
  onBack: () => void;
  onBecome: () => void;
  onVote: (action: GovAction, vote: GovVote, before?: GovVote) => void;
  /** What was read, and the action open, kept by the Staking page: back from a vote's review, both are as they were. */
  view?: GovernanceView;
  onView: (view: GovernanceView) => void;
  open?: GovAction;
  onOpen: (action?: GovAction) => void;
}) {
  const t = useT();
  const network = useNetwork();
  const { active } = useAccounts();
  const typeOf = useActionType();
  const voteOf = useVoteLabel();
  const busy = building !== undefined;
  const [reading, setReading] = useState(view === undefined);
  const [readError, setReadError] = useState<string>();
  const setOpen = onOpen;

  function read(refresh: boolean) {
    setReading(true);
    setReadError(undefined);
    call("governance", { refresh }).then(
      (v) => {
        onView(v);
        setReading(false);
      },
      (e: Error) => {
        setReadError(e.message);
        setReading(false);
      },
    );
  }
  // Read once: a view kept from before (back from a vote's review) is shown as it was, with Refresh.
  useEffect(() => {
    if (!view) read(false);
  }, []);
  // A vote Koios lists now is on chain: this page stops saying it's on its way.
  useEffect(() => {
    if (view) forgetShown(network, active, view.votes);
  }, [view, network, active]);

  const registered = view?.drep.status === "registered";
  const now = epochAt(network, Date.now());
  // The vote this page sent on an action, while a transaction is on its way and Koios doesn't list it yet.
  const onItsWay = (id: string) => (waiting ? sentVote(network, active, id, view?.votes[id]) : undefined);

  if (open) {
    const mine = view?.votes[open.id];
    const coming = onItsWay(open.id);
    // Read up to an hour ago, it may have closed since: the ledger would refuse a vote.
    const closed = open.expiresEpoch < now;
    const gloss = open.type in GLOSSES ? t(GLOSSES[open.type as keyof typeof GLOSSES]) : undefined;
    const readable = open.anchor ? readableUrl(open.anchor.url) : undefined;
    const paid = paidOut(open);
    return (
      <Screen
        title={open.title ?? typeOf(open.type)}
        titleId="gov-action-title"
        hint={gloss}
        hintTestId="gov-type-gloss"
        onBack={() => setOpen(undefined)}
        backDisabled={busy}
        error={error}
      >
        <ReviewRows testId="gov-action">
          <Row label={t("gov.details.type")} value={typeOf(open.type)} strong />
          {/* What a treasury withdrawal pays, and to whom: it showed neither (GV-2). */}
          {paid > 0n && (
            <Row label={t("common.amount")} value={`${formatAda(paid.toString())}\u00a0₳`} strong testId="gov-amount" />
          )}
          {(open.withdrawals ?? []).map((w, i) => (
            <Row key={`${w.to}-${i}`} label={t("activity.row.to")} value={w.to} whole testId="gov-to" />
          ))}
          <Row label={t("gov.details.closes")} value={closes(t, network, open.expiresEpoch, now)} />
          <Row
            label={t("gov.details.proposed")}
            value={
              open.proposedAt !== undefined
                ? t("gov.details.proposedOn", { date: dayOf(open.proposedAt), epoch: open.proposedEpoch })
                : t("gov.details.proposedIn", { epoch: open.proposedEpoch })
            }
          />
          <Row label={t("gov.details.deposit")} value={`${formatAda(open.deposit)}\u00a0₳`} />
          {registered && (
            <Row
              label={t("gov.details.yourVote")}
              value={coming ? t("gov.vote.onItsWay", { vote: voteOf(coming) }) : mine ? voteOf(mine) : t("gov.notVoted")}
              strong
            />
          )}
        </ReviewRows>
        {open.abstract ? (
          <p className="gov-abstract" data-testid="gov-abstract">
            {open.abstract}
          </p>
        ) : (
          <p className="note">{t(open.anchor ? "gov.noText" : "gov.noTextNoAnchor")}</p>
        )}
        {open.anchorValid === false && (
          <Callout tone="warn" testId="gov-anchor-invalid">
            {t("gov.warn.anchorInvalid")}
          </Callout>
        )}
        {/* Its text, in a tab Chrome can open: an ipfs:// address was a link to nowhere (GV-2). The wallet never
            fetches it, and the line under it says who sees it opened. Any other address is the anchor's, to copy. */}
        {readable && (
          <div className="stack-tight" data-testid="gov-text-link">
            <a className="menu-link" href={readable} target="_blank" rel="noreferrer" aria-describedby="gov-text-note">
              {t("gov.readText")}
              <ExternalIcon size={12} />
            </a>
            <p className="note" id="gov-text-note">
              {t("gov.privacy.textGateway")}
            </p>
          </div>
        )}
        <CopyField label={t("gov.details.id")} copyLabel={t("gov.copyId")} value={open.id} display={shortId(open.id)} testId="gov-action-id" />
        {open.anchor && (
          <CopyField label={t("gov.details.anchor")} copyLabel={t("gov.copyAddress")} value={open.anchor.url} testId="gov-anchor" />
        )}
        <ExplorerLink network={network} tx={open.txHash}>
          {t("gov.explorer")}
        </ExplorerLink>
        {registered ? (
          <section className="section" aria-labelledby="gov-vote-title">
            <h2 id="gov-vote-title">{t("gov.vote.title")}</h2>
            {/* Sent, it stays here and says so, where it went to Home and the action still said "Not voted" (GV-6). */}
            {sent?.id === open.id ? (
              <p className="note" role="status" data-testid="gov-vote-sent">
                {t("gov.vote.sent", { vote: voteOf(sent.vote) })}
              </p>
            ) : (
              blocked && (
                <p className="note" role="status" data-testid="gov-vote-blocked">
                  {blocked}
                </p>
              )
            )}
            {mine && !coming && <p className="note">{t("gov.vote.change", { vote: voteOf(mine) })}</p>}
            <div className="actions" data-testid="gov-vote-buttons">
              {(["yes", "no", "abstain"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={v === mine ? "secondary" : "primary"}
                  onClick={() => onVote(open, v, mine)}
                  disabled={closed || v === mine || !!blocked || busy}
                  title={blocked ?? (closed ? t("gov.closed") : v === mine ? t("gov.vote.already") : undefined)}
                >
                  {/* The pressed one says so; the others keep their names (ST-1). */}
                  {building === v ? t("gov.vote.building", { vote: voteOf(v) }) : voteOf(v)}
                </button>
              ))}
            </div>
            {!view?.drep.active && <p className="note">{t("gov.vote.reactivates")}</p>}
            <Callout tone="privacy" testId="gov-vote-public">
              {t("gov.privacy.vote")}
            </Callout>
          </section>
        ) : (
          <NotADrep onBecome={onBecome} blocked={blocked} busy={busy} />
        )}
      </Screen>
    );
  }

  const actions = view?.list.actions ?? [];
  return (
    <Screen title={t("gov.title")} titleId="gov-title" onBack={onBack} backDisabled={busy} error={error}>
      <RefreshRow reading={reading} updatedAt={view?.list.updatedAt} onRefresh={() => read(true)} />
      {readError && (
        <ReadFailed what={t("gov.readFailed")} detail={readError} onRetry={() => read(false)} testId="gov-read-failed" />
      )}
      {view && !registered && <NotADrep onBecome={onBecome} blocked={blocked} busy={busy} />}
      {view && actions.length === 0 && <p className="note">{t("gov.none")}</p>}
      {/* In a card, as Settings' lists are, with the chevrons in one column: with no icon, a row's text fell into the
          icon's column and its chevron landed wherever the text ended (the pass-two visual review). */}
      {actions.length > 0 && (
        <div className="section">
          <ul className="list" data-testid="gov-actions">
            {actions.map((a) => {
              const mine = view?.votes[a.id];
              const coming = onItsWay(a.id);
              const paid = paidOut(a);
              // Rows that differed only in type and date: each has its ID and when it was proposed, and a treasury
              // withdrawal its amount (chunk 23's second review, GV-1).
              const about = [
                ...(a.title ? [typeOf(a.type)] : []),
                ...(paid > 0n ? [`${formatAda(paid.toString())}\u00a0₳`] : []),
                closes(t, network, a.expiresEpoch, now),
              ].join(" · ");
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className="menu-row menu-row--plain"
                    onClick={() => setOpen(a)}
                    data-testid="gov-action-row"
                  >
                    <span className="stack-tight">
                      <span>{a.title ?? typeOf(a.type)}</span>
                      <span className="note">{about}</span>
                      <span className="note" data-testid="gov-action-when">
                        {a.proposedAt !== undefined
                          ? t("gov.row.proposedOn", { id: shortAction(a), date: dayOf(a.proposedAt) })
                          : t("gov.row.proposedIn", { id: shortAction(a), epoch: a.proposedEpoch })}
                      </span>
                      {registered && (
                        <span className="note" data-testid="gov-your-vote">
                          {coming
                            ? t("gov.yourVote", { vote: t("gov.vote.onItsWay", { vote: voteOf(coming) }) })
                            : mine
                              ? t("gov.yourVote", { vote: voteOf(mine) })
                              : t("gov.notVoted")}
                        </span>
                      )}
                    </span>
                    <ChevronRightIcon size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Screen>
  );
}

/** When an action closes, against the epoch it is now: no request. The date first, the epoch after it (ST-12). */
function closes(t: ReturnType<typeof useT>, network: Parameters<typeof epochEnds>[0], epoch: number, now: number): string {
  if (epoch < now) return t("gov.closed");
  if (epoch === now) return t("gov.closesThisEpoch", { date: epochEnds(network, now) });
  return t("gov.closes", { epoch, date: epochEnds(network, epoch) });
}

function NotADrep({ onBecome, blocked, busy }: { onBecome: () => void; blocked?: string; busy: boolean }) {
  const t = useT();
  return (
    <div className="stack-tight" data-testid="gov-not-drep">
      <p className="note">{t("gov.notDrep")}</p>
      <button type="button" className="secondary" onClick={onBecome} disabled={!!blocked || busy} title={blocked}>
        {t("drep.become")}
      </button>
    </div>
  );
}
