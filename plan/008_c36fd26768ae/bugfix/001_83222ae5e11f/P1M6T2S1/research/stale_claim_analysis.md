# P1.M6.T2.S1 — Stale-Claim Analysis: README.md & VERIFICATION.md vs. post-fix v1.2 behavior

## Method

1. Read `architecture/system_context.md` (the snapshot/restore flow + the 7-bugs table) — authoritative
   behavioral contract.
2. Read README.md §5 "Working-tree revert (v1.2)" in full (lines 202–260) + the two "Resolved bugs"
   subsections (h3.19 v1.0 round, h3.20 v1.1 round).
3. Read VERIFICATION.md in full (v1.0 DoD report + two remediation tables).
4. Read the description blocks of the 5 behavior-affecting bug-fix PRPs (P1.M1.T1.S1 BUG-001,
   P1.M2.T1.S1 BUG-002, P1.M3.T1.S1 BUG-003, P1.M4.T2.S1 BUG-004, P1.M5.T1.S1 BUG-005) for EXACT
   post-fix behavior.
5. Confirmed the rewind-marker schema (`src/markers.ts:83-100`) + the dirty-guard wiring
   (`src/tools/rewind.ts` step 6b) to pin exact field names.
6. grep-confirmed VERIFICATION.md contains no v1.2 working-tree-revert content.

## Core finding: the README §5 was written to the SPEC (intended behavior); the 7 bugs were
## implementation defects that made 4 of those intended behaviors non-functional. Post-fix the
## implementation matches the spec, so MOST §5 claims are already accurate. The work is a SMALL,
## focused corrective pass on the handful of places where §5 is imprecise/incomplete about the
## now-true behavior — NOT a rewrite.

---

## VERIFICATION.md — FINDING: no edits needed

VERIFICATION.md is the **v1.0 DoD report** (title: "pi-mulligan v1.0 — Verification Report"). Its two
remediation tables cover the v1.0 round (BUG-001–BUG-006: checkpoint-clear-loop, config-int-floors,
empty-needle, audit-disabled, protected-refusal) and the v1.1 round (BUG-001–BUG-007: nudge
suppression, compaction pinned-walk, drift threshold, pendingBloatHits, retry-budget cancel-exclusion,
cancel no-op text, checkpoint disabled-gate). NONE of these are the v1.2 working-tree-revert bugs.

`grep -niE "working.tree|revert_file|delete_created|nonGitMode|explicit.paths|dirty.?guard|snapshot store|checkpoint.*snapshot|v1\.2" VERIFICATION.md` → **EMPTY**. VERIFICATION.md has ZERO v1.2-revert content,
therefore ZERO stale v1.2 claims. Its historical test-count baselines (671 / 956 / 974) are explicitly
preserved as "accurate historical snapshots" and are NOT stale.

→ **VERIFICATION.md: VERIFY (grep) and make NO edits.** Document the finding in the PRP; do not touch
the file. (Touching a v1.0 historical report to inject v1.2 content would violate "do not add new
sections" and muddle the historical record.)

---

## README.md §5 — the exact stale/incomplete claims (with line numbers)

### Claim A — Dirty-guard behavior (README.md:245) — BUG-001 + BUG-004 (PRIMARY)

Current text:
> "Before restore, a dirty check compares each affected file's **current** content to its
> after-snapshot state. If **any** affected file changed since the turn ended (a human/other-process
> edit), the **whole file-revert is refused** — not a silent skip — and the context rewind still
> proceeds. The rewind result names the dirty paths (`refused`)."

Two post-fix accuracies the text does not currently capture:

1. **(BUG-004) "each affected file" is now the comprehensive snapshot diff, not the write/edit ledger.**
   Post-fix (`rewind.ts` step 6b): `affectedPaths = await store.changedPaths(checkpoint.beforeRef)` —
   EVERY workspace path differing between the pre-turn snapshot and the current tree. This INCLUDES
   files mutated by `bash` (`sed -i`, `awk -i inplace`, `python -c`, `perl -i`, heredocs) that the old
   heuristic `ledger.modifiedFiles` MISSED (they landed in `ledger.bashSideEffects`). Pre-fix this was
   an E30 silent-clobber (a concurrent human edit to a bash-written file was overwritten to pre-turn
   content). Post-fix the README's "never a silent clobber" guarantee holds for ALL file-modifying
   tools. → Clarify "affected" = the snapshot diff (all tools), closing the E30 gap.

2. **(BUG-001) the dirty guard is conditional on `afterRef`; checkpoints SKIP it.** Post-fix
   (`rewind.ts` step 6b): the guard + refuse/proceed logic runs ONLY when `checkpoint.afterRef` is
   truthy. Checkpoints capture ONCE and never set `afterRef` (the `?? beforeRef` fallback was removed),
   so for `granularity:"checkpoint"` the guard is SKIPPED and `store.restore()` proceeds directly.
   Pre-fix checkpoint file-revert was ALWAYS refused when the span changed files (its only useful case).
   Post-fix checkpoint file-revert WORKS. → The README's "after-snapshot state" wording implies all
   restores are guarded; clarify that the guard is a TURN-level guarantee (turns have an after-snapshot),
   and checkpoints (which capture once, no after-snapshot) restore directly without a dirty guard.

3. **Precision (pre-existing, surfaced by this pass):** "names the dirty paths (`refused`)" — the
   rewind MARKER field is `refusedFiles` (`src/markers.ts:97`); `refused` is the success-text bucket
   COUNT (`rewind.ts` RevertDetails). Tighten to the marker field name for accuracy.

### Claim B — Non-git mode / explicit-paths (README.md:251) — BUG-003 (VERIFY; likely no change)

Current text:
> `"explicit-paths"` — conservative: snapshots only the explicit `write`/`edit` tool paths. Bash file
> commands are **not** captured (the tool warns once per turn)…

Post-fix (P1.M3.T1.S1): a `tool_call` hook feeds `event.input.path` from every `write`/`edit` call into
`rt.pendingExplicitPaths`, threaded into `capture()`; bash in explicit-paths mode warns once per turn.
Pre-fix explicit-paths was NON-FUNCTIONAL (every capture passed no paths → empty manifest → restore
reverted nothing). → The README's description was describing a BROKEN feature as if it worked. Post-fix
the description is now ACCURATE. **Likely NO text change needed** — the description already matches the
now-working implementation. VERIFY the wording against the implementation; only adjust if a nuance is
off (e.g. confirm "warns once per turn" is still the wording in `capture.ts`/the tool_call hook).

### Claim C — Granularity table, checkpoint row (README.md:228) — BUG-001 (now-true; no change)

`| checkpoint | ✅ | Restore to the checkpoint-creation snapshot. |` — pre-fix the ✅ was FALSE (checkpoint
revert always refused). Post-fix it is TRUE. **No text change** — the table is now accurate. (Claim A's
checkpoint-skips-guard note is the relevant corrective, not the table.)

### Claim D — Config caps table + Per-call flags — BUG-005 (LIGHT touch, optional)

- Per-call flags (README.md:218): "Best-effort; failures are logged and never block the rewind."
- Config table (README.md:256–260): `maxFileBytes` "skip + warn (fail-closed)"; `maxTotalBytes` /
  `maxSnapshotsPerTurn` "capture stops beyond it (partial snapshot)".

Post-fix (P1.M5.T1.S1): `RestoreResult.skipped` is now POPULATED in both backends for caps-exhausted
files and surfaced to the agent — the success-text clause "N skipped/failed" can now be >0 and
`marker.revert.skipped === true`. Pre-fix `skipped` was always empty/false (E29 caps-degradation was
invisible). The existing wording is not WRONG, but it under-describes the now-surfaced signal. →
OPTIONAL one-clause addition: caps-exhausted paths are reflected in the result (not silently dropped).
Keep light; do NOT restructure the table.

### Claim E — Checkpoint persistence across /resume — BUG-002 (LIGHT touch, optional)

Post-fix (P1.M2.T1.S1): `session_start` rebuilds `rt.snapshots` from persisted
`mulligan:revert-checkpoint` entries, so a checkpoint-granularity `revert_file_changes` rewind finds
its snapshot after `/resume`. README §5 does NOT currently claim this (it is silent on
checkpoint-snapshot persistence across reload; line 327's "rewinds and shrinks persist across reload"
is about the markers, not the v1.2 snapshot revert). There is NO stale claim (README doesn't say it
breaks). → OPTIONAL one-sentence inline clarification that checkpoint snapshots are rebuilt on session
start so checkpoint file-revert survives `/resume`. Inline only — "do not add new sections."

### Claims F/G — BUG-006 (GC reclamation) + BUG-007 (has() mutex) — NO README impact

Both are INTERNAL correctness fixes. BUG-006 (reset `GitBackend.lastCommit` at turn boundary so deleted
turn-snapshot commits become unreachable → bounded within-session storage growth) and BUG-007 (mutex in
`has()`) have no user-facing behavior the README describes. The README's storageDir "wiped on
`session_shutdown`" claim is unaffected. → NO README change for these.

---

## The two pre-existing "Resolved bugs" subsections (README.md:331 / :340) — DO NOT TOUCH

h3.19 "Resolved bugs (BUG-001–BUG-005)" = the v1.0 post-release round (checkpoint-clear-loop,
config-int-floors, empty-needle, audit-disabled). h3.20 "Resolved bugs — v1.1 validation pass" = the
v1.1 round (drift threshold, high-water awareness-only, audit checkpoint count, rewind depth
cancel-exclusion). These are SEPARATE bug-numbering rounds in the nudge/audit/guard layers — NOT the
v1.2 working-tree-revert bugs (which are this changeset's BUG-001–BUG-007). Per the task's "do NOT add
new sections," we do NOT add a v1.2-resolved-bugs subsection. The corrective work lives entirely in
§5's feature descriptions.

---

## Scope decision (for the PRP)

README.md edits = §5 only:
- DIRTY-GUARD paragraph (Claim A): the ONE substantive rewrite (BUG-001 checkpoint-skip + BUG-004
  snapshot-diff affected set + `refusedFiles` precision).
- EXPLICIT-PATHS (Claim B): VERIFY; edit only if a nuance is off.
- CAPS / skipped (Claim D): OPTIONAL one-clause addition.
- CHECKPOINT /resume persistence (Claim E): OPTIONAL one-sentence inline note.
VERIFICATION.md = NO edits (verify + document the no-v1.2-content finding).

Total: a small, surgical Markdown corrective pass. No code, no config, no new sections, no test change
(docs-only — there is no test that asserts README prose; `npm test` is unaffected by README edits).