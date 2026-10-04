// What the worker says now that it speaks the user's language (sw.ts), and
// what it must never read back. A lock is told by its type, a swap's retry by
// a code, a chain a lock cut by a flag, a session in the private history by
// its number: each was English words the worker matched or parsed, which in
// Spanish or Japanese stop matching. And what it says is whole sentences in
// each language: no English noun inside a Spanish one, no "。。", no ASCII
// ". " between two Japanese sentences.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { CHAIN_CUT, PUBLIC_LOOK_MS } from "../src/background/lovejoin";
import { WalletLocked } from "../src/background/wallet";
import { i18n, t as tr } from "../src/i18n/core";
import { NETWORKS } from "../src/networks";
import { merged, receivedIn, sessionClass } from "../src/shared/histories";
import type { ActivityEntry, PendingTx, RetryReason } from "../src/shared/rpc";
import { activityCsv, activityDetail } from "../src/ui/activity";
import { dayHeading, ExportNote } from "../src/ui/screens/Activity";
import { retryReason } from "../src/ui/screens/Swaps";
import { account, CHAINS, lovejoinOf, PASSWORD, publicFunded, sessionsOf, withSession, type Tested } from "./chain-fixtures";
import { busyFor, testBalances } from "./fakes";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

const sent = (txHash: string, kind: PendingTx["kind"]): PendingTx =>
  ({ kind, network: "preprod", txHash, submittedAt: 1, confirmations: null }) as PendingTx;

describe("a session's chain through Lovejoin that fails, in Spanish or Japanese", CHAINS, () => {
  it("is tried again after a lock, never taken for Lovejoin's own failure, which would send its ADA back unmixed", async () => {
    const { t } = await withSession("40000000");
    await i18n.changeLanguage("es");
    // A lock as the chain is built, in the user's words.
    const lovejoin = lovejoinOf(t);
    lovejoin.chain = async () => {
      throw new WalletLocked(tr("worker.wallet.locked"));
    };
    const e = await sessionsOf(t, undefined, lovejoin)
      .backBuild("preprod", 0)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WalletLocked);
    expect((e as Error).message).toBe("La billetera está bloqueada.");
  });

  it("is tried again after its WebAssembly trapped outside the wallet's queue, too", async () => {
    const { t } = await withSession("40000000");
    const lovejoin = lovejoinOf(t);
    lovejoin.chain = async () => {
      throw new WebAssembly.RuntimeError("unreachable");
    };
    await expect(sessionsOf(t, undefined, lovejoin).backBuild("preprod", 0)).rejects.toBeInstanceOf(WebAssembly.RuntimeError);
  });

  it("says why it was left out as a clause the warning ends once, a name at its start kept", async () => {
    const { t } = await withSession("40000000");
    await i18n.changeLanguage("ja");
    const failure = tr("lj.notOnNetwork");
    expect(failure).toMatch(/^Lovejoin .*。$/);
    const lovejoin = lovejoinOf(t);
    lovejoin.chain = async () => {
      throw new Error(failure);
    };
    const review = await sessionsOf(t, undefined, lovejoin).backBuild("preprod", 0);
    // Its 。 goes, as English's "." does, since lovejoin.warn.skippedIts ends with its own; "Lovejoin" keeps its capital.
    expect(review.lovejoinSkipped).toBe(tr("sess.chainFailed", { reason: failure.slice(0, -1) }));
    expect(tr("lovejoin.warn.skippedIts", { why: review.lovejoinSkipped })).not.toContain("。。");
  });
});

describe("a kept transaction that isn't the one reviewed", () => {
  it("is refused in one whole sentence for its kind, each noun with the gender and pronoun it takes", async () => {
    const t = await unlocked();
    const nothing = "00".repeat(32);
    await i18n.changeLanguage("es");
    await expect(t.transfer.submit("preprod", nothing)).rejects.toThrow("Ese pago no está listo para enviarse. Revísalo otra vez.");
    await expect(t.withdraw.submitRemove("preprod", nothing)).rejects.toThrow(
      "Esa eliminación no está lista para enviarse. Revísala otra vez.",
    );
    await expect(t.staking.submit("preprod", nothing)).rejects.toThrow(
      "Esa transacción de staking no está lista para enviarse. Revísala otra vez.",
    );
    await i18n.changeLanguage("ja");
    await expect(t.mint.submit("preprod", nothing)).rejects.toThrow("その Seedelf は送信の準備ができていません。もう一度確認してください。");
    await expect(t.send.submitCollateral("preprod", nothing)).rejects.toThrow(
      "そのコラテラルの支払いは送信の準備ができていません。もう一度確認してください。",
    );
  });
});

describe("giveme.my's refusal", () => {
  const URL_ = "https://www.giveme.my/preprod/collateral/";

  it("places giveme.my's own words, or its status, as each language places them", async () => {
    await i18n.changeLanguage("ja");
    const refused = new Collateral(URL_, async () => Response.json({ detail: "Transaction Fails Validation" }, { status: 400 }));
    await expect(refused.witness("84a4")).rejects.toThrow(
      "コラテラルを貸す giveme.my がこのトランザクションを拒否しました（Transaction Fails Validation）。確認時から",
    );
    const down = new Collateral(URL_, async () => new Response("<html>", { status: 502 }));
    await expect(down.witness("84a4")).rejects.toThrow("このトランザクションを拒否しました（502）。");
  });
});

describe("Lovejoin's pool under its floor", CHAINS, () => {
  it("is said as two sentences, each ended and set as the language ends and sets them", async () => {
    const { t } = await withSession("40000000");
    const preprod = NETWORKS.preprod.lovejoin!;
    const floor = preprod.poolFloor;
    preprod.poolFloor = 25;
    try {
      await i18n.changeLanguage("ja");
      const e = (await t.lovejoin.fits("preprod", 1).catch((x: unknown) => x)) as Error;
      expect(e.message).toBe(`${tr("lj.floorShortSentence", { count: 20, floor: 25 })}${tr("lj.poolSeedable")}`);
      expect(e.message).toContain("たまってからです。代わりに");
    } finally {
      preprod.poolFloor = floor;
    }
  });
});

describe("a mix from the public account a lock cut", CHAINS, () => {
  /** Its deposit goes, and the wallet locks before Koios's answer is taken in: the mix is cut there. */
  async function cut(t: Tested) {
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    const fetch = t.koios.fetch;
    let locked = false;
    t.koios.fetch = async (url, init) => {
      const answer = await fetch(url, init);
      if (url.endsWith("/submittx") && !locked) {
        locked = true;
        await t.wallet.lock();
      }
      return answer;
    };
    await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow();
    await t.wallet.unlock(PASSWORD);
    expect(await t.lovejoin.progress("preprod")).toMatchObject({ stopped: CHAIN_CUT(), maybeSent: true });
  }
  const record = async (t: Tested) =>
    (await t.store.get<{ chains: Array<Record<string, unknown>> }>("lovejoin.preprod"))!.chains.at(-1)!;

  it("is told as cut whatever language it was cut in, and says how long it holds the next mix back", async () => {
    const t = await publicFunded();
    await i18n.changeLanguage("es");
    await cut(t);
    expect(await record(t)).toMatchObject({ stopped: "La billetera se bloqueó, o el navegador se cerró, mientras se enviaba su cadena.", cut: true });

    // Half an hour on, the wallet can only be sure in an hour and a half: hours and minutes joined with "y".
    await busyFor(t, 30 * 60_000);
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("dentro de unos 1 hora y 30 minutos.");

    // The user switched to English since. Its deposit lands, and the mix says a lock cut it, not that it stopped.
    await i18n.changeLanguage("en");
    t.koios.confirmations = 1;
    t.clock.now += PUBLIC_LOOK_MS;
    await t.lovejoin.progress("preprod");
    expect((await record(t)).stopped).toBe(
      "The wallet locked, or the browser closed, as its deposit was sent. It went through, and the mix stopped there.",
    );
  });

  it("recorded before the flag, is still told as cut by the English the worker wrote then", async () => {
    const t = await publicFunded();
    await cut(t);
    // As a record from before: the words alone.
    const kept = (await t.store.get<{ chains: Array<Record<string, unknown>> }>("lovejoin.preprod"))!;
    delete kept.chains.at(-1)!.cut;
    await t.store.set("lovejoin.preprod", kept);

    await i18n.changeLanguage("es");
    t.koios.confirmations = 1;
    t.clock.now += PUBLIC_LOOK_MS;
    await t.lovejoin.progress("preprod");
    expect((await record(t)).stopped).toBe(tr("lj.why.in", { lead: tr("lj.lead.cut", { what: tr("lj.step.deposit") }) }));
  });
});

describe("the private history", () => {
  it("keeps a private session by its number, which the page names in its own words", async () => {
    const t = await unlocked();
    await i18n.changeLanguage("es");
    await t.activity.sent("preprod", sent("aa".repeat(32), "session-out"), { index: 2, lovelace: "5000000" });
    const [out] = await t.activity.seedelf("preprod");
    expect(out).toMatchObject({ kind: "session-out", session: 2 });
    expect(out).not.toHaveProperty("detail");
    expect(activityDetail(out!)).toBe("Sesión privada 3");
    await i18n.changeLanguage("ja");
    expect(activityDetail(out!)).toBe("プライベートセッション 3");
  });

  it("still reads a session's entry written before, by its English name, and ties its return to it", async () => {
    const t = await unlocked();
    const funding = "aa".repeat(32);
    const paidIn = "cd".repeat(32);
    // Written by a worker that only spoke English: the session's name, and what its funding's change came from.
    const before: ActivityEntry = {
      txHash: funding,
      at: 1,
      kind: "session-out",
      direction: "out",
      lovelace: "5000000",
      tokens: 0,
      detail: "Private session 3",
      origin: receivedIn(paidIn),
    };
    await t.store.set("history.preprod", { entries: [before], seen: [] });
    await i18n.changeLanguage("es");
    expect(activityDetail(before)).toBe("Sesión privada 3");

    // Its return, sent in Spanish with no history of its own: it carries what the funding spent.
    const back = "bb".repeat(32);
    await t.activity.sent("preprod", sent(back, "session-back"), { index: 2, lovelace: "4000000" });
    const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === back)!;
    expect(entry.origin).toEqual(merged([sessionClass(2), receivedIn(paidIn)]));
    // And coin selection reads the two as one session's money.
    const at = (tx_hash: string) => ({ tx_hash, tx_index: 0 }) as KoiosUtxo;
    const classes = await t.activity.classes("preprod", [at(funding), at(back)]);
    expect(classes.get(`${funding}#0`)).toEqual(classes.get(`${back}#0`));
  });

  it("keeps who a payment to several went to as the first and a count, said when it's shown", async () => {
    const t = await unlocked();
    const to = (n: string) => `5eed0e1f${n.repeat(28)}`;
    await t.activity.sent("preprod", sent("ab".repeat(32), "transfer"), {
      fee: { total: "300000" },
      payments: [
        { to: to("11"), label: "alice", lovelace: "5000000", tokens: [] },
        { to: to("22"), lovelace: "2000000", tokens: [] },
        { to: to("33"), lovelace: "1000000", tokens: [] },
      ],
    });
    const [entry] = await t.activity.seedelf("preprod");
    expect(entry).toMatchObject({ detail: "alice", more: 2 });
    await i18n.changeLanguage("ja");
    expect(activityDetail(entry!)).toBe("alice ほか 2 件");
  });

  it("heads each day in the page's language", async () => {
    const now = new Date(2026, 9, 3, 12);
    const yesterday = now.getTime() - 86_400_000;
    expect([dayHeading(now.getTime(), now), dayHeading(yesterday, now), dayHeading(0, now)]).toEqual(["Today", "Yesterday", "Earlier"]);
    await i18n.changeLanguage("es");
    expect([dayHeading(now.getTime(), now), dayHeading(yesterday, now), dayHeading(0, now)]).toEqual(["Hoy", "Ayer", "Antes"]);
    await i18n.changeLanguage("ja");
    expect([dayHeading(now.getTime(), now), dayHeading(yesterday, now), dayHeading(0, now)]).toEqual(["今日", "昨日", "以前"]);
  });

  it("sets the export note's two sentences as Japanese sets them, with nothing between", async () => {
    await i18n.changeLanguage("ja");
    const html = renderToStaticMarkup(createElement(ExportNote, { of: "cardano", listed: 20, more: true }));
    expect(html).toContain(`${tr("activity.export.readSoFar", { count: 20 })}${tr("activity.export.privacy.public")}`);
  });

  it("writes the CSV's own words in the page's language, and one kind of token as one", async () => {
    const shared = { at: 0, lovelace: "1000000", tokens: 0 };
    const entries: ActivityEntry[] = [
      { ...shared, txHash: "a1".repeat(32), kind: "received", direction: "in", tokens: 1 },
      { ...shared, txHash: "a2".repeat(32), kind: "session-out", direction: "out", tokens: 3, session: 0 },
      { ...shared, txHash: "a3".repeat(32), kind: "mint", direction: "none", detail: "seedling" },
    ];
    // The direction, the tokens of an entry that only counts them, and who or where.
    const cells = () =>
      activityCsv("preprod", entries)
        .replace(/^﻿/, "")
        .trim()
        .split("\r\n")
        .slice(1)
        .map((row) => row.split(","))
        .map((c) => [c[2], c[5], c[6]]);
    expect(cells()).toEqual([
      ["in", "1 kind", ""],
      ["out", "3 kinds", "Private session 1"],
      ["none", "", "seedling"],
    ]);
    await i18n.changeLanguage("es");
    expect(cells()).toEqual([
      ["entrada", "1 tipo", ""],
      ["salida", "3 tipos", "Sesión privada 1"],
      ["ninguna", "", "seedling"],
    ]);
  });
});

describe("a swap's retry line", () => {
  it("words the worker's code in the page's language, never its message", async () => {
    await i18n.changeLanguage("ja");
    const at = Date.now();
    const words: Record<Exclude<RetryReason, "other">, string> = {
      "minswap-rate-limited": "Minswap がこの接続からのリクエストを 1 分間制限しています。",
      "koios-rate-limited": "Koios がこの接続からのリクエストを制限しています。",
      "minswap-silent": "Minswap が応答しませんでした。",
      "koios-silent": "Koios が応答しませんでした。",
      "funding-unseen": "Minswap はまだ資金提供を認識していません。",
    };
    for (const [reason, said] of Object.entries(words)) {
      expect(retryReason({ at, error: "何かが起きました。", reason: reason as RetryReason })).toBe(said);
    }
    // A refusal that names Koios is shown in its own words: Koios answered.
    const named = "ネットワークはトランザクションを拒否しました: Koios is down";
    expect(retryReason({ at, error: named, reason: "other" })).toBe(named);
  });

  it("reads a retry recorded before the codes by its English, the one language the worker wrote then", async () => {
    await i18n.changeLanguage("es");
    const at = Date.now();
    expect(retryReason({ at, error: "Couldn't reach Minswap (Failed to fetch). Check your connection and try again." })).toBe(
      "Minswap no respondió.",
    );
    expect(retryReason({ at, error: "Minswap refused it (400): no wallet utxos" })).toBe("Minswap todavía no ha visto la financiación.");
    expect(retryReason({ at, error: "Something else." })).toBe("Something else.");
  });
});
