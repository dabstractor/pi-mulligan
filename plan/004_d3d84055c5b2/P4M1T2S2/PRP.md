---
name: "P4.M1.T2.S2 — Out-of-band context-fraction stop guard (E22 hard backstop #2)"
description: "Add an exported shared helper `computeFilteredTotal(ctx): { totalTokens, windowTokens }` to src/tools/audit.ts (it already imports estimateTokens + getRuntime and has the module-local entriesToMessages in scope — reuse, no duplication, no export of entriesToMessages; rewind→audit is a one-way import, no cycle) and insert the `(4c)` out-of-band context-fraction stop guard into `rewindExecute` immediately AFTER the `(4b)` per-prompt retry-budget guard (already shipped in-tree) and BEFORE the `(5) read-only ledger` step. The guard refuses — before persisting — when `windowTokens > 0` AND `totalTokens / windowTokens >= config.rewind.abortContextFraction` (default 0.9), steering to `mulligan_shrink`. `computeFilteredTotal` is fail-open (ONE try/catch → {0,0}; the `windowTokens > 0` check IS the fail-open: no model / undefined usage / throw → guard SKIPPED, never blocks a rewind — E13). D5-compliant: total from the FILTERED view (`rt.lastFiltered`), NEVER `getContextUsage().tokens`; `.contextWindow` (the SIZE) IS permitted. The `rt.lastFiltered` staleness is accepted (errs toward firing LATER/under-counting — the safe direction). No config change (P4.M1.T1.S1 shipped the knob). No new tests here (the test matrix is P4.M1.T3.S1). Audit's own step 1–2 is LEFT UNCHANGED (its E16 fallback re-runs filterPipeline; the helper's cheap fallback differs — so a refactor is NOT 'same numbers'; export the helper for future convergence only). Keep `npx tsc --noEmit` + `npm test` green."
---

## Goal

**Feature Goal**: Harden `mulligan_rewind` (src/tools/rewind.ts) against the E22 **zero-marker loop vector** — the worst-case runaway the marker-counting retry budget (P4.M1.T2.S1, hard backstop #1) structurally *cannot* see: a spin that persists **zero** net rewind markers yet re-bloats the filtered context every turn (e.g. re-reading the same large files because a bloated-result nudge keeps re-firing). This task implements the **out-of-band context-fraction stop** — the second, independent E22 hard backstop. Before persisting, the rewind tool estimates the filtered-context total (the same estimate `mulligan_audit` produces) and refuses when it is `>= config.rewind.abortContextFraction` of the model's context window, steering the agent to `mulligan_shrink` instead. This stops the runaway *before* the provider rejects the next request as "Prompt too long" — regardless of retry accounting.

**Deliverable**: Three small edits across two source files:
1. **src/tools/audit.ts** — ADD an exported `computeFilteredTotal(ctx: ExtensionContext): { totalTokens: number; windowTokens: number }` helper (verbatim body in "Implementation Patterns"). It is the SINGLE source of the filtered-total + window-size estimate so the audit and the rewind guard never diverge. Audit's *own* step 1–2 is left unchanged in this task (see Known Gotchas #5).
2. **src/tools/rewind.ts** — ADD one import (`import { computeFilteredTotal } from "./audit.js";`) to the top import block.
3. **src/tools/rewind.ts** — ADD the `(4c)` guard block inside `rewindExecute`, placed AFTER the `(4b)` per-prompt retry-budget guard (already in-tree) and BEFORE the `(5) read-only ledger + K preview` step.

No new files. No config change. No test files written here (the dedicated test matrix is P4.M1.T3.S1 — a separate, downstream task). No spec/README change (Mode A — the refusal text IS the agent-facing documentation).

**Success Definition**:
- `config.rewind.abortContextFraction` is read (already shipped by P4.M1.T1.S1) and honored by the rewind tool, **independently** of `maxDepth` (guard 4) and `maxRetriesPerPrompt` (guard 4b) — all three apply; first refusal wins.
- A rewind requested while `totalTokens / windowTokens >= config.rewind.abortContextFraction` (default 0.9) is **refused before persisting** with text beginning `"Mulligan: refused — context is at <P>% of the window; rewinding will not help. Run mulligan_audit and shrink the largest result."`, and **nothing is persisted** (no marker, no note), when `windowTokens > 0`.
- `computeFilteredTotal` **never throws** (E13): a throwing `getRuntime`, `buildContextEntries`, `getContextUsage`, or `estimateTokens`, a non-array `rt.lastFiltered`, or no model at all → returns `{ totalTokens: 0, windowTokens: 0 }`. The guard treats `windowTokens === 0` as "skip" → never blocks a rewind (fail-open).
- D5 is honored: the total is computed from the **filtered view** (`rt.lastFiltered`, else the cheap `entriesToMessages(buildContextEntries())` fallback), NEVER `ctx.getContextUsage().tokens` (which counts hidden/rewound tokens — bookkeeping drift). `.contextWindow` (the window SIZE) IS read and permitted.
- The full existing `npm test` suite stays green (the new guard is skipped on every existing test — proven in research/findings.md §7) and `npx tsc --noEmit` is clean.

## Why

- **Business value / blast radius**: E22 is *the* catastrophic Mulligan failure mode. The marker-counting budget (T2.S1) arrests a loop that *records* rewinds, but it is structurally blind to a loop that persists **zero** net markers — pure intra-turn repetition where the model re-reads the same huge files every turn because a bloated-result nudge keeps re-firing. Observed in live use: a single prompt left the agent spinning, each loop enlarging the session, until the provider rejected the next request and the human was **locked out** (could not even send a new message). The context-fraction stop is the only guard that can arrest that vector, because it keys off the *filtered-context size* itself, not marker bookkeeping. It fires before the provider rejects the request, regardless of retry accounting.
- **Scope position**: This is the **second guard** of P4.M1.T2 (Rewind tool guards). P4.M1.T1.S1 (the config knob `abortContextFraction`, default 0.9, validated `(0,1]`) **already shipped** in this tree. P4.M1.T2.S1 (the per-prompt retry budget, guard `(4b)`) is **already implemented in-tree** (`countRetriesAtLatestPrompt` + the `(4b)` block at rewind.ts L453–466) — this task's `(4c)` block slots into the exact free spot the T2.S1 PRP left, between `(4b)` and `(5)`. P4.M1.T2.S3 (suppress the drift nudge for a refused turn) depends on *any* refusal path existing. P4.M1.T3.S1 writes the unit test that asserts this guard's boundary (and must ADD a `contextUsage` opt to the test's `makeCtx` fake — see Integration Points).
- **Problems solved / for whom**: protects the agent (and the human) from an unrecoverable "Prompt too long" hard stop caused by a zero-marker re-bloat loop. The agent-facing refusal text ("Run mulligan_audit and shrink the largest result") steers it to the one recovery that actually reduces context — `mulligan_shrink` — instead of rewinding (which hides near nothing relative to the bloat and just grows the session with another marker + note).

## What

User-visible behavior: after this task, an agent that calls `mulligan_rewind` while its **filtered** context is at or above `abortContextFraction` (default 90%) of the model's context window is **refused** with the context-fraction text, and **nothing is persisted**. All other Mulligan operations and ordinary non-rewind tool work are unaffected. The refusal text IS the agent-facing documentation (Mode A — no README/spec change).

This guard is **independent** of and **additional to** the `maxDepth` cap (guard 4) and the per-prompt retry budget (guard 4b): a rewind can be refused by the context-fraction stop even when ample depth and retry budget remain. It catches the zero-marker loop vector that the marker-counting budget cannot see. The three guards apply in sequence; the first refusal wins.

### Success Criteria

- [ ] `computeFilteredTotal(ctx: ExtensionContext): { totalTokens: number; windowTokens: number }` is EXPORTED from src/tools/audit.ts, placed immediately after the module-local `entriesToMessages` function (the "filtered-view resolution" family), and uses audit's already-present imports (`estimateTokens`, `getRuntime`) + the in-scope `entriesToMessages` (no export of `entriesToMessages`, no duplication).
- [ ] `computeFilteredTotal` is fail-open: ONE `try { … } catch { return { totalTokens: 0, windowTokens: 0 }; }` around the whole body. On ANY failure it returns the `{0,0}` sentinel.
- [ ] `computeFilteredTotal` is D5-compliant: total from `rt.lastFiltered` (preferred, when `Array.isArray`) else the cheap `entriesToMessages(ctx.sessionManager.buildContextEntries())` fallback; window from `ctx.getContextUsage?.()?.contextWindow ?? 0`. NEVER reads `getContextUsage().tokens`.
- [ ] rewind.ts imports `computeFilteredTotal` from `"./audit.js"` (the ESM/Bundler `.js` convention), added to the top import block alongside the existing sibling imports.
- [ ] `rewindExecute` has the `(4c)` guard block placed AFTER the `(4b)` retry-budget guard (its closing `}`) and BEFORE the `(5) read-only ledger + K preview` comment. It runs `const { totalTokens, windowTokens } = computeFilteredTotal(ctx);` and, when `windowTokens > 0 && totalTokens / windowTokens >= config.rewind.abortContextFraction`, returns `refusal(<reason>, granularity)` WITHOUT persisting.
- [ ] The refusal reason string is VERBATIM (NO trailing period — `refusal()` adds it): `` `context is at ${pct}% of the window; rewinding will not help. Run mulligan_audit and shrink the largest result` `` where `pct = Math.round((totalTokens / windowTokens) * 100)` computed ONLY inside the refusal branch.
- [ ] The guard never blocks a rewind when `windowTokens === 0` (no model / undefined `getContextUsage` / helper threw / stale-estimate edge) — the `windowTokens > 0` conjunct IS the fail-open.
- [ ] `npx tsc --noEmit` passes; `npm test` passes (zero regressions — proven in research/findings.md §7).
- [ ] spec/08-edge-cases.md, spec/05-tools.md, spec/09-configuration.md, and README.md are NOT modified (Mode A).

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this successfully?_ **Yes** — the exact file to host the helper (and why: audit.ts already has every dependency + the module-local `entriesToMessages`), the verbatim helper body, the exact insertion anchors for both files, the verbatim guard block, the in-scope variables (`config`, `granularity`, `ctx`), the config knob (confirmed already shipped), the D5 constraint (filtered view, `.tokens` forbidden / `.contextWindow` permitted), the fail-open chain, the no-circular-import proof, the "existing tests won't break" proof, and the one genuine subtlety (audit's E16 fallback re-runs `filterPipeline` while the helper's cheap fallback does not → leave audit untouched) are all documented below.

### Documentation & References

```yaml
# MUST READ — the spec that defines this feature
- url: spec/08-edge-cases.md §E22 ("Same-prompt rewind retry loop — runaway growth")
  why: E22 defines BOTH E22 hard backstops. The "Required behavior — out-of-band context-fraction stop"
       block is authoritative for THIS task: the exact refusal text, the default (0.9), the independence
       from maxDepth + maxRetriesPerPrompt, and the zero-marker loop vector it catches.
  critical: E22 body says: "if the filtered-context estimate (the same total mulligan_audit computes, §4) is
       >= config.rewind.abortContextFraction (default 0.9) of the model's context window AND a rewind is
       requested, the tool refuses with 'Mulligan: refused — context is at <P>% of the window; rewinding
       will not help. Run mulligan_audit and shrink the largest result.' This stops the runaway before the
       provider rejects the request, regardless of retry accounting. It is independent of both maxDepth and
       maxRetriesPerPrompt — all three apply." E22 acceptance (e) is the test target for P4.M1.T3.S1.
- url: spec/05-tools.md §1 "mulligan_rewind" → "Behavior (step by step)" step 4 (the "Out-of-band context-fraction
       stop" bullet)
  why: Restates the refusal text + the "computed the same estimate mulligan_audit produces" + the independence
       invariant. (The selected_prd_content block quotes this verbatim.)
- url: spec/05-tools.md §4 "mulligan_audit" → "Why audit must use the filtered view (D5)"
  why: D5 — audit tokens (and therefore THIS guard's total) MUST come from the FILTERED view, NOT
       ctx.getContextUsage().tokens (which counts hidden/rewound tokens → bookkeeping drift). This is why the
       helper reads rt.lastFiltered, not getContextUsage().tokens.
- url: spec/08-edge-cases.md §E13 ("Tool throws internally")
  why: E13 mandates every tool body + helper is wrapped try/catch and never breaks a turn. computeFilteredTotal
       must be defensively self-contained (its OWN try/catch → {0,0}), NOT rely on rewindExecute's single outer
       try/catch for its normal failure modes. (The body's outer catch is the last-resort E13 net.)
- url: spec/08-edge-cases.md §E12 ("getContextUsage() undefined (no model / pre-first-inference)")
  why: E12 is exactly the case the `windowTokens === 0` fail-open handles: pre-first-inference or no model →
       getContextUsage() is undefined → contextWindow is 0/undefined → guard SKIPS (never blocks). This is the
       intended behavior, not a bug.

# MUST READ — the files you are editing (primary deliverable)
- file: src/tools/audit.ts
  why: HOSTS computeFilteredTotal (the shared helper). It ALREADY imports estimateTokens + resultBytes from
       "../tokens.js", getRuntime from "../runtime.js", getConfig from "../config.js"; and has the module-local
       entriesToMessages (the E16-fallback entry→message conversion). Placing the helper HERE lets it reuse
       entriesToMessages WITHOUT exporting it or duplicating the flatMap (the contract's stated preference).
  pattern: auditExecute step 1–2 (the "// (1) Resolve the FILTERED view" + "// (2) Total from the filtered view"
           blocks) is the EXACT computation to factor out: prefer Array.isArray(rt.lastFiltered) else
           entriesToMessages(buildContextEntries()); totalTokens = estimateTokens(filtered).tokens. The window
           SIZE pattern (`ctx.getContextUsage?.()?.contextWindow ?? 0`) is confirmed by filter.ts L325–326.
  gotcha: audit's OWN step 1–2 is LEFT UNCHANGED in this task. Its E16 fallback re-runs filterPipeline (accurate,
          reflects markers); the helper's cheap fallback is entriesToMessages ONLY (no pipeline). They DIFFER in
          the fallback path (identical on the cached path). So a refactor of audit's total to call the helper is
          NOT 'same numbers' — leave audit alone (Known Gotchas #5). The helper is exported for FUTURE convergence.
- file: src/tools/rewind.ts
  why: HOSTS the (4c) guard. Contains rewindExecute (where the guard goes) and the refusal() helper (to call).
       The (4b) retry-budget guard is ALREADY in-tree at L453–466; the (5) "read-only ledger" comment is at L467.
       The (4c) guard slots exactly between them.
  pattern: the (4b) block (L453–466) is the IMMEDIATE stylistic + structural model for the (4c) block: a comment
           citing the spec section + E-number + "independent of (4) and (4b)", then `const … = <helper>(ctx);`,
           then `if (<condition>) return refusal(<reason>, granularity);`. Mirror it.
  gotcha: refusal(reason, granularity) ALREADY adds the "Mulligan: refused — " prefix AND the trailing ".".
          Pass the reason with NO trailing period. `granularity`, `config`, and `ctx` are ALREADY in scope at the
          insertion point (declared at the function top / step 1 / the execute signature) — do not re-declare.

# MUST READ — the previous task's PRP (the contract this task consumes + the insertion neighborhood)
- docfile: plan/004_d3d84055c5b2/P4M1T2S1/PRP.md
  why: T2.S1 (guard 4b) is ALREADY IMPLEMENTED in-tree. Its PRP specified the (4b) block AND explicitly LEFT the
       (4c) spot free: "leave the (4c) context-fraction stop ... free (it will insert between this (4b) block and
       the (5) comment in its own task)." This task fills exactly that spot. It also established the defensive
       helper family (countRewindMarkers, countRetriesAtLatestPrompt) that computeFilteredTotal joins.

# MUST READ — the config knob this guard reads (VERIFIED ALREADY SHIPPED in this tree)
- docfile: plan/004_d3d84055c5b2/P4M1T1S1/PRP.md
  why: Defines the config knob. VERIFIED in src/config.ts: L51 `abortContextFraction: number` (interface),
       L132 `abortContextFraction: 0.9` (default), L244–247 validated inline `(0,1]` (NOT coerceNumber — it needs
       the upper bound). No further config work is needed or permitted by this task.

# Grounded research (verified current-tree line numbers + the fail-open chain + the no-break proof)
- docfile: plan/004_d3d84055c5b2/architecture/codebase_patterns.md §3
  why: Documents audit.ts auditExecute step 1–2 as the filtered-total computation to SHARE; the rt.lastFiltered
       preference + the E16 fallback; estimateTokens defensiveness; the window-SIZE pattern (filter.ts L326); D5
       (forbids .tokens only); and the shared-helper extraction recommendation. This PRP operationalizes §3.
- docfile: plan/004_d3d84055c5b2/P4M1T2S2/research/findings.md
  why: This task's own research: config knob confirmed present; estimateTokens signature + never-throws;
       SessionRuntime.lastFiltered type + getRuntime; the (4b)/(5) anchors in rewind.ts (T2.S1 already in-tree);
       the no-circular-import proof (rewind→audit one-way); the "existing tests won't break" proof (makeCtx does
       NOT script getContextUsage → windowTokens 0 → guard skipped); the audit-refactor fallback-path subtlety.

# Reference — how the downstream test will drive this (NOT this task's work, but informs the boundary)
- file: test/tools/rewind.test.ts
  why: The test harness for this tool. The loop-driving test (P4.M1.T3.S1) will reuse makeCtx + makePi + the
       firstText(res) assertion pattern. CRITICAL: makeCtx (L104+) does NOT currently script getContextUsage
       (grep: zero matches) → P4.M1.T3.S1 MUST add a `contextUsage` opt to makeCtx so the guard can read
       .contextWindow. This task writes NO tests.
```

### Current Codebase tree (relevant subset)

```bash
pi-mulligan/
├── package.json          # "test": "vitest run" ; NO tsc/eslint/prettier scripts (call tsc directly)
├── tsconfig.json         # strict:true, moduleResolution:Bundler, include:["src","test"]
├── spec/
│   ├── 05-tools.md       # §1 mulligan_rewind step 4 (4c bullet), §4 mulligan_audit (D5) (READ-ONLY)
│   └── 08-edge-cases.md  # §E22 (the feature), §E12 (windowTokens 0), §E13 (never throws) (READ-ONLY)
├── src/
│   ├── config.ts         # config.rewind.abortContextFraction ALREADY EXISTS (P4.M1.T1.S1) — READ-ONLY here
│   ├── runtime.ts        # SessionRuntime.lastFiltered + getRuntime (READ-ONLY)
│   ├── tokens.ts         # estimateTokens (never throws) (READ-ONLY)
│   ├── filter.ts         # L311–326 the existing high-water windowTokens pattern (READ-ONLY reference)
│   └── tools/
│       ├── audit.ts      # ← EDIT: add exported computeFilteredTotal (after entriesToMessages)
│       └── rewind.ts     # ← EDIT: add import + the (4c) guard block (between (4b) and (5))
└── test/
    └── tools/
        └── rewind.test.ts # ← NOT modified by this task (test matrix = P4.M1.T3.S1)
```

### Desired Codebase tree (files touched)

```bash
src/tools/audit.ts   # MODIFIED — +1 exported helper (~25 lines incl. JSDoc), placed after entriesToMessages
src/tools/rewind.ts  # MODIFIED — +1 import line + 1 guard block (~9 lines)
```
No new files. No other files change. audit.ts's auditExecute body is UNCHANGED.

### Known Gotchas of our codebase & Library Quirks

```ts
// ⚠ CRITICAL #1 — D5: use the FILTERED view, NOT getContextUsage().tokens.
//   The total MUST be estimateTokens(rt.lastFiltered [or the cheap fallback]).tokens. ctx.getContextUsage().tokens
//   reflects Pi's bookkeeping, which STILL COUNTS messages Mulligan has hidden (bookkeeping drift) → it would
//   over-count and WRONGLY REFUSE legitimate rewinds right after a successful rewind/shrink. D5 forbids `.tokens`.
//   The window SIZE — getContextUsage()?.contextWindow — IS permitted (D5 forbids `.tokens` only; filter.ts L326
//   already reads .contextWindow). DO NOT "swap" to getContextUsage().tokens for "accuracy" — it is a D5 violation.

// CRITICAL #2 — rt.lastFiltered is STALE mid-turn; ACCEPT it. DO NOT "fix" the staleness.
//   rt.lastFiltered is the PREVIOUS context-fire's cached filtered view (written by filterPipeline each fire).
//   Read mid-turn from a tool, it predates the current turn's contributions → may UNDER-count the true total.
//   This is ACCEPTABLE for a STOP guard: under-counting means the guard fires LATER / lets more rewinds through
//   (the safe direction — better to let a borderline rewind through than to wrongly refuse a legitimate one).
//   The contract is EXPLICIT: "the guard errs toward firing LATER/under-counting, the safe direction. Do NOT
//   'fix' the staleness by calling getContextUsage().tokens (D5 violation)."

// CRITICAL #3 — computeFilteredTotal MUST be defensively self-contained (E13). ONE try/catch → {0,0}.
//   Do NOT rely on rewindExecute's single outer try/catch for the helper's normal failure modes. Wrap the WHOLE
//   body (getRuntime, lastFiltered read, buildContextEntries, entriesToMessages, estimateTokens, getContextUsage)
//   in ONE try { … } catch { return { totalTokens: 0, windowTokens: 0 }; }. This is the fail-open sentinel.

// CRITICAL #4 — the windowTokens > 0 check IS the fail-open (and the divide-by-zero guard).
//   `if (windowTokens > 0 && totalTokens / windowTokens >= abortContextFraction)`. When windowTokens is 0 (no
//   model / getContextUsage undefined [E12] / helper threw / stale-estimate edge), the conjunct short-circuits
//   to false → the guard is SKIPPED → never blocks a rewind. This is intended (E13: never break a turn over a
//   guard). Compute pct = Math.round((totalTokens/windowTokens)*100) ONLY inside the refusal branch (avoid the
//   div/display when not refusing; also redundant with the already-evaluated conjunct).

// CRITICAL #5 — leave audit.ts's OWN step 1–2 UNCHANGED (the fallback paths DIFFER).
//   audit's E16 fallback (rt.lastFiltered null) RE-RUNS filterPipeline (accurate; reflects rewind/shrink markers)
//   and uses that for BOTH its total AND its per-message breakdown. computeFilteredTotal's fallback is the CHEAP
//   entriesToMessages(buildContextEntries()) → estimateTokens (NO pipeline re-run — the helper is on the rewind
//   hot path and only needs an estimate). So replacing audit's total with computeFilteredTotal(ctx).totalTokens
//   would CHANGE audit's E16-fallback numbers (the CACHED path is identical; the fallback is not). The contract
//   calls the refactor "optionally ... low-risk, same numbers" — that holds only on the cached path. SAFEST:
//   export the helper, use it in rewind, and DO NOT touch audit's computation in this task (zero regression risk;
//   the helper is exported for a FUTURE convergence task that can widen its return to include `filtered`).
//   The deliberate fallback-path difference (audit=accurate/pipeline, rewind=cheap/no-pipeline) is a design
//   choice, not divergence.

// GOTCHA #6 — refusal() adds the prefix AND the trailing period. Pass a reason with NO trailing period.
//   The reason ends with "...shrink the largest result" (no "."). refusal() produces `Mulligan: refused — ${reason}.`

// GOTCHA #7 — the (4b) guard is ALREADY in the tree (T2.S1 shipped). Do NOT re-add it or touch it.
//   The (4c) guard inserts BETWEEN the (4b) block's closing `}` (rewind.ts L466) and the `(5) read-only ledger`
//   comment (L467). Both (4b) and (4c) refuse BEFORE step 5 (preview) and step 6 (persist) → on refusal NOTHING
//   is persisted (no marker, no note). Place (4c) AFTER (4b) so all three guards run in order: (4) maxDepth,
//   (4b) retry budget, (4c) context fraction. They are independent; first refusal wins.

// GOTCHA #8 — entriesToMessages is MODULE-LOCAL in audit.ts. Do NOT export it. Do NOT duplicate the flatMap.
//   computeFilteredTotal lives in audit.ts PRECISELY so it can call the in-scope entriesToMessages without
//   exporting it or duplicating `entries.flatMap(sessionEntryToContextMessages)` defensively (the contract's
//   stated preference: "Prefer importing/exporting to avoid divergence"). If computeFilteredTotal lived in
//   rewind.ts instead, it would need a NEW import of estimateTokens + getRuntime + (exported or duplicated)
//   entriesToMessages + sessionEntryToContextMessages — strictly more surface. audit.ts is the natural home.

// GOTCHA #9 — no circular import. rewind → audit is ONE-WAY.
//   audit.ts imports: tokens, runtime, config, transforms, filter, nudges, markers (type-only). It does NOT
//   import rewind.ts. So `import { computeFilteredTotal } from "./audit.js";` in rewind.ts creates a clean
//   one-way edge. ✅ (If a future task makes audit import from rewind, revisit.)

// LIBRARY QUIRK — vitest does NOT type-check (esbuild transpile only). `npm test` passing does NOT prove types.
//   Run `npx tsc --noEmit` explicitly to gate types. package.json has no tsc script — call it directly.
//   The `as unknown as TM` cast on the estimateTokens arg is REQUIRED (the established audit.ts/filter.ts idiom):
//   rt.lastFiltered is AgentMessage[] (Pi's type) and estimateTokens takes tokens.ts's own MessageLike —
//   structurally compatible but TS rejects across the boundary, so cast through unknown at that one boundary.
```

## Implementation Blueprint

### Data models and structure

No data-model change. `computeFilteredTotal` is a pure `(ctx: ExtensionContext) => { totalTokens: number; windowTokens: number }`.
It reads the already-shipped `config.rewind.abortContextFraction` (number in `(0,1]`, default `0.9`). The guard
returns an `AgentToolResult<RewindDetails>` via the existing `refusal(reason, granularity)` builder. No new types.
One new export (`computeFilteredTotal`) so audit + rewind share one computation (and P4.M1.T3.S1 can import it if
it wants to assert the helper directly, though it is primarily exercised via the tool execute path).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/audit.ts — ADD exported `computeFilteredTotal(ctx)` helper
  - FIND: the END of the module-local `entriesToMessages` function. Its exact closing lines are:
        function entriesToMessages(entries: SessionEntry[]): Record<string, unknown>[] {
          ...
          return out;
        }
    followed immediately by the comment:
        // ── execute (spec/05 §4 behavior; shared tool convention = never throws) ─────
    (i.e. entriesToMessages sits right BEFORE the auditExecute section.)
  - INSERT, BETWEEN entriesToMessages's closing `}` and that `// ── execute` comment, the helper:
    (see "Implementation Patterns & Key Details" below for the VERBATIM body + JSDoc to paste)
  - NAMING: computeFilteredTotal (camelCase, descriptive). EXPORTED (`export function`).
  - PLACEMENT: directly after entriesToMessages — they are the "filtered-view resolution" family (entries→messages
    + the cached filtered view + the total/window estimate). Keeps related code together.
  - DEPS: ALL already imported in audit.ts — estimateTokens (../tokens.js), getRuntime (../runtime.js) — and
    entriesToMessages is in module scope. NO new imports in audit.ts.
  - DEFENSIVE: ONE try { … } catch { return { totalTokens: 0, windowTokens: 0 }; } around the WHOLE body.
    Never throws (E13). Uses `type TM = Parameters<typeof estimateTokens>[0]; estimateTokens(filtered as unknown as TM).tokens`
    (the established in-tree cast idiom).
  - JSDoc MUST document: (a) it is the shared filtered-total + window-size estimate (E22 context-fraction stop);
    (b) D5 — total from the FILTERED view (rt.lastFiltered), NEVER getContextUsage().tokens; .contextWindow IS read;
    (c) rt.lastFiltered staleness is accepted (errs toward firing later/under-counting — the safe direction);
    (d) fail-open: ONE try/catch → {0,0}; the guard's windowTokens>0 check treats 0 as "skip"; (e) why it lives
    here (reuses the module-local entriesToMessages; audit keeps its own more-accurate fallback).

Task 2: EDIT src/tools/rewind.ts — ADD the computeFilteredTotal import
  - FIND: the top import block. The last import line is:
        import {
          partitionIntoUnits,
          resolveLastToolCallGroup,
          resolveLastTurn,
          resolveCheckpoint,
          type BranchEntry,
          type MessageLike,
        } from "../transforms.js";
  - ADD, immediately AFTER that line:
        import { computeFilteredTotal } from "./audit.js"; // E22 out-of-band context-fraction stop (shared with mulligan_audit)
  - NOTE: `./audit.js` (same dir, tools/) uses the ESM/Bundler `.js` convention. The comment cites the feature.
  - VERIFY: no circular import — audit.ts does NOT import from rewind.ts (see Known Gotchas #9).

Task 3: EDIT src/tools/rewind.ts — ADD the (4c) context-fraction stop guard block in rewindExecute
  - FIND: the (4b) per-prompt retry-budget guard block, whose exact text is:
        // (4b) per-prompt retry budget (step 4; E22 hard backstop #1). The marker-counting budget: count
        //     mulligan:rewind markers appended AFTER the latest user-prompt entry (rewinds re-landing at this
        //     prompt). Refuse BEFORE persisting when the count reaches the budget — a self-authored note can
        //     re-instruct the loop's cause, so the note cannot self-correct; only a hard count can arrest it.
        //     Independent of the maxDepth cumulative cap (4) and the context-fraction stop (4c, P4.M1.T2.S2):
        //     all three apply; first refusal wins. countRetriesAtLatestPrompt is defensive (never throws — E13).
        const retries = countRetriesAtLatestPrompt(ctx);
        if (retries >= config.rewind.maxRetriesPerPrompt) {
          return refusal(
            `hit the per-prompt retry budget (${retries}/${config.rewind.maxRetriesPerPrompt} rewinds re-landing at this prompt). Commit to the current state, ask the human, or use mulligan_shrink instead of rewinding again`,
            granularity,
          );
        }
    followed immediately by:
        // (5) read-only ledger + K preview (step 5; best-effort — GOTCHA #6). A failure falls back to empty ledger +
  - INSERT, BETWEEN the (4b) block's closing `}` and the `(5) read-only ledger` comment, this block:
    (see "Implementation Patterns & Key Details" below for the VERBATIM block to paste)
  - VERIFY the reason string is VERBATIM (no trailing period — refusal() adds it). The template literal embeds
    `${pct}`. `config`, `granularity`, and `ctx` are ALL already in scope (config from step 1, granularity from
    the function top, ctx from the execute signature). Do NOT re-declare.
  - PRESERVE: the (4b) guard above it, the (5) read-only-ledger block below it, and the single outer try/catch
    around the whole rewindExecute body (do NOT add a second try/catch — the helper is defensive itself).

Task 4: VERIFY (no edit) — type-check + full suite green
  - RUN: `npx tsc --noEmit` (expect zero errors — additive edits; computeFilteredTotal takes ExtensionContext
    [already imported in audit.ts] and returns a literal type; the cast mirrors the existing audit.ts idiom).
  - RUN: `npm test` (expect zero failures — see research/findings.md §7 proof that NO existing test scripts
    getContextUsage in makeCtx, so windowTokens is 0 for every existing test and the guard is skipped).
```

### Implementation Patterns & Key Details

```ts
// ── computeFilteredTotal — VERBATIM body to paste in audit.ts after entriesToMessages (Task 1) ──
// Reuses audit.ts's already-present imports (estimateTokens, getRuntime) + the in-scope module-local
// entriesToMessages (no export of it, no duplication — the contract's stated preference). Exported so the
// rewind tool's context-fraction stop guard (P4.M1.T2.S2) shares ONE computation with the audit, preventing
// divergence. Audit keeps its OWN (more-accurate, pipeline-re-running) fallback; this helper's fallback is the
// CHEAP entriesToMessages→estimateTokens (no filterPipeline) because the rewind guard is on the hot path and
// only needs an estimate. On the CACHED path (rt.lastFiltered present — the common case) the two are identical.

/**
 * computeFilteredTotal — the shared filtered-context total + context-window SIZE estimate (spec/05 §4 step 2;
 * spec/08 E22 out-of-band context-fraction stop). Returns the SAME total `mulligan_audit` reports and the
 * model's window SIZE, so the rewind tool's context-fraction stop guard (P4.M1.T2.S2) and the audit never
 * diverge. EXPORTED so audit + rewind share one computation (and tests can assert it directly).
 *
 * D5 compliance: the total is computed on the FILTERED view (rt.lastFiltered — what the model actually sees),
 * NEVER ctx.getContextUsage().tokens (which counts hidden/rewound tokens — bookkeeping drift). The window SIZE
 * (`.contextWindow`) IS read and permitted — D5 forbids `.tokens` only (filter.ts L326 already reads .contextWindow).
 *
 * rt.lastFiltered is the PREVIOUS context-fire's cached view (written by filterPipeline each fire). Read
 * mid-turn from a tool, it is a STALE estimate (predates the current turn's contributions) — ACCEPTED for a
 * STOP guard: staleness errs toward UNDER-counting → the guard fires LATER / lets more rewinds through, the
 * safe direction. DO NOT "fix" the staleness by reading getContextUsage().tokens — D5 violation.
 *
 * Fail-open (E13): ONE try/catch around the WHOLE body → on ANY failure returns { totalTokens: 0, windowTokens: 0 }.
 * The rewind guard treats windowTokens === 0 as "skip" (no model [E12] / undefined usage / throw → never block a
 * rewind). Module-local entriesToMessages keeps this helper self-contained without an extra export.
 */
export function computeFilteredTotal(ctx: ExtensionContext): { totalTokens: number; windowTokens: number } {
  try {
    const rt = getRuntime(ctx.sessionManager.getSessionId());
    let filtered;
    if (Array.isArray(rt.lastFiltered)) {
      filtered = rt.lastFiltered;
    } else {
      // E16-style fallback: entries → messages. CHEAPER than audit's fallback (no filterPipeline re-run) — the
      // rewind guard is on the hot path and only needs an estimate. (Audit keeps its own more-accurate fallback.)
      const entries = ctx.sessionManager.buildContextEntries();
      filtered = entriesToMessages(entries);
    }
    type TM = Parameters<typeof estimateTokens>[0];
    const totalTokens = estimateTokens(filtered as unknown as TM).tokens; // estimateTokens never throws (GOTCHA #3)
    const usage = ctx.getContextUsage?.();
    const windowTokens = usage?.contextWindow ?? 0; // D5: .contextWindow (the SIZE) is permitted; .tokens is not
    return { totalTokens, windowTokens };
  } catch {
    // fail-open sentinel — windowTokens 0 makes the rewind guard SKIP (never block a rewind — E13)
    return { totalTokens: 0, windowTokens: 0 };
  }
}

// ── The (4c) guard block — VERBATIM (Task 3) — placed after the (4b) block, before step (5) ──
// (see Implementation Tasks Task 3 for the exact insertion)

        // (4c) out-of-band context-fraction stop (step 4; E22 hard backstop #2). Catches the ZERO-MARKER loop
        //     vector — a spin that persists no rewind yet re-bloats the filtered context each turn (e.g. re-reading
        //     the same large files because a bloated-result nudge keeps re-firing) — which the marker-counting
        //     budget (4b) CANNOT see. If the filtered-context total is >= abortContextFraction of the window,
        //     rewinding hides near nothing relative to the bloat and just grows the session with another marker +
        //     note → refuse and steer to mulligan_shrink. Independent of maxDepth (4) and the retry budget (4b):
        //     all three apply; first refusal wins. computeFilteredTotal is fail-open (returns {0,0} on any throw);
        //     the windowTokens > 0 check IS the fail-open (no model / undefined usage [E12] / throw → SKIP, never
        //     block a rewind — E13). D5: the total is the FILTERED view, NOT getContextUsage().tokens.
        const { totalTokens, windowTokens } = computeFilteredTotal(ctx);
        if (windowTokens > 0 && totalTokens / windowTokens >= config.rewind.abortContextFraction) {
          const pct = Math.round((totalTokens / windowTokens) * 100);
          return refusal(
            `context is at ${pct}% of the window; rewinding will not help. Run mulligan_audit and shrink the largest result`,
            granularity,
          );
        }

// ── What NOT to do ──
// ✗ Do NOT read getContextUsage().tokens for the total — D5 violation (counts hidden tokens). Use rt.lastFiltered.
// ✗ Do NOT "fix" the rt.lastFiltered staleness — it is accepted (errs toward firing later, the safe direction).
// ✗ Do NOT export entriesToMessages from audit.ts — computeFilteredTotal reuses it in-scope (no export, no dup).
// ✗ Do NOT put computeFilteredTotal in rewind.ts — audit.ts is its natural home (all deps + entriesToMessages present).
// ✗ Do NOT refactor audit's own step 1–2 to call this helper in this task — the fallback paths DIFFER (audit re-runs
//   filterPipeline; the helper's fallback does not) → NOT 'same numbers' on the fallback path. Leave audit alone.
// ✗ Do NOT add a trailing period to the refusal reason — refusal() appends the ".".
// ✗ Do NOT add a second try/catch around the guard in rewindExecute — the helper is defensive itself; the body's
//   single outer try/catch is the E13 last resort.
// ✗ Do NOT implement the loop-driving tests — that is P4.M1.T3.S1 (it must add a `contextUsage` opt to makeCtx).
```

### Integration Points

```yaml
CONFIG (READ-ONLY here — P4.M1.T1.S1 already shipped the knob):
  - The guard reads `config.rewind.abortContextFraction` off the `config` already fetched at rewindExecute
    step 1 (`const config = getConfig();`). No wiring change. No new config field.

PERSISTENCE (the whole point of placing the guard before step 5/6):
  - On refusal: `appendRewindMarker` / `leaveNote` (step 6/7) are NEVER reached → no marker, no note,
    no in-memory seq increment. The branch marker count + the filtered context do not grow on a refused call.

TESTS (NOT this task — consumed downstream):
  - P4.M1.T3.S1 will exercise this guard: it must ADD a `contextUsage` opt to makeCtx (test/tools/rewind.test.ts
    L104+) so the fake ctx returns `{ contextWindow: <N> }`, script `rt.lastFiltered` via the runtime map (or rely
    on the entriesToMessages fallback), and assert: (e) a rewind at >= abortContextFraction is refused even with
    budget remaining; the refusal text contains "context is at <P>% of the window"; and a rewind at < fraction
    succeeds. This task only ensures the helper + guard exist for that test to exercise.
  - computeFilteredTotal is EXPORTED, so P4.M1.T3.S1 MAY also unit-test the helper directly
    (import { computeFilteredTotal } from "../../src/tools/audit.js") for the fail-open sentinel
    (throwing ctx → {0,0}) and the {0,0}-skips-the-guard invariant.
  - P4.M1.T2.S3 (suppress drift nudge on a refused turn) consumes the fact that a refusal is returned (any of
    the 4 / 4b / 4c refusal paths).

DOCS (Mode A — no external doc surface):
  - The refusal text IS the agent-facing documentation. spec/08, spec/05, spec/09, README: UNCHANGED.
```

## Validation Loop

### Level 1: Syntax & Type (Immediate Feedback)

```bash
# TypeScript strict type-check. vitest does NOT type-check; run tsc explicitly.
# (package.json has no `tsc` script — call it directly.)
npx tsc --noEmit
# Expected: zero errors. The edits are additive (one new exported function with a literal return type + one
# import + one guard block reusing in-scope vars). audit.ts already imports estimateTokens + getRuntime and has
# entriesToMessages + ExtensionContext in scope; rewind.ts already has config/granularity/ctx in scope. The
# `as unknown as TM` cast is the established audit.ts/filter.ts idiom (rt.lastFiltered is AgentMessage[];
# estimateTokens takes tokens.ts's MessageLike — structurally compatible, cast at the boundary). If tsc errors on
# the import, confirm the path is "./audit.js" (same dir) and that computeFilteredTotal is `export function`.

# (No formatter/linter configured in package.json — skip ruff/eslint/prettier equivalents.)
```

### Level 2: Unit Tests (Regression — this task writes NO new tests)

```bash
# Confirm the new guard does not break ANY existing test. Per research/findings.md §7, NO existing test scripts
# getContextUsage in makeCtx → windowTokens is 0 for every existing test → the (4c) guard is SKIPPED → zero impact.
npx vitest run test/tools/rewind.test.ts   # the tool's own suite (all green)
npx vitest run test/tools/audit.test.ts    # audit's suite — UNCHANGED behavior, but re-run to confirm (all green)
npm test                                   # == `vitest run` — the WHOLE suite (all green)
# Expected: zero failures. If a failure appears in rewind.test.ts, re-read the failing test: if it scripts a
# getContextUsage returning a large contextWindow AND places the filtered total >= 90%, the guard correctly fires
# — but per research, NO existing test scripts getContextUsage, so this should not occur. (If a test scripts
# rt.lastFiltered to a huge array but NOT getContextUsage, windowTokens is still 0 → guard skipped → still green.)
```

### Level 3: Behavioral spot-check (no harness — confirms the boundary manually)

```bash
# This task ships no test, so the authoritative boundary confirmation is the downstream P4.M1.T3.S1 test.
# A quick manual reasoning check (documented for the implementer):
#   abortContextFraction = config.rewind.abortContextFraction = 0.9 (default)
#   window = 100_000 tokens; rt.lastFiltered estimated at 95_000 tokens (>= 0.9 of the window):
#     computeFilteredTotal → { totalTokens: 95000, windowTokens: 100000 }
#     100000 > 0 && 95000/100000 (0.95) >= 0.9 → REFUSE, pct = round(0.95*100) = 95
#     text: "Mulligan: refused — context is at 95% of the window; rewinding will not help. Run mulligan_audit
#            and shrink the largest result."   (nothing persisted)
#   window = 100_000; filtered at 80_000 tokens (< 0.9):
#     0.8 >= 0.9 → false → guard SKIPPED → rewind proceeds normally (subject to (4) and (4b)).
#   no model / pre-first-inference (E12): getContextUsage() undefined → windowTokens 0 → guard SKIPPED → proceeds.
#   helper throws (e.g. getRuntime throws): catch → {0,0} → windowTokens 0 → guard SKIPPED → proceeds (E13).
```

### Level 4: E13 / Defensive Validation (the never-throws + fail-open invariants)

```bash
# computeFilteredTotal must never throw AND must fail open (windowTokens 0 → guard skips). Because makeCtx does
# not script getContextUsage, EVERY existing rewind test already exercises the "windowTokens 0 → skip" path and
# must stay green. The existing "never throws" tests in test/tools/rewind.test.ts (throwing getEntries /
# throwing buildContext) exercise overlapping surfaces; because computeFilteredTotal wraps each read in the
# single try/catch, a throwing buildContextEntries() in the fallback → caught → {0,0} → guard skipped → the
# rewind STILL proceeds exactly as before. Confirm the whole suite stays green:
npm test
# Expected: all green. (The execute body's single outer try/catch is the last-resort E13 net; the helper's own
# try/catch means its normal failure modes never even reach the body's catch.)
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` passes (zero errors).
- [ ] `npm test` passes (zero failures across the whole suite).
- [ ] `npx vitest run test/tools/rewind.test.ts` passes in isolation.
- [ ] `npx vitest run test/tools/audit.test.ts` passes (audit behavior UNCHANGED).

### Feature Validation
- [ ] `computeFilteredTotal(ctx)` exists in src/tools/audit.ts, is EXPORTED, placed after `entriesToMessages`.
- [ ] It prefers `rt.lastFiltered` (when `Array.isArray`) else the cheap `entriesToMessages(buildContextEntries())` fallback; returns `{ totalTokens: estimateTokens(filtered).tokens, windowTokens: ctx.getContextUsage?.()?.contextWindow ?? 0 }`.
- [ ] It is D5-compliant: total from the FILTERED view, NEVER `getContextUsage().tokens`; `.contextWindow` IS read.
- [ ] It is fail-open: ONE try/catch around the whole body → `{ totalTokens: 0, windowTokens: 0 }` on ANY throw; never throws (E13).
- [ ] Its JSDoc documents D5, the accepted rt.lastFiltered staleness (errs toward firing later/under-counting), and the fail-open sentinel.
- [ ] rewind.ts imports `computeFilteredTotal` from `"./audit.js"` (the `.js` ESM/Bundler convention).
- [ ] `rewindExecute` has the `(4c)` guard AFTER the `(4b)` retry-budget guard and BEFORE step `(5)`; it calls `refusal(...)` with the VERBATIM reason (no trailing period) when `windowTokens > 0 && totalTokens / windowTokens >= config.rewind.abortContextFraction`.
- [ ] On refusal NOTHING is persisted (the guard precedes the preview + persist steps).
- [ ] The guard never blocks a rewind when `windowTokens === 0` (no model / undefined usage / throw) — the `windowTokens > 0` conjunct IS the fail-open.
- [ ] `pct` is computed ONLY inside the refusal branch.
- [ ] spec/08-edge-cases.md, spec/05-tools.md, spec/09-configuration.md, and README.md are UNCHANGED.

### Code Quality Validation
- [ ] `computeFilteredTotal` reuses audit.ts's existing imports + the in-scope `entriesToMessages` (no new import in audit.ts, no export of `entriesToMessages`, no flatMap duplication).
- [ ] The guard block matches the `(4b)` block's style (comment citing the spec section + E-number + "independent of (4) and (4b)", `const … = <helper>(ctx);`, `if (<cond>) return refusal(<reason>, granularity);`).
- [ ] No new types. One new export (`computeFilteredTotal`). No second try/catch in the execute body.
- [ ] No circular import (rewind → audit is one-way; audit does not import rewind).

### Documentation & Scope Boundaries
- [ ] The refusal text is the agent-facing doc (Mode A).
- [ ] No config change (P4.M1.T1.S1 already shipped the knob).
- [ ] Audit's own step 1–2 is UNCHANGED (the fallback-path difference is a deliberate design choice).
- [ ] No drift-nudge suppression (P4.M1.T2.S3).
- [ ] No loop-driving test matrix (P4.M1.T3.S1) — only the helper + guard.

---

## Anti-Patterns to Avoid

- ❌ Don't read `ctx.getContextUsage().tokens` for the total — D5 violation (it counts already-hidden/rewound tokens → would wrongly refuse legitimate rewinds after a shrink). Use the filtered view (`rt.lastFiltered` / the cheap fallback).
- ❌ Don't "fix" the `rt.lastFiltered` staleness by reaching for `getContextUsage().tokens` — the staleness is ACCEPTED (it errs toward firing later/under-counting, the safe direction for a stop guard). The contract is explicit about this.
- ❌ Don't export `entriesToMessages` or duplicate its flatMap — put `computeFilteredTotal` in audit.ts so it reuses the in-scope module-local helper. (If you instead put it in rewind.ts, you'd add 3+ new imports + duplicate the conversion — strictly worse.)
- ❌ Don't refactor audit's own step 1–2 to call `computeFilteredTotal` in this task — the fallback paths differ (audit re-runs `filterPipeline`; the helper's cheap fallback does not), so it is NOT "same numbers" on the fallback path. Leave audit untouched; the helper is exported for future convergence.
- ❌ Don't rely on the execute body's outer try/catch for `computeFilteredTotal`'s normal failure modes — it must be defensively self-contained (ONE try/catch → `{0,0}`), like the `countRewindMarkers` / `countRetriesAtLatestPrompt` family.
- ❌ Don't add a trailing period to the refusal reason — `refusal()` appends the `.`.
- ❌ Don't add a second try/catch around the guard in `rewindExecute` — the helper is defensive itself; the body's single outer try/catch is the E13 last resort.
- ❌ Don't re-implement or touch the `(4b)` retry-budget guard — T2.S1 already shipped it. The `(4c)` guard slots after it.
- ❌ Don't write the loop-driving tests (P4.M1.T3.S1) — out of scope. (That task must add a `contextUsage` opt to `makeCtx`.)
- ❌ Don't trust `npm test` alone for type correctness — vitest uses esbuild and does not type-check; run `npx tsc --noEmit`.

---

**Confidence Score: 9.5/10** for one-pass implementation success. The change is small (one ~25-line exported helper with a verbatim body + one import + one ~9-line guard block, all with verbatim code given), every edit anchor is quoted exactly (the `(4b)`/`(5)` neighborhood is confirmed in-tree and T2.S1 already shipped), the config knob is confirmed already shipped, the helper's natural home (audit.ts — all deps + `entriesToMessages` present) and the no-circular-import proof are established, and the "existing tests won't break" claim is proven (makeCtx does not script `getContextUsage` → `windowTokens` 0 → guard skipped on every existing test). The 0.5 deduction is for the genuine subtlety that the audit refactor — which the contract calls "optionally low-risk, same numbers" — is NOT same-numbers on the fallback path (audit re-runs `filterPipeline`; the helper does not); this PRP resolves it for the implementer (leave audit untouched, export the helper for future convergence) and flags it so the implementer does not blindly "refactor audit to prevent divergence" and silently change audit's E16-fallback output.