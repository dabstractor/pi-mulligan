# PRP — P1.M1.T2.S1: Wire `loadMulliganConfig` into the index.ts factory body (BUG-001, factory half)

---

## Goal

**Feature Goal**: Replace the hardcoded `setConfig(undefined)` at `src/index.ts:30` (the root cause of BUG-001 — the `enabled:false` switch and all 17 config knobs do nothing, and `setLogFile` is always `null` so logging is dead) with `setConfig(loadMulliganConfig(process.cwd()))`, so the factory actually loads merged Pi settings (global `~/.pi/agent/settings.json` + project-local `<cwd>/.pi/settings.json`) at bootstrap. Add the import, update the inline comment and the factory JSDoc to reflect the new reality. **Factory body ONLY** — the `session_start` re-read is a separate subtask (P1.M1.T2.S2).

**Deliverable**:
1. `src/index.ts` (MODIFY) — add `import { loadMulliganConfig } from "./settings.js";`, change line 30 from `setConfig(undefined);` → `setConfig(loadMulliganConfig(process.cwd()));`, update the inline comment (lines 28–29), and update the factory JSDoc (lines 14–27). Line 33 (`setLogFile(getConfig().log.file)`) is **unchanged** — it lights up for free once config is real.
2. `test/index.test.ts` (MODIFY) — add `vi.mock("../src/settings.js", …)` so the factory test is deterministic (no real `~/.pi`/repo `.pi` file dependency), add a `describe("index.ts config loading (factory)")` block proving the wiring end-to-end (`loadMulliganConfig(process.cwd())` is called and its return flows through to `getConfig()`).

**Success Definition**:
- `npx vitest run test/index.test.ts` — all pass: the existing 8 tests STILL pass (mocked `loadMulliganConfig` returns `undefined` by default → `DEFAULT_CONFIG`, identical to today's `setConfig(undefined)`), AND the new config-loading tests pass.
- `npx vitest run` — full suite passes (no regressions; `test/settings.test.ts` from T1.S2 unaffected — `vi.mock` is file-scoped).
- `npx tsc --noEmit` — NO new errors from `src/index.ts` or `test/index.test.ts`. (The single pre-existing error at `test/drift_nudge.test.ts:239` is BUG-002, owned by P1.M2.T1.S1 — NOT this task. See GOTCHA #5.)

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers + the downstream P1.M1.T2.S2 implementer (who wires the `session_start` re-read). End-user-visible effect (`enabled:false` finally disabling Mulligan) requires BOTH T2.S1 and T2.S2, but T2.S1 is the factory half that fixes the common single-session path.

**Use Case**: At extension load (factory time), Mulligan reads the user's merged `settings.json`, validates it into a `MulliganConfig`, caches it, and points the logger at the configured `log.file`. Missing/invalid settings fail-open to `DEFAULT_CONFIG`.

**User Journey**: Pi loads the extension → `indexFactory(pi)` runs → `loadMulliganConfig(process.cwd())` reads+merges global+project settings → returns raw `mulligan` block → `setConfig(raw)` → `validateConfig` coerces it → `getConfig()` serves the validated config to all handlers/tools; `setLogFile(getConfig().log.file)` enables logging if configured.

**Pain Points Addressed**: The `enabled:false` master switch and every config knob stop being inert. The dead `setLogFile` path starts working.

## Why

- **Business value / user impact**: This is the factory half of the BUG-001 repair (the most-reported gap — a documented disable switch that silently does nothing). `loadMulliganConfig` (built in P1.M1.T1.S2) is useless until something calls it; this task is that call site.
- **Integration with existing features**: Builds directly on `loadMulliganConfig` (src/settings.ts, Pi-bound read+merge) and the existing `setConfig`/`getConfig` (src/config.ts, Pi-free validation+cache). `config.ts`'s Pi-free invariant is preserved — `settings.ts` does all Pi coupling. `setLogFile` (src/log.ts:48) lights up for free with no change.
- **Problems this solves and for whom**: For users — the disable switch + logging + all 17 knobs become functional. For the T2.S2 implementer — the factory path is done; they only add the `session_start` re-read. For maintainers — the index.ts comment/JSDoc stop lying about "v1: no Pi settings accessor … reading real settings.mulligan is v1.1".
- **Scope boundary (CRITICAL)**: T2.S1 = factory body ONLY. T2.S2 (separate, planned) = the `session_start` re-read (`setConfig(loadMulliganConfig(ctx.cwd))` + `setLogFile(getConfig().log.file)`). This PRP references session_start in a comment but does NOT modify its handler. See `architecture/system_context.md §1.4` lifecycle-asymmetry table (factory: no `ctx` → `process.cwd()`; session_start: `ctx.cwd`).

## What

Two surgical edits to `src/index.ts` (import + the `setConfig` line) plus two comment/JSDoc updates, and one mocking addition + one new `describe` block in `test/index.test.ts`. No user-visible behavior change in isolation beyond config finally loading (which is the fix). No changes to `config.ts`, `settings.ts`, handlers, or tools.

### Success Criteria

- [ ] `src/index.ts` imports `loadMulliganConfig` from `"./settings.js"`.
- [ ] Line 30 reads `setConfig(loadMulliganConfig(process.cwd()));` (NOT `setConfig(undefined);`).
- [ ] Line 33 (`setLogFile(getConfig().log.file);`) is unchanged.
- [ ] The inline comment (lines 28–29) and factory JSDoc (lines 14–27) no longer claim "v1/v1.1 no settings accessor" / "setConfig(undefined)"; they describe the real `loadMulliganConfig` flow and its fail-open semantics.
- [ ] The `session_start` handler is UNCHANGED (T2.S2 owns it — only referenced in a comment).
- [ ] `test/index.test.ts` mocks `../src/settings.js` and asserts `loadMulliganConfig` is called with `process.cwd()` and that its return flows to `getConfig()`.
- [ ] `npx vitest run test/index.test.ts` passes; `npx vitest run` passes; `npx tsc --noEmit` shows no NEW errors from `src/index.ts` / `test/index.test.ts`.

---

## All Needed Context

### Context Completeness Check

> "If someone knew nothing about this codebase, would they have everything needed to implement this successfully?" — **YES.** This PRP contains the verbatim current lines of `src/index.ts`, the exact replacement text for the import / `setConfig` line / comment / JSDoc, the verbatim `vi.mock` pattern + assertions for the test, and the verified lifecycle-asymmetry rationale. The implementer needs only to open `src/index.ts` and `test/index.test.ts`.

### Documentation & References

```yaml
# MUST READ — the function being wired (confirmed implemented & matching the T1.S2 contract)
- file: src/settings.ts
  why: "Provides loadMulliganConfig(cwd?: string): unknown — the module's ONLY public export. Reads global join(getAgentDir(),'settings.json') + project-local join(cwd ?? process.cwd(),'.pi','settings.json'), deep-merges (project wins), returns raw `.mulligan` (unknown | undefined). Entire body is ONE try/catch → returns undefined on ANY error (fail-open). Returns RAW unknown — validation is config.ts's job, NOT ours."
  pattern: "export function loadMulliganConfig(cwd?: string): unknown { try { …; return merged.mulligan; } catch { return undefined; } }"
  gotcha: "Do NOT modify settings.ts (T1.S2 owns it). Do NOT validate/coerce its return here — setConfig does that. Do NOT pass it a ctx — the factory has none; pass process.cwd()."

# MUST READ — the file being modified (the consumer/wiring site)
- file: src/index.ts
  why: "THE bug site. Line 2 (config import) — add the settings import after it. Line 30 (setConfig(undefined)) — the fix. Line 33 (setLogFile) — unchanged. Lines 28–29 (comment) + 14–27 (JSDoc) — update to stop claiming 'no settings accessor'. The session_start handler (~lines 47–49) MUST stay untouched (T2.S2)."
  critical: "Line 30 is the ONLY setConfig call site in all of src/ (system_context §1.3). The factory signature (pi: ExtensionAPI) has NO ctx — hence process.cwd(). session_start is where ctx.cwd becomes available, and that re-read is T2.S2."

# MUST READ — the Pi-free validation/cache this wiring hands off to
- file: src/config.ts
  why: "setConfig(raw: unknown) (line 195) → try { cachedConfig = validateConfig(raw); } catch { cachedConfig = validateConfig(undefined); } — NEVER throws; bad raw → DEFAULT_CONFIG. getConfig() (line 180) → structuredClone(cachedConfig). So setConfig(loadMulliganConfig(process.cwd())) is DOUBLY fail-open: loadMulliganConfig never throws AND setConfig never throws."
  pattern: "The handoff is loadMulliganConfig → setConfig(raw) → validateConfig. setConfig is the ONLY place index.ts should touch config.ts; do NOT call validateConfig directly."

# MUST READ — the log destination that lights up for free (NO change needed)
- file: src/log.ts
  why: "setLogFile(path: string | null): void (line 48). index.ts:33 already calls setLogFile(getConfig().log.file). Today that's always null (config is DEFAULT_CONFIG, log off). After the fix, if the user set mulligan.log.file, it becomes non-null and logging activates — with NO change to log.ts or line 33."
  gotcha: "Do NOT touch log.ts or line 33. It already does the right thing once config is real."

# MUST READ — the authoritative lifecycle rationale
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/system_context.md
  why: "§1.4 Lifecycle Asymmetry table + §1.7 'Logging Lights Up for Free'. Factory has NO ctx → process.cwd(); session_start HAS ctx.cwd. This is WHY the factory passes process.cwd() and WHY the session_start re-read (T2.S2) is a separate, better-informed call. §1.3 confirms line 30 is the ONLY setConfig site."
  critical: "§1.4 row 'Factory function(pi): NO ctx → process.cwd() only'. The comment you write MUST cite this asymmetry so the next reader understands why cwd isn't ctx.cwd at factory time."

# MUST READ — the root-cause write-up of the bug being fixed
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/architecture/config_flow_research.md
  why: "§2 'Config Initialization (src/index.ts)' labels line 30 '← THE BUG: always DEFAULT_CONFIG' and line 33 '← always null (log dead too)'. Quotes the exact current comment. Confirms the factory has no ctx and no settings accessor at load time."
  critical: "Confirms the MINIMAL fix is exactly: import + line-30 swap + comment/JSDoc honesty. Nothing else in the factory needs to change."

# MUST READ — the test file being modified
- file: test/index.test.ts
  why: "Existing factory tests with hand-rolled fakes (makePi/makeCtx). Module-level beforeEach(clearAll). NO existing config-loading test. I ADD vi.mock('../src/settings.js') + a describe('index.ts config loading (factory)') block. The hand-rolled-fake style for Pi objects is PRESERVED; vi.mock is used ONLY for the module dependency."
  pattern: "makePi() captures .on + .registerTool. indexFactory(pi) is what triggers the new loadMulliganConfig(process.cwd()) call. getConfig() (from ../src/config.js) is how to assert the return value flowed through."
  gotcha: "vi.mock is HOISTED above `let`/`const`. Keep the factory minimal: { loadMulliganConfig: vi.fn() } (settings.js exports nothing else index.ts needs). Import loadMulliganConfig AFTER the vi.mock line; the imported binding IS the mock. File-scoped → does not leak to test/settings.test.ts or others."

# CONTEXT — the contract that produced loadMulliganConfig (its behavior is the dependency)
- file: plan/004_d3d84055c5b2/bugfix/001_2c4ea3ff0337/P1M1T1S2/PRP.md
  why: "CONTRACT for loadMulliganConfig (signature, fail-open semantics, return type unknown | undefined). Confirms T1.S2 does NOT touch index.ts (no overlap) and that config.ts stays Pi-free."
  critical: "T2.S1 consumes loadMulliganConfig as a stable black box: pass process.cwd(), feed the unknown return to setConfig. Do NOT reimplement reading/merging/validation."
```

### Current Codebase tree (the relevant slice)

```bash
src/
  index.ts      # ← THIS PRP modifies (import + line 30 + comment + JSDoc)
  settings.ts   # loadMulliganConfig (T1.S2, READ-ONLY here) — the function being wired
  config.ts     # setConfig/getConfig (READ-ONLY; Pi-free; the validation handoff)
  log.ts        # setLogFile (READ-ONLY; lights up for free — no change)
test/
  index.test.ts # ← THIS PRP modifies (vi.mock + new describe block)
  settings.test.ts      # T1.S2's tests (READ-ONLY; vi.mock is file-scoped, no leak)
  drift_nudge.test.ts:239 # PRE-EXISTING tsc error (BUG-002, separate task — DO NOT TOUCH)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/index.ts      # MODIFY — + import loadMulliganConfig; line30 setConfig(loadMulliganConfig(process.cwd())); updated comment + JSDoc
test/index.test.ts # MODIFY — + vi.mock('../src/settings.js'); + import loadMulliganConfig + getConfig; + describe('index.ts config loading (factory)'); mockReset in beforeEach
# (NO new files. NO changes to settings.ts, config.ts, log.ts, handlers, tools, README, spec.)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (scope — FACTORY BODY ONLY; session_start is T2.S2).
//   src/index.ts has TWO seams that could call setConfig: the factory body (line 30) and the
//   session_start handler (~lines 47–49). T2.S1 owns the FACTORY ONLY. T2.S2 (a separate, planned
//   subtask) owns adding setConfig(loadMulliganConfig(ctx.cwd)) + setLogFile(getConfig().log.file)
//   to session_start. You MUST NOT edit the session_start handler body — only REFERENCE it in a comment
//   ("re-read with authoritative ctx.cwd on session_start — P1.M1.T2.S2"). Editing it now = scope creep
//   that collides with T2.S2's parallel plan.

// CRITICAL GOTCHA #2 (why process.cwd(), not ctx.cwd, in the factory).
//   The factory signature is (pi: ExtensionAPI): void — NO ctx exists at factory time (config_flow_research
//   §2; system_context §1.4). So the factory passes process.cwd() (best-effort: covers `pi` invoked in a
//   project dir). ctx.cwd only becomes available in session_start (T2.S2). loadMulliganConfig already
//   resolves `cwd ?? process.cwd()`, so passing process.cwd() explicitly is the honest, documented choice.

// CRITICAL GOTCHA #3 (DOUBLY fail-open — no try/catch needed in the factory).
//   loadMulliganConfig NEVER throws (one outer try/catch → undefined) AND setConfig NEVER throws (try/catch
//   → DEFAULT_CONFIG on error). So `setConfig(loadMulliganConfig(process.cwd()))` cannot throw. The factory
//   deliberately does NOT wrap bootstrap in try/catch (fail-FAST on WIRING errors — spec/01 §1); the
//   config-load step specifically is safe. Do NOT add a try/catch around this line.

// CRITICAL GOTCHA #4 (test determinism REQUIRES mocking settings.js — a real settings file is not reproducible).
//   In the test env, loadMulliganConfig reads REAL ~/.pi/agent/settings.json + <repo>/.pi/settings.json → the
//   return is machine-dependent and non-deterministic. To assert the WIRING (not the file contents), mock
//   the module: vi.mock("../src/settings.js", () => ({ loadMulliganConfig: vi.fn() })). Then control the
//   return and assert the call + the flow-through to getConfig(). This is the ONLY viable deterministic test.
//   The hand-rolled-fake style (makePi/makeCtx) for Pi objects is UNCHANGED — vi.mock is used ONLY for the
//   module dependency. vi.mock is file-scoped → does NOT leak to test/settings.test.ts or any other file.

// CRITICAL GOTCHA #5 (the pre-existing tsc error is NOT yours).
//   `npx tsc --noEmit` currently reports EXACTLY ONE error: test/drift_nudge.test.ts:239
//   (TS2352: missing rewindRefusedTurnIndex). That is BUG-002, owned by P1.M2.T1.S1. It is PRE-EXISTING.
//   T2.S1's tsc bar = "no NEW errors from src/index.ts or test/index.test.ts". Do NOT fix drift_nudge here.

// CRITICAL GOTCHA #6 (config cache is module-scoped — reset per test by calling indexFactory).
//   config.ts's cachedConfig is module-scoped. Each test that calls indexFactory(pi) overwrites it via
//   setConfig, so there is no cross-test leak AS LONG AS a test asserts config AFTER calling indexFactory.
//   The new config tests do exactly that. (You could optionally import+call a config reset, but it is
//   unnecessary — indexFactory re-runs setConfig every time.)

// CRITICAL GOTCHA #7 (ESM import path convention).
//   Use the `.js` extension in the relative import: `import { loadMulliganConfig } from "./settings.js";`
//   (matches every other local import in index.ts: ./config.js, ./log.js, ./runtime.js, …). The vi.mock
//   path in the test is relative to the TEST file: `vi.mock("../src/settings.js", …)`.

// CRITICAL GOTCHA #8 (vi.mock hoisting — factory cannot close over module `let`).
//   vi.mock is hoisted above `let`/`const`, so the factory MUST be self-contained:
//   `() => ({ loadMulliganConfig: vi.fn() })`. Do NOT reference outer state in it. The mock's default
//   return is `undefined` (vi.fn()), which is EXACTLY the fail-open → DEFAULT_CONFIG path — so existing
//   tests that call indexFactory see identical behavior to today's setConfig(undefined).
```

---

## Implementation Blueprint

### Data models and structure

**No new types.** This task wires an existing function (`loadMulliganConfig(cwd?: string): unknown`) into an existing call site (`setConfig(raw: unknown)`). `process.cwd()` returns `string`. The data flow is `string → unknown → MulliganConfig(cache)`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/index.ts — add the import
  - FIND (verbatim, line 2): `import { setConfig, getConfig } from "./config.js";`
  - ADD immediately AFTER it (keeps the config-group together; settings feeds config):
      import { loadMulliganConfig } from "./settings.js";
  - NAMING/PLACEMENT: local relative import with the `.js` extension, grouped with the other `./X.js`
    imports (config is the natural neighbor since settings→config is the handoff). (GOTCHA #7.)
  - GOTCHA: do NOT import anything else from settings.js (readSettingsFile/deepMergeSettings are
    @internal — only loadMulliganConfig is the public export).
  - DEPENDENCIES: src/settings.ts must export loadMulliganConfig (it does — T1.S2 complete).

Task 2: MODIFY src/index.ts — the core fix (line 30)
  - FIND (verbatim, line 30): `  setConfig(undefined);`
  - REPLACE WITH: `  setConfig(loadMulliganConfig(process.cwd()));`
  - RATIONALE: loadMulliganConfig(process.cwd()) reads+merges global+project settings and returns the
    raw `mulligan` block (or undefined on absence/error); setConfig validates+ caches it (or DEFAULT_CONFIG
    on any failure). Doubly fail-open (GOTCHA #3) — no try/catch needed. process.cwd() because the factory
    has NO ctx (GOTCHA #2; system_context §1.4).
  - GOTCHA: do NOT wrap in try/catch (fail-FAST on wiring errors is the factory's contract; config-load is
    the documented fail-open exception). do NOT pass a ctx (none exists). do NOT call validateConfig directly.
  - DEPENDENCIES: Task 1 (import).

Task 3: MODIFY src/index.ts — update the inline comment (lines 28–29)
  - FIND (verbatim, the two comment lines above line 30):
      `  // 1. Load + cache config at factory time (v1: validated defaults — no Pi settings accessor in v1;`
      `  //    setConfig(undefined) → DEFAULT_CONFIG; reading real settings.mulligan is v1.1). Never throws.`
  - REPLACE WITH:
      `  // 1. Load + cache config at factory time. loadMulliganConfig reads + deep-merges the GLOBAL`
      `  //    (~/.pi/agent/settings.json, via getAgentDir) and PROJECT-LOCAL (<cwd>/.pi/settings.json)`
      `  //    Pi settings and returns the raw `mulligan` block; setConfig validates + caches it (→`
      `  //    validateConfig). cwd is process.cwd() here because the factory has NO ctx (lifecycle asymmetry,`
      `  //    D4); the session_start handler below re-reads with the authoritative ctx.cwd (P1.M1.T2.S2).`
      `  //    Never throws: loadMulliganConfig is fail-open (→ undefined) and setConfig is fail-open (→`
      `  //    DEFAULT_CONFIG), so an absent/corrupt settings file always boots to validated defaults.`
  - RATIONALE: the old comment literally admitted the bug ("no Pi settings accessor in v1 … v1.1"). The new
    comment documents the real flow, the cwd choice, the session_start re-read (cross-ref T2.S2), and the
    doubly-fail-open guarantee. (GOTCHA #1, #2, #3.)
  - GOTCHA: the comment references session_start/T2.S2 but you do NOT edit that handler.
  - DEPENDENCIES: Task 2.

Task 4: MODIFY src/index.ts — update the factory JSDoc (lines 14–27)
  - FIND the JSDoc line (line 18) that reads:
      ` * full cleanup). Zero-config: setConfig(undefined) → validated DEFAULT_CONFIG (enabled:true, log off).`
  - REPLACE WITH:
      ` * full cleanup). Config loads from merged Pi settings (global ~/.pi/agent + project-local <cwd>/.pi)`
      ` * via loadMulliganConfig → setConfig; absent/invalid settings fail-open to validated DEFAULT_CONFIG`
      ` * (enabled:true, log off).`
  - ALSO FIND the next JSDoc paragraph (lines ~21–23) that reads:
      ` * SYNC (no async work; spec/01 §1 allows async but it is unnecessary). Does NOT start long-lived`
      ` * resources (spec/01 §1; Mulligan has none). Does NOT wrap in try/catch — fail-FAST on wiring errors at`
      ` * bootstrap; the individual handlers (contextHandler/bloatReminderHandler/turnEndMetricHandler) already`
      ` * self-protect for fail-open (spec/03 #4).`
  - REPLACE its tail with an added clause noting config-load is fail-open:
      ` * SYNC (no async work; spec/01 §1 allows async but it is unnecessary). Does NOT start long-lived`
      ` * resources (spec/01 §1; Mulligan has none). Does NOT wrap in try/catch — fail-FAST on wiring errors at`
      ` * bootstrap; the individual handlers (contextHandler/bloatReminderHandler/turnEndMetricHandler) already`
      ` * self-protect for fail-open (spec/03 #4), and config loading is fail-open inside loadMulliganConfig +`
      ` * setConfig (absent/invalid settings → DEFAULT_CONFIG, never a throw).`
  - RATIONALE: stop the JSDoc from asserting the falsehood "setConfig(undefined)". Mirror the code.
  - GOTCHA: do NOT touch the @param line or the section header lines (## 1./spec refs). Keep it surgical.
  - DEPENDENCIES: Task 3 (or concurrent — non-overlapping text).

Task 5: MODIFY test/index.test.ts — add the settings mock + imports
  - ENSURE `vi` is in the vitest import: `import { describe, it, expect, beforeEach, vi } from "vitest";`
    (the current import is `import { describe, it, expect, beforeEach } from "vitest";` — ADD `vi`).
  - ADD after the existing imports (and BEFORE the first `describe`), the hoisted module mock:
      // Deterministic factory test: mock settings.js so loadMulliganConfig's return is controllable
      // (a real ~/.pi or repo .pi settings.json would make this machine-dependent). vi.mock is file-scoped
      // → does not leak to test/settings.test.ts or others. The hand-rolled Pi fakes (makePi/makeCtx) stay.
      vi.mock("../src/settings.js", () => ({ loadMulliganConfig: vi.fn() }));
  - ADD to the test imports:
      import { loadMulliganConfig } from "../src/settings.js";   // the mocked binding (assert/program it)
      import { getConfig } from "../src/config.js";              // to assert the return flowed to the cache
    (Place these imports AFTER the vi.mock line per vitest convention — vitest hoists vi.mock regardless,
    but this ordering reads cleanly and matches vitest docs.)
  - GOTCHA: the factory returns ONLY { loadMulliganConfig: vi.fn() } (settings.js exports nothing else
    index.ts needs). Do NOT importOriginal/spread — unnecessary. (GOTCHA #4, #8.)
  - DEPENDENCIES: none (test file is independent of Tasks 1–4 at authoring time; it validates them).

Task 6: MODIFY test/index.test.ts — reset the mock each test
  - FIND the module-level beforeEach: `beforeEach(() => { clearAll(); });`
  - REPLACE WITH:
      beforeEach(() => {
        clearAll();
        vi.mocked(loadMulliganConfig).mockReset(); // default vi.fn() → returns undefined → DEFAULT_CONFIG
      });
  - RATIONALE: every test starts with a clean, undefined-returning mock. Existing tests that call
    indexFactory then see setConfig(undefined) → DEFAULT_CONFIG — IDENTICAL to today's behavior. New tests
    override the return per-test. (GOTCHA #6, #8.)
  - GOTCHA: mockReset (not mockClear) so a prior test's mockReturnValue is cleared too.
  - DEPENDENCIES: Task 5 (loadMulliganConfig must be imported as the mock).

Task 7: MODIFY test/index.test.ts — the new config-loading describe block
  - ADD (after the existing `describe("index.ts extension factory", …)` block closes):
      describe("index.ts config loading (factory)", () => {
        it("calls loadMulliganConfig(process.cwd()) and feeds its return to setConfig", () => {
          vi.mocked(loadMulliganConfig).mockReturnValue({ enabled: false });
          const { pi } = makePi();
          indexFactory(pi);
          expect(loadMulliganConfig).toHaveBeenCalledTimes(1);
          expect(loadMulliganConfig).toHaveBeenCalledWith(process.cwd());
          // the mock's return value flowed through to the config cache (proves the wiring end-to-end):
          expect(getConfig().enabled).toBe(false);
        });

        it("is fail-open to DEFAULT_CONFIG when loadMulliganConfig returns undefined", () => {
          vi.mocked(loadMulliganConfig).mockReturnValue(undefined); // absent/invalid/no-mulligan-key
          const { pi } = makePi();
          indexFactory(pi);
          expect(loadMulliganConfig).toHaveBeenCalledTimes(1);
          expect(getConfig().enabled).toBe(true); // DEFAULT_CONFIG.enabled === true
        });

        it("never calls loadMulliganConfig from the session_start handler (that re-read is T2.S2)", () => {
          const { handlers, pi } = makePi();
          indexFactory(pi);
          const callsBefore = vi.mocked(loadMulliganConfig).mock.calls.length;
          handlers["session_start"]!(makeStartEvent("new"), makeCtx("s1"));
          expect(vi.mocked(loadMulliganConfig).mock.calls.length).toBe(callsBefore); // unchanged
        });
      });
  - RATIONALE:
    - Test 1 proves the WIRING: the factory calls loadMulliganConfig exactly once with process.cwd(), and the
      return flows loadMulliganConfig → setConfig → validateConfig → getConfig (enabled:false round-trips).
    - Test 2 proves the FAIL-OPEN: undefined return → DEFAULT_CONFIG (enabled:true), matching today's behavior
      and the contract.
    - Test 3 is a SCOPE GUARD: it asserts the session_start handler does NOT yet call loadMulliganConfig
      (that is T2.S2's job). This locks T2.S1's scope boundary and will fail loudly if a future edit leaks
      the re-read into the wrong subtask.
  - NAMING: titles phrase behavior → expectation.
  - GOTCHA: makePi/makeCtx/makeStartEvent are already defined in the file — reuse them. getConfig() returns a
    structuredClone (read-only) — safe to assert against. The mockReset in beforeEach guarantees each test's
    mockReturnValue is isolated. (GOTCHA #4, #6.)
  - DEPENDENCIES: Tasks 5–6.

Task 8: VALIDATE (no new code)
  - RUN `npx vitest run test/index.test.ts` → all pass (8 existing + 3 new).
  - RUN `npx vitest run` → full suite passes (no regressions; settings.test.ts etc. unaffected).
  - RUN `npx tsc --noEmit` → the ONLY error is pre-existing test/drift_nudge.test.ts:239 (BUG-002). Confirm
    NO error line references src/index.ts or test/index.test.ts. (GOTCHA #5.)
  - DEPENDENCIES: Tasks 1–7.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (Task 2): the one-line wiring fix. Doubly fail-open; no try/catch.
setConfig(loadMulliganConfig(process.cwd()));
//   process.cwd()  → string (factory has NO ctx — system_context §1.4)
//   loadMulliganConfig(string) → unknown (raw mulligan block) | undefined (absent/error) — NEVER throws
//   setConfig(unknown) → caches validateConfig(raw); on throw → validateConfig(undefined) → DEFAULT_CONFIG

// PATTERN (Tasks 5–7): deterministic factory test via module mock (real settings files are non-reproducible).
vi.mock("../src/settings.js", () => ({ loadMulliganConfig: vi.fn() })); // hoisted; file-scoped
import { loadMulliganConfig } from "../src/settings.js";               // this binding IS the mock
//   default vi.fn() → returns undefined → setConfig(undefined) → DEFAULT_CONFIG (matches today).
//   vi.mocked(loadMulliganConfig).mockReturnValue({ enabled: false }) → round-trips to getConfig().enabled===false.
//   expect(loadMulliganConfig).toHaveBeenCalledWith(process.cwd()) → proves cwd choice.

// ANTI-PATTERN to avoid: asserting on a REAL settings file. In CI/another machine ~/.pi or <repo>/.pi may
// exist or not → flaky. Always program the mock; never read the real filesystem from this test.
```

### Integration Points

```yaml
CODE:
  - modify: src/index.ts — + import loadMulliganConfig; line30 setConfig(loadMulliganConfig(process.cwd())); comment + JSDoc
  - untouched: src/settings.ts (T1.S2), src/config.ts (Pi-free validation/cache), src/log.ts (lights up free),
    src/filter.ts, src/nudges.ts, src/tools/*, src/runtime.ts, the session_start handler body (T2.S2)
TESTS:
  - modify: test/index.test.ts — + vi.mock('../src/settings.js') + import loadMulliganConfig/getConfig + mockReset + describe block (3 cases)
  - untouched: all other test files (drift_nudge.test.ts:239 = BUG-002, separate task — GOTCHA #5)
CONFIG / DATABASE / ROUTES / REGISTRATION:
  - none new. The factory still registers the same 5 tools + arms the same 5 handlers. The ONLY behavioral
    change is that config now reflects merged Pi settings instead of always DEFAULT_CONFIG (which is the fix).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# After modifying src/index.ts:
npx tsc --noEmit
# EXPECTED: exactly ONE error — `test/drift_nudge.test.ts(239,10): error TS2352 ... rewindRefusedTurnIndex`.
# That is BUG-002 (pre-existing, P1.M2.T1.S1) — NOT yours (GOTCHA #5).
# YOUR bar: NO line in the output references src/index.ts or test/index.test.ts.
# If you see an index.ts/index.test.ts error, common causes:
#   - typo in the import name/path (loadMulliganConfig, "./settings.js");
#   - missing `vi` in the vitest import destructure;
#   - calling vi.mocked(...) before loadMulliganConfig is imported.
# Do NOT "fix" the drift_nudge error here.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The factory test file in isolation — fast feedback on the 3 new cases + regression check on the 8 existing.
npx vitest run test/index.test.ts
# EXPECTED: all pass. If a new config test fails:
#   - "toHaveBeenCalledWith(process.cwd())" fails? → you left setConfig(undefined) or passed no arg — check line 30.
#   - getConfig().enabled !== false after mockReturnValue({enabled:false})? → line 30 isn't wiring the return
#     through setConfig, OR the mock isn't the one index.ts sees (check vi.mock path = "../src/settings.js").
#   - existing test newly fails? → the mockReset is missing (a prior test's mockReturnValue leaked). Add it to beforeEach.
# The 8 existing tests MUST still pass (mocked loadMulliganConfig returns undefined → DEFAULT_CONFIG = today's behavior).

# Full suite — confirm no regressions (vi.mock is file-scoped; settings.test.ts etc. unaffected).
npx vitest run
# EXPECTED: all pass.
```

### Level 3: Integration Testing (System Validation)

```bash
# The end-to-end "does enabled:false actually disable Mulligan" check spans BOTH T2.S1 (factory) and T2.S2
# (session_start). T2.S1 alone is verifiable like this against a TEMP agent dir (do NOT clobber real settings):
#
#   PI_CODING_AGENT_DIR="$(mktemp -d)" node --input-type=module -e '
#     import indexFactory from "./src/index.js";
#     // stand up a minimal fake pi … then inspect getConfig().enabled after a project settings.json write.
#   '
#
# NOTE: this is OPTIONAL — the unit tests in Level 2 already prove the wiring deterministically. The full
# user-facing "enabled:false disables the extension" verification is T2.S2's integration step (it needs the
# session_start re-read to cover the authoritative ctx.cwd). Do not block T2.S1 on it.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Manual sanity (optional): confirm the factory comment/JSDoc no longer contain the stale phrases.
grep -n "v1.1\|no Pi settings accessor\|setConfig(undefined)" src/index.ts
# EXPECTED: ZERO hits after the edit (those phrases are gone from both the comment and the JSDoc).

# Confirm the import + call are present and line 33 is unchanged:
grep -n 'loadMulliganConfig\|setConfig\|setLogFile(getConfig' src/index.ts
# EXPECTED: an import line, setConfig(loadMulliganConfig(process.cwd())), and setLogFile(getConfig().log.file).
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx vitest run test/index.test.ts` — all pass (8 existing + 3 new config tests).
- [ ] `npx vitest run` — full suite passes (no regressions).
- [ ] `npx tsc --noEmit` — NO new errors from `src/index.ts` / `test/index.test.ts` (the single pre-existing `drift_nudge.test.ts:239` error is BUG-002, out of scope).

### Feature Validation
- [ ] `src/index.ts` imports `loadMulliganConfig` from `"./settings.js"`.
- [ ] Line 30 is `setConfig(loadMulliganConfig(process.cwd()));`.
- [ ] Line 33 (`setLogFile(getConfig().log.file);`) is unchanged.
- [ ] The factory comment + JSDoc describe the real `loadMulliganConfig` flow and fail-open semantics (no "v1.1/no accessor/setConfig(undefined)" language remains — Level 4 grep confirms).
- [ ] The session_start handler body is UNCHANGED (the scope-guard test asserts loadMulliganConfig is NOT called from it).

### Code Quality Validation
- [ ] `src/index.ts` mirrors existing import grouping (local `./X.js` imports) and JSDoc style.
- [ ] The factory remains synchronous, returns void, registers the same 5 tools + arms the same 5 handlers.
- [ ] Only `src/index.ts` and `test/index.test.ts` are modified — NO changes to settings.ts, config.ts, log.ts, handlers, tools, drift_nudge.test.ts, README, or spec.

### Documentation & Deployment
- [ ] The inline comment (lines 28–29) cites the lifecycle asymmetry (factory no ctx → process.cwd(); session_start re-read = T2.S2) so the next reader understands the cwd choice.
- [ ] The factory JSDoc no longer claims `setConfig(undefined)`.
- [ ] No user-facing doc change in T2.S1 — the README/spec accuracy sweep is P1.M3.T1 (after T2.S2 lands the session_start re-read).

---

## Anti-Patterns to Avoid

- ❌ Don't touch the `session_start` handler — that re-read is T2.S2 (separate subtask). Only reference it in a comment. The scope-guard test enforces this.
- ❌ Don't pass `ctx.cwd` / a `ctx` to `loadMulliganConfig` in the factory — there is no ctx at factory time. Use `process.cwd()` (system_context §1.4).
- ❌ Don't wrap the `setConfig(loadMulliganConfig(...))` line in try/catch — it's doubly fail-open already; the factory's fail-FAST-on-wiring-errors contract intentionally leaves bootstrap unwrapped.
- ❌ Don't call `validateConfig` directly, or import `setLogFile` differently — the single seam is `setConfig`; line 33 is already correct.
- ❌ Don't read/parse settings files in `index.ts` — that's `settings.ts`'s job (T1.S2). index.ts only calls + hands off.
- ❌ Don't write a test that depends on a real `~/.pi/agent/settings.json` or `<repo>/.pi/settings.json` — non-deterministic. Always program the `vi.mock` return.
- ❌ Don't use `mockClear` where `mockReset` is needed — a prior test's `mockReturnValue` would leak. Use `mockReset` in the shared `beforeEach`.
- ❌ Don't "fix" `test/drift_nudge.test.ts:239` — that's BUG-002 (P1.M2.T1.S1). Your tsc bar is "no NEW errors from my files", not "tsc fully clean".
- ❌ Don't return a non-minimal `vi.mock` factory (`importOriginal`/spread) — `{ loadMulliganConfig: vi.fn() }` is sufficient and cleanest.
- ❌ Don't reference a module-scope `let` inside the `vi.mock` factory — it's hoisted above such declarations (use a self-contained factory; GOTCHA #8).

---

## Decision Log

- **D1 — Factory passes `process.cwd()`, not a deferred/ctx-based cwd.** The factory signature `(pi: ExtensionAPI): void` has no `ctx` (config_flow_research §2; system_context §1.4). `process.cwd()` is the best-effort project dir available at load time and covers the common `pi`-invoked-in-a-project-dir case. The authoritative `ctx.cwd` re-read belongs to `session_start` (T2.S2). Passing `process.cwd()` explicitly (rather than relying on `loadMulliganConfig`'s `cwd ?? process.cwd()` default) makes the cwd choice visible at the call site and honest in the comment.

- **D2 — No try/catch around the config-load line; preserve fail-FAST on wiring errors.** The factory deliberately does not wrap its body (spec/01 §1) so genuine wiring bugs (a missing tool factory, a bad handler registration) surface at bootstrap rather than silently degrading. The config-load step is the documented exception: it is *doubly* fail-open (`loadMulliganConfig` never throws; `setConfig` never throws), so it needs no wrapper. Adding one would imply the line can throw, contradicting the contract and muddying the fail-fast principle.

- **D3 — `vi.mock` (not `vi.spyOn` or an env var) for the factory test.** `loadMulliganConfig` reads real files (`~/.pi/agent/settings.json` + `<cwd>/.pi/settings.json`), so its return is machine-dependent and non-deterministic in the test env. To assert the *wiring* (call + flow-through) rather than file contents, the module must be controlled. `vi.mock("../src/settings.js", () => ({ loadMulliganConfig: vi.fn() }))` is the standard vitest mechanism; it is file-scoped (no leak to `test/settings.test.ts`), and the minimal factory `{ loadMulliganConfig }` is sufficient since index.ts imports nothing else from settings.js. The codebase's hand-rolled-fake style (makePi/makeCtx for Pi *objects*) is preserved — vi.mock is used only for the *module* dependency. (`vi.spyOn` on ESM namespace exports can be runtime-finicky; `vi.mock` is the robust, documented choice.)

- **D4 — Add a scope-guard test asserting `session_start` does NOT call `loadMulliganConfig`.** T2.S1 is deliberately factory-only; T2.S2 owns the session_start re-read. A test that fails if `loadMulliganConfig` is invoked from the session_start handler locks the subtask boundary and prevents a future edit (or a confused implementer) from dragging T2.S2's work into T2.S1.

---

## Confidence Score

**9/10** for one-pass implementation success. This is a one-line behavioral fix (`setConfig(undefined)` → `setConfig(loadMulliganConfig(process.cwd()))`) plus an import and honest comment/JSDoc, backed by: (a) the confirmed-implemented `loadMulliganConfig` (settings.ts already matches the T1.S2 contract), (b) the doubly-fail-open `setConfig` (config.ts:195), (c) a deterministic `vi.mock` test pattern with verbatim assertions, and (d) a scope-guard test locking the T2.S1/T2.S2 boundary. Residual risks: (1) the vi.mock path/placement (mitigated by GOTCHA #7/#8 + the exact snippet); (2) tsc noise from the pre-existing drift_nudge error (mitigated by GOTCHA #5 — the bar is "no NEW errors from my files", explicitly not "tsc clean").