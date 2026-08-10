# PRP — P1.M4.T1.S1: Add config.enabled gate to mulligan_audit (BUG-005)

## Goal

**Feature Goal**: Fix BUG-005 — `auditExecute` (`src/tools/audit.ts`, line ~525) reads `const config =
getConfig()` but never checks `config.enabled`. When the extension is disabled, the context handler
(`filter.ts:455` `if (!config.enabled) return;`) is a pass-through — the model sees the **UNFILTERED**
view — but `auditExecute`'s E16-fallback path re-runs `filterPipeline`, so it reports markers as active and
a "filtered total" the model does NOT actually see. That is a D5 (honest bookkeeping) and E14 ("the
extension is a no-op") violation: the audit actively misleads when disabled. The fix adds the SAME master
`config.enabled` gate every other tool already has (rewind.ts:478 / shrink.ts:286 / cancel.ts:350), refusing
with `"Mulligan is disabled"` BEFORE any session access or transform — so the disabled audit no longer
reports a transformed view. (Per the contract's RECOMMENDED choice, this is the **simpler refusal** approach,
not the unfiltered-report alternative — kept within 1 SP and consistent with the sibling tools.)

**Deliverable**: (1) A new module-private `refusal(reason)` helper in **`src/tools/audit.ts`** (mirrors
shrink.ts:132 / cancel.ts:166 — audit has none today); (2) a one-line `if (!config.enabled) return
refusal("Mulligan is disabled");` gate inserted in `auditExecute` BETWEEN `const config = getConfig()` and
`const sessionId = ctx.sessionManager.getSessionId()`; (3) [Mode A] an update to the file-header source
comment at line 23 (currently `"NO config gate (GOTCHA #4)"`) + the `auditExecute` JSDoc; (4) a regression
test in **`test/tools/audit.test.ts`** asserting the disabled-path refusal text + the zeroed `AuditDetails`.
Three edits, two files.

**Success Definition**: After the fix, `mulligan_audit` called with `config.enabled === false` returns
`{ content:[{type:"text", text:"Mulligan: refused — Mulligan is disabled."}], details:{ totalTokens:0,
confidence:"low", source:"fallback", nRewinds:0, nShrinks:0, nCheckpoints:0, nCancelled:0, top:[] } }`,
touches NO `sessionManager` method (the gate fires before `getSessionId()`), and runs NO
`filterPipeline`/`buildContextEntries`/`getBranch` (no transformed view is ever computed). With
`config.enabled === true` (the default), behavior is byte-for-byte unchanged (all existing audit tests stay
green). `npm run typecheck` exits 0; `npx vitest run` passes with the test count raised by the new
`it` block(s) and ZERO regressions.

> ⚠️ **[Mode A] doc update.** The only documentation change is in-source: the file-header comment at
> `audit.ts` line 23 (`"NO config gate (GOTCHA #4) …"`) + the `auditExecute` JSDoc note the new gate. NO
> separate `.md` doc file (README/VERIFICATION sync is sibling P1.M5.T1.S1 — do NOT touch it here).

## User Persona (if applicable)

**Target User**: The agent (consumer of `mulligan_audit`) + the operator who disables Mulligan via
`config.enabled`.

**Use Case**: An operator sets `"mulligan": { "enabled": false }` (E14 master switch — e.g. to temporarily
disable the extension mid-session). The context handler becomes pass-through (the model sees the raw,
unfiltered context). The agent then calls `mulligan_audit` to inspect its context. Pre-fix, the audit ran
`filterPipeline` and reported a *filtered* total + markers-as-active — a view the model does NOT see,
actively misleading the agent about how much context it carries (D5). Post-fix, the audit refuses with a
clear reason and a zeroed `details`, consistent with every other Mulligan tool.

**Pain Points Addressed**: Pre-fix, the disabled audit contradicts the model's actual experience (it claims
a filtered total + active markers while the model sees the raw view). This is a D5 honesty violation and an
E14 no-op violation. The fix makes the disabled audit a consistent, honest no-op.

## Why

- **Spec MUST (spec/08 E14)**: *"Extension disabled via config — Situation: `config.enabled === false` … The
  extension is a no-op."* Every other tool already honors this with `if (!config.enabled) return
  refusal("Mulligan is disabled");`. The audit is the lone holdout, so its output when disabled is an
  exception to the very rule that defines "disabled".
- **Spec MUST (D5 / spec/05 §4)**: the audit's core contract is *"honest bookkeeping — show the agent what
  the model ACTUALLY sees."* When disabled the model sees the UNFILTERED view, but the audit's E16-fallback
  runs `filterPipeline` and reports a TRANSFORMED view — the precise opposite of D5. Refusing (or, in the
  unfiltered-report alternative, reporting the raw view) is the fix; this task takes the refuse path.
- **Consistency with the sibling tools (E14 symmetry)**: rewind / shrink / cancel all return `Mulligan:
  refused — Mulligan is disabled.` when `config.enabled === false`. The audit returning a full report while
  disabled is the inconsistency that makes the extension look half-disabled. Matching the refusal unifies the
  contract.
- **Scope discipline (1 SP)**: the contract offers two approaches — (a) report the unfiltered view, or (b)
  refuse. The PRD RECOMMENDS (b) for consistency + 1-SP fit. This PRP implements (b). Approach (a) (a future
  enhancement) would duplicate the entire top-N/marker rendering loop against `buildContextEntries`-without-
  `filterPipeline` — too much for a 1-SP subtask and lower-value than a consistent refusal.

## What

A surgical control-flow gate + a new shared helper + in-source doc + a regression test.

1. **`src/tools/audit.ts`** — add a module-private `refusal(reason: string): AgentToolResult<AuditDetails>`
   helper (mirrors shrink.ts:132-134 / cancel.ts:166-168). Insert the gate in `auditExecute` right after
   `const config = getConfig();` and BEFORE `const sessionId = ctx.sessionManager.getSessionId();`.
2. **`src/tools/audit.ts`** — [Mode A] rewrite the file-header comment bullet at line 23 (currently
   `"- NO config gate (GOTCHA #4): …"`) to state the audit NOW gates on the MASTER `config.enabled` (E14 +
   D5), and add a one-line note to the `auditExecute` JSDoc that step 0 is the config gate.
3. **`test/tools/audit.test.ts`** — add a new `describe("mulligan_audit — config.enabled === false (BUG-005;
   spec/08 E14)", …)` block that sets `enabled:false`, seeds a cached view (to prove it is IGNORED), and
   asserts the exact refusal text + the zeroed `details`, plus that the session is NOT touched.

### Success Criteria

- [ ] With `config.enabled === false`, `mulligan_audit` returns exactly
      `{ content:[{type:"text", text:"Mulligan: refused — Mulligan is disabled."}], details:{ totalTokens:0,
      confidence:"low", source:"fallback", nRewinds:0, nShrinks:0, nCheckpoints:0, nCancelled:0, top:[] } }`.
- [ ] The gate is positioned AFTER `const config = getConfig()` and BEFORE `const sessionId =
      ctx.sessionManager.getSessionId()` — so the disabled path touches NO `sessionManager` method and runs
      NO `filterPipeline` / `buildContextEntries` / `getBranch` (no transformed view computed).
- [ ] With `config.enabled === true` (default), behavior is unchanged — every existing audit test passes
      unchanged (the gate short-circuits only when `enabled` is falsy).
- [ ] The refusal text matches the sibling tools BYTE-FOR-BYTE: `Mulligan: refused — Mulligan is disabled.`
      (em-dash `—` U+2014 between "refused" and "Mulligan"; trailing period; built by the `refusal()` helper).
- [ ] The new `refusal()` helper is the SINGLE source of the prefix+dot format (no inline duplication);
      `AuditDetails` is fully populated (all 8 required fields incl. `top: []`) — satisfies CRITICAL GOTCHA #1
      (details REQUIRED on every return path).
- [ ] `npm run typecheck` exits 0; `npx vitest run` passes with the audit test count raised and 0 regressions.
- [ ] Exactly two files modified: `src/tools/audit.ts` + `test/tools/audit.test.ts`.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: the verbatim `auditExecute` head (the `const config = getConfig()` → `const sessionId = …` boundary, the FIND/REPLACE anchors); the verbatim sibling `refusal()` helper (shrink.ts:132-134) to mirror; the verbatim file-header comment at line 23 (the FIND anchor) + its rewrite; the exact `AuditDetails` shape the disabled path must return (the contract OUTPUT, verified against the interface); the verified config mechanism (`setConfig({enabled:false})` merges — config.ts:206-239, default `enabled:true`); the verbatim test pattern to mirror (shrink.test.ts:199-209 `beforeEach(setConfig({enabled:false}))` + `expect(firstText(res)).toBe("Mulligan: refused — shrink is disabled.")`); and the audit test harness facts (`auditTool.execute("c1",params,undefined,undefined,ctx)`, `firstText`, `res.details`, `makeCtx()→{calls,ctx}`, sessionId `"s1"`). The implementer opens two files and runs two commands.

### Documentation & References

```yaml
# MUST EDIT — the gate + the refusal() helper + the line-23 comment + the JSDoc
- file: src/tools/audit.ts
  why: Owns auditExecute (the ungated tool, BUG-005). Add (a) a module-private refusal() helper; (b) the gate
        in auditExecute after `const config = getConfig()` and before `const sessionId = ...`; (c) [Mode A]
        rewrite the file-header comment bullet at line 23; (d) add a step-0 note to the auditExecute JSDoc.
  section: "(a) refusal() helper: place it among the module-private helpers (near isRecord/readOwn, ~line 130)
            OR right above auditExecute (~line 515). (b) gate: inside auditExecute's try{}, the 2nd statement.
            (c) line-23 comment: the bullet 'NO config gate (GOTCHA #4): ...'. (d) auditExecute JSDoc: the
            'Steps (spec/05 §4 ...)' list."
  pattern: "Mirror shrink.ts:132-134 / cancel.ts:166-168 EXACTLY for refusal(): returns AgentToolResult<...>
            with content [{type:'text', text:`Mulligan: refused — ${reason}.`}] + a details object. Audit's
            details has MORE required fields than Shrink/Cancel (nCheckpoints, nCancelled, top, source,
            confidence, totalTokens) — populate them ALL (see Implementation Patterns)."
  gotcha: "GOTCHA #1: the gate MUST go BEFORE `const sessionId = ctx.sessionManager.getSessionId()` (not after).
           The whole point is the disabled path touches NO session method and runs NO transform. Placing it
           after sessionId reads the session unnecessarily (harmless) but after the rt=getRuntime() line it
           would still be fine — just place it FIRST, right after config, for cleanliness + the testable
           'getSessionId not called' invariant."

# MUST EDIT — the regression test
- file: test/tools/audit.test.ts
  why: Add the disabled-refusal regression test. Mirrors shrink.test.ts:199-209 (the shrink-disabled refusal)
        + the audit test harness (auditTool.execute directly, firstText, res.details). NO existing audit test
        sets enabled:false (grep-verified — all use setConfig({}) defaults) → purely additive, no breakage.
  section: "Append a new describe block at the end of the file (or grouped with the other 'paths'). Reuse the
            file's existing helpers: setConfig, makeCtx (returns {calls,ctx}), run(ctx, params) =
            auditTool.execute(...), firstText(res), getRuntime, userMsg. do NOT add new helpers."
  pattern: "beforeEach(() => setConfig({ enabled: false }));  // master switch off (merges with defaults)
            then seed getRuntime('s1').lastFiltered = [...] (PROVES it is ignored when disabled), call
            run(ctx,{top:8}), and assert firstText(res).toBe('Mulligan: refused — Mulligan is disabled.') +
            res.details.toEqual({...all-zero...}) + calls.not.toContain('getSessionId')."
  gotcha: "GOTCHA #2: the fake ctx's sessionId is 's1' (existing tests seed getRuntime('s1').lastFiltered).
           Seeding it is DELIBERATE — it proves the disabled path ignores the cache (D5: no transformed view).
           Assert res.details.totalTokens === 0 (NOT the seeded cache's token count)."

# MUST READ — the sibling refusal() helpers (the verbatim pattern to mirror)
- file: src/tools/shrink.ts
  why: shrink.ts:132-134 is the canonical refusal() builder (cancel.ts:166-168 is identical): builds
        `Mulligan: refused — ${reason}.` + a details object. shrink.ts:286 is the canonical gate site
        (`if (!config.enabled) return refusal("Mulligan is disabled");`). COPY this shape; only the details
        TYPE differs (AuditDetails vs ShrinkDetails).
  critical: "READ-ONLY. Do NOT edit shrink.ts/cancel.ts. The ONLY difference: audit's refusal() returns a
             fully-populated AuditDetails (8 fields incl. top:[]), not ShrinkDetails/CancelDetails."

# MUST READ — the bug root cause + the contrast table
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/bug_verification.md
  why: §BUG-005 (lines 191-243) confirms: auditExecute (lines 545-570) has NO config.enabled gate; the E16
        fallback runs filterPipeline; the line-23 comment documents this as intentional ('always-on'). The
        contrast table (lines 222-224) lists the exact gate sites in rewind/shrink/cancel. The Impact section
        (230-243) states the D5 + E14 violation precisely.
  critical: "READ-ONLY. This is the authoritative root-cause doc; the contract OUTPUT matches its framing."

# MUST READ — the exact spec clauses violated (the contract)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/spec_requirements.md
  why: §BUG-005 (line 178+) quotes spec/08 E14 ('Extension disabled via config — Situation: config.enabled
        === false ... the extension is a no-op') + spec/05 §4 (D5 honesty). The Summary table (line 279-280)
        lists BOTH clauses. These are the acceptance contract.
  critical: "READ-ONLY. The refusal reason 'Mulligan is disabled' is the E14 convention every tool uses —
             reuse it verbatim (do NOT paraphrase to 'audit is disabled' etc.)."

# CONTEXT — the config mechanism (verified — setConfig merges, default enabled:true)
- file: src/config.ts
  why: setConfig(raw) → validateConfig(raw) which does field-by-field coerceBoolean merge over DEFAULT_CONFIG
        (lines 206-239). DEFAULT_CONFIG.enabled = true (line 136). So setConfig({enabled:false}) sets the
        master switch off AND keeps every other default. This is exactly how shrink.test.ts:199 drives the
        disabled path. getConfig() (line 191) lazily validates once + caches.
  critical: "READ-ONLY. The test's setConfig({enabled:false}) is CORRECT — it does NOT wipe other fields."

# CONTEXT — the parallel-sibling PRP (zero file overlap)
- file: plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/P1M3T2S1/PRP.md
  why: CONTRACT. P1.M3.T2.S1 (BUG-006) edits src/tools/rewind.ts (step 5b) + test/tools/rewind.test.ts.
        ZERO overlap with audit.ts / audit.test.ts. Any landing order; no merge conflict.
  gotcha: "Both siblings run in parallel; neither touches audit.ts or audit.test.ts. No coordination needed."
```

### Current Codebase tree (the relevant slice)

```bash
src/tools/
├── audit.ts            # ← EDIT: +refusal() helper; +config.enabled gate in auditExecute; [Mode A] line-23 comment + JSDoc
├── shrink.ts           # READ-ONLY — refusal() pattern (132-134) + gate site (286) to mirror
├── cancel.ts           # READ-ONLY — refusal() pattern (166-168) + gate site (350) to mirror
└── rewind.ts           # READ-ONLY — gate site (478); sibling P1.M3.T2.S1's file (BUG-006), do not touch
test/tools/
├── audit.test.ts       # ← EDIT: +1 describe block (disabled-refusal regression)
└── shrink.test.ts      # READ-ONLY — disabled-refusal test pattern (199-209) to mirror
src/config.ts           # READ-ONLY — setConfig/getConfig/validateConfig + DEFAULT_CONFIG.enabled=true
src/filter.ts           # READ-ONLY — contextHandler gate at line 455 (the pass-through the audit must match)
plan/005_95d30743cdd4/bugfix/001_3f1132e1694f/architecture/
├── bug_verification.md     # READ-ONLY — §BUG-005 (191-243) root cause + contrast table
└── spec_requirements.md    # READ-ONLY — §BUG-005 (178+) E14 + D5 clauses
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. This item MODIFIES exactly two existing files:
src/tools/audit.ts        # +1 module-private refusal() helper; +1 config.enabled gate line; [Mode A] comment + JSDoc
test/tools/audit.test.ts  # +1 describe block (config.enabled===false → refusal + zeroed details)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL GOTCHA #1 (audit.ts has NO refusal() helper today — you must ADD one):
//   Unlike shrink.ts (line 132) and cancel.ts (line 166), audit.ts has no module-private refusal() builder.
//   Its catch path (auditExecute ~line 560) builds the AgentToolResult inline. For the disabled gate you
//   have two options: (a) ADD a refusal(reason) helper mirroring shrink/cancel (RECOMMENDED — single source
//   of the prefix+dot format, consistent with siblings), or (b) inline the return. This PRP uses (a). The
//   helper returns AgentToolResult<AuditDetails> with ALL 8 required fields populated (totalTokens:0,
//   confidence:"low", source:"fallback", nRewinds:0, nShrinks:0, nCheckpoints:0, nCancelled:0, top:[]).
//   Do NOT reuse the catch path's inline object — factoring a helper is cleaner + testable.

// CRITICAL GOTCHA #2 (the gate goes BEFORE sessionId — position is load-bearing for the test):
//   Insert `if (!config.enabled) return refusal("Mulligan is disabled");` as the 2nd statement of the try{}
//   (right after `const config = getConfig();`), BEFORE `const sessionId = ctx.sessionManager.getSessionId();`.
//   This makes the disabled path touch NO sessionManager method — a deterministic, assertable invariant
//   (`expect(calls).not.toContain("getSessionId")`). Placing it AFTER sessionId is harmless functionally but
//   breaks that clean invariant + reads the session unnecessarily. Place it FIRST.

// CRITICAL GOTCHA #3 (refusal text is BYTE-FOR-BYTE the sibling convention — em-dash U+2014):
//   The text is exactly `Mulligan: refused — Mulligan is disabled.` — the em-dash is U+2014 (—), NOT a
//   hyphen (-) or en-dash (–). shrink.ts:134 / cancel.ts:168 / rewind.ts:176 all emit U+2014. The refusal()
//   helper builds it via a template literal `Mulligan: refused — ${reason}.` so copy that EXACT string.
//   The test asserts .toBe(...) (exact equality), so a hyphen would fail. The reason is the LITERAL string
//   "Mulligan is disabled" (E14 convention) — do NOT paraphrase to "audit is disabled".

// CRITICAL GOTCHA #4 (AuditDetails has MORE required fields than ShrinkDetails/CancelDetails):
//   AuditDetails (audit.ts interface) requires: totalTokens, confidence, source, nRewinds, nShrinks,
//   nCheckpoints, nCancelled, top (AuditRow[]), and optional error. The disabled-refusal details must set
//   ALL of these (top:[], counts 0). The contract OUTPUT shape is the exact shape. Missing `top` or any
//   count field is a tsc error (strict) AND a test failure (toEqual is exact). Mirror the catch path's
//   object but WITHOUT `error` (the disabled path is not an error — it's a deliberate refusal).

// GOTCHA #5 (the line-23 comment + JSDoc are [Mode A] doc — they ride WITH the work, not separate):
//   The file-header bullet at line 23 currently says 'NO config gate (GOTCHA #4): ... always-on diagnostics'.
//   That is now FALSE — rewrite it to state the audit gates on the MASTER config.enabled (E14 + D5),
//   refusing "Mulligan is disabled" when false, and note it does NOT have a config.audit.enabled SUB-switch
//   (it gates on the master, like the other tools). Also add a step-0 line to the auditExecute JSDoc:
//   '0. config.enabled gate (E14): if the master switch is off, refuse "Mulligan is disabled" BEFORE any
//   session access (D5: when disabled the model sees the unfiltered view; reporting a transformed view would
//   mislead).' Do NOT touch the spec/* files.

// GOTCHA #6 (no existing audit test sets enabled:false — purely additive, zero breakage):
//   grep-confirmed: every audit.test.ts beforeEach uses setConfig({}) (defaults, enabled:true) or a
//   shrink/rewind sub-config. NONE sets the master enabled:false. So adding the gate changes NO existing
//   test's outcome — the gate only fires on the new disabled-path test. The test count goes UP by your new
//   it block(s); nothing goes red.

// OUT OF SCOPE (do NOT touch):
//   - The unfiltered-report alternative (approach (a)) — future enhancement; this task implements refusal.
//   - shrink.ts / cancel.ts / rewind.ts / their tests — READ-ONLY (siblings + the pattern sources).
//   - config.ts — READ-ONLY (setConfig already does what we need; no new knob).
//   - filter.ts contextHandler gate (line 455) — that is the PROD pass-through; correct as-is.
//   - spec/*, README.md, VERIFICATION.md — READ-ONLY (Mode A in-source docs only; README is P1.M5.T1.S1).
// This PRP edits ONLY src/tools/audit.ts + test/tools/audit.test.ts.
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no new types. The fix reuses `AgentToolResult<AuditDetails>` (already imported) and the existing
`AuditDetails` interface. The new `refusal()` helper is a module-private function returning that type. No
schema, no export, no config knob._

### The exact before → after (the task's core logic)

**`src/tools/audit.ts` — `auditExecute` head (the gate insertion site):**

```ts
// BEFORE (current — auditExecute try{} head, ungated):
async function auditExecute(...): Promise<AgentToolResult<AuditDetails>> {
  try {
    const config = getConfig();
    const sessionId = ctx.sessionManager.getSessionId(); // read FRESH (C12)
    const rt = getRuntime(sessionId);
    // ... (1) resolve the filtered view ...

// AFTER (target — gate as the 2nd statement, before sessionId):
async function auditExecute(...): Promise<AgentToolResult<AuditDetails>> {
  try {
    const config = getConfig();
    // BUG-005 (spec/08 E14 + D5): when the master switch is off the context handler is pass-through — the
    // model sees the UNFILTERED view. Running filterPipeline here would report a TRANSFORMED view the model
    // does NOT see (D5 violation). Refuse BEFORE any session access, matching rewind/shrink/cancel (E14).
    if (!config.enabled) return refusal("Mulligan is disabled");
    const sessionId = ctx.sessionManager.getSessionId(); // read FRESH (C12)
    const rt = getRuntime(sessionId);
    // ... (1) resolve the filtered view ...
```

**The new `refusal()` helper (mirrors shrink.ts:132-134 / cancel.ts:166-168, AuditDetails variant):**

```ts
/**
 * refusal — build the shared "Mulligan: refused — <reason>." result (spec/05 shared convention; mirrors
 * shrink.ts:132 / cancel.ts:166). The details object is the DISABLED/low-confidence AuditDetails (all
 * counts zero, top empty) — REQUIRED on every return path (CRITICAL GOTCHA #1). NEVER throws.
 * Module-private (audit is the only consumer).
 */
function refusal(reason: string): AgentToolResult<AuditDetails> {
  return {
    content: [{ type: "text" as const, text: `Mulligan: refused — ${reason}.` }],
    details: {
      totalTokens: 0,
      confidence: "low",
      source: "fallback",
      nRewinds: 0,
      nShrinks: 0,
      nCheckpoints: 0,
      nCancelled: 0,
      top: [],
    },
  };
}
```

**[Mode A] the line-23 file-header comment rewrite:**

```ts
// BEFORE (line 23, current — now FALSE):
 * - NO config gate (GOTCHA #4): there is no `config.audit.enabled` switch and the audit does NOT refuse when
 *   `config.enabled === false`. The audit is always-on diagnostics (read-only). Mirror checkpoint GOTCHA #4.

// AFTER (target — reflects the BUG-005 fix):
 * - config.enabled gate (E14 + D5, BUG-005): the audit gates on the MASTER `config.enabled` switch and refuses
 *   "Mulligan is disabled" when it is false — the SAME gate rewind/shrink/cancel have (spec/08 E14 "the
 *   extension is a no-op"). When disabled, the context handler is pass-through (the model sees the UNFILTERED
 *   view), so running filterPipeline here would report a TRANSFORMED view the model does NOT see (D5 violation).
 *   There is still NO `config.audit.enabled` SUB-switch — the audit gates on the master only (like the others).
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD the refusal() helper to src/tools/audit.ts
  - PLACE it as a module-private function. Best spot: among the other module-private helpers near the top
    (after readStr/truncate, ~line 130) OR directly above auditExecute (~line 515). Either is fine — pick
    the spot that matches the file's existing grouping (the helpers cluster near the top).
  - COPY the body from "Implementation Patterns & Key Details" §refusal EXACTLY (em-dash U+2014 in the
    template literal; ALL 8 AuditDetails fields populated; `type: "text" as const`).
  - NAMING: `refusal` (matches shrink.ts/cancel.ts exactly — single source of the prefix+dot format).
  - DEPENDENCIES: uses `AgentToolResult<AuditDetails>` (already imported/defined in this file). No new import.

Task 2: INSERT the config.enabled gate in auditExecute (src/tools/audit.ts)
  - LOCATE auditExecute's try{} head: `const config = getConfig();` followed by `const sessionId =
    ctx.sessionManager.getSessionId();`.
  - INSERT BETWEEN them (GOTCHA #2): a comment citing BUG-005 + E14 + D5, then
    `if (!config.enabled) return refusal("Mulligan is disabled");`.
  - PRESERVE: `const config = getConfig();` (unchanged), `const sessionId = ...` (unchanged), and EVERYTHING
    below (the filtered-view resolution, marker read, render, the catch path).
  - DO NOT: move/renumber the numbered steps; touch the catch path; add a config.audit.enabled check (there
    is no such knob — gate on the MASTER config.enabled only).

Task 3: [Mode A] REWRITE the line-23 file-header comment + add the step-0 note to the auditExecute JSDoc
  - FIND the bullet at line 23 beginning `* - NO config gate (GOTCHA #4):` and REPLACE with the AFTER text
    in "Implementation Patterns & Key Details" §comment (GOTCHA #5).
  - ADD a step-0 line to the auditExecute JSDoc's numbered-steps list (it currently starts at step 1
    "Resolve the FILTERED view"): '0. config.enabled gate (E14, BUG-005): if the master switch is off, refuse
    "Mulligan is disabled" BEFORE any session access (D5: when disabled the model sees the unfiltered view;
    reporting a transformed view would mislead).'
  - PRESERVE: the rest of the JSDoc + the other file-header bullets (CRITICAL INSIGHT #1, GOTCHA #1/#5/#10, etc.).

Task 4: ADD the disabled-refusal regression test to test/tools/audit.test.ts
  - APPEND a new describe block (mirrors shrink.test.ts:199-209 + the audit harness). See "Implementation
    Patterns & Key Details" §TEST-NEW for the verbatim body.
  - REUSE existing helpers: setConfig, makeCtx (→{calls,ctx}), run(ctx,params), firstText(res), getRuntime,
    userMsg. NO new helpers, NO new imports beyond what's already there.
  - ASSERT: (1) firstText(res).toBe("Mulligan: refused — Mulligan is disabled."); (2) res.details.toEqual the
    exact zeroed shape; (3) calls does NOT contain "getSessionId"/"buildContextEntries"/"getBranch" (proves
    no session/transform touch — D5).
  - PLACEMENT: end of file, or grouped with the other "paths" describes. do NOT modify any existing test.

Task 5: VALIDATE
  - RUN: `npm run typecheck`  → expect exit 0 (the refusal() helper + gate are strict-safe; AuditDetails
    fully populated).
  - RUN: `npx vitest run test/tools/audit.test.ts` → expect all pass (existing + the new disabled block).
  - RUN: `npx vitest run`     → expect full suite green; test count UP by the new it block(s); 0 regressions.
  - RUN scope guard: `git diff --name-only` → expect EXACTLY src/tools/audit.ts + test/tools/audit.test.ts.
```

### Implementation Patterns & Key Details

**§refusal** (the new module-private helper — verbatim, mirrors shrink.ts:132-134):
```ts
/**
 * refusal — build the shared "Mulligan: refused — <reason>." result (spec/05 shared convention; mirrors
 * shrink.ts:132 / cancel.ts:166). The details object is the disabled/low-confidence AuditDetails (all
 * counts zero, top empty) — REQUIRED on every return path (CRITICAL GOTCHA #1). NEVER throws. Module-private.
 */
function refusal(reason: string): AgentToolResult<AuditDetails> {
  return {
    content: [{ type: "text" as const, text: `Mulligan: refused — ${reason}.` }],
    details: {
      totalTokens: 0,
      confidence: "low",
      source: "fallback",
      nRewinds: 0,
      nShrinks: 0,
      nCheckpoints: 0,
      nCancelled: 0,
      top: [],
    },
  };
}
```

**§gate** (the insertion — verbatim, the 2nd statement of auditExecute's try{}):
```ts
    const config = getConfig();
    // BUG-005 (spec/08 E14 + D5): when the master switch is off the context handler is pass-through — the
    // model sees the UNFILTERED view. Running filterPipeline here would report a TRANSFORMED view the model
    // does NOT see (D5 violation). Refuse BEFORE any session access, matching rewind/shrink/cancel (E14).
    if (!config.enabled) return refusal("Mulligan is disabled");
    const sessionId = ctx.sessionManager.getSessionId(); // read FRESH (C12)
```

**§comment** (the line-23 file-header bullet rewrite — FIND the current bullet, REPLACE with this):
```ts
 * - config.enabled gate (E14 + D5, BUG-005): the audit gates on the MASTER `config.enabled` switch and refuses
 *   "Mulligan is disabled" when it is false — the SAME gate rewind/shrink/cancel have (spec/08 E14 "the
 *   extension is a no-op"). When disabled, the context handler is pass-through (the model sees the UNFILTERED
 *   view), so running filterPipeline here would report a TRANSFORMED view the model does NOT see (D5 violation).
 *   There is still NO `config.audit.enabled` SUB-switch — the audit gates on the master only (like the others).
```

**§TEST-NEW** (the regression test — append a new describe; reuses the file's existing helpers):
```ts
// ── config.enabled === false: refusal gate (BUG-005; spec/08 E14 + D5) ───────────────────────────────

describe("mulligan_audit — config.enabled === false (BUG-005; spec/08 E14, D5)", () => {
  beforeEach(() => setConfig({ enabled: false })); // master switch off (merges with defaults)

  it("refuses 'Mulligan is disabled' with zeroed details; does NOT run filterPipeline / report a transformed view", async () => {
    const { calls, ctx } = makeCtx();
    // Seed the cache so we can PROVE the disabled path ignores it (D5: no transformed view is computed).
    getRuntime("s1").lastFiltered = [userMsg("seeded but must be ignored when disabled")];
    const res = await run(ctx, { top: 8 });
    // E14 refusal text (refusal() adds the "Mulligan: refused — " prefix + trailing "."):
    expect(firstText(res)).toBe("Mulligan: refused — Mulligan is disabled.");
    // The disabled-path AuditDetails (the contract OUTPUT — all counts zero, top empty, no `error`):
    expect(res.details).toEqual({
      totalTokens: 0,
      confidence: "low",
      source: "fallback",
      nRewinds: 0,
      nShrinks: 0,
      nCheckpoints: 0,
      nCancelled: 0,
      top: [],
    });
    // D5 proof: the gate fires BEFORE any session access — no sessionManager method is called, so NO
    // transformed view (filterPipeline/buildContextEntries/getBranch) is ever computed when disabled.
    expect(calls).not.toContain("getSessionId");
    expect(calls).not.toContain("buildContextEntries");
    expect(calls).not.toContain("getBranch");
  });

  it("re-enabling (config.enabled === true) restores normal behavior — the gate is not sticky", async () => {
    // (Optional but high-value: proves the gate is a runtime read, not a cached/latched state.)
    setConfig({ enabled: true });
    const { ctx } = makeCtx();
    getRuntime("s1").lastFiltered = [userMsg("hello world this is a short user message")];
    const res = await run(ctx, { top: 8 });
    expect(res.details.source).toBe("cached"); // back on the normal PRIMARY path
    expect(firstText(res)).toContain("## Mulligan audit — context you are currently carrying");
    expect(firstText(res)).not.toContain("Mulligan is disabled");
  });
});
```

Key points the fix encodes (understand, don't just paste):

```ts
// PATTERN — every Mulligan tool has a `if (!config.enabled) return refusal("Mulligan is disabled");` as its
//   FIRST guard (E14). audit was the lone exception; this makes it consistent. The refusal() helper is the
//   single source of the "Mulligan: refused — <reason>." format (DRY + the agent can pattern-match refusals).

// CRITICAL — position BEFORE sessionId (GOTCHA #2): the disabled path must touch NO sessionManager method.
//   This is what makes `expect(calls).not.toContain("getSessionId")` a valid, deterministic assertion AND
//   what guarantees no filterPipeline/buildContextEntries runs (no transformed view — D5).

// CRITICAL — AuditDetails is FULLY populated (GOTCHA #4): the disabled refusal is NOT an error path, so it
//   omits `error?`, but it MUST set all 8 required fields. toEqual (exact) in the test catches a missed field.

// CRITICAL — the text uses U+2014 em-dash (GOTCHA #3): `Mulligan: refused — Mulligan is disabled.` Copy the
//   sibling template literal verbatim; the test asserts .toBe (exact) so a hyphen/en-dash fails.
```

### Integration Points

```yaml
NO NEW INTEGRATION POINTS — one helper + one gate + one test, all in two files.
  - DATABASE: none
  - CONFIG: none (no new knob — the audit gates on the EXISTING master config.enabled; setConfig already
              merges enabled:false over defaults. No config.ts change.)
  - ROUTES: none
  - CODE (audit.ts): +1 module-private refusal() helper; +1 `if (!config.enabled) return refusal(...)` as
            the 2nd statement of auditExecute's try{} (before sessionId); [Mode A] line-23 comment rewrite +
            step-0 JSDoc note. No new import, no signature change, no export added.
  - CODE (downstream — NO edits): filter.ts contextHandler (line 455) is the prod pass-through (correct);
            the catch path in auditExecute is unchanged; shrink/cancel/rewind are READ-ONLY (pattern sources).
  - TESTS (audit.test.ts): +1 describe block (disabled refusal + optional re-enable). Reuses setConfig/
            makeCtx/run/firstText/getRuntime/userMsg — no new helpers. Test count UP; 0 regressions.
  - DOCS: [Mode A] — the line-23 comment + the auditExecute JSDoc step-0 note ARE the doc. NO separate .md.
          README/VERIFICATION sync is sibling P1.M5.T1.S1 (do NOT touch).
  - PARALLEL-SIBLING: P1.M3.T2.S1 (BUG-006) edits src/tools/rewind.ts + test/tools/rewind.test.ts. ZERO
            file overlap with audit.ts / audit.test.ts. Any landing order; no merge conflict.
```

---

## Validation Loop

This is a one-helper + one-gate + one-test fix. Validation = grep the new pattern present, typecheck clean,
the audit suite green (existing + new disabled test), and a proof the disabled path touches no session.

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# (a) The gate is present and BEFORE sessionId:
grep -n 'if (!config.enabled) return refusal("Mulligan is disabled")' src/tools/audit.ts   # Expected: 1 hit.
grep -nB1 'const sessionId = ctx.sessionManager.getSessionId' src/tools/audit.ts | grep -q 'refusal("Mulligan is disabled")' && echo "gate BEFORE sessionId ✓" || echo "gate NOT before sessionId — reposition"

# (b) The refusal() helper exists + uses the em-dash format:
grep -n 'function refusal(reason: string): AgentToolResult<AuditDetails>' src/tools/audit.ts   # Expected: 1 hit.
grep -nF 'Mulligan: refused — ${reason}.' src/tools/audit.ts   # Expected: 1 hit (the template literal; U+2014).

# (c) The line-23 comment no longer claims "NO config gate":
grep -nF 'NO config gate (GOTCHA #4)' src/tools/audit.ts && echo "STALE COMMENT — rewrite it (Task 3)" || echo "line-23 comment updated ✓"
grep -nF 'config.enabled gate (E14 + D5, BUG-005)' src/tools/audit.ts   # Expected: 1 hit (the new bullet).

# (d) The regression test landed:
grep -n 'config.enabled === false (BUG-005' test/tools/audit.test.ts   # Expected: 1 hit (the new describe).
grep -nF 'Mulligan: refused — Mulligan is disabled.' test/tools/audit.test.ts   # Expected: ≥1 hit (the assertion).
```
Expected: (a) gate present + before sessionId; (b) helper + em-dash template present; (c) stale comment gone, new bullet present; (d) test + assertion present.

### Level 2: Type-check (the strict gate)

```bash
npm run typecheck        # = tsc --noEmit (strict; tsconfig includes src + test)
echo "typecheck exit: $?"
# Expected: exit 0, NO output. The refusal() helper returns AgentToolResult<AuditDetails> with ALL required
#           fields; the gate returns that. If tsc errors, the likely cause is a MISSED AuditDetails field in
#           refusal() (GOTCHA #4) — add it. READ the tsc output and fix before proceeding.
```
Expected: exit 0.

### Level 3: Unit Tests (the new test + no regressions)

```bash
# The audit suite (the file with the fix + the new disabled test):
npx vitest run test/tools/audit.test.ts
# Expected: ALL pass. Existing tests (setConfig({}) defaults → enabled:true → gate skipped) are unchanged.
#           The new disabled-refusal test passes. If the new test FAILS on the text assertion, check the
#           em-dash (GOTCHA #3). If it FAILS on details.toEqual, a field is missing/wrong (GOTCHA #4).

# Confirm the disabled test specifically:
npx vitest run test/tools/audit.test.ts -t "config.enabled === false"
# Expected: the new describe's it block(s) pass.

# Full suite (catches any cross-file surprise — there should be NONE; the gate only affects audit):
npx vitest run
# Expected: all files green; test count UP by the new it block(s). If a non-audit file changed, scope leaked.
```
Expected: audit suite green; full suite green, count up.

### Level 4: Behavior proof (manual reasoning — the contract OUTPUT)

```bash
# Confirm the gate sits BEFORE sessionId (the no-session-touch invariant):
sed -n '/async function auditExecute/,/const rt = getRuntime/p' src/tools/audit.ts
# Expected: `const config = getConfig();` → the BUG-005 comment → `if (!config.enabled) return refusal(...)`
#           → `const sessionId = ...` → `const rt = getRuntime(sessionId);`. The gate is the 2nd statement.

# Confirm NO other tool file was touched (sibling P1.M3.T2.S1 owns rewind.ts):
git diff --name-only | grep -qE 'src/tools/(shrink|cancel|rewind).ts' && echo "sibling tool touched — check it's not YOUR hunk" || echo "no sibling tool files in your diff ✓"
# Expected: "no sibling tool files in your diff ✓".
```
Expected: gate is the 2nd statement (before sessionId); no sibling tool file in your diff.

### Level 5: Scope-discipline gate (no collateral edits)

```bash
git -C . diff --name-only
# Expected: EXACTLY these two files:
#   src/tools/audit.ts
#   test/tools/audit.test.ts
git -C . diff --name-only | grep -vE '^(src/tools/audit\.ts|test/tools/audit\.test\.ts)$' && echo "OUT OF SCOPE — revert" || echo "scope OK"
# Expected: "scope OK". shrink.ts/cancel.ts/rewind.ts (pattern sources / sibling), config.ts, filter.ts,
#           spec/*, README.md, VERIFICATION.md must NOT appear in YOUR diff.
```
Expected: only the two listed files in the diff.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: grep confirms the gate (before sessionId), the refusal() helper (+ em-dash template), the
      updated line-23 comment (stale text gone), and the regression test + assertion.
- [ ] Level 2: `npm run typecheck` exits 0 (AuditDetails fully populated on the refusal path).
- [ ] Level 3: `npx vitest run test/tools/audit.test.ts` passes; full `npx vitest run` green (count up, 0 regressions).
- [ ] Level 4: the gate is the 2nd statement of auditExecute (before sessionId); no sibling tool file in your diff.
- [ ] Level 5: `git diff --name-only` shows EXACTLY `src/tools/audit.ts` + `test/tools/audit.test.ts`.

### Feature Validation
- [ ] With `config.enabled === false`, `mulligan_audit` returns the exact contract OUTPUT (refusal text +
      zeroed AuditDetails, no `error` field).
- [ ] The disabled path touches NO `sessionManager` method and runs NO `filterPipeline`/`buildContextEntries`/
      `getBranch` (D5 — no transformed view; provable via `calls` assertions).
- [ ] With `config.enabled === true` (default), behavior is byte-for-byte unchanged (existing tests green).
- [ ] The refusal text matches the sibling tools byte-for-byte: `Mulligan: refused — Mulligan is disabled.`
      (em-dash U+2014, trailing period).
- [ ] The [Mode A] line-23 comment reflects the new gate (E14 + D5 + BUG-005) and the auditExecute JSDoc
      has a step-0 config-gate note.

### Code Quality / Scope Discipline
- [ ] The new `refusal()` helper is the single source of the prefix+dot format (no inline duplication).
- [ ] The gate reads the MASTER `config.enabled` (no invented `config.audit.enabled` sub-switch).
- [ ] Did NOT edit shrink.ts/cancel.ts/rewind.ts (pattern sources / sibling P1.M3.T2.S1's file).
- [ ] Did NOT edit config.ts (setConfig already merges `enabled:false`; no new knob), filter.ts, spec/*,
      README.md, or VERIFICATION.md.
- [ ] Did NOT implement the unfiltered-report alternative (out of scope — refusal approach chosen per contract).

### Documentation
- [ ] [Mode A] satisfied: the line-23 file-header comment + the auditExecute JSDoc step-0 note ARE the doc.
- [ ] The regression test docstring explains BUG-005 (D5: disabled model sees unfiltered view; audit must not
      report a transformed view).
- [ ] No separate `.md` written; README/VERIFICATION sync is sibling P1.M5.T1.S1.

---

## Anti-Patterns to Avoid

- ❌ Don't implement the unfiltered-report alternative (approach (a)). The contract RECOMMENDS the simpler
  refusal approach for consistency with the sibling tools + 1-SP fit. Approach (a) duplicates the entire
  top-N/marker rendering loop against `buildContextEntries`-without-`filterPipeline` — too much for this
  subtask and lower-value than a consistent refusal. The unfiltered report is a documented future enhancement.
- ❌ Don't place the gate AFTER `const sessionId = ctx.sessionManager.getSessionId()`. It must be the 2nd
  statement of the try{} (right after `const config = getConfig()`), BEFORE sessionId. Placing it later
  reads the session unnecessarily AND breaks the deterministic `calls.not.toContain("getSessionId")`
  invariant (GOTCHA #2). Place it FIRST.
- ❌ Don't paraphrase the refusal reason. It is the LITERAL string `"Mulligan is disabled"` — the E14
  convention every tool uses (rewind/shrink/cancel). The test asserts `.toBe("Mulligan: refused — Mulligan is
  disabled.")` exactly. "audit is disabled" / "Mulligan is off" etc. fail the assertion + break consistency.
- ❌ Don't use a hyphen or en-dash. The separator is U+2014 EM DASH (`—`), matching shrink.ts:134 /
  cancel.ts:168 / rewind.ts:176. Copy the sibling template literal verbatim. A hyphen fails the `.toBe` test.
- ❌ Don't omit any AuditDetails field on the refusal path (GOTCHA #4). The interface requires totalTokens,
  confidence, source, nRewinds, nShrinks, nCheckpoints, nCancelled, top. The contract OUTPUT sets all of
  them. A missed field is a tsc error (strict) AND a `toEqual` failure. (Omit only the optional `error?` —
  the disabled refusal is deliberate, not an error.)
- ❌ Don't inline the return instead of adding a `refusal()` helper. audit.ts has no such helper today; adding
  one (mirroring shrink/cancel) is the single source of the prefix+dot format + keeps the gate a clean
  one-liner. Inlining duplicates the format string and diverges from the sibling convention.
- ❌ Don't leave the line-23 comment stale. It currently says "NO config gate (GOTCHA #4) … always-on
  diagnostics" — that is now FALSE and would actively mislead the next reader. Rewrite it (Task 3 / §comment).
- ❌ Don't add a `config.audit.enabled` sub-switch. The audit gates on the MASTER `config.enabled`, exactly
  like rewind/shrink/cancel. There is no per-tool audit enable knob (and config.ts is not in scope to edit).
- ❌ Don't touch the catch path. The catch path already returns a full AuditDetails (with `error`). The
  disabled refusal is a SEPARATE, earlier return via the new `refusal()` helper (no `error` field). They are
  distinct paths — do not merge them.
- ❌ Don't modify any existing audit test. None sets `enabled:false` (grep-verified), so none is affected by
  the gate. This is purely additive: one new describe block. If an existing test goes red, you've changed
  more than the gate — revert and re-scope.
- ❌ Don't edit shrink.ts/cancel.ts/rewind.ts/config.ts/filter.ts. Those are READ-ONLY (pattern sources +
  sibling P1.M3.T2.S1's file + the prod pass-through). Only `audit.ts` + `audit.test.ts` change.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a focused one-helper + one-gate + one-test fix in two
files, with: the verbatim `auditExecute` head (FIND anchor = `const config = getConfig()` → `const sessionId
= …`) and the verbatim gate (REPLACE) quoted; the verbatim sibling `refusal()` helper (shrink.ts:132-134) to
mirror, adapted to the fuller `AuditDetails`; the exact contract OUTPUT shape (all 8 fields); the verbatim
line-23 comment (FIND) + its rewrite (REPLACE); the verified config mechanism (`setConfig({enabled:false})`
merges over `DEFAULT_CONFIG.enabled=true` — config.ts:206-239); the verbatim test pattern (shrink.test.ts:
199-209 `beforeEach(setConfig({enabled:false}))` + `.toBe("Mulligan: refused — shrink is disabled.")` style);
and the audit harness facts (`auditTool.execute("c1",params,undefined,undefined,ctx)`, `firstText`,
`res.details`, `makeCtx()→{calls,ctx}`, sessionId `"s1"`). The non-regression proof is a verified fact: no
existing audit test sets `enabled:false`, so the gate is purely additive. The residual uncertainty is the
exact placement of the `refusal()` helper (top-of-file helpers cluster vs. just-above-auditExecute — both
valid) and whether the implementer keeps the optional "re-enable restores behavior" second `it` — both are
stylistic and fully exemplified, hence not 10/10.