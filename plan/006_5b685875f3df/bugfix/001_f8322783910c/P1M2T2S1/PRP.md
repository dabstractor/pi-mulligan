# PRP — P1.M2.T2.S1: Make `countRetriesAtLatestPrompt` cancel-aware (subtract cancelled rewinds) — BUG-005

## Goal

**Feature Goal**: Close the BUG-005 gap in the E22 per-prompt retry-budget counter
(`countRetriesAtLatestPrompt`, `src/tools/rewind.ts:247-281`). Today it counts EVERY `mulligan:rewind` custom
entry after the latest user prompt, with no exclusion for rewinds later retired by a `mulligan:cancel`. A
cancelled rewind never took effect (`readMarkers` drops it before the filter sees it → it did not re-land at
the prompt), yet it still consumes budget — so cancel/rewind cycles can hit `maxRetriesPerPrompt` prematurely
and refuse a legitimate rewind. Fix: before counting, scan the same post-prompt slice for `mulligan:cancel`
entries, collect their `data.targetId` into a Set, and SKIP any rewind whose `data.id` is in that Set.

**Deliverable**: Edits to **two files**:
1. `src/tools/rewind.ts` — modify `countRetriesAtLatestPrompt` (add a cancel-id collection pass + make the
   rewind-counting loop cancel-aware) and update its JSDoc (Mode A inline docs).
2. `test/tools/rewind.test.ts` — ONE regression `it(...)` proving a cancelled rewind is excluded from the
   budget (the canonical BUG-005 repro: `user, rewind(id=rw1), cancel(targetId=rw1), rewind(id=rw2)` → budget
   sees 1, not 2).

**Success Definition**: After the edit, `countRetriesAtLatestPrompt` returns the count of **ACTIVE**
(non-cancelled) `mulligan:rewind` entries after the latest user prompt. A rewind whose `data.id ∈ <cancel
targetIds>` is excluded; a rewind with an unreadable `data.id` is still counted (defensive — never exclude on
bad data). It never throws (E13). The new regression test PASSES (it would FAIL before the fix). **All existing
retry-budget tests still pass unchanged** (they use id-less rewinds via `rewindEntry(seq)` → still counted →
still refuse at budget — backward-compatible). `npm run typecheck` exits 0.

## User Persona

**Target User**: pi-mulligan maintainers; indirectly any agent using `mulligan_rewind` + `mulligan_cancel` together.

**Use Case**: An agent rewinds to the wrong target, cancels it (`mulligan_cancel`), and rewinds again to the
correct target — two marker writes for ONE effective rewind.

**Pain Points Addressed**: Today that cycle burns 2 budget slots for 1 effective rewind; repeated cycles hit
`maxRetriesPerPrompt` (default 5) and refuse a legitimate rewind. After the fix, the cancelled rewind is
excluded, so the budget reflects only rewinds that actually took effect.

## Why

- **Spec fidelity (E22)**: spec/08 E22 defines a retry as "every `last_turn`/`to_previous_prompt`, plus a
  `last_tool_call_group`/`checkpoint` rewind whose resolved target is at/after that user message" — i.e.
  rewinds that actually re-land at the prompt. A cancelled rewind never re-lands (it is dropped before the
  filter sees it), so counting it diverges from the spec's intent. BUG-005 (Minor).
- **Consistency with the filter**: `readMarkers` (src/filter.ts:120-204) already builds a `cancelledIds` Set
  from `mulligan:cancel` entries and drops retired markers. The retry counter must use the SAME uuid-by-
  targetId mechanism so "active rewind" means the same thing in both places.
- **PRD §2.5 recommends exactly this**: "have countRetriesAtLatestPrompt subtract rewinds whose data.id is
  targeted by a later mulligan:cancel on the branch."
- **Small, safe, well-contained**: one module-local function (no signature change), defensive (never throws),
  backward-compatible (id-less rewinds still counted → existing tests green).

## What

A two-pass rewrite of `countRetriesAtLatestPrompt`'s counting section (the user-prompt lookup is unchanged),
plus a JSDoc update, plus one regression test.

### Success Criteria

- [ ] `countRetriesAtLatestPrompt` scans entries after `latestPromptIndex` for `mulligan:cancel` entries and
      collects their `data.targetId` (non-empty strings) into a `cancelledRewindIds` Set.
- [ ] The rewind-counting loop reads each rewind's `data.id`; if it is a string AND in `cancelledRewindIds`,
      the rewind is SKIPPED (not counted); otherwise it is counted.
- [ ] A rewind with an unreadable / non-string `data.id` is COUNTED (defensive — never exclude on bad data).
- [ ] The function still never throws (E13) and still returns `number`.
- [ ] The JSDoc documents the cancel-exclusion + the defensive polarity, and cross-references `readMarkers`'
      `cancelledIds` (src/filter.ts).
- [ ] The new regression test (BUG-005 repro) PASSES; it would FAIL before the fix.
- [ ] All existing retry-budget tests (id-less rewinds) still pass unchanged.
- [ ] `npm run typecheck` passes; `npx vitest run test/tools/rewind.test.ts` is fully green.
- [ ] No file other than `src/tools/rewind.ts` and `test/tools/rewind.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the **verbatim current function body** (FIND target), the **verbatim replacement**
(REPLACE target), the **verbatim current JSDoc** + its replacement, the exact cancel-aware pattern to mirror
(`readMarkers`' `cancelledIds`), the entry shapes (`data.id` / `data.targetId`), the verbatim test-harness
API (`makeCtx`/`makePi`/`run`/`rewindEntry`/`msgEntry`/`firstText`), the canonical BUG-005 repro scenario,
and deterministic typecheck + vitest validation gates. The implementer needs no codebase exploration beyond
opening `src/tools/rewind.ts` (lines ~232-281) and `test/tools/rewind.test.ts` (the retry-budget block ~1006-1140).

### Documentation & References

```yaml
# MUST EDIT — the function + its JSDoc (the only production-code change)
- file: src/tools/rewind.ts
  why: countRetriesAtLatestPrompt (lines ~232-281) is the function being made cancel-aware. Its JSDoc (lines
        ~232-246) gets a cancel-exclusion note (Mode A).
  section: "function countRetriesAtLatestPrompt(ctx: ExtensionContext): number (line ~247). JSDoc lines ~232-246.
            Call site at line ~509 (UNCHANGED — no signature change)."
  pattern: "per-entry try/catch with a direct cast `e as { type?: unknown; ... }` (the function's OWN defensive
            style — NOT readOwn/isRecord, which live in filter.ts). Mirror it exactly when reading data.id /
            data.targetId."
  gotcha: "Defensive polarity = KEEP/COUNT on bad data. A rewind with an unreadable data.id is COUNTED (do NOT
           exclude unless data.id is a string AND in the cancel set). This preserves backward compat with the
           existing tests (id-less rewinds via rewindEntry(seq) → still counted → still refuse at budget)."

# MUST READ — the cancel-aware pattern to mirror (readMarkers builds cancelledIds the same way)
- file: src/filter.ts
  why: readMarkers (lines ~120-204) already builds cancelledIds from mulligan:cancel entries (readOwn(data,
        "targetId"); if non-empty string → add) and drops markers whose data.id ∈ cancelledIds. The retry
        counter must use the SAME uuid-by-targetId mechanism so "active" means the same thing.
  section: "readMarkers cancelledIds collection (~line 180-190) + the activeRewinds/activeShrinks filter
            (~line 196-205). READ-ONLY — do NOT edit filter.ts."
  critical: "readMarkers uses readOwn/isRecord; countRetriesAtLatestPrompt uses try/catch + direct cast. Replicate
             the LOGIC (uuid-by-targetId), not filter.ts's helper layer. Defensive rule is identical: an
             unreadable id → marker is KEPT (here: rewind is COUNTED)."

# MUST READ — the test harness (for the regression test)
- file: test/tools/rewind.test.ts
  why: The retry-budget test block (lines ~1006-1140) is the pattern to follow and the place to ADD the new
        regression test. Documents makeCtx/makePi/run/rewindEntry/msgEntry/firstText and the assertion style.
  section: "describe(\"mulligan_rewind — retry budget: per-prompt cap ...\", ...) at line ~1030; helpers
            rewindEntry(seq) at line ~207 (data:{seq} — NO id), msgEntry/user at the top of the file."
  pattern: "PRE-SEED a static entries array via makeCtx({ entries: [...] }); call run(pi, ctx, {note, granularity});
            assert on firstText(res) + appended.length. Add the new it(...) INSIDE the existing retry-budget
            describe (or a sibling describe) — do NOT modify existing tests."
  gotcha: "rewindEntry(seq) yields data:{seq} with NO data.id. For the BUG-005 repro you need rewinds WITH
           data.id and a cancel WITH data.targetId — add small local helpers (rewindEntryWithId /
           cancelEntry) or inline the object literals. Keep the shape minimal: {type:'custom',
           customType:'mulligan:rewind', data:{seq,id,kind:'rewind'}} and {type:'custom',
           customType:'mulligan:cancel', data:{kind:'cancel',targetId}}."

# CONTEXT — the PRD/contract for BUG-005
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/architecture/system_context.md
  why: §BUG-005 states the defect + the recommended fix ("subtract rewinds whose data.id is targeted by a
        later mulligan:cancel"). Confirms the entry shapes (mulligan:cancel.data.targetId === cancelled
        marker's data.id).
  critical: "A cancelled rewind never took effect (readMarkers drops it) → it did not re-land at the prompt →
             it must NOT consume budget."

# CONTEXT — the spec for the retry-budget semantics
- file: spec/08-edge-cases.md
  why: E22 defines the per-prompt retry budget (a–g): a retry is a rewind that re-lands at the latest user
        message. E13 = tools/guards never throw. READ-ONLY — do NOT edit spec/*.
  section: "E22 (same-prompt rewind retry loop) + E13 (tool throws internally → never throw / never block)."

# CONTEXT — the parallel sibling (no file conflict)
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M2T1S1/PRP.md
  why: CONTRACT. P1.M2.T1.S1 edits src/nudges.ts (turnEndMetricHandler block reorder) + test/turn_metric.test.ts
        ONLY. No overlap with src/tools/rewind.ts or test/tools/rewind.test.ts.
```

### Current Codebase tree (the only relevant slice)

```bash
src/tools/
└── rewind.ts          # ← EDIT countRetriesAtLatestPrompt (lines ~247-281) + its JSDoc (lines ~232-246); call site ~509 UNCHANGED
src/
└── filter.ts          # READ-ONLY — readMarkers cancelledIds (the mirrored cancel-aware pattern; lines ~120-204)
test/tools/
└── rewind.test.ts     # ← ADD one regression it(...) (BUG-005 repro); retry-budget block ~1006-1140; rewindEntry helper ~207
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL — mirror the function's OWN defensive style, NOT filter.ts's helper layer:
#   countRetriesAtLatestPrompt uses per-entry try/catch + a direct cast `e as { type?: unknown; ... }`.
#   (filter.ts's readMarkers uses readOwn/isRecord — a different layer. Replicate the LOGIC, not the helpers.)
#   Read data.id and data.targetId INSIDE the same try/catch (Proxy-trap-safe).

# CRITICAL — defensive polarity = COUNT on bad data (the conservative/safe direction for a retry budget):
#   SKIP a rewind ONLY IF data.id is a string AND data.id ∈ cancelledRewindIds.
#   A rewind with an unreadable / non-string / missing data.id → COUNT it (never exclude on bad data).
#   This MATCHES readMarkers' "keep on bad id" (there "keep" = active; here "keep" = counted).
#   This guarantees backward compat: existing tests use rewindEntry(seq) (data:{seq}, NO id) → still counted
#   → still refuse at budget (3/3). No existing test changes behavior.

# CRITICAL — two passes over the SAME post-prompt slice (latestPromptIndex+1 .. end):
#   (1) build cancelledRewindIds from ALL mulligan:cancel entries (read data.targetId; non-empty string → add).
#   (2) count mulligan:rewind entries, skipping any whose data.id ∈ cancelledRewindIds.
#   Order-independent (full cancel scan first, then count) — correct because a cancel can appear AFTER the
#   rewind it retires (a single forward pass would miss that).

# CRITICAL — never throw (E13): keep the outer getEntries try/catch (→ 0) and the per-entry try/catch
#   (→ skip entry). The cancel-id pass ALSO needs per-entry try/catch (a throwing-Proxy entry in either loop
#   is skipped, never thrown).

# GOTCHA — entry shapes:
#   mulligan:rewind entry → entry.data.id   (the rewind uuid; stamped by markers.ts appendRewindMarker)
#   mulligan:cancel entry → entry.data.targetId  (=== the retired marker's data.id; stamped by cancel.ts)
#   Both are `type:"custom"` but distinct customType, so cancel entries are never miscounted as rewinds.

# OUT OF SCOPE (do NOT touch in this subtask):
#   - src/filter.ts                -> readMarkers (the referenced cancel-aware pattern; NOT edited here).
#   - src/markers.ts               -> marker stamping (entry-shape source; not edited).
#   - src/nudges.ts + test/turn_metric.test.ts -> owned by parallel sibling P1.M2.T1.S1.
#   - src/tools/cancel.ts, checkpoint.ts, etc. -> other BUG-006/007 siblings.
#   - The call site at rewind.ts:508-509 (no signature change; retries is still a number).
#   - Any OTHER function/JSDoc in rewind.ts (only countRetriesAtLatestPrompt + its JSDoc).
#   - Existing retry-budget tests (a)-(f) — ADD a new it(...); do NOT modify existing assertions.
#   - spec/* (READ-ONLY reference: spec/08 E22 retry semantics, E13 never-throw).
# This PRP edits ONLY src/tools/rewind.ts (countRetriesAtLatestPrompt + JSDoc) + test/tools/rewind.test.ts.
```

---

## Implementation Blueprint

### Data models and structure
_N/A — no new types. The function signature is unchanged: `(ctx: ExtensionContext): number`. The only new
local is a `const cancelledRewindIds = new Set<string>();`._

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/rewind.ts — make countRetriesAtLatestPrompt cancel-aware (lines ~260-281, the counting section)
  - FIND (verbatim current — the block AFTER the `if (latestPromptIndex === -1) return 0;` line; the
          user-prompt lookup loop ABOVE it is UNCHANGED and must NOT be touched):
      "  if (latestPromptIndex === -1) return 0; // no user prompt → no budget consumption\n\n  // Count mulligan:rewind markers appended AFTER the latest user prompt.\n  let count = 0;\n  for (let i = latestPromptIndex + 1; i < entries.length; i++) {\n    const e = entries[i];\n    if (typeof e !== \"object\" || e === null || Array.isArray(e)) continue;\n    try {\n      const ee = e as { type?: unknown; customType?: unknown };\n      if (ee.type === \"custom\" && ee.customType === \"mulligan:rewind\") count++;\n    } catch {\n      // a throwing-Proxy entry → skip (never throw on the tool hot path)\n    }\n  }\n  return count;"
  - REPLACE WITH (add the cancel-id pass BEFORE the count loop; make the count loop cancel-aware; same
          per-entry try/catch + cast style; defensive polarity = count unless positively cancelled):
      "  if (latestPromptIndex === -1) return 0; // no user prompt → no budget consumption\n\n  // BUG-005: collect the uuid ids of rewinds RETIRED by a mulligan:cancel on the branch, so cancelled rewinds\n  // are excluded from the budget (a cancelled rewind never took effect → it did not re-land at the prompt).\n  // Mirrors readMarkers' cancelledIds (src/filter.ts): scan ALL cancel entries after the latest prompt\n  // (order-independent — a cancel may appear after the rewind it retires), read data.targetId defensively.\n  // A malformed cancel (non-string / empty / missing targetId) is skipped (fail-open, never throw).\n  const cancelledRewindIds = new Set<string>();\n  for (let i = latestPromptIndex + 1; i < entries.length; i++) {\n    const e = entries[i];\n    if (typeof e !== \"object\" || e === null || Array.isArray(e)) continue;\n    try {\n      const ee = e as { type?: unknown; customType?: unknown; data?: { targetId?: unknown } };\n      if (ee.type === \"custom\" && ee.customType === \"mulligan:cancel\") {\n        const targetId = ee.data?.targetId;\n        if (typeof targetId === \"string\" && targetId.length > 0) cancelledRewindIds.add(targetId);\n      }\n    } catch {\n      // a throwing-Proxy entry → skip (never throw on the tool hot path)\n    }\n  }\n\n  // Count ACTIVE (non-cancelled) mulligan:rewind markers appended AFTER the latest user prompt. A rewind\n  // whose data.id ∈ cancelledRewindIds is SKIPPED (retired by a cancel). A rewind with an unreadable data.id\n  // is COUNTED — never exclude on bad data (defensive polarity matches readMarkers' \"keep on bad id\": here\n  // \"keep\" = \"count\", the conservative direction for a retry budget).\n  let count = 0;\n  for (let i = latestPromptIndex + 1; i < entries.length; i++) {\n    const e = entries[i];\n    if (typeof e !== \"object\" || e === null || Array.isArray(e)) continue;\n    try {\n      const ee = e as { type?: unknown; customType?: unknown; data?: { id?: unknown } };\n      if (ee.type === \"custom\" && ee.customType === \"mulligan:rewind\") {\n        const id = ee.data?.id;\n        if (typeof id === \"string\" && cancelledRewindIds.has(id)) continue; // cancelled → skip\n        count++;\n      }\n    } catch {\n      // a throwing-Proxy entry → skip (never throw on the tool hot path)\n    }\n  }\n  return count;"
  - RATIONALE: implements the contract's two-pass approach (build cancel-id set, then cancel-aware count) in
    the function's OWN defensive style. A cancelled rewind (data.id ∈ cancel targetIds) is excluded; an
    id-less/unreadable rewind is still counted (backward-compatible with existing id-less test fixtures).
  - PRESERVE: the outer `try { entries = ctx.sessionManager.getEntries(); } catch { return 0; }`, the
    `if (!Array.isArray(entries)) return 0;` guard, AND the entire user-prompt lookup loop (the block ABOVE
    the FIND) — UNCHANGED. Keep every per-entry `try/catch` (E13 never-throw). Keep the `continue` on
    non-record entries. The function signature `(ctx: ExtensionContext): number` is unchanged.
  - DO NOT: import readOwn/isRecord from filter.ts; change the function signature; touch the call site
    (line ~509); or edit any other function in the file.

Task 2: EDIT src/tools/rewind.ts — update the countRetriesAtLatestPrompt JSDoc (lines ~232-246) [Mode A]
  - FIND (verbatim current — the FULL JSDoc block immediately above the function):
      "/**\n * countRetriesAtLatestPrompt — the E22 per-prompt retry-budget counter (step 4b). Finds the LAST entry whose\n * `type === \"message\"` AND whose `message.role === \"user\"` (the latest user prompt), then counts entries at\n * index > that index where `type === \"custom\" && customType === \"mulligan:rewind\"` (rewind markers appended\n * AFTER the latest user message = rewinds during this turn that re-land at the prompt). Returns 0 when there\n * is no user-message entry (no prompt → no budget consumption). Defensive (never throws; a throwing-Proxy\n * entry, a non-array, or a throwing getEntries → the entry is skipped / the count is 0). Module-local.\n *\n * OVER-APPROXIMATION (v1 entry-position): for `last_tool_call_group`/`checkpoint` rewinds this counts a rewind\n * issued THIS turn even if its resolved target was a PRIOR turn's group (the marker is appended at the end\n * regardless). The spec's intent — arrest the same-prompt loop — is met; precise message-list resolution\n * (excluding a tool-group rewind whose target precedes the latest prompt) is a future refinement. Advancing\n * to a new user prompt naturally resets the count (the new prompt becomes the latest → prior rewinds are\n * before it).\n */"
  - REPLACE WITH (add the EXCLUDING-cancelled clause to the first paragraph; add a CANCEL-EXCLUSION paragraph;
          note in OVER-APPROXIMATION that cancelled rewinds ARE now excluded):
      "/**\n * countRetriesAtLatestPrompt — the E22 per-prompt retry-budget counter (step 4b). Finds the LAST entry whose\n * `type === \"message\"` AND whose `message.role === \"user\"` (the latest user prompt), then counts entries at\n * index > that index where `type === \"custom\" && customType === \"mulligan:rewind\"` (rewind markers appended\n * AFTER the latest user message = rewinds during this turn that re-land at the prompt), EXCLUDING rewinds\n * retired by a `mulligan:cancel` (BUG-005: a cancelled rewind never took effect → it did not re-land at the\n * prompt, so it must not consume budget). Returns 0 when there is no user-message entry (no prompt → no\n * budget consumption). Defensive (never throws; a throwing-Proxy entry, a non-array, or a throwing getEntries\n * → the entry is skipped / the count is 0). Module-local.\n *\n * CANCEL-EXCLUSION (BUG-005): before counting, scans the same post-prompt slice for `mulligan:cancel` entries\n * and collects their `data.targetId` into a Set (mirrors readMarkers' `cancelledIds` in src/filter.ts — the\n * same uuid-by-targetId mechanism that drops cancelled markers from the filter). A rewind whose `data.id` is\n * in that Set is skipped. Order-independent (full cancel scan, then count). A rewind with an unreadable\n * `data.id` is COUNTED — never exclude on bad data (defensive polarity matches readMarkers' \"keep on bad id\";\n * here \"keep\" = \"count\", the conservative direction for a retry budget).\n *\n * OVER-APPROXIMATION (v1 entry-position): for `last_tool_call_group`/`checkpoint` rewinds this counts a rewind\n * issued THIS turn even if its resolved target was a PRIOR turn's group (the marker is appended at the end\n * regardless). The spec's intent — arrest the same-prompt loop — is met; precise message-list resolution\n * (excluding a tool-group rewind whose target precedes the latest prompt) is a future refinement. (Cancelled\n * rewinds, by contrast, ARE now excluded — see CANCEL-EXCLUSION above.) Advancing to a new user prompt\n * naturally resets the count (the new prompt becomes the latest → prior rewinds are before it).\n */"
  - RATIONALE: documents the new behavior + defensive polarity + cross-references readMarkers' cancelledIds.
  - PRESERVE: the JSDoc /** ... */ framing and the unchanged sentences (user-prompt lookup, OVER-APPROXIMATION
    v1 entry-position note). Only ADD the EXCLUDING clause, the CANCEL-EXCLUSION paragraph, and the parenthetical.

Task 3: ADD a regression test to test/tools/rewind.test.ts — BUG-005 repro (cancelled rewind excluded)
  - PLACEMENT: add a NEW describe/it alongside the existing retry-budget block (lines ~1030+). Do NOT modify
    any existing test. Model the style on the "(a) RETRY BUDGET" block (setConfig + makePi + makeCtx + run +
    firstText/appended assertions).
  - ADD helpers (local to the test file, near rewindEntry at line ~207 — or inline the literals):
      "function rewindEntryWithId(seq: number, id: string) {\n  return { type: \"custom\" as const, customType: \"mulligan:rewind\", data: { seq, id, kind: \"rewind\" } };\n}\nfunction cancelEntry(targetId: string) {\n  return { type: \"custom\" as const, customType: \"mulligan:cancel\", data: { kind: \"cancel\", targetId } };\n}"
  - ADD the test (the canonical BUG-005 repro from the PRD):
      "describe(\"mulligan_rewind — retry budget: cancelled rewinds excluded (BUG-005 / spec/08 E22)\", () => {\n  it(\"a rewind retired by a later mulligan:cancel does NOT consume budget\", async () => {\n    setConfig({ rewind: { maxRetriesPerPrompt: 2 } });\n    const { appended, pi } = makePi();\n    // countRetriesAtLatestPrompt: after the user prompt there are TWO mulligan:rewind markers (rw1, rw2),\n    // but rw1 is retired by a mulligan:cancel(targetId=rw1). WITHOUT the fix → count=2 → 2>=2 → refuse.\n    // WITH the fix → count=1 (only rw2 active) → 1<2 → succeed (marker persisted).\n    const { ctx } = makeCtx({\n      entries: [\n        msgEntry(user(\"wrong target then right target\")),\n        rewindEntryWithId(1, \"rw1\"),\n        cancelEntry(\"rw1\"),\n        rewindEntryWithId(2, \"rw2\"),\n      ],\n    });\n    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: \"last_turn\" });\n    expect(firstText(res)).not.toContain(\"per-prompt retry budget\");\n    expect(appended.length).toBeGreaterThan(0); // succeeded (not refused) → marker persisted\n  });\n});"
  - RATIONALE: this test FAILS before the fix (count=2 → refuse → appended=0 → the `>0` assertion fails / the
    not-contain assertion fails) and PASSES after (count=1 → succeed → appended>0). It locks in BUG-005.
  - ASSERTION CHOICE: assert `appended.length > 0` (success persisted a marker) AND `firstText(res)` does NOT
    contain "per-prompt retry budget" — the dual signal that the budget was NOT hit. (Do NOT assert an exact
    count string like "1/2" — the refusal text only appears when refused.)
  - DO NOT: modify existing retry-budget tests (a)-(f); change rewindEntry(seq) (other tests rely on its
    no-id shape); or assert on internal count values (countRetriesAtLatestPrompt is module-local / unexported).
```

### Implementation Patterns & Key Details

```ts
// The mechanism mirrored from readMarkers (src/filter.ts) — uuid-by-targetId cancellation:
//   readMarkers:  cancelledIds = Set of data.targetId from mulligan:cancel entries;
//                 activeRewinds = rewinds.filter(r => !(typeof r.id === 'string' && cancelledIds.has(r.id)))
//   countRetries: cancelledRewindIds = Set of data.targetId from mulligan:cancel entries (post-prompt slice);
//                 count++ for each rewind UNLESS (typeof data.id === 'string' && cancelledRewindIds.has(id)).
//   SAME rule, SAME defensive polarity (unreadable id → keep/count).

// The function's OWN defensive style (mirror it; do NOT import readOwn/isRecord):
//   for (let i = start; i < entries.length; i++) {
//     const e = entries[i];
//     if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
//     try {
//       const ee = e as { type?: unknown; customType?: unknown; data?: { ... } };
//       ...read ee.data?.targetId / ee.data?.id...
//     } catch { /* throwing-Proxy entry → skip (E13) */ }
//   }

// CRITICAL — why two passes (not one forward pass): a mulligan:cancel can appear AFTER the rewind it
// retires (the agent rewinds, then cancels). A single forward pass would count the rewind before seeing
// its cancel. The full-cancel-scan-first approach is order-independent (matches readMarkers).

// CRITICAL — backward compat: existing tests use rewindEntry(seq) → data:{seq} (NO id). After the fix,
// those rewinds have typeof data.id === 'undefined' (not 'string') → the `cancelledRewindIds.has(id)` branch
// is never taken → they are still counted → existing "3/3 refuse" assertions still hold. ✅ no regressions.
```

### Integration Points

```yaml
NO INTEGRATION POINTS beyond the one function.
  - DATABASE: none
  - CONFIG: none (reads config.rewind.maxRetriesPerPrompt at the CALL SITE, unchanged; the function itself
              takes only ctx)
  - ROUTES: none
  - CODE: the call site at src/tools/rewind.ts:508-509 is UNCHANGED (retries is still a number; the refusal
          comparison `retries >= config.rewind.maxRetriesPerPrompt` now compares against the cancel-aware count).
          readMarkers (src/filter.ts) is a READ-ONLY reference (the mirrored pattern); it is NOT edited.
  - CROSS-MODULE CONSISTENCY: "active rewind" now means the same thing in countRetriesAtLatestPrompt and
    readMarkers (both exclude data.id ∈ cancel-targetIds). Validation gates below enforce this via grep.
  - PARALLEL-SIBLING COORDINATION: P1.M2.T1.S1 edits src/nudges.ts + test/turn_metric.test.ts ONLY — no overlap
    with src/tools/rewind.ts or test/tools/rewind.test.ts.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Confirm the function now has the cancel-id pass + cancel-aware count loop:
sed -n '247,300p' src/tools/rewind.ts
# Confirm the JSDoc gained the CANCEL-EXCLUSION paragraph:
sed -n '232,260p' src/tools/rewind.ts
# Confirm the call site is byte-identical (no signature change rippled downstream):
sed -n '505,512p' src/tools/rewind.ts
```
Expected: the function has a `cancelledRewindIds = new Set<string>()` pass reading `data.targetId`, then a
count loop reading `data.id` with `if (typeof id === "string" && cancelledRewindIds.has(id)) continue;`; the
JSDoc has a "CANCEL-EXCLUSION (BUG-005)" paragraph; the call site is unchanged.

### Level 2: Type + behavior gates (the core BUG-005 checks)

```bash
# (a) Type-check clean (no new type errors; the `as { ... data?: { id?: unknown } }` casts are sound):
npm run typecheck          # = tsc --noEmit — expect ZERO errors

# (b) The new cancel-aware logic is present:
grep -n 'cancelledRewindIds' src/tools/rewind.ts          # expect ≥3 hits (decl + add + has)
grep -n 'data?.targetId' src/tools/rewind.ts              # expect a hit in the cancel pass
grep -n 'data?.id' src/tools/rewind.ts                    # expect a hit in the count loop
grep -n 'CANCEL-EXCLUSION (BUG-005)' src/tools/rewind.ts  # expect a hit in the JSDoc

# (c) The regression test is present:
grep -n 'cancelled rewinds excluded\|rewindEntryWithId\|cancelEntry' test/tools/rewind.test.ts
```
Expected: (a) tsc clean; (b) all four greps hit; (c) the new test + helpers present.

### Level 3: Unit Tests (component validation)

```bash
# Run the rewind tool tests — the new BUG-005 test passes; existing retry-budget tests stay green:
npx vitest run test/tools/rewind.test.ts

# Full suite sanity (the change is local, but confirm no collateral breakage):
npm test            # = vitest run
```
Expected: ALL tests pass, including:
- The NEW "cancelled rewinds excluded" test (FAILS before the fix — appended=0 / refused; PASSES after).
- The EXISTING retry-budget tests (a) "refuses at exactly the budget (3/3)", (b) "zero-hide still counts",
  (c) "new prompt resets", (d) "non-rewind tools unaffected", (e) context-fraction, (f) never-throw — all
  UNCHANGED (id-less rewinds still counted → still refuse at budget). If any existing test fails, the
  defensive polarity was inverted (you excluded id-less rewinds) — re-read the "COUNT on bad data" rule.

### Level 4: Cross-module consistency (system validation)

```bash
# "active rewind" must mean the same thing here and in readMarkers (src/filter.ts).
echo "--- countRetriesAtLatestPrompt cancel logic (rewind.ts) ---"
grep -nE 'cancelledRewindIds|data\?\.(targetId|id)' src/tools/rewind.ts

echo "--- readMarkers cancelledIds (filter.ts — the mirrored pattern) ---"
grep -nE 'cancelledIds|targetId' src/filter.ts | head

echo "--- spec E22 retry semantics (source of truth) ---"
grep -n 're-land\|same-prompt\|maxRetriesPerPrompt' spec/08-edge-cases.md | head
```
Expected: both countRetriesAtLatestPrompt and readMarkers collect cancel targetIds and exclude by data.id;
spec/08 E22 defines a retry as a rewind that re-lands at the latest user message (a cancelled one does not).

### Level 5: Scope-discipline gate (no collateral edits)

```bash
# The only production change should be countRetriesAtLatestPrompt + its JSDoc; the only test change is the
# added regression test (and its helpers). No other file touched by THIS task.
git -C . diff --stat -- src/tools/rewind.ts test/tools/rewind.test.ts
git -C . diff -- src/tools/rewind.ts | head -80
# Assert no other file was touched (siblings edit their own files in their own sessions):
git -C . diff --name-only -- src/nudges.ts test/turn_metric.test.ts src/filter.ts src/markers.ts spec/08-edge-cases.md
# Expected: NO changes to those five files from this PRP.
```
Expected: only `src/tools/rewind.ts` and `test/tools/rewind.test.ts` are modified; the diff is the cancel-id
pass + cancel-aware count loop + JSDoc paragraph + the new test/helpers; no other file touched.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `sed -n '247,300p'` shows the cancel-id pass + cancel-aware count loop; `sed -n '505,512p'`
      shows the call site byte-identical.
- [ ] Level 2(a): `npm run typecheck` clean.
- [ ] Level 2(b): `cancelledRewindIds`, `data?.targetId`, `data?.id`, `CANCEL-EXCLUSION (BUG-005)` all present.
- [ ] Level 2(c): the regression test + `rewindEntryWithId`/`cancelEntry` helpers present.
- [ ] Level 3: `npx vitest run test/tools/rewind.test.ts` green — NEW test passes, EXISTING tests unchanged.
- [ ] Level 4: cancel logic mirrors readMarkers' cancelledIds (src/filter.ts); spec/08 E22 semantics honored.
- [ ] Level 5: only `src/tools/rewind.ts` + `test/tools/rewind.test.ts` modified; no other file touched.

### Feature Validation
- [ ] `countRetriesAtLatestPrompt` excludes rewinds whose `data.id` is targeted by a post-prompt `mulligan:cancel`.
- [ ] A rewind with an unreadable `data.id` is still counted (defensive — never exclude on bad data).
- [ ] The function never throws (E13) and still returns `number`.
- [ ] The new regression test (BUG-005 repro: rw1 cancelled, rw2 active → budget sees 1, not 2) passes.
- [ ] Existing retry-budget tests (id-less rewinds) still refuse at budget (3/3) — backward-compatible.

### Code Quality / Scope Discipline
- [ ] Mirrors the function's OWN defensive style (per-entry try/catch + direct cast) — did NOT import readOwn/isRecord.
- [ ] Two-pass (cancel scan first, then count) — order-independent (handles cancel-after-rewind).
- [ ] Did NOT change the function signature `(ctx): number`; call site (rewind.ts:509) untouched.
- [ ] Did NOT touch `src/filter.ts` (readMarkers — the referenced pattern), `src/markers.ts`, `src/nudges.ts`.
- [ ] Did NOT touch `test/turn_metric.test.ts` (owned by P1.M2.T1.S1) or any other test file.
- [ ] Did NOT modify existing retry-budget tests (a)-(f) — only ADDED a new it(...) + helpers.
- [ ] Did NOT touch `spec/*` (READ-ONLY — spec/08 E22/E13 are the cited source-of-truth).

### Documentation
- [ ] JSDoc documents the cancel-exclusion + defensive polarity + cross-references readMarkers' cancelledIds.
- [ ] The OVER-APPROXIMATION note clarifies cancelled rewinds ARE now excluded (only the tool-group target
      over-approximation remains).

---

## Anti-Patterns to Avoid

- ❌ Don't invert the defensive polarity — SKIP a rewind ONLY IF `data.id` is a string AND in the cancel set.
  An id-less/unreadable rewind is COUNTED. Inverting this breaks the existing retry-budget tests (id-less
  rewinds would be wrongly excluded → "3/3 refuse" would no longer hold).
- ❌ Don't import `readOwn`/`isRecord` from filter.ts — replicate the LOGIC in the function's own try/catch +
  cast style. (The function is module-local and intentionally self-contained/defensive.)
- ❌ Don't do a single forward pass — a cancel can appear AFTER the rewind it retires; the full-cancel-scan-
  first approach is order-independent (matches readMarkers).
- ❌ Don't change the function signature or the call site — `retries` is still a `number`; the comparison at
  the call site (`retries >= maxRetriesPerPrompt`) now compares against the cancel-aware count, automatically.
- ❌ Don't edit `src/filter.ts`, `src/markers.ts`, `src/nudges.ts`, or any test file other than
  `test/tools/rewind.test.ts`.
- ❌ Don't modify the existing retry-budget tests (a)-(f) or the `rewindEntry(seq)` helper (other tests depend
  on its no-id shape) — ADD a new test + new helpers.
- ❌ Don't drop the per-entry `try/catch` or the outer `getEntries` try/catch — the function must never throw
  (E13); a throwing-Proxy entry in either loop is skipped, never thrown.
- ❌ Don't assert on an exact count string ("1/2") in the test — the refusal text only appears when refused.
  Assert `appended.length > 0` (success) + `firstText(res)` does NOT contain "per-prompt retry budget".

---

## Confidence Score

**9.5/10** for one-pass implementation success. This is a contained, well-specified change to ONE module-local
function with: the verbatim current body (FIND) and verbatim replacement (REPLACE) for both the code and the
JSDoc; the exact cancel-aware pattern to mirror (readMarkers' cancelledIds, with file/line citations); the
entry shapes (`data.id` / `data.targetId`); the verbatim test-harness API + the canonical BUG-005 repro
scenario (with ready-to-paste test + helpers); a documented defensive polarity (count-on-bad-id) that
guarantees backward compatibility with the existing id-less test fixtures; and deterministic typecheck +
vitest + grep + git-diff validation gates. The residual risks: (1) fidelity of the large verbatim FIND/REPLACE
blocks (mitigated by the Level 1 `sed` checks + Level 2 grep gates + Level 3 vitest); (2) the test helper
shapes must include `data.id`/`data.targetId` for the repro to exercise the new branch (called out explicitly
with ready-to-paste helpers); (3) the defensive polarity is the one thing that, if inverted, silently breaks
existing tests — flagged as the #1 DO-NOT and caught by Level 3 (existing "3/3 refuse" tests).