# PRP — P1.M2.T2.S1: Add cancel-exclusion to `countRewindMarkers`, fix stale comments, add cancel-then-retry regression test (BUG-004)

## Goal

**Feature Goal**: Close the BUG-004 gap in the cumulative rewind depth guard (`countRewindMarkers`,
`src/tools/rewind.ts:204-222`). Today it counts ALL `mulligan:rewind` entries with a stale pre-E21 comment
("Markers are permanent (never cleared)"), never excluding markers retired by a `mulligan:cancel`. Result: 5
rewinds all cancelled (0 active) + a 6th attempt is REFUSED "max rewind depth (5) reached — 5 active rewind
marker(s)" despite 0 active markers — blocking the documented cancel-then-retry workflow and violating spec/05
§1 step 4 "count ACTIVE". The sibling guard `countRetriesAtLatestPrompt` (step 4b) ALREADY excludes cancels
(the BUG-005 fix); this makes the depth guard consistent. Fix: mirror the BUG-005 pattern — collect
`mulligan:cancel` `data.targetId` values into a Set, then skip any `mulligan:rewind` whose `data.id` is in it.

**Deliverable**: Edits to **two files**:
1. `src/tools/rewind.ts` — (a) rewrite `countRewindMarkers` (add a cancel-id collection pass over ALL entries +
   make the count loop cancel-aware); (b) fix its stale JSDoc (remove "Markers are permanent"); (c) fix the
   stale call-site comment at the depth guard (line ~524).
2. `test/tools/rewind.test.ts` — ONE regression `it(...)` proving the cancel-then-retry workflow: 5 rewinds
   each retired by a `mulligan:cancel` → 0 active → a new rewind SUCCEEDS (not depth-refused).

**Success Definition**: After the edit, `countRewindMarkers` returns the count of **ACTIVE** (non-cancelled)
rewind markers across the whole branch. A rewind whose `data.id ∈ <cancel targetIds>` is excluded; a rewind
with an unreadable `data.id` is still counted (defensive — never exclude on bad data). It never throws (E13).
The new regression test PASSES (it would FAIL before the fix — refused despite 0 active). **All existing
depth-guard tests still pass unchanged** (their fixtures have no cancel entries → cancelledRewindIds empty →
all rewinds counted → still refuse at maxDepth=5). The refusal text format is unchanged (only the count value
becomes accurate). `npm run typecheck` exits 0.

## User Persona

**Target User**: pi-mulligan maintainers; indirectly any agent using the cancel-then-retry workflow.

**Use Case**: An agent creates several rewinds, cancels them via `mulligan_cancel` (they were wrong-target),
and attempts a fresh rewind — the cumulative depth guard must not block it.

**Pain Points Addressed**: Today that workflow is blocked at 5 cumulative rewinds even when all 5 were
cancelled (0 active). The refusal text is actively misleading ("5 active" when 0 are active). After the fix,
the depth guard counts only active markers, honoring spec/05 §1 step 4.

## Why

- **Spec fidelity (spec/05 §1 step 4)**: "count ACTIVE mulligan:rewind markers." A cancelled marker is dropped
  by `readMarkers` before the filter sees it (E21 amends D6 — markers ARE retractable via `mulligan_cancel`),
  so counting it diverges from the spec. BUG-004 (Minor).
- **Consistency with the sibling guard**: `countRetriesAtLatestPrompt` (step 4b) ALREADY excludes cancels (the
  BUG-005 fix). The two guards were internally inconsistent in their treatment of cancels; this PRP makes them
  agree ("active" means the same thing in both).
- **Unblocks the documented workflow**: cancel-then-retry is the canonical E21 use case; it must not be
  blocked at 5 cumulative rewinds.
- **PRD §2.5 recommends exactly this**: "Update countRewindMarkers to exclude markers whose data.id is in the
  active cancelledIds set (mirroring countRetriesAtLatestPrompt's BUG-005 fix), so the depth guard honors
  spec/05 §1 step 4 'count active' and the cancel-then-retry workflow is not blocked."
- **Small, safe, well-contained**: one module-local function (no signature change), defensive (never throws),
  backward-compatible (fixtures with no cancels → all rewinds counted → existing tests green).

## What

A two-pass rewrite of `countRewindMarkers` (cancel-id collection pass over ALL entries + cancel-aware count),
plus two stale-comment fixes (the JSDoc + the call-site comment), plus one regression test. The refusal text
format at the call site is unchanged.

### Success Criteria

- [ ] `countRewindMarkers` scans ALL entries for `mulligan:cancel` and collects their `data.targetId`
      (non-empty strings) into a `cancelledRewindIds` Set.
- [ ] The rewind-count loop reads each rewind's `data.id`; if it is a string AND in `cancelledRewindIds`, the
      rewind is SKIPPED (not counted); otherwise counted.
- [ ] A rewind with an unreadable / non-string `data.id` is COUNTED (defensive — never exclude on bad data).
- [ ] The function still never throws (E13) and still returns `number` (signature unchanged).
- [ ] The stale "Markers are permanent (never cleared)" claim is removed from BOTH the JSDoc and the call-site
      comment, replaced with the cancel-exclusion explanation (cites spec/05 §1 step 4 + the BUG-005 sibling).
- [ ] The refusal text `${depth} active rewind marker(s)` is byte-identical (only the count value changes).
- [ ] The new regression test (5 cancelled rewinds → 6th succeeds) PASSES; it would FAIL before the fix.
- [ ] All existing depth-guard tests (no cancel fixtures) still pass unchanged.
- [ ] `npm run typecheck` passes; `npx vitest run test/tools/rewind.test.ts` is fully green.
- [ ] No file other than `src/tools/rewind.ts` and `test/tools/rewind.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains the **verbatim current function body**, the **verbatim stale JSDoc**, the **verbatim
stale call-site comment**, and the **verbatim replacement** for each (find/replace blocks); the exact BUG-005
pattern to mirror (`countRetriesAtLatestPrompt`, with line cites); the canonical `readMarkers` cancelledIds
mechanism; the entry shapes (`data.id` / `data.targetId`); the **verified** test-harness helpers
(`rewindEntryWithId` / `cancelEntry` at rewind.test.ts:212/217 — NOTE the contract's `customEntry`/`rewindEntryData`
names actually live in edge-cases.test.ts, called out explicitly); the canonical BUG-004 repro scenario with a
ready-to-paste test; and deterministic typecheck + vitest + grep + git-diff validation gates.

### Documentation & References

```yaml
# MUST EDIT — the function + JSDoc + call-site comment (the only production-code changes)
- file: src/tools/rewind.ts
  why: countRewindMarkers (lines 204-222) is the function being made cancel-aware. Its JSDoc (lines 198-203)
        and the call-site comment (line ~524) both carry the stale "Markers are permanent" claim to fix.
  section: "function countRewindMarkers(ctx): number (line 204); JSDoc lines 198-203; call site ~524-530
            (refusal text line ~528 UNCHANGED)."
  pattern: "for (const e of entries) { ... try { const ee = e as {...}; ... } catch {...} } — the function's
            OWN defensive style (per-entry try/catch + direct cast; NOT readOwn/isRecord). Mirror it for the
            NEW cancel-id pass and the modified count loop."
  gotcha: "countRewindMarkers scans the WHOLE entry list (cumulative depth guard) — so BOTH passes iterate ALL
           entries via for...of. (countRetriesAtLatestPrompt, the pattern to mirror, scans only the post-prompt
           SLICE — do NOT copy its `latestPromptIndex+1` bounds; iterate the full `entries` array here.)"

# MUST READ — the exact cancel-aware pattern to mirror (the BUG-005 fix, already shipped)
- file: src/tools/rewind.ts
  why: countRetriesAtLatestPrompt (lines ~270-340) is the sibling guard that ALREADY excludes cancels. Mirror
        its cancel-id collection + cancel-aware count logic, but over ALL entries (not the post-prompt slice).
  section: "the 'BUG-005: collect the uuid ids...' cancel-id pass + the 'Count ACTIVE (non-cancelled)...' loop.
            READ-ONLY here (do NOT edit countRetriesAtLatestPrompt)."
  pattern: "cancelledRewindIds = new Set<string>(); scan for mulligan:cancel; read ee.data?.targetId; add if
            non-empty string. Then count mulligan:rewind; read ee.data?.id; skip if typeof string &&
            cancelledRewindIds.has(id); else count++."
  critical: "Defensive polarity = COUNT on bad data (matches countRetriesAtLatestPrompt + readMarkers). SKIP a
             rewind ONLY IF data.id is a string AND in the cancel set. An id-less rewind (rewindEntry(seq) →
             data:{seq}) is COUNTED → existing depth-guard tests (no cancels) stay green."

# MUST READ — the canonical cancel-aware mechanism (readMarkers cancelledIds)
- file: src/filter.ts
  why: readMarkers (lines ~101-205) builds cancelledIds from mulligan:cancel entries (readOwn(data,'targetId');
        non-empty string → add) and drops markers whose data.id ∈ cancelledIds (activeRewinds filter). The
        depth guard must use the SAME uuid-by-targetId mechanism so "active" means the same thing everywhere.
  section: "cancelledIds Set (~line 47, 73-77) + activeRewinds/activeShrinks filter (~line 83-92). READ-ONLY."
  critical: "readMarkers uses readOwn/isRecord; countRewindMarkers uses try/catch + direct cast. Replicate the
             LOGIC, not filter.ts's helper layer."

# MUST READ — the test harness (for the regression test)
- file: test/tools/rewind.test.ts
  why: Add the regression test HERE (co-located with the depth-guard tests ~398-432 and the BUG-005 cancel test
        ~1133-1161). Documents makePi/makeCtx/run/firstText/VALID_NOTE and the entry helpers.
  section: "helpers rewindEntry(seq) (line 207, data:{seq} NO id), rewindEntryWithId(seq,id) (line 212, WITH
            id), cancelEntry(targetId) (line 217), msgEntry (244), user (284). Depth-guard describe ~400;
            BUG-005 cancel describe ~1133."
  pattern: "PRE-SEED makeCtx({ entries: [...] }); run(pi, ctx, {note, granularity}); assert firstText(res) +
            appended.length. Add the new it(...) in a NEW describe (do NOT modify existing tests)."
  gotcha: "CONTRACT CORRECTION: the item_description names helpers customEntry()/rewindEntryData(), but those
           live in test/edge-cases.test.ts (line 278), NOT here. The helpers IN this file are
           rewindEntryWithId() + cancelEntry() — use those (the BUG-005 test uses exactly them). No new helper
           needed; do NOT import from edge-cases.test.ts."

# CONTEXT — the PRD/contract for BUG-004
- file: plan/007_67d7d8c6e4c5/bugfix/001_8fe6022f172a/architecture/bug_analysis.md
  why: §BUG-004 states the defect + the recommended fix (mirror countRetriesAtLatestPrompt's BUG-005 fix).
  critical: "A cancelled rewind is dropped by readMarkers (never took effect) → it must NOT count toward the
             cumulative depth. spec/05 §1 step 4 = 'count ACTIVE'."

# CONTEXT — the spec
- file: spec/05-tools.md
  why: §1 step 4 says "count ACTIVE mulligan:rewind markers" (the depth guard's contract). READ-ONLY.
- file: spec/08-edge-cases.md
  why: E21 (marker retraction — cancel) amends D6; E13 (never throw). E4 (max rewind depth). READ-ONLY.

# CONTEXT — the parallel sibling (no file conflict)
- file: plan/007_67d7d8c6e4c5/bugfix/001_8fe6022f172a/P1M2T1S1/PRP.md
  why: CONTRACT. P1.M2.T1.S1 edits src/tools/audit.ts (renderAuditReport checkpoint clause) +
        test/tools/audit.test.ts ONLY. No overlap with src/tools/rewind.ts or test/tools/rewind.test.ts.
```

### Current Codebase tree (the only relevant slice)

```bash
src/tools/
└── rewind.ts          # ← EDIT countRewindMarkers (204-222) + its JSDoc (198-203) + call-site comment (~524); refusal text ~528 UNCHANGED
src/
└── filter.ts          # READ-ONLY — readMarkers cancelledIds (canonical cancel-aware pattern; ~101-205)
test/tools/
└── rewind.test.ts     # ← ADD one regression it(...) (BUG-004 repro); depth-guard tests ~398-432; BUG-005 cancel test ~1133
test/
└── edge-cases.test.ts # READ-ONLY cross-check — depth boundary ~428-446 (customEntry/rewindEntryData helpers; NO cancel fixtures)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL — iterate the WHOLE entry list, NOT a post-prompt slice:
#   countRewindMarkers is the CUMULATIVE depth guard (maxDepth across the whole branch). BOTH the cancel-id
#   pass and the count loop must be `for (const e of entries)` over ALL entries.
#   (countRetriesAtLatestPrompt — the pattern to mirror — uses `latestPromptIndex+1` bounds because it is the
#    PER-PROMPT budget. Do NOT copy those bounds here.)

# CRITICAL — mirror the function's OWN defensive style (NOT filter.ts's readOwn/isRecord):
#   for (const e of entries) {
#     if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
#     try { const ee = e as { type?: unknown; customType?: unknown; data?: {...} }; ... } catch { /* skip */ }
#   }

# CRITICAL — defensive polarity = COUNT on bad data (the conservative direction for a depth guard):
#   SKIP a rewind ONLY IF data.id is a string AND data.id ∈ cancelledRewindIds.
#   An id-less / unreadable data.id rewind → COUNT it. This MATCHES countRetriesAtLatestPrompt + readMarkers
#   ("keep on bad id"; here "keep" = count). It GUARANTEES backward compat: existing depth-guard tests use
#   rewindEntry(seq) (data:{seq}, no id) with NO cancel entries → cancelledRewindIds empty → all counted →
#   still refuse "5 active rewind marker(s)" at maxDepth=5.

# CRITICAL — never throw (E13): keep the outer getEntries try/catch (→ 0) and every per-entry try/catch
#   (→ skip entry). The NEW cancel-id pass ALSO needs per-entry try/catch.

# GOTCHA — entry shapes:
#   mulligan:rewind → entry.data.id   (uuid; rewindEntryWithId(seq,id) supplies it)
#   mulligan:cancel → entry.data.targetId  (=== the retired rewind's data.id; cancelEntry(targetId) supplies it)

# GOTCHA — the refusal TEXT at rewind.ts:528 is UNCHANGED. `${depth} active rewind marker(s)` now reports the
#   ACTIVE count (accurate), but the string format is byte-identical. Do NOT touch it.

# GOTCHA (test helper names) — the item_description's customEntry()/rewindEntryData() are in edge-cases.test.ts.
#   test/tools/rewind.test.ts has rewindEntryWithId(seq,id) + cancelEntry(targetId) — USE THOSE. (The BUG-005
#   test at rewind.test.ts:1133 uses exactly these two.)

# OUT OF SCOPE (do NOT touch in this subtask):
#   - countRetriesAtLatestPrompt (rewind.ts ~270-340) -> the BUG-005 fix; the PATTERN to mirror; already shipped.
#   - src/filter.ts (readMarkers cancelledIds) -> canonical reference; not edited.
#   - src/tools/audit.ts + test/tools/audit.test.ts -> owned by P1.M2.T1.S1 (BUG-003).
#   - The refusal text at rewind.ts:528 (unchanged — only the count value becomes accurate).
#   - Any other function/JSDoc in rewind.ts (only countRewindMarkers + its JSDoc + the call-site comment).
#   - Existing depth-guard / retry-budget tests (ADD a new it(...); do NOT modify existing assertions).
#   - test/edge-cases.test.ts (READ-ONLY cross-check; its helpers are NOT imported here).
#   - spec/* (READ-ONLY: spec/05 §1 step 4, spec/08 E21/E4/E13).
# This PRP edits ONLY src/tools/rewind.ts (countRewindMarkers + JSDoc + call-site comment) + test/tools/rewind.test.ts.
```

---

## Implementation Blueprint

### Data models and structure
_N/A — no new types. Signature unchanged: `(ctx: ExtensionContext): number`. Only new local is
`const cancelledRewindIds = new Set<string>();`._

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/rewind.ts — make countRewindMarkers cancel-aware (lines 204-222, the function body)
  - FIND (verbatim current — the FULL function body):
      "function countRewindMarkers(ctx: ExtensionContext): number {\n  let count = 0;\n  let entries: unknown;\n  try {\n    entries = ctx.sessionManager.getEntries();\n  } catch {\n    return 0; // never let the depth guard throw\n  }\n  if (!Array.isArray(entries)) return 0;\n  for (const e of entries) {\n    if (typeof e !== \"object\" || e === null || Array.isArray(e)) continue;\n    try {\n      if ((e as { type?: unknown }).type === \"custom\" && (e as { customType?: unknown }).customType === \"mulligan:rewind\") {\n        count++;\n      }\n    } catch {\n      // a throwing-Proxy entry → skip (never throw on the tool hot path)\n    }\n  }\n  return count;\n}"
  - REPLACE WITH (add the cancel-id pass over ALL entries BEFORE the count loop; make the count loop
          cancel-aware; same for...of + per-entry try/catch + cast style; defensive polarity = count unless
          positively cancelled):
      "function countRewindMarkers(ctx: ExtensionContext): number {\n  let entries: unknown;\n  try {\n    entries = ctx.sessionManager.getEntries();\n  } catch {\n    return 0; // never let the depth guard throw\n  }\n  if (!Array.isArray(entries)) return 0;\n\n  // BUG-004: collect the uuid ids of rewinds RETIRED by a mulligan:cancel on the branch, so cancelled rewinds\n  // are excluded from the cumulative depth count (spec/05 §1 step 4 \"count ACTIVE\"). Mirrors the cancel-\n  // exclusion in countRetriesAtLatestPrompt (the BUG-005 fix) and readMarkers' cancelledIds (src/filter.ts):\n  // scan ALL entries (the depth guard is cumulative across the whole branch, not per-prompt), read\n  // data.targetId defensively. A malformed cancel (non-string / empty / missing targetId) is skipped\n  // (fail-open, never throw).\n  const cancelledRewindIds = new Set<string>();\n  for (const e of entries) {\n    if (typeof e !== \"object\" || e === null || Array.isArray(e)) continue;\n    try {\n      const ee = e as { type?: unknown; customType?: unknown; data?: { targetId?: unknown } };\n      if (ee.type === \"custom\" && ee.customType === \"mulligan:cancel\") {\n        const targetId = ee.data?.targetId;\n        if (typeof targetId === \"string\" && targetId.length > 0) cancelledRewindIds.add(targetId);\n      }\n    } catch {\n      // a throwing-Proxy entry → skip (never throw on the tool hot path)\n    }\n  }\n\n  // Count ACTIVE (non-cancelled) mulligan:rewind markers across the WHOLE branch. A rewind whose data.id ∈\n  // cancelledRewindIds is SKIPPED (retired by a cancel). A rewind with an unreadable data.id is COUNTED —\n  // never exclude on bad data (defensive polarity matches readMarkers' \"keep on bad id\" /\n  // countRetriesAtLatestPrompt: here \"keep\" = \"count\", the conservative direction for a depth guard).\n  let count = 0;\n  for (const e of entries) {\n    if (typeof e !== \"object\" || e === null || Array.isArray(e)) continue;\n    try {\n      const ee = e as { type?: unknown; customType?: unknown; data?: { id?: unknown } };\n      if (ee.type === \"custom\" && ee.customType === \"mulligan:rewind\") {\n        const id = ee.data?.id;\n        if (typeof id === \"string\" && cancelledRewindIds.has(id)) continue; // cancelled → skip\n        count++;\n      }\n    } catch {\n      // a throwing-Proxy entry → skip (never throw on the tool hot path)\n    }\n  }\n  return count;\n}"
  - RATIONALE: implements the contract's two-pass approach (build cancel-id set over ALL entries, then
    cancel-aware count over ALL entries) in the function's OWN defensive style. A cancelled rewind is
    excluded; an id-less/unreadable rewind is still counted (backward-compatible with the existing id-less
    depth-guard fixtures).
  - PRESERVE: the outer `try { entries = getEntries() } catch { return 0 }`, the `if (!Array.isArray) return 0`
    guard, every per-entry try/catch (E13), and the `continue` on non-record entries. The function signature
    `(ctx): number` is unchanged. The `let count = 0` moves BELOW the cancel pass (harmless reorder).
  - DO NOT: import readOwn/isRecord; change the signature; touch the refusal text (line ~528); or edit any
    other function in the file.

Task 2: EDIT src/tools/rewind.ts — fix the stale countRewindMarkers JSDoc (lines 198-203) [Mode A]
  - FIND (verbatim current — the FULL JSDoc block immediately above the function):
      "/**\n * countRewindMarkers — the depth-guard source (GOTCHA #9). Scan `ctx.sessionManager.getEntries()` for entries\n * where `type === \"custom\" && customType === \"mulligan:rewind\"`; return the count. Markers are permanent (never\n * cleared), so ALL persisted rewind markers count toward maxDepth. Defensive (never throws; a throwing-Proxy\n * entry or a non-array → the entry is skipped / the count is 0). Module-local.\n */"
  - REPLACE WITH (drop "Markers are permanent"; state ACTIVE-only counting + the cancel-exclusion + cite spec/05
          §1 step 4 + the BUG-005 sibling + readMarkers):
      "/**\n * countRewindMarkers — the depth-guard source (GOTCHA #9). Scan `ctx.sessionManager.getEntries()` for entries\n * where `type === \"custom\" && customType === \"mulligan:rewind\"`; return the count of ACTIVE markers, EXCLUDING\n * rewinds retired by a `mulligan:cancel` (BUG-004: spec/05 §1 step 4 says \"count ACTIVE\"). Markers are now\n * retractable via mulligan_cancel (E21 amends D6), so a cancelled rewind (its data.id ∈ the cancel targetIds)\n * does NOT count toward maxDepth — the cancel-then-retry workflow must not be blocked at 5 cumulative rewinds.\n * Mirrors countRetriesAtLatestPrompt's BUG-005 fix and readMarkers' cancelledIds (src/filter.ts). Defensive\n * (never throws; a throwing-Proxy entry or a non-array → the entry is skipped / the count is 0). A rewind with\n * an unreadable data.id is COUNTED (never exclude on bad data). Module-local.\n */"
  - RATIONALE: removes the stale pre-E21 justification; documents the new behavior + defensive polarity + the
    spec mandate + cross-references the BUG-005 sibling and readMarkers.
  - PRESERVE: the `/** ... */` framing and the unchanged "depth-guard source (GOTCHA #9)" / "Defensive (never
    throws ...)" / "Module-local." sentences.

Task 3: EDIT src/tools/rewind.ts — fix the stale depth-guard call-site comment (line ~524) [Mode A]
  - FIND (verbatim current — the single comment line above `const depth = countRewindMarkers(ctx);`):
      "    // (4) depth guard (step 4; E4). Markers are permanent → ALL persisted rewind markers count toward maxDepth."
  - REPLACE WITH:
      "    // (4) depth guard (step 4; E4). countRewindMarkers counts ACTIVE rewind markers (cancelled rewinds are excluded — BUG-004; spec/05 §1 step 4 \"count active\")."
  - RATIONALE: the comment now matches the code; "Markers are permanent" is gone (markers are retractable via
    E21). The refusal text on the line BELOW (`max rewind depth (...) reached — ${depth} active rewind marker(s)`)
    is UNCHANGED — it already says "active", which is now accurate.
  - PRESERVE: the leading 4-space indent and the `// (4) depth guard (step 4; E4).` prefix. Do NOT touch the
    `const depth = countRewindMarkers(ctx);` line, the `if (depth >= ...)` check, or the `refuse(...)` text.

Task 4: ADD a regression test to test/tools/rewind.test.ts — BUG-004 cancel-then-retry repro
  - PLACEMENT: add a NEW describe alongside the depth-guard tests (~line 398) and/or the BUG-005 cancel test
    (~line 1133). Do NOT modify any existing test. Mirror the style of the BUG-005 test (setConfig optional +
    makePi + makeCtx + run + firstText/appended assertions).
  - HELPERS TO USE (already defined in this file — do NOT add new ones, do NOT import from edge-cases.test.ts):
      rewindEntryWithId(seq, id)  (line 212)  → { type:"custom", customType:"mulligan:rewind", data:{seq,id,kind:"rewind"} }
      cancelEntry(targetId)       (line 217)  → { type:"custom", customType:"mulligan:cancel", data:{kind:"cancel",targetId} }
      msgEntry / user / makePi / makeCtx / run / firstText / VALID_NOTE — all existing.
  - ADD the test (the canonical BUG-004 repro: 5 rewinds each retired by a cancel → 0 active → 6th succeeds):
      "describe(\"mulligan_rewind — depth guard: cancelled rewinds excluded (BUG-004 / spec/05 §1 step 4 'count active')\", () => {\n  it(\"5 rewinds each retired by a mulligan:cancel → 0 active → a new rewind SUCCEEDS (not depth-refused)\", async () => {\n    const { appended, pi } = makePi();\n    // countRewindMarkers scans ALL entries (cumulative depth guard). WITHOUT the fix → counts 5 rewind markers\n    // → 5>=maxDepth(5) → refuse. WITH the fix → excludes the 5 cancelled (data.id ∈ cancel targetIds) → 0\n    // active → 0<5 → succeed (marker persisted). Default maxDepth=5 (no setConfig needed).\n    const { ctx } = makeCtx({\n      entries: [\n        msgEntry(user(\"cancel-then-retry workflow\")),\n        rewindEntryWithId(1, \"rew-1\"), cancelEntry(\"rew-1\"),\n        rewindEntryWithId(2, \"rew-2\"), cancelEntry(\"rew-2\"),\n        rewindEntryWithId(3, \"rew-3\"), cancelEntry(\"rew-3\"),\n        rewindEntryWithId(4, \"rew-4\"), cancelEntry(\"rew-4\"),\n        rewindEntryWithId(5, \"rew-5\"), cancelEntry(\"rew-5\"),\n      ],\n    });\n    const res = await run(pi, ctx, { note: VALID_NOTE, granularity: \"last_tool_call_group\" });\n    expect(firstText(res)).not.toContain(\"max rewind depth (5) reached\");\n    expect(firstText(res)).not.toContain(\"5 active rewind marker(s)\");\n    expect(firstText(res)).toContain(\"Mulligan: rewound\");\n    expect(appended).toHaveLength(1); // succeeded → one new marker persisted\n  });\n});"
  - RATIONALE: this test FAILS before the fix (count=5 → refused → appended=0 + "max rewind depth (5) reached"
    present) and PASSES after (count=0 → succeed → appended=1). It locks in BUG-004 + the cancel-then-retry
    workflow. Uses ONLY existing helpers (rewindEntryWithId/cancelEntry) — no new helper, no edge-cases import.
  - ASSERTION CHOICE: assert success signals (`toContain("Mulligan: rewound")` + `appended.toHaveLength(1)`)
    AND absence of refusal (`not.toContain("max rewind depth (5) reached")`). Do NOT assert the exact active
    count string (the refusal text only appears when refused).
  - DO NOT: modify existing depth-guard tests (rewind.test.ts:404-412/418-428/~432) or the BUG-005 test; add
    new helpers; import from edge-cases.test.ts; or assert on internal count values (countRewindMarkers is
    module-local/unexported — verified indirectly via tool behavior).
```

### Implementation Patterns & Key Details

```ts
// The mechanism mirrored from countRetriesAtLatestPrompt (BUG-005, rewind.ts ~270-340) + readMarkers
// (filter.ts ~101-205) — uuid-by-targetId cancellation:
//   cancel-id pass:  cancelledRewindIds = Set of data.targetId from mulligan:cancel entries (ALL entries here).
//   count loop:      count++ for each mulligan:rewind UNLESS (typeof data.id === "string" && cancelledRewindIds.has(id)).
//   SAME rule, SAME defensive polarity (unreadable id → keep/count) as both siblings.

// countRewindMarkers' OWN defensive style (mirror it; do NOT import readOwn/isRecord):
//   for (const e of entries) {
//     if (typeof e !== "object" || e === null || Array.isArray(e)) continue;
//     try {
//       const ee = e as { type?: unknown; customType?: unknown; data?: { ... } };
//       ...read ee.data?.targetId / ee.data?.id...
//     } catch { /* throwing-Proxy entry → skip (E13) */ }
//   }

// CRITICAL — iterate ALL entries (NOT a post-prompt slice): countRewindMarkers is the CUMULATIVE depth guard
// (maxDepth across the whole branch). countRetriesAtLatestPrompt — the pattern to mirror — bounds its scan to
// latestPromptIndex+1 because it is the PER-PROMPT budget. Do NOT copy those bounds here; use for...of over
// the full `entries` array for BOTH passes.

// CRITICAL — backward compat: existing depth-guard tests use rewindEntry(seq) → data:{seq} (NO id), with NO
// cancel entries. After the fix: cancelledRewindIds is empty; each rewind has typeof data.id === "undefined"
// (not "string") → the skip branch is never taken → all counted → still refuse "5 active rewind marker(s)" at
// maxDepth=5. ✅ no regressions.
```

### Integration Points

```yaml
NO INTEGRATION POINTS beyond the one function + 2 comments.
  - DATABASE: none
  - CONFIG: none (reads config.rewind.maxDepth at the CALL SITE, unchanged; the function takes only ctx)
  - ROUTES: none
  - CODE: the call site at rewind.ts:~524-530 is UNCHANGED except the one comment line (Task 3); the refusal
          comparison `depth >= config.rewind.maxDepth` now compares against the cancel-aware count; the
          refusal TEXT is byte-identical (only the count value becomes accurate). countRetriesAtLatestPrompt
          (the mirrored BUG-005 fix) and readMarkers (the canonical pattern) are READ-ONLY references.
  - CROSS-MODULE CONSISTENCY: "active rewind" now means the same thing in countRewindMarkers (depth guard),
    countRetriesAtLatestPrompt (retry budget), and readMarkers (filter) — all exclude data.id ∈ cancel targetIds.
  - PARALLEL-SIBLING COORDINATION: P1.M2.T1.S1 edits src/tools/audit.ts + test/tools/audit.test.ts ONLY — no
    overlap with src/tools/rewind.ts or test/tools/rewind.test.ts.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Confirm countRewindMarkers now has the cancel-id pass + cancel-aware count:
sed -n '204,255p' src/tools/rewind.ts
# Confirm the JSDoc dropped "Markers are permanent":
sed -n '198,210p' src/tools/rewind.ts
# Confirm the call-site comment is updated (and the refusal TEXT is byte-identical):
sed -n '520,532p' src/tools/rewind.ts
```
Expected: countRewindMarkers has `cancelledRewindIds = new Set<string>()` reading `data.targetId`, then a count
loop reading `data.id` with `if (typeof id === "string" && cancelledRewindIds.has(id)) continue;`; the JSDoc
says "count of ACTIVE markers, EXCLUDING rewinds retired by a mulligan:cancel"; the call-site comment says
"counts ACTIVE rewind markers (cancelled rewinds are excluded — BUG-004 …)"; the refusal text `${depth} active
rewind marker(s)` is unchanged.

### Level 2: Type + behavior gates (the core BUG-004 checks)

```bash
# (a) Type-check clean:
npm run typecheck          # = tsc --noEmit — expect ZERO errors

# (b) The new cancel-aware logic is present:
grep -n 'cancelledRewindIds' src/tools/rewind.ts          # expect ≥4 hits (decl in countRewindMarkers + add + has; BUG-005 also has its own)
grep -n 'data?.targetId' src/tools/rewind.ts              # expect ≥2 hits (BUG-005 + countRewindMarkers)
grep -c 'Markers are permanent' src/tools/rewind.ts       # expect 0 (both stale comments removed)

# (c) The regression test + the exact helpers are present:
grep -n 'cancelled rewinds excluded\|rewindEntryWithId(1, "rew-1")\|cancelEntry("rew-1")' test/tools/rewind.test.ts
```
Expected: (a) tsc clean; (b) cancelledRewindIds present in countRewindMarkers, `data?.targetId` present, and
ZERO "Markers are permanent" remaining; (c) the new test present using the existing helpers.

### Level 3: Unit Tests (component validation)

```bash
# Rewind tool tests — the new BUG-004 test passes; existing depth-guard + retry-budget tests stay green:
npx vitest run test/tools/rewind.test.ts

# Edge-cases depth boundary (uses edge-cases.test.ts helpers; NO cancel fixtures → unchanged):
npx vitest run test/edge-cases.test.ts

# Full suite sanity (the change is local; confirm no collateral breakage):
npm test            # = vitest run
```
Expected: ALL tests pass, including:
- The NEW "cancelled rewinds excluded (BUG-004)" test (FAILS before the fix — refused despite 0 active; PASSES after).
- The EXISTING depth-guard tests (rewind.test.ts:404-412 "exactly maxDepth (5) … 5 active rewind marker(s)",
  :418-428 "fewer than maxDepth (4) → succeeds", :~432 "custom maxDepth") — UNCHANGED (id-less rewinds, no
  cancels → still counted → still refuse at 5).
- The EXISTING BUG-005 cancel test (rewind.test.ts:~1133) — UNCHANGED (it tests countRetriesAtLatestPrompt,
  not countRewindMarkers; both now share the same cancel-exclusion logic, mutually consistent).
- edge-cases.test.ts:428-446 depth boundary — UNCHANGED.
If any existing depth-guard test FAILS, the defensive polarity was inverted (you excluded id-less rewinds) —
re-read the "COUNT on bad data" rule.

### Level 4: Cross-module consistency (system validation)

```bash
# "active rewind" must mean the same thing in all three cancel-aware sites.
echo "--- countRewindMarkers (depth guard — THIS PRP) ---"
grep -nE 'cancelledRewindIds|data\?\.(targetId|id)' src/tools/rewind.ts | head -8

echo "--- countRetriesAtLatestPrompt (retry budget — BUG-005 sibling) ---"
grep -n 'BUG-005' src/tools/rewind.ts

echo "--- readMarkers cancelledIds (filter — canonical) ---"
grep -nE 'cancelledIds|targetId' src/filter.ts | head

echo "--- spec source-of-truth ---"
grep -n 'count ACTIVE\|count active' spec/05-tools.md
```
Expected: countRewindMarkers, countRetriesAtLatestPrompt, and readMarkers all collect cancel targetIds and
exclude by data.id; spec/05 §1 step 4 says "count ACTIVE".

### Level 5: Scope-discipline gate (no collateral edits)

```bash
# Only src/tools/rewind.ts + test/tools/rewind.test.ts are modified; the diff is the function rewrite +
# 2 comment fixes + the new test. No other file touched by THIS task.
git -C . diff --stat -- src/tools/rewind.ts test/tools/rewind.test.ts
git -C . diff -- src/tools/rewind.ts | head -90
# Assert sibling/other files NOT touched:
git -C . diff --name-only -- src/tools/audit.ts test/tools/audit.test.ts src/filter.ts test/edge-cases.test.ts spec/05-tools.md spec/08-edge-cases.md
# Expected: NO changes to those five files from this PRP.
```
Expected: only `src/tools/rewind.ts` and `test/tools/rewind.test.ts` modified; the diff is the cancel-id pass +
cancel-aware count + 2 comment fixes + the new regression test; no other file touched.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `sed -n '204,255p'` shows cancel-id pass + cancel-aware count; `sed -n '198,210p'` shows updated
      JSDoc; `sed -n '520,532p'` shows updated call-site comment + byte-identical refusal text.
- [ ] Level 2(a): `npm run typecheck` clean.
- [ ] Level 2(b): `cancelledRewindIds` + `data?.targetId` present in countRewindMarkers; `grep -c 'Markers are
      permanent'` = 0.
- [ ] Level 2(c): the regression test present using `rewindEntryWithId`/`cancelEntry`.
- [ ] Level 3: `npx vitest run test/tools/rewind.test.ts test/edge-cases.test.ts` green — NEW test passes,
      EXISTING depth-guard tests unchanged.
- [ ] Level 4: cancel logic mirrors countRetriesAtLatestPrompt + readMarkers; spec/05 §1 step 4 honored.
- [ ] Level 5: only `src/tools/rewind.ts` + `test/tools/rewind.test.ts` modified; no other file touched.

### Feature Validation
- [ ] `countRewindMarkers` excludes rewinds whose `data.id` is targeted by any `mulligan:cancel` (whole branch).
- [ ] A rewind with an unreadable `data.id` is still counted (defensive — never exclude on bad data).
- [ ] The function never throws (E13) and still returns `number`.
- [ ] The cancel-then-retry workflow works: 5 cancelled rewinds → 6th succeeds (new regression test passes).
- [ ] Existing depth-guard tests (id-less rewinds, no cancels) still refuse at maxDepth=5 — backward-compatible.
- [ ] The refusal text `${depth} active rewind marker(s)` is byte-identical (now reports the accurate active count).

### Code Quality / Scope Discipline
- [ ] Mirrors the function's OWN defensive style (per-entry try/catch + cast) — did NOT import readOwn/isRecord.
- [ ] Iterates ALL entries in BOTH passes (cumulative depth guard), NOT a post-prompt slice.
- [ ] Did NOT change the function signature `(ctx): number`; the call site's `const depth = ...` line untouched.
- [ ] Did NOT touch `countRetriesAtLatestPrompt` (the mirrored BUG-005 fix), `src/filter.ts`, `src/tools/audit.ts`.
- [ ] Did NOT touch `test/tools/audit.test.ts` (owned by P1.M2.T1.S1) or `test/edge-cases.test.ts`.
- [ ] Did NOT modify existing depth-guard / retry-budget tests — only ADDED a new it(...).
- [ ] Did NOT import `customEntry`/`rewindEntryData` from edge-cases.test.ts — used the local
      `rewindEntryWithId`/`cancelEntry` helpers (contract helper-name discrepancy corrected).
- [ ] Did NOT touch `spec/*` (READ-ONLY — spec/05 §1 step 4, spec/08 E21/E4/E13).

### Documentation
- [ ] JSDoc documents the cancel-exclusion + defensive polarity + cites spec/05 §1 step 4 + BUG-005 sibling.
- [ ] Call-site comment no longer says "Markers are permanent"; matches the code.

---

## Anti-Patterns to Avoid

- ❌ Don't iterate a post-prompt slice — `countRewindMarkers` is the CUMULATIVE depth guard; BOTH passes must be
  `for (const e of entries)` over ALL entries. (The BUG-005 pattern to mirror uses `latestPromptIndex+1` bounds
  because it is the PER-PROMPT budget — do NOT copy those bounds here.)
- ❌ Don't invert the defensive polarity — SKIP a rewind ONLY IF `data.id` is a string AND in the cancel set.
  An id-less/unreadable rewind is COUNTED. Inverting this breaks the existing depth-guard tests (id-less
  rewinds would be wrongly excluded → "5 active rewind marker(s)" refusal would no longer hold).
- ❌ Don't import `readOwn`/`isRecord` from filter.ts — replicate the LOGIC in the function's own try/catch +
  cast style. (The function is module-local and self-contained/defensive.)
- ❌ Don't change the refusal TEXT at rewind.ts:528 — it already says "active"; with the fix the count is
  accurate. Only the call-site COMMENT (Task 3) changes, not the text.
- ❌ Don't edit `countRetriesAtLatestPrompt` (the mirrored BUG-005 fix), `src/filter.ts`, `src/tools/audit.ts`,
  or any test file other than `test/tools/rewind.test.ts`.
- ❌ Don't import `customEntry`/`rewindEntryData` — they live in edge-cases.test.ts, NOT rewind.test.ts. Use the
  local `rewindEntryWithId(seq, id)` + `cancelEntry(targetId)` helpers (the BUG-005 test uses exactly these).
- ❌ Don't modify the existing depth-guard tests (rewind.test.ts:404-412/418-428/~432) or the BUG-005 test —
  ADD a new it(...); the existing `rewindEntry(seq)`/`rewindEntryWithId`/`cancelEntry` helpers are reused as-is.
- ❌ Don't drop the per-entry `try/catch` or the outer `getEntries` try/catch — the function must never throw
  (E13); a throwing-Proxy entry in either loop is skipped, never thrown.

---

## Confidence Score

**9.5/10** for one-pass implementation success. This is a contained, well-specified change to ONE module-local
function with: the verbatim current body + stale JSDoc + stale call-site comment (FIND) and verbatim
replacements (REPLACE) for all three; the exact BUG-005 pattern to mirror (`countRetriesAtLatestPrompt`) with
line cites and the ONE key difference called out (iterate ALL entries, not a post-prompt slice); the canonical
`readMarkers` cancelledIds mechanism; the entry shapes (`data.id`/`data.targetId`); the **verified** test
helpers (`rewindEntryWithId`/`cancelEntry` at rewind.test.ts:212/217) with the contract's helper-name
discrepancy explicitly corrected; the canonical BUG-004 repro with a ready-to-paste test; a documented
defensive polarity (count-on-bad-id) guaranteeing backward compatibility; and deterministic typecheck + vitest
+ grep + git-diff gates. Residual risks: (1) fidelity of the large verbatim FIND/REPLACE blocks (mitigated by
Level 1 `sed` checks + Level 2 grep gates + Level 3 vitest); (2) the post-prompt-slice vs whole-list trap
(flagged as the #1 DO-NOT + caught by the new test, which uses interleaved cancel-after-rewind entries that
only pass if the cancel pass sees the whole list); (3) the defensive polarity is the one thing that, if
inverted, silently breaks existing tests — flagged as a top DO-NOT and caught by Level 3 (existing "5 active
rewind marker(s)" test).