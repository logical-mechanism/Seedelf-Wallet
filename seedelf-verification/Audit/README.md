# The audit of the proofs

A review of this folder's proofs as they stood on 2026-11-03. The proofs are about Seedelf, a stealth wallet on Cardano, and Lovejoin, the mixer the Seedelf Wallet uses. The review asked whether each proved result (each ✅, as the Lean 4 builds print it) is real, and what the proofs and their docs leave out. It's the project's own review, done with AI review agents, not an independent audit.

It covers the scenario proofs, each of which fixes the fields its script never reads. The every-transaction proofs, kernel and Blaster alike, came after it, so it doesn't cover them, and that includes the kernel theorems the claim in [CLAIMS.md](../CLAIMS.md) rests on.

## What was reviewed

- **The tools:** Blaster, IOG's Lean tactic that hands a goal to the Z3 solver, reviewed, at its pinned commit, as code the proofs trust; and PlutusCoreBlaster, reviewed as the model of the machine Cardano runs scripts on.
- **The inputs:** that the proved bytes are the deployed ones, and that the scenarios are real Plutus V3 script contexts.
- **The proofs:** each theorem's statement, and the build's evidence for it; Seedelf's specs against their Aiken source; Lovejoin's classic pool, v2's Mix and its scenarios, and the templates.
- **The docs:** each written claim against the proofs.

Each critical and high finding was checked by two more reviewers, who tried to refute it (one on its evidence, one on its impact), and each medium by one. Lows and infos weren't checked. Severities (critical, high, medium, low, info) are as they stood after those checks. Where a finding needed it, the review added theorems, mutant scripts and checks: the suites in this folder (*What's here*, below).

The record is [review/findings.md](review/findings.md), with the full evidence in `review/findings.json` beside it.

## What it found

55 findings: 1 critical, 8 high, 13 medium, 24 low, 8 info and 1 refuted. None is a bug in a contract, and no proved result was false. They're what the proofs and their docs left out: a claim worded wider than its theorem, a check no theorem varied, a scenario that couldn't pass, a tool trusted without a check. The critical one: the theorems on the Seedelf policy's amount rule said nothing about mints, only about burns.

## How each was resolved

[findings.md](review/findings.md) gives each finding's resolution:

- **Closed by a theorem or a check:** 24, among them the critical one and seven of the eight highs. findings.md names the modules that close each one.
- **Out of scope:** four, all about Lovejoin's fee_contract, the script that holds fees for Mixes. No Seedelf transaction uses it, and every claim leaves it out. Two of the four have closing modules too. The audit's run leaves out fee_contract's controls and gap theorems (`Template/Fee{Spec,Limits,Iff,Gaps,Mutants}`, `Gaps/Template/AuditFee{Trust,Outputs,Key}`), which stay in the folder; it still runs `Template/FeeConcrete`'s concrete checks.
- **Open:** one. After the scripts' bytes are extracted again, a build can replay old results instead of rebuilding. Until that's fixed, the [README](../README.md)'s *Running it* says what to delete after an extract.
- **The rest name no closing module.** Most are about the wording of the docs at the time, and some are notes on the tools and the build. The later proofs cover some. One high, that no theorem covered v2's mix_logic outside its withdrawal, is now covered by `Lovejoin.Every.Readable.mix_logic_accepts_iff`, which states what mix_logic does for every purpose.

## What's here

- `Seedelf/`, `V2/`, `Template/`, `Classic/`: mutation and negative-control suites, one per script family.
  - Specs with one thing changed.
  - Hypotheses dropped, and `hypotheses → False` (vacuity).
  - Step limits cut, a wrong script, unit results.
  - The key theorems restated over `NAME.exec`, the CEK run itself.
  - Mutant scripts: the deployed source with one check removed, rebuilt with the same Aiken. A theorem that still holds for a mutant doesn't depend on the check it removed. They're negative controls: never deploy them.
- `Gaps/`: new theorems for the checks the existing theorems never vary.
  - Token identity, box-out datum shapes, uncounted boxes and proofs.
  - The trust anchor, fee retention and Mix recognition.
  - v2's mix_logic outside its withdrawal.
  - The medium findings.
- `Checks/`: evaluation-only checks, such as the flat decoder against Aiken's text, the Steps runs as `#guard`s, and every theorem's axioms.
- `diag/`: Blaster's SMT queries for proved theorems, dumped and replayed through Z3 (`bash Audit/diag/run-diag.sh quick`). It checks for Lean-blaster [#194](https://github.com/input-output-hk/Lean-blaster/issues/194): a contradictory background would make a ✅ vacuous. Where a Mix theorem's premises time out, they're replayed again with every input box sharing box 1's points and branches, as some controls do (below). A replay that settles nothing is flagged INCONCLUSIVE, never counted clean. The scan exits 1 for a LOOK, an INCONCLUSIVE or a Lean run that failed, timed out or was killed.
- `count.py`: reads each module's last build log and compares it with what its source expects. Blaster logs a check that comes back Undetermined as a warning only. `check.sh`, the folder's build runner, reports such a module as `UNDETERM` (undetermined), not `ok`. `check.sh` removes a module's build when it fails, here or in the dependency that holds it, so `count.py` reads it as `NO TRACE`, and a module resting on it as `STALE`. A module whose trace is older than its source is `STALE` too, until `./check.sh` reads it again. It exits 1 when any module isn't `ok`.

## Running it

It needs what the [README](../README.md)'s *Running it* lists, Z3 included, and up to 16 GB of memory a module. From `seedelf-verification/`, `bash Audit/run-all.sh` runs everything, family by family and cheapest first, with logs in `Audit/logs/`. It takes hours: run it overnight. It resumes where it stopped, and `bash Audit/run-all.sh audit-v2` runs a single family.

1. `audit-refresh` rebuilds the proof modules whose builds are older than their inputs, before the audit imports them.
2. `audit-quick`: definitions, `#guard`s and `#eval`s.
3. `audit-seedelf`, `audit-v2`, `audit-template`, `audit-classic`, then `audit-gaps`, each at 16G and 60 minutes a module.
4. `audit-last` and the diagnostic, after everything else.
5. Last, `count.py`, whose output goes to `Audit/logs/count.txt`, with the families whose run failed, a diag scan that flagged a row among them; `run-all.sh` then exits nonzero, as a full run also does when `count.py` finds a module not `ok`.

## Reading a result

- `✅ Expected Falsified`: the control did its job, since the solver found the mutated statement false.
- `❌ Unexpected Valid`: a control survived. The ✅ it targets doesn't depend on what the control changed: read the check's comment.
- `⚠️ Undetermined`, or a count that's off: inconclusive, not a pass.
- A failed `#guard`: a concrete run disagrees with what the scenario claims.
- A `by blaster` theorem that fails in `Gaps/`: the gap is real for that shape, or the statement is wrong. Either way it's worth a look before anything is claimed.
- Controls posed at one instance: over every input, Z3 doesn't always find a counterexample in time, so some V2 controls make every input box share box 1's points and branches, and Z3 needn't build different boxes. A control needs only one counterexample. Each module doc says which controls do this, and, where a branch must fail on its own, which field is kept separate.
