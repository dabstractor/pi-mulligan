# Bug Analysis — Detailed Per-Bug Findings

This document is the authoritative reference for downstream PRP implementation agents.
Each bug section contains: the divergence, exact code/spec locations, the fix approach,
and the full inventory of test assertions that must change.

---

## BUG-001 (Major): driftThresholdTokens default reconciliation

### Current State (verified by codebase probe)
- **Code** `src/config.ts:168`: `driftThresholdTokens: 4000`
- **spec/09 §2 (line 45)**: `"driftThresholdTokens": 4000` — ALREADY amended from 6000
- **spec/09 §3 (line 84) rationale**: "Lowered from 6000 with the comparison changed from `>` to `>=`"
- **README (line 98)**: Documents 4000 with full rationale referencing the `>=` change
- **config.test.ts (line 30)**: `expect(DEFAULT_CONFIG).toEqual({... driftThresholdTokens: 4000 ...})` — exact-match assertion PASSES
- **config.test.ts (line 64)**: `expect(cfg.nudges.driftThresholdTokens).toBe(4000)` — PASSES
- **Code comparison operator** `src/nudges.ts:332`: `return avg >= config.nudges.driftThresholdTokens;` — uses `>=`

### Key Finding: The PRD's premise is stale
The PRD (bug report) claims "spec/09 §2 shows `driftThresholdTokens: 6000`" and "§3 rationale
states 'Raised from 3000'." But the **current spec/09 file** already shows **4000** with the
rationale "Lowered from 6000." The spec was amended in a prior fix cycle. The code and spec
**already agree at 4000**.

### Remaining Inconsistency
**spec/07 §5.1 (line 170)** text still says: `avg(window.deltaTokens) > driftThresholdTokens`
(strict `>`). But the code uses `>=` and spec/09 §3 explicitly documents the `>` → `>=` change.
This is a spec-internal textual inconsistency — the only remaining divergence.

Additionally, `src/nudges.ts:297-306` has a "SPEC-AMBIGUITY RESOLUTION" comment block that
frames the `>=` as a deviation resolution. Since the spec now codifies `>=`, this framing is
historically accurate but could be clarified.

### Fix Approach
1. **KEEP 4000 + `>=`** (already consistent across code/spec/README/tests).
2. Fix spec/07 §5.1 text: change `> driftThresholdTokens` → `>= driftThresholdTokens` (the
   one remaining textual inconsistency).
3. Optionally clarify the nudges.ts:297-306 comment to reference spec/09 §3 as the authority
   (rather than framing as a "resolution").
4. Verify config.test.ts assertions still pass (they already assert 4000).

### Affected Tests
- `test/config.test.ts:30` — asserts `driftThresholdTokens: 4000` (NO CHANGE needed)
- `test/config.test.ts:64` — asserts `.toBe(4000)` (NO CHANGE needed)
- `test/drift_nudge.test.ts:128-143` — tests 4000 behavior with `>=` (NO CHANGE needed)

---

## BUG-002 (Major): High-water nudge must be awareness-only

### The Divergence
`renderHighWaterNudge` (`src/nudges.ts:534-543`) emits text that prescribes `mulligan_shrink`
and `mulligan_rewind`:

```typescript
// Line 540 (percentage path):
return `[mulligan] Context is at ~${pct}% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`;

// Line 538 (fallback, windowTokens <= 0):
return "[mulligan] Context is filling up. Consider mulligan_shrink or mulligan_rewind to reclaim space.";
```

**spec/07 §5.2 v1.1 note (line 172)**: "the high-water signal still measures *total* filtered
context and will still fire on such a paste (correctly — the window genuinely is filling), but
its **prescription is pure awareness, not rewind/shrink**."

**Why this matters**: The high-water signal measures TOTAL context (including user-supplied
content). It fires on a large user paste (F-drift-userexempt acceptance in spec/10 §2.1
confirms the high-water signal DOES fire on a user paste). When it fires on user-attributable
bloat, prescribing `mulligan_rewind`/`mulligan_shrink` is misaligned — the guardrail
(spec/13 §1) protects user messages from rewind, and shrinking the user's ground-truth prompt
is the wrong action. The D10 amendment separates "the agent should shed something" (delta,
agent-attributable) from "the window is getting full" (high-water, total awareness-only).

### Fix Approach
Rewrite both text paths to be **awareness-only** — report the fill level but do NOT prescribe
rewind/shrink. The text must:
- Retain the `[mulligan]` prefix and the percentage (`~<pct>%`)
- NOT contain the strings `mulligan_rewind` or `mulligan_shrink`
- Be ~25-40 tokens
- Suggest reviewing recent output (awareness) without prescribing a specific shed action

Suggested text (percentage path):
```
[mulligan] Context is at ~<pct>% of the window; review recent output for reclaimable space.
```
Suggested fallback (windowTokens <= 0):
```
[mulligan] Context is filling up; review recent output for reclaimable space.
```

Also update:
- The JSDoc comment block (nudges.ts:520-522) that says "recommends mulligan_shrink/mulligan_rewind"
- README.md line 233 which quotes the exact nudge text: `[mulligan] Context is at ~70% of the window. Consider mulligan_shrink or mulligan_rewind to reclaim space.`

### Affected Tests (MUST UPDATE)
- `test/drift_nudge.test.ts:492-496`: asserts `renderHighWaterNudge(140000, 200000)` output
  contains `"mulligan_shrink"` and `"mulligan_rewind"` — **MUST CHANGE** to assert awareness-only
  text (percentage present, tool names absent)
- `test/drift_nudge.test.ts:508-510`: asserts fallback output contains `"mulligan_shrink"` —
  **MUST CHANGE** to assert awareness-only fallback
- `test/filter.test.ts:955-967`: asserts high-water content contains `"~70%"` — **NO CHANGE
  NEEDED** (percentage still present)
- `test/drift_nudge.test.ts:499`: asserts `"~75%"` and `"~67%"` rounding — **NO CHANGE NEEDED**

---

## BUG-003 (Minor): Audit report checkpoint "(user-set)" annotation + singularization

### The Divergence
`renderAuditReport` (`src/tools/audit.ts:448-454`) renders the checkpoint clause without the
required `(user-set)` annotation and without singularizing the count:

```typescript
// Current (audit.ts ~line 453):
`${args.shrinks.length} shrink, ${args.checkpointNames.length} checkpoints${ckptNames}${cancelledClause}`
// Produces: "2 checkpoints [before-x, before-y]" or "1 checkpoints [before-x]"
```

**spec/13 §4 step 3 (line 89)**: "the report's `Active markers` line includes
`N checkpoints [names] (user-set)` so the human can see what they have armed."

This affects BOTH the agent's `mulligan_audit` tool AND the human `/mulligan_audit` command
(they share `renderAuditReport`, per spec/13 §4 "same renderer").

### Fix Approach
Update the checkpoint clause rendering in `renderAuditReport`:
1. **Singularize**: `checkpoints` → `checkpoint` when `checkpointNames.length === 1`
2. **Add `(user-set)` annotation**: when `checkpointNames.length > 0`, append ` (user-set)`
   after the names bracket. When `length === 0`, keep `0 checkpoints []` without annotation
   (nothing is armed, so the annotation is meaningless).

New rendering logic:
```
const ckptWord = args.checkpointNames.length === 1 ? "checkpoint" : "checkpoints";
const ckptUserSet = args.checkpointNames.length > 0 ? " (user-set)" : "";
// → "2 checkpoints [before-x, before-y] (user-set)"
// → "1 checkpoint [before-x] (user-set)"
// → "0 checkpoints []"
```

### Affected Tests (MUST UPDATE)
- `test/tools/audit.test.ts:550`: exact string
  `"Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [before-x, before-y]"`
  → **MUST APPEND** ` (user-set)`
- `test/tools/audit.test.ts:558`: `"0 rewind, 0 shrink, 0 checkpoints []"`
  → **NO CHANGE** (0 checkpoints, annotation omitted)
- `test/tools/audit.test.ts:580`: finds "Active markers:" line dynamically → **MAY NEED CHECK**
- `test/tools/audit.test.ts:929`: exact string
  `"Active markers: 1 rewind (last_tool_call_group), 0 shrink, 2 checkpoints [before-x, before-y]"`
  → **MUST APPEND** ` (user-set)`
- `test/tools/audit.test.ts:975`: `"0 rewind, 0 shrink, 0 checkpoints []"` → **NO CHANGE**
- `test/commands.test.ts:538-556`: uses `buildExpectedReport()` which calls `renderAuditReport`
  with `checkpointNames: []` (no checkpoints in test fixtures) → **LIKELY NO CHANGE** (0 checkpoints)
- **NEW TEST NEEDED**: assert `checkpointNames: ["solo"]` renders as `"1 checkpoint [solo] (user-set)"`
  (singular + annotation)

---

## BUG-004 (Minor): Rewind depth guard must exclude cancelled markers

### The Divergence
`countRewindMarkers` (`src/tools/rewind.ts:204-220`) counts ALL `mulligan:rewind` entries
without excluding those retired by a `mulligan:cancel`:

```typescript
function countRewindMarkers(ctx: ExtensionContext): number {
  // ... scans ALL entries for type==="custom" && customType==="mulligan:rewind"
  // NEVER checks for mulligan:cancel entries
  // Comment (line 200): "Markers are permanent (never cleared), so ALL persisted rewind markers count toward maxDepth."
}
```

**spec/05 §1 step 4 (line 67)**: "count **active** `mulligan:rewind` markers on the branch"

The comment "Markers are permanent (never cleared)" is **stale pre-E21 reasoning**. After E21,
markers ARE retractable via `mulligan_cancel`. The sibling `countRetriesAtLatestPrompt`
(rewind.ts:260-340) ALREADY excludes cancelled rewinds (the BUG-005 fix), making the two guards
**internally inconsistent**.

### Impact
An agent that creates 5 rewinds, cancels all 5 (0 active remain), then attempts a 6th is
**REFUSED** with a misleading message: `"max rewind depth (5) reached — 5 active rewind marker(s)"`
even though there are 0 active markers. This blocks the documented cancel-then-retry workflow.

### The Pattern to Mirror (from countRetriesAtLatestPrompt, rewind.ts:270-340)
The existing BUG-005 fix in `countRetriesAtLatestPrompt` provides the exact pattern:
1. Scan ALL entries for `mulligan:cancel` entries
2. Read each cancel's `data.targetId` defensively (typeof string, length > 0)
3. Collect into a `Set<string>` (`cancelledRewindIds`)
4. When counting `mulligan:rewind` entries, skip any whose `data.id` is in the Set
5. A rewind with an unreadable `data.id` is COUNTED (conservative: never exclude on bad data)

**Key difference from countRetriesAtLatestPrompt**: `countRewindMarkers` scans the ENTIRE entry
list (cumulative depth guard), not just the post-latest-prompt slice. The cancel scan must
therefore also cover ALL entries (not just post-prompt).

### Fix Approach
1. In `countRewindMarkers`, add a cancel-scan pass (over ALL entries) before the rewind count
   pass — mirror the exact defensive structure from `countRetriesAtLatestPrompt`.
2. Update the stale comment (line 199-203): remove "Markers are permanent (never cleared)" and
   explain that cancelled markers are excluded per spec/05 §1 step 4 "count active."
3. Update the depth-guard comment at line 524 ("Markers are permanent → ALL persisted rewind
   markers count toward maxDepth") to reflect the cancel-exclusion.
4. The refusal text at line 528 (`"${depth} active rewind marker(s)"`) will now report the
   CORRECT active count (excluding cancelled) — no text change needed, but the number will be
   accurate.

### Affected Tests (MUST UPDATE)
- `test/tools/rewind.test.ts:404-412`: seeds 5 rewind markers (none cancelled) → refused.
  **NO CHANGE NEEDED** (still 5 active when none cancelled).
- `test/tools/rewind.test.ts:418-428`: 4 markers → succeeds. **NO CHANGE NEEDED**.
- `test/edge-cases.test.ts:438-446`: 5 markers → refused; 4 → succeeds. **NO CHANGE NEEDED**
  (none cancelled in these fixtures).
- **NEW TEST NEEDED**: 5 rewind markers each cancelled by a `mulligan:cancel` → 6th rewind
  SUCCEEDS (0 active markers → depth guard passes). This is the cancel-then-retry workflow
  regression test. Pattern: mirror the BUG-005 cancel-exclusion test at
  `test/tools/rewind.test.ts:1133-1161`.

### Test Fixture Pattern for Cancel Entries
```typescript
// A mulligan:cancel entry that retires a rewind by its uuid id:
function cancelEntry(targetId: string): SessionEntry {
  return { type: "custom", id: `cancel-${targetId}`, customType: "mulligan:cancel",
           data: { targetId }, timestamp: "" };
}
// A rewind marker entry with a uuid id:
function rewindEntry(id: string, seq: number): SessionEntry {
  return { type: "custom", id, customType: "mulligan:rewind",
           data: { id, seq, granularity: "last_tool_call_group" }, timestamp: "" };
}
```
Existing helpers: `customEntry()` and `rewindEntryData()` in `test/tools/rewind.test.ts:206`
and `test/edge-cases.test.ts:277`. Cancel entries can be built via `customEntry("mulligan:cancel", { targetId })`.