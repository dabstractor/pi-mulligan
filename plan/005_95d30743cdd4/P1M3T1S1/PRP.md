# PRP — P1.M3.T1.S1: Checkpoint consumption hook in `rewind.ts`

## Goal

**Feature Goal**: Implement checkpoint **auto-expiry on consumption** (spec/05 §3 step 5): once a
`mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` **successfully targets** a checkpoint,
that checkpoint is **consumed** and its `LabelEntry` label is **cleared** (`pi.setLabel(targetId, undefined)`),
so it (a) no longer appears active in `mulligan_audit`, (b) a second rewind to the same name refuses
`not found`, and (c) re-creating it later (`mulligan_checkpoint`) sets a fresh label and works.

**Deliverable**: A single new code block — **"step 7b"** — inserted into `rewindExecute` in
**`src/tools/rewind.ts` ONLY**, immediately after the successful persist (step 7: `appendRewindMarker` +
`leaveNote`) and before the step 8 mutation warning, **guarded by `if (granularity === "checkpoint")`**,
wrapped in its **own try/catch that swallows** (E13). Plus a **Mode A inline comment** citing spec/05 §3
step 5. No tests (sibling P1.M3.T1.S2 owns those). No other file.

**Success Definition**: After the edit, a checkpoint-granularity rewind that succeeds calls
`pi.setLabel(<targetId>, undefined)` exactly once for the consumed checkpoint's label (captured in the
test `makePi().labels` array); a `last_tool_call_group`/`last_turn` rewind does NOT call `setLabel`;
`npm run typecheck` exits 0; the full `npx vitest run` suite stays green (the existing checkpoint
success-path test does not assert on `labels`, so it is non-breaking); and a `setLabel` failure is
swallowed (the rewind still reports success — E13).

> ⚠️ **This is the implementation hook ONLY (S1). Tests are sibling P1.M3.T1.S2.** The hook is additive
> to one file and fires only on the checkpoint-granularity success path. It reuses the **already-captured
> `pi` closure** and the **already-present `makePi().labels` test seam** — no plumbing, no new exports,
> no harness changes. The downstream effect (audit/`checkpointExists` skipping the cleared label) needs
> **zero** changes in audit.ts / checkpoint.ts / checkpointExists — clearing the label is the single
> source of truth (verified, see §Context).

## User Persona (if applicable)

**Target User**: The agent (consumer of `mulligan_checkpoint`) + the operator reading `mulligan_audit`.

**Use Case**: The agent sets a checkpoint before a speculative sub-task, then rewinds to it. The
checkpoint has served its purpose; it must not linger in `mulligan_audit`'s active list forever, and a
stale same-name checkpoint must not silently re-target on a later rewind.

**Pain Points Addressed**: Pre-fix, consumed checkpoints linger in the audit's active-marker list
indefinitely (spec/05 §3 step 5 rationale: "a used checkpoint has no further purpose, and unconsumed
throwaway checkpoints otherwise linger … indefinitely"). Clearing the label on consumption retires it.

## Why

- **Spec REQUIRED behavior** (spec/05 §3 step 5, `mulligan_checkpoint` Behavior): *"Auto-expiry on
  consumption (REQUIRED): … the checkpoint is consumed and MUST be retired — its label cleared … so it no
  longer appears active in `mulligan_audit`."* Also reinforced by spec/08 E15 ("Checkpoints are bounded
  separately by auto-expiry on consumption … a checkpoint used as a rewind target is retired immediately,
  so only unconsumed checkpoints persist") and spec/06 §6. This task delivers that requirement.
- **Single-source cleanup**: clearing the label is the ONE action that makes BOTH `audit.listCheckpoints`
  AND `rewind.checkpointExists` drop the checkpoint (both scan for a `string` label starting with /
  equal to `mulligan:checkpoint:`; a cleared label is `undefined` → skipped). No edits needed downstream.
- **Symmetry with `setCheckpoint`**: `markers.ts:setCheckpoint` writes the label via `pi.setLabel`; this
  hook clears it via the same `pi.setLabel(id, undefined)` API (the `string | undefined` label type
  signature makes `undefined` the documented "clear" value). One API, two directions.
- **E13-safe by construction**: the hook runs AFTER the marker is already persisted, so even a total
  failure of the clear leaves the rewind correct — the checkpoint just stays active (a minor UX nit,
  not a correctness bug). The own try/catch guarantees a clear-failure never inverts success→failure.

## What

One new `if (granularity === "checkpoint") { … }` block ("step 7b") inserted into `rewindExecute`
between the end of step 7 (`leaveNote(...)`) and step 8 (`hasWarning`). The block scans
`ctx.sessionManager.getEntries()` for the `LabelEntry` whose `label === \`mulligan:checkpoint:${params.checkpoint}\``
(mirroring the existing `checkpointExists` defensive scan), reads its `targetId`, and calls
`pi.setLabel(targetId, undefined)`. The whole block is wrapped in a try/catch that swallows (E13).
A Mode A inline comment cites spec/05 §3 step 5.

### Success Criteria

- [ ] A successful `granularity:"checkpoint"` rewind calls `pi.setLabel(<targetId>, undefined)` exactly
      once, where `<targetId>` is the consumed checkpoint's LabelEntry `targetId` (assertable via
      `makePi().labels` — sibling S2's tests).
- [ ] A successful `last_tool_call_group` / `last_turn` rewind does NOT call `pi.setLabel` at all
      (the hook is guarded by `if (granularity === "checkpoint")`).
- [ ] If `pi.setLabel` throws, the rewind STILL returns the success result (E13 — own try/catch swallows;
      the marker is already persisted at step 7). No "unexpected error" refusal on a clear failure.
- [ ] After consumption, `mulligan_audit` no longer lists the checkpoint and a second rewind to the same
      name refuses `checkpoint '<name>' not found on this branch` — **with no edits** to audit.ts /
      checkpoint.ts / checkpointExists (the cleared `undefined` label is skipped by their existing scans).
- [ ] `npm run typecheck` exits 0; `npx vitest run` stays green (21 files; existing checkpoint success
      test at `rewind.test.ts:340` does not assert on `labels` → non-breaking).
- [ ] No file other than `src/tools/rewind.ts` is modified. No tests added (S2's scope).

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the exact insertion point (after `leaveNote(...)`, before step 8), the
verbatim anchor lines to find it, the complete drop-in code block (step 7b) with the defensive scan
mirroring the existing `checkpointExists` style, the verified `pi.setLabel(targetId, undefined)` clear
semantics (with the `LabelEntry`/`setLabel` type evidence), the E13 wrapping rationale (the one real
failure mode), the downstream-effect proof (why audit/checkpointExists need no edits), the test-harness
facts (so the implementer knows S2 can assert via `makePi().labels` with no harness change), and
deterministic `typecheck` + `vitest` gates. The implementer opens exactly one file and runs two commands.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this task modifies
- file: src/tools/rewind.ts
  why: rewindExecute is where the consumption hook goes (step 7b, after the step 7 persist, before step 8).
        pi is already in scope (first arg of rewindExecute, captured by the makeRewindTool(pi) closure).
  section: "rewindExecute — step 7 persist ends with `leaveNote(pi, rendered, markerId ?? toolCallId);`.
            INSERT step 7b immediately after that line, before the `// (8) mutation warning` comment."
  pattern: "The file's OWN scanners (checkpointExists:~293, countRewindMarkers, countRetriesAtLatestPrompt)
            use defensive INLINE casts: `(e as { type?: unknown }).type === \"label\"` inside a per-entry
            try/catch, with a top try around ctx.sessionManager.getEntries(). MIRROR THIS EXACT STYLE for
            the consumption scan — do NOT import readOwn/isRecord (rewind.ts does not use them; consistency
            within the file beats cross-file DRY here)."
  gotcha: "rewindExecute's WHOLE body is one try/catch (site 9) that returns refusal('unexpected error').
           If the hook throws and is NOT locally caught, the throw propagates to site 9 and INVERTS a
           success into a refusal. The hook MUST have its OWN try/catch that swallows (E13). See GOTCHA #1."

# MUST READ — the spec REQUIRED-behavior citation (for the inline comment; READ-ONLY)
- file: spec/05-tools.md
  why: Line 182 (§3 mulligan_checkpoint → Behavior → step 5) is the 'Auto-expiry on consumption (REQUIRED)'
        wording the Mode A inline comment must cite. Also spec/08 E15 (checkpoint bound by auto-expiry).
  section: "§3 step 5 (line ~182): 'Auto-expiry on consumption (REQUIRED): … the checkpoint is consumed
            and MUST be retired — its label cleared … so it no longer appears active in mulligan_audit.'"
  critical: "This is the spec authority for the hook. The inline comment cites 'spec/05 §3 step 5'. READ-ONLY."

# MUST READ — the verified LabelEntry shape + setLabel clear semantics
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts
  why: LabelEntry = { type:'label', targetId:string, label:string|undefined } extends SessionEntryBase.
        The matching entry has type 'label' + label 'mulligan:checkpoint:<name>'; targetId is what setLabel
        takes. types.d.ts:942 setLabel(entryId:string, label:string|undefined):void — undefined CLEARS.
  critical: "passing undefined to setLabel CLEARS the label. Verified: audit.listCheckpoints skips entries
             where typeof label !== 'string' (so undefined drops it); checkpointExists compares
             label === needle (undefined !== needle → not found). No downstream edits needed."

# MUST READ — the setLabel WRITE precedent (markers.ts setCheckpoint — the SET direction)
- file: src/markers.ts
  why: setCheckpoint (line ~433) is the precedent for calling pi.setLabel from a Mulligan tool: it calls
        pi.setLabel(stableId, `mulligan:checkpoint:${name}`) to SET. This hook calls the SAME API with
        undefined to CLEAR. Confirms setLabel is on `pi` (ExtensionAPI — C9/C1), NOT ctx.sessionManager.
  pattern: "writes go through pi.setLabel; reads go through ctx.sessionManager.getEntries()/getBranch()
            (the C1/C9 read-only-manager split). setCheckpoint swallows throws → {error}; this hook
            swallows throws → success proceeds (both E13)."
  gotcha: "READ-ONLY — do NOT edit markers.ts (the setCheckpoint SET path; this task only CLEARs in rewind.ts)."

# MUST READ — why clearing works with NO downstream edits (the audit scanner)
- file: src/tools/audit.ts
  why: listCheckpoints (line ~324) scans entries: readOwn(entry,'type') !== 'label' → skip;
        typeof label !== 'string' → skip; label.startsWith('mulligan:checkpoint:') → push name. So a
        cleared (undefined) label is skipped → checkpoint drops from mulligan_audit. NO edit to audit.ts.
  critical: "This is the PROOF that clearing the label is sufficient — listCheckpoints's `typeof label !==
             'string'` guard already handles the undefined case. Same for rewind.checkpointExists
             (`label === needle` no longer matches). READ-ONLY — do NOT edit audit.ts."

# CONTEXT — the test harness S2 will use (NOT this task; context for the hook's testability)
- file: test/tools/rewind.test.ts
  why: makePi() (line 62) returns { appended, sent, labels, pi } where labels:{entryId,label:string|undefined}[]
        captures EVERY pi.setLabel call and throwOnSetLabel simulates a failure. checkpointLabelEntry(name,
        targetId='leaf-1') (line 192) is the reusable LabelEntry fixture. The existing checkpoint success
        test (line 340) uses checkpointLabelEntry('anchor') and does NOT assert on labels → non-breaking.
  critical: "The hook is testable with ZERO harness changes — makePi already captures setLabel. S2 asserts
             labels contains { entryId:<targetId>, label:undefined } after a checkpoint rewind. READ-ONLY."

# CONTEXT — the parallel-sibling PRP (no file overlap)
- file: plan/005_95d30743cdd4/P1M2T2.S1/PRP.md
  why: CONTRACT. P1.M2.T2.S1 is a JSDoc-COMMENT-ONLY edit in src/markers.ts leaveNote(). It touches
        src/markers.ts ONLY — ZERO overlap with src/tools/rewind.ts. No conflict, any order.
  gotcha: "Do NOT duplicate or depend on P1.M2.T2.S1's comment work — different file, independent."

# CONTEXT — the architectural design (verified LabelEntry + hook design)
- file: plan/005_95d30743cdd4/architecture/m3_checkpoint_expiry.md
  why: The verified consumption-hook design (location, scan, clear, E13 wrapping, downstream table).
  critical: "Confirms pi is in scope via the factory closure; the scan mirrors checkpointExists; clearing
             is the single source (audit/checkpointExists need no edits). Cross-check source."

# EXTERNAL — the C1/C9 read-only-manager constraint (why labels write through `pi`)
- note: "spec/01-proven-constraints.md C1 ('A tool cannot mutate the session through ctx.sessionManager')
         + C9 ('pi.setLabel/getLabel round-trip works from a tool'). Labels are WRITTEN via pi.setLabel and
         READ via ctx.sessionManager.getEntries(). This hook follows that split exactly (read entries via
         ctx, clear the label via pi)."
```

### Current Codebase tree (the relevant slice)

```bash
src/tools/
├── rewind.ts          # ← EDIT: add step 7b consumption hook in rewindExecute (checkpoint path only)
├── audit.ts           # READ-ONLY — listCheckpoints (skips undefined labels automatically; no edit)
├── checkpoint.ts      # READ-ONLY — setCheckpoint (the SET counterpart; re-create works after clear)
└── (shrink/cancel.ts) # READ-ONLY — unaffected
src/
└── markers.ts         # READ-ONLY — setCheckpoint setLabel precedent (parallel sibling P1.M2.T2.S1 edits JSDoc here)
spec/
└── 05-tools.md        # READ-ONLY — §3 step 5 (line ~182) 'Auto-expiry on consumption' citation
test/tools/
└── rewind.test.ts     # READ-ONLY — makePi().labels already captures setLabel (S2 adds the consumption tests)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
src/tools/rewind.ts   # +1 code block (step 7b) in rewindExecute, checkpoint-granularity success path only,
                      #  wrapped in its own try/catch (E13), with a Mode A inline comment citing spec/05 §3 step 5.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (E13 — the ONE real failure mode): rewindExecute's WHOLE body is in ONE try/catch
//   (site 9) that returns refusal(`unexpected error: ${e}`) on any exception. If the consumption hook
//   throws and is NOT locally caught, that throw propagates to site 9 and the rewind — which ALREADY
//   SUCCEEDED (marker persisted at step 7) — is retroactively reported as an "unexpected error" REFUSAL.
//   That inverts success→failure, which E13 forbids. THEREFORE the hook MUST be wrapped in its OWN
//   try/catch that swallows, so the step 9 success return proceeds regardless of any clear failure.
//   (Contract: "a label-clear failure must never undo the rewind; the rewind marker is already persisted.")

// CRITICAL GOTCHA #2 (the scan MUST mirror checkpointExists's defensive style, NOT import readOwn):
//   rewind.ts does NOT import readOwn/isRecord. Its own entry-scanners (checkpointExists:~293,
//   countRewindMarkers, countRetriesAtLatestPrompt) all use INLINE casts:
//     for (const e of entries) {
//       if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
//       try { if ((e as { type?: unknown }).type === "label" && (e as { label?: unknown }).label === needle) … }
//       catch { /* skip a throwing-Proxy entry */ }
//     }
//   with a top-level try around ctx.sessionManager.getEntries(). MIRROR THIS EXACTLY for the consumption
//   scan. Do NOT `import { readOwn } from "../transforms.js"` or audit's helpers — it would diverge from
//   the file's idiom and risk a different defensive posture. (Consistency > cross-file DRY here.)

// CRITICAL GOTCHA #3 (insert AFTER step 7 persist, NOT before): the consumption runs ONLY after the
//   rewind has already succeeded — appendRewindMarker(pi, ctx, payload) AND leaveNote(pi, rendered, …)
//   have both completed. Inserting earlier (e.g. before the marker persists) would risk clearing the
//   label for a rewind that then fails the persist. The hook's precondition is "step 7 succeeded".
//   Anchor: insert immediately after `leaveNote(pi, rendered, markerId ?? toolCallId);` (end of step 7)
//   and before the `// (8) mutation warning (step 7 / E5)` comment.

// CRITICAL GOTCHA #4 (read targetId, not the entry id): setLabel takes the LABEL's targetId — the entry
//   the label was SET ON (the checkpointed message), NOT the LabelEntry's own id. The LabelEntry is
//   { type:'label', targetId:<the checkpointed entry's id>, label:'mulligan:checkpoint:<name>' }. So scan
//   for the matching label, then read e.targetId, then pi.setLabel(e.targetId, undefined). (setCheckpoint
//   set the label on a `message` entry's id; that id is what lives in targetId.)

// CRITICAL GOTCHA #5 (params.checkpoint is guaranteed valid at the hook): by step 7b, step 3 already
//   refused if `!name || name.length === 0` or `!checkpointExists(ctx, name)`. So params.checkpoint is a
//   non-empty string whose label DEFINITELY exists in getEntries(). The scan will find exactly one match
//   (labels are unique-per-name — setLabel moves a same-name label to the new target). `break` after the
//   first match is correct.

// CRITICAL GOTCHA #6 (guard with granularity === 'checkpoint', NOT branch on params.checkpoint truthiness):
//   the hook fires ONLY for checkpoint granularity. Use `if (granularity === "checkpoint")` (the local
//   normalized variable rewindExecute already declares at its top — use THAT, not params.granularity, since
//   `granularity` is the defensively-normalized value). last_tool_call_group / last_turn must NOT call
//   setLabel (existing tests for those paths expect labels to stay empty).

// OUT OF SCOPE (do NOT touch in this subtask):
//   - test/*                  → sibling P1.M3.T1.S2 owns the consumption tests (makePi().labels assertions).
//   - audit.ts / checkpoint.ts / markers.ts / transforms.ts → READ-ONLY (clearing is the single source; no
//                              downstream edit needed; markers.ts is being comment-edited by sibling P1.M2.T2.S1).
//   - spec/*                  → READ-ONLY (spec/05 §3 step 5 is the cited authority).
//   - index.ts                → wiring is unchanged (makeRewindTool already registered; pi already in scope).
// This PRP edits ONLY src/tools/rewind.ts (one new code block + inline comment in rewindExecute).
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no new types. The hook consumes the existing `LabelEntry` shape (`{ type:"label", targetId:string,
label:string|undefined }`) via defensive inline casts and calls the existing `pi.setLabel(entryId, label)`
API. No model, no schema, no export. The block is a local side-effect inside `rewindExecute`._

### Implementation Tasks (ordered by dependencies)

One task — insert the step 7b block at the verified anchor. Apply it as one exact edit.

```yaml
Task 1: EDIT src/tools/rewind.ts — insert step 7b consumption hook in rewindExecute
  - LOCATE rewindExecute. Find the END OF STEP 7 (the persist), which is the line:
      `    leaveNote(pi, rendered, markerId ?? toolCallId); // GOTCHA #10: entry id; fallback toolCallId`
    (it immediately follows `const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput);`).
  - FIND (verbatim — the step 7 tail; this is the unique anchor):
      `    const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput); // cast: frozen type omits checkpoint\n    leaveNote(pi, rendered, markerId ?? toolCallId); // GOTCHA #10: entry id; fallback toolCallId`
  - INSERT IMMEDIATELY AFTER that line (and BEFORE the `    // (8) mutation warning (step 7 / E5) — …`
    comment) the step 7b block shown in "Implementation Patterns & Key Details" below.
  - GUARD: the block opens with `if (granularity === "checkpoint") {` — checkpoint path ONLY.
  - SCAN: mirror checkpointExists's defensive inline-cast style (do NOT import readOwn). Read
    ctx.sessionManager.getEntries() inside a top try; iterate; for each entry skip non-objects; in a
    per-entry try read type/label/targetId via `(e as { type?: unknown; label?: unknown; targetId?:
    unknown })`; match type==="label" && label===\`mulligan:checkpoint:${params.checkpoint}\`; on match,
    if typeof targetId === "string" && targetId.length > 0 call pi.setLabel(targetId, undefined); break.
  - E13: wrap the ENTIRE block (getEntries read + scan + setLabel) in ONE try/catch with an EMPTY catch
    body (a comment: "E13: a label-clear failure must never undo the rewind (marker already persisted at
    step 7)"). The step 9 success return then proceeds regardless.
  - COMMENT: add a Mode A block comment above the `if` citing spec/05 §3 step 5 ("Auto-expiry on
    consumption") + E13 + that clearing is the single source (audit/checkpointExists need no edits).
  - DO NOT:
      * touch any other step (1-6, 8, 9), the refuse() closure, the outer catch, checkpointExists,
        countRewindMarkers, resolvePreview, the factory, or any other function in the file;
      * import readOwn/isRecord (use the file's inline-cast idiom);
      * add any export (the block is local to rewindExecute);
      * edit any other file;
      * add tests (sibling P1.M3.T1.S2).
```

### Implementation Patterns & Key Details

The complete, drop-in step 7b block (insert after the step 7 `leaveNote(...)` line, before step 8):

```ts
    // (7b) checkpoint consumption — spec/05 §3 step 5 ("Auto-expiry on consumption (REQUIRED)").
    //      ONLY on the checkpoint-granularity success path (step 7 persist + leaveNote already completed).
    //      A checkpoint exists to be rewound TO; once consumed it has no further purpose, so its LabelEntry
    //      label is cleared via pi.setLabel(targetId, undefined). This is the single source of truth: after
    //      the clear, audit.listCheckpoints skips it (typeof label !== "string") and checkpointExists
    //      (step 3) returns false (label === needle no longer matches) → a second rewind refuses 'not found'.
    //      Re-creating the checkpoint later (mulligan_checkpoint) sets a fresh label and works. E13: wrapped
    //      in its OWN try/catch that swallows — a label-clear failure must NEVER undo the rewind (the marker
    //      is already persisted at step 7; the outer catch would otherwise invert success into 'unexpected
    //      error'). Mirrors checkpointExists's defensive inline-cast scan (rewind.ts does not use readOwn).
    if (granularity === "checkpoint") {
      try {
        const needle = `mulligan:checkpoint:${params.checkpoint}`;
        let entries: unknown;
        try {
          entries = ctx.sessionManager.getEntries();
        } catch {
          entries = undefined; // never let the entry read throw out of the consumption block (E13)
        }
        if (Array.isArray(entries)) {
          for (const e of entries) {
            if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
            let isMatch = false;
            let targetId: unknown = undefined;
            try {
              const ee = e as { type?: unknown; label?: unknown; targetId?: unknown };
              isMatch = ee.type === "label" && ee.label === needle;
              targetId = ee.targetId;
            } catch {
              continue; // a throwing-Proxy entry → skip (mirrors checkpointExists)
            }
            if (isMatch && typeof targetId === "string" && targetId.length > 0) {
              pi.setLabel(targetId, undefined); // clear the label → checkpoint consumed/retired
            }
            break; // labels are unique-per-name: at most one match; stop after the first (hit or miss)
          }
        }
      } catch {
        // E13: a label-clear failure must never undo the rewind (marker already persisted at step 7).
        // The checkpoint simply stays active — a minor UX nit, not a correctness bug. Swallow + proceed.
      }
    }
```

Key points the block encodes (the implementer should understand, not just paste):

```ts
// PATTERN — defensive entry scan (mirrors checkpointExists/countRewindMarkers in THIS file):
//   top try around getEntries() → if non-array, skip; per-entry: reject non-objects, then a per-entry
//   try for the field reads (a throwing-Proxy entry is skipped, not fatal). This is rewind.ts's
//   established idiom — DO NOT swap it for readOwn/isRecord (audit.ts uses those; rewind.ts does not).

// PATTERN — read targetId, clear via pi.setLabel(id, undefined):
//   setCheckpoint (markers.ts) SETS via pi.setLabel(stableId, `mulligan:checkpoint:${name}`); this hook
//   CLEARs via pi.setLabel(targetId, undefined). The LabelEntry.targetId IS the stableId setCheckpoint
//   labeled (the checkpointed message entry's id). setLabel's `label: string | undefined` signature makes
//   undefined the documented clear value.

// CRITICAL — own try/catch (E13): the block's OUTERMOST try/catch swallows. WITHOUT it, a throwing
//   getEntries()/setLabel would propagate to rewindExecute's site-9 catch → refusal('unexpected error'),
//   inverting the already-succeeded rewind into a failure. The own catch guarantees success proceeds.

// CRITICAL — `break` after the first scan iteration (hit or miss): a same-name label is unique-per-target
//   (setLabel moves it), so there is at most ONE matching LabelEntry. Scanning past the first entry is
//   pointless and could only find a stale duplicate if one somehow existed. Break after the first iteration.
//   (If no match is found — shouldn't happen post-step-3 — the hook is a harmless no-op: success proceeds,
//   the checkpoint just isn't cleared. Safe.)
```

### Integration Points

```yaml
NO NEW INTEGRATION POINTS — single-file additive code block.
  - DATABASE: none
  - CONFIG: none (the hook is unconditional on the checkpoint path; no knob gates consumption — spec/05
              §3 step 5 is REQUIRED, not configurable. It runs whenever a checkpoint rewind succeeds.)
  - ROUTES: none
  - CODE (this file): inserts into rewindExecute between step 7 (leaveNote) and step 8 (hasWarning).
            Uses `granularity` (the normalized local), `params.checkpoint`, `ctx.sessionManager.getEntries()`,
            and `pi.setLabel` — ALL already in scope. No new import, no new export, no signature change.
  - CODE (downstream — NO edits, verified): audit.listCheckpoints skips undefined labels (its existing
            `typeof label !== "string"` guard); rewind.checkpointExists returns false (label === needle
            fails); checkpoint.setCheckpoint re-creates normally. The label clear is the single source.
  - TESTS (sibling S2): makePi().labels already captures setLabel (no harness change). checkpointLabelEntry
            (rewind.test.ts:192) is the reusable LabelEntry fixture. S2 asserts labels contains
            { entryId: <targetId>, label: undefined } post-rewind + that a second rewind refuses 'not found'.
  - PARALLEL-SIBLING COORDINATION: P1.M2.T2.S1 edits src/markers.ts JSDoc only — different file, no overlap.
```

---

## Validation Loop

This is one additive code block in one `.ts` file. Validation = grep the block landed + typecheck clean +
the full vitest suite green (the existing checkpoint success test is non-breaking) + a targeted check that
the non-checkpoint paths don't call setLabel.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The block landed at the right anchor (between step 7 leaveNote and step 8 hasWarning):
grep -n "checkpoint consumption — spec/05 §3 step 5\|if (granularity === \"checkpoint\")" src/tools/rewind.ts
# Expected: a hit for the (7b) comment AND the `if (granularity === "checkpoint")` guard, located AFTER
#           the `leaveNote(pi, rendered, markerId ?? toolCallId);` line and BEFORE `// (8) mutation warning`.

# (b) The E13 own-try/catch is present (the critical safety net):
grep -n "E13: a label-clear failure must never undo the rewind" src/tools/rewind.ts
# Expected: at least one hit inside the step 7b block (the catch comment).

# (c) The clear call is exactly pi.setLabel(targetId, undefined) — not a string, not getLabel:
grep -n "pi.setLabel(targetId, undefined)" src/tools/rewind.ts
# Expected: exactly one hit, inside the `if (isMatch && typeof targetId === "string" …)` branch.
```
Expected: all three grep checks hit inside the step 7b block; the block sits at the verified anchor.

### Level 2: Type-check (the strict gate — catches any cast/scope error)

```bash
npm run typecheck        # = tsc --noEmit (strict mode; tsconfig includes src + test)
echo "typecheck exit: $?"
# Expected: exit 0, NO output. The inline `(e as { type?: unknown; … })` casts are strict-safe; `pi` and
#           `ctx` are already typed; `params.checkpoint` is `string | undefined` but guarded by step 3
#           (and template-literal-coerced to string in `needle`). If tsc errors, READ it — likely a stray
#           untyped access — and fix before proceeding.
```
Expected: exit 0.

### Level 3: Unit Tests (regression guard — the existing suite MUST stay green)

```bash
# The rewind tool suite (the file most likely to be affected — confirms non-breaking):
npx vitest run test/tools/rewind.test.ts
# Expected: all pass. The existing checkpoint success test (rewind.test.ts:340, checkpointLabelEntry('anchor'))
#           does NOT assert on labels → the new setLabel call is invisible to it. If it fails, the hook
#           accidentally fired on a non-checkpoint path or threw past the own try/catch — re-check the guard.

# Full suite (catches any cross-file surprise):
npx vitest run
# Expected: 21 test files pass, 0 failures (identical to pre-edit). This task adds NO tests (S2 does);
#           the count is unchanged. If a count/owner changed, scope leaked — revert and re-check.
```
Expected: rewind tests pass; full suite 21 files green, unchanged.

### Level 4: Behavior proof (manual reasoning — S2 will codify these as tests)

```bash
# Confirm the hook is the ONLY new setLabel call site in rewind.ts (the SET direction stays in markers.ts):
grep -n "setLabel" src/tools/rewind.ts
# Expected: exactly ONE hit — `pi.setLabel(targetId, undefined)` inside step 7b. (rewind.ts had ZERO
#           setLabel calls before this task; markers.ts/checkpoint.ts own the SET direction.)

# Confirm the non-checkpoint paths cannot reach the hook (the guard is granularity-scoped, not params-scoped):
grep -n "if (granularity === \"checkpoint\")" src/tools/rewind.ts
# Expected: the step 7b guard (and possibly the pre-existing step 3 existence guard — both are fine; the
#           consumption block is nested inside its own `if (granularity === "checkpoint")`).
```
Expected: exactly one new `setLabel` site in rewind.ts; the consumption guard is granularity-scoped.

### Level 5: Scope-discipline gate (no collateral edits)

```bash
# The only source change should be the step 7b block in rewind.ts:
git -C . diff --stat -- src/tools/rewind.ts    # Expected: src/tools/rewind.ts | +N -0 (pure insertion).
git -C . diff --name-only | grep -vE 'src/tools/rewind.ts' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# Expected: "scope OK" (ONLY src/tools/rewind.ts appears in the diff). markers.ts (sibling P1.M2.T2.S1),
#           audit.ts, checkpoint.ts, spec/*, test/*, index.ts must NOT appear.
```
Expected: a pure insertion in `src/tools/rewind.ts`; no other file touched.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep confirms the (7b) comment + `if (granularity === "checkpoint")` guard + the E13 catch
      comment + `pi.setLabel(targetId, undefined)` are all present at the verified anchor.
- [ ] Level 2: `npm run typecheck` exits 0 (strict mode clean).
- [ ] Level 3: `npx vitest run test/tools/rewind.test.ts` passes; full `npx vitest run` is 21 files green.
- [ ] Level 4: exactly ONE new `setLabel` site in rewind.ts; the guard is granularity-scoped.
- [ ] Level 5: `git diff --name-only` shows ONLY `src/tools/rewind.ts`.

### Feature Validation
- [ ] A successful `granularity:"checkpoint"` rewind calls `pi.setLabel(<targetId>, undefined)` once.
- [ ] A successful `last_tool_call_group` / `last_turn` rewind does NOT call `pi.setLabel`.
- [ ] A `setLabel` throw is swallowed (E13) — the rewind still returns success (no "unexpected error").
- [ ] After consumption, `mulligan_audit` drops the checkpoint and a second rewind refuses "not found" —
      with NO edits to audit.ts / checkpoint.ts / checkpointExists (clearing is the single source).
- [ ] Re-creating the checkpoint (`mulligan_checkpoint`) after consumption sets a fresh label and works.
- [ ] The inline comment cites spec/05 §3 step 5 ("Auto-expiry on consumption").

### Code Quality / Scope Discipline
- [ ] The scan mirrors `checkpointExists`'s defensive inline-cast style (no readOwn/isRecord import).
- [ ] The block reads `targetId` (the checkpointed entry's id) and clears via `pi.setLabel(targetId, undefined)`.
- [ ] The block is wrapped in its OWN try/catch (E13) — a clear failure never inverts success→failure.
- [ ] Inserted AFTER step 7 persist (precondition: marker + note already persisted), BEFORE step 8.
- [ ] Did NOT add tests (sibling P1.M3.T1.S2 owns `test/tools/rewind.test.ts` consumption assertions).
- [ ] Did NOT edit audit.ts / markers.ts / checkpoint.ts / transforms.ts / index.ts / spec/* / test/*.

### Documentation
- [ ] Mode A inline comment cites spec/05 §3 step 5 + explains E13 + the single-source downstream effect.
- [ ] No separate doc file (Mode A — the comment IS the documentation, per the contract DOCS clause).

---

## Anti-Patterns to Avoid

- ❌ Don't import `readOwn`/`isRecord` for the scan. rewind.ts does not use them; its scanners
  (`checkpointExists`, `countRewindMarkers`, `countRetriesAtLatestPrompt`) all use defensive inline
  `(e as { type?: unknown })` casts with per-entry try/catch. Mirror THAT idiom (consistency > DRY here).
- ❌ Don't omit the OWN try/catch around the consumption block. Without it, a throwing `getEntries()` or
  `setLabel` propagates to rewindExecute's site-9 catch → `refusal("unexpected error")`, inverting an
  already-succeeded rewind into a failure (violates E13). The own catch MUST swallow.
- ❌ Don't insert the hook BEFORE step 7 (the persist). It runs ONLY after `appendRewindMarker` + `leaveNote`
  have both completed — clearing a label for a rewind that then fails the persist would be wrong. Anchor
  after `leaveNote(pi, rendered, markerId ?? toolCallId);`.
- ❌ Don't clear using the LabelEntry's OWN id — use its `targetId` (the checkpointed message entry's id).
  `setLabel` takes the target the label is ON; the LabelEntry's `id` is the label record's id, not the target.
- ❌ Don't guard on `params.checkpoint` truthiness — guard on `granularity === "checkpoint"` (the normalized
  local). last_tool_call_group / last_turn must NOT call setLabel (existing tests expect labels-free there).
- ❌ Don't forget the `break` after the first scan iteration. Labels are unique-per-name; scanning past the
  first entry is pointless (at most one match) and a stale duplicate, if one existed, is not a target.
- ❌ Don't edit audit.ts / checkpoint.ts / checkpointExists to "make the cleared label disappear." Clearing
  the label is ALREADY sufficient — `listCheckpoints` skips non-string labels; `checkpointExists` compares
  `label === needle` (undefined ≠ needle). Downstream edits are unnecessary and out of scope.
- ❌ Don't add tests in this subtask. The consumption tests are sibling P1.M3.T1.S2 (it asserts via the
  already-present `makePi().labels` seam + `checkpointLabelEntry` fixture — no harness change needed).
- ❌ Don't edit markers.ts — the SET-direction `setCheckpoint` lives there and is being comment-edited by
  the parallel sibling P1.M2.T2.S1 (different file, no overlap, but don't touch it here).
- ❌ Don't make consumption configurable. spec/05 §3 step 5 is **REQUIRED**, not a config knob — there is no
  `checkpoint.expireOnConsume` setting and none should be added. The hook fires unconditionally on success.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a single additive code block in one file at a
verified anchor (after `leaveNote`, before step 8), with the complete drop-in code (defensive scan
mirroring the file's existing `checkpointExists` idiom, `pi.setLabel(targetId, undefined)` clear, own
try/catch E13 swallow), the verified API evidence (`LabelEntry.targetId` + `setLabel(id, undefined)`
clears, proven by `listCheckpoints`/`checkpointExists`'s existing string-label guards), the downstream
no-edit proof, the test-harness facts (`makePi().labels` already captures setLabel; existing checkpoint
test is non-breaking), and deterministic `typecheck` + `vitest` gates. `pi` is already in scope via the
factory closure; no plumbing. The one residual risk — forgetting the own try/catch (which would invert
success→failure on a clear failure) — is the explicitly-flagged CRITICAL GOTCHA #1 and is enforced by the
Level 1 grep + the E13 comment requirement. Not 10/10 only because the E13-wrap discipline and the
read-targetId-not-entry-id detail are easy to get subtly wrong if the implementer pastes without reading.