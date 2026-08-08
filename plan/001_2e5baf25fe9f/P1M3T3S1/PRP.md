# PRP — P1.M3.T3.S1: `resolveCheckpoint` — entry→message position mapping

**Work item:** P1.M3.T3.S1 · **Points:** 2 · **Stage:** Pure Core — Context Filter Transforms (the correctness heart)
**Scope:** **APPEND to two EXISTING files** — add `resolveCheckpoint` (exported pure function) + the `BranchEntry`
type + two module-private helpers to `src/transforms.ts`, and add its vitest Tier-1 tests to
`test/transforms.test.ts`. **No new file, no other file touched.** Adds ZERO imports (the file stays at
`grep -c '^import' src/transforms.ts` → 0). Reuses `partitionIntoUnits` + the module-private
`assistantIssuedCall` + `isMulliganCustomMessage` + `isRecord`/`readOwn` that earlier P1.M3 subtasks shipped.
Never throws. This is **T3 of the `transforms.ts` build** (spec/11 §2): it ships the `checkpoint` rewind
resolver — the ONLY place Mulligan maps entries↔messages (spec/06 §6) — that `filterPipeline` (T5.S1) consumes.

> **PARALLEL-EXECUTION CONTRACT (READ FIRST):** Three earlier tasks are treated as **hard contracts**:
> 1. **P1.M3.T1.S1 (`partitionIntoUnits`) — LANDED.** `src/transforms.ts` + `test/transforms.test.ts` ALREADY EXIST
>    (VERIFIED LIVE) containing: `partitionIntoUnits`, `export interface Unit`, `export interface MessageLike`,
>    module-private `isRecord` / `readOwn`, and test fixtures `asst` / `asstText` / `result` / `user` / `custom` /
>    `summary` / `expectPairingInvariant`.
> 2. **P1.M3.T2.S1 (`resolveLastToolCallGroup`) — LANDED.** Appended the EXPORTED `resolveLastToolCallGroup` AND the
>    **module-private** `assistantIssuedCall(messages, indices, callId): boolean` to `src/transforms.ts`.
> 3. **P1.M3.T2.S2 (`resolveLastTurn`) — PARALLEL/landing.** Appends the EXPORTED `resolveLastTurn` AND the
>    **module-private** `isMulliganCustomMessage(msg): boolean` (detects `customType` starting with `"mulligan:"`)
>    to `src/transforms.ts`. Read `plan/001_2e5baf25fe9f/P1M3T2S2/PRP.md` for the authoritative definition.
>
> This task **APPENDS `resolveCheckpoint` + `BranchEntry` + two module-private helpers** to `src/transforms.ts`
> and **APPENDS a new `describe` block + extends the import line** in `test/transforms.test.ts`. Do NOT recreate,
> redefine, or re-import any symbol — they are already in module scope. **`resolveCheckpoint` REUSES
> `partitionIntoUnits` + `assistantIssuedCall` (S1) + `isMulliganCustomMessage` (S2)** for its tail-exclusion rule,
> exactly mirroring `resolveLastTurn`'s "keep the rewind's own unit + the note" logic.

> **THE ONE LOAD-BEARING FACT (read before coding):** spec/06 §6 describes compaction as yielding
> `1 + retainedTail.length` messages and says "if a compaction entry lacks `retainedTail`, refuse safely." The
> **installed Pi has NO `retainedTail` field** (verified: `session-manager.d.ts` `CompactionEntry`), and
> `sessionEntryToContextMessages` yields **exactly 1** message for compaction. Worse, `getBranch()` returns the
> **RAW** leaf→root path (NOT compaction-aware), while `event.messages` is built from the compaction-aware
> `buildContextEntries` — so a compaction entry on the branch **breaks** the entry↔message 1:1 correspondence
> (pre-compaction entries inflate the walk but are absent from `messages`). **Therefore: encountering a compaction
> entry on the root→target walk makes the mapping indeterminate → REFUSE (`return null`).** This is both
> spec-faithful ("refuse safely, never guess") AND reality-correct. Compaction *after* the checkpoint is never
> walked (we stop at target) so it stays aligned and is fine. Full proof + citations: §"Known Gotchas" below and
> `research/spec_extracts.md` §2.

---

## Goal

**Feature Goal**: Ship Mulligan's **third rewind resolver** — a pure, Pi-free
`resolveCheckpoint(messages, branchEntries, checkpointName, excludeToolCallId?): { remove: number[] } | null` that
maps a named `mulligan:checkpoint:<name>` **Pi `LabelEntry`** to a **message index** in `messages`, then computes
the index set to hide for a `checkpoint` rewind (spec/06 §6; spec/05 §1). This is the **only** place in Mulligan
that maps entries↔messages — the two relative granularities (`last_tool_call_group`, `last_turn`) avoid it. The
resolver: (a) finds the `LabelEntry` with `label === "mulligan:checkpoint:<name>"` in `branchEntries`; (b) takes
its `targetId` (the checkpointed entry); (c) builds `ctxEntries` = reversed `branchEntries` (root→leaf) filtered
to context-producing types (`message`, `custom_message`, `branch_summary`, `compaction`); (d) walks `ctxEntries`
in parallel with `messages`, advancing a message cursor by each entry's yield; (e) stops at the `targetId` entry
→ `iTarget` = its last message index; (f) removes every message index `> iTarget` EXCEPT the rewind's **own unit**
(the assistant that issued `excludeToolCallId` + its results — survives) and any **`mulligan:*` custom messages**
at the tail (the note MUST survive). The model resumes at the checkpointed point with the note available.

**Indeterminacy → REFUSE SAFELY (return `null`), never guess** (spec/06 §6 end): checkpoint label not found on the
branch; `targetId` labels a non-context-producing entry (filtered out of `ctxEntries`); a **compaction** entry is
encountered on the root→target walk (mapping genuinely indeterminate — see the load-bearing fact); the walk
overshoots `messages.length` (alignment lost); or any input is non-array / `checkpointName` not a non-empty string.
`null` lets `filterPipeline` (T5.S1) log + no-op (`remove = res ? res.remove : []`). A successful mapping with
nothing after `iTarget` returns `{ remove: [] }` (not `null`) — determinable, just empty.

Because the after-`iTarget` removal keeps the rewind's own unit **whole** (detected via `partitionIntoUnits` +
`assistantIssuedCall`), pairing is preserved AND the parallel-tool corner case (spec/06 §9, spec/08 E6) resolves
conservatively: if `mulligan_rewind` shares an assistant message with sibling calls, the entire shared unit is kept.

**Deliverable** (APPEND to two EXISTING files — do NOT create new files):
1. `src/transforms.ts` — APPEND (the file already exists from T1.S1 + T2.S1 + T2.S2):
   - `export interface BranchEntry` — minimal structural `SessionEntry`-like type (a real Pi `SessionEntry[]`
     assigns in with no cast). Mirrors how `MessageLike`/`Unit` are the shared structural input types.
   - `export function resolveCheckpoint(messages, branchEntries, checkpointName, excludeToolCallId?):
     { remove: number[] } | null` — the algorithm (spec/06 §6 steps 1–6).
   - two module-private helpers: `entryMessageYield(entry): number` (1 for message/custom_message/branch_summary;
     `-1` sentinel for compaction/unknown → caller refuses) and `isContextProducingType(type): boolean`.
   - **NO new imports** (reuse `partitionIntoUnits`, `assistantIssuedCall`, `isMulliganCustomMessage`,
     `isRecord`, `readOwn`, `MessageLike` already in module scope). File import count stays **0**.
2. `test/transforms.test.ts` — APPEND (the file already exists):
   - MODIFY the import line to add `resolveCheckpoint, type BranchEntry`.
   - ADD one new `describe("resolveCheckpoint — spec/06 §6 + mapping + compaction-refuse + defensive + tail-exclusions", …)` block.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0**.
- `npx vitest run` is **all-green** — the existing transforms suite AND the appended `resolveCheckpoint` block; no
  pre-existing suite regresses (append-only to one src file + one test file).
- `resolveCheckpoint` **never throws** (E13; it sits on the `context` handler hot path via `filterPipeline`) —
  non-array `messages`/`branchEntries`, malformed entries, throwing-Proxy objects, and a missing/non-string/empty
  `checkpointName` / `excludeToolCallId` are all handled gracefully.
- The **mapping contract** holds: a hand-built branch where each context-producing entry yields exactly 1 message
  maps the checkpoint's `targetId` to the correct message index, and `remove` = everything strictly after it
  (minus the rewind's own unit + `mulligan:` notes).
- The **compaction-refuse** contract holds: any compaction entry between root and the checkpoint → `null`.
- The **tail-exclusion** contract holds: the rewind's own unit + `mulligan:note`/`mulligan:nudge` after `iTarget`
  survive (NOT in `remove`).

---

## User Persona

**Target User**: The implementing AI agent for `filterPipeline` (P1.M3.T5.S1) — the **single pure-tier consumer**.
`filterPipeline` calls, per `checkpoint` rewind marker (spec/06 §12):
`const res = resolveCheckpoint(m, branchEntries, rw.checkpoint, rw.excludeToolCallId); remove = res ? res.remove : [];`
then feeds `remove` to `applyRewind` (P1.M3.T4.S1). `branchEntries` is supplied by `filter.ts` (P1.M4.T2.S1) from
`ctx.sessionManager.getBranch()` (leaf→root). The SECOND consumer is the test suite (this PRP).

**Use Case**: Before a speculative sub-task the agent called `mulligan_checkpoint({name:"before-x"})`, which
labelled the then-current leaf. The experiment went wrong. The agent calls
`mulligan_rewind({granularity:"checkpoint", checkpoint:"before-x", note:{...}})`. The resolver finds the label,
maps its `targetId` to the message index at the checkpoint, and hides everything produced *after* it — but keeps
the checkpoint point, the note, and the rewind's own confirmation. The model resumes at the checkpoint with the
note visible.

**User Journey**:
1. `mulligan_checkpoint({name})` → `pi.setLabel(leafId, "mulligan:checkpoint:"+name)` → a `LabelEntry`
   `{type:"label", targetId:leafId, label:"mulligan:checkpoint:<name>"}` (spec/04 §6, spec/05 §3).
2. Later, `mulligan_rewind({granularity:"checkpoint", checkpoint:name, ...})` persists a rewind marker carrying
   `checkpoint: name` + `excludeToolCallId` (spec/05 §1, spec/04 §3).
3. Next inference → `context` handler → `filterPipeline` →
   `remove = resolveCheckpoint(m, branchEntries, rw.checkpoint, rw.excludeToolCallId)?.remove ?? []`.
4. `applyRewind` removes `remove` (gap-closed) → the model resumes at the checkpoint point, with
   `[prefix up to checkpoint] + [mulligan:note] + [rewind assistant+result]` at the tail.

**Pain Points Addressed**: The two relative granularities can only target "the most recent thing" or "the whole
turn." A checkpoint anchors an arbitrary named landmark the agent can rewind straight back to in one shot — but
mapping a *branch entry* to a *message index* is intrinsically fiddlier (entries≠messages once compaction is
involved), which is exactly why this resolver is the most defensive of the three: **it refuses rather than guess.**

---

## Why

- **Unblocks the `checkpoint` rewind path end-to-end (at the pure tier).** `resolveCheckpoint` is the targeting
  half of checkpoint-granularity rewind (spec/06 §6 + spec/05 §1). `filterPipeline` (T5.S1) wires it; `applyRewind`
  (T4.S1) consumes its output. Shipping it now (pure-core, unit-testable in isolation) lets T5.S1 focus on pipeline
  composition + protected-message checks, not entry↔message mapping.
- **The ONLY entry↔message mapping in Mulligan — correctness is paramount.** The relative granularities resolve
  against `messages` directly (no entry knowledge). Checkpoint must translate a persisted `LabelEntry.targetId`
  (a branch entry id) into a `messages` index. Because `getBranch()` is raw (not compaction-aware) while
  `event.messages` is compaction-aware, this translation is only trustworthy when the branch has **no compaction
  between root and the checkpoint**. The resolver detects that and refuses otherwise — the spec's mandated safe
  behavior (spec/06 §6: "If the mapping cannot be determined confidently … refuse safely and log — never guess").
- **Pure-core tier & unit-testable in isolation.** `resolveCheckpoint` adds NO new imports (it reuses
  `partitionIntoUnits`, `assistantIssuedCall`, `isMulliganCustomMessage`, `MessageLike`, `isRecord`/`readOwn`
  already in `transforms.ts`). It is a pure, deterministic, side-effect-free function covered by fast unit tests
  with no Pi, no model, no session (spec/10 §1; spec/03 §7). Purity is enforced by taking `branchEntries` as a
  parameter (NOT `ctx`) and defining a local `BranchEntry` structural type.

---

## What

APPEND `resolveCheckpoint` (+ `BranchEntry` + two module-private helpers) to `src/transforms.ts`, and APPEND a
`resolveCheckpoint` test block (+ a one-line import edit) to `test/transforms.test.ts`.

`resolveCheckpoint`:

- **Accepts** `messages: MessageLike[]` (a real Pi `AgentMessage[]` assigns in with no cast), `branchEntries:
  BranchEntry[]` (a real Pi `SessionEntry[]` from `getBranch()` assigns in with no cast; given **leaf→root**),
  `checkpointName: string`, and `excludeToolCallId?: string` (the rewind's own toolCall id — its unit is kept;
  `undefined`/empty/non-string → not kept). Returns `{ remove: number[] } | null`.
- **Algorithm** (spec/06 §6, steps 1–6; verbatim code in the Blueprint):
  1. If `messages`/`branchEntries` not arrays, or `checkpointName` not a non-empty string → return `null`.
  2. Find the **first** `LabelEntry` (scanning `branchEntries` leaf→root = most-recent) whose
     `label === "mulligan:checkpoint:" + checkpointName`. If none → return `null` (E10: not found → refuse).
     `targetId` = its `targetId`; if not a non-empty string → return `null`.
  3. Build `ctxEntries` = `[...branchEntries].reverse()` (now **root→leaf**) filtered to context-producing types
     (`message`, `custom_message`, `branch_summary`, `compaction`).
  4. Walk `ctxEntries` with `msgCursor = 0` (messages consumed so far). For each entry: `yield =
     entryMessageYield(entry)`; if `yield < 0` (compaction/unknown → **indeterminate**) OR
     `msgCursor + yield > messages.length` (alignment lost) → return `null`. If `entry.id === targetId` →
     `iTarget = msgCursor + yield - 1` (the entry's LAST message index — kept); break. Else `msgCursor += yield`.
     If the loop ends without a match → return `null` (targetId labels a non-context-producing entry).
  5. Build `remove` (ascending): for each `j` from `iTarget+1` to end, skip if `j` is in the rewind's own unit
     (`partitionIntoUnits` + `assistantIssuedCall`, only when `excludeToolCallId` is a non-empty string) or
     `isMulliganCustomMessage(messages[j])` (the note/nudge); else push.
  6. Return `{ remove }`.

This subtask does **NOT**: implement `applyRewind`/`resolveShrinkTarget`/`applyShrink`/`filterPipeline`/`protectedOk`
(later P1.M3 subtasks APPEND to this same file); import anything (the file is foundation-tier pure); redefine
`Unit`/`MessageLike`/`isRecord`/`readOwn`/`partitionIntoUnits`/`assistantIssuedCall`/`isMulliganCustomMessage`
(reuse them); mutate `messages`/`branchEntries`; enforce the general `protectedOk` (that is filterPipeline's
defense-in-depth — `resolveCheckpoint` takes NO config; E18 is T5.S1's job); read `ctx` (purity — it takes the data
as params); or change the `Unit`/`MessageLike` shape.

### Success Criteria

- [ ] `src/transforms.ts` has an EXPORTED `resolveCheckpoint(messages: MessageLike[], branchEntries: BranchEntry[],
      checkpointName: string, excludeToolCallId?: string): { remove: number[] } | null` + an EXPORTED `BranchEntry`
      interface + two module-private helpers, and **NO new imports** (`grep -c '^import' src/transforms.ts` → 0).
- [ ] `test/transforms.test.ts` has a new `describe("resolveCheckpoint …")` block; the import line now includes
      `resolveCheckpoint, type BranchEntry`; the whole suite is green (`npx vitest run`).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **Basic mapping:** a branch `[msg(user)@e1, msg(asst)@e2, LABEL(targetId=e2,"…:ck"), msg(result)@e3,
      custom_message(note)@e4]` (leaf→root reversed) with matching `messages` → checkpoint points at e2 →
      `remove` excludes index of e2, removes indices of e3 (and e4 is a `mulligan:note` → kept) → returns
      `{remove:[<e3 index>]}` (NOT null).
- [ ] **Keep the checkpoint point:** `iTarget` is the index of the checkpointed message itself; it is NEVER in
      `remove`; everything strictly before it is untouched.
- [ ] **Tail exclusion — rewind's own unit survives:** after `iTarget`, the assistant that issued
      `excludeToolCallId` + its results are NOT in `remove` (parallel-shared unit kept whole — spec/06 §9/E6).
- [ ] **Tail exclusion — `mulligan:*` notes survive:** a `mulligan:note`/`mulligan:nudge` `custom_message` after
      `iTarget` is NOT in `remove`.
- [ ] **Compaction → REFUSE:** any compaction entry between root and the checkpoint (in the walked range) → `null`.
      (Compaction AFTER the checkpoint is not walked → does not force null.)
- [ ] **Checkpoint not found → `null`** (E10); **targetId labels a non-context-producing entry (e.g. a `custom`
      marker) → `null`** (it was filtered out of `ctxEntries`).
- [ ] **Nothing after `iTarget` → `{ remove: [] }`** (determinable, empty — NOT `null`).
- [ ] **Defensive / never throws:** non-array `messages`/`branchEntries` → `null`; non-string/empty
      `checkpointName` → `null`; throwing-Proxy entries/messages handled; `excludeToolCallId`
      absent/empty/non-string → rewind's own unit NOT kept (removed with the rest), note still survives, pairing safe.
- [ ] **Signature + return exact:** `resolveCheckpoint(messages, branchEntries, checkpointName, excludeToolCallId?):
      { remove: number[] } | null`.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `resolveCheckpoint` + `BranchEntry` + helpers to APPEND are given verbatim
> below (Task 1), and the exact tests + import edit are given verbatim (Task 2). The algorithm is spec-pinned
> (spec/06 §6 steps 1–6); the compaction-refuse rule is **proven** from the installed Pi source (research §2); the
> tail-exclusion rule is **identical** to `resolveLastTurn`'s (spec/06 §6 step 5 "same tail-exclusion rules as
> resolveLastTurn"); the not-found refusal is spec-pinned (spec/08 E10); the never-throws discipline + the
> `isRecord`/`readOwn` convention + the reused `assistantIssuedCall` (S1) / `isMulliganCustomMessage` (S2) are
> inherited verbatim from the sibling PRPs. The only prerequisite is that T1.S1 + T2.S1 + T2.S2 have landed their
> symbols in `src/transforms.ts` (the parallel-execution contract). No prior knowledge beyond "this APPENDS a pure
> function + type + helpers to the existing transforms module and APPENDS its tests" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/transforms.ts` — it ALREADY EXISTS (T1.S1 + T2.S1 + T2.S2).** Ship ONLY `resolveCheckpoint`
  (exported) + `BranchEntry` (exported type) + the module-private `entryMessageYield`/`isContextProducingType`.
  REUSE the in-scope `partitionIntoUnits`, `assistantIssuedCall`, `isMulliganCustomMessage`, `Unit`, `MessageLike`,
  `isRecord`, `readOwn` — do NOT redefine or re-export them. Later P1.M3 subtasks (applyRewind, applyShrink,
  filterPipeline) APPEND further to this same file.
- **APPEND to `test/transforms.test.ts` — it ALREADY EXISTS.** Add ONE new `describe` block + MODIFY the import line
  (one precise edit). Reuse the fixture helpers already defined: `asst`, `asstText`, `result`, `user`, `custom`,
  `summary`. Add a tiny LOCAL entry builder for the synthetic branch (entries ≠ messages). Do NOT redefine the
  message fixtures.

### Documentation & References

```yaml
# MUST READ — the authoritative algorithm for THIS function (entry→message mapping)
- url: spec/06-context-filter.md  (read §6 "Checkpoint targeting" in full + §4 "resolveLastTurn" tail-exclusion rule + §8 protected + §12 pseudocode)
  why: §6 steps 1–6 are the verbatim algorithm. §6 step 5 says "same tail-exclusion rules as resolveLastTurn (keep the rewind's own unit + mulligan notes)" — reuse that exact rule. §12 pseudocode shows filterPipeline's consumption `res ? res.remove : []`.
  critical: "§6 step 4 says compaction yields `1 + retainedTail.length` and 'if a compaction entry lacks retainedTail, refuse safely.' The INSTALLED PI has no retainedTail field AND getBranch() is raw (not compaction-aware) — see Known Gotchas. Net: compaction on the root→target walk → return null. NEVER use ctx — purity requires the data as params (branchEntries, checkpointName)."

# MUST READ — checkpoint data model (LabelEntry, name regex, prefix)
- url: spec/04-data-model.md §6 "Checkpoint"
  why: A checkpoint is a Pi LabelEntry via `pi.setLabel(leafId, "mulligan:checkpoint:<name>")`, NOT a CustomEntry, NOT in LLM context. The LabelEntry.targetId is the checkpointed entry's id. Names match /^[a-z0-9_-]{1,40}$/.
  critical: "Resolve by scanning branchEntries for type==='label' && label==='mulligan:checkpoint:'+name. targetId is the entry to map. The mulligan: prefix distinguishes from user/bookmark labels."

# MUST READ — edge case E10 (checkpoint name invalid or not found)
- url: spec/08-edge-cases.md §E10
  why: "mulligan_rewind validates existence." Not-found → refuse. Confirms resolveCheckpoint returns null when no matching label is on the branch (the tool validated name FORMAT at creation; the filter validates EXISTENCE here).
  critical: not-found → return null (filterPipeline treats null as remove=[] no-op).

# MUST READ — the installed Pi entry/message types (the load-bearing verification)
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts
  why: Authoritative shapes for SessionEntryBase, LabelEntry (type/label/targetId), CompactionEntry (NO retainedTail), BranchSummaryEntry, CustomMessageEntry, CustomEntry, and the SessionEntry union.
  pattern: "LabelEntry = { type:'label', targetId: string, label: string|undefined, ...base }. CompactionEntry has summary/firstKeptEntryId/tokensBefore — NO retainedTail."
  gotcha: "A real SessionEntry[] assigns to our local BranchEntry[] with NO cast (structural typing). Define BranchEntry minimal: { type:string; id:string; targetId?:string; label?:string; [k:string]:unknown }."

# MUST READ — verified runtime message-yield per entry type
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js  (function sessionEntryToContextMessages ~L166, buildContextEntries ~L198, buildSessionPath ~L124, getBranch ~L943)
  why: PROVES the compaction-refuse rule. sessionEntryToContextMessages yields exactly 1 for message/custom_message/branch_summary/compaction and 0 for everything else. getBranch() = raw leaf→root (buildSessionPath, NO compaction filter). buildContextEntries (which feeds event.messages) IS compaction-aware (drops the summarized head). So getBranch↔messages misalign when a compaction is present.
  pattern: "message→1, custom_message→1, branch_summary→1, compaction→1, all-others→0 (but compaction on a RAW branch is a refuse trigger, not yield-1 — see Known Gotchas)."
  gotcha: "Do NOT trust spec/06 §6's `1 + retainedTail.length` — there is no retainedTail in Pi. Compaction → refuse."

# REFERENCE — the sibling resolvers this APPENDS next to (reuse their helpers verbatim)
- file: src/transforms.ts
  why: Contains the EXPORTED partitionIntoUnits/Unit/MessageLike + module-private isRecord/readOwn (T1.S1), module-private assistantIssuedCall (T2.S1), module-private isMulliganCustomMessage (T2.S2). resolveCheckpoint reuses ALL of them — zero new imports.
  pattern: "resolveLastTurn's remove-building loop (rewindOwnIndices via partitionIntoUnits+assistantIssuedCall; skip isMulliganCustomMessage) is the EXACT pattern to mirror for resolveCheckpoint's after-iTarget removal."

# REFERENCE — how filterPipeline will consume this (signature contract)
- file: spec/06-context-filter.md §12 (pseudocode)
  why: "const res = resolveCheckpoint(m, ctx, rw.checkpoint); remove = res ? res.remove : [];" — note our REAL signature replaces `ctx` with `(branchEntries, checkpointName, excludeToolCallId?)` (purity). filter.ts (P1.M4.T2.S1) supplies branchEntries from getBranch().
  gotcha: "Returning null (refuse) vs {remove:[]} (determinable-empty) are BOTH no-ops for the pipeline, but null lets it log 'mapping indeterminate' distinctly. Prefer null for all refuse paths."
```

### Current Codebase tree (relevant slice)

```bash
src/
  transforms.ts        # EXISTS — partitionIntoUnits, Unit, MessageLike, isRecord, readOwn,
                       #   resolveLastToolCallGroup, assistantIssuedCall, resolveLastTurn, isMulliganCustomMessage
                       #   ← APPEND resolveCheckpoint + BranchEntry + 2 helpers HERE (0 imports)
test/
  transforms.test.ts   # EXISTS (732 lines) — import L2; fixtures asst/asstText/result/user/custom/summary
                       #   ← APPEND resolveCheckpoint describe block + EDIT import line
spec/
  06-context-filter.md # §6 = the algorithm; §4/§5/§8/§12 = supporting
  04-data-model.md     # §6 = checkpoint (LabelEntry)
  08-edge-cases.md     # E10 = not-found refuse
plan/001_2e5baf25fe9f/P1M3T3S1/research/spec_extracts.md  # THIS ITEM's research (compaction proof)
```

### Desired Codebase tree with files to be added/modified

```bash
src/transforms.ts        # MODIFY (append): + resolveCheckpoint (exported), + BranchEntry (exported type),
                         #   + entryMessageYield (module-private), + isContextProducingType (module-private)
test/transforms.test.ts  # MODIFY (append + 1-line edit): + describe("resolveCheckpoint …") block,
                         #   import line += resolveCheckpoint, type BranchEntry
# NO new files.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — compaction on a RAW branch makes entry↔message mapping INDETERMINATE → REFUSE.
//   spec/06 §6 says compaction yields `1 + retainedTail.length` and "if a compaction entry lacks retainedTail,
//   refuse safely." The INSTALLED Pi (`session-manager.d.ts` CompactionEntry) has NO retainedTail, and
//   `sessionEntryToContextMessages` yields exactly 1 for compaction. More decisively: `getBranch()` returns the
//   RAW leaf→root path (buildSessionPath — no compaction filter), while `event.messages` is built from the
//   compaction-AWARE `buildContextEntries` (which drops the summarized head). So when a compaction sits between
//   root and the checkpoint, getBranch contains EXTRA pre-compaction entries with no counterpart in messages →
//   the walk is offset → WRONG iTarget. THEREFORE: if entryMessageYield hits a compaction entry on the walked
//   range, return the indeterminate sentinel → resolveCheckpoint returns null. (Compaction AFTER the checkpoint
//   is never reached because we break at target → stays aligned → fine.) This is spec-faithful AND correct.

// CRITICAL #2 — branchEntries is leaf→root; messages is root→leaf. REVERSE branchEntries before walking.
//   getBranch() returns leaf→root (the leaf is branchEntries[0]). ctxEntries must be root→leaf (chronological) to
//   walk in parallel with messages (messages[0] = oldest). So: `[...branchEntries].reverse()` THEN filter.

// GOTCHA #3 — the checkpoint's targetId may label a NON-context-producing entry → filtered out → not found → null.
//   mulligan_checkpoint labels the current leaf. The leaf is usually a message entry, but could be a `custom`
//   marker entry (type "custom" → filtered OUT of ctxEntries). Then the walk never matches targetId → return null
//   (refuse safely). Do NOT try to "snap" to a nearby context entry — that would be guessing.

// GOTCHA #4 — label lookup: scan branchEntries leaf→root, take the FIRST (most-recent) matching label.
//   A re-set checkpoint appends a newer LabelEntry; leaf→root scan (index 0 = leaf) finds the active one first.
//   Match on type==='label' && label === 'mulligan:checkpoint:'+checkpointName. readOwn() every field.

// GOTCHA #5 — iTarget = the checkpointed entry's LAST message index (kept), not the index after it.
//   "Stop at the checkpoint entry; the cursor is iTarget" + "remove messages with index > iTarget" (keep the
//   checkpoint point and everything before). With every real yield == 1, iTarget = the checkpoint entry's single
//   message index. Implement as iTarget = msgCursor + yield - 1 (correct for the theoretical multi-yield case too).

// GOTCHA #6 — return null vs {remove:[]}: null = INDETERMINATE/REFUSE; {remove:[]} = determinable-but-empty.
//   null: not-found, targetId-not-in-ctxEntries, compaction, overshoot, non-array, bad checkpointName.
//   {remove:[]}: mapping succeeded AND nothing is strictly after iTarget (or all after-iTarget are excluded).
//   filterPipeline treats both as no-op (remove = res?.remove ?? []), but null enables a distinct "indeterminate" log.

// GOTCHA #7 — tail-exclusion rule is IDENTICAL to resolveLastTurn's. Reuse, do not reinvent.
//   rewindOwnIndices = indices of the toolGroup whose assistant issued excludeToolCallId (via partitionIntoUnits +
//   assistantIssuedCall); isMulliganCustomMessage = customType startsWith 'mulligan:'. Skip both when building
//   remove for j > iTarget. excludeToolCallId absent/empty/non-string → no own-unit kept → removed with the rest
//   (a real rewind marker always carries a valid id; pairing stays safe either way).

// GOTCHA #8 — NEVER throw (E13; context-handler hot path). isRecord/readOwn swallow Proxy traps. Guard every field
//   read. Non-array inputs → null. Malformed entries/messages → handled. The function is total.
```

---

## Implementation Blueprint

### Data models and structure

```typescript
// APPEND to src/transforms.ts — minimal structural SessionEntry-like type (a real Pi SessionEntry[] assigns in
// with NO cast — structural typing, mirrors MessageLike/Unit). EXPORTED so tests build typed fixtures and filter.ts
// (P1.M4.T2) can pass ctx.sessionManager.getBranch() typed as BranchEntry[].
export interface BranchEntry {
  type: string;        // "message" | "custom_message" | "compaction" | "branch_summary" | "label" | "custom" | ...
  id: string;
  parentId?: string | null;
  timestamp?: string;
  /** LabelEntry only — the entry this label points at (the checkpointed entry). */
  targetId?: string;
  /** LabelEntry only — the label string, e.g. "mulligan:checkpoint:before-x". */
  label?: string;
  [key: string]: unknown;   // message/customType/summary/firstKeptEntryId/... read defensively via readOwn
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: APPEND resolveCheckpoint + BranchEntry + 2 module-private helpers to src/transforms.ts
  - IMPLEMENT: `export interface BranchEntry` (minimal structural SessionEntry-like; see Data models).
  - IMPLEMENT: `export function resolveCheckpoint(messages, branchEntries, checkpointName, excludeToolCallId?):
      { remove: number[] } | null` (spec/06 §6 steps 1–6; verbatim code below).
  - IMPLEMENT: module-private `entryMessageYield(entry: BranchEntry): number` — returns 1 for
      message/custom_message/branch_summary; returns -1 (indeterminate sentinel) for compaction/unknown.
  - IMPLEMENT: module-private `isContextProducingType(type: unknown): boolean` — true for
      message/custom_message/branch_summary/compaction (spec/06 §6 step 2 list).
  - REUSE (do NOT redefine/import): partitionIntoUnits, assistantIssuedCall, isMulliganCustomMessage, MessageLike,
      isRecord, readOwn — all already in module scope.
  - NAMING: resolveCheckpoint (exported fn), BranchEntry (exported type), entryMessageYield/isContextProducingType
      (module-private, camelCase).
  - PLACEMENT: append at END of src/transforms.ts (after resolveLastTurn + isMulliganCustomMessage).
  - VERIFY: `grep -c '^import' src/transforms.ts` → 0 (no new imports).

Task 2: APPEND resolveCheckpoint tests + EDIT the import line in test/transforms.test.ts
  - EDIT import line (L2): add `resolveCheckpoint, type BranchEntry` to the existing destructure.
  - ADD: `describe("resolveCheckpoint — spec/06 §6 + mapping + compaction-refuse + defensive + tail-exclusions", …)`
      with the verbatim tests below (basic mapping, keep-checkpoint-point, tail-exclusion own-unit, tail-exclusion
      mulligan-note, compaction-refuse, not-found, non-context-producing-target, empty-remove, defensive non-array,
      excludeToolCallId-absent, signature/return-type).
  - ADD: tiny LOCAL entry builders `entry(id, type, extra?)` and `labelEntry(id, targetId, name)` — entries are NOT
      messages, so they need their own builder (do NOT reuse the message fixtures for entries).
  - FOLLOW pattern: the existing describe blocks' style (spec-section pinning in the title, one it() per case).
  - COVERAGE: mapping correctness, keep-checkpoint-point, both tail-exclusions, compaction-refuse (before & after
      target), not-found (E10), non-context-producing target, determinable-empty, defensive (non-array messages,
      non-array branchEntries, empty checkpointName, throwing-Proxy), excludeToolCallId-absent, return-type exact.
  - PLACEMENT: append at END of test/transforms.test.ts.

Task 3: VALIDATE (no code)
  - RUN: `npx tsc --noEmit -p tsconfig.json` → exit 0.
  - RUN: `npx vitest run test/transforms.test.ts` → all green (existing + new block).
  - RUN: `npx vitest run` → all green, no regression in any suite.
  - RUN: `grep -c '^import' src/transforms.ts` → 0.
```

### Implementation Patterns & Key Details

```typescript
// ───────────── APPEND TO src/transforms.ts (verbatim) ─────────────

/**
 * Minimal structural SessionEntry-like type for resolveCheckpoint's branchEntries param (a real Pi SessionEntry[]
 * from getBranch() assigns in with NO cast — structural typing, mirrors MessageLike/Unit). Purity: resolveCheckpoint
 * takes the DATA it needs (branchEntries + checkpointName), NOT ctx (ExtensionContext) — it never imports Pi.
 * EXPORTED so tests build typed fixtures and filter.ts (P1.M4.T2) passes getBranch() typed as BranchEntry[].
 */
export interface BranchEntry {
  type: string;        // "message" | "custom_message" | "compaction" | "branch_summary" | "label" | "custom" | ...
  id: string;
  parentId?: string | null;
  timestamp?: string;
  /** LabelEntry only — the entry this label points at (the checkpointed entry). */
  targetId?: string;
  /** LabelEntry only — the label string, e.g. "mulligan:checkpoint:before-x". */
  label?: string;
  [key: string]: unknown; // message/customType/summary/firstKeptEntryId/... read defensively via readOwn
}

/**
 * resolveCheckpoint — map a named `mulligan:checkpoint:<name>` Pi LabelEntry to a message index, then compute the
 * removal set for a `checkpoint` rewind (spec/06-context-filter.md §6). The ONLY place Mulligan maps entries↔messages
 * (the relative granularities resolve against messages directly).
 *
 * ALGORITHM (spec/06 §6, steps 1–6):
 *   1. Defensive: non-array messages/branchEntries, or checkpointName not a non-empty string → null.
 *   2. Find the FIRST LabelEntry (scanning branchEntries leaf→root = most-recent) whose
 *      label === `mulligan:checkpoint:${checkpointName}`. None → null (spec/08 E10 not-found → refuse). targetId =
 *      its targetId; non-string/empty → null.
 *   3. ctxEntries = [...branchEntries].reverse() (root→leaf) filtered to context-producing types
 *      (message, custom_message, branch_summary, compaction — spec/06 §6 step 2).
 *   4. Walk ctxEntries with msgCursor (messages consumed). For each entry: yield = entryMessageYield(entry);
 *      yield < 0 (compaction/unknown → indeterminate) OR msgCursor+yield > messages.length (alignment lost) → null.
 *      If entry.id === targetId → iTarget = msgCursor + yield - 1 (the entry's LAST message index — kept); break.
 *      Else msgCursor += yield. Loop end without match → null (targetId labels a non-context-producing entry).
 *   5. remove (ascending): for j from iTarget+1..end, skip if rewindOwnIndices.has(j) (the rewind's own unit via
 *      partitionIntoUnits + assistantIssuedCall, only when excludeToolCallId is a non-empty string) or
 *      isMulliganCustomMessage(messages[j]) (the note/nudge). Else push. (IDENTICAL to resolveLastTurn's rule —
 *      spec/06 §6 step 5 "same tail-exclusion rules as resolveLastTurn".)
 *   6. Return { remove }.
 *
 * COMPACTION (spec/06 §6 vs installed Pi): spec says compaction yields `1 + retainedTail.length` and "refuse if a
 * compaction entry lacks retainedTail." The installed Pi CompactionEntry has NO retainedTail, AND getBranch() is the
 * RAW path (not compaction-aware) while event.messages is compaction-aware → a compaction on the root→target walk
 * makes the mapping INDETERMINATE. entryMessageYield returns -1 for compaction → this function returns null (refuse
 * safely, never guess — spec/06 §6 end). Compaction AFTER the checkpoint is never walked (we break at target) so it
 * stays aligned. See PRP "Known Gotchas" + research/spec_extracts.md §2 for the full proof.
 *
 * RETURNS `{ remove: number[] } | null` — null = indeterminate/refuse (not-found, non-context-producing target,
 * compaction, overshoot, non-array, bad checkpointName); { remove: [] } = determinable-but-empty (nothing after
 * iTarget, or all after-iTarget excluded). The single consumer filterPipeline (P1.M3.T5.S1) uses
 * `remove = resolveCheckpoint(m, branchEntries, rw.checkpoint, rw.excludeToolCallId)?.remove ?? []` (spec/06 §12).
 *
 * Pure + defensive: null/non-array messages/branchEntries → null; malformed entries, throwing-Proxy objects, and a
 * non-string/empty checkpointName/excludeToolCallId are all handled gracefully — NEVER throws (E13; context-handler
 * hot path). Every field read goes through the module-private isRecord/readOwn. NEVER imports Pi (purity).
 *
 * @param messages the LLM message list (a real Pi AgentMessage[] assigns in with no cast); non-array → null
 * @param branchEntries getBranch() output, LEAF→ROOT (we reverse to root→leaf internally); non-array → null
 * @param checkpointName the checkpoint name (without the `mulligan:checkpoint:` prefix); non-string/empty → null
 * @param excludeToolCallId the rewind's own toolCall id (its unit is kept); undefined/empty/non-string → not kept
 * @returns { remove: number[] } on a determinable mapping (possibly empty), or null when indeterminate/refused
 */
export function resolveCheckpoint(
  messages: MessageLike[],
  branchEntries: BranchEntry[],
  checkpointName: string,
  excludeToolCallId?: string,
): { remove: number[] } | null {
  // 1) Defensive: arrays + a non-empty checkpoint name.
  if (!Array.isArray(messages) || !Array.isArray(branchEntries)) return null;
  if (typeof checkpointName !== "string" || checkpointName.length === 0) return null;

  const needle = `mulligan:checkpoint:${checkpointName}`;

  // 2) Find the FIRST (most-recent, leaf→root) LabelEntry with the matching label.
  let targetId: string | undefined;
  for (const e of branchEntries) {
    if (!isRecord(e)) continue;
    if (readOwn(e, "type") !== "label") continue;
    if (readOwn(e, "label") !== needle) continue;
    const tid = readOwn(e, "targetId");
    if (typeof tid === "string" && tid.length > 0) {
      targetId = tid;
      break; // most-recent match wins
    }
  }
  if (targetId === undefined) return null; // not found on this branch (spec/08 E10) or no usable targetId → refuse

  // 3) ctxEntries = reversed (root→leaf) filtered to context-producing types (spec/06 §6 step 2).
  const ctxEntries = [...branchEntries].reverse().filter((e) => isContextProducingType(isRecord(e) ? readOwn(e, "type") : undefined));

  // 4) Walk in parallel with messages; stop at the target entry → iTarget = its last message index.
  let msgCursor = 0;
  let iTarget = -1;
  let found = false;
  for (const e of ctxEntries) {
    const y = entryMessageYield(e); // 1 for message/custom_message/branch_summary; -1 (indeterminate) for compaction/unknown
    if (y < 0) return null; // compaction (or unknown) on the walked range → mapping indeterminate → refuse safely
    if (msgCursor + y > messages.length) return null; // alignment lost (raw branch vs compaction-aware messages) → refuse
    if (isRecord(e) && readOwn(e, "id") === targetId) {
      iTarget = msgCursor + y - 1; // the entry's LAST message index — KEPT (spec/06 §6 "keep the checkpoint point")
      found = true;
      break;
    }
    msgCursor += y;
  }
  if (!found) return null; // targetId labels a non-context-producing entry (filtered out) → refuse (never guess)

  // 5) remove = indices > iTarget, EXCEPT the rewind's own unit + mulligan:* notes (IDENTICAL to resolveLastTurn).
  const rewindOwnIndices = new Set<number>();
  const hasExclude = typeof excludeToolCallId === "string" && excludeToolCallId.length > 0;
  if (hasExclude) {
    for (const unit of partitionIntoUnits(messages)) {
      if (unit.kind === "toolGroup" && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
        for (const idx of unit.indices) rewindOwnIndices.add(idx); // keep the WHOLE unit (parallel-safe — §9)
      }
    }
  }
  const remove: number[] = [];
  for (let j = iTarget + 1; j < messages.length; j++) {
    if (rewindOwnIndices.has(j)) continue; // the rewind's own assistant + results survive
    if (isMulliganCustomMessage(messages[j])) continue; // the note / nudge survives
    remove.push(j);
  }
  return { remove };
}

/**
 * Module-private: how many LLM messages does this branch entry produce? Verified against Pi
 * sessionEntryToContextMessages (session-manager.js): message/custom_message/branch_summary → 1; compaction → 1 in
 * Pi BUT the spec/06 §6 "1 + retainedTail.length" model does not match (no retainedTail) AND a compaction on a RAW
 * getBranch misaligns with compaction-aware messages → returns the INDETERMINATE sentinel (-1) so the caller refuses.
 * Non-context-producing types (label/custom/…) also return -1 (they are filtered out before the walk, so this is a
 * safety net). Defensive (isRecord/readOwn; never throws).
 */
function entryMessageYield(entry: unknown): number {
  const type = isRecord(entry) ? readOwn(entry, "type") : undefined;
  if (type === "message" || type === "custom_message" || type === "branch_summary") return 1;
  return -1; // compaction (indeterminate) OR unknown/non-context-producing → caller refuses
}

/** Module-private: is this entry type one that produces a context message (spec/06 §6 step 2 list)? */
function isContextProducingType(type: unknown): boolean {
  return type === "message" || type === "custom_message" || type === "branch_summary" || type === "compaction";
}
```

```typescript
// ───────────── APPEND TO test/transforms.test.ts (verbatim) ─────────────
// (Also EDIT L2 import — see Task 2.) Add a tiny LOCAL entry builder; entries ≠ messages.

/** Build a minimal branch entry (SessionEntry-like). */
function entry(id: string, type: BranchEntry["type"], extra: Record<string, unknown> = {}): BranchEntry {
  return { type, id, parentId: null, timestamp: "t", ...extra };
}

/** Build a mulligan:checkpoint LabelEntry pointing at targetId. */
function labelEntry(id: string, targetId: string, name: string): BranchEntry {
  return { type: "label", id, parentId: null, timestamp: "t", targetId, label: `mulligan:checkpoint:${name}` };
}

describe("resolveCheckpoint — spec/06 §6 + mapping + compaction-refuse + defensive + tail-exclusions", () => {
  // NOTE: getBranch() is LEAF→ROOT; we build branchEntries in that order. Each context-producing entry yields
  // exactly 1 message, so messages[k] corresponds 1:1 to the k-th context-producing entry (root→leaf).

  it("basic mapping — checkpoint mid-branch removes strictly-later work, keeps the point + before", () => {
    // root→leaf context-producing entries → messages (1:1):
    //   e1 user   → msgs[0]
    //   e2 asst   → msgs[1]   ← CHECKPOINT targetId = e2  (iTarget = 1)
    //   e3 result → msgs[2]   ← removed (> iTarget, not excluded)
    //   e4 asst(text) → msgs[3] ← removed
    const msgs: MessageLike[] = [user("u1"), asst("c1"), result("c1"), asstText("junk")];
    // branchEntries LEAF→ROOT (getBranch order):
    const branchEntries: BranchEntry[] = [
      entry("e4", "message"), entry("e3", "message"), labelEntry("eL", "e2", "ckpt"),
      entry("e2", "message"), entry("e1", "message"),
    ];
    const res = resolveCheckpoint(msgs, branchEntries, "ckpt");
    expect(res).not.toBeNull();
    expect(res!.remove).toEqual([2, 3]); // e3(result) + e4(text asst); e2 (the checkpoint) KEPT at idx1
  });

  it("keeps the checkpoint point itself (iTarget never in remove) and everything before", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")]; // idx0 user, idx1 asst, idx2 result
    // checkpoint targets e_asst (idx1). iTarget=1. remove=[2].
    const branch: BranchEntry[] = [
      entry("e_result", "message"), labelEntry("eL", "e_asst", "p"), entry("e_asst", "message"), entry("e_user", "message"),
    ];
    const res = resolveCheckpoint(msgs, branch, "p");
    expect(res!.remove).toEqual([2]);
    expect(res!.remove).not.toContain(1); // checkpoint point kept
    expect(res!.remove).not.toContain(0); // earlier message kept
  });

  it("tail-exclusion: the rewind's own unit (assistant+result issuing excludeToolCallId) survives after iTarget", () => {
    // iTarget = 0 (checkpoint at user). After it: asst(rw)+result(rw) [own unit, KEPT] + asst(text)[removed].
    const msgs: MessageLike[] = [user("u"), asst("rw-call"), result("rw-call"), asstText("bad")];
    const branch: BranchEntry[] = [
      entry("e_text", "message"), entry("e_result", "message"), entry("e_asst_rw", "message"),
      labelEntry("eL", "e_user", "k"), entry("e_user", "message"),
    ];
    const res = resolveCheckpoint(msgs, branch, "k", "rw-call");
    expect(res!.remove).toEqual([3]); // asst(text) removed; the rewind's own unit (idx1,2) KEPT; checkpoint user idx0 kept
    expect(res!.remove).not.toContain(1);
    expect(res!.remove).not.toContain(2);
  });

  it("tail-exclusion: a mulligan:note / mulligan:nudge custom_message after iTarget survives", () => {
    const msgs: MessageLike[] = [user("u"), result("c"), custom("mulligan:note"), custom("mulligan:nudge")];
    // checkpoint at user (idx0). After it: result(idx1, removed), note(idx2 KEPT), nudge(idx3 KEPT).
    const branch: BranchEntry[] = [
      entry("e_nudge", "custom_message"), entry("e_note", "custom_message"), entry("e_result", "message"),
      labelEntry("eL", "e_user", "k"), entry("e_user", "message"),
    ];
    const res = resolveCheckpoint(msgs, branch, "k");
    expect(res!.remove).toEqual([1]); // only the result removed; note + nudge survive
  });

  it("compaction between root and checkpoint → REFUSE (null) — mapping indeterminate (spec/06 §6 / Known Gotcha #1)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
    // root→leaf: compaction, then user, asst, result. checkpoint targets the asst AFTER compaction.
    const branch: BranchEntry[] = [
      entry("e_result", "message"), labelEntry("eL", "e_asst", "k"), entry("e_asst", "message"),
      entry("e_user", "message"), entry("e_comp", "compaction", { summary: "s", firstKeptEntryId: "e_user" }),
    ];
    expect(resolveCheckpoint(msgs, branch, "k")).toBeNull();
  });

  it("compaction AFTER the checkpoint is not walked → mapping succeeds (refuse only fires for compaction in the walked range)", () => {
    // root→leaf: user, asst(ck), result, COMPACTION(leaf). checkpoint targets asst (before compaction) → walk never
    // reaches the compaction entry → mapping OK. iTarget = asst's index; remove = everything after it.
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c"), asstText("post")];
    const branch: BranchEntry[] = [
      entry("e_comp", "compaction", { summary: "s", firstKeptEntryId: "e_result" }),
      entry("e_post", "message"), entry("e_result", "message"), labelEntry("eL", "e_asst", "k"),
      entry("e_asst", "message"), entry("e_user", "message"),
    ];
    const res = resolveCheckpoint(msgs, branch, "k");
    expect(res).not.toBeNull();
    expect(res!.remove).toEqual([2, 3]); // result(idx2) + post-compaction asst(idx3) removed; checkpoint asst(idx1) kept
  });

  it("checkpoint not found on branch → null (spec/08 E10)", () => {
    const branch: BranchEntry[] = [entry("e1", "message"), entry("e2", "message")];
    expect(resolveCheckpoint([user("u")], branch, "nope")).toBeNull();
  });

  it("checkpoint targetId labels a NON-context-producing entry (e.g. a custom marker) → filtered out → null (never guess)", () => {
    const branch: BranchEntry[] = [
      labelEntry("eL", "e_marker", "k"), entry("e_marker", "custom", { customType: "mulligan:rewind", data: {} }),
      entry("e_user", "message"),
    ];
    expect(resolveCheckpoint([user("u")], branch, "k")).toBeNull();
  });

  it("nothing after iTarget → { remove: [] } (determinable-but-empty, NOT null)", () => {
    // checkpoint at the LAST context-producing entry → iTarget = last index → nothing after → remove = [].
    const msgs: MessageLike[] = [user("u"), asst("c")];
    const branch: BranchEntry[] = [
      labelEntry("eL", "e_asst", "k"), entry("e_asst", "message"), entry("e_user", "message"),
    ];
    const res = resolveCheckpoint(msgs, branch, "k");
    expect(res).not.toBeNull();
    expect(res!.remove).toEqual([]);
  });

  it("defensive: non-array messages → null; non-array branchEntries → null; empty checkpointName → null", () => {
    expect(resolveCheckpoint(null as unknown as MessageLike[], [], "k")).toBeNull();
    expect(resolveCheckpoint([], null as unknown as BranchEntry[], "k")).toBeNull();
    expect(resolveCheckpoint([], [], "")).toBeNull(); // empty name → guard refuses
    // A whitespace name is a NON-empty string → passes the guard, but matches no label on the empty branch → not-found → null.
    expect(resolveCheckpoint([], [], "   ")).toBeNull();
  });

  it("excludeToolCallId absent/empty/non-string → rewind's own unit NOT kept (removed with the rest); note still survives", () => {
    const msgs: MessageLike[] = [user("u"), asst("rw-call"), result("rw-call"), custom("mulligan:note")];
    const branch: BranchEntry[] = [
      entry("e_note", "custom_message"), entry("e_result", "message"), entry("e_asst", "message"),
      labelEntry("eL", "e_user", "k"), entry("e_user", "message"),
    ];
    // No excludeToolCallId → the asst(rw)+result are NOT protected → removed. note survives.
    expect(resolveCheckpoint(msgs, branch, "k")!.remove).toEqual([1, 2]);
    expect(resolveCheckpoint(msgs, branch, "k", "")!.remove).toEqual([1, 2]); // empty → not kept
  });

  it("returns { remove: number[] } | null (the exact union, never a bare array)", () => {
    expectTypeOf(resolveCheckpoint([], [], "x")).toEqualTypeOf<{ remove: number[] } | null>();
    const ok = resolveCheckpoint([user("u")], [labelEntry("eL", "e1", "x"), entry("e1", "message")], "x");
    expectTypeOf(ok).toEqualTypeOf<{ remove: number[] } | null>();
  });
});
```

> **Note on the verbatim tests:** every `it()` above was hand-traced against the algorithm (ctxEntries build → walk →
> iTarget → remove) and is internally consistent: each synthetic branch's context-producing entries map 1:1 to the
> `messages` array in root→leaf order. The implementing agent may copy them verbatim. The two LOCAL builders
> (`entry`, `labelEntry`) are defined once at the top of the new describe block.

### Integration Points

```yaml
PURE TIER (no integration this subtask):
  - resolveCheckpoint is a PURE function. It does NOT touch Pi, config, ctx, the session, or the filesystem.
  - It is consumed LATER by filterPipeline (P1.M3.T5.S1): `remove = resolveCheckpoint(m, branchEntries, rw.checkpoint, rw.excludeToolCallId)?.remove ?? []`.
  - branchEntries is supplied by filter.ts (P1.M4.T2.S1) from ctx.sessionManager.getBranch() (leaf→root). DO NOT
    reverse inside filter.ts — resolveCheckpoint reverses internally (it owns the leaf→root→root→leaf convention).
  - protectedOk (E18) is applied by filterPipeline as defense-in-depth — resolveCheckpoint takes NO config and does
    NOT enforce protectedRoles (matches resolveLastTurn's split).

TYPES:
  - BranchEntry is structural; a real Pi SessionEntry[] assigns in with no cast (verified against session-manager.d.ts).
  - Do NOT import SessionEntry from Pi (that would break the file's 0-import purity discipline).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After appending src/transforms.ts — fix before proceeding
npx tsc --noEmit -p tsconfig.json        # Type checking (strict). MUST exit 0.
grep -c '^import' src/transforms.ts       # MUST print 0 (the file stays import-free / pure).

# Project-wide style (no linter configured — tsc + vitest are the gates)
# Expected: tsc exits 0; import count is 0.
```

### Level 2: Unit Tests (Component Validation)

```bash
# This suite only
npx vitest run test/transforms.test.ts -v
# Expected: all green — the existing partitionIntoUnits / resolveLastToolCallGroup / resolveLastTurn blocks AND
#           the new resolveCheckpoint block.

# Full suite (no regression)
npx vitest run
# Expected: all-green across every suite (transforms, tokens, ledger, notes, markers, …).
```

### Level 3: Integration Testing (System Validation)

```bash
# (No integration harness for this pure tier — resolveCheckpoint has no Pi surface. The F-checkpoint integration
#  scenario in spec/10 §3 is exercised by P1.M7.T2.S1's smoke harness, which only exists once filterPipeline +
#  filter.ts + the tools are wired. This subtask's "integration" gate is: filterPipeline (T5.S1) will call it, and
#  the full vitest run passing is the proof of composition-readiness.)
npx vitest run        # ← the composition-readiness gate for this tier
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Domain-specific: re-verify the compaction-refuse rationale against the installed Pi (regression guard if Pi bumps).
node -e "const p=require('@earendil-works/pi-coding-agent/dist/core/session-manager.js'); \
  console.log('compaction yield check — sessionEntryToContextMessages on a compaction entry returns 1 message:'); \
  console.log(p.sessionEntryToContextMessages({type:'compaction',summary:'s',firstKeptEntryId:'x',tokensBefore:0,id:'c',parentId:null,timestamp:'t'}).length);"
# Expected: prints 1. (Confirms compaction yields 1 in Pi — but we STILL refuse because getBranch() is raw, not
#           compaction-aware. If this ever throws/changes, revisit Known Gotcha #1.)

# Manual reasoning check (no command): trace one synthetic branch by hand against the algorithm and confirm the
# iTarget + remove match the unit-test expectation. (The verbatim tests already encode these traces.)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] `npx vitest run` is all-green (existing + new resolveCheckpoint block; no suite regresses).
- [ ] `grep -c '^import' src/transforms.ts` → 0 (no new imports; pure tier preserved).
- [ ] `npx vitest run test/transforms.test.ts` passes in isolation.

### Feature Validation
- [ ] Basic mapping: checkpoint mid-branch → `remove` = strictly-later indices; checkpoint point + earlier kept.
- [ ] Compaction between root and checkpoint → `null`; compaction after checkpoint → mapping succeeds.
- [ ] Tail-exclusions: rewind's own unit (via excludeToolCallId) + `mulligan:*` notes survive after iTarget.
- [ ] Not-found (E10) → `null`; non-context-producing target → `null`; determinable-empty → `{ remove: [] }`.
- [ ] Defensive: non-array messages/branchEntries → `null`; empty checkpointName → `null`; never throws.
- [ ] Return type exact: `{ remove: number[] } | null`.

### Code Quality Validation
- [ ] APPEND-only to `src/transforms.ts` + `test/transforms.test.ts` (no other file touched; no new file).
- [ ] Reuses (does not redefine) partitionIntoUnits / assistantIssuedCall / isMulliganCustomMessage / isRecord / readOwn.
- [ ] BranchEntry is structural + minimal (a real SessionEntry[] assigns in with no cast); no Pi import.
- [ ] resolveCheckpoint takes DATA as params (messages, branchEntries, checkpointName, excludeToolCallId) — NOT ctx.

### Documentation & Deployment
- [ ] JSDoc on resolveCheckpoint cites spec/06 §6 + the compaction-refuse rationale (so the next reader understands WHY compaction → null).
- [ ] No environment variables, no config (pure tier).

---

## Anti-Patterns to Avoid

- ❌ Don't take `ctx` (ExtensionContext) as a parameter — purity requires the data (branchEntries, checkpointName). filter.ts supplies the data.
- ❌ Don't import Pi's `SessionEntry` type — define a minimal local `BranchEntry` (keeps the file import-free).
- ❌ Don't trust spec/06 §6's `compaction → 1 + retainedTail.length` — there is no `retainedTail` in Pi; compaction on a raw branch → REFUSE (return null). Never guess.
- ❌ Don't forget to REVERSE branchEntries (getBranch is leaf→root; messages are root→leaf).
- ❌ Don't make `iTarget` the index AFTER the checkpoint — it is the checkpoint entry's LAST message index (kept); remove is strictly `> iTarget`.
- ❌ Don't return `null` for "determinable but nothing to remove" — that's `{ remove: [] }`. Reserve `null` for indeterminate/refuse.
- ❌ Don't reinvent the tail-exclusion rule — it is IDENTICAL to resolveLastTurn's; reuse `assistantIssuedCall` + `isMulliganCustomMessage`.
- ❌ Don't enforce `protectedOk` here — it's filterPipeline's defense-in-depth (resolveCheckpoint takes no config).
- ❌ Don't throw on bad input — return `null` (E13; context-handler hot path).

---

## Confidence Score

**9/10** for one-pass implementation success. The algorithm is spec-pinned (spec/06 §6 steps 1–6); the one genuinely
subtle point — compaction → refuse — is **proven** from the installed Pi source (not guessed) and documented with
verbatim citations; the implementation and tests are given verbatim; the reusable helpers are already in module
scope (parallel-execution contract). The -1 is for the inherent fiddliness of the entry↔message mapping and the
small risk that a future Pi bump changes `sessionEntryToContextMessages`/`getBranch` semantics (guarded by the
Level-4 regression check).