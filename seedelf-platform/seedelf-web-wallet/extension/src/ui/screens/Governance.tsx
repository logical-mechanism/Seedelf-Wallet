// The public account as its own DRep (chunk 21), from the Staking page:
// become one, keep a profile, vote on the live governance actions, retire.
// Lace has no screens of its own for this (it hands GovTool the DRep key over
// CIP-95); these are the wallet's, so no site sees the key. Every change is
// built and signed by the worker and reviewed on the Staking page: nothing is
// sent until the user presses Send.
//
// What each reads: the DRep card, one `drep_info` (and `epoch_params` for the
// deposit, or `drep_metadata` for the profile's check); Governance actions,
// `proposal_list` (kept an hour on the device), `drep_info` and, for a DRep,
// `vote_list`. Writing a profile asks no one: the wallet writes the file and
// its hash, the user publishes it, and the wallet never fetches it.

import { useEffect, useState } from "react";
import { type I18nKey, useT } from "../../i18n";

import { epochAt } from "../../networks";
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
import { call } from "../background";
import { Callout } from "../components/Callout";
import { CopyField } from "../components/CopyField";
import { ExplorerLink } from "../components/ExplorerLink";
import { ChevronRightIcon, DownloadIcon, LandmarkIcon, TrashIcon } from "../components/Icons";
import { RefreshRow } from "../components/RefreshRow";
import { ReviewRows, Row } from "../components/ReviewRows";
import { Screen } from "../components/Screen";
import { epochEnds, formatAda, shortId, voteLabel } from "../format";
import { useNetwork } from "../network";
import { useAmounts } from "../preferences";

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
  staking,
  blocked,
  busy,
  onBecome,
  onActions,
  onProfile,
  onRetire,
}: {
  drep?: OwnDrep;
  error?: string;
  staking: StakeInfo;
  blocked?: string;
  busy: boolean;
  onBecome: () => void;
  onActions: () => void;
  onProfile: () => void;
  onRetire: () => void;
}) {
  const t = useT();
  const network = useNetwork();
  const amounts = useAmounts();
  const registered = drep?.status === "registered";
  return (
    <section className="section" aria-labelledby="drep-title" data-testid="drep-card">
      <h2 id="drep-title">{t(registered ? "drep.title" : "drep.beOne")}</h2>
      {!drep ? (
        <p className="note">{error ? t("drep.readFailed", { error }) : t("drep.reading")}</p>
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
            <Row label={t("drep.votingPower")} value={`${amounts.ada(drep.votingPower)} ₳`} />
            <Row label={t("drep.delegators")} value={drep.delegators.toLocaleString("en-US")} />
            <Row label={t("drep.profile")} value={drep.profile ? (drep.profile.name ?? shortId(drep.profile.url)) : t("drep.profile.none")} title={drep.profile?.url} />
            <Row label={t("activity.row.deposit")} value={`${formatAda(drep.deposit)} ₳`} />
          </ReviewRows>
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
            <p className="note" data-testid="drep-not-own-vote">
              {t("drep.notOwnVote", { current: voteLabel(staking.drep) })}
            </p>
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
              <button
                type="button"
                className="menu-row menu-row--danger"
                onClick={onRetire}
                disabled={!!blocked || busy}
                title={blocked}
              >
                <span className="menu-row__icon">
                  <TrashIcon size={16} />
                </span>
                <span>{t("drep.retire")}</span>
                <ChevronRightIcon size={16} />
              </button>
            </li>
          </ul>
        </>
      ) : (
        <>
          <p className="note">{t("drep.none.text")}</p>
          {drep.status === "retired" && <p className="note">{t("drep.retired.text")}</p>}
          <p className="note" data-testid="drep-deposit-note">
            {drep.depositNow
              ? t("drep.none.deposit", { amount: formatAda(drep.depositNow) })
              : t("drep.none.depositUnknown")}
          </p>
          <div className="actions">
            <button type="button" className="primary" onClick={onBecome} disabled={!!blocked || busy} title={blocked}>
              {t("drep.become")}
            </button>
            <button type="button" className="secondary" onClick={onActions} disabled={busy}>
              {t("drep.actions")}
            </button>
          </div>
        </>
      )}
      {drep && (
        <Callout tone="privacy" testId="drep-no-power">
          {t("drep.privacy.noPower")}
        </Callout>
      )}
    </section>
  );
}

/** Becoming the account's own DRep: the self-delegation (on), and a profile only if one is asked for. */
export function BecomeDrep({
  drep,
  staking,
  blocked,
  busy,
  error,
  onBack,
  onReview,
}: {
  drep: OwnDrep;
  staking: StakeInfo;
  blocked?: string;
  busy: boolean;
  error?: string;
  onBack: () => void;
  onReview: (delegate: boolean, anchor?: Anchor) => void;
}) {
  const t = useT();
  const [delegate, setDelegate] = useState(true);
  const [withProfile, setWithProfile] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>();
  const ready = !withProfile || anchor !== undefined;
  const why = blocked ?? (ready ? undefined : t("drep.form.finishFirst"));
  return (
    <Screen
      title={t("drep.register.title")}
      titleId="drep-register-title"
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
      <p className="note">{t("drep.none.text")}</p>
      <p className="note">
        {drep.depositNow ? t("drep.none.deposit", { amount: formatAda(drep.depositNow) }) : t("drep.none.depositUnknown")}
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
        <h2 id="drep-profile-title">{t("drep.register.profile")}</h2>
        <p className="note">{t("drep.register.profileNote")}</p>
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
  busy,
  error,
  onBack,
  onReview,
}: {
  drep: OwnDrep;
  blocked?: string;
  busy: boolean;
  error?: string;
  onBack: () => void;
  onReview: (anchor?: Anchor) => void;
}) {
  const t = useT();
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
          {busy ? t("common.building") : t("drep.update.review")}
        </button>
        {drep.profile && (
          <button type="button" className="secondary" onClick={() => onReview(undefined)} disabled={!!blocked || busy} title={blocked}>
            {t("drep.update.remove")}
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
 * the file is written and where it's published is given; any edit after
 * writing it takes it away, since the file no longer matches.
 */
function ProfileForm({ onAnchor, busy }: { onAnchor: (anchor?: Anchor) => void; busy: boolean }) {
  const t = useT();
  const [profile, setProfile] = useState<DrepProfileRequest>(EMPTY_PROFILE);
  const [file, setFile] = useState<DrepProfileFile>();
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
    onAnchor(file && !anchorUrlProblem(url) ? { url: url.trim(), hash: file.hash } : undefined);
  }, [file, url, onAnchor]);

  const edit = (change: Partial<DrepProfileRequest>) => {
    setProfile({ ...profile, ...change });
    setFile(undefined);
  };

  async function write() {
    if (problem || writing) return;
    setWriting(true);
    setError(undefined);
    try {
      setFile(await call("drep-profile", { profile }));
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
        disabled={busy}
      />
    </div>
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
          disabled={busy}
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
          disabled={busy}
        />
      </div>
      {problem && profile !== EMPTY_PROFILE && <p className="field-note">{t(problem, { most: problem === "drep.form.nameTooLong" ? MAX_GIVEN_NAME : MAX_PROFILE_TEXT })}</p>}
      {error && <p className="field-note">{error}</p>}
      {!file ? (
        <button type="button" className="secondary" onClick={() => void write()} disabled={!!problem || writing || busy}>
          {t("drep.form.write")}
        </button>
      ) : (
        <div className="stack-tight" data-testid="drep-profile-file">
          <p className="note">{t("drep.form.publish")}</p>
          <button type="button" className="secondary" onClick={save} disabled={busy}>
            <DownloadIcon size={14} /> {t("drep.form.save")}
          </button>
          <CopyField label={t("drep.form.hash")} copyLabel={t("drep.form.copyHash")} value={file.hash} display={shortId(file.hash)} testId="drep-profile-hash" />
          <div className="field">
            <label htmlFor="drep-url">{t("drep.form.url")}</label>
            <input
              id="drep-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={url && urlProblem ? true : undefined}
              aria-describedby="drep-url-note"
              disabled={busy}
            />
            <p className={url && urlProblem ? "field-note" : "note"} id="drep-url-note" data-testid="drep-url-note">
              {url && urlProblem ? t(urlProblem, { most: MAX_ANCHOR_URL }) : t("drep.form.urlNote", { most: MAX_ANCHOR_URL })}
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

/**
 * The live governance actions: each one's own words (as Koios read them from
 * its anchor), when it closes, and this DRep's vote on it. A DRep votes from
 * an action's details; anyone else reads them, with Become a DRep.
 */
export function GovActions({
  busy,
  blocked,
  error,
  onBack,
  onBecome,
  onVote,
}: {
  busy: boolean;
  blocked?: string;
  error?: string;
  onBack: () => void;
  onBecome: () => void;
  onVote: (action: GovAction, vote: GovVote, before?: GovVote) => void;
}) {
  const t = useT();
  const network = useNetwork();
  const typeOf = useActionType();
  const voteOf = useVoteLabel();
  const [view, setView] = useState<GovernanceView>();
  const [reading, setReading] = useState(true);
  const [readError, setReadError] = useState<string>();
  const [open, setOpen] = useState<GovAction>();

  function read(refresh: boolean) {
    setReading(true);
    setReadError(undefined);
    call("governance", { refresh }).then(
      (v) => {
        setView(v);
        setReading(false);
      },
      (e: Error) => {
        setReadError(e.message);
        setReading(false);
      },
    );
  }
  useEffect(() => read(false), []);

  const registered = view?.drep.status === "registered";
  const now = epochAt(network, Date.now());

  if (open) {
    const mine = view?.votes[open.id];
    return (
      <Screen
        title={open.title ?? typeOf(open.type)}
        titleId="gov-action-title"
        onBack={() => setOpen(undefined)}
        backDisabled={busy}
        error={error}
      >
        <ReviewRows testId="gov-action">
          <Row label={t("gov.details.type")} value={typeOf(open.type)} strong />
          <Row label={t("gov.details.closes")} value={closes(t, network, open.expiresEpoch, now)} />
          <Row label={t("gov.details.proposed")} value={String(open.proposedEpoch)} />
          <Row label={t("gov.details.deposit")} value={`${formatAda(open.deposit)} ₳`} />
          {registered && <Row label={t("gov.details.yourVote")} value={mine ? voteOf(mine) : t("gov.notVoted")} strong />}
        </ReviewRows>
        {open.abstract ? (
          <p className="gov-abstract" data-testid="gov-abstract">
            {open.abstract}
          </p>
        ) : (
          <p className="note">{t("gov.noText")}</p>
        )}
        {open.anchorValid === false && (
          <Callout tone="warn" testId="gov-anchor-invalid">
            {t("gov.warn.anchorInvalid")}
          </Callout>
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
            {mine && <p className="note">{t("gov.vote.change", { vote: voteOf(mine) })}</p>}
            <div className="actions" data-testid="gov-vote-buttons">
              {(["yes", "no", "abstain"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={v === mine ? "secondary" : "primary"}
                  onClick={() => onVote(open, v, mine)}
                  disabled={v === mine || !!blocked || busy}
                  title={blocked ?? (v === mine ? t("gov.vote.already") : undefined)}
                >
                  {voteOf(v)}
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
      {readError && <p className="field-note">{t("gov.readFailed", { error: readError })}</p>}
      {view && !registered && <NotADrep onBecome={onBecome} blocked={blocked} busy={busy} />}
      {view && actions.length === 0 && <p className="note">{t("gov.none")}</p>}
      <ul className="list" data-testid="gov-actions">
        {actions.map((a) => {
          const mine = view?.votes[a.id];
          return (
            <li key={a.id}>
              <button type="button" className="menu-row" onClick={() => setOpen(a)} data-testid="gov-action-row">
                <span className="stack-tight">
                  <span>{a.title ?? typeOf(a.type)}</span>
                  <span className="note">
                    {a.title ? `${typeOf(a.type)} · ` : ""}
                    {closes(t, network, a.expiresEpoch, now)}
                  </span>
                  {registered && (
                    <span className="note" data-testid="gov-your-vote">
                      {mine ? t("gov.yourVote", { vote: voteOf(mine) }) : t("gov.notVoted")}
                    </span>
                  )}
                </span>
                <ChevronRightIcon size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}

/** When an action closes, against the epoch it is now: no request. */
function closes(t: ReturnType<typeof useT>, network: Parameters<typeof epochEnds>[0], epoch: number, now: number): string {
  if (epoch <= now) return t("gov.closesThisEpoch", { date: epochEnds(network, now) });
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
