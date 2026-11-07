# The audit

A review of the proofs in `Seedelf/` and `Lovejoin/` as they stood on 2026-11-03, the scenario families: whether each ✅ is real, and what the proofs leave out. The every-transaction modules came after it (Seedelf's `*AnyTx*`, `Signers/`, `LinesAll` and `Shapes` modules, `Slice/`, `Lovejoin/AnyTx/` and `Lovejoin/Every/`), and none of them is in it. The mutant scripts are negative controls: never deploy them.

## What's here

- `Seedelf/`, `V2/`, `Template/`, `Classic/`: mutation and negative-control suites, one per script family.
  - Specs with one thing changed.
  - Hypotheses dropped, and `hypotheses → False` (vacuity).
  - Step limits cut, a wrong script, unit results.
  - The key theorems restated over `NAME.exec`, the CEK run itself.
  - Mutant scripts: the deployed source with one check removed, rebuilt with the same Aiken. A theorem that still holds for a mutant doesn't depend on the check it removed.
- `Gaps/`: new theorems for the checks the existing theorems never vary.
  - Token identity, box-out datum shapes, uncounted boxes and proofs.
  - The trust anchor, fee retention and Mix recognition.
  - v2's mix_logic outside its withdrawal.
  - The medium findings.
- `Checks/`: evaluation-only checks, such as the flat decoder against Aiken's text, the Steps runs as `#guard`s, and every theorem's axioms.
- `diag/`: Blaster's SMT queries for proved theorems, dumped and replayed through Z3 (`bash Audit/diag/run-diag.sh quick`). It checks Lean-blaster #194: a contradictory background would make a ✅ vacuous. Where a Mix theorem's premises time out, they're replayed again with the boxes in collapsed, as some controls are (below). A replay that settles nothing is flagged INCONCLUSIVE, never counted clean.
- `count.py`: reads each module's last build log and compares it with what its source expects. Blaster logs a check that comes back Undetermined as a warning only, so check.sh's `ok` can't tell it from a pass, but this can.

## Running it

`bash Audit/run-all.sh` runs everything, family by family and cheapest first, with logs in `Audit/logs/`. It takes hours: run it overnight. It resumes where it stopped, and `bash Audit/run-all.sh audit-v2` runs a single family.

1. `audit-refresh` rebuilds the proof modules whose builds are older than their inputs, before the audit imports them.
2. `audit-quick`: definitions, `#guard`s and `#eval`s.
3. `audit-seedelf`, `audit-v2`, `audit-template`, `audit-classic`, then `audit-gaps`, each at 16G and 60 minutes a module.
4. `audit-last` and the diagnostic, after everything else.
5. Last, `count.py`, whose output goes to `Audit/logs/count.txt`.

## Reading a result

- `✅ Expected Falsified`: the control did its job, since the solver found the mutated statement false.
- `❌ Unexpected Valid`: a control survived. The ✅ it targets doesn't depend on what the control changed: read the check's comment.
- `⚠️ Undetermined`, or a count that's off: inconclusive, not a pass.
- A failed `#guard`: a concrete run disagrees with what the scenario claims.
- A `by blaster` theorem that fails in `Gaps/`: the gap is real for that shape, or the statement is wrong. Either way it's worth a look before anything is claimed.
- A control asked at one instance: over every input, Z3 doesn't always find a counterexample in time, so some V2 controls give every box in box 1's points and branches, and Z3 needn't build different boxes. A control needs only one counterexample. Each module doc says which controls, and which field stays apart where a branch must fail alone.
