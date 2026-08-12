# PRP — P4.M1.T1.S2: smoke.ts F-shrink-persist — user-message shrink + original-survives-on-disk

> **Mode A — test-only.** No source change, no spec edit, no docs. spec/08 E19 (h2.100) hardened the "hard
> invariant": *shrink is a view substitution — the user's actual message stays on disk and is recoverable via
> `/tree`; summarizing user input is acceptable precisely because the original always survives.* This task
> makes that invariant **executable end-to-end** in the real-`pi` integration smoke harness for **BOTH** a
> `custom_message` target (existing) **AND** a real **user-message** target (NEW, the E19-specific case).
> P4.M1.T1.S1 proved non-mutation at the pure-helper tier (in-memory analog); this subtask proves the same
> invariant against the **real session JSONL**. Consumed by P4.M1.T1.S3 (README trust note cites a verified invariant).

---

## Goal

**Feature Goal**: Extend the **F-shrink-persist** scenario in the integration smoke harness so it explicitly
drives a `mulligan_shrink` whose matched message is a **real `user` message** (per E19), then asserts —
end-to-end against the real session JSONL — that (a) the view substitution took effect in the filtered
context AND (b) the **original user content survives verbatim on disk** (the hard invariant). The existing
`custom_message`-canary assertions are kept intact (strengthened, never weakened).

**Deliverable**: Edits to **two** files of the smoke harness (the established pattern — every scenario spans both):
1. `test/integration/smoke.ts` — add a `USER_CANARY`/`USER_SHRUNK_MARKER` constant pair, drive a **second**
   shrink in the `F-shrink-persist` `driveScenario` case targeting a real user message, and surface two new
   observables (`userCanaryPresent`, `userShrunkInContext`) from the `context` observer.
2. `test/integration/run-smoke.mjs` — give `F-shrink-persist` a 3-prompt flow (a real user prompt carrying
   the canary → the command → the observing turn) and extend `assertShrinkPersist` with the E19 assertions.

**Success Definition**: `npm run smoke` is green (F-shrink-persist passes with the new user-message
assertions alongside the unchanged custom_message assertions); `npm run typecheck` (tsc --noEmit) is clean
(smoke.ts is type-checked; the edits reuse the proven `makeShrinkTool`/`resultText`/object-literal patterns);
the full vitest suite `npm test` is unaffected (smoke harness is NOT run by vitest — it is a separate `npm run smoke`).

## User Persona (if applicable)

**Target User**: Maintainer / future contributor who touches `src/transforms.ts` `applyShrink`,
`src/filter.ts`, or the shrink tool's persistence path.
**Use Case**: A regression that rewrote the on-disk message on shrink (e.g. an "optimization" that mutates
the session JSONL, or a filter that rewrites `event.messages` in place and accidentally persists) would
silently break the "original survives" trust promise — including for user input, which E19 specifically
blesses as safe-to-summarize *because* the original always survives. These assertions fail loudly the moment
that invariant breaks end-to-end.
**Pain Points Addressed**: The current scenario only shrinks a synthetic `custom_message` canary. E19's
specific emphasis (user input) is not exercised, and the "original survives on disk" claim is made only for
that one canary type. This task closes the gap for the role that matters most for user trust.

## Why

- **E19 (h2.100) is explicit about the user-message case.** The spec gained (commit d5701c8f) the bullet:
  *"Summarizing user input is acceptable precisely because the original always survives; only the model's
  in-context copy is replaced."* That promise for **user** content is currently untested at the integration
  tier. An executable end-to-end proof is the only thing that survives the next refactor of the filter/persistence.
- **The on-disk invariant is enforced by construction** (C1: ReadonlySessionManager; C4: the context event is
  non-destructive per-inference — `applyShrink` only shapes one inference's message copy; the session JSONL is
  append-only and never mutated by a shrink). This task turns "enforced by construction" into "proven by CI."
- **P4.M1.T1.S1 established the pure-helper non-mutation assertion** (the in-memory analog). This subtask
  asserts the same invariant against the **real session JSONL** — the integration-level proof of "original
  survives / recoverable via `/tree`." The two are complementary tiers (PRD h2.115 Tier 1 vs h2.116 Tier 2).
- **Scope discipline.** The README trust note is P4.M1.T1.S3's job; the source/spec are done. This task stays
  strictly within the smoke harness (smoke.ts + run-smoke.mjs). No `src/` changes.

## What

### Visible behavior (smoke-harness additions)

1. **A real user message becomes a shrink target.** The orchestrator sends a first `-p` prompt whose body
   contains a unique `USER_CANARY` token. That prompt is a genuine `role:"user"` message persisted to the
   session JSONL. The `/mulligan_smoke F-shrink-persist` command (second prompt) drives **two** shrinks: the
   existing one (the `custom_message` canary) and a new one (`by_content_includes: USER_CANARY`).
2. **The view substitution is observable for the user message.** On the observing inference (third prompt),
   the smoke `context` observer logs `userShrunkInContext:true` (the distinct `USER_SHRUNK_MARKER` appears in
   the filtered view) and `userCanaryPresent:false` (the original user text was substituted away in-context).
3. **The original user content survives verbatim on disk.** `assertShrinkPersist` greps the session JSONL and
   asserts the `USER_CANARY` token is still present (shrink is a view-substitution, NOT a JSONL rewrite).
4. **The existing `custom_message` assertions are untouched** (strengthened only by an added "both variants
   drove" check). The `MSG_CANARY` original-on-disk assertion stays.

### Success Criteria
- [ ] `F-shrink-persist` uses a **3-prompt flow** (user canary prompt → command → observing `Reply OK`).
- [ ] `driveScenario`'s `F-shrink-persist` case calls `makeShrinkTool(pi).execute(...)` a **second** time
      with `target: { by_content_includes: USER_CANARY }` and a **distinct** `replacement: USER_SHRUNK_MARKER`.
- [ ] The `context` observer's `context.fire` log includes `userCanaryPresent` and `userShrunkInContext`.
- [ ] `assertShrinkPersist` adds: (i) `context.fire userShrunkInContext:true`; (ii)
      `entryIncludes(entries, "MULLIGAN-SMOKE-USER-CANARY")` (original user content on disk); (iii) ≥2 `tool.shrink` lines.
- [ ] The existing `MSG_CANARY` assertions (shrunkInContext, original-on-disk) still pass unchanged.
- [ ] `npm run smoke` green; `npm run typecheck` clean; `npm test` green (unaffected).
- [ ] NO file other than `test/integration/smoke.ts` and `test/integration/run-smoke.mjs` is touched.

---

## All Needed Context

### Context Completeness Check
_Pass._ An agent with zero knowledge of this repo can execute this PRP: the exact two files, the exact
`driveScenario` case, the exact context-observer log object, the exact `runScenario` branch shape (copied
from the F-rewind-core/F-checkpoint precedents), the exact asserter helpers (`readSessionEntries`,
`entryIncludes`, `assert`) already present, the byte-identical-constant gotcha (GOTCHA #1), and the exact
validation commands are all given below. The shrink-of-a-user-message mechanic is already supported
(`resolveShrinkTarget` matches ANY role per E19; `applyShrink` preserves role) — this task exercises it, not changes it.

### Documentation & References

```yaml
# MUST READ — include in your context window before editing

- file: test/integration/smoke.ts
  why: FILE #1 edited. Read in full (it is the whole extension). Note: (a) the canary consts (~L36–L49:
        MSG_CANARY/RESULT_CANARY/SHRUNK_MARKER/SEED_*); (b) the `case "F-shrink-persist"` block in
        driveScenario (~L180) — the EXISTING single shrink is the template for the second shrink; (c) the
        `pi.on("context", …)` observer (~factory body) whose `smokeLog("context.fire", "info", {…})` object
        is where the two new observables are added.
  pattern: The existing shrink call:
        const tool = makeShrinkTool(pi);
        const result = await tool.execute("smoke-shrink-1",
          { target: { by_content_includes: MSG_CANARY }, replacement: SHRUNK_MARKER, reason: "smoke test" },
          undefined, undefined, ctx);
        const text = resultText(result.content as unknown as { type: string; text?: string }[]);
        smokeLog("tool.shrink", "info", { text: text.slice(0, 120) });
    COPY this shape verbatim for the second shrink (new toolCallId "smoke-shrink-user", target USER_CANARY,
    replacement USER_SHRUNK_MARKER, a `variant:"user-message"` field on the log for grep-ability).
  gotcha: The command handler's `ctx` is `ExtensionCommandContext` (has sessionManager) — pass it to the
        tool's execute() exactly as the existing shrink does. Do NOT import anything new — makeShrinkTool +
        resultText are already in scope.

- file: test/integration/run-smoke.mjs
  why: FILE #2 edited (plain Node ESM, NOT type-checked — no casts, plain JS). Read in full. Note:
        (a) `runScenario(scenario)` — the default-flow tail + the custom F-rewind-core/F-checkpoint branches
        are the template for the new F-shrink-persist 3-prompt branch; (b) `assertShrinkPersist({smoke,piRes})`
        (~L257) — the assertions to EXTEND; (c) helpers `readSessionEntries` (L122), `entryIncludes` (L191),
        `assert` (L137), `parseSmokeLog` (L101).
  pattern: The F-rewind-core branch in runScenario is the exact shape to copy for a custom prompt flow:
        if (scenario === "F-shrink-persist") {
          const piRes = runPi(scenario, { prompts: [ `<USER_CANARY>…`, `/mulligan_smoke F-shrink-persist`, "Reply with exactly: OK" ] });
          const smoke = parseSmokeLog(piRes.logPath);
          return { piRes, smoke };
        }
    (Place it alongside the other `if (scenario === …)` custom branches, BEFORE the default-flow tail.)
  gotcha: run-smoke.mjs inlines canary literals (e.g. it asserts `entryIncludes(entries,
        "MULLIGAN-SMOKE-MSG-CANARY")` with the raw string, NOT a const). Match that style; inline
        "MULLIGAN-SMOKE-USER-CANARY". The literal MUST be byte-identical to smoke.ts's USER_CANARY const (GOTCHA #1).

- file: test/integration/run-smoke.mjs  (assertShrinkPersist ~L257)
  why: The asserter. The existing `entryIncludes(entries, "MULLIGAN-SMOKE-MSG-CANARY")` assertion is the
        EXACT idiom to copy for the user-canary on-disk check. The existing `cf?.shrunkInContext === true`
        is the EXACT idiom to copy for the user-substitution check.
  pattern: |
      const originalOnDisk = entryIncludes(entries, "MULLIGAN-SMOKE-MSG-CANARY");
      assert(results, "JSONL original canary still on disk (view-substitution, not rewrite)", originalOnDisk, "");

- file: src/transforms.ts  (resolveShrinkTarget ~L771–L811; applyShrink ~L963–L1010)
  why: READ-ONLY proof that a user-message shrink is supported end-to-end (you are NOT editing src/).
  pattern: |
      // by_content_includes (L802): "first message (ANY role — spec/08 E19) whose stringified content
      //   includes a NON-EMPTY substring." → matches role:"user".
      // applyShrink (L996): replacement = { ...orig, content: newContent } → role PRESERVED (E19).
  critical: There is NO protectedOk check on shrink (protection is rewind-only — spec/06 §8 / edge-cases E3).
        So shrinking a user message is NOT blocked. (The pure-helper E19 tests in test/edge-cases.test.ts,
        extended by P4.M1.T1.S1, already prove applyShrink replaces a user message's content + preserves role.)

- file: src/tools/shrink.ts  (makeShrinkTool factory; shrinkExecute body)
  why: READ-ONLY. Confirms the execute() signature `(toolCallId, params, signal, onUpdate, ctx)` and that
        `pi` is captured via the `makeShrinkTool(pi)` closure (NOT an execute arg) — exactly how the existing
        F-shrink-persist shrink calls it. Also confirms fail-open: a non-matching target STILL persists the
        marker (E8) and re-resolves live at filter time, so even if the advisory pin misses, the substitution
        is attempted on the observing inference.

- prd: spec/08-edge-cases.md §E19 (heading h2.100)
  why: THE requirement. "Shrink target is a non-toolResult message … `applyShrink` replaces `content` but
        preserves `role` … The original is never lost (hard invariant): shrink is a view substitution — the
        user's actual message stays on disk and is recoverable via `/tree`. Summarizing user input is
        acceptable precisely because the original always survives; only the model's in-context copy is replaced."
  section: "E19. Shrink target is a non-toolResult message" → "The original is never lost (hard invariant)"

- prd: spec/10-verification.md §2.1 F-shrink-persist row + §2.3 (heading h2.116)
  why: The Tier-2 contract this scenario implements. §2.1 F-shrink-persist pass criteria: "next inference's
        filtered view shows the replacement; session JSONL toolResult is the original (shrink is a
        view-substitution, not a JSONL rewrite — assert the original is still on disk and the substitution
        appears in the filtered cache)." §2.2 lists `/mulligan_smoke <scenario>` as the deterministic driver
        for F-shrink-persist. §2.3 documents the JSONL-parsing approach (walk entries, assert on content).
```

### Current Codebase tree (relevant slice)

```
test/integration/
  smoke.ts          # FILE #1 — Pi extension: driveScenario (F-shrink-persist ~L180) + context observer
  run-smoke.mjs     # FILE #2 — orchestrator: runScenario (prompt flow) + assertShrinkPersist (~L257)
  scenarios.md      # READ-ONLY doc (F-shrink-persist ~L121) — optionally update the deterministic snippet (see Tasks)
src/                # READ-ONLY (transforms.ts, tools/shrink.ts) — proof the mechanic is supported; NOT edited
test/edge-cases.test.ts  # READ-ONLY — P4.M1.T1.S1's pure-helper E19 tests (the in-memory analog)
```

### Desired Codebase tree (delta)

```
test/integration/
  smoke.ts          # MODIFIED — +2 consts, +1 second shrink in F-shrink-persist case, +2 context-fire observables
  run-smoke.mjs     # MODIFIED — +1 F-shrink-persist 3-prompt branch in runScenario, +3 E19 assertions in assertShrinkPersist
  scenarios.md      # MODIFIED (optional, doc-only) — note the user-message variant in the F-shrink-persist section
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL #1 — BYTE-IDENTICAL CONSTANTS ACROSS TWO FILES (GOTCHA #8 in run-smoke.mjs). smoke.ts and
//   run-smoke.mjs do NOT share a module (smoke.ts is loaded by jiti into pi; run-smoke.mjs is plain Node).
//   USER_CANARY / USER_SHRUNK_MARKER must be byte-identical literals in both. A mismatch → the substring
//   match/entryIncludes silently never matches → false FAIL. Verify by grepping both files for the exact token.

// CRITICAL #2 — A REAL user message can ONLY come from an orchestrator -p prompt. pi.sendMessage (used at
//   session_start for MSG_CANARY) creates a custom_message (role "custom"), NOT role:"user". So the user
//   canary is delivered by run-smoke.mjs's FIRST prompt. Do NOT try to inject a role:"user" from smoke.ts.

// CRITICAL #3 — DISTINCT replacement for the user shrink (USER_SHRUNK_MARKER), NOT the shared SHRUNK_MARKER.
//   If both shrinks used the same replacement, context.fire's `shrunkInContext: has(SHRUNK_MARKER)` would be
//   satisfied by EITHER shrink and could not prove the USER substitution specifically. The distinct marker
//   makes `userShrunkInContext: has(USER_SHRUNK_MARKER)` an independent proof for the user-message case.

// CRITICAL #4 — Timing of the observing inference. The shrink marker is persisted during the COMMAND prompt
//   (prompt 2). The substitution is observable on the NEXT inference (prompt 3 "Reply OK"), because the
//   filter runs on each context fire. assertShrinkPersist reads the LAST context.fire (the observing one).
//   This matches the existing custom_message flow (its substitution is also observed on the observing turn).

// CRITICAL #5 — by_content_includes matches the FIRST message whose content includes the substring. Ensure
//   USER_CANARY is unique to prompt 1's user message. "MULLIGAN-SMOKE-USER-CANARY" is distinctive; the model
//   reply to prompt 1 is role:"assistant" and very unlikely to echo it. Even if it did, the user message is
//   first → it is the matched target. (The on-disk assertion uses entryIncludes → entries.some(), true if ANY
//   entry has it, which is exactly "the original is on disk".)

// CRITICAL #6 — run-smoke.mjs is PLAIN JS (not type-checked). No `as` casts, no type imports. smoke.ts IS
//   type-checked by tsc (npm run typecheck). Reuse the existing `resultText(result.content as unknown as …)`
//   cast VERBATIM for the second shrink's result — it is the proven pattern.

// CRITICAL #7 — Do NOT weaken the existing MSG_CANARY assertions. The item contract: "do not weaken the
//   existing toolResult assertion" (the existing target is a custom_message canary; keep it). ONLY ADD the
//   user-message variant + its assertions. The existing `>= 1` shrink-line check may stay; ADD a `>= 2` check.

// CRITICAL #8 — run-smoke.mjs exits 1 if ANY scenario fails. A regression elsewhere (not your change) can
//   make `npm run smoke` red. To isolate F-shrink-persist during dev, temporarily reduce SCENARIOS to just
//   ["F-shrink-persist"] (local-only; restore before committing). Do NOT commit a reduced SCENARIOS array.
```

---

## Implementation Blueprint

### Data models and structure
None — test-only. The only "data" is the constant pair + the exact edit blocks below. All runtime objects
(messages, markers, entries) are produced by the existing REAL tools and the orchestrator prompts.

### Implementation Tasks (ordered by dependencies)

> **Process:** Read the live `test/integration/smoke.ts` (`case "F-shrink-persist"` ~L180 + the `context`
> observer) and `test/integration/run-smoke.mjs` (`runScenario` + `assertShrinkPersist` ~L257) to capture
> EXACT anchors, then issue the edits. Run the validation loop. Total: 2 files, ~6 small edits.

```yaml
Task 1: EDIT test/integration/smoke.ts — add the USER_CANARY / USER_SHRUNK_MARKER constants
  - FIND: the canary-const block near the top (MSG_CANARY / RESULT_CANARY / SHRUNK_MARKER are declared together).
  - ADD (immediately after the SHRUNK_MARKER declaration):
        // E19 (spec/08 §E19): a REAL user-message shrink target. USER_CANARY is delivered by the orchestrator's
        // FIRST -p prompt (a genuine role:"user" message — pi.sendMessage can only make custom_messages).
        // USER_SHRUNK_MARKER is a DISTINCT replacement so the user-message substitution is independently
        // observable from the custom_message canary shrink (GOTCHA #3).
        const USER_CANARY = "MULLIGAN-SMOKE-USER-CANARY";
        const USER_SHRUNK_MARKER = "MULLIGAN-SMOKE-USER-SHRUNK";
  - NAMING: SCREAMING-SNAKE consts matching the existing canary style (MSG_CANARY/SHRUNK_MARKER).

Task 2: EDIT test/integration/smoke.ts — surface two observables in the context observer
  - FIND: the `smokeLog("context.fire", "info", { … })` object inside `pi.on("context", …)`. It currently logs
        { count, msgCanaryPresent, resultCanaryPresent, notePresent, hasRewindMarker, shrunkInContext, hasNudge,
          seedAnchorInAssistant, seedHiddenInAssistant }.
  - ADD two fields to that SAME object literal (the `has = (s) => msgs.some((m) => JSON.stringify(m).includes(s))`
        helper is already in scope):
        userCanaryPresent: has(USER_CANARY),
        userShrunkInContext: has(USER_SHRUNK_MARKER),
  - WHY: the observer loads SECOND → sees the POST-filter view. On the observing inference, after the user-message
        shrink, userShrunkInContext===true (the stamped USER_SHRUNK_MARKER is in the filtered view) and
        userCanaryPresent===false (the original user text was substituted in-context). run-smoke asserts on these.

Task 3: EDIT test/integration/smoke.ts — drive a SECOND shrink in the F-shrink-persist case (the E19 variant)
  - FIND: `case "F-shrink-persist": { … }` in driveScenario (~L180). It currently has ONE try/catch that shrinks
        MSG_CANARY, then `break;`.
  - ADD a SECOND try/catch block BEFORE the `break;` (keep the existing shrink untouched — GOTCHA #7):
        // E19 (spec/08 §E19): shrink a REAL USER message by_content_includes. USER_CANARY is the orchestrator's
        // first -p prompt (role:"user"). Proves summarizing user input is acceptable because the original ALWAYS
        // survives on disk (the hard invariant) — distinct replacement so it is independently observable.
        try {
          const tool2 = makeShrinkTool(pi);
          const result2 = await tool2.execute(
            "smoke-shrink-user",
            { target: { by_content_includes: USER_CANARY }, replacement: USER_SHRUNK_MARKER, reason: "E19 user-message shrink (original must survive)" },
            undefined,
            undefined,
            ctx,
          );
          const text2 = resultText(result2.content as unknown as { type: string; text?: string }[]);
          smokeLog("tool.shrink", "info", { variant: "user-message", text: text2.slice(0, 120) });
        } catch (e) {
          smokeLog("tool.shrink", "fail", { variant: "user-message", error: String(e) });
        }
  - FOLLOW pattern: the EXISTING shrink block above it (verbatim shape; same execute() arg order; same cast).
  - GOTCHA: `ctx` here is the command's ExtensionCommandContext — pass it exactly as the existing shrink does.
  - GOTCHA: do NOT remove or alter the existing MSG_CANARY shrink — only APPEND the second one.

Task 4: EDIT test/integration/run-smoke.mjs — give F-shrink-persist a 3-prompt flow
  - FIND: `function runScenario(scenario)`. It has custom `if (scenario === "F-rewind-core") {…}` /
        `if (scenario === "F-checkpoint") {…}` / `if (scenario === "F-reload" || scenario === "E11") {…}`
        branches, then the default 2-prompt tail (`const piRes = runPi(scenario);`).
  - ADD a new branch BEFORE the default tail (copy the F-rewind-core branch shape):
        if (scenario === "F-shrink-persist") {
          const piRes = runPi(scenario, {
            prompts: [
              `MULLIGAN-SMOKE-USER-CANARY: please note this exact user-supplied string`, // E19 target (real role:"user")
              `/mulligan_smoke F-shrink-persist`, // drives BOTH shrinks (custom_message canary + user message)
              "Reply with exactly: OK", // observing inference — both substitutions observable + JSONL persisted
            ],
          });
          const smoke = parseSmokeLog(piRes.logPath);
          return { piRes, smoke };
        }
  - WHY: the FIRST prompt persists a real user message carrying USER_CANARY BEFORE the command runs, so the
        command-time shrink resolves it. The THIRD prompt is the observing inference.
  - GOTCHA: the literal "MULLIGAN-SMOKE-USER-CANARY" here MUST be byte-identical to smoke.ts's USER_CANARY (GOTCHA #1).

Task 5: EDIT test/integration/run-smoke.mjs — extend assertShrinkPersist with the E19 assertions
  - FIND: `function assertShrinkPersist({ smoke, piRes })` (~L257). It reads `entries`, `shrinkLines`, `cf`.
  - KEEP all existing assertions UNCHANGED. ADD (inside the `if (entries.length > 0) { … }` block, alongside the
        existing `entryIncludes(entries, "MULLIGAN-SMOKE-MSG-CANARY")` line):
        // E19 (spec/08 §E19): the USER-message shrink variant. (i) substitution took effect in the filtered view;
        // (ii) the original USER content survives verbatim on disk (the hard invariant — true for user input specifically).
        assert(results, "context.fire userShrunkInContext:true (user-message substitution took effect)", cf?.userShrunkInContext === true, String(cf?.userShrunkInContext));
        assert(results, "JSONL original USER canary still on disk (E19 — user input survives verbatim, not rewritten)", entryIncludes(entries, "MULLIGAN-SMOKE-USER-CANARY"), "");
  - AND add (near the existing `assert(results, "tool.shrink ran", shrinkLines.length >= 1, "")`):
        assert(results, "tool.shrink ran for BOTH variants (custom_message + user message)", shrinkLines.length >= 2, `${shrinkLines.length} shrink lines`);
  - FOLLOW pattern: the existing `entryIncludes(...)` + `cf?.shrunkInContext === true` assertions (verbatim idiom).
  - GOTCHA: run-smoke.mjs is plain JS — no `as`/`?:`-on-types. `cf?.userShrunkInContext` is fine (optional chaining).

Task 6: (OPTIONAL, doc-only) EDIT test/integration/scenarios.md — note the user-message variant
  - FIND: the `### F-shrink-persist` section (~L121). Its deterministic snippet shows the 2-prompt flow.
  - ADD a one-line note + update the deterministic snippet to the 3-prompt flow, e.g.:
        "Deterministic flow now also shrinks a REAL user message (E19): prompt 1 carries USER_CANARY."
  - WHY: keeps the doc honest with the harness. LOW priority (doc-only; do not block on it).

Task 7: VERIFY — smoke run + typecheck + full vitest suite
  - RUN: npm run smoke          (expect: … 14/14 (or current count) scenarios passed; F-shrink-persist PASS with the new assertions)
  - RUN: npm run typecheck      (tsc --noEmit; smoke.ts is type-checked — expect zero errors; run-smoke.mjs is not checked)
  - RUN: npm test               (vitest; smoke harness is NOT run by vitest — expect green, unaffected by your change)
  - IF F-shrink-persist fails on `userShrunkInContext:false` or `userCanaryPresent` (original not on disk): READ the
        smoke log + session JSONL. (a) If the second tool.shrink line is MISSING → the drive didn't run (check the
        edit landed before `break;`). (b) If tool.shrink ran but userShrunkInContext:false → the shrink marker
        persisted but did not substitute on the observing inference; check that USER_CANARY is byte-identical across
        both files (GOTCHA #1) and that prompt 1's user message is present in the JSONL (grep it). (c) Per E19 the
        shrink of a user message IS supported (resolveShrinkTarget matches ANY role; applyShrink preserves role; no
        protectedOk on shrink) — a genuine substitution failure is a real finding to REPORT, not paper over.
```

### Implementation Patterns & Key Details

```typescript
// ════════════════════════════════════════════════════════════════════════════
// smoke.ts — the second shrink (E19 variant). SAME shape as the existing MSG_CANARY shrink.
// makeShrinkTool + resultText + ctx are all already in scope — NO new imports (GOTCHA #6).
// ════════════════════════════════════════════════════════════════════════════
// Inside `case "F-shrink-persist": { … }`, AFTER the existing MSG_CANARY shrink, BEFORE `break;`:
try {
  const tool2 = makeShrinkTool(pi);
  const result2 = await tool2.execute(
    "smoke-shrink-user",
    { target: { by_content_includes: USER_CANARY }, replacement: USER_SHRUNK_MARKER, reason: "E19 user-message shrink (original must survive)" },
    undefined,
    undefined,
    ctx,
  );
  const text2 = resultText(result2.content as unknown as { type: string; text?: string }[]);
  smokeLog("tool.shrink", "info", { variant: "user-message", text: text2.slice(0, 120) });
} catch (e) {
  smokeLog("tool.shrink", "fail", { variant: "user-message", error: String(e) });
}

// ════════════════════════════════════════════════════════════════════════════
// smoke.ts — context observer: add two fields to the existing context.fire log object.
// `has` is already defined in the handler scope: const has = (s) => msgs.some((m) => JSON.stringify(m).includes(s));
// ════════════════════════════════════════════════════════════════════════════
//   … existing fields …
//   shrunkInContext: has(SHRUNK_MARKER),
//   userCanaryPresent: has(USER_CANARY),        // ← ADD (false on the observing inference = substituted in-context)
//   userShrunkInContext: has(USER_SHRUNK_MARKER), // ← ADD (true on the observing inference = user substitution took effect)
//   hasNudge: …
```

```javascript
// ════════════════════════════════════════════════════════════════════════════
// run-smoke.mjs — PLAIN JS (no casts). Copy the F-rewind-core branch shape.
// ════════════════════════════════════════════════════════════════════════════
// In runScenario(), BEFORE the default-flow tail:
if (scenario === "F-shrink-persist") {
  const piRes = runPi(scenario, {
    prompts: [
      `MULLIGAN-SMOKE-USER-CANARY: please note this exact user-supplied string`,
      `/mulligan_smoke F-shrink-persist`,
      "Reply with exactly: OK",
    ],
  });
  const smoke = parseSmokeLog(piRes.logPath);
  return { piRes, smoke };
}

// In assertShrinkPersist(), inside `if (entries.length > 0) { … }`, AFTER the existing MSG_CANARY on-disk assert:
assert(results, "context.fire userShrunkInContext:true (user-message substitution took effect)", cf?.userShrunkInContext === true, String(cf?.userShrunkInContext));
assert(results, "JSONL original USER canary still on disk (E19 — user input survives verbatim, not rewritten)", entryIncludes(entries, "MULLIGAN-SMOKE-USER-CANARY"), "");
// And near the existing `tool.shrink ran` (>=1) check:
assert(results, "tool.shrink ran for BOTH variants (custom_message + user message)", shrinkLines.length >= 2, `${shrinkLines.length} shrink lines`);
```

### Integration Points

```yaml
TESTS:
  - file: test/integration/smoke.ts
    - block: `case "F-shrink-persist"` in driveScenario — APPEND a second shrink (do not alter the first).
    - block: `pi.on("context", …)` — ADD 2 fields to the context.fire log object.
    - consts: ADD USER_CANARY + USER_SHRUNK_MARKER next to MSG_CANARY/SHRUNK_MARKER.
  - file: test/integration/run-smoke.mjs
    - block: runScenario — ADD an `if (scenario === "F-shrink-persist")` 3-prompt branch before the default tail.
    - block: assertShrinkPersist — ADD 3 assertions; KEEP all existing ones.
CONFIG:   none (no config change; shrink is enabled by default).
BUILD:    none (no src change). npm run typecheck must stay clean (smoke.ts edits reuse proven casts).
DOCS:     [Mode A] none required. scenarios.md update is OPTIONAL (Task 6, doc-only). README note is P4.M1.T1.S3.
```

---

## Validation Loop

### Level 1: The smoke harness (the PRIMARY gate)

```bash
# Runs the whole integration suite (run-smoke.mjs). F-shrink-persist must PASS with the NEW user-message
# assertions alongside the UNCHANGED custom_message assertions. Exits 0 on all-green, 1 on any failure.
npm run smoke
# Expected: a line `PASS F-shrink-persist` and `<N>/<N> scenarios passed`. If F-shrink-persist FAILs, the
#   printed ✗ lines name the failing assertion — read them (see Task 7 troubleshooting).
```

### Level 2: Type safety (smoke.ts is type-checked; run-smoke.mjs is not)

```bash
# tsc --noEmit across the project. The second shrink reuses the existing makeShrinkTool/resultText/cast
# pattern verbatim, so no new errors are expected. run-smoke.mjs is plain JS and excluded from tsc.
npm run typecheck
# Expected: zero errors.
```

### Level 3: Full vitest suite (regression guard — smoke harness is NOT run by vitest)

```bash
# The whole unit/edge-case suite. Confirms no src/test files were disturbed. NOTE: the smoke harness is a
# SEPARATE `npm run smoke` and is NOT part of vitest, so this should be unaffected by your change.
npm test
# Expected: green. (If a vitest test fails, you almost certainly edited a file outside the two smoke files — revert it.)
```

### Level 4: Targeted isolation (cheap, catches a mis-wired scenario)

```bash
# (a) Confirm the second shrink drove — the smoke log for F-shrink-persist has TWO tool.shrink lines,
#     the second tagged variant:"user-message":
grep -c '"test":"tool.shrink"' /tmp/mulligan-smoke/F-shrink-persist.log   # expect ≥ 2
grep 'user-message' /tmp/mulligan-smoke/F-shrink-persist.log              # expect ≥ 1 hit

# (b) Confirm the user message is actually on disk (the E19 hard invariant) by grepping the real session JSONL.
#     (Find its path in the session.start line of the smoke log, then grep the file for the user canary.)
SF=$(grep -o '"sessionFile":"[^"]*"' /tmp/mulligan-smoke/F-shrink-persist.log | head -1 | cut -d'"' -f4)
grep -c 'MULLIGAN-SMOKE-USER-CANARY' "$SF"   # expect ≥ 1 (the original user content survived verbatim)

# (c) Dev isolation: to iterate on JUST F-shrink-persist without running the whole suite, temporarily set
#     SCENARIOS = ["F-shrink-persist"] in run-smoke.mjs, run `npm run smoke`, then RESTORE the array before
#     committing. (Do NOT commit a reduced SCENARIOS array — it would skip the rest of the suite in CI.)
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run smoke` green; `PASS F-shrink-persist` printed; `<N>/<N> scenarios passed`.
- [ ] `npm run typecheck` reports zero errors.
- [ ] `npm test` green (unaffected — smoke harness is separate from vitest).
- [ ] Level 4: smoke log has ≥2 `tool.shrink` lines (incl. one tagged `variant:"user-message"`); the session
      JSONL grep for `MULLIGAN-SMOKE-USER-CANARY` is ≥1 (original user content on disk).

### Feature Validation (contract acceptance)
- [ ] `F-shrink-persist` uses a 3-prompt flow (user canary → command → observing `Reply OK`).
- [ ] `driveScenario` drives a SECOND shrink (`by_content_includes: USER_CANARY`, replacement
      `USER_SHRUNK_MARKER`); the first MSG_CANARY shrink is unchanged.
- [ ] The context observer logs `userCanaryPresent` + `userShrunkInContext`.
- [ ] `assertShrinkPersist` asserts `cf?.userShrunkInContext === true` (user substitution took effect).
- [ ] `assertShrinkPersist` asserts `entryIncludes(entries, "MULLIGAN-SMOKE-USER-CANARY")` (E19 on-disk invariant for user input).
- [ ] `assertShrinkPersist` asserts ≥2 `tool.shrink` lines (both variants drove).
- [ ] The existing MSG_CANARY assertions (`shrunkInContext:true`, original on disk) still pass unchanged.

### Code Quality / Scope Validation
- [ ] ONLY `test/integration/smoke.ts` and `test/integration/run-smoke.mjs` are modified (+ optional `scenarios.md`).
      No `src/*.ts`, no `spec/*.md`, no `README.md`, no `tasks.json`, no PRD snapshot, no `test/edge-cases.test.ts`
      (that is P4.M1.T1.S1's file — running in parallel).
- [ ] `USER_CANARY` / `USER_SHRUNK_MARKER` are byte-identical literals across smoke.ts and run-smoke.mjs (GOTCHA #1).
- [ ] The user shrink uses a DISTINCT replacement (USER_SHRUNK_MARKER), not the shared SHRUNK_MARKER (GOTCHA #3).
- [ ] No new imports in smoke.ts (makeShrinkTool/resultText/ctx already in scope); run-smoke.mjs is plain JS (no casts).

### Documentation Validation
- [ ] None required (Mode A — test-only). scenarios.md update is optional (Task 6). README trust note is P4.M1.T1.S3.

---

## Anti-Patterns to Avoid

- ❌ Do NOT weaken or remove the existing MSG_CANARY (custom_message) shrink or its assertions — the item
  contract is to ADD a user-message variant, not replace the existing target.
- ❌ Do NOT use the shared `SHRUNK_MARKER` as the user-shrink replacement — it would make `shrunkInContext`
  ambiguous (satisfied by either shrink). Use the distinct `USER_SHRUNK_MARKER` (GOTCHA #3).
- ❌ Do NOT try to inject a `role:"user"` message from smoke.ts (`pi.sendMessage` only makes custom_messages).
  The user canary MUST come from an orchestrator `-p` prompt (GOTCHA #2).
- ❌ Do NOT edit `src/` to make a test pass. Shrinking a user message IS supported per E19 (resolveShrinkTarget
  matches ANY role; applyShrink preserves role; no protectedOk on shrink). A genuine failure is a finding to
  report, not a reason to change the source.
- ❌ Do NOT add `as`/type casts or type imports to run-smoke.mjs — it is plain Node ESM, excluded from tsc.
- ❌ Do NOT edit `test/edge-cases.test.ts` — that is P4.M1.T1.S1's deliverable (running in parallel).
- ❌ Do NOT commit a reduced `SCENARIOS` array (the Level-4 dev-isolation trick) — it would skip the rest of
  the suite in CI. Restore the full array before committing.
- ❌ Do NOT let the two canary literals drift between files — a one-character mismatch silently breaks the
  substring match and the on-disk grep (GOTCHA #1). Grep both files for the exact token to confirm.

---

## Confidence Score: 9/10

This is a test-only extension of an already-working scenario. The new user-message shrink is a byte-for-byte
structural twin of the existing custom_message shrink (same `makeShrinkTool`/`execute`/cast pattern), and the
new assertions are byte-for-byte twins of the existing `entryIncludes`/`cf?.shrunkInContext` idioms. The only
novelty — targeting a real `user` message — is already validated at the pure-helper tier by P4.M1.T1.S1's E19
tests and is explicitly blessed by E19 (resolveShrinkTarget matches ANY role; applyShrink preserves role; no
shrink-side protection). The exact files, anchors, edit blocks, byte-identical-constant gotcha, and validation
commands are pinned. Residual risk: a timing/pin subtlety where the user-message shrink does not substitute
on the observing inference — but the shrink tool is fail-open (marker persists; live re-resolution each
inference), so the substitution is attempted regardless. One-pass success is highly likely.

---
~2 files edited (test/integration/smoke.ts, test/integration/run-smoke.mjs; scenarios.md optional). ~6 small
edits: 2 consts, 2 context-observer fields, 1 second shrink, 1 three-prompt branch, 3 assertions. No build/dependency/src impact.