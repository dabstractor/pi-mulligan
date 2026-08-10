# PRP — P1.M1.T1.S3: Tests for target-based cancel resolution

**Mode A (test-only) — no user-facing/config/API surface change.**
**Depends on:** P1.M1.T1.S2 (cancelExecute target resolution) — assumed landed verbatim per its PRP.
**Does NOT modify:** any `src/` file (S2 owns `src/tools/cancel.ts`). This PRP writes TESTS ONLY.

---

## Goal

**Feature Goal**: Add comprehensive unit tests covering the **target-based resolution path** of
`mulligan_cancel` (the branch S2 adds to `cancelExecute`: `params.target` → `resolveTargetUuid` →
covering-marker uuid), so that all 7 scenarios mandated by spec/10 §1.11 (PRD h3.72) pass and the existing
18 markerId-path tests stay green.

**Deliverable**: An extended `test/tools/cancel.test.ts` (preferred) OR a new `test/tools/cancel_target.test.ts`
containing ≥7 new describe/it blocks covering cases (a)–(g), backed by an extended `makeCtx` that also scripts
`buildContextEntries()` (the new surface call S2 introduces on the target path).

**Success Definition**:
- `npx vitest run test/tools/cancel.test.ts` is green (all existing 18 + all new target cases pass).
- `npx vitest run` (full suite) stays green.
- `npm run typecheck` (tsc --noEmit) passes.
- The new tests use DISTINCT `entry.id` vs `data.id`(uuid) fixtures and assert `appended[0].data.targetId === <uuid>`
  (NEVER the entry id) on every success case — proving the uuid mapping is intact.
- The extended `makeCtx` is **backward compatible**: existing markerId-path cases pass WITHOUT modification
  (S2 keeps the markerId path byte-for-byte and it never calls `buildContextEntries`).

## User Persona

**Target User**: The pi-mulligan maintainer (developer). There is no end-user surface for this item.
**Use Case**: Regression safety. When S2's target-resolution logic is refactored, these tests fail loudly if the
covering/LIFO/uuid-mapping contract regresses. They are the executable spec for PRD h3.72 + h2.60 step 3.
**Pain Points Addressed**: Without these tests, a bug that forwards the entry id as `targetId` (making cancels
permanent no-ops), or a LIFO bug that retires the WRONG marker when several overlap, would ship silently.

## Why

- **Acceptance gate for E21 (PRD h2.101/h2.60)**: the PRD's acceptance (a)/(b) require that cancel-by-target
  works and is unit-testable. This item delivers that unit-test layer.
- **Locks the S2 contract**: the target→message→covering-marker→uuid mapping is subtle (two arrays, two
  flattening passes, a LIFO selection, and an entry-id↔uuid indirection). Tests are the only durable way to
  encode the invariants.
- **Protects future milestones**: M2–M5 (and P2+) must not regress cancel. These tests are the guardrail.
- **Scope discipline**: this item touches ONLY test files. It does NOT modify `src/tools/cancel.ts` (S2),
  `src/filter.ts`, `src/transforms.ts`, or `src/markers.ts` — all read-only contracts.

## What

Seven target-resolution scenarios (mirroring spec/10 §1.11 / PRD h3.72), each as a vitest `describe`/`it`:

(a) **`by_tool_call_id`** → retires the uuid of the single covering marker. Two sub-cases: a **shrink** whose
    own `data.target` resolves to the matched message, and a **rewind** whose `data.hideEntryIds` includes the
    matched message's entry id. Both prove the covering check for their marker type.
(b) **`by_tool_name:"read", occurrence:"last"`** → the most-recent covering marker of the LAST read result.
    Bonus: `occurrence:"first"` resolves the FIRST read instead.
(c) **`by_content_includes:"<substr>"`** → the most-recent covering marker of a message whose content includes
    the substring. Includes the negative (substring absent → no-op).
(d) **Several markers cover → LIFO**: the highest-`seq` covering marker is retired; the others stay active.
    Cross-marker-type variant (shrink seq 1 vs rewind seq 5 → rewind wins).
(e) **No active marker covers → safe no-op** (`cancelled:false`, nothing appended). Two variants: markers exist
    but none cover the matched message; and empty snapshot (no message matches at all).
(f) **Explicit `markerId` fallback**: known id → retires that exact marker's uuid; unknown id → safe no-op.
    Plus **markerId-wins-over-target**: when both are given, the markerId path wins (proves S2's ordering).
(g) **Post-success integrity**: `cancelled:true` + `markerId` + `appendEntry` called with
    `customType:"mulligan:cancel"` and `data.targetId === <uuid>` (NOT entry id), plus envelope
    `{schema,v,kind:"cancel",seq,ts}`.

### Success Criteria

- [ ] All 7 scenarios (a)–(g) pass, each with DISTINCT entry.id vs data.id(uuid) fixtures.
- [ ] Existing 18 markerId-path tests in `cancel.test.ts` pass unchanged.
- [ ] `npx vitest run` full suite green; `npm run typecheck` green.
- [ ] The extended `makeCtx` scripts BOTH `getEntries()` AND `buildContextEntries()` and is backward compatible.

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes** — this PRP includes: the exact `makeCtx`/`makePi` extension (drop-in code), the exact fixture helpers
(`msgEntry`/`toolResult`/parameterized marker builders), the covering-logic contract (what "covers" means for
shrink vs rewind + LIFO), the 7 cases mapped to concrete fixtures+assertions, the alignment invariant between
the two fake arrays, and the verified validation commands. The implementer needs only to read
`test/tools/cancel.test.ts` (existing), `test/tools/shrink.test.ts` (the `buildContextEntries` precedent), and
`src/tools/cancel.ts` (post-S2, to confirm the no-op text strings).

### Documentation & References

```yaml
# MUST READ — the S2 implementation contract (the code under test lives in src/tools/cancel.ts AFTER S2 lands)
- file: src/tools/cancel.ts
  why: S2 rewrites step 3 of cancelExecute — adds entryIdAtMessageIndex + resolveTargetUuid, calls
        ctx.sessionManager.buildContextEntries() on the target path, keeps the markerId path byte-for-byte.
  pattern: target branch = `if (markerId non-empty string) {<old for-loop>} else if (params.target)
           { targetUuid = resolveTargetUuid(ctx, entries, params.target); }` → feeds unchanged steps 4-7.
  critical: persisted targetId === marker's uuid data.id (NEVER entry id). The no-op text for the target
            path reads "...for that target" while the markerId path reads "...with that id" — VERIFY the exact
            strings against the landed cancel.ts and pin assertions to them.

# MUST READ — the existing test file being extended (the fakes + marker fixtures live here)
- file: test/tools/cancel.test.ts
  why: Houses makePi, makeCtx (scripts getEntries ONLY — must be EXTENDED), makeRewindEntry/makeShrinkEntry/
        makeCancelEntry (must be PARAMETERIZED for hideEntryIds/target/seq), and the run()/firstText() helpers.
  pattern: vitest + hand-rolled fakes (NO vi.fn()), .js import paths, expectTypeOf, clearAll() before+after.
  gotcha: makeRewindEntry currently hardcodes excludeToolCallId but NOT hideEntryIds; makeShrinkEntry hardcodes
          target:{by_tool_call_id:"call-A"}. Both need parameterization for the target-path cases.

# MUST READ — the verified precedent for scripting buildContextEntries + msgEntry/toolResult helpers
- file: test/tools/shrink.test.ts
  why: EXACTLY the makeCtx shape we need (contextEntries + throwOnBuildContextEntries + getLeafId/getSessionId),
        plus the msgEntry(role, extra) and toolResult(toolCallId, toolName, text) fixture builders.
  pattern: msgEntry → {type:"message", id:"e-N", parentId:null, timestamp:"", message:{role, ...extra}}; the real
           sessionEntryToContextMessages returns [entry.message] for a type:"message" entry (GOTCHA #12).

# Pure resolver contract (what resolveShrinkTarget returns — drives the matched index)
- file: src/transforms.ts   (lines ~728 ShrinkTarget, ~758 resolveShrinkTarget, ~53 MessageLike)
  why: resolveShrinkTarget(messages, target) → matched INDEX or null. by_tool_call_id = first toolResult with
        toolCallId===id; by_tool_name+occurrence = last(default)/first toolResult with toolName===name;
        by_content_includes = first message (ANY role) whose stringified content includes the substring.
  critical: resolveShrinkTarget is Pi-FREE and EXPORTED — S2 imports it directly into cancel.ts.

# entryIdAtMessageIndex cursor-walk (S2 clones this from shrink.ts; explains the rewind-covering check)
- file: src/tools/shrink.ts   (function entryIdAtMessageIndex, ~line 187)
  why: Walks snapshotEntries using sessionEntryToContextMessages(e).length to map a matched MESSAGE index →
        the ENTRY id that produced it. Rewind covering = hideEntryIds.includes(that entry id).
  pattern: cursor-walk; returns entry.id when index < cursor + yield; null if missing/empty/non-string.

# appendCancelMarker (what the fake appendEntry receives — the data shape to assert in case g)
- file: src/markers.ts   (function appendCancelMarker, ~line 311)
  why: Stamps {schema:"pi-mulligan", v:1, kind:"cancel", seq, ts} over the caller {targetId} payload, calls
        pi.appendEntry("mulligan:cancel", entry), returns getLeafId() (or null). NEVER throws.

# The PRD sections this item tests (authoritative behavior contract)
- docfile: plan/005_95d30743cdd4/architecture/spec_cancel.md
  why: Full spec for mulligan_cancel incl. the target resolution → marker uuid mapping (§"Target resolution"),
        refusal/no-op conditions, and the return shape. Read for the exact confirmation/no-op text strings.
- docfile: plan/005_95d30743cdd4/architecture/m1_cancel_target_resolution.md
  why: The design doc for the target-based API incl. the covering logic (shrink covers via data.target;
        rewind covers via hideEntryIds) and LIFO selection.
```

### Current Codebase tree (test surface only)

```bash
test/
├── tools/
│   ├── cancel.test.ts      # ← EXTEND THIS (preferred) or create cancel_target.test.ts alongside
│   ├── shrink.test.ts      # PRECEDENT: makeCtx(buildContextEntries) + msgEntry/toolResult helpers
│   ├── rewind.test.ts      # PRECEDENT: makeCtx shape + clearAll discipline
│   ├── checkpoint.test.ts  # PRECEDENT: firstText() narrowing + defineTool factory seam
│   └── audit.test.ts
└── ... (other tier-1 pure-helper tests)
```

### Desired Codebase tree (files this PRP touches)

```bash
test/tools/
├── cancel.test.ts          # EXTENDED: makeCtx gains contextEntries+buildContextEntries;
│                           #   makeRewindEntry gains hideEntryIds+seq; makeShrinkEntry gains target+seq;
│                           #   +7 new describe blocks for cases (a)-(g).
└── (cancel_target.test.ts) # ALTERNATIVE: if extending cancel.test.ts risks coordination friction with
                            #   parallel S2 work, create this NEW file with its OWN copy of the fakes.
                            #   S2 touches src/ (not test/), so extending cancel.test.ts is SAFE in practice.
```

**Recommendation**: EXTEND `test/tools/cancel.test.ts`. Rationale: (1) the item explicitly says "extend the
existing makePi/makeCtx fakes"; (2) S2 modifies `src/tools/cancel.ts` only — the test file is disjoint, so there
is no merge conflict; (3) keeping all cancel tests in one file is the established pattern (shrink/rewind each
have one file). The separate-file option remains valid if your tooling flags same-file edits during parallel runs.

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (the uuid mapping is the WHOLE point): persisted targetId === marker's data.id (uuid),
// NEVER the entry.id. Use DISTINCT fixtures (entry-rw-1 / uuid-rw-1). A bug forwarding the entry id fails the
// assertion `appended[0].data.targetId === "uuid-rw-1"`.

// CRITICAL GOTCHA #2 (TWO fake arrays must align): makeCtx scripts BOTH getEntries() (markers) AND
// buildContextEntries() (the message snapshot). They are SEPARATE arrays. The rewind-covering check maps the
// matched message → its ENTRY id (via entryIdAtMessageIndex over the SNAPSHOT) → membership in hideEntryIds.
// So: the snapshot entry that yields the matched message must have an `id` that you ALSO put into some rewind's
// hideEntryIds. If they don't align, the rewind won't "cover" and the test sees a spurious no-op.

// GOTCHA #3 (markerId path never calls buildContextEntries): S2 keeps the markerId branch byte-for-byte.
// Extending makeCtx with a defaulting contextEntries:[] is BACKWARD COMPATIBLE — existing markerId tests pass
// unchanged (they never trigger the buildContextEntries arm).

// GOTCHA #4 (clearAll before AND after each test): nextSeq (inside appendCancelMarker) mutates the SHARED
// module-scoped runtime map. clearAll() from src/runtime.js resets it. Without it, a prior test's seq leaks in
// and `expect(entry.seq).toBe(1)` on the second test fails. House pattern across all tool tests.

// GOTCHA #5 (config cache reset): setConfig(undefined) in beforeEach → DEFAULT_CONFIG (enabled:true). The
// master config.enabled gate (E14) is the ONLY gate — there is NO config.cancel sub-knob. A leftover
// {enabled:false} from a disabled-refusal test would make every target-path case refuse.

// GOTCHA #6 (real sessionEntryToContextMessages, not a stub): the tool flattens snapshotEntries via the REAL
// sessionEntryToContextMessages (imported from the pi package). So msgEntry must produce a {type:"message"}
// entry whose .message is a valid shape — the fake does NOT substitute for the flattener. shrink.test.ts's
// msgEntry is the verified shape.

// GOTCHA #7 (no-op text wording may differ by path): pre-S2 not-found text is "...with that id...". The PRD
// §5 return shape says the target no-op should read "...for that target...". VERIFY the landed cancel.ts
// strings; pin assertions to the exact text (or assert the stable substring /no active marker found/ if unsure).

// GOTCHA #8 (.js ESM import paths): import from "../../src/tools/cancel.js" etc. Every test does this.
```

## Implementation Blueprint

### Data models and structure

No new data models. This item reuses the existing test fixture types (`SessionEntry`, `ExtensionAPI`,
`ExtensionContext`, `AgentToolResult<CancelDetails>`, `CancelArgs`) and the `ShrinkTarget` union from
`src/transforms.ts` (for typing parameterized shrink/rewind fixtures).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EXTEND makeCtx to script buildContextEntries (backward-compatible)
  - MODIFY: test/tools/cancel.test.ts → makeCtx
  - ADD opt: contextEntries?: SessionEntry[]  (default [])
  - ADD opt: throwOnBuildContextEntries?: boolean  (default false; mirrors shrink.test.ts)
  - ADD method to the fake sessionManager: buildContextEntries() { if(throw) throw; return contextEntries ?? []; }
  - KEEP: getSessionId/getLeafId/getEntries/throwOnGetEntries UNCHANGED (existing markerId tests rely on them)
  - FOLLOW pattern: test/tools/shrink.test.ts makeCtx (verbatim buildContextEntries arm)
  - VERIFY: existing 18 tests still pass after this change (npx vitest run test/tools/cancel.test.ts)
  - DEPENDENCIES: none (pure fake extension; no source change)

Task 2: PARAMETERIZE the marker fixtures (add the fields the target path reads)
  - MODIFY: makeRewindEntry(entryId, uuid, opts?: { seq?: number; hideEntryIds?: string[] })
      - ADD data.hideEntryIds: opts.hideEntryIds ?? []   (rewind covering reads this)
      - KEEP data.seq: opts.seq ?? 1 (already param; ensure default 1)
      - KEEP excludeToolCallId/note/ledger envelope (realistic; the tool ignores them)
  - MODIFY: makeShrinkEntry(entryId, uuid, opts?: { seq?: number; target?: ShrinkTarget })
      - ADD data.target: opts.target ?? { by_tool_call_id: "call-A" }   (shrink covering resolves this)
      - KEEP data.seq default 1
  - KEEP: makeCancelEntry(targetId, seq) UNCHANGED (already parameterized; seeds the already-cancelled case)
  - NAMING: keep the existing function names (extend signature; do NOT rename — other tests/cases use them)
  - GOTCHA: changing the signature from (entryId, uuid, seq=1) to (entryId, uuid, opts={}) — update the FEW
            existing call sites (Cases 1-4 use positional seq). Prefer opts object for new clarity; OR keep
            seq positional and add an optional 4th opts arg for the new fields. Choose ONE and be consistent.

Task 3: ADD msgEntry + toolResult message-fixture helpers (copy from shrink.test.ts)
  - ADD to test/tools/cancel.test.ts (or import-clone): the msgEntry(role, extra) + toolResult(toolCallId,
    toolName, text) helpers shrink.test.ts defines (verbatim — they build the buildContextEntries snapshot).
  - WHY: the target path flattens snapshotEntries via the REAL sessionEntryToContextMessages, which returns
    [entry.message] for a {type:"message"} entry. msgEntry produces exactly that shape.
  - NAMING: module-private function `msgEntry` + `toolResult` (same names as shrink.test.ts for grep parity).

Task 4: WRITE case (a) — by_tool_call_id (shrink covers + rewind covers)
  - DESCRIBE: "mulligan_cancel — target by_tool_call_id retires the covering marker's uuid"
  - CASE a1 (shrink): contextEntries=[msgEntry("toolResult",toolResult("call-A","read","big log"))];
        entries=[makeShrinkEntry("entry-sh-1","uuid-sh-1",{target:{by_tool_call_id:"call-A"},seq:1})];
        run({target:{by_tool_call_id:"call-A"}}).
        ASSERT: cancelled:true; appended.length 1; appended[0].targetId==="uuid-sh-1" (NOT "entry-sh-1").
  - CASE a2 (rewind): same contextEntries; entries=[makeRewindEntry("entry-rw-1","uuid-rw-1",
        {hideEntryIds:["e-1"],seq:1})] where "e-1" is the msgEntry's entry id;
        run({target:{by_tool_call_id:"call-A"}}).
        ASSERT: appended[0].targetId==="uuid-rw-1".
  - DEPENDENCIES: Tasks 1-3.

Task 5: WRITE case (b) — by_tool_name:"read" + occurrence last/first
  - DESCRIBE: "mulligan_cancel — target by_tool_name+occurrence (last/first read)"
  - FIXTURE: contextEntries=[msgEntry("toolResult",toolResult("c1","read","first")),
            msgEntry("toolResult",toolResult("c2","read","second"))].
  - LAST: a shrink target {by_tool_name:"read",occurrence:"last"} covers idx 1 → retire its uuid.
  - FIRST: a shrink target {by_tool_name:"read",occurrence:"first"} covers idx 0 → retire THAT uuid.
  - ASSERT occurrence selector is honored (different uuid retired for last vs first).
  - DEPENDENCIES: Tasks 1-3.

Task 6: WRITE case (c) — by_content_includes (match + negative)
  - DESCRIBE: "mulligan_cancel — target by_content_includes (substring match)"
  - MATCH: contextEntries=[msgEntry("toolResult",toolResult("call-A","bash",'df ... "ENOSPC at /disk"'))];
        a shrink target {by_content_includes:"ENOSPC"} covers → retire its uuid.
  - NEGATIVE: substring "ZZZ-NOT-PRESENT" → resolveShrinkTarget returns null → no marker covers → no-op
        (cancelled:false, appended.length 0). (This also seeds case e.)
  - DEPENDENCIES: Tasks 1-3.

Task 7: WRITE case (d) — several markers cover → LIFO by seq
  - DESCRIBE: "mulligan_cancel — multiple covering markers retire the MOST RECENT (LIFO by seq)"
  - SAME-TYPE: two shrinks both covering idx 0, seq 1 (uuid-sh-old) and seq 5 (uuid-sh-new) → retire uuid-sh-new.
  - CROSS-TYPE: shrink seq 1 (covers via target) + rewind seq 5 (covers via hideEntryIds:["e-1"]) → rewind wins.
  - ASSERT: appended.length EXACTLY 1; targetId === the higher-seq uuid; the lower-seq marker is NOT retired
        (only one cancel appended).
  - DEPENDENCIES: Tasks 1-3.

Task 8: WRITE case (e) — no active marker covers → safe no-op
  - DESCRIBE: "mulligan_cancel — no covering marker is a safe no-op (cancelled:false)"
  - VARIANT 1 (markers exist, none cover): contextEntries=[msgEntry("toolResult",toolResult("call-Z","read","x"))];
        entries=[makeShrinkEntry("entry-sh-1","uuid-sh-1",{target:{by_tool_call_id:"call-B"}})] (call-B ≠ call-Z).
        run({target:{by_tool_call_id:"call-A"}}) → matchedIndex null (no "call-A") → no-op.
  - VARIANT 2 (empty snapshot): contextEntries=[] → resolveShrinkTarget over [] → null → no-op.
  - ASSERT: appended.length 0; details {cancelled:false}; text matches the target no-op string (VERIFY per
        research/target_resolution_contract.md — pin to landed cancel.ts text).
  - DEPENDENCIES: Tasks 1-3.

Task 9: WRITE case (f) — explicit markerId fallback (+ markerId-wins-over-target)
  - DESCRIBE: "mulligan_cancel — explicit markerId fallback (and markerId wins over target)"
  - KNOWN: entries=[makeRewindEntry("entry-rw-1","uuid-rw-1")]; run({markerId:"entry-rw-1"}) → retire uuid-rw-1.
  - UNKNOWN: run({markerId:"nope"}) → no-op; appended.length 0; details {cancelled:false}.
  - MARKERID-WINS: entries has BOTH a target-matchable shrink (uuid-sh) AND the markerId rewind (uuid-rw);
        run({target:{by_tool_call_id:"call-A"}, markerId:"entry-rw-1"}) → markerId path wins;
        appended[0].targetId==="uuid-rw-1" (NOT uuid-sh).
  - NOTE: the markerId path does NOT call buildContextEntries — contextEntries can be omitted/empty here.
  - DEPENDENCIES: Tasks 1-3 (these cases may reuse the EXISTING markerId cases; add the wins-over-target one).

Task 10: WRITE case (g) — post-success integrity (layered on a representative success)
  - DESCRIBE: "mulligan_cancel — success appends mulligan:cancel with targetId===uuid + envelope"
  - REPURPOSE a success case (e.g. Task 4 a1) and assert the FULL persisted shape:
        appended[0].customType==="mulligan:cancel"; data.{schema:"pi-mulligan", v:1, kind:"cancel",
        targetId===<uuid>, seq:number (first marker=1), ts:number(≤Date.now())}; details {cancelled:true,
        markerId:"leaf-1"}; text === "Mulligan: marker cancelled. The transform will no longer applies from the
        next turn on."  (VERIFY exact text against landed cancel.ts.)
  - DEPENDENCIES: Tasks 1-3.
```

### Implementation Patterns & Key Details

```ts
// ── The extended makeCtx (drop-in; shrink.test.ts precedent) ─────────────────────────────────────────
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  entries?: SessionEntry[];            // getEntries()  — markers (rewind/shrink/cancel)
  contextEntries?: SessionEntry[];     // buildContextEntries() — the message snapshot   ← NEW
  throwOnGetEntries?: boolean;
  throwOnBuildContextEntries?: boolean; //                                                ← NEW
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const scriptedLeafId: string | null = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  const entries = opts.entries ?? [];
  const contextEntries = opts.contextEntries ?? [];
  const sessionManager = {
    getSessionId() { return sessionId; },
    getLeafId() { return scriptedLeafId; },
    getEntries() {
      if (opts.throwOnGetEntries) throw new Error("getEntries boom");
      return entries;
    },
    buildContextEntries() {                                          // ← NEW (mirrors shrink.test.ts)
      if (opts.throwOnBuildContextEntries) throw new Error("buildContextEntries boom");
      return contextEntries;
    },
  };
  return { ctx: { sessionManager } as unknown as ExtensionContext };
}

// ── The covering contract under test (what S2's resolveTargetUuid does) ─────────────────────────────
// matchedIndex = resolveShrinkTarget(messages, target)   // messages = snapshotEntries.flatMap(sessionEntryToContextMessages)
// matchedEntryId = entryIdAtMessageIndex(snapshotEntries, matchedIndex)
// for each marker in entries (getEntries):
//   SHRINK covers  iff resolveShrinkTarget(messages, marker.data.target as ShrinkTarget) === matchedIndex
//   REWIND covers  iff Array.isArray(marker.data.hideEntryIds) && marker.data.hideEntryIds.includes(matchedEntryId)
//   LIFO: highest data.seq wins (seqNum defaults to 0 if malformed)

// ── A representative target-path success case (case a1: shrink covers via its own target) ───────────
it("by_tool_call_id: retires the shrink whose target resolves to the matched message", async () => {
  const { appended, pi } = makePi();
  const matchedEntry = msgEntry("toolResult", toolResult("call-A", "read", "big log"));  // id "e-1", idx 0
  const { ctx } = makeCtx({
    contextEntries: [matchedEntry],                                     // the SNAPSHOT (buildContextEntries)
    entries: [                                                          // the MARKERS (getEntries)
      makeShrinkEntry("entry-sh-1", "uuid-sh-1", { target: { by_tool_call_id: "call-A" }, seq: 1 }),
    ],
  });
  const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });
  expect(firstText(res)).toBe(
    "Mulligan: marker cancelled. The transform will no longer apply from the next turn on.",
  );
  expect(res.details).toEqual({ cancelled: true, markerId: "leaf-1" });
  expect(appended).toHaveLength(1);
  expect(appended[0].customType).toBe("mulligan:cancel");
  expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-sh-1"); // uuid, NOT "entry-sh-1"
});

// ── A representative LIFO case (case d: higher seq wins) ────────────────────────────────────────────
it("LIFO: when two markers cover, the higher-seq one is retired", async () => {
  const { appended, pi } = makePi();
  const matchedEntry = msgEntry("toolResult", toolResult("call-A", "read", "x"));
  const { ctx } = makeCtx({
    contextEntries: [matchedEntry],
    entries: [
      makeShrinkEntry("entry-sh-old", "uuid-sh-old", { target: { by_tool_call_id: "call-A" }, seq: 1 }),
      makeShrinkEntry("entry-sh-new", "uuid-sh-new", { target: { by_tool_call_id: "call-A" }, seq: 5 }),
    ],
  });
  await run(pi, ctx, { target: { by_tool_call_id: "call-A" } });
  expect(appended).toHaveLength(1);                                     // exactly ONE cancel
  expect((appended[0].data as Record<string, unknown>).targetId).toBe("uuid-sh-new"); // higher seq wins
});
```

### Integration Points

```yaml
TEST RUNNER:
  - command: "npx vitest run test/tools/cancel.test.ts"   # single file (verify after each task)
  - command: "npm test"  /  "npx vitest run"              # full suite (regression gate)
  - command: "npm run typecheck"                          # tsc --noEmit (catches fixture type drift)

NO SOURCE CHANGES:
  - this PRP touches ONLY test/tools/cancel.test.ts (or a new test/tools/cancel_target.test.ts)
  - do NOT modify src/tools/cancel.ts (S2 owns it), src/transforms.ts, src/markers.ts, src/filter.ts, src/config.ts
  - do NOT modify any other test file

NO CONFIG / DATABASE / ROUTE CHANGES:
  - test-only; setConfig(undefined) resets to DEFAULT_CONFIG per test (GOTCHA #5)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck the extended test file (catches fixture type drift, wrong SessionEntry shape, missing imports)
npm run typecheck
# Expected: zero errors. If errors, READ them — most likely a msgEntry cast or a makeShrinkEntry signature change.

# (No separate lint step in package.json — vitest + tsc are the gates. If ruff/eslint is later added, run it.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the extended cancel test file in isolation — verify EVERY new case + the existing 18 pass
npx vitest run test/tools/cancel.test.ts -t "target"          # only the new target-path describes (fast feedback)
npx vitest run test/tools/cancel.test.ts                       # ALL cancel tests (existing 18 + new)

# Full suite — regression gate (cancel must not break shrink/rewind/audit/filter/etc.)
npx vitest run
# Expected: all green. If a NON-cancel test fails, you likely broke a shared fake or the runtime seq map
# (re-check clearAll discipline — GOTCHA #4).
```

### Level 3: Integration Testing (System Validation)

```bash
# (N/A for a test-only item — there is no server/endpoint to hit. The "integration" is the full vitest suite
# above, which exercises the real src/tools/cancel.ts against the fakes.)

# If a smoke run is desired to confirm the tool wiring end-to-end:
npm run smoke   # test/integration/run-smoke.mjs — optional; not required for this item's acceptance
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Target-path mutation check (manual, optional but HIGH-VALUE): temporarily break S2's cancel.ts to confirm the
# new tests actually CATCH regressions. E.g. in src/tools/cancel.ts resolveTargetUuid, make the LIFO pick the
# LOWEST seq instead of highest → case (d) should now FAIL. Revert after confirming. This proves the tests are
# not vacuous (a green test that would also pass on broken code is worthless).

# Verify the uuid-vs-entry-id guard: temporarily forward entry.id as targetId in cancel.ts → case (a) and (g)
# must FAIL (targetId assertion expects the uuid). Revert.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` passes (zero errors).
- [ ] `npx vitest run test/tools/cancel.test.ts` — all existing 18 + all new target cases green.
- [ ] `npx vitest run` (full suite) green — no regression in shrink/rewind/audit/filter/transforms/etc.
- [ ] No new lint/format errors (if a linter is configured).

### Feature Validation

- [ ] All 7 scenarios (a)–(g) from spec/10 §1.11 pass.
- [ ] DISTINCT entry.id vs data.id(uuid) fixtures used on every success case (targetId === uuid, never entry id).
- [ ] LIFO case (d) retires the HIGHEST-seq covering marker; the other stays active (exactly ONE cancel appended).
- [ ] No-op case (e) appends NOTHING and returns `{cancelled:false}`.
- [ ] markerId-wins-over-target (case f) retires the markerId marker, not the target-resolved one.
- [ ] The extended makeCtx is backward compatible (existing markerId-path tests pass UNCHANGED).
- [ ] clearAll() before AND after each test (GOTCHA #4); setConfig(undefined) per test (GOTCHA #5).

### Code Quality Validation

- [ ] Follows existing cancel.test.ts / shrink.test.ts idioms (vitest, hand-rolled fakes, NO vi.fn(), .js imports,
      expectTypeOf, firstText() narrowing guard).
- [ ] Fixture helpers (msgEntry/toolResult) copied faithfully from shrink.test.ts (same shape the real
      sessionEntryToContextMessages expects).
- [ ] Each describe block has a clear doc-comment tying it to the spec/10 §1.11 case letter.
- [ ] No anti-patterns: no `any` casts where a typed fixture works; no skipping assertions with `.todo`/`.skip`.

### Documentation & Deployment

- [ ] [Mode A] no user-facing docs required (per SOW §5 — docs ride with the implementing subtask S2, not S3).
- [ ] Test file header doc-comment updated to list the new target-path coverage (the 7 cases).

---

## Anti-Patterns to Avoid

- ❌ Don't use `vi.fn()` for the fakes — the house pattern is hand-rolled objects (shrink.test.ts/rewind.test.ts).
- ❌ Don't stub `sessionEntryToContextMessages` — the tool uses the REAL one; your msgEntry must produce a valid
  `{type:"message"}` entry (shrink.test.ts GOTCHA #12).
- ❌ Don't reuse the SAME value for entry.id and data.id(uuid) — that hides the uuid-mapping bug the tests exist
  to catch (CRITICAL GOTCHA #1). ALWAYS distinct.
- ❌ Don't forget to align the two fake arrays (CRITICAL GOTCHA #2): the rewind's hideEntryIds must contain the
  ENTRY id of the snapshot message that matched, or the rewind won't "cover."
- ❌ Don't skip clearAll() — seq leaks across tests and flaky-fails `expect(entry.seq).toBe(1)`.
- ❌ Don't modify `src/` — this is a test-only item; S2 owns the implementation.
- ❌ Don't assert the exact no-op text string blindly — VERIFY it against the landed cancel.ts (the target-path
  and markerId-path no-op texts may differ; pin to the real string or assert the stable substring).
- ❌ Don't write vacuous tests — run the mutation check (Level 4) on at least case (d) and case (g) to confirm
  the tests fail when the code is broken.

---

## Confidence Score: 9/10

**Why 9, not 10**: The S2 implementation (the code under test) is specified by its PRP but is being implemented
in PARALLEL. There is one residual uncertainty — the EXACT no-op/confirmation text strings S2 lands (the PRD
says "...for that target" but the pre-S2 code says "...with that id"). This PRP flags it (GOTCHA #7) and tells
the implementer to VERIFY and pin. Everything else — the fakes, the fixtures, the covering contract, the LIFO
rule, the uuid-mapping, the validation commands — is concretely specified with drop-in code and verified against
the live codebase. An implementer who reads this PRP + the two precedent test files + the landed cancel.ts can
write all 7 cases correctly on the first pass.