# Plans

**Live specs only.** A plan here is what a session is handed to build a chunk, with the decisions made along the way — in the owner's words, "just prompts for you basically". If a file is in this folder, it's being built now or next.

**When a chunk lands, its plan moves to [../archive/plans/](../archive/plans/)** (the owner, 2026-10-04). Before it moves, whatever a later session will need from it — a decision, an invariant, a gotcha — goes into the design doc for that area ([architecture.md](../architecture.md), [flows.md](../flows.md), [privacy.md](../privacy.md), [keys-and-accounts.md](../keys-and-accounts.md), [development.md](../development.md)), and anything still open goes into [post-release-roadmap.md](../post-release-roadmap.md)'s *Owed* or *Kept in mind*. A stale plan read as current is the one failure mode that costs real work, so none stays here once it's done.

**A new chunk** takes the next number, a branch `web-wallet/<topic>` from `main`, and a file `chunk-NN-<topic>.md` here; [post-release-roadmap.md](../post-release-roadmap.md#how-this-file-works) has the rest.
