# PRP — P1.M1.T1.S1: `transforms.ts` `resolveLastTurn` — remove nuclear mode (`to_previous_prompt`)

---

## Goal

**Feature Goal**: Remove the "nuclear" `to_previous_prompt` mode from `resolveLastTurn` (src/transforms.ts) and finalize the v1.1 guardrail: **`last_turn` always keeps the latest user message — it never wipes user input** (spec/13 §1). The default behavior (keep `iLastUser`, remove everything after except the rewind's own unit + `mulligan:*` messages) becomes the ONLY behavior, enforced by construction. This is the first subtask in the `to_previous_prompt`-removal chain.

**Deliverable**: A modified `src/transforms.ts` where (1) `resolveLastTurn` signature is `(messages, excludeToolCallId?)` — `opts` dropped; (2) the `nuclear` variable, the iFirstUser refusal block, and the `if (nuclear) remove.push(iLastUser)` line are gone; (3) the JSDoc states the v1.1 guardrail; (4) `RewindMarkerLike.options.to_previous_prompt?` stays OPTIONAL (backward-compat reads of old persisted markers) with a "legacy v1.0 field; ignored" JSDoc; (5) the `filterPipeline` call site drops the `rw.options` arg.

**Success Definition**:
- `resolveLastTurn` has signature `(messages: MessageLike[], excludeToolCallId?: string): { remove: number[] }` — no `opts`, no nuclear branch.
- `iLastUser` is NEVER in the returned `remove` set (the guardrail, by construction).
- `grep -ni "nuclear" src/transforms.ts` → zero matches; `grep -n "to_previous_prompt" src/transforms.ts` → only the `RewindMarkerLike.options` legacy field + its updated JSDoc.
- `npx tsc --noEmit` → the ONLY new errors are in `src/tools/rewind.ts` (the 3-arg call site — S2) and the test files (S4); NO error originates in `src/transforms.ts`.

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers and the S2/S4 implementers; indirectly the agent (which can no longer wipe a user message via `last_turn`).

**Use Case**: A rewind hides only the agent's own output (tool calls, results, reasoning). The user's prompt is never discarded by a `last_turn` rewind — the only consented way to rewind across subsequent prompts is a human-set checkpoint (spec/13 §1).

**User Journey**: S1 removes the resolver's nuclear mode → S2 updates the rewind tool (stops passing `opts`, removes the BUG-006 dead code + the `to_previous_prompt` schema field) → S3 annotates markers.ts → S4 updates the 39 test occurrences. After the chain, `last_turn` keeps the user message by construction.

**Pain Points Addressed**: v1.0's `to_previous_prompt:true` discarded the latest user message — a footgun that could wipe the user's own ask. The v1.1 guardrail makes that impossible by construction (no opt-in path exists in the resolver).

## Why

- **Business value / user impact**: Major safety guardrail (spec/13 §1, REQUIRED). A rewind must never hide a `user` message except via a consented checkpoint. Removing the resolver's nuclear mode enforces this by construction — no runtime gate needed.
- **Integration with existing features**: `resolveLastTurn` is the `last_turn` resolver consumed by `filterPipeline` (transforms.ts:1491, updated in S1) and `src/tools/rewind.ts:444` (updated in S2). `RewindMarkerLike.options` (the internal filter shape) keeps `to_previous_prompt?` OPTIONAL so old persisted markers read harmlessly (the resolver ignores it). `protectedOk` (transforms.ts ~1230) already only enforces `first:user` — no change needed (Change 3 of the arch doc).
- **Problems this solves and for whom**: For users: their prompts can't be silently discarded by a `last_turn` rewind. For maintainers: removes the dual-mode (DEFAULT/NUCLEAR) resolver complexity and the BUG-006 dead-code refusal block (removed in S2).

## What

No user-visible behavior in S1 alone (the rewind tool still passes `opts` until S2). The source change: `resolveLastTurn` loses its `opts` param and nuclear branch; the guardrail is now "keep `iLastUser` always." The filterPipeline call site drops the `rw.options` read.

### Success Criteria

- [ ] `resolveLastTurn` signature is `(messages: MessageLike[], excludeToolCallId?: string): { remove: number[] }`.
- [ ] The `nuclear` const, the iFirstUser refusal block, and `if (nuclear) remove.push(iLastUser)` are REMOVED.
- [ ] `iLastUser` is never in `remove` (the loop starts at `iLastUser + 1`).
- [ ] The JSDoc removes all nuclear/`to_previous_prompt` language and states the v1.1 guardrail (verbatim from the contract).
- [ ] `RewindMarkerLike.options.to_previous_prompt?` stays OPTIONAL; its JSDoc says "legacy v1.0 field; ignored by the v1.1 resolver".
- [ ] The `filterPipeline` call site is `resolveLastTurn(m, excludeId).remove` (the `readOwn(rw, "options")` 2nd arg dropped).
- [ ] `grep -ni "nuclear" src/transforms.ts` → zero; `grep -n "to_previous_prompt" src/transforms.ts` → only the legacy `RewindMarkerLike.options` field + JSDoc.

## All Needed Context

### Context Completeness Check

_Before writing this PRP, validate: "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"_ — **YES.** This PRP contains the exact current `resolveLastTurn` body (with the 3 nuclear lines marked), the exact target body, the exact filterPipeline call-site rewrite, the RewindMarkerLike.options field, the JSDoc structure to rewrite, and — critically — tells the implementer the rewind.ts:444 + test breakage is EXPECTED and owned by S2/S4.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/transforms.ts
  why: "THE file. ALL S1 edits are here: resolveLastTurn signature (319-323) + body (324-379) + JSDoc (278-313); RewindMarkerLike.options JSDoc (~line 1122); filterPipeline call site (1491-1495)."
  pattern: "resolveLastToolCallGroup is the 2-param PRECEDENT — `resolveLastToolCallGroup(messages, excludeToolCallId?)` — the exact shape resolveLastTurn must adopt. The body's partitionIntoUnits + assistantIssuedCall + isMulliganCustomMessage helpers are UNCHANGED (they implement the keep-own-unit + keep-note logic that survives the nuclear removal)."
  gotcha: "Within transforms.ts there is exactly ONE internal caller of resolveLastTurn: filterPipeline (line 1491). S1 updates that call site (drop the rw.options arg). The ONLY other caller is src/tools/rewind.ts:444 — that is S2's scope (it will break with TS2554/TS2345 until S2). Do NOT fix rewind.ts in S1."

- file: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: "§Change 2 gives the VERIFIED exact line numbers (verified against the codebase). Confirms: the 3 nuclear removal points (332, 334-344, 373), the JSDoc range (286-318), RewindMarkerLike.options (1123), filterPipeline call (1491-1495). §Backward Compatibility confirms old markers' `options.to_previous_prompt` are read harmlessly (field stays optional; resolver ignores it) — NO migration."
  critical: "§Change 3 confirms the guardrail needs NO protectedOk change — `protectedOk` already only enforces `first:user` (verified transforms.ts:1230-1267). Once to_previous_prompt is gone, last_turn keeps the latest user message by construction. Do NOT touch protectedOk."

- file: src/tools/rewind.ts (READ-ONLY — do NOT edit in S1)
  why: "The OTHER caller. Line 444: `resolveLastTurn(messages, { to_previous_prompt: params.to_previous_prompt }, toolCallId)`. After S1 narrows the signature to 2 params, this has TS2554 (3 args, 2 expected) + TS2345 (object where string expected). EXPECTED — rewind.ts is S2 (P1.M1.T1.S2). S2 also removes the RewindParams.to_previous_prompt schema field (109-114), the BUG-006 refusal block (605-610), and stops emitting options.to_previous_prompt (618-629)."

- spec: spec/06-context-filter.md §4 (resolveLastTurn) + spec/13 §1 (the guardrail)
  why: "spec/06 §4 step 2 now reads 'KEEP the user message; remove all messages after iLastUser except...' (single behavior — the v1.0 step-3 nuclear branch is gone). spec/13 §1 is the guardrail principle the JSDoc must quote: 'last_turn always keeps the user message — it never wipes user input. To rewind across your own subsequent prompts, set a checkpoint first.'"
```

### Current Codebase tree (run `tree` in the root of the project) to get an overview of the codebase

```bash
src/
  transforms.ts   # ← MODIFY (S1): resolveLastTurn (signature+body+JSDoc), RewindMarkerLike.options JSDoc, filterPipeline call site
  tools/rewind.ts # ← S2 (NOT this subtask): the 3-arg resolveLastTurn call + schema + BUG-006 dead code
  markers.ts      # ← S3 (NOT this subtask): options.to_previous_prompt JSDoc annotation
test/
  transforms.test.ts, edge-cases.test.ts, tools/rewind.test.ts, integration/smoke.ts, markers.test.ts, tools/cancel.test.ts
                  # ← S4 (NOT this subtask): 39 to_previous_prompt occurrences
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. S1 MODIFIES exactly ONE source file:
src/transforms.ts   # resolveLastTurn signature+body, JSDoc, RewindMarkerLike.options JSDoc, filterPipeline call site
# All other files are S2 (rewind.ts) / S3 (markers.ts) / S4 (tests) — NOT touched here.
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (S1 is the SOURCE DOMINO — rewind.ts:444 + tests break, EXPECTED, owned by S2/S4).
//   resolveLastTurn's signature loses its 2nd param (opts) and nuclear branch. Two consumers still reference the
//   old shape:
//     - src/tools/rewind.ts:444  — `resolveLastTurn(messages, { to_previous_prompt: ... }, toolCallId)` → TS2554
//       (3 args, 2 expected) + TS2345 (object not string). Owned by S2 (P1.M1.T1.S2).
//     - test/* (39 occurrences across 6 files) — call resolveLastTurn with opts + assert nuclear behavior.
//       Owned by S4 (P1.M1.T1.S4).
//   S1's bar: src/transforms.ts compiles internally (the filterPipeline call site is updated IN S1 to 2 args);
//   the tsc errors are CONFINED to rewind.ts + the test files. Do NOT fix rewind.ts or tests in S1 (scope creep
//   across tracked task boundaries + merge-conflict risk with parallel S2/S4 work).

// CRITICAL GOTCHA #2 (RewindMarkerLike.options KEEPS to_previous_prompt — do NOT delete the field).
//   The internal filter shape RewindMarkerLike.options (transforms.ts:1123) keeps `to_previous_prompt?: boolean`
//   OPTIONAL so old persisted markers (v1.0, which emitted it) read harmlessly — the resolver now IGNORES it
//   (no code path reads opts anymore). Removing the field would make the filterPipeline's readOwn(rw,"options")
//   type-unsafe AND would reject old markers at the type level. KEEP the field; only update its JSDoc to "legacy
//   v1.0 field; ignored by the v1.1 resolver". (markers.ts:60 is the parallel persisted shape — that's S3.)

// CRITICAL GOTCHA #3 (the filterPipeline call site comment + the readOwn(rw,"options") cast are BOTH stale).
//   Line 1489 comment: "// CREATING/RESUME FIRE ONLY. options carries to_previous_prompt VERBATIM (GOTCHA #5)."
//   and the call `resolveLastTurn(m, readOwn(rw, "options") as { to_previous_prompt?: boolean } | undefined, excludeId).remove`.
//   Both the comment AND the readOwn cast must go — the new call is `resolveLastTurn(m, excludeId).remove`. Do
//   NOT leave the readOwn(rw,"options") cast dangling (it would be an unused expression / dead read). Update the
//   comment to note last_turn no longer reads options (the resolver keeps the user message by construction).

// CRITICAL GOTCHA #4 (the body's loop start is the guardrail — do NOT change it).
//   After removing `if (nuclear) remove.push(iLastUser)`, the only push loop is `for (j = iLastUser + 1; ...)`.
//   iLastUser is NEVER pushed → it is never in `remove` → the guardrail holds by construction. Do NOT "tidy" by
//   changing the loop bound or adding iLastUser anywhere. The guardrail is exactly "the loop starts at iLastUser+1".

// CRITICAL GOTCHA #5 (iFirstUser computation is now dead — remove the whole block, not just the inner check).
//   The nuclear refusal block (lines 334-344) computes iFirstUser ONLY for the nuclear check. Once nuclear is
//   gone, iFirstUser is unused. Remove the ENTIRE block (the iFirstUser scan loop + the `if (iFirstUser ===
//   iLastUser) return { remove: [] }` guard), not just the inner `if`. Do NOT keep a dangling iFirstUser var.
//   (Note: protectedOk computes its OWN iFirstUser independently at ~line 1230 — that is UNCHANGED, separate.)

// CRITICAL GOTCHA #6 (resolveLastToolCallGroup is the 2-param precedent — match its shape exactly).
//   The sibling resolver `resolveLastToolCallGroup(messages, excludeToolCallId?)` is the exact shape to adopt:
//   `(messages: MessageLike[], excludeToolCallId?: string): { remove: number[] }`. Same return type, same param
//   order. Do NOT invent a different param order or return shape.
```

## Implementation Blueprint

### Data models and structure

**No data-model changes.** `MessageLike`, `RewindMarkerLike`, the marker envelope — all untouched. `RewindMarkerLike.options.to_previous_prompt?` stays OPTIONAL (legacy). The only structural change is `resolveLastTurn`'s parameter list (−1 param) + the removal of the nuclear branch.

```typescript
// TARGET signature (matches resolveLastToolCallGroup's shape — GOTCHA #6):
export function resolveLastTurn(
  messages: MessageLike[],
  excludeToolCallId?: string,
): { remove: number[] }
// `opts` is GONE. The default behavior is now the ONLY behavior.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT resolveLastTurn signature + body (transforms.ts 319-379) — remove nuclear mode
  - (a) SIGNATURE (319-323). CURRENT:
      export function resolveLastTurn(
        messages: MessageLike[],
        opts: { to_previous_prompt?: boolean } | undefined,
        excludeToolCallId?: string,
      ): { remove: number[] } {
    TARGET (drop opts; excludeToolCallId becomes the 2nd param):
      export function resolveLastTurn(
        messages: MessageLike[],
        excludeToolCallId?: string,
      ): { remove: number[] } {
  - (b) REMOVE line 332: `const nuclear = opts !== undefined && opts.to_previous_prompt === true;`
  - (c) REMOVE the nuclear refusal block (334-344): the `if (nuclear) { ... iFirstUser scan ... if (iFirstUser ===
        iLastUser) return { remove: [] }; }` block IN ENTIRETY (GOTCHA #5 — remove the whole block, incl. the
        iFirstUser scan loop; do not leave a dangling iFirstUser var).
  - (d) REMOVE line 373: `if (nuclear) remove.push(iLastUser);` (GOTCHA #4 — the loop start at iLastUser+1 is the guard).
  - PRESERVE unchanged: the non-array guard, the iLastUser scan + the `if (iLastUser === -1) return { remove: [] }`,
    the rewindOwnIndices/partitionIntoUnits/assistantIssuedCall block (keep-own-unit logic), the `for (j = iLastUser+1; …)`
    removal loop (with the rewindOwnIndices.has + isMulliganCustomMessage skips), and the `return { remove }`.
  - VERIFY the resulting body: iLastUser is never pushed → never in `remove` → guardrail holds by construction.
  - DEPENDENCIES: none.

Task 2: REWRITE the resolveLastTurn JSDoc (transforms.ts 278-313) — remove nuclear language, state the guardrail
  - The current JSDoc has: a summary; ALGORITHM steps 1–3 (step 2 "DEFAULT (opts.to_previous_prompt !== true)",
    step 3 "NUCLEAR (opts.to_previous_prompt === true) ... REFUSED ... iFirstUser === iLastUser"); a PAIRING para;
    a RETURNS para mentioning `rw.options` carries `to_previous_prompt`; pure/defensive notes; @param messages/
    opts/excludeToolCallId.
  - EDITS:
      * ALGORITHM header "steps 1–3" → "v1.1" (no 3-step nuclear branch).
      * Step 2 "DEFAULT (opts.to_previous_prompt !== true)": rewrite as the SINGLE behavior — "KEEP the user
        message; remove every message AFTER iLastUser EXCEPT (a) the rewind's OWN unit ... and (b) mulligan:*
        custom messages at the tail ...". Drop the "DEFAULT" label.
      * Step 3 NUCLEAR paragraph: REMOVE entirely.
      * ADD a v1.1 GUARDRAIL sentence (verbatim from the contract): "last_turn always keeps the user message —
        it never wipes user input. To rewind across your own subsequent prompts, set a checkpoint first (spec/13 §1)."
      * RETURNS para: drop the "`rw.options` carries `to_previous_prompt`" sentence; the consumer is now
        `resolveLastTurn(m, excludeId).remove` (spec/06 §12). Remove the "NOT spec/06 §4's toPreviousPrompt"
        D1 note (no longer relevant).
      * @param: REMOVE `@param opts`. Keep `@param messages` and `@param excludeToolCallId`.
      * KEEP the PAIRING paragraph and the pure/defensive notes (still accurate; just drop the "malformed `opts`"
        phrase from the defensive sentence).
  - DEPENDENCIES: Task 1.

Task 3: UPDATE RewindMarkerLike.options JSDoc (transforms.ts ~line 1122) — legacy annotation
  - CURRENT (line 1122): `/** last_turn only — nuclear mode (also discard the most recent user message). Default false. */`
  - TARGET: `/** Legacy v1.0 field; ignored by the v1.1 resolver (last_turn always keeps the latest user message
      by construction). Kept optional for backward-compat reads of old persisted markers. */`
  - KEEP the field `options?: { to_previous_prompt?: boolean };` UNCHANGED (GOTCHA #2 — do NOT delete it; old
    markers carry it and readOwn(rw,"options") must stay type-valid).
  - DEPENDENCIES: none.

Task 4: UPDATE the filterPipeline call site (transforms.ts 1489-1495)
  - CURRENT:
      // CREATING/RESUME FIRE ONLY. options carries to_previous_prompt VERBATIM (GOTCHA #5).
      remove = resolveLastTurn(
        m,
        readOwn(rw, "options") as { to_previous_prompt?: boolean } | undefined,
        excludeId,
      ).remove;
    TARGET:
      // CREATING/RESUME FIRE ONLY. last_turn no longer reads options — the resolver keeps the latest user
      // message by construction (v1.1 guardrail, spec/13 §1).
      remove = resolveLastTurn(m, excludeId).remove;
  - REMOVE the `readOwn(rw, "options") as {...}` 2nd arg ENTIRELY (GOTCHA #3 — do not leave it dangling).
  - DEPENDENCIES: Task 1 (the 2-param signature must be in place for this call to typecheck).

Task 5: VERIFY (no new code)
  - GREP: `grep -ni "nuclear" src/transforms.ts` → ZERO matches (const, refusal block, push line, and all JSDoc
    "NUCLEAR" language gone).
  - GREP: `grep -n "to_previous_prompt" src/transforms.ts` → ONLY the `RewindMarkerLike.options` field (~1123) +
    its updated "legacy" JSDoc. The opts param, the `const nuclear` read, the filterPipeline `readOwn(rw,"options")`
    cast, and the JSDoc nuclear language must ALL be gone.
  - RUN `npx tsc --noEmit` → EXPECTED errors in `src/tools/rewind.ts:444` (TS2554 + TS2345 — S2) and the test
    files (S4). Confirm NO error cites `src/transforms.ts` (it is internally consistent: resolveLastTurn 2-param
    + filterPipeline calls it with 2 args).
  - DO NOT run the full `npx vitest run` expecting green — test/transforms.test.ts (13 nuclear cases) + the other
    5 test files (S4) will fail. Those are owned by S4. (transforms.ts itself is the gate, not the test suite.)
  - DEPENDENCIES: Tasks 1-4.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 1): the post-removal body — iLastUser is never pushed (the guardrail, by construction).
export function resolveLastTurn(messages: MessageLike[], excludeToolCallId?: string): { remove: number[] } {
  if (!Array.isArray(messages)) return { remove: [] };
  let iLastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") iLastUser = i;
  }
  if (iLastUser === -1) return { remove: [] };
  // (nuclear block + iFirstUser scan — REMOVED)
  const rewindOwnIndices = new Set<number>();
  const hasExclude = typeof excludeToolCallId === "string" && excludeToolCallId.length > 0;
  if (hasExclude) {
    const units = partitionIntoUnits(messages);
    for (const unit of units) {
      if (unit.kind === "toolGroup" && assistantIssuedCall(messages, unit.indices, excludeToolCallId)) {
        for (const idx of unit.indices) rewindOwnIndices.add(idx);
      }
    }
  }
  const remove: number[] = [];
  // (if (nuclear) remove.push(iLastUser); — REMOVED. Loop starts at iLastUser+1 → iLastUser never in remove.)
  for (let j = iLastUser + 1; j < messages.length; j++) {
    if (rewindOwnIndices.has(j)) continue;
    if (isMulliganCustomMessage(messages[j])) continue;
    remove.push(j);
  }
  return { remove };
}

// CRITICAL walk-through (the guardrail): for messages [u0, a, r, u1, a, r], iLastUser=3 (u1).
//   remove = [4, 5] (the a, r after u1) — u1 (index 3) is NEVER pushed. The model resumes at u1's prompt. ✓
//   (Under v1.0 nuclear, u1 would also be pushed — that path is gone.)

// PATTERN (Task 4): the filterPipeline call drops the options read entirely.
//   OLD: resolveLastTurn(m, readOwn(rw,"options") as {to_previous_prompt?:boolean}|undefined, excludeId).remove
//   NEW: resolveLastTurn(m, excludeId).remove
//   `readOwn(rw,"options")` is no longer read anywhere in the last_turn path — the legacy field survives only on
//   the RewindMarkerLike type for backward-compat reads of old markers (Task 3).
```

### Integration Points

```yaml
CODE:
  - modify: src/transforms.ts ONLY — resolveLastTurn (signature+body), JSDoc, RewindMarkerLike.options JSDoc, filterPipeline call site
  - untouched: protectedOk (~line 1230, already only enforces first:user — Change 3), partitionIntoUnits/assistantIssuedCall/isMulliganCustomMessage, all other resolvers
DOWNSTREAM (later subtasks — NOT this one):
  - S2 (P1.M1.T1.S2): src/tools/rewind.ts — resolveLastTurn call (444) → 2-arg; remove RewindParams.to_previous_prompt schema (109-114); remove BUG-006 refusal block (605-610); stop emitting options.to_previous_prompt (618-629)
  - S3 (P1.M1.T1.S3): src/markers.ts:60 — options.to_previous_prompt JSDoc "legacy v1.0 field; ignored"
  - S4 (P1.M1.T1.S4): 6 test files, 39 occurrences — remove nuclear cases, update resolveLastTurn calls, strengthen guardrail assertions
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none. No config knob, no persistence migration (old markers' options.to_previous_prompt read harmlessly — GOTCHA #2), no registration.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Cheapest gates — confirm nuclear is fully gone + to_previous_prompt survives only as the legacy field:
grep -ni "nuclear" src/transforms.ts             # EXPECTED: zero matches
grep -n "to_previous_prompt" src/transforms.ts   # EXPECTED: only the RewindMarkerLike.options field (~1123) + its "legacy" JSDoc

# Typecheck — EXPECTED downstream errors, NOT a clean run:
npx tsc --noEmit
# EXPECTED: src/tools/rewind.ts:444 — TS2554 (3 args, 2 expected) + TS2345 (object not assignable to string|undefined).
#   Plus test/* errors (resolveLastTurn calls with opts). All owned by S2/S4.
# YOUR bar: NO error cites `src/transforms.ts`. transforms.ts is internally consistent (resolveLastTurn 2-param
#   + filterPipeline calls it with 2 args). If transforms.ts appears in an error, you left a dangling nuclear
#   reference or an internal inconsistency — fix YOUR file. Do NOT "fix" rewind.ts:444 (it's S2).
```

### Level 2: Unit Tests (Component Validation)

```bash
# N/A as a GREEN gate for S1: test/transforms.test.ts has 13 nuclear/to_previous_prompt cases that call
# resolveLastTurn with opts and assert nuclear behavior — they WILL fail (type + behavior) until S4.
# Those failures are EXPECTED and owned by S4 (P1.M1.T1.S4).
#
# You MAY run it as a sanity check to confirm the failures are exactly the nuclear/opt-related ones (no surprise
# failures in the default-behavior resolveLastTurn tests — those should still PASS, since the default behavior is
# unchanged):
npx vitest run test/transforms.test.ts
# EXPECTED: the DEFAULT-behavior resolveLastTurn tests pass (keep-user-message logic unchanged); the nuclear/opt
#   tests fail. If a DEFAULT-behavior test fails, that's an S1 bug (you altered the keep-own-unit/keep-note logic)
#   — investigate. Do NOT update the tests in S1 (that's S4).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for S1: the end-to-end "last_turn keeps the user message" path goes through rewind.ts:444, which S2 hasn't
# updated yet. That validation belongs to S2/S4 (after the rewind tool stops passing opts).
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Guardrail invariant check (optional — proves iLastUser is never in remove after the edit):
#   npx tsx -e "import {resolveLastTurn} from './src/transforms.js'; const m=[{role:'user',content:'u0'},{role:'assistant',content:'a'},{role:'user',content:'u1'},{role:'assistant',content:'a2'}]; const r=resolveLastTurn(m as any, undefined); console.log(r.remove, 'iLastUser=2 not in remove:', !r.remove.includes(2));"
#   → "[3] iLastUser=2 not in remove: true"  (removes only index 3, the assistant after u1; u1 stays). ✓
# (The default-behavior transforms.test.ts cases cover this programmatically; this is a manual confirmation.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `grep -ni "nuclear" src/transforms.ts` → zero matches.
- [ ] `grep -n "to_previous_prompt" src/transforms.ts` → only the `RewindMarkerLike.options` legacy field + JSDoc.
- [ ] `npx tsc --noEmit` → errors ONLY in `src/tools/rewind.ts` + test files (S2/S4); no error cites `src/transforms.ts`.

### Feature Validation

- [ ] `resolveLastTurn` signature is `(messages, excludeToolCallId?): { remove: number[] }`.
- [ ] `iLastUser` is never in `remove` (the loop starts at `iLastUser + 1`).
- [ ] The nuclear const, the iFirstUser refusal block, and `if (nuclear) remove.push(iLastUser)` are all gone.
- [ ] The JSDoc states the v1.1 guardrail verbatim and has no nuclear/`to_previous_prompt` language; `@param opts` removed.
- [ ] `RewindMarkerLike.options.to_previous_prompt?` stays OPTIONAL with the "legacy v1.0 field; ignored" JSDoc.
- [ ] The filterPipeline call is `resolveLastTurn(m, excludeId).remove` (the `readOwn(rw,"options")` cast + GOTCHA #5 comment gone).

### Code Quality Validation

- [ ] Only `src/transforms.ts` is modified — NO edits to rewind.ts, markers.ts, protectedOk, or any test file (GOTCHA #1).
- [ ] The new signature matches `resolveLastToolCallGroup`'s 2-param shape exactly (GOTCHA #6).
- [ ] The keep-own-unit (partitionIntoUnits/assistantIssuedCall) + keep-note (isMulliganCustomMessage) logic is UNCHANGED.

### Documentation & Deployment

- [ ] JSDoc updated (Mode A — rides with the code): resolveLastTurn states the v1.1 guardrail; RewindMarkerLike.options marked legacy.
- [ ] No README/spec change in S1 (README sweep is P3.M1.T1; spec files are the source of truth, already v1.1).

---

## Anti-Patterns to Avoid

- ❌ Don't "fix" `src/tools/rewind.ts:444` or any test file — those are S2 (rewind.ts) and S4 (tests). The expected TS2554/TS2345 + test failures are owned downstream. S1 is the source domino (GOTCHA #1).
- ❌ Don't delete `RewindMarkerLike.options.to_previous_prompt` — it stays OPTIONAL so old persisted markers (v1.0) read harmlessly and `readOwn(rw,"options")` stays type-valid. Only the JSDoc changes to "legacy" (GOTCHA #2). The parallel markers.ts:60 field is S3.
- ❌ Don't leave the `readOwn(rw, "options") as {...}` cast in the filterPipeline call site — it's a dead read after the signature narrows. Drop the whole 2nd arg; the call becomes `resolveLastTurn(m, excludeId).remove` (GOTCHA #3). Update the stale GOTCHA #5 comment too.
- ❌ Don't keep a dangling `iFirstUser` variable — the nuclear refusal block computed it ONLY for the nuclear check. Remove the ENTIRE block (scan loop + guard), not just the inner `if` (GOTCHA #5). `protectedOk` computes its own iFirstUser independently (~line 1230) — leave that alone.
- ❌ Don't change the removal loop's start bound — `for (j = iLastUser + 1; …)` IS the guardrail (iLastUser never pushed). "Tidying" it risks re-introducing the wipe (GOTCHA #4).
- ❌ Don't touch `protectedOk` — the arch doc (Change 3) confirms it already only enforces `first:user`; once `to_previous_prompt` is gone, `last_turn` keeps the latest user message by construction. No `protectedOk` change is needed or wanted.
- ❌ Don't invent a different param order or return shape — match `resolveLastToolCallGroup(messages, excludeToolCallId?)` exactly (GOTCHA #6). Consistency between the two resolvers is the point.
- ❌ Don't expect a green `npx vitest run` or clean `tsc` after S1 alone — the rewind.ts:444 call site + 39 test occurrences are S2/S4. S1's gates are the two greps + tsc showing no error originating in transforms.ts (GOTCHA #1).