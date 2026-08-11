# PRP — P1.M2.T4.S1: Add getConfig().enabled gate to checkpointExecute (BUG-007)

## Goal

**Feature Goal**: Fix BUG-007 — `mulligan_checkpoint` (`src/tools/checkpoint.ts`) currently performs **no**
`config.enabled` check, so with the extension disabled (`enabled:false`) it still writes a
`mulligan:checkpoint:` label — a mutation by an extension the operator believes is fully disabled. This violates
spec/08 E14 ("tools refuse with 'Mulligan is disabled.' The extension is a no-op."). The fix adds the master-switch
gate so checkpoint refuses cleanly when disabled, byte-identical to the other four tools (rewind/shrink/audit/cancel).

**Deliverable**: Edits to **two files**:
1. `src/tools/checkpoint.ts` — (a) add `import { getConfig } from "../config.js";`; (b) add the gate as the
   first statement inside the `checkpointExecute` try block (after `const name = params?.name;`, before name
   validation) returning the disabled-refusal result with the **exact** text
   `"Mulligan: refused — Mulligan is disabled."`; (c) update the file-header "NO config gate here (GOTCHA #4)"
   comment to document that the gate is now present per E14.
2. `test/tools/checkpoint.test.ts` — (a) add `import { setConfig } from "../../src/config.js";` and
   `setConfig(undefined)` resets to the global `beforeEach`/`afterEach`; (b) add a new
   `config-disabled refusal` describe block with 2 tests pinning the gate behavior.

**Success Definition**: (a) `mulligan_checkpoint({name})` with `getConfig().enabled === false` returns
`{ content:[{type:"text", text:"Mulligan: refused — Mulligan is disabled."}], details:{ name } }` and does
**NOT** call `setCheckpoint` (no label written); (b) the disabled-refusal text is **byte-identical** to what
rewind/shrink/audit/cancel emit (cancel.test.ts:412 pins the same string); (c) the gate fires BEFORE name
validation, so an invalid name still gets the disabled refusal when the master switch is off; (d)
`npx tsc --noEmit` exits 0; (e) `npx vitest run test/tools/checkpoint.test.ts` all green.

## User Persona

**Target User**: An operator who sets `enabled:false` in `settings.json` to disable Mulligan without uninstalling.

**Use Case**: The operator disables Mulligan (e.g. debugging a tool-result issue) and expects the extension to be
a complete no-op — no context transform, no nudges, and **no tool mutations**.

**Pain Points Addressed**: Today `mulligan_checkpoint` still writes a label when disabled, contradicting the
operator's expectation and E14's blanket "tools refuse" contract.

## Why

- **Spec fidelity**: spec/08-edge-cases.md E14 states when `config.enabled === false` "tools refuse with
  'Mulligan is disabled.' The extension is a no-op." Four of five tools comply; checkpoint is the lone holdout
  (its header even documents the omission as intentional). See `architecture/system_context.md` BUG-007.
- **Consistency**: rewind/shrink/audit/cancel all gate on the master switch as step 1 of their execute body.
  Checkpoint should match — it is the only writer of the `mulligan:checkpoint:` label namespace, and a label is a
  real persisted mutation, not an "inert label" in the disabled-extension sense.
- **Minimal blast radius**: a 5-line code addition (import + gate) + one comment update + a focused test. No data-
  model change, no new config field (spec/09 has no `config.checkpoint` section — the master switch is the only
  gate, mirroring `cancel`).

## What

Add a `getConfig().enabled` master-switch gate to `checkpointExecute`, placed as the first statement inside its
existing try block (before the name-format validation), so checkpoint refuses — without calling `setCheckpoint`
and without writing a label — whenever the extension is disabled. The refusal text matches the other four tools
exactly. Update the file-header comment that currently claims "NO config gate here". Add a focused vitest
describe block covering the disabled case + the gate-before-validation ordering.

### Success Criteria

- [ ] `checkpoint.ts` imports `getConfig` from `"../config.js"` (`.js` ESM extension).
- [ ] With `getConfig().enabled === false`, `checkpointExecute` returns the disabled-refusal result and does NOT
      call `setCheckpoint` (no label written).
- [ ] The disabled-refusal text is exactly `"Mulligan: refused — Mulligan is disabled."` (byte-identical to the
      other four tools).
- [ ] The gate is the first check inside the try block — BEFORE name validation (an invalid name + disabled →
      disabled refusal, not invalid-name refusal).
- [ ] The file-header "NO config gate here (GOTCHA #4)" comment is replaced with documentation that the gate is
      now present per E14.
- [ ] `npx tsc --noEmit` → exit 0; `npx vitest run test/tools/checkpoint.test.ts` → all green.
- [ ] No file other than `checkpoint.ts` and `checkpoint.test.ts` is modified.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?"

**Yes.** This PRP contains: (1) the **verbatim** current `checkpointExecute` body + the exact insertion point;
(2) the **verbatim** target gate code (import + inline disabled-refusal result) with the exact byte-parity text;
(3) the **verified** disabled-text emitted by all four sibling tools (with the source-of-truth test pin); (4) the
**critical gotcha** that checkpoint's own `refusal()` helper is dotless (so the disabled case is inlined for
byte-parity, NOT routed through that helper); (5) the verbatim header-comment FIND/REPLACE; (6) the verbatim
test additions (import + global setConfig reset + the new describe block); (7) deterministic tsc + vitest gates.

### Documentation & References

```yaml
# MUST EDIT — the code fix (import + gate + header comment)
- file: src/tools/checkpoint.ts
  why: Add the getConfig import, the master-switch gate (first stmt inside the try), and update the file header.
  section: "imports (top of file); checkpointExecute body (~lines 96-130); file-header comment (~lines 27-30)."
  pattern: "Gate is INSIDE the try, after `const name = params?.name;`, before the (1) name-validation block —
            mirrors rewind.ts:511 / shrink.ts:286 / cancel.ts:350 (config gate is step 1, validation is step 2+)."
  gotcha: "checkpoint's OWN refusal() helper (lines 84-89) does NOT append a trailing '.' (unlike the other four
           tools' helpers). So the disabled case is INLINED with the exact dotted text for byte-parity — do NOT
           route it through refusal(). See Known Gotchas."

# MUST EDIT — the test additions
- file: test/tools/checkpoint.test.ts
  why: Add setConfig import + global reset; add a config-disabled refusal describe block (2 tests).
  section: "imports; the global beforeEach/afterEach (currently only clearAll()); append a new describe block
            after the existing 'no-stable-entry refusal' describe."
  pattern: "Mirror cancel.test.ts:401-413: per-describe beforeEach(()=>setConfig({enabled:false})) +
            afterEach(()=>setConfig(undefined)) + an exact-text assertion on the disabled refusal."
  gotcha: "clearAll() (runtime reset) does NOT reset the config cache — only setConfig() does. Add
           setConfig(undefined) to the global beforeEach/afterEach so a disabled test never bleeds into siblings."

# MUST READ — the four sibling gates (verify the exact disabled text + placement)
- file: src/tools/cancel.ts
  why: line 350 = `if (!getConfig().enabled) return refusal("Mulligan is disabled");` — the closest sibling
        (cancel also has NO sub-knob; master switch only). cancel.ts:178 = the refusal() helper that ADDS the
        trailing '.' (→ emitted text "Mulligan: refused — Mulligan is disabled.").
  section: "cancelExecute step (1) config gate, ~line 350; refusal() helper, ~lines 175-180."
  critical: "The emitted disabled text is "Mulligan: refused — Mulligan is disabled." (WITH the trailing period).
             cancel.test.ts:412 pins it: expect(firstText(res)).toBe(\"Mulligan: refused — Mulligan is disabled.\")."

# MUST READ — spec source-of-truth (READ-ONLY)
- file: spec/08-edge-cases.md
  why: E14 (line 71-73) defines the disabled contract verbatim.
  section: "## E14. Extension disabled via config (lines 71-73). READ-ONLY — do NOT edit spec/*."
  critical: "E14: when config.enabled===false, "the context handler returns immediately (pass-through); tools
             refuse with \"Mulligan is disabled.\" The extension is a no-op.""

# MUST READ — getConfig / setConfig behavior
- file: src/config.ts
  why: getConfig() is lazy-cached, returns a fresh structuredClone, never throws (falls back to DEFAULT_CONFIG).
        setConfig(undefined) → DEFAULT_CONFIG (enabled:true). DEFAULT_CONFIG.enabled === true.
  section: "getConfig() (~line 90), setConfig() (~line 105), DEFAULT_CONFIG (~line 70)."
  gotcha: "getConfig() is safe to call on the tool hot path (cheap clone, never throws)."

# MUST READ — architecture fix guidance (the authoritative BUG-007 note)
- docfile: plan/006_5b685875f3df/bugfix/001_f8322783910c/architecture/system_context.md
  why: BUG-007 section (lines 190-201) gives root cause + fix sketch + "Files Touched".
  section: "### BUG-007 (Minor): Checkpoint tool not gated by config.enabled (lines 190-201)."
  critical: "The doc sketches refusal(\"Mulligan is disabled\") (the helper). But checkpoint's helper is dotless
             — see this PRP's Known Gotchas for why the disabled case is INLINED for byte-parity instead."

# MUST READ — the exhaustive pre-researched analysis
- docfile: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M2T4S1/research/bug007_checkpoint_config_gate.md
  why: The verified 5-tool disabled-text table, the dot-parity decision rationale, the test idiom, the header-
        comment replacement text, and the scope/parallel-safety analysis.
  critical: "The dot-parity decision is the single most important implementation choice — read it before coding."

# CONTEXT — parallel sibling (NO file conflict)
- file: plan/006_5b685875f3df/bugfix/001_f8322783910c/P1M2T3S1/PRP.md
  why: CONTRACT. Edits src/tools/cancel.ts + test/tools/cancel.test.ts ONLY. Zero overlap with checkpoint files.
  critical: "Do NOT touch cancel.ts or cancel.test.ts (sibling-owned). Both run in parallel; full-suite gate
             validates both changesets together."
```

### Current Codebase tree (the only relevant slice)

```bash
src/config.ts                     # READ-ONLY — getConfig()/setConfig(), DEFAULT_CONFIG.enabled=true
src/tools/checkpoint.ts           # ← EDIT: import + gate (inside try) + header comment
src/tools/cancel.ts               # READ-ONLY reference — closest sibling gate pattern (line 350)
src/tools/{rewind,shrink,audit}.ts# READ-ONLY reference — the other three gates (all emit the dotted text)
spec/08-edge-cases.md             # READ-ONLY — E14 source-of-truth (line 71-73)
test/tools/checkpoint.test.ts     # ← EDIT: setConfig import + global reset + new disabled describe block
test/tools/cancel.test.ts         # READ-ONLY reference — disabled-gate test idiom (lines 401-413)
src/tools/cancel.ts               # OUT OF SCOPE — sibling P1.M2.T3.S1
test/tools/cancel.test.ts         # OUT OF SCOPE — sibling P1.M2.T3.S1
```

### Desired Codebase tree with files to be added/changed

```bash
src/tools/checkpoint.ts           # MODIFIED — +1 import, +5-line gate, header comment rewrite
test/tools/checkpoint.test.ts     # MODIFIED — +1 import, +setConfig in global hooks, +1 describe block (2 tests)
# (no new files)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL (DOT PARITY — the single most important detail): checkpoint.ts's OWN refusal() helper
// (lines 84-89) is the ONLY one of the five tools that does NOT append a trailing period:
//     content: [{ type: "text", text: `Mulligan: refused — ${reason}` }]   // NO "."
// The other four helpers ALL append ".":
//     shrink.ts:140 / audit.ts:160 / rewind.ts:179 / cancel.ts:178  →  `... ${reason}.`
// So calling checkpoint's refusal("Mulligan is disabled", name) would emit the DOTLESS
// "Mulligan: refused — Mulligan is disabled" — diverging from the other four tools' DOTTED text pinned at
// cancel.test.ts:412 ("Mulligan: refused — Mulligan is disabled."). The work-item contract directive "match
// the other tools' exact text" WINS over the architecture-doc sketch (refusal("Mulligan is disabled")).
// THEREFORE the disabled case is INLINED with the exact dotted text — NOT routed through refusal(). This is a
// clean 5-line block with ZERO blast radius on checkpoint's other refusal callers (whose reasons inconsistently
// include/exclude trailing dots; touching the helper risks double-periods). Do NOT "fix" the helper in this task.

// CRITICAL (PLACEMENT — gate is step 1, BEFORE name validation): ALL four sibling tools place the config gate
// as the FIRST check inside the execute try block, before any param validation. So an INVALID name + disabled →
// the DISABLED refusal (NOT the invalid-name refusal). rewind.test.ts:326-331 + shrink.test.ts:213-225 pin this
// ordering. Place the gate immediately after `const name = params?.name;` and before the `// (1) Validate name`
// block. (name must be in scope for details:{name}.)

// CRITICAL (NEVER THROW / fail-open): the gate is INSIDE checkpointExecute's existing try/catch. getConfig()
// never throws anyway (config.ts falls back to DEFAULT_CONFIG on any error), so this is belt-and-suspenders
// consistency with the shared tool convention (E13: tools never throw on the hot path).

// GOTCHA (the .js ESM import extension): every src file imports siblings with the `.js` extension
// (ESM/Bundler resolution — checkpoint.ts:46 `from "../markers.js"`). The new import MUST be
// `from "../config.js"` (NOT "../config"). cancel.ts:36 / shrink.ts:62 / rewind.ts:59 all do this.

// GOTCHA (clearAll() does NOT reset config): test/tools/checkpoint.test.ts uses clearAll() (runtime reset) in
// its global beforeEach/afterEach, but clearAll() resets ONLY the runtime seq/state maps — NOT the config cache
// (cachedConfig in config.ts, reset only by setConfig()). Add setConfig(undefined) to the global hooks so a
// disabled test's setConfig({enabled:false}) cannot bleed into sibling describes.

// GOTCHA (no config.checkpoint sub-knob): spec/09-configuration.md has NO checkpoint config section. The master
// `enabled` switch is the ONLY gate (mirrors cancel, which also has no sub-knob — cancel.ts GOTCHA #6). Do NOT
// add a config.checkpoint field.

// GOTCHA (details shape): CheckpointDetails = { name: string; entryId?: string }. The disabled-refusal returns
// details:{ name } (name always present, NO entryId — setCheckpoint was never called). This matches checkpoint's
// existing refusal() details shape exactly. name is typed `string` (CheckpointArgs = { name: string }), so
// details:{ name } typechecks with NO guard. (The work-item contract's `typeof name === 'string' ? name : ''`
// guard is unnecessary — name is always a string here; omit it for cleanliness.)

// OUT OF SCOPE (do NOT touch):
#   - src/tools/cancel.ts + test/tools/cancel.test.ts -> sibling P1.M2.T3.S1 (BUG-006).
#   - spec/* (READ-ONLY source of truth), README.md, VERIFICATION.md (those are P1.M3.T1.S1/S2).
#   - src/index.ts, src/markers.ts, src/config.ts, the other tools, nudges.ts, filter.ts.
# This PRP edits ONLY src/tools/checkpoint.ts + test/tools/checkpoint.test.ts.
```

---

## Implementation Blueprint

### Data models and structure

_N/A — no type change. The gate returns an `AgentToolResult<CheckpointDetails>` with `details:{ name }`
(`CheckpointDetails` is unchanged: `{ name: string; entryId?: string }`, checkpoint.ts:79-83). No new config
field. No new export.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT src/tools/checkpoint.ts — add the getConfig import
  - FIND (verbatim current, the LAST import line, ~line 46):
      "import { setCheckpoint } from \"../markers.js\"; // GOTCHA #2: .js extension (ESM/Bundler resolution)"
  - REPLACE WITH (add the config import directly below it — same .js convention):
      "import { setCheckpoint } from \"../markers.js\"; // GOTCHA #2: .js extension (ESM/Bundler resolution)
       import { getConfig } from \"../config.js\"; // BUG-007: E14 master-switch gate (enabled:false → refuse)"
  - GOTCHA: the .js extension is REQUIRED (ESM/Bundler resolution; every src file does this). NOT "../config".

Task 2: EDIT src/tools/checkpoint.ts — add the gate inside checkpointExecute's try block
  - FIND (verbatim current — the top of the try block, ~lines 99-103):
      "  const name = params?.name;
        try {
          // (1) Validate name format (spec/05 §3 step 1; spec/04 §6; spec/08 E10). THE TOOL OWNS THIS (GOTCHA #3).
          if (!validCheckpointName(name)) {"
  - REPLACE WITH (insert the gate as the FIRST stmt inside try, BEFORE the (1) name-validation block):
      "  const name = params?.name;
        try {
          // (0) config gate (spec/08 E14, BUG-007): master switch off → refuse BEFORE name validation (mirrors
          //     rewind/shrink/audit/cancel step 1). Byte-identical to the other four tools' disabled text.
          //     INLINED (NOT via refusal()) because checkpoint's refusal() helper omits the trailing '.' — see
          //     the file-header note + the research/bug007 dot-parity decision. setCheckpoint is NOT called → no
          //     label is written. details:{name} for correlation (CheckpointDetails; no entryId on refusal).
          if (!getConfig().enabled) {
            return {
              content: [{ type: \"text\", text: \"Mulligan: refused — Mulligan is disabled.\" }],
              details: { name },
            };
          }
          // (1) Validate name format (spec/05 §3 step 1; spec/04 §6; spec/08 E10). THE TOOL OWNS THIS (GOTCHA #3).
          if (!validCheckpointName(name)) {"
  - RATIONALE: gate-first ordering (step 0 before step 1) matches all four sibling tools; an invalid name +
    disabled → disabled refusal (not invalid-name refusal). The inline result produces the exact dotted text the
    other four emit. details:{name} reuses the existing CheckpointDetails shape.
  - PRESERVE: the existing (1) name-validation block, the (2) setCheckpoint delegation, the (3a/3b) success/error
    returns, and the catch block — ALL unchanged. The `const name = params?.name;` line stays.
  - DO NOT: route the disabled case through checkpoint's refusal() helper (it is dotless → parity break). Do NOT
    add a config.checkpoint sub-knob. Do NOT move the gate outside the try.

Task 3: EDIT src/tools/checkpoint.ts — update the file-header comment (the GOTCHA #4 "NO config gate" line)
  - FIND (verbatim current, ~lines 27-30):
      " * NO config gate here (GOTCHA #4): there is no `config.checkpoint.enabled` switch (spec/09 has no checkpoint
       * config section); checkpoints are inert labels, there is nothing to disable. This item does NOT modify
       * src/index.ts (wiring is P1.M7.T1.S1)."
  - REPLACE WITH (document that the gate is now present per E14):
      " * config.enabled gate (spec/08 E14, BUG-007): checkpointExecute refuses with
       * \"Mulligan: refused — Mulligan is disabled.\" when getConfig().enabled === false, BEFORE name validation
       * (mirrors rewind/shrink/audit/cancel step 1). No label is written when disabled (setCheckpoint is not
       * called). There is still NO config.checkpoint sub-knob (spec/09 has no checkpoint section) — the master
       * switch is the only gate (like cancel). NOTE: the disabled case is inlined (not via the refusal() helper)
       * because checkpoint's refusal() omits the trailing \".\" the other four tools' helpers add; inlining yields
       * byte-identical disabled text across all five tools. This item does NOT modify src/index.ts (P1.M7.T1.S1)."
  - RATIONALE: the old comment documented an intentional omission that BUG-007 reverses. The new comment records
    the gate's presence, placement, byte-parity rationale, and the no-sub-knob decision.
  - PRESERVE: the surrounding header structure (the DESIGN bullets, the other GOTCHA references). Change ONLY the
    "NO config gate here (GOTCHA #4)" paragraph.

Task 4: EDIT test/tools/checkpoint.test.ts — add the setConfig import + global reset
  - FIND (verbatim current, ~lines 30-31 imports + ~lines 45-46 global hooks):
      "import { clearAll } from \"../../src/runtime.js\";"
      ... and ...
      "beforeEach(() => clearAll());
       afterEach(() => clearAll());"
  - REPLACE WITH (add the import next to the runtime import; add setConfig(undefined) to BOTH global hooks):
      "import { clearAll } from \"../../src/runtime.js\";
       import { setConfig } from \"../../src/config.js\"; // BUG-007: checkpoint now reads getConfig()"
      ... and ...
      "beforeEach(() => {
         clearAll();
         setConfig(undefined); // DEFAULT_CONFIG: enabled:true (so a prior disabled test never bleeds)
       });
       afterEach(() => {
         clearAll();
         setConfig(undefined); // reset the config cache to defaults
       });"
  - GOTCHA: clearAll() resets ONLY runtime seq/state maps — NOT the config cache. setConfig(undefined) is required
    so a disabled test's setConfig({enabled:false}) cannot leak into sibling describes. Matches cancel.test.ts:284.
  - PRESERVE: the existing comment above the hooks ("GOTCHA #8 ... clearAll() before AND after each test ...").

Task 5: EDIT test/tools/checkpoint.test.ts — add the config-disabled refusal describe block (2 tests)
  - PLACEMENT: append AFTER the existing "no-stable-entry refusal" describe block (which ends before the
    "never throws" describe), so the disabled tests sit with the other refusal-path coverage.
  - INSERT (verbatim — mirrors cancel.test.ts:401-413 idiom):
      "
       // ── config-disabled refusal (spec/08 E14, BUG-007) ─────────────────────────

       describe(\"mulligan_checkpoint — config-disabled refusal (spec/08 E14, BUG-007)\", () => {
         beforeEach(() => setConfig({ enabled: false }));
         afterEach(() => setConfig(undefined)); // reset to DEFAULT_CONFIG so the master-disabled state doesn't bleed

         it(\"refuses with 'Mulligan: refused — Mulligan is disabled.' and does NOT call setLabel\", async () => {
           const { labels, pi } = makePi();
           const { ctx } = makeCtx({ branch: branchEndingInMsg(\"L\") });
           const res = await run(pi, ctx, \"before-refactor\");
           // setCheckpoint is NOT called when disabled → setLabel is untouched (no label written).
           expect(labels).toHaveLength(0);
           expect(res.content).toHaveLength(1);
           expect(res.content[0].type).toBe(\"text\");
           // Byte-identical to the other four tools' disabled text (cancel.test.ts:412 pins the same string).
           expect(firstText(res)).toBe(\"Mulligan: refused — Mulligan is disabled.\");
           // details carries the (attempted) name for correlation; NO entryId (refusal path).
           expect(res.details).toEqual({ name: \"before-refactor\" });
           expect(res.details).not.toHaveProperty(\"entryId\");
         });

         it(\"disabled refusal fires BEFORE name validation (an invalid name still gets the disabled refusal)\", async () => {
           // Mirrors rewind.test.ts:326 + shrink.test.ts:213: the config gate is step 0, before name validation,
           // so even a name that would normally be an invalid-name refusal gets the disabled refusal instead.
           const { labels, pi } = makePi();
           const { ctx } = makeCtx({ branch: branchEndingInMsg(\"L\") });
           const res = await run(pi, ctx, \"BAD NAME!\"); // would be invalid-name if enabled
           expect(labels).toHaveLength(0);
           expect(firstText(res)).toBe(\"Mulligan: refused — Mulligan is disabled.\");
           expect(res.details).toEqual({ name: \"BAD NAME!\" });
         });
       });
      "
  - RATIONALE: test 1 pins the happy-path disabled behavior (text + no label + details). test 2 pins the
    gate-before-validation ordering (the contract's "top of the try block" requirement) using a name that would
    otherwise fail validCheckpointName. Both use the existing makePi/makeCtx/run/firstText/branchEndingInMsg
    helpers (no new fakes).
  - GOTCHA: the per-describe beforeEach runs AFTER the global beforeEach, so the net config for these tests is
    enabled:false (global sets default:true, describe overrides to false). afterEach resets to default.
  - DO NOT: assert the dotless text — pin the DOTTED "Mulligan: refused — Mulligan is disabled." for byte-parity
    with the other four tools. Do NOT add a setConfig call inside the global hooks that contradicts Task 4.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (the disabled-refusal result — INLINED for byte-parity, NOT via refusal()):
//   if (!getConfig().enabled) {
//     return {
//       content: [{ type: "text", text: "Mulligan: refused — Mulligan is disabled." }],
//       details: { name },
//     };
//   }
// Why inlined: checkpoint's refusal() helper (checkpoint.ts:84-89) does `Mulligan: refused — ${reason}` with NO
// trailing ".", but the other four tools' helpers append "." → their emitted text is "...disabled." (dotted).
// cancel.test.ts:412 pins the dotted string. Inlining the exact dotted text here gives byte-identical parity
// with zero blast radius on checkpoint's other refusal callers.

// PATTERN (gate placement — step 0, first stmt inside try, before name validation):
//   const name = params?.name;
//   try {
//     if (!getConfig().enabled) { return { ... disabled ... }; }   // ← (0) BEFORE (1) name validation
//     if (!validCheckpointName(name)) { return refusal(...); }     // ← (1)
//   All four sibling tools do config-gate-first (cancel.ts:350, shrink.ts:286, rewind.ts:511, audit.ts:584).

// PATTERN (test idiom — per-describe setConfig, matches cancel.test.ts:401-413):
//   describe("... config-disabled refusal ...", () => {
//     beforeEach(() => setConfig({ enabled: false }));
//     afterEach(() => setConfig(undefined));
//     it("...", async () => { ...; expect(firstText(res)).toBe("Mulligan: refused — Mulligan is disabled."); });
//   });

// CRITICAL (the exact disabled text — copy VERBATIM, including the em dash and trailing period):
//   "Mulligan: refused — Mulligan is disabled."
//   ^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^
//   prefix (shared)      reason + helper "." (the other four tools emit this exact string)
// Note the em dash (—), NOT a hyphen. Copy the string verbatim; do not re-type the dash.

// CRITICAL (the import — .js extension):
//   import { getConfig } from "../config.js";   // NOT "../config" (ESM/Bundler resolution)
```

### Integration Points

```yaml
NO INTEGRATION POINTS — single-tool gate addition.
  - DATABASE: none
  - CONFIG: none (reads getConfig().enabled; does NOT add any config field — spec/09 has no checkpoint section)
  - ROUTES: none
  - CODE: only checkpointExecute's try-block head (step 0) + the import + the header comment; steps 1/2/3a/3b
          and the catch block are UNCHANGED.
  - WIRING: NONE — src/index.ts already registers makeCheckpointTool(pi); the gate is inside execute, so no
            registration change (P1.M7.T1.S1 is unaffected).
  - PARALLEL-SIBLING COORDINATION: P1.M2.T3.S1 edits cancel.ts + cancel.test.ts (different files, zero overlap).
    The full-suite gate validates both changesets together.
```

---

## Validation Loop

This is a small code addition + targeted test. Validation = tsc, the checkpoint test suite, a grep proving the
gate + exact text are present, and the full suite (validates the parallel cancel.ts sibling too).

### Level 1: Type check

```bash
npx tsc --noEmit
```
Expected: exit 0. The gate returns a structurally-identical `AgentToolResult<CheckpointDetails>`; `getConfig()` is
already typed in config.ts; `name` is `string` (CheckpointArgs). No signature changes.

### Level 2: the checkpoint test suite (the core BUG-007 checks)

```bash
npx vitest run test/tools/checkpoint.test.ts
```
Expected: **all pass** — including the 2 NEW config-disabled tests. If a NEW test fails on the text assertion,
the gate's emitted text does not byte-match `"Mulligan: refused — Mulligan is disabled."` (re-check Task 2's
inline string — em dash + trailing period). If a NEW test fails on `labels.toHaveLength(0)`, the gate is placed
AFTER the setCheckpoint call (re-check Task 2's placement — it must be the first stmt inside try).

### Level 3: grep verification (gate present; exact text; header updated)

```bash
# (a) checkpoint.ts imports getConfig AND has the gate:
echo "--- checkpoint.ts: getConfig import + gate ---"
grep -n 'import { getConfig } from "../config.js"' src/tools/checkpoint.ts   # expect 1
grep -n 'if (!getConfig().enabled)' src/tools/checkpoint.ts                    # expect 1

# (b) the EXACT disabled text is present (byte-parity with the other four tools — em dash + trailing period):
echo "--- checkpoint.ts: exact disabled text (expect 1) ---"
grep -c 'Mulligan: refused — Mulligan is disabled\.' src/tools/checkpoint.ts   # expect 1 (the inline text)

# (c) the OLD "NO config gate here" header is GONE:
echo "--- checkpoint.ts: old header gone (expect 0) ---"
grep -c 'NO config gate here' src/tools/checkpoint.ts                          # expect 0

# (d) checkpoint.test.ts has the setConfig import + the disabled describe:
echo "--- checkpoint.test.ts: setConfig import + disabled describe ---"
grep -n 'import { setConfig }' test/tools/checkpoint.test.ts                  # expect 1
grep -n 'config-disabled refusal' test/tools/checkpoint.test.ts               # expect 1 (describe) + 1 (comment) = 2
grep -c 'Mulligan: refused — Mulligan is disabled\.' test/tools/checkpoint.test.ts  # expect 2 (the 2 assertions)
```
Expected: import present; gate present; the exact dotted disabled text present (1× in src, 2× in test); the old
"NO config gate here" header is gone.

### Level 4: Full-suite convergence (validates this + the parallel cancel.ts sibling together)

```bash
# Run the full suite to confirm BUG-007 + BUG-006 (sibling cancel.ts) are green together.
npx vitest run
```
Expected: all tests pass (0 failures). BUG-007 touches checkpoint.ts/checkpoint.test.ts; BUG-006 touches
cancel.ts/cancel.test.ts — zero overlap, both must be green.

---

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npx tsc --noEmit` → exit 0.
- [ ] Level 2: `npx vitest run test/tools/checkpoint.test.ts` → all pass (incl. the 2 new disabled tests).
- [ ] Level 3(a): checkpoint.ts imports `getConfig` from `"../config.js"` (`.js` extension) + has the gate.
- [ ] Level 3(b): checkpoint.ts contains the exact `Mulligan: refused — Mulligan is disabled.` text (1×).
- [ ] Level 3(c): the old `NO config gate here` header comment is gone.
- [ ] Level 3(d): checkpoint.test.ts has the setConfig import + the config-disabled describe (2 assertions).
- [ ] Level 4: `npx vitest run` → full suite green.

### Feature Validation
- [ ] `mulligan_checkpoint({name})` with `enabled:false` returns the disabled-refusal result and does NOT call
      `setCheckpoint` (no label written).
- [ ] The disabled-refusal text is byte-identical to the other four tools (`"Mulligan: refused — Mulligan is disabled."`).
- [ ] The gate fires BEFORE name validation (invalid name + disabled → disabled refusal).
- [ ] `details` is `{ name }` on the disabled path (no `entryId`).

### Code Quality / Scope Discipline
- [ ] The disabled case is INLINED (not routed through checkpoint's dotless refusal() helper) for byte-parity.
- [ ] The import uses the `.js` ESM extension (`"../config.js"`).
- [ ] Did NOT change steps 1/2/3a/3b, the catch block, the refusal() helper, or any other refusal caller.
- [ ] Did NOT add a `config.checkpoint` sub-knob (master switch only, like cancel).
- [ ] Did NOT touch `src/tools/cancel.ts` / `test/tools/cancel.test.ts` (sibling P1.M2.T3.S1).
- [ ] Did NOT touch `spec/*`, README.md, VERIFICATION.md, src/index.ts, markers.ts, config.ts, or other tools.
- [ ] Em dash (—) + trailing period (.) preserved verbatim in the disabled text (not re-typed as ASCII).

### Documentation
- [ ] The file-header comment now documents the gate's presence, placement, byte-parity rationale, and the
      no-sub-knob decision (no stale "NO config gate here" claim).
- [ ] The new test block's comments explain the gate-before-validation ordering + the byte-parity pin.
- [ ] No README/spec edit needed (E14 is the source of truth and is already correct; tool result text is runtime
      agent-facing, not a documented config/API surface).

---

## Anti-Patterns to Avoid

- ❌ Don't route the disabled case through checkpoint's `refusal()` helper — it is dotless (the only one of the
  five tools that omits the trailing "."), so it would emit `"Mulligan: refused — Mulligan is disabled"` (no dot)
  and break byte-parity with the other four tools (whose tests pin the dotted string). INLINE the exact text.
- ❌ Don't "fix" checkpoint's refusal() helper to add the dot in this task — it would change the text of the
  invalid-name / no-stable-entry / unexpected-error refusals (whose reasons inconsistently include/exclude dots,
  risking double-periods) and balloon a 0.5-point task. That's a separate optional cleanup, out of scope here.
- ❌ Don't place the gate AFTER name validation — it must be step 0 (first stmt inside the try), so an invalid
  name + disabled yields the DISABLED refusal, not the invalid-name refusal (all four sibling tools do this).
- ❌ Don't forget the `.js` import extension (`"../config.js"`, not `"../config"`) — ESM/Bundler resolution.
- ❌ Don't rely on `clearAll()` to reset config in the tests — it resets ONLY runtime maps. Add `setConfig(undefined)`
  to the global beforeEach/afterEach so a disabled test cannot bleed.
- ❌ Don't add a `config.checkpoint` sub-knob — spec/09 has no checkpoint section; the master switch is the only
  gate (mirrors cancel).
- ❌ Don't touch `cancel.ts`/`cancel.test.ts` (sibling P1.M2.T3.S1) or `spec/*`/README/VERIFICATION (out of scope).
- ❌ Don't re-type the em dash as a hyphen or drop the trailing period — copy the disabled text verbatim.
- ❌ Don't assert the dotless text in the new tests — pin the DOTTED `"Mulligan: refused — Mulligan is disabled."`
  for byte-parity with cancel.test.ts:412.

---

## Confidence Score

**9/10** for one-pass implementation success. The code change is a single inline block with verbatim
FIND/REPLACE (import + gate + header comment), the exact byte-parity disabled text is quoted verbatim (em dash +
trailing period), the gate placement is pinned (step 0, first stmt inside try, before name validation), and the
sibling-gate pattern is verified across all four tools (with cancel.test.ts:412 as the test pin). The one
non-trivial decision — inlining the disabled result instead of reusing checkpoint's dotless `refusal()` helper —
is documented with full rationale (dot-parity with the other four tools, zero blast radius) so the implementer
does not "helpfully" route it through the helper and silently break parity. The test additions are specified
verbatim (import + global setConfig reset + a 2-test describe mirroring cancel.test.ts:401-413). Residual risk:
the implementer must copy the em dash + trailing period verbatim (mitigated by a grep gate asserting the exact
string); and the per-describe/global setConfig nesting must net to enabled:false for the disabled tests
(mitigated by following the cancel.test.ts idiom exactly). Not 10/10 only because the dot-parity decision,
though well-documented, is a judgment call an implementer could second-guess — the Anti-Patterns section guards
against the two most likely mis-implementations.