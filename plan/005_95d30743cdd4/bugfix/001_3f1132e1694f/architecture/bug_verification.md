# Bug Verification Report — pi-mulligan BUG-001 through BUG-006

Verified against the actual source code at `/home/dustin/projects/pi-mulligan/src/`.
All six bugs CONFIRMED. Exact line numbers and code snippets below.

---

## BUG-001: Checkpoint not consumed when the same name is set on multiple targets
**Severity**: Major | **File**: `src/tools/rewind.ts` | **Status**: CONFIRMED

### Location: Lines 582–623 (step 7b checkpoint-consumption loop)

The checkpoint consumption loop scans `getEntries()` in **append order**, finds the
FIRST label entry matching the needle, calls `pi.setLabel(targetId, undefined)` on it,
then `break`s:

```typescript
// Line 582:
if (granularity === "checkpoint") {
  try {
    const needle = `mulligan:checkpoint:${params.checkpoint}`;
    let entries: unknown;
    try {
      entries = ctx.sessionManager.getEntries();
    } catch {
      entries = undefined;
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
          continue;
        }
        if (isMatch && typeof targetId === "string" && targetId.length > 0) {
          pi.setLabel(targetId, undefined);  // Line 611: clears ONLY the first-found (oldest) target
          break; // Line 612: stops iterating — newer targets retain the label
        }
      }
    }
  } catch {
    // E13: a label-clear failure must never undo the rewind.
  }
}
```

### Root Cause Analysis

When two targets (targetA, targetB) carry the same checkpoint label string concurrently
(Pi's `labelsById` is `Map<targetId, label>` with NO cross-target uniqueness), the loop:

1. Iterates `getEntries()` in append order.
2. Finds targetA's label entry FIRST (it was appended earlier).
3. Calls `pi.setLabel(targetA, undefined)` — clears ONLY targetA.
4. `break`s — targetB is never cleared.

Meanwhile, `checkpointExists()` (lines 278–320) discovers ALL candidate targets and
confirms activity via `getLabel(id) === needle` — it returns true as long as ANY
candidate is still labeled. After the consumption loop clears only targetA,
`checkpointExists("x")` still returns true via `getLabel(targetB)`, so a second
`mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` succeeds instead of
refusing with "not found".

### Contrast with resolveCheckpoint

`resolveCheckpoint()` (src/transforms.ts, lines 460–480) scans branchEntries in
**REVERSE** (leaf→root) to find the MOST RECENT match — it correctly targets targetB.
But the consumption loop in rewind.ts iterates forward and clears targetA. This
target/clear mismatch is the core defect.

### Existing Test Gap

`test/tools/rewind.test.ts` cases g/h only label a single targetId ("leaf-1"), so they
never exercise the duplicate-target scenario and mask the bug.

---

## BUG-002: driftWindowTurns accepts fractional values that floor to 0
**Severity**: Minor | **File**: `src/config.ts` | **Status**: CONFIRMED

### Location: Lines 285–288

```typescript
// Line 285:
v = safeGet(nudgesRaw, "driftWindowTurns");
if (v !== undefined) {
  const n = coerceNumber("nudges.driftWindowTurns", v, cfg.nudges.driftWindowTurns, true);
  cfg.nudges.driftWindowTurns = Number.isFinite(n) ? Math.floor(n) : cfg.nudges.driftWindowTurns;
  //                                                     ^^^^^^^^^^^^^^
  //  MISSING: Math.floor(n) >= 1 guard — Math.floor(0.5) === 0 is accepted
}
```

### Contrast with maxRetriesPerPrompt (Lines 247–250 — the CORRECT pattern)

```typescript
// Line 247:
v = safeGet(rewindRaw, "maxRetriesPerPrompt");
if (v !== undefined) {
  const n = coerceNumber("rewind.maxRetriesPerPrompt", v, cfg.rewind.maxRetriesPerPrompt, true);
  cfg.rewind.maxRetriesPerPrompt = Number.isFinite(n) && Math.floor(n) >= 1 ? Math.floor(n) : cfg.rewind.maxRetriesPerPrompt;
  //                                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //  HAS the >= 1 guard — falls back to default when floor is 0
}
```

### Impact

A value of `0.5` passes `coerceNumber(..., true)` (which requires `> 0`), then
`Math.floor(0.5) === 0`, so `cfg.nudges.driftWindowTurns` becomes 0. With a zero-length
window, `shouldNudge()` (src/nudges.ts) slices `recentMetrics.slice(0, 0)` → empty
`deltas` → permanently falls back to the bloat-only path, defeating the spec/07 §5.1
windowed-drift design.

---

## BUG-003: shrink.maxActive and shrink.staleAfterFires accept fractional values
**Severity**: Minor | **File**: `src/config.ts` | **Status**: CONFIRMED

### Location: Lines 266–269

```typescript
// Line 266:
v = safeGet(shrinkRaw, "maxActive");
if (v !== undefined) cfg.shrink.maxActive = coerceNumber("shrink.maxActive", v, cfg.shrink.maxActive, true);
//                     ^^^^^^^^^^^^^^^^^^ NO Math.floor — 0.5 accepted verbatim

v = safeGet(shrinkRaw, "staleAfterFires");
if (v !== undefined) cfg.shrink.staleAfterFires = coerceNumber("shrink.staleAfterFires", v, cfg.shrink.staleAfterFires, true);
//                                                 ^^^^^^^^^^^^^^^^^^ NO Math.floor — 0.5 accepted verbatim
```

### Impact in filter.ts

In `contextHandler()` (src/filter.ts):
- **maxActive**: `markers.shrinks.length > config.shrink.maxActive` → `1 > 0.5` → true
  with just ONE active shrink → the oldest shrink is auto-retired immediately.
- **staleAfterFires**: `misses >= config.shrink.staleAfterFires` → `1 >= 0.5` → a pinned
  shrink is retired after a SINGLE miss instead of the default 3.

### Inconsistency

The sibling integer knobs DO floor: `driftWindowTurns` uses `Math.floor(n)` (BUG-002),
and `maxRetriesPerPrompt` uses `Math.floor(n) >= 1`. `maxActive` and `staleAfterFires`
have NO flooring at all.

---

## BUG-004: resolveShrinkTarget with empty by_content_includes matches the FIRST message
**Severity**: Minor | **File**: `src/transforms.ts` | **Status**: CONFIRMED

### Location: Lines 789–795

```typescript
// Line 789:
// by_content_includes: first message (ANY role — E19) whose stringified content includes the substring.
const needle = readOwn(target, "by_content_includes");
if (typeof needle === "string") {      // NO needle.length > 0 guard!
  for (let i = 0; i < messages.length; i++) {
    if (stringifyContent(readOwn(messages[i], "content")).includes(needle)) return i;
    //  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //  String.prototype.includes("") === true for EVERY string → matches messages[0]
  }
  return null;
}
```

### Contrast with the other two arms (which DO guard empty strings)

- `by_tool_call_id` (line 778): `if (typeof callId === "string" && callId.length > 0)`
- `by_tool_name` (line 783): `if (typeof name === "string" && name.length > 0)`

The `by_content_includes` arm only checks `typeof needle === "string"` — an empty string
`""` passes and matches every message via `String.prototype.includes("")`.

### Impact

The shrink TOOL (src/tools/shrink.ts, `targetIsStructurallyValid`) refuses an empty
discriminator, so the tool layer is protected. But any path that constructs a shrink
marker WITHOUT going through the tool's validation — an old/persisted marker from a
prior version, a hand-crafted CustomEntry, or a marker whose `by_content_includes` was
later emptied — would silently substitute the first message's content on every context fire.

---

## BUG-005: mulligan_audit runs and reports a marker-transformed view when config.enabled === false
**Severity**: Minor | **File**: `src/tools/audit.ts` | **Status**: CONFIRMED

### Location: Lines 545–570 (auditExecute function body — NO config.enabled gate)

```typescript
// Line 545:
async function auditExecute(
  _toolCallId: string,
  params: Static<typeof AuditParams>,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<AgentToolResult<AuditDetails>> {
  try {
    const config = getConfig();
    const sessionId = ctx.sessionManager.getSessionId();
    const rt = getRuntime(sessionId);

    // NO CHECK: if (!config.enabled) return refusal(...)
    // The function proceeds directly to resolve the filtered view + apply markers.

    // (1) Resolve the FILTERED view...
    let filtered: Record<string, unknown>[];
    // ...
```

### Contrast: the OTHER tools DO gate on config.enabled

| Tool | File | Line | Gate |
|------|------|------|------|
| rewind | `src/tools/rewind.ts` | 478 | `if (!config.enabled) return refuse("Mulligan is disabled", granularity);` |
| shrink | `src/tools/shrink.ts` | 286 | `if (!config.enabled) return refusal("Mulligan is disabled");` |
| cancel | `src/tools/cancel.ts` | 350 | `if (!getConfig().enabled) return refusal("Mulligan is disabled");` |
| **audit** | `src/tools/audit.ts` | **NONE** | **No gate — always-on** |

(Checkpoint is also intentionally always-on per its GOTCHA #4, but it doesn't REPORT
a transformed view, so it's not misleading.)

### Impact

When `config.enabled === false`, the context handler (`contextHandler` in filter.ts,
line 455: `if (!config.enabled) return;`) is a pass-through — the model sees the
UNFILTERED context. But `auditExecute` never checks `config.enabled` and its E16-fallback
path invokes `filterPipeline`, so it reports markers as active and a filtered total that
does NOT match what the model sees — actively misleading the agent (D5 violation).

The existing source comment at line 23 explicitly documents this as intentional:
"No config gate (GOTCHA #4): ... The audit is always-on diagnostics (read-only)."
The PRD recommends either adding a gate OR documenting the intentional behavior.

---

## BUG-006: Nuclear last_turn on the first/only user message persists a no-op marker
**Severity**: Minor | **File**: `src/tools/rewind.ts` | **Status**: CONFIRMED

### Location: The code path from step 5 (resolvePreview) through step 7 (persist)

**resolveLastTurn** (src/transforms.ts, line 345) correctly returns `{ remove: [] }`
for the protected case:

```typescript
// src/transforms.ts line 345:
if (iFirstUser === iLastUser) return { remove: [] }; // nuclear refused (spec/06 §8, spec/08 E3)
```

**rewindExecute** (src/tools/rewind.ts) calls resolvePreview (step 5), which returns
`k === 0` for this case, then PERSISTS anyway:

```typescript
// Step 5 (lines 538–548): resolvePreview returns { ledger, k:0, hideEntryIds:[] }
let ledger: FileLedger;
let k: number;
let hideEntryIds: string[];
try {
  ({ ledger, k, hideEntryIds } = resolvePreview(ctx, params, toolCallId));
} catch {
  ledger = emptyLedger();
  k = 0;
  hideEntryIds = [];
}

// Step 6 (line 551): render note (no protected check)
const rendered = renderNote((params.note as NoteInput) ?? ({} as NoteInput), ledger, granularity);

// Step 7 (lines 554–579): PERSIST — no check between resolvePreview and persist
const payload = {
  granularity,
  options: { to_previous_prompt: params.to_previous_prompt, protect: config.rewind.protectedRoles },
  excludeToolCallId: toolCallId,
  note: params.note,
  ledger,
  hideEntryIds,          // [] for the protected case
  checkpoint: params.checkpoint,
};
const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput);  // PERSISTS empty marker
leaveNote(pi, rendered, markerId ?? toolCallId);                              // PERSISTS stray note
```

### Missing Check

There is NO code between resolvePreview (step 5) and persist (step 7) that detects the
nuclear-first-user protected case and refuses. The tool treats `remove === []` from
resolvePreview as a legitimate K=0 rewind (there IS a legitimate K=0 case for
`last_tool_call_group` when nothing matches), so it proceeds to persist.

The subsequent `successText()` (line 588) returns: "0 messages will be hidden ...
(nothing matched to hide). Note left." — a success text, not a refusal.

### Impact

1. Violates spec/08 E3: "the tool refuses before persisting (returns a refusal text)."
2. Consumes a depth slot toward `rewind.maxDepth` with a permanently-useless marker.
3. Leaves a stray `mulligan:note` in context.

The filter's `protectedOk()` (transforms.ts line 849) is defense-in-depth — it DOES
no-op the empty hide at filter time — but the tool-level contract (refuse + do not
persist) is not met.

---

## Summary

| Bug | Severity | File | Lines | Confirmed |
|-----|----------|------|-------|-----------|
| BUG-001 | Major | src/tools/rewind.ts | 582–623 | YES — break-after-first-clear leaves newer target labeled |
| BUG-002 | Minor | src/config.ts | 285–288 | YES — Math.floor without >= 1 guard; 0.5→0 accepted |
| BUG-003 | Minor | src/config.ts | 266–269 | YES — no Math.floor; 0.5 accepted verbatim |
| BUG-004 | Minor | src/transforms.ts | 789–795 | YES — no needle.length > 0 guard; "" matches messages[0] |
| BUG-005 | Minor | src/tools/audit.ts | 545–570 | YES — no config.enabled gate (rewind/shrink/cancel all have one) |
| BUG-006 | Minor | src/tools/rewind.ts | 538–579 | YES — no protected-refusal check between resolvePreview and persist |

### Existing Test Coverage Gaps

- BUG-001: `test/tools/rewind.test.ts` cases g/h only label a single target.
- BUG-002/003: `test/config.test.ts` tests valid + invalid values but not fractional→floor edge.
- BUG-004: `test/transforms.test.ts` does not test empty-string needle.
- BUG-005: `test/tools/audit.test.ts` does not test config.enabled=false.
- BUG-006: `test/tools/rewind.test.ts` does not test nuclear-first-user persist refusal.