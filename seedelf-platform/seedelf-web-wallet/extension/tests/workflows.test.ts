// The repository's GitHub workflows (.github/workflows/), read as text: what each runs, and what a step that holds a
// secret may write to its log, which a public repository's Actions show anyone.

import { readdirSync, readFileSync } from "node:fs";

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
    // Not vacuous: the release key's imports are among the steps read, Windows' with them.
    expect(holding.filter((s) => s.startsWith("release.yml: - name: Import GPG Key"))).toHaveLength(4);
    expect(prints).toEqual([]);
  });
});
