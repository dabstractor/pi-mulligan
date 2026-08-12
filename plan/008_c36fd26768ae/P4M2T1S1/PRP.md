name: "P4.M2.T1.S1 — Step 6b decision tree + checkpoint resolution + dirty guard"
description: |

---

## Goal

**Feature Goal**: Add **step 6b** to `rewindExecute` (`src/tools/rewind.ts`): the v1.2 working-tree-revert
*decision tree*. After the rewind marker is persisted (step 7) and the checkpoint is consumed (step 7b), and
BEFORE the mutation warning (step 8), inspect the agent's opt-in revert flags and, when the agent asked for a
file revert, (a) gate on config, (b) gate on granularity, (c) resolve the `RevertCheckpoint` for the boundary
from `rt.snapshots`, (d) run the **dirty guard** (`store.dirtyCheck`) against the ledger's modified-file set,
and (e) produce a structured proceed/refuse/skip **decision** plus the success-text notices for every terminal
branch. The actual `store.restore(...)` + folding the `RestoreResult` into the marker/success-text is the NEXT
subtask (**P4.M2.T1.S2**); this item leaves a clean, clearly-marked seam for it.

**Deliverable**: A modified `src/tools/rewind.ts` (step 6b logic block + `RevertDecision` local type +
`successText`/`RewindDetails` extension) plus new tests in `test/tools/rewind.test.ts`. NO new files. The
proceed branch is a no-op placeholder (comment-seam) that S2 fills with the restore call.

**Success Definition**:
- When NEITHER `revert_file_changes` nor `delete_created_files` is true → step 6b is skipped entirely; the
  success text is byte-identical to the v1.1 path (the unchanged regression).
- Flags set + `!config.revert.enabled` → success text appends `"(file revert requested but disabled in config)"`.
- Flags set + `granularity === "last_tool_call_group"` → success text appends the granularity-mismatch notice.
- Flags set + enabled + supported granularity + checkpoint MISSING (or no store) → success text appends the
  skip notice (0 reverted); the rewind still completes.
- Flags set + enabled + supported granularity + checkpoint FOUND + dirty guard drifts → success text appends
  the refuse notice; `RewindDetails.revertRefused === true`; NO restore runs (S2 not yet wired).
- Flags set + enabled + supported granularity + checkpoint FOUND + dirty guard clean → PROCEED branch reached;
  S1 performs NO restore (seam for S2); success text has no revert clause yet.
- A failure anywhere in 6b (e.g. `dirtyCheck` throws) → fail-open to a skip notice; the rewind STILL completes.
- `npx tsc --noEmit` clean; `npx vitest run test/tools/rewind.test.ts` green; full `npx vitest run` green.

## User Persona

**Target User**: The LLM agent that calls `mulligan_rewind` with `revert_file_changes: true` (opting into
working-tree restore), and the implementing agent (this PRP's consumer).

**Use Case**: After a wrong-direction turn where the agent also edited files, the agent requests
`revert_file_changes` so the resumed attempt need not re-read them. This item decides WHETHER that revert can
safely proceed (config on? supported granularity? snapshot present? tree clean since the turn ended?) and
either refuses/skips with a clear notice or hands a clean decision to the restore step.

**Pain Points Addressed**: Without step 6b the opt-in revert flags (added by P4.M1.T1.S1) are accepted but
silently ignored — the feature is inert. Without the dirty guard, a restore would silently clobber a human's
unsaved edit made after the agent's turn (the one unrecoverable failure — see @14 §6 step 3 / E30).

## Why

- **Activates the v1.2 feature wiring**: the params (P4.M1.T1.S1), the `rt.snapshots` map (P1.M2.T2.S2 +
  the capture hooks P3.M1.T1 / checkpoint command P3.M2.T1), and the `SnapshotStore` (P2) all exist but are
  never read by `rewindExecute` until this step. Step 6b is the consumer that ties them together for the
  decision half. (@14 §7 "mulligan_rewind integration".)
- **Safety first (refuse-on-dirty)**: the dirty guard is the single safety-critical piece — it must run
  BEFORE any restore and refuse the WHOLE file-revert on any drift. This item owns that guard; S2 owns the
  restore that the guard gates. (@14 §6 step 3, E30.)
- **Best-effort, never blocks the rewind**: like every Mulligan computation, the file-revert decision is
  advisory to the PRIMARY deliverable (the context rewind). A missing snapshot, a dirty-guard refusal, or a
  thrown `dirtyCheck` degrade to a notice — the rewind ALWAYS completes. (@14 §6 step 1, §7; E27/E30.)
- **Scope guard**: this item is the DECISION tree + RESOLUTION + DIRTY GUARD only. It does NOT call
  `store.restore`, does NOT fold a `RestoreResult` into the marker (the marker is already persisted at step 7),
  and does NOT reword the mutation warning. Those are P4.M2.T1.S2 and P4.M2.T2.T1 respectively (sibling tasks).
  This item leaves a clean seam so they slot in without rework.

## What

A single new block inside `rewindExecute` (step 6b), inserted after step 7 (persist) + step 7b (checkpoint
consumption) and before step 8 (the `hasWarning` mutation-warning computation). Plus two small supporting
edits: extend `successText()` to thread a revert clause, and add `revertRefused?` to `RewindDetails`.

### The decision tree (verbatim notices — load-bearing, do not rephrase)

| Condition | Notice appended to success text | Decision for S2 |
|---|---|---|
| Neither flag set | *(none — skip 6b entirely)* | n/a (v1.1 path) |
| Flag(s) set, `!config.revert.enabled` | `(file revert requested but disabled in config)` | skip |
| Flag(s) set, `granularity === "last_tool_call_group"` | `File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn.` | skip |
| Flag(s) set, enabled, supported gran., **no checkpoint** (or no `rt.store`) | `(file revert skipped: no working-tree snapshot for this boundary — 0 files reverted)` | skip |
| Checkpoint found, dirty guard **drifted** (`driftedPaths.length > 0`) | `(file revert refused: <N> path(s) changed since the turn ended — not overwritten; re-request if intended)` | refuse (`revertRefused=true`) |
| Checkpoint found, dirty guard **clean** | *(none in S1 — S2 appends "Reverted X file(s)…" after restore)* | **proceed** (seam) |

### Success Criteria

- [ ] The five terminal branches each append their EXACT notice string (table above) to the success text.
- [ ] The no-flags branch appends NOTHING and produces byte-identical output to the current v1.1 path.
- [ ] The proceed branch is reached only when flags+config+granularity+checkpoint+clean-guard all hold; S1
      performs NO `store.restore` there (clearly-marked comment seam for S2).
- [ ] `rt.snapshots` is read with the CORRECT keys: `"turn"` for `last_turn`, `"ckpt:" + params.checkpoint`
      for `checkpoint`. (See Context — keys confirmed against capture.ts:104 + commands.ts:217.)
- [ ] The dirty guard calls `store.dirtyCheck(checkpoint.afterRef ?? checkpoint.beforeRef, affectedPaths)`
      where `affectedPaths === ledger.modifiedFiles` (the only deterministic file list available; see Context).
- [ ] `RewindDetails` gains an optional `revertRefused?: boolean`, `true` only on the refuse branch.
- [ ] A `dirtyCheck` throw (or any 6b exception) is caught → fail-open to a skip notice; the rewind completes.
- [ ] `npx tsc --noEmit` clean; `npx vitest run test/tools/rewind.test.ts` green; full suite green.

## All Needed Context

### Context Completeness Check

_Pass test_: An implementer who has never seen this codebase is given this PRP + `src/tools/rewind.ts`. They
can implement step 6b because: the exact insertion point (after step 7b, before step 8's `hasWarning`) is named;
every variable 6b reads (`config`, `granularity`, `params.*`, `rt`, `ledger`) is already in scope at that point
(proven below); every Map key, every notice string, and the `affectedPaths` source are pinned down with
code-level citations; the seam for S2 is specified; the test idiom (fakes, `setConfig`, `run`, `firstText`) is
documented with a concrete seeding recipe. ✅

### Documentation & References

```yaml
# MUST READ — the authoritative spec for this task
- file: spec/05-tools.md
  why: §1 "Behavior (step by step)" step 6b (the v1.2 working-tree revert decision tree — the exact branch
       order + notice strings) + the "Parameter schema" (revert_file_changes/delete_created_files defaults).
  critical: |
    The branch order is LOAD-BEARING: (1) neither flag → skip entirely; (2) !config.revert.enabled → disabled
    notice; (3) last_tool_call_group → granularity notice; (4) missing checkpoint → skip/0-reverted; (5) dirty
    guard drifted → refuse; (6) clean → proceed. Do NOT reorder — the spec sequences config-before-granularity-
    before-resolution.
- file: spec/14-working-tree-revert.md
  why: §6 "Restore semantics — refuse-on-dirty, then restore" (step 1 missing-checkpoint ⇒ "0 reverted, rewind
       still proceeds"; step 3 dirty guard REFUSES the WHOLE file-revert on any drift; the afterRef ??
       beforeRef fallback), §7 "mulligan_rewind integration" (the success-text additions + the marker fold that
       S2 owns), §1 (three-layer opt-in: config.enabled is layer 1).
  critical: |
    §6 step 3: "if afterRef exists, run dirtyCheck(afterRef, affected). If any path returned → REFUSE the entire
    file-revert: do NOT restore, do NOT delete." — the refuse is WHOLE, not per-path. §6 step 1: a missing
    checkpoint ⇒ "revert skipped with an honest count (0 reverted); the rewind still proceeds." §6 step 3
    mid-turn note: before agent_end, afterRef is unset ⇒ dirtyCheck trivially passes (the just-in-time path) —
    our `afterRef ?? beforeRef` fallback is the spec-sanctioned degrade.

# THE FILE TO EDIT
- file: src/tools/rewind.ts
  why: THE file. rewindExecute is the single function (steps 1–9, one try/catch — E13). Step 6b inserts after
       step 7 (appendRewindMarker + leaveNote) + step 7b (checkpoint consumption) and before step 8 (hasWarning).
  pattern: |
    - In-scope-at-insertion-point variables (all ALREADY declared earlier in rewindExecute, NO new fetch needed):
        `config` (getConfig(), step 1); `granularity` (top of try); `params` (the execute arg — has
        revert_file_changes/delete_created_files/checkpoint after P4.M1.T1.S1); `rt` (SessionRuntime|null,
        fetched above the try; `rt?.store`, `rt?.snapshots`); `ledger` (FileLedger, step 5 — `ledger.modifiedFiles`).
    - successText(granularity, k, hasWarning) at ~line 230 builds the text; EXTEND its signature + the call site.
    - RewindDetails interface (~line 140) — ADD `revertRefused?: boolean`.
    - The whole 6b block must live INSIDE the existing main try{} (so E13's catch covers it) but after step 7b.
  gotcha: |
    The marker is ALREADY persisted at step 7 (appendRewindMarker) — BEFORE 6b runs. Therefore this item CANNOT
    fold a revert result into the persisted marker (the marker is already on disk). Marker folding is S2's job
    (S2 must either re-order or append a follow-up — out of scope here). This item only touches success-text +
    details.revertRefused. See "Marker-fold handoff note" in Known Gotchas.

# THE TYPES 6b consumes (read-only — do NOT edit these files)
- file: src/markers.ts
  why: RevertCheckpoint shape (the value in rt.snapshots): { label:string; backend:"git"|"cas"; beforeRef:string;
       afterRef?:string; turnIndex:number; ts:number }. backend is "git"|"cas" ONLY (a checkpoint exists ONLY
       when a real backend captured — NoOpStore never creates one). afterRef is OPTIONAL (set by the agent_end
       hook mutating the "turn" entry in place; UNSET before agent_end / for checkpoints until a later capture).
  pattern: import { type RevertCheckpoint } — but you likely do NOT need to import it; `rt.snapshots.get(key)`
       already returns `RevertCheckpoint | undefined` (the Map is typed in runtime.ts). Use it structurally.
- file: src/snapshot/store.ts
  why: the SnapshotStore interface — `dirtyCheck(afterRef: string, paths: string[]): Promise<string[]>` is
       ASYNC (await it). Returns the subset of `paths` that drifted vs afterRef. `describe()` is sync →
       `{backend:"git"|"cas"|"none"}`. NoOpStore.dirtyCheck returns `[]` always; git.ts:430 returns `[]` when
       `!afterRef || paths.length===0` (so empty affectedPaths ⇒ guard trivially passes — keep affectedPaths
       non-empty via ledger.modifiedFiles).
  gotcha: the store methods are Promise-returning. rewindExecute is ALREADY `async` (it does NOT currently
       await anything, but adding `await store.dirtyCheck(...)` is fine — the caller already awaits execute()).

# THE RUNTIME — the store + snapshots live HERE (read-only)
- file: src/runtime.ts
  why: `getRuntime(sessionId)` returns the live SessionRuntime (already fetched as `rt` at the top of the try).
       `rt.store?: SnapshotStore` (created at session_start by P3.M1.T2.S1 when config.revert.enabled; undefined
       otherwise). `rt.snapshots?: Map<string, RevertCheckpoint>` (a fresh Map per freshRuntime; read via
       `rt.snapshots?.get(key)`). rt CAN be null (getRuntime is in a try above the main try that leaves rt=null
       on throw) — so guard with `rt?.`.
  gotcha: getRuntime takes a STRING sessionId — but you do NOT call it; `rt` is already in scope. Do NOT
       re-fetch. The Map key for checkpoints is `"ckpt:" + name` (NOT "checkpoint:" — the runtime.ts/markers.ts
       docstrings are imprecise; the ACTUAL writers use "ckpt:", confirmed in commands.ts:217 + capture.ts:104).

# THE CAPTURE WRITERS — confirm the Map keys (read-only — DO NOT edit)
- file: src/capture.ts
  why: CONFIRMS the last_turn key is `"turn"`: `rt.snapshots?.set("turn", { label:"turn", backend,
       beforeRef, turnIndex, ts })` (turnStartCaptureHandler ~line 104). The agent_end hook MUTATES that entry
       in place: `existing.afterRef = afterRef` (~line 150) — so a "turn" checkpoint's afterRef is set only
       AFTER agent_end fires; before that it is undefined (the dirty-guard fallback `afterRef ?? beforeRef`).
- file: src/commands.ts
  why: CONFIRMS the checkpoint key is `"ckpt:" + name`: `rt.snapshots?.set("ckpt:" + name, { label:"ckpt:"+name,
       backend, beforeRef:ckptRef, turnIndex, ts })` (~line 217, the /mulligan_checkpoint step 4b). A checkpoint
       entry has beforeRef but NO afterRef (checkpoints capture once) — so dirty guard always uses beforeRef for
       checkpoints (afterRef ?? beforeRef ⇒ beforeRef).

# THE LEDGER — the affectedPaths source
- file: src/ledger.ts
  why: FileLedger shape: { readFiles:string[]; modifiedFiles:string[]; bashSideEffects:string[] }.
       `modifiedFiles` = paths from write/edit tool calls + high-confidence bash write paths (de-duped, sorted).
       THIS is the affectedPaths source for dirtyCheck (see "affectedPaths design decision" in Known Gotchas).
  gotcha: modifiedFiles is the deterministic extraction of what the rewound span CHANGED — it is the best
       available approximation of "files restore would touch". It may MISS files a bash command mutated but the
       ledger could not parse (e.g. an oblique `sed` target) — documented best-effort limitation (E5/E27).

# THE CONFIG — the gate fields (read-only)
- file: src/config.ts
  why: `config.revert.enabled` (boolean, default false — layer-1 gate) + `config.revert.allowDeleteCreatedFiles`
       (boolean, default false — layer-3 delete gate; S2 reads it, this item only needs `enabled`). `config` is
       already read at step 1 of rewindExecute. validateConfig overlays a PARTIAL onto DEFAULT_CONFIG, so tests
       can `setConfig({ revert: { enabled: true } })` and the other 7 fields default.
  gotcha: default revert.enabled=false ⇒ in the no-flags OR disabled branches the feature is inert. Tests that
       exercise the resolve/guard branches MUST `setConfig({ revert: { enabled: true } })` AND seed rt.snapshots
       + rt.store with fakes.

# THE TEST IDIOM
- file: test/tools/rewind.test.ts
  why: THE test file to extend. Idiom: vitest; hand-rolled makePi()/makeCtx() fakes (NO vi.fn()); `.js` imports;
       `run(pi, ctx, params, toolCallId)` helper drives makeRewindTool(pi).execute(...); `firstText(res)`
       extracts the text; `VALID_NOTE` constant; `clearAll()` + `setConfig(undefined)` in beforeEach/afterEach.
  pattern: to test the resolve/guard branches you must SEED the runtime: `const rt = getRuntime(sid);
       rt.store = <fakeStore>; rt.snapshots!.set("turn", { label:"turn", backend:"git", beforeRef:"rb",
       afterRef:"ra", turnIndex:0, ts:Date.now() })`. The fake store is a plain object cast to SnapshotStore
       with a scripted `dirtyCheck` (a closure over a `let drifted` you flip per-test). sid comes from
       makeCtx's sessionManager.getSessionId(). See "Test seeding recipe" in Implementation Patterns.
  gotcha: the existing `beforeEach` does `setConfig(undefined)` (DEFAULT_CONFIG ⇒ revert.enabled=false). Every
       new test that needs revert ON must `setConfig({ revert: { enabled: true } })` AFTER beforeEach ran. The
       existing success-path tests build a contextEntries snapshot (user msg + toolGroup) via makeCtx so K>0 —
       mirror an existing success test's makeCtx setup for the proceed/clean-guard test (so the rewind reaches 6b).
```

### Current Codebase tree (relevant slice)

```bash
src/
  tools/
    rewind.ts          # EDIT — step 6b block + successText extension + RewindDetails.revertRefused
  markers.ts           # READ ONLY — RevertCheckpoint shape
  runtime.ts           # READ ONLY — rt.store + rt.snapshots (already fetched as `rt`)
  snapshot/store.ts    # READ ONLY — dirtyCheck signature (async, Promise<string[]>)
  capture.ts           # READ ONLY — confirms "turn" key + agent_end mutates afterRef
  commands.ts          # READ ONLY — confirms "ckpt:"+name key
  ledger.ts            # READ ONLY — FileLedger.modifiedFiles (affectedPaths source)
  config.ts            # READ ONLY — config.revert.enabled (gate)
test/
  tools/
    rewind.test.ts     # EDIT — add the 6b decision-tree test block
```

### Desired Codebase tree

```bash
# No new files. Two files modified.
src/tools/rewind.ts        # + RevertDecision local type; + step 6b block; successText += revertClause param;
                           #   RewindDetails += revertRefused?; details return += revertRefused
test/tools/rewind.test.ts  # + "mulligan_rewind step 6b decision tree (P4.M2.T1.S1)" describe block (7-8 tests)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL #1 — INSERT AFTER step 7b, BEFORE step 8. The current numbering in rewindExecute is:
//   (1) config gate → (2) note validation → (3) checkpoint existence → (4) depth → (4b) retry budget →
//   (4c) context-fraction → (5) ledger+K preview (sets `ledger`,`k`,`hideEntryIds`) → (6) render note →
//   (7) appendRewindMarker + leaveNote → (7b) checkpoint label consumption → (8) hasWarning computation →
//   (9) successText + return.  STEP 6b GOES BETWEEN (7b) AND (8). Do not place it inside the step-7b
//   checkpoint-consumption try/catch (that is checkpoint-granularity-only + best-effort); 6b is its own block.

// CRITICAL #2 — the Map keys are "turn" and "ckpt:"+name, NOT "checkpoint:"+name. The runtime.ts + markers.ts
//   docstrings loosely say "checkpoint:<name>" but the ACTUAL writers (capture.ts:104, commands.ts:217) use
//   "turn" and "ckpt:" + name. Mismatching the key ⇒ the checkpoint NEVER resolves ⇒ every test hits the
//   missing-checkpoint branch. Pin this: `const key = granularity === "checkpoint" ? \`ckpt:${params.checkpoint}\` : "turn";`

// CRITICAL #3 — affectedPaths = ledger.modifiedFiles (DESIGN DECISION). The spec (@14 §6 step 2) says "the
//   affected set = paths that differ between beforeRef and the current tree" — but the SnapshotStore interface
//   exposes NO diff/listChanged method, so the rewind tool CANNOT compute that set directly. The ONLY
//   deterministic file list available at the insertion point is `ledger.modifiedFiles` (the span's modified
//   files, extracted in step 5). Use it. This is a faithful, best-effort approximation consistent with the
//   spec's pervasive "best-effort, never blocks the rewind" philosophy. PASSING [] would make git.ts:430 return
//   [] trivially (guard always passes) — so modifiedFiles (possibly empty) is strictly better. Documented
//   limitation: files a bash command mutated but the ledger could not parse are NOT pre-checked (restore still
//   handles them best-effort in S2); a human edit to an agent-untouched file is not pre-caught. Acceptable for
//   v1.2 (no diff method exists); flagged for a future store.diff() enhancement.

// CRITICAL #4 — the store methods are ASYNC (Promise return). `await store.dirtyCheck(...)`. rewindExecute is
//   already `async`; adding the await is fine (execute()'s caller already awaits it). The await yields the event
//   loop — single-threaded JS, rt/store are stable across it (no concurrent handler mutates this turn's runtime).

// CRITICAL #5 — the dirty guard REFUSES THE WHOLE file-revert on ANY drift (not per-path). @14 §6 step 3:
//   "if any path returned → REFUSE the entire file-revert: do NOT restore, do NOT delete." So a single drifted
//   path blocks ALL file reversion. The notice uses driftedPaths.length (the count), and revertRefused=true.

// CRITICAL #6 — MARKER-FOLD HANDOFF NOTE (do NOT solve here). The rewind marker is persisted at step 7 (BEFORE
//   6b). Therefore this item CANNOT fold a revert result into the persisted marker — it is already on disk.
//   The marker.revert field folding is S2's explicit scope ("store.restore + fold results into marker.revert").
//   S2 must resolve HOW (likely: S2 computes the RestoreResult then re-orders persist AFTER restore, OR appends a
//   follow-up audit entry). THIS ITEM only: (a) appends notices to the SUCCESS TEXT for terminal branches,
//   (b) sets details.revertRefused. Do NOT attempt to mutate the already-persisted marker.

// CRITICAL #7 — E13 fail-open for 6b. The whole 6b block lives inside the main try{} (so the outer catch covers
//   it), BUT wrap the resolve+dirtyCheck in its OWN try/catch so a thrown dirtyCheck (network/disk IO) degrades
//   to a SKIP notice rather than bubbling to the outer "unexpected error" refusal (which would mislabel a
//   file-revert hiccup as a rewind failure). A 6b exception ⇒ `revertClause = "(file revert skipped: an error
//   occurred — 0 files reverted)"` and the rewind completes normally.

// CRITICAL #8 — rt CAN BE NULL. getRuntime is called in a try ABOVE the main try that leaves `rt = null` on
//   throw (the rewindRefusedTurnIndex setup). So access via `rt?.store` / `rt?.snapshots?.get(key)`. When rt is
//   null OR store is undefined OR the checkpoint key is absent → the missing-checkpoint branch (skip, 0 reverted).

// CRITICAL #9 — do NOT add store.restore, do NOT fold RestoreResult, do NOT reword the mutation warning. Those
//   are P4.M2.T1.S2 (restore + marker fold) and P4.M2.T2.T1 (warning reword). The proceed branch in THIS item
//   is a NO-OP with a clearly-marked comment seam. Leaving restore logic here = scope collision with S2.

// CRITICAL #10 — RevertDecision / revertRefused must be LINT-USED. If you declare `let revertDecision` and never
//   read it, `noUnusedLocals` (if enabled) flags it. Resolution: do NOT introduce an unused decision variable.
//   Instead, keep the proceed branch a pure comment-seam (the consts `store`/`checkpoint`/`affectedPaths`/
//   `afterRef` declared in that nested else ARE read by the dirty guard / available for S2 — they are used).
//   For `revertRefused`, ADD it to RewindDetails and include it in the success-path return → it is "used".

// QUIRK — config.revert.allowDeleteCreatedFiles is layer-3 (delete-only). This item reads only `enabled`. S2
//   reads allowDeleteCreatedFiles when building RestoreOpts. Do not read it here (it does not affect the DECISION
//   tree — a delete request with allowDelete=false still PROCEEDS to S2, which then skips the delete bucket).

// QUIRK — the dirty guard for a CHECKPOINT uses beforeRef (checkpoints have NO afterRef — they capture once).
//   `checkpoint.afterRef ?? checkpoint.beforeRef` handles both: turn checkpoints get afterRef (post agent_end),
//   checkpoint-granularity checkpoints fall back to beforeRef. This is the spec-sanctioned degrade (@14 §6 step 3
//   "if afterRef exists" — for checkpoints it does not, so dirtyCheck compares vs beforeRef = trivially clean if
//   the human hasn't edited since the checkpoint was set; a pre-checkpoint human edit is not the guard's concern).
```

## Implementation Blueprint

### Data models and structure

No new EXPORTED types. Two small local/interface additions:
- `RevertDecision` — a module-local discriminated union describing the 6b outcome (used to keep the block
  readable; S2 will consume the proceed variant). Declared module-local (not exported) to avoid widening the
  public surface before S2 lands. See "Pattern" below.
- `RewindDetails` (existing exported interface) — ADD `revertRefused?: boolean` (true only on the refuse branch;
  surfaces in logs/audit + gives P4.M2.T2.T1 a clean signal for the warning reword).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: CONFIRM PREREQUISITES (read rewind.ts + verify P4.M1.T1.S1 landed + verify rt.store/snapshots exist)
  - READ src/tools/rewind.ts: CONFIRM RewindParams has revert_file_changes? + delete_created_files? (P4.M1.T1.S1
    is parallel — ASSUME it landed; if the fields are NOT yet present, this item's `params.revert_file_changes`
    reads will be type errors. If the parallel item has NOT merged, add a `// @ts-expect-error`-free workaround
    by reading via `(params as { revert_file_changes?: boolean })` — but prefer to confirm the merge first.)
    Locate: step 7 (appendRewindMarker + leaveNote), step 7b (the checkpoint-consumption `if (granularity ===
    "checkpoint")` block), step 8 (`const hasWarning = ...`), successText() definition, the success return.
  - READ src/runtime.ts: CONFIRM `store?: SnapshotStore` + `snapshots?: Map<string, RevertCheckpoint>` exist
    (P1.M2.T2.S2 + the store field — both Complete). Confirm `rt` is fetched above the main try as
    `let rt: SessionRuntime | null = null;` (so `rt?.` is required).
  - READ src/snapshot/store.ts: CONFIRM `dirtyCheck(afterRef: string, paths: string[]): Promise<string[]>`.
  - WHY: this item edits ONE function in ONE file. Confirming the exact current shape avoids guess-work.

Task 1: EDIT src/tools/rewind.ts — ADD a module-local RevertDecision type + the revertClause plumbing
  - ADD (near the MUTATION_WARNING const, module-local):
      /**
       * RevertDecision — the outcome of step 6b's working-tree-revert decision tree (spec/05 §1 step 6b;
       * @14 §6/§7). S1 (this item) computes the decision; S2 (P4.M2.T1.S2) consumes the "proceed" variant to
       * call store.restore + fold the RestoreResult. Module-local (not exported) — widened to an exported type
       * only when S2 lands. The "refuse"/"skip" variants are terminal in S1 (a notice is appended; no restore).
       */
      type RevertDecision =
        | { decision: "proceed"; checkpoint: RevertCheckpoint; affectedPaths: string[]; afterRef: string;
            revertFileChanges: boolean; deleteCreatedFiles: boolean }
        | { decision: "refuse"; driftedPaths: string[] }
        | { decision: "skip" };
    NOTE: this requires `import type { RevertCheckpoint } from "../markers.js";` IF not already imported. Check
    the existing import block — rewind.ts imports from "../markers.js" (appendRewindMarker etc.); ADD the
    type-only RevertCheckpoint import there. If `noUnusedLocals` is enabled and Task 2 does not read the
    decision, the type itself is fine (types are erased) — but the `let revertDecision` VARIABLE must be used
    or omitted. SEE CRITICAL #10: omit the variable in the proceed branch (comment-seam) to stay lint-clean.
  - WHY: a named discriminated union keeps the branch logic self-documenting and gives S2 a typed contract.

Task 2: EDIT src/tools/rewind.ts — EXTEND successText() to thread a revert clause
  - LOCATE: `function successText(granularity: Granularity, k: number, hasWarning: boolean): { text: string }`.
  - EDIT: add a 4th param `revertClause = ""` (default empty ⇒ existing callers unaffected) and append it
    AFTER "Note left." and BEFORE the mutation warning:
        function successText(granularity: Granularity, k: number, hasWarning: boolean, revertClause = ""): { text: string } {
          const kClause = k === 0 ? "0 messages will be hidden from your view starting next turn (nothing matched to hide)" : `${k} messages will be hidden from your view starting next turn`;
          let text = `Mulligan: rewound ${granularity}. ${kClause}. Note left.`;
          if (revertClause) text += " " + revertClause;   // [P4.M2.T1.S1] v1.2 revert notice (terminal branches)
          if (hasWarning) text += " " + MUTATION_WARNING; // spec/08 E5 VERBATIM
          return { text };
        }
  - WHY: the terminal-branch notices must appear in the success text. Default "" keeps the no-flags path
    byte-identical. The clause precedes the mutation warning (revert result is more rewind-coupled than the
    side-effect caveat); P4.M2.T2.T1 will reword the warning separately.

Task 3: EDIT src/tools/rewind.ts — ADD step 6b (the decision tree) in rewindExecute
  - INSERT: between step 7b (checkpoint consumption `if (granularity === "checkpoint") {...}`) and step 8
    (`const hasWarning = ...`). Declare the accumulators OUTSIDE the block so step 9 can read them:
        // (6b) working-tree revert decision tree — v1.2, opt-in (spec/05 §1 step 6b; @14 §6/§7). AFTER marker
        //      persist (7) + checkpoint consumption (7b), BEFORE the mutation warning (8). S1 (this item) does
        //      the DECISION: gate → resolve checkpoint → dirty guard → notice/proceed. The actual store.restore
        //      + folding the RestoreResult into the marker/success-text is P4.M2.T1.S2 (the proceed seam below).
        //      Best-effort: a 6b failure degrades to a skip notice; the rewind ALWAYS completes (E13/E27/E30).
        let revertClause = "";
        let revertRefused = false;
        const wantRevert = !!(params.revert_file_changes) || !!(params.delete_created_files);
        if (wantRevert) {
          try {
            if (!config.revert.enabled) {
              revertClause = "(file revert requested but disabled in config)";
            } else if (granularity === "last_tool_call_group") {
              revertClause = "File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn.";
            } else {
              const store = rt?.store;
              const key = granularity === "checkpoint" ? `ckpt:${params.checkpoint}` : "turn";
              const checkpoint = rt?.snapshots?.get(key);
              if (!store || !checkpoint) {
                revertClause = "(file revert skipped: no working-tree snapshot for this boundary — 0 files reverted)";
              } else {
                const affectedPaths = ledger.modifiedFiles; // CRITICAL #3: only deterministic source; @14 §6 step 2
                const afterRef = checkpoint.afterRef ?? checkpoint.beforeRef; // checkpoints have no afterRef
                const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths); // CRITICAL #4: async; git.ts:430 ⇒ [] if empty
                if (driftedPaths.length > 0) {
                  // CRITICAL #5: REFUSE THE WHOLE file-revert (@14 §6 step 3). Context rewind still proceeds.
                  revertRefused = true;
                  revertClause = `(file revert refused: ${driftedPaths.length} path(s) changed since the turn ended — not overwritten; re-request if intended)`;
                } else {
                  // PROCEED — dirty guard clean. [P4.M2.T1.S2] does the actual restore here:
                  //   const result = await store.restore(checkpoint.beforeRef, { revertFileChanges: !!params.revert_file_changes, deleteCreatedFiles: !!params.delete_created_files });
                  //   + fold result into revertClause ("Reverted <X> file(s), deleted <Y>; <Z> skipped/failed, <W> refused (see log).") + the marker's revert field.
                  // S1 only RESOLVES + DIRTY-CHECKS; restore + folding is S2. (No revert clause yet — S2 sets it.)
                  // `checkpoint` / `affectedPaths` / `afterRef` / `store` are in scope here for S2's insertion.
                }
              }
            }
          } catch {
            // E13 best-effort: a 6b failure (e.g. dirtyCheck threw) never blocks the rewind.
            if (!revertClause) revertClause = "(file revert skipped: an error occurred — 0 files reverted)";
          }
        }
  - WHY: the deliverable — the full decision tree with exact notices + the dirty guard + the S2 seam.
  - GOTCHA: the block is INSIDE the main try{} (E13's catch covers it) but has its OWN inner try/catch so a
    dirtyCheck throw degrades to a skip notice (not the outer "unexpected error" refusal). `store`,
    `checkpoint`, `affectedPaths`, `afterRef` are `const` in the nested else — in scope for S2's insertion.

Task 4: EDIT src/tools/rewind.ts — wire revertClause + revertRefused into step 8/9 + RewindDetails
  - EDIT RewindDetails (interface ~line 140): ADD `/** True iff step 6b's dirty guard REFUSED the file-revert
    (drift detected post-turn — @14 §6 step 3, E30). Consumed by P4.M2.T2.T1 (warning reword) + surfaced in
    logs/audit. */ revertRefused?: boolean;`
  - EDIT step 8 (the hasWarning computation): leave hasWarning UNCHANGED for now (P4.M2.T2.T1 owns the reword).
    Optionally add a brief comment: `// [P4.M2.T2.T1] when revertRefused or files were reverted, reword the E5
    // warning to name only non-working-tree effects — out of scope here.`
  - EDIT step 9 (the return): pass `revertClause` to successText + include `revertRefused` in details:
        const { text } = successText(granularity, k, hasWarning, revertClause);
        return {
          content: [{ type: "text", text }],
          details: { granularity, k, ledger, hideEntryIds, markerId, revertRefused },  // CRITICAL #10: used
        };
  - WHY: threads the notices into the output + makes revertRefused lint-used (it is read into details).
  - GOTCHA: `k`, `ledger`, `hideEntryIds`, `markerId` are the existing success-path details fields — preserve
    them; only ADD `revertRefused`. On refusal paths (which return via refuse()/refusal()) revertRefused is
    omitted (undefined) — correct (a REFUSED REWIND is a different refusal than a refused file-revert).

Task 5: EDIT test/tools/rewind.test.ts — add the "step 6b decision tree (P4.M2.T1.S1)" describe block
  - ADD a new describe block (after the existing registration/refusal/success blocks). Reuse makePi/makeCtx/
    run/firstText/VALID_NOTE. Add a local helper to seed a fake store + checkpoint (see "Test seeding recipe").
  - TESTS (one per branch + the E13 fail-open + the no-flags regression):
    (a) NO FLAGS REGRESSION: run with {note:VALID_NOTE, granularity:"last_turn"} + DEFAULT_CONFIG (revert off)
        → firstText does NOT contain "file revert" (byte-identical v1.1 path; the wantRevert guard skipped 6b).
    (b) DISABLED: setConfig({revert:{enabled:false}}) + run with revert_file_changes:true, last_turn → firstText
        contains "(file revert requested but disabled in config)".
    (c) GROUP GRANULARITY: setConfig({revert:{enabled:true}}) + revert_file_changes:true, last_tool_call_group
        → firstText contains "File revert applies to last_turn/checkpoint granularity".
    (d) MISSING SNAPSHOT: setConfig({revert:{enabled:true}}) + revert_file_changes:true, last_turn + NO rt
        snapshot seeded (store undefined or snapshots empty) → firstText contains "file revert skipped: no
        working-tree snapshot" AND the rewind still succeeds (no refusal prefix).
    (e) DIRTY GUARD REFUSE: seed rt.store=fakeStore (dirtyCheck returns ["src/a.ts","src/b.ts"]) + rt.snapshots
        "turn" entry; setConfig revert on; run revert_file_changes:true, last_turn → firstText contains
        "(file revert refused: 2 path(s) changed since the turn ended" AND res.details.revertRefused === true.
    (f) PROCEED (clean guard, no restore yet): seed rt.store=fakeStore (dirtyCheck returns []) + rt.snapshots
        "turn" entry; setConfig revert on; run revert_file_changes:true, last_turn → rewind SUCCEEDS, firstText
        does NOT contain "file revert" (no clause yet — S2 adds "Reverted X file(s)"), does NOT contain "refused".
        (This guards against S1 accidentally calling store.restore — the fake's restore spy must NOT be called.)
    (g) CHECKPOINT KEY: same as (e) but granularity:"checkpoint", checkpoint:"mid" + seed rt.snapshots
        "ckpt:mid" (NOT "checkpoint:mid") + dirtyCheck returns [] → proceeds (proves the "ckpt:" key resolves).
        Assert the missing-key variant too: seed "checkpoint:mid" (wrong key) → hits the missing-snapshot branch.
    (h) E13 FAIL-OPEN: seed rt.store=fakeStore whose dirtyCheck THROWS → run revert_file_changes:true, last_turn
        → firstText contains "file revert skipped: an error occurred" AND the rewind still succeeds (no "refused"
        prefix, no throw escapes). Proves the inner try/catch degrades a dirtyCheck failure to a skip.
  - FOLLOW pattern: the file's hand-rolled fakes (NO vi.fn() — use a closure `let drifted:string[] = []; let
    throwOnCheck = false;` and a fakeStore object literal cast `as unknown as SnapshotStore`). See recipe below.
  - GOTCHA: each test MUST setConfig({revert:{enabled:true}}) (the beforeEach resets to DEFAULT_CONFIG =
    revert off). Seed rt via getRuntime(makeCtx's sid). The success-path tests need a contextEntries snapshot
    so the rewind reaches 6b (mirror an existing last_turn success test's makeCtx setup — a user message + a
    tool-call group so resolveLastTurn returns a non-empty remove set; K may be 0, that is fine — 6b runs
    regardless of K as long as the rewind is not refused earlier).
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the module-local RevertDecision type (Task 1). Module-local so it does not widen the public
// surface before S2; S2 will likely export it. The proceed variant carries exactly what S2 needs.
import type { RevertCheckpoint } from "../markers.js"; // ADD to the existing markers.js import block (type-only)
type RevertDecision =
  | { decision: "proceed"; checkpoint: RevertCheckpoint; affectedPaths: string[]; afterRef: string;
      revertFileChanges: boolean; deleteCreatedFiles: boolean }
  | { decision: "refuse"; driftedPaths: string[] }
  | { decision: "skip" };
// NOTE: in S1 the proceed branch does NOT assign a RevertDecision variable (it is a comment-seam) — see CRITICAL
// #10. The type is declared for readability + the S2 contract; if noUnusedLocals flags the unused TYPE, it will
// NOT (TS erases unused types; noUnusedLocals targets VALUES, not type declarations). Safe.

// PATTERN — the step 6b block (Task 3). Lives inside the main try{}; own inner try/catch for fail-open.
let revertClause = "";
let revertRefused = false;
const wantRevert = !!(params.revert_file_changes) || !!(params.delete_created_files);
if (wantRevert) {
  try {
    if (!config.revert.enabled) {
      revertClause = "(file revert requested but disabled in config)";
    } else if (granularity === "last_tool_call_group") {
      revertClause = "File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn.";
    } else {
      const store = rt?.store;
      const key = granularity === "checkpoint" ? `ckpt:${params.checkpoint}` : "turn";
      const checkpoint = rt?.snapshots?.get(key);
      if (!store || !checkpoint) {
        revertClause = "(file revert skipped: no working-tree snapshot for this boundary — 0 files reverted)";
      } else {
        const affectedPaths = ledger.modifiedFiles;
        const afterRef = checkpoint.afterRef ?? checkpoint.beforeRef;
        const driftedPaths = await store.dirtyCheck(afterRef, affectedPaths);
        if (driftedPaths.length > 0) {
          revertRefused = true;
          revertClause = `(file revert refused: ${driftedPaths.length} path(s) changed since the turn ended — not overwritten; re-request if intended)`;
        } else {
          // [P4.M2.T1.S2] store.restore(checkpoint.beforeRef, {revertFileChanges, deleteCreatedFiles}) + fold.
        }
      }
    }
  } catch {
    if (!revertClause) revertClause = "(file revert skipped: an error occurred — 0 files reverted)";
  }
}

// PATTERN — successText extension (Task 2). Default "" keeps existing callers + the no-flags path identical.
function successText(granularity, k, hasWarning, revertClause = "") {
  // ... kClause unchanged ...
  let text = `Mulligan: rewound ${granularity}. ${kClause}. Note left.`;
  if (revertClause) text += " " + revertClause;   // 6b terminal-branch notices
  if (hasWarning) text += " " + MUTATION_WARNING; // unchanged (P4.M2.T2.T1 rewords later)
  return { text };
}

// PATTERN — Test seeding recipe (Task 5). Hand-rolled fakes (NO vi.fn()), mirroring the file's idiom.
import type { SnapshotStore, RestoreResult } from "../../src/snapshot/store.js";
function makeFakeStore(opts: { drifted?: string[]; throwOnCheck?: boolean; restoreCalled?: () => void }): SnapshotStore {
  return {
    describe: () => ({ backend: "git" }),
    capture: async () => "ref-x",
    dirtyCheck: async (_afterRef: string, _paths: string[]) => {
      if (opts.throwOnCheck) throw new Error("boom");
      return [...(opts.drifted ?? [])];
    },
    restore: async (_beforeRef: string, _o: { revertFileChanges: boolean; deleteCreatedFiles: boolean }) => {
      opts.restoreCalled?.();
      return { reverted: [], deleted: [], failed: [], skipped: [], refused: [] } as RestoreResult;
    },
    has: async () => true,
    retire: async () => {},
    gc: async () => {},
    destroy: async () => {},
  } as unknown as SnapshotStore;
}
// Then in a test:
//   setConfig({ revert: { enabled: true } });
//   const sid = <makeCtx sid>; const rt = getRuntime(sid);
//   rt.store = makeFakeStore({ drifted: ["src/a.ts", "src/b.ts"] });
//   rt.snapshots!.set("turn", { label:"turn", backend:"git", beforeRef:"rb", afterRef:"ra", turnIndex:0, ts:Date.now() });
//   const res = await run(pi, ctx, { note:VALID_NOTE, granularity:"last_turn", revert_file_changes:true }, "tc1");
//   expect(firstText(res)).toContain("(file revert refused: 2 path(s) changed");
//   expect((res.details as any).revertRefused).toBe(true);
// For the PROCEED test (f): pass drifted:[] AND a restoreCalled spy → assert it was NOT called (S1 must not restore).
```

### Integration Points

```yaml
NO DATABASE / NO ROUTES / NO NEW FILES. This item edits ONE source file + ONE test file (both .ts, ESM .js imports).
TOOL BODY (src/tools/rewind.ts):
  - INSERT step 6b between step 7b (checkpoint consumption) and step 8 (hasWarning).
  - EXTEND successText() signature (4th param revertClause="", default empty).
  - EXTEND RewindDetails with revertRefused?: boolean; include it in the success-path return.
  - ADD module-local RevertDecision type + type-only RevertCheckpoint import.
RUNTIME (read-only): rt.store + rt.snapshots consumed via the already-fetched `rt` (rt?.store, rt?.snapshots?.get).
STORE (read-only): store.dirtyCheck(afterRef, paths) — async; awaited. store.restore is NOT called (S2's job).
CONFIG (read-only): config.revert.enabled (the gate). config.revert.allowDeleteCreatedFiles is NOT read here (S2).
MARKER: NOT mutated by this item (already persisted at step 7; folding is S2 — see CRITICAL #6).
HANDOFF: P4.M2.T1.S2 consumes the proceed seam (store.restore + fold into marker.revert + success text).
         P4.M2.T2.T1 consumes details.revertRefused (mutation-warning reword).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Type-check the whole project. The new type-only RevertCheckpoint import + the RevertDecision union + the
# successText signature change + RewindDetails.revertRefused + the await on dirtyCheck must all resolve.
npx tsc --noEmit
npx tsc --noEmit 2>&1 | grep -E 'tools/rewind'   # isolate this item's file
# Expected: zero errors. If "'revert_file_changes' does not exist on type RewindArgs" → P4.M1.T1.S1 (parallel)
# has NOT merged yet; coordinate (do NOT add a workaround unless the parallel item is blocked). If
# "Property 'dirtyCheck' does not exist on type 'never'" → rt?.store narrowed to never (rt is null-typed);
# use `const store = rt?.store;` then guard `if (!store ...)`. If noUnusedLocals flags revertDecision →
# you introduced an unused variable; remove it (the proceed branch is a comment-seam, CRITICAL #10).

# LSP diagnostics on the edited file (fast, in-editor)
# (call lsp_diagnostics on src/tools/rewind.ts + test/tools/rewind.test.ts — expect no diagnostics)

# Format check
npx prettier --check src/tools/rewind.ts test/tools/rewind.test.ts
# Expected: clean (the additions follow the file's existing multi-line style).
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run ONLY the rewind suite (fast feedback while implementing).
npx vitest run test/tools/rewind.test.ts
# Expected: ALL green. Watch specifically:
#   - the existing success/refusal tests STILL pass (the successText default "" keeps them byte-identical).
#   - the new "step 6b decision tree (P4.M2.T1.S1)" block: all 7-8 tests pass (one per branch + E13 + regression).
#   - the PROCEED test (f) asserts the fake store's restore was NOT called (S1 must not restore).

# Confirm no cross-breakage in the marker/runtime/store suites (this item is read-only on those).
npx vitest run test/markers.test.ts test/runtime.test.ts test/store.test.ts test/capture.test.ts test/index.test.ts

# Full suite — confirm no regressions.
npx vitest run
# Expected: full suite green. A red suite outside rewind.test.ts means an accidental edit — revert it.
```

`test/tools/rewind.test.ts` describe/it blocks ADDED by this item:

```yaml
describe("mulligan_rewind step 6b decision tree (P4.M2.T1.S1)"):
  - it("skips 6b entirely when NEITHER revert flag is set (byte-identical v1.1 path; no 'file revert' text)")
  - it("appends '(file revert requested but disabled in config)' when flags set but config.revert.enabled=false")
  - it("appends the granularity-mismatch notice when flags set at last_tool_call_group")
  - it("appends the skip notice (0 reverted) when the checkpoint is MISSING (no rt.snapshots entry)")
  - it("appends the skip notice when rt.store is undefined (store never created)")
  - it("REFUSES the whole file-revert when dirtyCheck returns drifted paths; details.revertRefused===true")
  - it("PROCEEDS (no clause, no restore yet) when dirtyCheck returns [] — S1 must NOT call store.restore")
  - it("resolves checkpoint granularity via the 'ckpt:<name>' key (NOT 'checkpoint:<name>')")
  - it("hits the missing-snapshot branch when the checkpoint key is wrong ('checkpoint:<name>' does not resolve)")
  - it("E13 fail-open: a dirtyCheck THROW degrades to 'file revert skipped: an error occurred' (rewind succeeds)")
```

### Level 3: Integration Testing (System Validation)

```bash
# This item is UNIT-tier (test/tools/rewind.test.ts). The end-to-end capture→decision→restore flow is validated
# by the F-revert-* integration scenarios in P5.M1.T1 (Tier 2 — real temp git/non-git dirs, real backends,
# real capture hooks producing real rt.snapshots entries; specifically F-revert-dirtyguard exercises the refuse
# branch against a real git shadow repo with a real human edit, and F-revert-granularity exercises the
# last_tool_call_group mismatch). This item does NOT add those — it only makes the decision logic unit-testable
# via fakes. S2 (P4.M2.T1.S2) wires the real restore; the F-revert-* scenarios validate the whole chain.

# Smoke (optional): confirm the dirty guard refuses against a REAL git store + a real drift, end-to-end:
tmp=$(mktemp -d) && cd "$tmp" && git init -q && printf 'a\n' > f.txt && git add -A && git commit -qm init
# (build the extension: npm run build) then in a scripted session: setCheckpoint, edit f.txt, agent_end,
# rewind({revert_file_changes:true, granularity:"last_turn"}) → expect the refuse notice + revertRefused=true.
# This is the F-revert-dirtyguard scenario (P5.M1.T1) — optional sanity here, authoritative there.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# MANUAL decision-tree audit — confirm each branch's notice string + the revertRefused flag by inspection:
node --input-type=module -e "
import { RewindParams } from './dist/tools/rewind.js';
const p = RewindParams.properties;
console.log('revert_file_changes present:', 'revert_file_changes' in p);   // requires P4.M1.T1.S1 merged
console.log('delete_created_files present:', 'delete_created_files' in p);
" 2>/dev/null || echo "(skip if P4.M1.T1.S1 not merged or dist not built — Levels 1–3 are authoritative)"

# The decision tree itself is pure logic exercised by the unit tests (Level 2) — no separate runtime probe needed.
# The notices are VERBATIM from spec/05 §1 step 6b + @14 §6/§7 — diff the test assertions against the spec table
# in the "What" section above to confirm no drift (rephrase = bug).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit` passes (the RevertCheckpoint type-import resolves; RevertDecision compiles; the await
      on dirtyCheck type-checks; RewindDetails.revertRefused is read into the return).
- [ ] `npx vitest run test/tools/rewind.test.ts` passes (all green incl. the new 6b block + existing tests).
- [ ] `npx vitest run` (full suite) passes — no accidental breakage outside rewind.ts/rewind.test.ts.
- [ ] No new lint/format errors on `src/tools/rewind.ts` and `test/tools/rewind.test.ts`.

### Feature Validation

- [ ] No-flags branch: success text is byte-identical to the v1.1 path (no "file revert" substring).
- [ ] Disabled branch: notice `"(file revert requested but disabled in config)"` verbatim.
- [ ] Group-granularity branch: notice `"File revert applies to last_turn/checkpoint granularity — to also restore files, rewind the whole turn."` verbatim.
- [ ] Missing-checkpoint branch: skip notice present; rewind still succeeds (no refusal prefix).
- [ ] Refuse branch: notice contains the drifted count; `details.revertRefused === true`; NO restore called.
- [ ] Proceed branch: dirty guard clean; NO restore called in S1 (seam for S2); no revert clause yet.
- [ ] Checkpoint key resolves via `"ckpt:" + name` (NOT `"checkpoint:"`).
- [ ] E13: a dirtyCheck throw degrades to the skip notice; the rewind completes (no throw escapes).

### Code Quality Validation

- [ ] Notices copied VERBATIM from spec/05 §1 step 6b + @14 §6/§7 (no paraphrasing — they are agent-facing).
- [ ] The branch order matches the spec (config → granularity → resolve → guard → proceed).
- [ ] affectedPaths = ledger.modifiedFiles (documented design decision; CRITICAL #3).
- [ ] The 6b block has its own inner try/catch (E13 fail-open) inside the main try.
- [ ] `rt?.store` / `rt?.snapshots?.get` (null-safe — rt can be null).
- [ ] The proceed branch is a comment-seam (no unused variable; no premature restore).
- [ ] Only `src/tools/rewind.ts` + `test/tools/rewind.test.ts` are modified — nothing else.

### Documentation & Deployment

- [ ] JSDoc on step 6b cites `@spec/05 §1 step 6b` + `@14 §6/§7` (Mode A — rides with the work; item DOCS clause).
- [ ] The RevertDecision type + the S2 seam are documented (S2's contract).
- [ ] No environment variables; no README change for this item (README sync is P5.M2.T1).

---

## Anti-Patterns to Avoid

- ❌ Don't call `store.restore` or fold a `RestoreResult` into the marker — that is P4.M2.T1.S2 (the marker is
  already persisted at step 7; this item only touches success-text + details.revertRefused). (CRITICAL #6/#9.)
- ❌ Don't reword the mutation warning (step 8) — that is P4.M2.T2.T1. Leave hasWarning unchanged.
- ❌ Don't use the `"checkpoint:" + name` key — the actual key is `"ckpt:" + name` (capture.ts:104,
  commands.ts:217). A wrong key makes EVERY checkpoint-granularity test hit the missing-snapshot branch. (CRITICAL #2.)
- ❌ Don't pass `[]` for affectedPaths (git.ts:430 returns `[]` ⇒ guard trivially passes) — use
  `ledger.modifiedFiles` (CRITICAL #3). Don't invent a store.diff() call (none exists).
- ❌ Don't forget the inner try/catch around resolve+dirtyCheck — a thrown dirtyCheck must degrade to a skip
  notice, NOT bubble to the outer "unexpected error" refusal (which would mislabel a file-revert hiccup). (CRITICAL #7.)
- ❌ Don't rephrase the notice strings — they are agent-facing (the agent reads them in the result text and
  decides whether to re-request). Verbatim from the spec table. (CRITICAL: load-bearing wording.)
- ❌ Don't leave an unused `revertDecision` variable — `noUnusedLocals` flags it. Keep the proceed branch a
  comment-seam; the consts (store/checkpoint/affectedPaths/afterRef) ARE used by the guard. (CRITICAL #10.)
- ❌ Don't forget `await` on `store.dirtyCheck` — it is async; forgetting it compares a Promise (truthy) ⇒
  `.length` is undefined ⇒ never > 0 ⇒ guard NEVER refuses. (CRITICAL #4.)
- ❌ Don't read `config.revert.allowDeleteCreatedFiles` here — it is layer-3 (delete-only) and does not affect
  the DECISION tree; S2 reads it when building RestoreOpts.
- ❌ Don't touch any file other than `src/tools/rewind.ts` + `test/tools/rewind.test.ts`.

---

## Success Metrics

**Confidence Score**: 8/10. The decision tree is fully specified (exact notices, exact keys, exact
affectedPaths source, exact branch order, exact insertion point). The two residual risks: (1) the parallel
P4.M1.T1.S1 (the param schema) must have merged for `params.revert_file_changes` to type-check — mitigated by
Task 0's confirm step + a documented fallback; (2) the marker-fold tension (CRITICAL #6) is real but is S2's
explicit scope — this item sidesteps it by only touching success-text + details. The `affectedPaths =
ledger.modifiedFiles` decision (CRITICAL #3) is a documented best-effort limitation inherent to the v1.2 design
(no store diff method) — acceptable and spec-consistent.

**Consumed by**: P4.M2.T1.S2 (the proceed seam — `store.restore` + fold RestoreResult into the marker's `revert`
field + the "Reverted X file(s)…" success clause) and P4.M2.T2.T1 (`details.revertRefused` drives the
mutation-warning reword).