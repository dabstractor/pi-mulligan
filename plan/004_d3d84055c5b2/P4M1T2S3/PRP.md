# PRP — P4.M1.T2.S3: Suppress drift nudge for a turn in which a rewind was refused (SHOULD/advisory)

**Parent**: P4.M1.T2 (Rewind tool guards) — runs **after** S1 (retry budget) and S2 (context-fraction stop),
which are the MUST hard backstops for E22. This S3 is the **SHOULD** advisory refinement: even when the
MUST guards refuse a rewind, the per-turn **drift nudge (Nudge B)** can keep poking the agent to *try again*,
re-amplifying the stuck turn. S3 makes a refused rewind silently mute the drift nudge for the remainder of
that turn. If time-boxed, S1+S2 alone arrest the runaway; S3 is polish.

**Spec refs**: `spec/07-preventive-and-nudges.md` §2 Edge cases ("The nudge SHOULD additionally be
suppressed for the remainder of any turn in which a rewind was refused (any reason), so a capped/stuck
turn stops being poked (`@08-edge-cases.md` E22).") + `spec/08-edge-cases.md` E22 (last bullet of Acceptance).

---

## Goal

**Feature Goal**: When `mulligan_rewind` is refused for **any reason** (disabled config, invalid note,
checkpoint missing, maxDepth, the new retry-budget/context-fraction backstops, or an unexpected error),
the per-turn drift nudge (`Nudge B`, injected by `filter.ts` `contextHandler`) MUST be suppressed for the
**remainder of that same turn**, and MUST re-enable once the turn advances. Never throws (E13); no
user-facing or config surface change (Mode A docs).

**Deliverable**:
1. `src/runtime.ts` — new in-memory field `rewindRefusedTurnIndex: number | null` on `SessionRuntime`
   (default `null`), modelled exactly on the existing `aboveHighWater: boolean` field.
2. `src/tools/rewind.ts` — obtain the per-session runtime + latest turn index **once**; set the flag on
   **every** refusal path (DRY closure); import `getRuntime` + `readMarkers`.
3. `src/filter.ts` — the drift-nudge `if`-block gains one conjunct (suppress when
   `rt.rewindRefusedTurnIndex === markers.metric.turnIndex`); a defensive clear sets the flag back to
   `null` once the turn advances.
4. Tests across `test/runtime.test.ts`, `test/filter.test.ts`, `test/tools/rewind.test.ts`.

**Success Definition**: A refused rewind this turn → the next `context` fires (within the same turn) inject
**no** drift nudge; after the turn advances (new `turn_end` metric) the flag clears and the nudge fires
again normally. All existing drift-nudge tests stay green (the flag defaults to `null` = no-op).

## Why

- The MUST backstops (S1 retry budget, S2 context fraction) **refuse** a looping rewind — but the drift
  nudge is computed independently in `filter.ts` and, if it fires on the same stuck turn, tells the agent
  "consider `mulligan_rewind` …" right after a rewind was just refused. That is a contradictory poke that
  can re-amplify the loop the backstops just arrested.
- This is the spec's named SHOULD ("a capped/stuck turn stops being poked"). It costs ~one in-memory
  number + one `&&` conjunct; zero extra requests; zero persisted bytes.

## What

- **User-visible behavior**: none directly. (Indirectly: the agent stops getting a "rewind/shrink" hint on
  a turn where rewinding was already refused.)
- **Technical requirement**: a per-session, non-persisted turn-index flag latched at refusal time, read by
  the filter's drift-nudge gate, cleared on turn advancement.

### Success Criteria

- [ ] `SessionRuntime` has `rewindRefusedTurnIndex: number | null` (default `null`); `freshRuntime` returns
      it; `resetRuntime`/`clearAll` wipe it automatically (no change needed there).
- [ ] Every refusal path in `rewindExecute` (9 sites: E14, rewind-disabled, E9, checkpoint-name-required,
      E10, E4 maxDepth, 4b retry-budget, 4c context-fraction, catch-all unexpected) sets
      `rt.rewindRefusedTurnIndex = currentTurnIndex` before returning, **defensively** (never throws).
- [ ] `filter.ts` drift-nudge block suppresses injection when `rt.rewindRefusedTurnIndex === markers.metric.turnIndex`,
      and clears the flag to `null` once `markers.metric.turnIndex` differs.
- [ ] No existing test regresses (flag defaults to `null` → `null !== <number>` → nudge proceeds).
- [ ] Never throws on any flag read/set (E13). Mode A docs — **no** README/config change.

---

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this successfully?_
**Yes** — the three files, exact refusal sites, the field model, the import precedent, and the test idioms are
all pinned below with verified line anchors.

### Documentation & References

```yaml
# MUST READ — the authoritative spec sentence driving this task
- url: spec/07-preventive-and-nudges.md §2 "Edge cases" (last bullet)
  why: "The nudge SHOULD additionally be suppressed for the remainder of any turn in which a rewind was
        refused (any reason), so a capped/stuck turn stops being poked (@08-edge-cases.md E22)."
  critical: This is the ENTIRE behavioral spec for S3. Everything else is mechanical wiring.

- url: spec/08-edge-cases.md E22 (Acceptance bullet referencing drift-nudge suppression)
  why: Ties the SHOULD to the E22 runaway-loop backstop. S1 (retry budget) + S2 (context fraction) are the
        MUST guards; S3 is the advisory nudge-mute that rides on their refusal paths.

# Architecture research (verified against HEAD 0bcaa814) — the blueprint for THIS task
- docfile: plan/004_d3d84055c5b2/architecture/codebase_patterns.md
  section: "§5 runtime.ts — the rewindRefusedTurnIndex model" + "§6 filter.ts — the drift-nudge suppression gate"
  why: Pins exact line numbers, the aboveHighWater field to mirror, the drift-nudge if-block, the refusal()
        helper signature, and the countRewindMarkers defensive-scan MODEL.

# The three source files to edit (read fully before editing)
- file: src/runtime.ts
  why: Add the new field. `aboveHighWater` is the EXACT model (in-memory, latched, auto-reset by
        resetRuntime/clearAll which wipe the whole map entry).
  pattern: interface field with JSDoc + matching `freshRuntime()` literal default `null`.
  gotcha: resetRuntime DELETES the map entry (C12 discipline) and clearAll clears the map — so adding a
          field needs NO change to either; they wipe the whole entry automatically.

- file: src/tools/rewind.ts
  why: Set the flag on every refusal. `refusal(reason, gran)` is module-local and adds the
        "Mulligan: refused — " prefix + trailing "."; callers pass the bare reason (NO prefix, NO trailing dot).
  pattern: whole `rewindExecute` body is ONE try/catch; refusal is a plain `return refusal(...)`. Steps in
        order: (1) config gate [E14, rewind-disabled], (2) note validation [E9], (3) checkpoint existence
        [name-required, E10], (4) maxDepth [E4], (4b) retry-budget [from S1], (4c) context-fraction [from S2],
        (5) read-only ledger + K preview, (6) renderNote, (7) appendRewindMarker+leaveNote, (8) mutation
        warning, (9) success.
  gotcha: rewind.ts does NOT currently import getRuntime or readMarkers — S3 must add BOTH. Precedent:
          src/tools/audit.ts line 51 already does `import { readMarkers } from "../filter.js";` — rewind
          importing it is the same, already-proven, cycle-free pattern (filter.ts imports
          transforms/runtime/config/log/tokens/markers/nudges; NONE import rewind).

- file: src/filter.ts
  why: Read the flag in the drift-nudge block. `contextHandler(pi, event, ctx)` is ONE try/catch (fail-open
        E13). `rt = getRuntime(sessionId)` and `markers = readMarkers(ctx)` are BOTH already in scope at the
        drift-nudge block. `markers.metric` is the LATEST turn-metric (highest seq) or null.
  pattern: the drift-nudge block is `if (config.nudges.perTurnDrift && markers.recentMetrics && ... &&
        shouldNudge(...) && markers.metric && !suppressCheck(...)) { messages = injectNudge(...); }`.
  gotcha: `suppressCheck` (same-turn rewind/shrink MARKER suppression) is a SEPARATE mechanism — do NOT
          remove or alter it; the S3 conjunct is ADDITIVE.

# Markers type (the turn-index source of truth)
- file: src/markers.ts
  why: `TurnMetric` (line 140, `export interface TurnMetric extends MulliganEnvelope`) has field
        `turnIndex: number` (line 151-152, "from turn_end event.turnIndex"). This is the exact value the
        filter compares against, so set the flag FROM the same readMarkers().metric.turnIndex for guaranteed
        agreement (rt.lastTurnIndex is the in-memory fallback, same value during a turn, but null
        post-reload before the first turn_end — hence metric-first).

# Sibling PRP (assume it lands as specified) — defines the (4c) refusal path S3 must ALSO cover
- file: plan/004_d3d84055c5b2/P4M1T2S2/PRP.md
  why: S2 adds the (4c) context-fraction guard (`return refusal(\`context is at ${pct}% ...\`, granularity)`)
        AFTER (4b) and BEFORE (5). That is a NEW refusal path S3 must set the flag on. S2 also proves tools
        may import from filter.ts (audit already does).
```

### Current Codebase tree (the relevant slice)

```bash
src/
  runtime.ts            # SessionRuntime interface + freshRuntime + getRuntime/resetRuntime/clearAll  ← EDIT
  filter.ts             # contextHandler + readMarkers (EXPORTED) + drift-nudge block                ← EDIT
  markers.ts            # TurnMetric{ turnIndex: number } (read-only ref)
  tools/
    rewind.ts           # rewindExecute + refusal() + 9 refusal sites                                ← EDIT
    audit.ts            # (precedent: imports readMarkers from ../filter.js line 51)
test/
  runtime.test.ts       # "exact default shape" + resetRuntime shape assertions                       ← EDIT
  filter.test.ts        # contextHandler drift-nudge tests (lines 453-490)                            ← EDIT (add)
  tools/rewind.test.ts  # makePi/makeCtx fakes (scripts getSessionId→"s1", getEntries)                ← EDIT (add)
```

### Desired Codebase tree with files to be added/edited

```bash
src/runtime.ts          # + field rewindRefusedTurnIndex: number | null (interface + freshRuntime)
src/tools/rewind.ts     # + imports getRuntime/readMarkers; + rt acquisition; + refuse() closure; rename 9 sites
src/filter.ts           # + suppress conjunct in drift-nudge block; + defensive clear on turn advance
test/runtime.test.ts    # + rewindRefusedTurnIndex: null in 2 shape assertions; + mutability/isolation test
test/filter.test.ts     # + 2 tests (suppress-same-turn; clear-on-advance + re-enable)
test/tools/rewind.test.ts  # + test: refusal sets flag to metric.turnIndex; success leaves it null; no-metric→null
# NO new files. NO config change. NO README change (Mode A).
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: resetRuntime(sessionId) DELETES the map entry (C12 discipline — stale references abandoned),
// and clearAll() clears the map. So adding a SessionRuntime field needs NO change to either; they wipe the
// whole entry. Just add to interface + freshRuntime. (architecture §5.)

// CRITICAL: the flag MUST be read/set defensively (E13). In rewind.ts the whole execute body is one try/catch,
// so set the flag inside a try/catch so a flag failure can't masquerade as the tool's own error. In filter.ts,
// wrap the flag CLEAR in a try/catch so a failure there cannot take down the whole contextHandler (which would
// return undefined → no filter applied at all — far worse than a missed nudge).

// GOTCHA: readMarkers(ctx) does a full getEntries() scan — but rewind.ts already scans entries multiple times
// (countRewindMarkers, countRetriesAtLatestPrompt, checkpointExists), so one more read is consistent cost.

// GOTCHA: `markers.metric` is the LATEST turn-metric (highest seq) or null. It is only non-null after at least
// one turn_end has fired this session. Guard every `.metric.turnIndex` access. The drift-nudge if-block already
// gates on `markers.metric` truthiness, so the S3 conjunct after it is safe.

// GOTCHA: refusal(reason, gran) is module-local in rewind.ts and adds the "Mulligan: refused — " prefix AND a
// trailing ".". Callers pass the bare reason. Do NOT re-add the prefix. (This is why we keep refusal() pure and
// set the flag in a thin refuse() wrapper around it, not inside refusal().)

// GOTCHA: this is a SHOULD. If the flag is ever left stale (e.g. clear logic skipped), the WORST case is one
// nudge not shown — never a crash, never a wrong rewind. Fail-OPEN on every path.
```

---

## Implementation Blueprint

### Data model & structure

A single new **in-memory, non-persisted** field — no persisted marker, no config knob, no schema bump.

```ts
// src/runtime.ts — SessionRuntime (add as the LAST interface field, after aboveHighWater)
/** [P4.M1.T2.S3] The turn index in which a mulligan_rewind was most recently refused (any reason), or null.
 *  Latched by every refusal path in tools/rewind.ts (defensively, E13); read by filter.ts to suppress Nudge B
 *  for the remainder of that turn; cleared (→ null) once the turn advances (next context fire sees a different
 *  latest metric turnIndex). Mirrors aboveHighWater: in-memory, non-persisted; auto-reset by resetRuntime
 *  (session_start) and clearAll (shutdown), which already wipe the whole map entry (C12). Default: null. */
rewindRefusedTurnIndex: number | null;

// src/runtime.ts — freshRuntime() (add as the LAST literal property, after `aboveHighWater: false,`)
rewindRefusedTurnIndex: null,
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/runtime.ts — add the field
  - ADD to SessionRuntime interface (after the `aboveHighWater: boolean;` field, as the LAST field):
        rewindRefusedTurnIndex: number | null;   (+ the JSDoc block above)
  - ADD to freshRuntime() return literal (after `aboveHighWater: false,`):
        rewindRefusedTurnIndex: null,
  - DO NOT touch resetRuntime / clearAll / getRuntime / nextSeq — they wipe/walk the entry generically.
  - VERIFY: `npm run build` (tsc) passes; the new field is `number | null`, default `null`.
  - PLACEMENT: last field of the interface + last property of freshRuntime (keeps the diff contiguous with
    aboveHighWater, its documented twin).

Task 2: EDIT src/tools/rewind.ts — set the flag on EVERY refusal (DRY closure)
  - ADD imports (top import block, alongside existing ../markers.js / ../config.js imports):
        import { getRuntime } from "../runtime.js";
        import { readMarkers } from "../filter.js";   // precedent: src/tools/audit.ts line 51
    (If you type a local as SessionRuntime, also: `import type { SessionRuntime } from "../runtime.js";`)
  - IN rewindExecute, AFTER `const granularity: Granularity = ...;` and BEFORE the main `try {`, add the
    defensive rt + currentTurnIndex acquisition (declared OUTSIDE the try so the catch can also use them):
        // [P4.M1.T2.S3] latch the turn index so filter.ts can mute Nudge B for the rest of this turn on a refusal.
        let rt: SessionRuntime | null = null;
        let currentTurnIndex: number | null = null;
        try {
          rt = getRuntime(ctx.sessionManager.getSessionId());
          currentTurnIndex = readMarkers(ctx).metric?.turnIndex ?? rt.lastTurnIndex ?? null;
        } catch {
          // E13: leave nulls → flag never set this turn (nudge behaves as before; fail-open).
        }
  - AT THE TOP OF THE MAIN try body (the existing try that wraps all steps), define a thin refusal wrapper
    that sets the flag then delegates to the pure refusal() builder:
        // [P4.M1.T2.S3] DRY: every in-try refusal routes here so the flag is set in ONE place (no site missed).
        const refuse = (reason: string, gran: Granularity): AgentToolResult<RewindDetails> => {
          try {
            if (rt !== null && currentTurnIndex !== null) rt.rewindRefusedTurnIndex = currentTurnIndex;
          } catch {
            /* E13 — never throw on the flag-set */
          }
          return refusal(reason, gran);
        };
  - RENAME every in-try `return refusal(...)` → `return refuse(...)` at all 8 in-try sites:
        (1) `!config.enabled`        → refuse("Mulligan is disabled", granularity)            [E14]
        (2) `!config.rewind.enabled` → refuse("rewind is disabled", granularity)
        (3) invalid note             → refuse(NOTE_INVALID_REASON, granularity)               [E9]
        (4) checkpoint no name       → refuse("checkpoint granularity requires a checkpoint name", "checkpoint")
        (5) checkpoint not found     → refuse(`checkpoint '${name}' not found on this branch`, "checkpoint")  [E10]
        (6) maxDepth                 → refuse(`max rewind depth ...`, granularity)            [E4]
        (7) (4b) retry budget        → refuse(`hit the per-prompt retry budget ...`, granularity)   [from S1]
        (8) (4c) context fraction    → refuse(`context is at ${pct}% ...`, granularity)             [from S2]
    NOTE: keep each reason string EXACTLY as-is (refusal() adds the prefix + trailing dot). The two literal
    "checkpoint" granularities (sites 4,5) are valid Granularity values — pass them through unchanged.
  - IN THE CATCH block (site 9, the catch-all unexpected-error refusal — OUTSIDE the refuse() closure's scope),
    set the flag inline BEFORE the existing `return refusal(...)`:
        try {
          if (rt !== null && currentTurnIndex !== null) rt.rewindRefusedTurnIndex = currentTurnIndex;
        } catch { /* E13 */ }
        return refusal(`unexpected error: ${e instanceof Error ? e.message : String(e)}`, granularity);
  - DO NOT change refusal() itself, the success path, or any guard logic. A SUCCESSFUL rewind must NOT set the
    flag (leave it whatever it was). VERIFY all 9 sites covered: grep `return refusal\|return refuse` in rewind.ts.
  - DEPENDENCY: Task 1 (needs the field to exist). ASSUMES S1+S2 landed (the (4b)/(4c) guards exist).

Task 3: EDIT src/filter.ts — read the flag in the drift-nudge block + clear on advance
  - contextHandler already computes `rt = getRuntime(sessionId)` and `markers = readMarkers(ctx)` BEFORE the
    drift-nudge block — both are in scope. No new import needed (filter.ts already imports getRuntime).
  - IMMEDIATELY BEFORE the drift-nudge `if (...) { messages = injectNudge(...); }` block, add the defensive
    clear (runs on EVERY context fire, independent of config.nudges.perTurnDrift):
        // [P4.M1.T2.S3] clear the refused-rewind flag once the turn has advanced past it (fail-open, E13).
        try {
          if (
            rt.rewindRefusedTurnIndex !== null &&
            markers.metric != null &&
            rt.rewindRefusedTurnIndex !== markers.metric.turnIndex
          ) {
            rt.rewindRefusedTurnIndex = null;
          }
        } catch {
          /* E13 — never let a flag clear take down the whole contextHandler */
        }
  - ADD ONE conjunct as the LAST condition of the drift-nudge if-block (AFTER `!suppressCheck(...)`), so the
    existing `markers.metric` truthiness guard makes `.turnIndex` access safe:
        && rt.rewindRefusedTurnIndex !== markers.metric.turnIndex
    Full block after edit:
        if (
          config.nudges.perTurnDrift &&
          markers.recentMetrics &&
          markers.recentMetrics.length > 0 &&
          shouldNudge(markers.recentMetrics, config) &&
          markers.metric &&
          !suppressCheck(markers.metric, markers) &&
          rt.rewindRefusedTurnIndex !== markers.metric.turnIndex   // [P4.M1.T2.S3] mute on a refused rewind this turn
        ) {
          messages = injectNudge(messages, markers.metric);
        }
  - DO NOT touch suppressCheck, injectNudge, the high-water block, or the rt.lastFiltered cache write.
  - VERIFY: when the flag is null (the default), `null !== <number>` is true → nudge proceeds (no regression).

Task 4: EDIT test/runtime.test.ts — assert the new default + mutability
  - In the "exact default shape" assertion object (the `expect(rt).toEqual({ ... })` at ~line 24-37 that lists
    `aboveHighWater: false`), ADD `rewindRefusedTurnIndex: null,`.
  - In the resetRuntime "fresh shape" assertion (~line 107-127, lists `aboveHighWater: false`), ADD
    `rewindRefusedTurnIndex: null,`.
  - ADD one new `it(...)` mirroring the aboveHighWater/shrinkMissCounts isolation tests:
        it("rewindRefusedTurnIndex is mutable and isolated per session (P4.M1.T2.S3)", () => {
          const a = getRuntime("A");
          const b = getRuntime("B");
          a.rewindRefusedTurnIndex = 7;
          expect(a.rewindRefusedTurnIndex).toBe(7);
          expect(b.rewindRefusedTurnIndex).toBeNull();   // B untouched
          expect(getRuntime("A").rewindRefusedTurnIndex).toBe(7); // live ref reflects the write
        });

Task 5: EDIT test/filter.test.ts — suppress-same-turn + clear-on-advance
  - In the "contextHandler — drift nudge" describe block (alongside the ~line 453/467/482 tests), ADD:
    (a) "does NOT inject the drift nudge for the remainder of a turn in which a rewind was refused
         (P4.M1.T2.S3)": build a ctx whose latest mulligan:turn-metric has turnIndex T and would fire
         shouldNudge; `getRuntime(<sessionId>).rewindRefusedTurnIndex = T;` BEFORE firing; fire contextHandler;
         assert the returned messages contain NO customType "mulligan:nudge" injection (length unchanged).
    (b) "clears the flag and re-enables the nudge once the turn advances (P4.M1.T2.S3)": set the flag to an
         OLD turnIndex; make the latest metric's turnIndex a DIFFERENT (advanced) value; fire contextHandler;
         assert (1) the nudge IS injected (re-enabled) AND (2) `getRuntime(<sessionId>).rewindRefusedTurnIndex`
         is now null (cleared). Use the same makePi/makeCtx idioms already in the file; getRuntime is already
         imported there.
  - Use the EXISTING m()/cfg() helpers if present, or script a `mulligan:turn-metric` custom entry directly
    into makeCtx({ entries: [...] }) exactly as the sibling drift-nudge tests do.

Task 6: EDIT test/tools/rewind.test.ts — refusal sets the flag; success does not
  - ADD (in the refusal-path describe block):
    (a) "a refused rewind latches rt.rewindRefusedTurnIndex to the latest metric turnIndex (P4.M1.T2.S3)":
        makeCtx({ sessionId: "s1", entries: [ <one mulligan:turn-metric with turnIndex 7> ] }); trigger ANY
        refusal (e.g. setConfig({rewind:{maxDepth:0}}) → maxDepth, OR an invalid note); assert
        `getRuntime("s1").rewindRefusedTurnIndex === 7`. (The makeCtx already scripts getSessionId→"s1".)
    (b) "a SUCCESSFUL rewind does NOT set the flag (P4.M1.T2.S3)": run a valid rewind (the existing success
        test's setup); assert `getRuntime("s1").rewindRefusedTurnIndex === null`.
    (c) "a refusal when no turn-metric exists leaves the flag null and never throws (E13)": makeCtx with NO
        metric entries; trigger a refusal; assert flag is null and the call returned a refusal result.
  - getRuntime is already imported in this file (`import { clearAll } from "../../src/runtime.js";` — add
    getRuntime to that import). makeCtx scripts sessionId/getSessionId (default "s1").
```

### Implementation Patterns & Key Details

```ts
// ── rewind.ts: the DRY refusal wrapper (sets the flag in ONE place) ─────────────────────────────
// Declared at the TOP of the main try body; every in-try refusal calls refuse() instead of refusal().
const refuse = (reason: string, gran: Granularity): AgentToolResult<RewindDetails> => {
  try {
    if (rt !== null && currentTurnIndex !== null) rt.rewindRefusedTurnIndex = currentTurnIndex;
  } catch {
    /* E13 — never throw on the flag-set */
  }
  return refusal(reason, gran);   // refusal() is the UNCHANGED pure builder (adds prefix + ".")
};
// In the outer catch (unexpected error) the closure is out of scope → set the flag inline, then refusal().

// ── filter.ts: the suppress conjunct + clear (additive; suppressCheck untouched) ────────────────
// Clear runs every fire (prompt, independent of perTurnDrift). Conjunct is the LAST if-condition.
// rt + markers.metric are guaranteed in scope; `markers.metric` truthiness is the prior conjunct.
if (
  ... && !suppressCheck(markers.metric, markers) &&
  rt.rewindRefusedTurnIndex !== markers.metric.turnIndex   // null (default) !== <number> → true → no-op
) { messages = injectNudge(messages, markers.metric); }

// ── WHY metric.turnIndex (not just rt.lastTurnIndex) is the flag value ──────────────────────────
// The filter compares rt.rewindRefusedTurnIndex === markers.metric.turnIndex — so SETTING the flag from the
// SAME readMarkers(ctx).metric?.turnIndex guarantees exact agreement. rt.lastTurnIndex is the in-memory
// fallback (same value during a turn, but null post-reload before the first turn_end → metric-first is more
// robust). The `?? rt.lastTurnIndex ?? null` chain covers: metric present → metric; reload/no-metric →
// lastTurnIndex; neither → null (flag unset, fail-open).
```

### Integration Points

```yaml
DATABASE: none (in-memory only; no persisted marker, no schema bump).
CONFIG: none (Mode A — no new knob; this rides the existing refusal paths added by S1/S2 and the existing
       config.nudges.perTurnDrift gate).
ROUTES/EVENTS: none new. Reads/writes the EXISTING `context` event (filter.ts) and the EXISTING rewind tool
       execute path. No new event handler, no index.ts wiring change.
PERSISTENCE: none — the flag lives only in the module-scoped runtime Map and is wiped on session_start
       (resetRuntime) / shutdown (clearAll), exactly like aboveHighWater.
```

---

## Validation Loop

### Level 1: Syntax & Style (after each file)

```bash
npm run build                 # tsc --noEmit (project's typecheck; zero errors expected)
# If the project uses a linter/formatter, run it on the three edited files:
#   npx eslint src/runtime.ts src/tools/rewind.ts src/filter.ts   (if configured)
#   npx prettier --check src/runtime.ts src/tools/rewind.ts src/filter.ts   (if configured)
# Expected: zero errors. The only NEW type is number|null on SessionRuntime + the refuse() closure.
```

### Level 2: Unit Tests (component validation)

```bash
# Runtime field (Task 1 + 4)
npx vitest run test/runtime.test.ts

# Drift-nudge suppression (Task 3 + 5)
npx vitest run test/filter.test.ts

# Rewind refusal flag-set (Task 2 + 6)
npx vitest run test/tools/rewind.test.ts

# Full suite (catch regressions in nudges/turn_metric/edge-cases that touch the same blocks)
npx vitest run
# Expected: ALL green. CRITICAL regression check: the pre-existing drift-nudge tests
# (filter.test.ts ~453/467/482, drift_nudge.test.ts) must still pass unchanged — the flag defaults to null.
```

### Level 3: Integration / behavioral check (manual reasoning or smoke)

```bash
# No server to start (this is a Pi extension loaded into the TUI). Verify behavior by reading the path:
# 1. A rewind refused at turnIndex T → on the NEXT context fire (same turn, metric.turnIndex still T):
#    rt.rewindRefusedTurnIndex === T → conjunct false → NO nudge injected. ✓
# 2. turn_end fires (metric.turnIndex becomes T+1) → next context fire: T !== T+1 → clear flag → null;
#    conjunct `null !== T+1` → true → nudge fires normally again. ✓
# 3. Successful rewind → flag untouched → nudge unaffected. ✓
# (The Tier-2 integration harness test/integration/smoke.ts can assert (1)/(2) if extended, but the unit
#  tests in Task 5/6 cover the same invariants deterministically.)
```

### Level 4: Domain-specific validation

```bash
# Grep-verify NO refusal site was missed in rewind.ts (must show refuse() at 8 in-try sites + refusal() in catch):
grep -nE "return (refuse|refusal)\(" src/tools/rewind.ts
# Grep-verify the conjunct + clear landed in filter.ts:
grep -n "rewindRefusedTurnIndex" src/filter.ts
# Grep-verify the field landed in runtime.ts (interface + freshRuntime):
grep -n "rewindRefusedTurnIndex" src/runtime.ts
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npm run build` passes (zero tsc errors).
- [ ] `npx vitest run` — ALL green; specifically test/runtime.test.ts, test/filter.test.ts, test/tools/rewind.test.ts.
- [ ] No lint/format errors on the three edited source files.

### Feature Validation
- [ ] A refused rewind this turn → no drift nudge on subsequent context fires of the SAME turn.
- [ ] After the turn advances (new turn-metric), the flag clears to null and the nudge re-enables.
- [ ] A successful rewind does NOT set the flag (nudge behavior unchanged).
- [ ] All 9 refusal paths set the flag (grep-verified in Level 4).
- [ ] No existing drift-nudge / suppressCheck / shouldNudge test regressed.

### Code Quality Validation
- [ ] Follows existing patterns: field modelled on `aboveHighWater`; refusal helper kept pure; defensive
      try/catch (E13) on every flag read/set; no new config/persistence/event.
- [ ] Flag read/set never throws (fail-OPEN — worst case one missed nudge, never a crash or broken filter).
- [ ] No new import cycles (rewind → filter is one-way; audit.ts already imports filter.ts).

### Documentation
- [ ] Mode A — NO README change, NO config-table change, NO new knob. (The flag is internal.)

---

## Anti-Patterns to Avoid

- ❌ Don't edit `resetRuntime`/`clearAll`/`getRuntime`/`nextSeq` — they're generic over the entry; adding a
  field needs no change there.
- ❌ Don't mutate the pure `refusal()` builder to set the flag — it has no `rt`/`ctx`; set the flag in the
  thin `refuse()` wrapper (or inline in the catch), keeping `refusal()` pure and the diff minimal.
- ❌ Don't remove or alter `suppressCheck` — it's a SEPARATE (marker-based) suppression; the S3 conjunct is ADDITIVE.
- ❌ Don't put the flag clear INSIDE the perTurnDrift if-block — it must run every fire so the flag clears
  promptly when the turn advances, even when the nudge wouldn't fire.
- ❌ Don't let a flag read/set throw into the contextHandler's outer try/catch (which would return undefined
  → no filter at all). Wrap the clear in its own try/catch.
- ❌ Don't add the "Mulligan: refused — " prefix or trailing "." to any reason string — `refusal()` does that.
- ❌ Don't add a config knob, persisted marker, or README row — this is Mode A (internal-only).

---

**Confidence Score: 9/10** for one-pass success. The change is small (one field, one DRY closure renaming 8
call sites + one inline catch set, one conjunct + one defensive clear), fully pinned to verified line anchors
and an existing twin field (`aboveHighWater`), with a proven import precedent (audit.ts → filter.ts) and a
clear test plan. The only residual risk is missing one of the 9 refusal sites — mitigated by the DRY `refuse()`
closure (rename, not per-site logic) and the Level-4 grep gate.