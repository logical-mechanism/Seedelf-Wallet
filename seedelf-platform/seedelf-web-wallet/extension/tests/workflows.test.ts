// The repository's GitHub workflows (.github/workflows/), read as text: what each runs, and what a step that holds a
// secret may write to its log, which a public repository's Actions show anyone.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKFLOWS = new URL("../../../../.github/workflows/", import.meta.url);
const FIRST_PARTY = new Set(["actions", "github"]);

/** Every workflow, by file name, with its lines. */
function workflows(): Array<{ file: string; lines: string[] }> {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((file) => ({ file, lines: readFileSync(new URL(file, WORKFLOWS), "utf8").split("\n") }));
}

type Use = { file: string; where: string; ref: string };

/** Every `uses:` in every workflow, step or reusable-workflow job, with its file:line. */
function uses(): Use[] {
  return workflows().flatMap(({ file, lines }) =>
    lines.flatMap((line, i) => {
      const ref = /^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)/.exec(line)?.[1];
      return ref ? [{ file, where: `${file}:${i + 1}`, ref }] : [];
    }),
  );
}

function pinned(ref: string): boolean {
  if (ref.startsWith("./")) return true;
  if (ref.startsWith("docker://")) return /@sha256:[0-9a-f]{64}$/.test(ref);
  if (FIRST_PARTY.has(ref.split("/")[0] ?? "")) return true;
  return /@[0-9a-f]{40}$/.test(ref);
}

/** A line that starts a step (`- name:`, `- uses:`, `- run:`, `- env:` ...), and a job's key, which ends one. */
const STEP = /^\s*- [A-Za-z][\w-]*:/;
const JOB = /^ {2}[\w-]+:\s*$/;
/** A command that writes a file's contents to the log, and one that writes its arguments there. */
const DUMP = /^(?:-\s+)?(?:run:\s*)?(?:Get-Content|gc|cat|type|more|head|tail)\b/;
const SAY = /^(?:-\s+)?(?:run:\s*)?(?:echo|printf|Write-Host|Write-Output)\b/;

/** Each step of `lines`, as its lines: from its first to the next step's, or the next job's. */
function steps(lines: string[]): string[][] {
  const found: string[][] = [];
  for (const line of lines) {
    if (STEP.test(line)) found.push([line]);
    else if (JOB.test(line)) found.push([]);
    else found.at(-1)?.push(line);
  }
  return found.filter((s) => s.length);
}

describe("the workflows", () => {
  // Chunk 51, b1#5. An action a workflow names runs as the job: with its token, beside the secrets its steps use, and
  // before the steps that come after it. A tag or a branch (`@v2`, `@master`) is a pointer its owner, or whoever takes
  // their account, can move to other code at any time; only a full commit SHA names fixed code. release.yml's three
  // build jobs set up Rust with dtolnay/rust-toolchain@master, then build, import the release key and sign what that
  // toolchain built; finalize-release runs softprops/action-gh-release@v2 with the token, after its own key import and
  // signing; data-layer-deploy.yml's build job makes the binary the VPS runs with the same @master. So every
  // third-party action, an owner other than GitHub's own `actions/` and `github/`, is pinned by a full 40-character
  // commit SHA, its tag in a comment. A local action (`./`) is this commit's own; a `docker://` image names its digest.
  it("pin every third-party action by a full commit SHA", () => {
    const all = uses();
    // Not vacuous: the scan reached the workflows, the signing one and the deploy one among them.
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((u) => u.file === "release.yml")).toBe(true);
    expect(all.some((u) => u.file === "data-layer-deploy.yml")).toBe(true);

    const loose = all.filter((u) => !pinned(u.ref)).map((u) => `${u.where} ${u.ref}`);
    expect(loose).toEqual([]);
  });

  // Chunk 51, b1#4. release.yml's Windows job wrote RELEASE_GPG_KEY to a file, then printed that file into the job's
  // log (`Get-Content $keyFile`), to check it wasn't empty. Only the runner's masking, line by line, kept the armored
  // secret key out of the public log. So a step that holds a secret dumps no file to the log, and writes nothing it
  // interpolates there but through a pipe into another command, or into a file.
  it("never dump a file, or say a value, to the log in a step that holds a secret", () => {
    const holding: string[] = [];
    const prints: string[] = [];
    for (const { file, lines } of workflows()) {
      for (const step of steps(lines)) {
        if (!step.some((line) => line.includes("secrets."))) continue;
        const head = `${file}: ${step[0]?.trim()}`;
        holding.push(head);
        for (const line of step) {
          const text = line.trim();
          const away = /[|>]/.test(text);
          if ((DUMP.test(text) && !away) || (SAY.test(text) && text.includes("$") && !away)) prints.push(`${head}: ${text}`);
        }
      }
    }
    // Not vacuous: the release key's import is among the steps read. Since b1#3 there's one, in the signing job, where
    // there were four, a build job's each and the release's.
    expect(holding.filter((s) => s.startsWith("release.yml: - name: Import GPG Key"))).toHaveLength(1);
    expect(prints).toEqual([]);
  });
});

const indentOf = (line: string) => line.length - line.trimStart().length;
const comment = (line: string) => line.trimStart().startsWith("#");
const blank = (line: string) => line.trim() === "" || comment(line);

/** The lines under the key on line `i`: up to the next line, not blank or a comment, as shallow as it or shallower. */
function under(lines: string[], i: number): string[] {
  const base = indentOf(lines[i] ?? "");
  const found: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j] ?? "";
    if (!blank(line) && indentOf(line) <= base) break;
    found.push(line);
  }
  return found;
}

type Job = { file: string; name: string; body: string[] };

/** Every job of every workflow, with the lines under its key. */
function jobs(): Job[] {
  return workflows().flatMap(({ file, lines }) => {
    const at = lines.findIndex((line) => /^jobs:\s*$/.test(line));
    if (at < 0) return [];
    const body = under(lines, at);
    return body.flatMap((line, k) => {
      const name = /^ {2}([\w-]+):\s*$/.exec(line)?.[1];
      return name ? [{ file, name, body: under(body, k) }] : [];
    });
  });
}

/** A job's lines but its comments. */
const code = (job: Job) => job.body.filter((line) => !comment(line));

/** The job's token: its own `permissions:`, else its workflow's, else null, the repository's default (write here). */
function tokenOf(job: Job): string | null {
  const own = job.body.findIndex((line) => /^ {4}permissions:/.test(line));
  if (own >= 0) return [job.body[own], ...under(job.body, own)].filter((line) => line && !blank(line)).join("\n");
  const lines = workflows().find((w) => w.file === job.file)?.lines ?? [];
  const top = lines.findIndex((line) => /^permissions:/.test(line));
  return top < 0 ? null : [lines[top], ...under(lines, top)].filter((line) => line && !blank(line)).join("\n");
}
const writes = (job: Job) => /\bwrite\b/.test(tokenOf(job) ?? "write");

/** Runs code from outside the repository's own: a compiler, a package manager, or an action that sets one up. */
const BUILD_RUN = /\b(?:cargo|rustup|npm|npx|aiken|wasm-bindgen)\b|\bbuild\.sh\b/;
const BUILD_USES = /uses:\s*["']?(?:dtolnay\/rust-toolchain|Swatinem\/rust-cache|aiken-lang\/setup-aiken|actions\/setup-node)@/;
const builds = (job: Job) => code(job).some((line) => BUILD_RUN.test(line) || BUILD_USES.test(line));
const SECRET = /\bsecrets\.\w/;

/** Each step's script, as it runs: a `run:` line's text, or the block under it, with the file:line it starts on. */
function scripts(): Array<{ where: string; lines: string[] }> {
  return workflows().flatMap(({ file, lines }) =>
    lines.flatMap((line, i) => {
      const rest = /^\s*(?:-\s+)?run:\s*(.*)$/.exec(line)?.[1];
      if (rest === undefined || comment(line)) return [];
      const key = line.indexOf("run:");
      if (!/^[|>][-+]?\d*\s*(?:#.*)?$/.test(rest)) return [{ where: `${file}:${i + 1}`, lines: [rest] }];
      const block: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j] ?? "";
        if (next.trim() !== "" && indentOf(next) <= key) break;
        block.push(next);
      }
      return [{ where: `${file}:${i + 1}`, lines: block }];
    }),
  );
}

describe("the workflows' tokens and secrets", () => {
  // Chunk 51, b1#3. release.yml's three build jobs ran `cargo build` (every crate's build script and proc macro) and
  // dtolnay/rust-toolchain, then took RELEASE_GPG_KEY and GPG_PASSPHRASE into the same job, written into the steps'
  // scripts and onto gpg's command line, beside the write token actions/checkout leaves in .git/config: the
  // workflow had no `permissions:`, so every job had the repository's default, write. A process build code starts
  // outlives its step, and reads what comes after. So, as web-wallet.yml and the data layer's workflows already do:
  // every job's token is declared, a checkout leaves none behind, and a job that builds holds no secret and can't
  // write. The key goes to one job that builds nothing (below). continuous-integration.yml is the family: Aiken ran
  // with a persisted write token, and no secret.
  it("declare every job's token, never the repository's default, which is write", () => {
    const all = jobs();
    // Not vacuous: every workflow's jobs were read, release.yml's builds and continuous-integration.yml's among them.
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((j) => j.file === "continuous-integration.yml" && j.name === "build")).toBe(true);
    expect(all.filter((j) => tokenOf(j) === null).map((j) => `${j.file}: ${j.name}`)).toEqual([]);
  });

  it("leave no token in .git: every checkout says persist-credentials: false", () => {
    const checkouts: string[] = [];
    const left: string[] = [];
    for (const { file, lines } of workflows()) {
      for (const step of steps(lines)) {
        if (!step.some((line) => /uses:\s*["']?actions\/checkout@/.test(line))) continue;
        checkouts.push(file);
        if (!step.some((line) => /^\s*persist-credentials:\s*false\b/.test(line))) left.push(`${file}: ${step[0]?.trim()}`);
      }
    }
    expect(checkouts.filter((f) => f === "release.yml")).toHaveLength(3);
    expect(left).toEqual([]);
  });

  it("let no job that builds hold a secret or a token that can write", () => {
    const building = jobs().filter(builds);
    // Not vacuous: the CLI's three builds, Aiken's check, the data layer's and the web wallet's builds are read.
    const cli = building.filter((j) => j.file === "release.yml").map((j) => j.name);
    expect(cli).toEqual(["build-linux", "build-windows", "build-mac"]);
    expect(building.some((j) => j.file === "continuous-integration.yml")).toBe(true);
    expect(building.some((j) => j.file === "data-layer-deploy.yml" && j.name === "build")).toBe(true);
    const exposed = building.flatMap((j) => [
      ...(code(j).some((line) => SECRET.test(line)) ? [`${j.file}: ${j.name} holds a secret`] : []),
      ...(writes(j) ? [`${j.file}: ${j.name} can write`] : []),
    ]);
    expect(exposed).toEqual([]);
  });

  // An expression in a step's `run:` is written into its script's file before it runs: a secret lands in that file's
  // text, and a value someone else chose (a tag, a branch's name) becomes code. Through `env:`, it stays a value.
  it("write no expression into a step's script: a secret or a value reaches it through env:", () => {
    const all = scripts();
    expect(all.some((s) => s.where.startsWith("release.yml:"))).toBe(true);
    const written = all.flatMap(({ where, lines }) =>
      lines.filter((line) => line.includes("${{")).map((line) => `${where}: ${line.trim()}`),
    );
    expect(written).toEqual([]);
  });
});

describe("release.yml's signature", () => {
  const release = () => jobs().filter((j) => j.file === "release.yml");
  const KEYS = /\bsecrets\.(?:RELEASE_GPG_KEY|GPG_PASSPHRASE)\b/;

  // Chunk 51, b1#3. The release key signs every seedelf-cli that RELEASE.md's checks pass, so only one job reads it:
  // one that builds nothing, after the builds, in the `release` environment, which the owner approves each run of and
  // which holds the key, and the only job whose token can write, to publish the release.
  it("is made in one job that builds nothing, in the release environment, the only one that can write", () => {
    const signing = release().filter((j) => code(j).some((line) => KEYS.test(line)));
    expect(signing.map((j) => j.name)).toEqual(["sign-and-publish"]);
    const job = signing[0]!;
    expect(builds(job)).toBe(false);
    const environment = code(job).findIndex((line) => /^ {4}environment:/.test(line));
    const named = [code(job)[environment] ?? "", ...under(code(job), environment)].join("\n");
    expect(named).toMatch(/^ {4}environment:\s*(?:release|\n\s+name:\s*release)\s*$/m);
    expect(tokenOf(job)).toMatch(/contents:\s*write/);
    expect(release().filter((j) => j.name !== job.name && writes(j)).map((j) => j.name)).toEqual([]);
    expect(code(job).some((line) => /^ {4}needs:/.test(line))).toBe(true);
  });

  it("takes the key on stdin and the passphrase on a file descriptor, never on gpg's command line", () => {
    const lines = workflows().flatMap(({ file, lines }) => lines.map((line, i) => ({ where: `${file}:${i + 1}`, line })));
    const argv = lines.filter(({ line }) => /--passphrase(?:\s|=)/.test(line)).map(({ where, line }) => `${where}: ${line.trim()}`);
    expect(argv).toEqual([]);
    const job = release().find((j) => j.name === "sign-and-publish");
    expect(job).toBeDefined();
    const text = code(job!).join("\n");
    expect(text).toMatch(/\|\s*gpg\b[^\n]*--import/);
    expect(text).toMatch(/--passphrase-fd\s+0\b/);
  });

  it("goes with every file the release publishes", () => {
    const job = release().find((j) => j.name === "sign-and-publish");
    expect(job).toBeDefined();
    const body = code(job!);
    // What `gh release create` uploads: its arguments, the lines a `\` continues joined (chunk 51, docs#5).
    const gh = (line: string) => /\bgh release create\b/.test(line);
    const publish = scripts().find(({ where, lines }) => where.startsWith("release.yml:") && lines.some(gh));
    expect(publish).toBeDefined();
    const command = publish!.lines.join("\n").replace(/\\\n/g, " ");
    const files = command
      .slice(command.indexOf("gh release create"))
      .split(/\s+/)
      .filter((arg) => /^(?:seedelf-platform\/[\w.-]+|hashes\.txt(?:\.asc)?)$/.test(arg));
    expect(body.join("\n")).toMatch(/\bgh release create\b/);
    const signed = files.filter((f) => !f.endsWith(".asc"));
    // The three archives and hashes.txt, as RELEASE.md lists them, each beside its detached signature.
    expect(signed.map((f) => f.split("/").at(-1))).toEqual([
      "seedelf-cli-linux.tar.gz",
      "seedelf-cli-windows.zip",
      "seedelf-cli-macos.tar.gz",
      "hashes.txt",
    ]);
    expect(signed.filter((f) => !files.includes(`${f}.asc`))).toEqual([]);
    for (const f of signed) expect(body.join("\n")).toContain(f.split("/").at(-1));
    expect(body.join("\n")).toMatch(/--detach-sign/);
  });

  // Chunk 51, docs#5. sign-and-publish imported the key, signed with its passphrase, then ran
  // softprops/action-gh-release, third-party JavaScript, with the write token: in the same job, as the same user,
  // beside gpg's agent, which kept the unlocked key for its cache time (ten minutes), and with the runner's sudo,
  // beside the job's secrets themselves. A bad commit reaching its pin through a Dependabot bump could have signed a
  // swapped archive that RELEASE.md's checks pass. So no job that holds a secret, the job's own token aside, runs a
  // third-party action: GitHub's own `gh`, on the runner already, publishes the release. And the signing step stops
  // the agent once it has signed, so nothing after it signs without the passphrase.
  it("runs no third-party action in a job that holds a secret, and forgets the unlocked key once it has signed", () => {
    const OTHER = /\bsecrets\.(?!GITHUB_TOKEN\b)\w/;
    const holding = jobs().filter((j) => code(j).some((line) => OTHER.test(line)));
    // Not vacuous: the release key's job, and the data layer's deploy, which holds its SSH key.
    expect(holding.map((j) => `${j.file}: ${j.name}`)).toEqual(
      expect.arrayContaining(["release.yml: sign-and-publish", "data-layer-deploy.yml: vps"]),
    );
    const beside = holding.flatMap((j) =>
      code(j).flatMap((line) => {
        const ref = /^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)/.exec(line)?.[1];
        const third = ref && !ref.startsWith("./") && !FIRST_PARTY.has(ref.split("/")[0] ?? "");
        return third ? [`${j.file}: ${j.name} runs ${ref}`] : [];
      }),
    );
    expect(beside).toEqual([]);
    const signing = scripts().find(
      ({ where, lines }) => where.startsWith("release.yml:") && lines.some((line) => line.includes("--detach-sign")),
    );
    expect(signing).toBeDefined();
    expect(signing!.lines.filter((line) => !blank(line)).at(-1)?.trim()).toBe("gpgconf --kill gpg-agent");
  });
});

/** GitHub's paths syntax: `**` any characters, `/` included, `*` any but `/`. */
function glob(pattern: string): RegExp {
  const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (pattern.startsWith("**", i)) {
      re += ".*";
      i += 1;
    } else re += pattern[i] === "*" ? "[^/]*" : escape(pattern[i]!);
  }
  return new RegExp(`^${re}$`);
}

/**
 * Whether a pull request that changes only `path` starts workflow `file`: pull_request in its `on:` with no paths
 * filter, or one that takes the path (GitHub reads them in order, the last that matches deciding, a `!` one leaving it
 * out), or paths-ignore that doesn't.
 */
function startsOn(file: string, path: string): boolean {
  const lines = workflows().find((w) => w.file === file)?.lines ?? [];
  const at = lines.findIndex((line) => /^on:/.test(line));
  if (at < 0) return false;
  const inline = /^on:\s*([^#]*)/.exec(lines[at]!)?.[1]?.trim();
  if (inline) return /\bpull_request\b/.test(inline);
  const body = under(lines, at);
  const pr = body.findIndex((line) => /^\s+pull_request:/.test(line));
  if (pr < 0) return false;
  const filter = under(body, pr);
  const list = (key: string) => {
    const k = filter.findIndex((line) => new RegExp(`^\\s+${key}:`).test(line));
    if (k < 0) return null;
    return under(filter, k)
      .filter((line) => !blank(line))
      .map((line) => line.trim().replace(/^-\s*/, "").replace(/^["']|["']$/g, ""));
  };
  const paths = list("paths");
  if (paths) {
    let hit = false;
    for (const p of paths) {
      if (p.startsWith("!")) {
        if (glob(p.slice(1)).test(path)) hit = false;
      } else if (glob(p).test(path)) hit = true;
    }
    return hit;
  }
  return !(list("paths-ignore") ?? []).some((p) => glob(p).test(path));
}

// Chunk 51, docs#7. seedelf-verification/test-tools.sh holds the proofs' tools to their rules on fake packages, with
// no Lean or Lake, in about ten seconds: check.sh and, since this round, its EXPECTED verdict (expected-failures.txt),
// tally.py, Audit/'s count.py and run-all.sh, and the diag scan with its accepted list. The round grew it from 50
// checks to 80, and it reads Seedelf/PolicyBurn.lean and PolicyMint.lean against a console recorded by line and column.
// web-wallet.yml's covered filter leaves seedelf-verification/ out, so the proofs' pull requests stay fast, and no
// workflow ran the script: a pull request that changed only one of those files merged with no check. So a workflow of
// its own runs it on every pull request that changes the script or a file it reads (verification-tools.yml). This
// check reads the script, which covered takes for it (l2docs#1).
describe("the proofs' tools' own test", () => {
  const VERIFICATION = fileURLToPath(new URL("../../../../seedelf-verification/", import.meta.url));

  /** The script and each file it reads from its folder (`$TOOLS/…`, a glob expanded), and the diag scan's
   * accepted.txt, which the scan reads beside itself. */
  function read(): string[] {
    const text = readFileSync(join(VERIFICATION, "test-tools.sh"), "utf8");
    const found = new Set(["test-tools.sh", "Audit/diag/accepted.txt"]);
    for (const [, path] of text.matchAll(/"?\$TOOLS"?\/([\w./*-]+)/g)) {
      const slash = path!.lastIndexOf("/");
      const folder = slash < 0 ? "" : path!.slice(0, slash);
      const name = path!.slice(slash + 1);
      if (!name.includes("*")) {
        found.add(path!);
        continue;
      }
      const re = glob(name);
      for (const f of readdirSync(join(VERIFICATION, folder))) if (re.test(f)) found.add(`${folder}/${f}`);
      // And a file it could match tomorrow: the glob is held to its pattern, not to the files there today, so one added
      // beside them is checked with no change to the script, which alone web-wallet.yml covers (chunk 51, l2docs#1).
      found.add(`${folder}/${name.replaceAll("*", "new")}`);
    }
    return [...found].map((f) => `seedelf-verification/${f}`).sort();
  }

  it("runs on every pull request that changes the script or a file it reads", () => {
    const files = read();
    // Not vacuous: the files this round's verdicts live in, and the two sources read by line and column.
    expect(files).toEqual(
      expect.arrayContaining([
        "seedelf-verification/check.sh",
        "seedelf-verification/expected-failures.txt",
        "seedelf-verification/Audit/diag/scan-diag.py",
        "seedelf-verification/Audit/diag/accepted.txt",
        "seedelf-verification/Seedelf/PolicyBurn.lean",
        "seedelf-verification/Seedelf/PolicyMint.lean",
      ]),
    );
    // Not vacuous: the triggers read as GitHub reads them.
    expect(startsOn("data-layer.yml", "seedelf-data/api/src/main.rs")).toBe(true);
    expect(startsOn("data-layer.yml", "seedelf-verification/check.sh")).toBe(false);
    expect(startsOn("release.yml", "seedelf-verification/check.sh")).toBe(false);
    expect(startsOn("continuous-integration.yml", "seedelf-verification/check.sh")).toBe(true);

    // The workflows with a step whose script runs test-tools.sh.
    const running = [
      ...new Set(
        scripts()
          .filter(({ lines }) => lines.some((line) => !comment(line) && /\btest-tools\.sh\b/.test(line)))
          .map(({ where }) => where.split(":")[0]!),
      ),
    ];
    const untested = files.filter((path) => !running.some((file) => startsOn(file, path)));
    expect({ running, untested }).toEqual({ running: expect.arrayContaining([expect.any(String)]), untested: [] });
  });
});

// Chunk 51, docs#11. data-layer.yml started on any change under seedelf-data/, so a pull request that only edited its
// README.md, NOTES.md or deploy/README.md ran the data layer's whole check: fmt, clippy and every test. Nothing it
// builds or tests reads a Markdown file, so its Markdown starts nothing, as the platform's doesn't in web-wallet.yml.
// This check reads the data layer's Rust, which main's run checks; a pull request that changes only that Rust is held
// to the same rule by data-layer.yml's own step, "No Markdown included" (chunk 51, l2docs#1, l3misc#1, l3still#3).
describe("data-layer.yml's paths", () => {
  const DATA = fileURLToPath(new URL("../../../../seedelf-data/", import.meta.url));

  /** Every .rs file under `dir`, but build output and the gitignored reference checkouts (a link in one may lead nowhere). */
  function rust(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      if (["target", ".git", "_reference"].includes(name)) return [];
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return rust(path);
      return name.endsWith(".rs") ? [path] : [];
    });
  }

  it("skip a pull request that changes only Markdown under seedelf-data/, which nothing it checks reads", () => {
    expect(startsOn("data-layer.yml", "seedelf-data/api/src/main.rs")).toBe(true);
    expect(startsOn("data-layer.yml", "seedelf-data/deploy/edge/seedelf-data-deploy")).toBe(true);
    expect(startsOn("data-layer.yml", "seedelf-platform/seedelf-core/src/constants.rs")).toBe(true);
    for (const doc of ["seedelf-data/README.md", "seedelf-data/NOTES.md", "seedelf-data/deploy/README.md"]) {
      expect(startsOn("data-layer.yml", doc), doc).toBe(false);
    }
    // What its Rust includes (include_str!, include_bytes!) is never Markdown, so the skip leaves no input out.
    const included = rust(DATA).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/include_(?:str|bytes)!\(\s*"([^"]+)"/g)].map(([, target]) => target!),
    );
    expect(included.length).toBeGreaterThan(0);
    expect(included.filter((target) => /\.md$/i.test(target))).toEqual([]);
  });
});

// Chunk 51, v3#2 and G8's notes. web-wallet.yml's changes job decides with one awk program, `covered`, whether a pull
// request touches what the check covers. One that doesn't skips every job, and Web Wallet required still passes, so a
// file a test reads must be covered, or a pull request changing only that file goes untested until main's run. Two
// sets sat outside it: every workflow, which this file reads (only web-wallet.yml was covered), and the Lovejoin
// scripts' .hex files seedelf-verification proves, which lovejoin_proven_bytes_test.rs includes (1.8.1's review left
// that to the owner). Markdown and the proofs' Lean stay outside, so a docs or a Lean pull request stays fast.
describe("web-wallet.yml's covered filter", () => {
  const PLATFORM = fileURLToPath(new URL("../../../", import.meta.url));
  const REPO = resolve(PLATFORM, "..");

  /** The changes step's awk program, as bash's single quotes hand it to awk. */
  function covered(): string {
    const text = readFileSync(new URL("web-wallet.yml", WORKFLOWS), "utf8");
    const start = text.indexOf("covered='");
    expect(start).toBeGreaterThan(0);
    const from = start + "covered='".length;
    return text.slice(from, text.indexOf("'", from));
  }

  /** Whether a pull request into main changing only `path` runs the check: with one file listed, awk alone decides. */
  function runs(path: string): boolean {
    const awk = spawnSync("awk", [covered()], { input: `${path}\n`, encoding: "utf8" });
    expect(awk.error).toBeUndefined();
    expect(awk.stderr).toBe("");
    return awk.status === 0;
  }

  /** Every .rs file under `dir`, but build output, dependencies and the gitignored reference clone. */
  function rust(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return ["target", "node_modules", "dist", "pkg", ".git", "_reference", "release"].includes(name) ? [] : rust(path);
      }
      return name.endsWith(".rs") ? [path] : [];
    });
  }

  /** Each file outside seedelf-platform/ a Rust source includes (include_str!, include_bytes!), from the repository's root. */
  function includedFromOutside(): string[] {
    const outside = new Set<string>();
    for (const file of rust(PLATFORM)) {
      for (const [, target] of readFileSync(file, "utf8").matchAll(/include_(?:str|bytes)!\(\s*"([^"]+)"/g)) {
        const path = resolve(dirname(file), target!);
        if (!path.startsWith(PLATFORM)) outside.add(relative(REPO, path).split(sep).join("/"));
      }
    }
    return [...outside].sort();
  }

  it("is read as the workflow runs it: code and wasm/README.md run the check, Markdown and the proofs' Lean don't", () => {
    expect(runs("seedelf-platform/seedelf-core/src/lovejoin/templates.rs")).toBe(true);
    expect(runs("seedelf-platform/seedelf-web-wallet/wasm/README.md")).toBe(true);
    expect(runs("seedelf-platform/seedelf-web-wallet/docs/privacy.md")).toBe(false);
    expect(runs("seedelf-platform/seedelf-web-wallet/media/post.png")).toBe(false);
    expect(runs("seedelf-verification/Lovejoin/Template/Scripts.lean")).toBe(false);
    expect(runs("seedelf-verification/README.md")).toBe(false);
    expect(runs("seedelf-data/deploy/edge/seedelf-data-deploy")).toBe(false);
    expect(runs("seedelf-data/api/src/main.rs")).toBe(false);
  });

  // Chunk 51, l2docs#1: two checks above read files outside seedelf-platform/ that covered left out. The proofs' tools'
  // reads test-tools.sh, and data-layer.yml's paths' reads every .rs file under seedelf-data/. A pull request that
  // changed only those, the one that could break either check, ran neither and merged green: main's run was the first
  // to fail. The script is covered now. The data layer's Rust isn't: data-layer.yml, which every pull request changing
  // it starts, holds it to that check's rule itself (l3misc#1, l3still#3, below), so such a pull request doesn't wait
  // on the wallet's whole check. Their Markdown, and what the script reads but this file doesn't, stay out, so a docs or
  // a Lean pull request stays fast.
  it("runs the check for a pull request that changes only the proofs' tools' script, which a check above reads", () => {
    const data = rust(join(REPO, "seedelf-data")).map((path) => relative(REPO, path).split(sep).join("/"));
    // Not vacuous: the data layer's Rust is found.
    expect(data).toEqual(expect.arrayContaining(["seedelf-data/api/src/main.rs"]));
    expect(runs("seedelf-verification/test-tools.sh")).toBe(true);
    expect(data.filter((path) => runs(path))).toEqual([]);
    for (const path of [
      "seedelf-data/README.md",
      "seedelf-data/deploy/README.md",
      "seedelf-verification/check.sh",
      "seedelf-verification/Seedelf/PolicyBurn.lean",
    ]) {
      expect(runs(path), path).toBe(false);
    }
  });

  it("runs the check for a pull request that changes only a workflow, which this file reads", () => {
    const all = workflows().map(({ file }) => `.github/workflows/${file}`);
    expect(all).toContain(".github/workflows/release.yml");
    expect(all.filter((path) => !runs(path))).toEqual([]);
  });

  it("runs the check for a pull request that changes only a file a Rust test includes from outside seedelf-platform/", () => {
    const outside = includedFromOutside();
    // Not vacuous: the scan finds what lovejoin_proven_bytes_test.rs reads.
    expect(outside).toEqual(
      expect.arrayContaining([
        "seedelf-verification/Lovejoin/Template/Scripts/mix_logic.hex",
        "seedelf-verification/Lovejoin/Template/Scripts/mix_box.hex",
        "seedelf-verification/Lovejoin/Template/Scripts/one_shot_mint.hex",
        "seedelf-verification/Lovejoin/Scripts/reference_holder.hex",
      ]),
    );
    expect(outside.filter((path) => !runs(path))).toEqual([]);
  });
});

// Chunk 51, l3misc#1 and l3still#3. Round three put every .rs file under seedelf-data/ in covered (l2docs#1) for one
// check above that reads them, docs#11's: none of that Rust includes a Markdown file. So a pull request that changed
// only the data layer's Rust, an API fix say, ran the wallet's five jobs, about 13 minutes on Web Wallet required, which
// main's ruleset requires, though nothing else in that check reads the data layer. data-layer.yml starts on every such
// pull request, so it makes that check itself, in seconds, and the data layer's pull requests stay out of the wallet's
// check, as the CI-speed rule asks.
describe("a pull request that changes only the data layer's Rust", () => {
  const DATA = fileURLToPath(new URL("../../../../seedelf-data/", import.meta.url));
  const RS = ["seedelf-data/api/src/public/utxos.rs", "seedelf-data/api/src/main.rs", "seedelf-data/api/tests/common/mod.rs"];

  /** Every .rs file under `dir`, but build output and the gitignored reference checkouts: all the step below reads. */
  function rust(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      if (["target", ".git", "_reference"].includes(name)) return [];
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return rust(path);
      return name.endsWith(".rs") ? [path] : [];
    });
  }

  /** Whether web-wallet.yml's check runs for a pull request into main that changes only `path`: awk alone decides. */
  function walletRuns(path: string): boolean {
    const text = readFileSync(new URL("web-wallet.yml", WORKFLOWS), "utf8");
    const from = text.indexOf("covered='") + "covered='".length;
    const awk = spawnSync("awk", [text.slice(from, text.indexOf("'", from))], { input: `${path}\n`, encoding: "utf8" });
    expect(awk.stderr).toBe("");
    return awk.status === 0;
  }

  it("starts the data layer's check, not the wallet's", () => {
    for (const path of RS) expect(startsOn("data-layer.yml", path), path).toBe(true);
    expect(RS.filter((path) => walletRuns(path))).toEqual([]);
  });

  it("is held to docs#11's rule by a step of data-layer.yml, which fails on Rust that includes Markdown and passes on the tree", () => {
    const steps = scripts().filter(
      ({ where, lines }) => where.startsWith("data-layer.yml:") && lines.some((line) => !comment(line) && /include_/.test(line)),
    );
    expect(
      steps.map(({ where }) => where),
      "data-layer.yml's steps that read the includes",
    ).toEqual([expect.any(String)]);
    const step = steps[0]!;
    // A block: YAML reads a plain `run: ! grep …` as a tag on the string `grep …`, and drops the `!`.
    expect(step.lines.length > 1 || !/^!/.test(step.lines[0]!.trim()), `${step.where} is a plain scalar starting with !`).toBe(true);
    // As a step with no shell: key runs on ubuntu (`bash -e {0}`), in the check job's working-directory, seedelf-data/.
    const run = (cwd: string) => spawnSync("bash", ["-e", "-c", step.lines.join("\n")], { cwd, encoding: "utf8" }).status;
    const tmp = mkdtempSync(join(tmpdir(), "seedelf-data-includes-"));
    try {
      for (const [name, source] of [
        ["on one line", '#![doc = include_str!("../../README.md")]\n'],
        // As rustfmt wraps a long include there (datum.rs, standard.rs, templates.rs, live_public.rs).
        ["wrapped", 'const DOC: &str = include_str!(\n    "../../README.md"\n);\n'],
        ["as bytes", 'const DOC: &[u8] = include_bytes!("../NOTES.md");\n'],
      ] as const) {
        const crate = join(tmp, name.replaceAll(" ", "-"), "seedelf-data");
        mkdirSync(join(crate, "api/src"), { recursive: true });
        writeFileSync(join(crate, "api/src/lib.rs"), source);
        expect(run(crate), `${step.where} on a crate that includes Markdown ${name}`).not.toBe(0);
      }
      // The tree's own Rust, copied as it is: all the step reads, and nothing then runs in seedelf-data/ itself.
      const tree = join(tmp, "tree", "seedelf-data");
      const files = rust(DATA);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const to = join(tree, relative(DATA, file));
        mkdirSync(dirname(to), { recursive: true });
        writeFileSync(to, readFileSync(file));
      }
      expect(run(tree), `${step.where} on the tree's Rust as it is`).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
