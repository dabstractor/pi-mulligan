# PRP — P1.M3.T1.S1: index.ts — stop registering the checkpoint agent tool

## Goal

**Feature Goal**: Remove `mulligan_checkpoint` from the agent-tool registrations in `src/index.ts`. Per
spec/05 §3 (h2.58) the checkpoint agent tool is **REMOVED** in v1.1 (it moves to a human slash command —
E23 RESOLVED: the actor with foresight is the *user*, not the agent). The agent tool count drops 5 → **4**
(rewind, shrink, audit, cancel). `mulligan_rewind(granularity:"checkpoint")` is **retained** (the agent may
still rewind *to* a user-set checkpoint).

**Deliverable**: Edits to **`src/index.ts` ONLY** — (1) delete the `makeCheckpointTool` import (line 10);
(2) delete the `pi.registerTool(makeCheckpointTool(pi))` registration (line 49); (3) update the JSDoc "all 5
agent-callable tools" → "all 4" (line 17); (4) update the registration comment block "all 5" → "all 4" and
drop the checkpoint references (line 44). Plus two coherence edits: the cancel-import/cancel-registration
"5th tool" → "4th tool" ordinals (lines 13, 51). **Do NOT delete `src/tools/checkpoint.ts`** (Phase 2 reuses
`validCheckpointName` + `NAME_RE`; tests still import it).

**Success Definition**: After the edits, (a) index.ts registers **exactly 4** `pi.registerTool(...)` calls
(rewind, shrink, audit, cancel) and has **zero** `makeCheckpointTool` references; (b) the JSDoc + comments
consistently say "4 agent-callable tools" with no stale "5th"/"setCheckpoint" references; (c) `npm run typecheck`
(tsc --noEmit) is clean; (d) `src/tools/checkpoint.ts` is untouched (still exports makeCheckpointTool for the
tests that import it directly). The full `npm test` is **expected to be RED** in `test/index.test.ts` (the
5-tool registration assertion) until sibling P1.M3.T1.S2 lands — that break is the documented S2 handoff, NOT
an S1 defect.

> ⚠️ **S1 is index.ts ONLY; S2 owns the test fallout.** The one test that breaks from this edit is
> `test/index.test.ts` (asserts 5 registered tools + a sorted-name array containing `mulligan_checkpoint`).
> S1 does NOT touch any test. The validation gate is "typecheck clean + grep confirms 4 tools + the ONLY
> vitest failure is the known index.test.ts registration-count assertion" — NOT "full suite green" (that
> requires S2). See Validation Loop Level 3.

## User Persona (if applicable)

**Target User**: The agent (which loses a tool) + the operator (who gains the slash command in Phase 2).

**Use Case**: Post-v1.1 the agent has 4 tools; checkpoints are set by the human via `/mulligan_checkpoint`.
index.ts must no longer register the (now-removed) checkpoint agent tool.

**Pain Points Addressed**: As long as index.ts registers `mulligan_checkpoint`, the agent can still call it —
contradicting spec/05 §3 (REMOVED) and E23 (RESOLVED). Removing the registration is the mechanical cut.

## Why

- **Spec fidelity (spec/05 §3 / E23 / §h2.132)**: "mulligan_checkpoint is **removed**; the agent tool count
  drops from 5 to **4**." The registration is the single point that exposes the tool to the agent.
- **Minimal, surgical**: a 0.5-point edit — delete 2 lines, update 2 counts (+2 coherence ordinals). No
  behavior beyond registration changes; the checkpoint *machinery* (label set/get, rewind-to-checkpoint,
  auto-expiry) is untouched and stays for `mulligan_rewind(granularity:"checkpoint")`.
- **Preserves Phase 2 reuse**: `src/tools/checkpoint.ts` stays on disk (unregistered dead code) because
  Phase 2 (P2.M1.T1) extracts `validCheckpointName` + `NAME_RE` into the new `commands.ts`. Deleting it now
  would break `test/integration/smoke.ts` + `test/edge-cases.test.ts` + `test/tools/checkpoint.test.ts`
  (which import it directly) and force Phase 2 to rebuild the regex.
- **Paired with S2**: S1 cuts the registration; S2 updates the registration-count test. Splitting avoids a
  single task touching both src and the assertion that tests it.

## What

Four contract edits + two coherence edits in `src/index.ts`. Result: 4 tool imports, 4 `registerTool` calls,
no `makeCheckpointTool` reference, consistent "4 agent-callable tools" wording.

### Success Criteria

- [ ] `grep -c 'makeCheckpointTool' src/index.ts` → **0** (the import and registration are both gone).
- [ ] `grep -c 'pi.registerTool' src/index.ts` → **4** (rewind, shrink, audit, cancel).
- [ ] The registered names are exactly `mulligan_rewind`, `mulligan_shrink`, `mulligan_audit`, `mulligan_cancel`
      (no `mulligan_checkpoint`).
- [ ] JSDoc (line ~17) reads "all **4** agent-callable tools"; the registration comment (line ~44) reads
      "all **4**" and no longer mentions checkpoint/`setCheckpoint`.
- [ ] The cancel import (line ~13) + cancel registration (line ~51) comments say "4th", not "5th".
- [ ] `npm run typecheck` → exit 0 (clean).
- [ ] `src/tools/checkpoint.ts` is **unchanged** (`git diff --name-only` does not list it).
- [ ] No file other than `src/index.ts` is modified by this task.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the verbatim current text (FIND anchors) and verbatim replacement for every edit,
the exact line context (imports block, registration block, JSDoc), the explicit DO-NOT-DELETE guard for
checkpoint.ts (with the verified test consumers that keep it alive), the validation nuance (full suite is RED
until S2 — gate on typecheck + grep + the isolated index.test.ts failure), and the parallel-sibling scope fence.
The implementer opens one file.

### Documentation & References

```yaml
# MUST EDIT — the ONLY file this task modifies
- file: src/index.ts
  why: The extension factory (package.json main + pi.extensions). Lines to edit: 10 (import), 13 (cancel
        import comment — coherence), 17 (JSDoc count), 44 (registration comment block), 49 (registration),
        51 (cancel registration comment — coherence).
  section: "imports block (top, ~lines 1-13); the default-export factory's step 3 registration block
            (~lines 44-51); the factory JSDoc (~lines 15-27, 'Wires all 5 agent-callable tools')."
  pattern: "Each tool factory is imported + registered in the same order; auditTool is a PLAIN const (no
            factory, no pi closure). Use TEXT-anchored find/replace (the verbatim strings below), not line
            numbers — line numbers shift as lines are deleted."
  gotcha: "Removing the import AND the registration is required (an imported-but-unregistered factory would
           be a tsc noUnusedLocals error IF tsconfig had it — it does NOT, but leaving a dangling import is
           sloppy and a reviewer flag). Remove BOTH. Do NOT remove the auditTool or makeCancelTool lines."

# MUST NOT DELETE — checkpoint.ts stays (Phase 2 reuses it; tests import it directly)
- file: src/tools/checkpoint.ts
  why: READ-ONLY in this task. After S1 it is unregistered dead code, BUT test/integration/smoke.ts:40,
        test/edge-cases.test.ts:45, and test/tools/checkpoint.test.ts import `makeCheckpointTool`/
        `validCheckpointName` directly (NOT via index.ts). Deleting it would break those tests + force
        Phase 2 to rebuild the NAME_RE regex. Phase 2 (P2.M1.T1) extracts the reusable bits then may delete it.
  critical: "Contract step 3: 'Do NOT delete src/tools/checkpoint.ts — Phase 2 reuses validCheckpointName +
             NAME_RE.' Verified: tsconfig has NO noUnusedLocals, so its now-unregistered exports don't error."

# MUST READ — the spec authority (checkpoint REMOVED, count 5→4)
- docfile: spec/05-tools.md
  why: "§3 (h2.58): 'mulligan_checkpoint — REMOVED as an agent tool (v1.1) ... moved to a human slash command.'
        §h2.132 §6: 'the agent tool count drops from 5 to 4 (rewind, shrink, audit, cancel).'"
  section: "h2.58 (§3 REMOVED) + h2.104 (E23 RESOLVED) + h2.132 (§6 interaction). READ-ONLY."

# MUST READ — the verified touchpoint map (confirms the 4 index.ts edits)
- docfile: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: "§Change 1 lists the EXACT index.ts edits: line 10 import REMOVE, line 49 registration REMOVE, line 17
        JSDoc 5→4, line 44 comment 5→4. Confirms checkpoint.ts is NOT deleted (Phase 2 extracts NAME_RE/
        validCheckpointName) and enumerates the affected tests (S2's scope)."
  critical: "This is the authoritative edit list. S1 = the 4 index.ts edits; the test updates listed there
             (index.test.ts, smoke.ts, edge-cases, audit.test.ts) are S2/Phase-2, NOT S1."

# CONTEXT — the sibling contract (parallel, zero overlap)
- file: plan/007_67d7d8c6e4c5/P1M2T1S3/PRP.md
  why: CONTRACT. P1.M2.T1.S3 is test-ONLY (test/tokens.test.ts, test/turn_metric.test.ts, test/drift_nudge.test.ts
        — the D10 agent-attributable delta tests). ZERO overlap with src/index.ts. No conflict, any order.
  gotcha: "Do NOT touch tokens/nudges/turn_metric tests (sibling's scope). S1 edits index.ts ONLY."

# CONTEXT — the S2 handoff (the test that S1's edit turns RED)
- file: test/index.test.ts
  why: READ-ONLY. Lines 66-72 assert the factory registers 5 tools (toHaveLength(5) + a sorted-name array
        including "mulligan_checkpoint"). After S1 this is RED — that is the EXPECTED handoff to P1.M3.T1.S2.
        S1 does NOT edit this file. (Confirmed: this is the ONLY test that goes through index.ts's registration;
        smoke.ts/edge-cases import makeCheckpointTool directly and do NOT break from S1.)
```

### Current Codebase tree (the relevant slice)

```bash
src/
├── index.ts                 # ← EDIT: remove checkpoint import (10) + registration (49); update counts (17, 44); coherence (13, 51)
└── tools/
    ├── checkpoint.ts        # READ-ONLY — DO NOT DELETE (Phase 2 reuses validCheckpointName + NAME_RE; tests import it)
    ├── rewind.ts            # READ-ONLY — registration stays
    ├── shrink.ts            # READ-ONLY — registration stays
    ├── audit.ts             # READ-ONLY — registration stays (auditTool const)
    └── cancel.ts            # READ-ONLY — registration stays
test/
├── index.test.ts            # READ-ONLY (S2's handoff — will be RED after S1; S1 does not touch it)
├── integration/smoke.ts     # READ-ONLY (imports makeCheckpointTool directly; S2/Phase-2 territory)
├── edge-cases.test.ts       # READ-ONLY (imports makeCheckpointTool directly; S2/Phase-2 territory)
└── tools/checkpoint.test.ts # READ-ONLY (Phase-2 territory)
spec/05-tools.md             # READ-ONLY — §3 (h2.58) REMOVED, §h2.132 count 5→4
plan/.../architecture/change_surface.md  # READ-ONLY — §Change 1 (the authoritative edit list)
```

### Desired Codebase tree with files to be added or responsibility of file

```bash
# NO new files. This item MODIFIES exactly one existing file:
src/index.ts   # -1 import, -1 registration, 4 comment/count updates (17, 44, 13, 51). 4 tools registered.
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (DO NOT DELETE checkpoint.ts): src/tools/checkpoint.ts stays on disk. After S1 it is
//   unregistered dead code (no production import), BUT test/integration/smoke.ts:40, test/edge-cases.test.ts:45,
//   and test/tools/checkpoint.test.ts import makeCheckpointTool/validCheckpointName DIRECTLY (not via index.ts).
//   Deleting it would break those tests + force Phase 2 (P2.M1.T1) to rebuild NAME_RE. tsconfig has NO
//   noUnusedLocals → its now-unregistered exports don't error. Leave it entirely untouched.

// CRITICAL GOTCHA #2 (the full suite is RED until S2 — do NOT gate on npm test green): S1 removes the
//   registration, so test/index.test.ts (which asserts 5 registered tools + a name array including
//   "mulligan_checkpoint") FAILS. This is the EXPECTED handoff to P1.M3.T1.S2. The S1 gate is:
//   `npm run typecheck` clean + grep (4 tools, 0 makeCheckpointTool) + `npx vitest run test/index.test.ts`
//   showing the ONLY failure is the registration-count assertion (not a type/compile error or unrelated test).
//   Do NOT "fix" test/index.test.ts here — that is S2's deliverable.

// CRITICAL GOTCHA #3 (remove BOTH the import AND the registration): deleting only the registration leaves a
//   dangling `import { makeCheckpointTool }` (line 10) — not a tsc error (no noUnusedLocals) but sloppy and a
//   reviewer flag. Delete line 10 AND line 49. Conversely, do NOT touch the auditTool or makeCancelTool
//   import/registration lines (those 4 tools stay).

// CRITICAL GOTCHA #4 (the line 44 comment block has 3 stale parts, not just the count): the current comment
//   says "all 5 agent-callable tools" + "rewind/shrink/checkpoint/cancel are FACTORIES" + "...setCheckpoint(pi, …)".
//   After removal: "all 4", factories are "rewind/shrink/cancel" (drop checkpoint), and "setCheckpoint(pi, …)"
//   is gone (that was checkpoint's pi need). Replace the WHOLE 3-line comment block (verbatim replacement
//   below) — don't surgically edit just the digit.

// CRITICAL GOTCHA #5 (coherence: "5th tool" ordinals on lines 13 + 51): the cancel import (line 13) and
//   cancel registration (line 51) comments say "5th agent-callable tool" / "5th tool". With checkpoint gone,
//   cancel is the 4th (last) registered tool. Leaving "4 agent-callable tools" (JSDoc) next to "5th tool"
//   (line 51) is an internal contradiction. Update both to "4th". (These are beyond the contract's 4 edits
//   but are required for doc coherence — the contract's DOCS clause "[Mode A] factory JSDoc … rides WITH the
//   work" covers it.)

// GOTCHA (the .js import extension): all index.ts imports use the `.js` extension (ESM/Bundler resolution).
//   The 4 REMAINING tool imports keep their `.js` extensions unchanged. Only the checkpoint import LINE is
//   deleted; no new import is added.

// OUT OF SCOPE (do NOT touch in this subtask):
//   - src/tools/checkpoint.ts → DO NOT DELETE (Phase 2 reuse + test consumers).
//   - test/* → ALL test fallout is S2 (test/index.test.ts registration assertion) or Phase-2 (smoke.ts,
//     edge-cases.test.ts, checkpoint.test.ts). S1 edits NO test.
//   - src/commands.ts, src/banner.ts → P2 (not yet built).
//   - spec/* → READ-ONLY (spec/05 §3 is the authority; it already says REMOVED).
//   - The rewind/shrink/audit/cancel tool files → their registrations STAY.
// This PRP edits ONLY src/index.ts.
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no data model. This is a registration/comment edit in the factory. The "model" is the agent-tool
inventory dropping from 5 to 4 (spec/03 §2.1; spec/05 §3)._

### Implementation Tasks (ordered by dependencies)

Six edits in one file; apply as text-anchored find/replacements. The two deletions (Tasks 1-2) and four
comment/count updates (Tasks 3-6) are independent — any order.

```yaml
Task 1: DELETE src/index.ts line 10 — the makeCheckpointTool import
  - FIND (verbatim): "import { makeCheckpointTool } from \"./tools/checkpoint.js\";\n"
  - ACTION: delete the entire line (and its trailing newline). After this, the tool imports are
    makeRewindTool / makeShrinkTool / auditTool / makeCancelTool (4).
  - DO NOT: delete any other import line. The 4 remaining tool imports + the config/settings/log/runtime/
    filter/nudges imports all stay.

Task 2: DELETE src/index.ts line 49 — the checkpoint registration
  - FIND (verbatim): "  pi.registerTool(makeCheckpointTool(pi));\n"
  - ACTION: delete the entire line. After this, exactly 4 pi.registerTool(...) calls remain:
    makeRewindTool(pi), makeShrinkTool(pi), auditTool, makeCancelTool(pi).
  - DO NOT: delete or reorder the other 4 registration lines.

Task 3: EDIT src/index.ts line 17 (JSDoc) — "5" → "4"
  - FIND (verbatim substring): "Wires all 5 agent-callable tools,"
  - REPLACE WITH: "Wires all 4 agent-callable tools,"
  - PRESERVE: the rest of the JSDoc line ("…the 3 event-driven handlers…") and the surrounding paragraph.

Task 4: EDIT src/index.ts line 44 (the registration comment block) — full coherent rewrite
  - FIND (verbatim — the 3-line comment):
      "  // 3. Register all 5 agent-callable tools. rewind/shrink/checkpoint/cancel are FACTORIES capturing `pi`\n  //    via closure (their execute() needs pi for appendXxxMarker(pi, …)/leaveNote(pi, …)/setCheckpoint(pi, …)\n  //    but execute() does NOT receive pi). auditTool is a PLAIN const (audit needs no pi)."
  - REPLACE WITH (coherent post-removal: 4 tools, rewind/shrink/cancel factories, no setCheckpoint, v1.1 note):
      "  // 3. Register all 4 agent-callable tools (spec/03 §2.1; v1.1: mulligan_checkpoint moved to a human\n  //    slash command — spec/05 §3). rewind/shrink/cancel are FACTORIES capturing `pi` via closure (their\n  //    execute() needs pi for appendXxxMarker(pi, …)/leaveNote(pi, …) but execute() does NOT receive pi).\n  //    auditTool is a PLAIN const (audit needs no pi)."
  - RATIONALE: 3 stale parts fixed in one block — count (5→4), factory list (drop checkpoint), pi-need list
    (drop setCheckpoint). Adds the v1.1 spec cite so a future reader knows why checkpoint is absent.

Task 5 (coherence): EDIT src/index.ts line 13 — cancel import comment "5th" → "4th"
  - FIND (verbatim): "import { makeCancelTool } from \"./tools/cancel.js\"; // 5th agent-callable tool (P3.M1.T3.S1)"
  - REPLACE WITH: "import { makeCancelTool } from \"./tools/cancel.js\"; // 4th agent-callable tool (P3.M1.T3.S1)"
  - RATIONALE: cancel is now the 4th (last) registered tool; "5th" contradicts "4 agent-callable tools".

Task 6 (coherence): EDIT src/index.ts line 51 — cancel registration comment "5th" → "4th"
  - FIND (verbatim): "  pi.registerTool(makeCancelTool(pi)); // 5th tool — marker retraction (P3.M1.T3.S1 / E21)"
  - REPLACE WITH: "  pi.registerTool(makeCancelTool(pi)); // 4th tool — marker retraction (P3.M1.T3.S1 / E21)"
  - RATIONALE: same — internal consistency (4 tools, cancel is 4th).
```

### Resulting index.ts registration block (post-edit, for reference)

```ts
import { makeRewindTool } from "./tools/rewind.js";
import { makeShrinkTool } from "./tools/shrink.js";
import { auditTool } from "./tools/audit.js";
import { makeCancelTool } from "./tools/cancel.js"; // 4th agent-callable tool (P3.M1.T3.S1)
// …
  // 3. Register all 4 agent-callable tools (spec/03 §2.1; v1.1: mulligan_checkpoint moved to a human
  //    slash command — spec/05 §3). rewind/shrink/cancel are FACTORIES capturing `pi` via closure (their
  //    execute() needs pi for appendXxxMarker(pi, …)/leaveNote(pi, …) but execute() does NOT receive pi).
  //    auditTool is a PLAIN const (audit needs no pi).
  pi.registerTool(makeRewindTool(pi));
  pi.registerTool(makeShrinkTool(pi));
  pi.registerTool(auditTool);
  pi.registerTool(makeCancelTool(pi)); // 4th tool — marker retraction (P3.M1.T3.S1 / E21)
```

### Implementation Patterns & Key Details

```ts
// PATTERN (text-anchored deletes/edits, NOT line numbers): lines 10 and 49 are deleted, which shifts every
//   later line number. Find by the verbatim import/registration/comment strings (each is unique in the file).
//   Do NOT use "line 49" as an anchor after Task 1 deletes line 10.

// PATTERN (factory vs const): makeRewindTool/makeShrinkTool/makeCancelTool are FACTORIES (capture pi);
//   auditTool is a PLAIN const. The registration block lists them in that order. Removing checkpoint (a
//   factory) leaves 3 factories + 1 const = 4 tools. The comment must reflect "rewind/shrink/cancel are
//   FACTORIES" (checkpoint dropped from the factory list).

// CRITICAL (the validation gate is NOT full-suite-green): S1's edit makes test/index.test.ts RED (it asserts
//   5 tools). That is the S2 handoff. The S1 gate = typecheck clean + grep (4 tools, 0 makeCheckpointTool) +
//   the isolated index.test.ts failure (proving the edit landed without breaking anything else). Do NOT run
//   `npm test` expecting green, and do NOT fix index.test.ts here.

// CRITICAL (checkpoint.ts is untouched): verify with `git diff --name-only` — ONLY src/index.ts appears.
//   checkpoint.ts remains exported + imported by tests; tsc stays clean (no noUnusedLocals).
```

### Integration Points

```yaml
NO INTEGRATION POINTS — single-file registration/comment edit.
  - DATABASE: none
  - CONFIG: none
  - ROUTES: none
  - CODE: only src/index.ts (imports -1 line; registration -1 line; 4 comment/count updates). The 4 remaining
          tool factories + auditTool const are unchanged. checkpoint.ts is UNCHANGED (Phase 2 reuses it).
  - TESTS: NONE edited by S1. The single test that turns RED (test/index.test.ts registration assertion) is
          S2's handoff (P1.M3.T1.S2). smoke.ts/edge-cases.test.ts import makeCheckpointTool directly and do
          NOT break from S1.
  - WIRING: the factory still does setConfig + setLogFile + 4 registerTool + 3 pi.on + lifecycle. Only the
            checkpoint registerTool is removed. No new pi.registerCommand (that is P2).
  - PARALLEL-SIBLING COORDINATION: P1.M2.T1.S3 (parallel) edits test/tokens.test.ts + test/turn_metric.test.ts
            + test/drift_nudge.test.ts (D10 tests) — zero overlap with src/index.ts.
```

---

## Validation Loop

A 6-line edit in one `.ts` file. Validation = typecheck clean + grep confirms the registration state + the
ISOLATED index.test.ts failure (the S2 handoff) — NOT full-suite-green (that requires S2).

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The checkpoint import + registration are GONE, and exactly 4 tools register:
grep -c 'makeCheckpointTool' src/index.ts        # EXPECT: 0.
grep -c 'pi.registerTool' src/index.ts           # EXPECT: 4.

# (b) The 4 registered tools are rewind/shrink/audit/cancel (no checkpoint):
grep -nE 'pi\.registerTool\(' src/index.ts
# EXPECT exactly 4 lines: makeRewindTool(pi), makeShrinkTool(pi), auditTool, makeCancelTool(pi).

# (c) The counts/comments are coherent:
grep -c 'all 5 agent-callable\|5th agent-callable\|5th tool' src/index.ts   # EXPECT: 0.
grep -c 'all 4 agent-callable\|4th agent-callable\|4th tool' src/index.ts   # EXPECT: ≥3 (JSDoc + 2 cancel comments).
grep -c 'setCheckpoint(pi' src/index.ts          # EXPECT: 0 (the stale checkpoint pi-need ref is gone).

# (d) checkpoint.ts is UNTOUCHED:
git diff --name-only | grep -E 'tools/checkpoint.ts' && echo "BUG: checkpoint.ts changed" || echo "checkpoint.ts untouched ✓"
```
Expected: (a) 0 + 4; (b) the 4 expected names; (c) 0 stale, ≥3 coherent, 0 setCheckpoint; (d) checkpoint.ts untouched.

### Level 2: Type check (the hard gate)

```bash
npm run typecheck        # = tsc --noEmit (strict + noImplicitAny; NO noUnusedLocals)
echo "typecheck exit: $?"
# EXPECT: exit 0. Removing the import + registration does NOT break types: makeCheckpointTool is still
#   exported from checkpoint.ts (which tests import directly); index.ts just stops importing/calling it.
#   checkpoint.ts's now-unregistered exports don't error (no noUnusedLocals). If tsc errors, READ it —
#   likely you accidentally deleted a different import/registration line (re-check the 4 remaining tools).
```
Expected: exit 0.

### Level 3: The ISOLATED test failure (the S2 handoff — proves the edit landed)

```bash
# This is EXPECTED to be RED — it's the S2 handoff, not an S1 defect.
npx vitest run test/index.test.ts
# EXPECT: RED on the registration-count assertion only:
#   - "registers all 5 tools with the exact names" FAILS (now 4 tools, not 5).
#   - expect(tools).toHaveLength(5) FAILS (length is 4).
#   - the sorted-name array assertion FAILS (no longer contains "mulligan_checkpoint").
# The ONLY failures should be these registration-count assertions — NOT a type/compile error or an unrelated
# test. If a NON-registration test fails, S1 accidentally broke something else (re-check the diff).
# DO NOT fix test/index.test.ts here — that is P1.M3.T1.S2's deliverable.

# Confirm the OTHER checkpoint-importing tests still COMPILE + run (they import makeCheckpointTool directly,
# NOT via index.ts, so S1's edit does not affect them):
npx vitest run test/edge-cases.test.ts 2>&1 | tail -3   # EXPECT: runs (green or its own pre-existing state);
                                                        # NOT a "cannot find module ./tools/checkpoint.js" error.
```
Expected: test/index.test.ts RED on the registration-count assertion (the S2 handoff); edge-cases.test.ts unaffected (it imports checkpoint directly).

### Level 4: Scope-discipline gate (no collateral edits)

```bash
git diff --stat           # EXPECT: src/index.ts ONLY.
git diff --name-only | grep -vE '^src/index.ts$' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# EXPECT: "scope OK". src/tools/checkpoint.ts, any other src/*, any test/*, spec/* must NOT appear.
#   (Parallel sibling P1.M2.T1.S3's test edits, if already applied, are its own diff — confirm YOUR hunks
#   are src/index.ts only via `git diff -- src/index.ts`.)
```
Expected: only `src/index.ts` in your diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep — 0 `makeCheckpointTool` in index.ts; 4 `pi.registerTool`; 0 stale "5"/"setCheckpoint" refs; ≥3 coherent "4" refs; checkpoint.ts untouched.
- [ ] Level 2: `npm run typecheck` → exit 0.
- [ ] Level 3: `npx vitest run test/index.test.ts` → RED **only** on the registration-count assertion (the S2 handoff); edge-cases.test.ts unaffected.
- [ ] Level 4: `git diff --name-only` shows ONLY `src/index.ts`.

### Feature Validation
- [ ] index.ts registers exactly 4 tools: mulligan_rewind, mulligan_shrink, mulligan_audit, mulligan_cancel.
- [ ] Zero `makeCheckpointTool` references in index.ts.
- [ ] JSDoc + comments consistently say "4 agent-callable tools" (no "5th"/"setCheckpoint"/"checkpoint" in the registration comment).
- [ ] `mulligan_rewind` is still registered (the agent retains rewind-to-checkpoint — only the *set* tool is removed).

### Code Quality / Scope Discipline
- [ ] Removed BOTH the import (line 10) AND the registration (line 49) — no dangling import.
- [ ] Did NOT delete `src/tools/checkpoint.ts` (Phase 2 reuse; tests import it directly).
- [ ] Did NOT touch any `test/*` (the index.test.ts fallout is S2; smoke.ts/edge-cases are Phase-2).
- [ ] Did NOT touch the rewind/shrink/audit/cancel tool files or their registrations.
- [ ] Did NOT touch spec/*, commands.ts, banner.ts (P2/READ-ONLY).
- [ ] Updated the line-44 comment block coherently (count + factory list + pi-need list), not just the digit.

### Documentation
- [ ] [Mode A] the factory JSDoc + registration comment now reflect the 4-tool inventory + the v1.1 spec cite
      (spec/05 §3 / spec/03 §2.1). No stale "5th"/"setCheckpoint" references remain.

---

## Anti-Patterns to Avoid

- ❌ Don't delete `src/tools/checkpoint.ts`. It is unregistered dead code after S1, but tests import its
  `makeCheckpointTool`/`validCheckpointName` directly and Phase 2 reuses `NAME_RE`. Deleting it breaks tests +
  forces a Phase-2 rebuild. Leave it 100% untouched. (GOTCHA #1.)
- ❌ Don't gate on `npm test` green. S1's edit makes `test/index.test.ts` RED (it asserts 5 tools) — that is the
  EXPECTED handoff to P1.M3.T1.S2. The S1 gate is typecheck clean + grep (4 tools) + the isolated index.test.ts
  failure. Do NOT "fix" index.test.ts here. (GOTCHA #2.)
- ❌ Don't delete only the registration and leave the `import { makeCheckpointTool }` dangling. Remove BOTH line
  10 and line 49. (GOTCHA #3.)
- ❌ Don't surgically edit just the "5"→"4" digit on line 44. That comment also says "rewind/shrink/checkpoint/cancel
  are FACTORIES" and lists "setCheckpoint(pi, …)" — both now stale. Replace the whole 3-line comment block. (GOTCHA #4.)
- ❌ Don't leave the "5th tool" ordinals on lines 13 + 51. "4 agent-callable tools" (JSDoc) + "5th tool" (line 51)
  is an internal contradiction. Update both to "4th". (GOTCHA #5.)
- ❌ Don't touch any test file — S2 owns test/index.test.ts; smoke.ts/edge-cases.test.ts/checkpoint.test.ts are
  Phase-2/S2 territory and import checkpoint directly (unaffected by S1).
- ❌ Don't add a `pi.registerCommand` for a checkpoint slash command — that is P2 (P2.M1.T1.S2), not built yet.
- ❌ Don't reorder or alter the 4 remaining tool registrations (rewind, shrink, audit, cancel) — only checkpoint is removed.
- ❌ Don't use line numbers as find anchors after deleting line 10 — line numbers shift. Use the verbatim strings.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a 6-edit change in one file with verbatim FIND/REPLACE
for every edit (imports, registration, JSDoc, comment block, two coherence ordinals), the authoritative edit
list confirmed in architecture/change_surface.md §Change 1, the spec authority (spec/05 §3 REMOVED, count 5→4),
and the critical DO-NOT-DELETE guard for checkpoint.ts (with the verified test consumers that keep it alive).
The one nuance — the full suite is RED until S2 lands — is explicitly framed (the S1 gate is typecheck + grep +
the isolated index.test.ts failure, NOT npm-test-green), so the implementer won't misread the expected test
failure as an S1 defect or over-reach into S2's test fix. Removing the import + registration is type-safe
(checkpoint.ts still exports; no noUnusedLocals). The two residual risks — accidentally deleting checkpoint.ts
or "fixing" index.test.ts — are both called out as DO-NOTs with git-diff gates. No dependency on the parallel
sibling (P1.M2.T1.S3 is test-only, disjoint files).