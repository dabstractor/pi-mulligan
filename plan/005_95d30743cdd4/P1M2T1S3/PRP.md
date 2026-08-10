# PRP — P1.M2.T1.S3: Tests for shrink echo + config validation

## Goal

**Feature Goal**: Add a focused, passing test suite that locks in the two new operator-visible
behaviours of `mulligan_shrink` delivered by S1+S2: (1) the tool RESULT is now terse and never
echoes the replacement, and (2) the replacement is surfaced to the human via `ctx.ui.notify`
(zero-context-cost) at the right times and capped at `config.shrink.notifyMaxChars`. Plus dedicated
validation tests for the `shrink.notifyMaxChars` config knob.

**Deliverable**: New passing tests **added** to `test/tools/shrink.test.ts` (a new describe block:
terse-result + notify echo + cap) and `test/config.test.ts` (a new `shrink.notifyMaxChars` describe
block modelled on the existing `shrink.maxActive & shrink.staleAfterFires` block). No production
code is written by this item.

**Success Definition**: `npx vitest run test/tools/shrink.test.ts test/config.test.ts` is green and
`npm run typecheck` passes; the new tests fail-open the S1/S2 contracts (terse result excludes
replacement; notify fires iff `hasUI`; notify text capped; notifyMaxChars validated with warn-on-
invalid). All existing tests remain green (no regressions, no duplication of S2's 11 assertion fixes).

## Why

- S2 rewrites `shrinkExecute` to return a **terse** result and to echo the replacement to the human
  through `ctx.ui.notify` (the only user-facing channel that costs zero model tokens). That
  contract is subtle and easy to regress (echoing the replacement back into the result would
  re-bloat context — the exact failure the tool exists to prevent). S3 locks it with TDD tests.
- S1 adds the `shrink.notifyMaxChars` knob. The existing config tests already snapshot its default
  (`2048`) inside larger `toEqual` blocks, but there is **no dedicated validation block** proving
  pass-through + invalid-fallback-with-warn. S3 adds one, mirroring the established per-knob pattern.
- This is the verification backstop for the M2 milestone headline change (operator-visible payloads).

## What

User-visible behaviour: **none** (test-only; Mode A docs ride with the implementing subtask S2).

Test-visible behaviour added:

### In `test/tools/shrink.test.ts` — NEW describe block (added, never modifies existing tests)
1. **Terse result + no-echo** — on a matched:yes success, `firstText(res) === "Mulligan: shrink
   recorded. Matched: yes."` and the result text does **not** contain the `replacement` string.
2. **Notify echo gated on `hasUI`** — with `hasUI:true`, `ctx.ui.notify` is called exactly once,
   the message **contains** the replacement, and `type === "info"`. With `hasUI:false`, `notify`
   is **not** called (`notifyCalls` empty).
3. **Notify cap** — with a replacement longer than `config.shrink.notifyMaxChars` (default 2048),
   the notify message is capped: it contains the cap suffix `` …(<N> chars total) `` (N =
   replacement.length; U+2026 ellipsis) and does **not** contain the full uncapped replacement.

### In `test/config.test.ts` — NEW describe block (added, never modifies existing `toEqual` snapshots)
4. **`validateConfig({shrink:{notifyMaxChars:100}}).shrink.notifyMaxChars === 100`** (valid
   pass-through); boundary `1` valid; default `2048` with **no warn** when absent; invalid values
   `∈ {0, -1, "x", NaN, Infinity}` → `2048` with **exactly one** warn naming `shrink.notifyMaxChars`;
   sibling shrink fields unchanged when only the knob is set; type is a required `number`.

### Success Criteria
- [ ] New shrink echo tests (1)(2)(3) pass and fail if S2's terse-result or notify contract regresses.
- [ ] New config block (4) passes and fails if `notifyMaxChars` validation regresses.
- [ ] Zero changes to the 11 verbose-text assertions (those are S2's responsibility).
- [ ] `npx vitest run test/tools/shrink.test.ts test/config.test.ts` is fully green.
- [ ] `npm run typecheck` passes (no new type errors).

## All Needed Context

### Context Completeness Check
✅ Passes "No Prior Knowledge": every helper signature, the exact matched:yes setup, the S2 output
contract, the config-block template, and the validation commands are quoted verbatim below. An
implementer who has never seen this repo can write the tests by copying the code in
"Implementation Blueprint".

### Documentation & References

```yaml
- file: test/tools/shrink.test.ts
  why: The file under edit. Contains makePi/makeCtx/run/firstText/msgEntry/toolResult helpers
       (module-scoped, quoted below) AND makeCtx is ALREADY S2-ready (returns {ctx, notifyCalls}).
  pattern: A new describe block appended near the end; destructure {ctx, notifyCalls} from makeCtx.
  gotcha: Do NOT touch the 11 existing verbose-text assertions (L268/288-289/324/336/347/430/449/
          462/471/492/513) — S2 owns those. Add only. Do NOT override notifyMaxChars anywhere in this
          file (default 2048 must hold for the cap test).

- file: test/config.test.ts
  why: The file under edit. Template = the existing describe("shrink.maxActive & shrink.staleAfterFires
       (P3.M2.T1.S1 / spec/09 §2-§4)", …) block — clone its (a)-(h)+type shape for notifyMaxChars.
  pattern: validateConfig(raw) returns the validated config; invalid→default+warn asserted via
           vi.spyOn(console,"warn").mockImplementation(()=>{}) inside try/finally mockRestore().
  gotcha: S1 already baked notifyMaxChars:2048 into the file's toEqual snapshots — do NOT re-assert
          those; the new block is dedicated validation only.

- file: src/tools/shrink.ts   # READ-ONLY here (S2 implements it)
  why: S2 target contract this PRP asserts against. After S2: feedbackText → terse; a notify echo
       block (try/catch E13) calls ctx.ui.notify(msg,"info") only when ctx.hasUI; cap()+describeTarget()
       helpers added. This PRP does NOT edit this file.
  pattern: return `Mulligan: shrink recorded. Matched: ${matched?"yes":"no"}.`; notify msg =
           `Shrunk ${describeTarget(target)} — replacement:\n<<<\n${cap(replacement, cfg.shrink.notifyMaxChars)}\n>>>`
  gotcha: cap uses U+2026 ellipsis "…", NOT "...". Asserting the suffix must use the real ellipsis char.

- file: src/config.ts   # READ-ONLY here (S1 already implemented)
  why: notifyMaxChars is validated at L270-271 via coerceNumber(field, v, default, mustBePositive:true).
  pattern: identical to maxActive/staleAfterFires — invalid (<=0 or non-finite/non-numeric) → default + warn.

- docfile: spec/05-tools.md  # section "2. mulligan_shrink" → "Return shape" + "Behavior" step 5
  why: Authoritative terse-result text + the ctx.ui.notify requirement (zero-context-cost operator echo).
  section: "Return shape" + "Behavior" (step 5 cap rule: "…(<N> chars total)"; default 2048).
- docfile: spec/09-config.md  # "4. Validation rules"
  why: "Numbers: must be finite, >=0 (thresholds >0); invalid → default." + "Never throw." + warn-on-failure.

- file: plan/005_95d30743cdd4/architecture/m2_shrink_operator_echo.md
  why: The verified S2 design (cap/describeTarget/notify block + makeCtx fake) this PRP consumes.
- file: plan/005_95d30743cdd4/P1M2T1S2/PRP.md
  why: S2 contract — treat as the source of truth for what shrinkExecute will look like when S3 runs.
```

### Current Codebase tree (relevant slice)

```bash
src/
  config.ts                 # S1 DONE: notifyMaxChars in interface/default/validation (L73,L146,L270-271)
  tools/shrink.ts           # S2 target: terse feedbackText + notify echo + cap/describeTarget (NOT edited by S3)
test/
  config.test.ts            # EDIT: append `shrink.notifyMaxChars` describe block
  tools/shrink.test.ts      # EDIT: append operator-echo + terse-result describe block
package.json                # scripts: test=vitest run, typecheck=tsc --noEmit
tsconfig.json               # strict:true, noImplicitAny, types:["node"], include:["src","test"]
```

### Desired Codebase tree (files MODIFIED by this item)

```bash
test/config.test.ts         # +1 describe block "shrink.notifyMaxChars (P1.M2.T1.S3 / spec/09 §4)"
test/tools/shrink.test.ts   # +1 describe block "operator echo (ctx.ui.notify) + terse result (spec/05 §2 step 5)"
# (no new files; no production-code edits)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the cap suffix uses the U+2026 HORIZONTAL ELLIPSIS "…", NOT three ASCII dots "...".
//   S2's cap(): s.slice(0,max) + `…(${s.length} chars total)`. Assertions MUST use the real ellipsis:
//   expect(msg).toContain(`…(${len} chars total)`)   // ✅
//   expect(msg).toContain(`...(${len} chars total)`) // ❌ will never match.

// CRITICAL — makeCtx is ADDITIVE and ALREADY S2-ready (returns {ctx, notifyCalls}). Existing
//   `const { ctx } = makeCtx(...)` callers are unaffected; S3 destructures {ctx, notifyCalls}.

// CRITICAL — do NOT edit the 11 verbose-text assertions in shrink.test.ts (S2 owns them). Add only.

// GOTCHA — beforeEach/afterEach call clearAll() (resets runtime markers/seq). NO test in shrink.test.ts
//   sets notifyMaxChars, so DEFAULT 2048 applies throughout — the cap test safely relies on 2048.

// GOTCHA — the replacement chosen for the no-echo assertion must be DISTINCTIVE and must not be a
//   substring of the terse result ("Mulligan: shrink recorded. Matched: yes."). Use e.g. "COMPACT-9f2a".

// LIBRARY — vitest hand-rolled fakes (NO vi.fn() for makeCtx/makePi); console.warn is spied with
//   vi.spyOn(console,"warn").mockImplementation(()=>{}) wrapped in try/finally mockRestore().
```

## Implementation Blueprint

### Data models and structure
None — test-only. Reuses existing `ShrinkArgs`, `ShrinkDetails`, `MulliganConfig` types (already imported in the two test files).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD describe block to test/tools/shrink.test.ts (operator echo + terse result)
  - CREATE a new describe block, e.g.
      describe("operator echo (ctx.ui.notify) + terse result (spec/05 §2 step 5)", () => { … })
    placed near the end of the file (before or after the "types" block — does not matter; vitest order-independent).
  - IMPLEMENT the 3 tests (1)(2)(3) using the copy-paste code under "Test code — shrink.test.ts" below.
  - FOLLOW pattern: the existing matched:yes by_tool_call_id test (L279-289) — same makePi/makeCtx/run shape.
  - NAMING: "it(\"(a) …\", …)", "(b) …", "(c) …" to mirror the sibling config block's lettered tests.
  - DEPENDENCIES: makeCtx already returns {ctx, notifyCalls} (S2 done). Destructure both.
  - PLACEMENT: append inside the top-level file (sibling to existing describes).
  - DO NOT: touch the 11 verbose-text assertions; override notifyMaxChars; use vi.fn() for the ui fake.

Task 2: ADD describe block to test/config.test.ts (shrink.notifyMaxChars validation)
  - CREATE describe("shrink.notifyMaxChars (P1.M2.T1.S3 / spec/09 §4)", () => { … })
  - IMPLEMENT tests (a)-(e)+type using the copy-paste code under "Test code — config.test.ts" below.
  - FOLLOW pattern: the existing describe("shrink.maxActive & shrink.staleAfterFires (P3.M2.T1.S1 …)") block —
    same validateConfig(raw) call, same warn-spy try/finally, same expectTypeOf assertion.
  - NAMING: lettered "(a)".."(e)" + "(type)" to match the sibling block.
  - DEPENDENCIES: validateConfig, MulliganConfig already imported in test/config.test.ts.
  - DO NOT: add new toEqual snapshots for the full shrink object (S1 already did that); re-assert the default
    inside the DEFAULT_CONFIG block.

Task 3: VALIDATE
  - RUN: npx vitest run test/tools/shrink.test.ts test/config.test.ts  (must be green)
  - RUN: npm test                                                       (full suite, no regressions)
  - RUN: npm run typecheck                                              (tsc --noEmit, clean)
```

### Test code — shrink.test.ts (copy-paste; append as a new describe block)

```ts
// ── operator echo (ctx.ui.notify) + terse result (spec/05 §2 step 5) ─────────────────────
// P1.M2.T1.S3: locks the S2 contract — terse result never echoes the replacement, and the
// replacement reaches the HUMAN via ctx.ui.notify (zero-context-cost) iff ctx.hasUI, capped at
// config.shrink.notifyMaxChars (default 2048).
describe("operator echo (ctx.ui.notify) + terse result (spec/05 §2 step 5)", () => {
  // shared matched:yes setup — clone of the by_tool_call_id matched case (see L279-289).
  // hasUI defaults to true (matches ctx.hasUI in TUI/RPC modes).
  const matchedYes = ({ hasUI = true }: { hasUI?: boolean } = {}) => {
    const { appended, pi } = makePi();
    const { ctx, notifyCalls } = makeCtx({
      leafId: "leaf-9",
      hasUI,
      contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "big log..."))],
    });
    const target = { by_tool_call_id: "call-A" };
    return { appended, pi, ctx, notifyCalls, target };
  };

  it("(a) success result text is the terse form and does NOT echo the replacement", async () => {
    const { pi, ctx, target } = matchedYes();
    const replacement = "COMPACT-9f2a only keep the summary"; // distinctive; must NOT appear in the result
    const res = await run(pi, ctx, { target, replacement });
    expect(firstText(res)).toBe("Mulligan: shrink recorded. Matched: yes.");
    // echoing the replacement into the result would re-bloat context — the tool's whole purpose. Guard it:
    expect(firstText(res)).not.toContain(replacement);
  });

  it("(b) notifies the operator with the replacement when hasUI:true; silent when hasUI:false", async () => {
    const replacement = "the bug is on line 42";

    // hasUI:true → the replacement reaches the human at zero context cost (spec/05 §2 step 5)
    {
      const { pi, ctx, notifyCalls } = matchedYes({ hasUI: true });
      const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement });
      expect(firstText(res)).toBe("Mulligan: shrink recorded. Matched: yes.");
      expect(notifyCalls).toHaveLength(1);
      expect(notifyCalls[0].message).toContain(replacement); // replacement is in the toast
      expect(notifyCalls[0].type).toBe("info");
    }

    // hasUI:false → no user to show; notify is a no-op (print/JSON mode)
    {
      const { pi, ctx, notifyCalls } = matchedYes({ hasUI: false });
      const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement });
      expect(firstText(res)).toBe("Mulligan: shrink recorded. Matched: yes.");
      expect(notifyCalls).toHaveLength(0);
    }
  });

  it("(c) notify text is capped at notifyMaxChars (default 2048): replacement>2048 → '…(<N> chars total)'", async () => {
    const replacement = "X".repeat(3000); // > default 2048 → capped in the toast
    const { pi, ctx, notifyCalls } = matchedYes({ hasUI: true });
    await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement });
    expect(notifyCalls).toHaveLength(1);
    // cap suffix present — U+2026 ellipsis "…", NOT three dots (see Known Gotchas)
    expect(notifyCalls[0].message).toContain(`…(${replacement.length} chars total)`);
    // the FULL uncapped replacement is NOT in the toast (it was actually truncated to 2048 chars):
    expect(notifyCalls[0].message).not.toContain(replacement);
  });
});
```

> OPTIONAL bonus (item says "E13 ui-throws optional"). Only add if S2's notify block is wrapped in
> try/catch (it is, per contract). Verifies a ui failure never breaks the tool:
> ```ts
> it("(opt, E13) a ctx.ui.notify throw does not break the tool", async () => {
>   const { pi } = makePi();
>   const { ctx } = makeCtx({ leafId: "leaf-9", contextEntries: [msgEntry("toolResult", toolResult("call-A", "read", "x"))] });
>   (ctx as unknown as { ui: { notify(): never } }).ui = { notify() { throw new Error("ui boom"); } };
>   const res = await run(pi, ctx, { target: { by_tool_call_id: "call-A" }, replacement: "summary" });
>   expect(firstText(res)).toBe("Mulligan: shrink recorded. Matched: yes.");
> });
> ```
> (If you prefer not to cast ctx inline, add an additive `throwOnNotify?: boolean` opt to makeCtx —
> either is fine; keep it optional so the core 3 tests remain the deliverable.)

### Test code — config.test.ts (copy-paste; append as a new describe block)

```ts
// ── shrink.notifyMaxChars (P1.M2.T1.S3 / spec/09 §4) ─────────────────────────────────────
// Mirrors the shrink.maxActive & shrink.staleAfterFires block. validateConfig coerces with
// coerceNumber(field, v, default, mustBePositive:true): invalid (<=0 / non-finite / non-numeric) → 2048 + warn.
describe("shrink.notifyMaxChars (P1.M2.T1.S3 / spec/09 §4)", () => {
  it("(a) passes through a valid value", () => {
    expect(validateConfig({ shrink: { notifyMaxChars: 100 } }).shrink.notifyMaxChars).toBe(100);
  });

  it("(b) defaults to 2048 with NO warn when absent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(validateConfig({ shrink: {} }).shrink.notifyMaxChars).toBe(2048);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("(c) boundary 1 is valid (threshold must be >0)", () => {
    expect(validateConfig({ shrink: { notifyMaxChars: 1 } }).shrink.notifyMaxChars).toBe(1);
  });

  it("(d) leaves the other shrink fields unchanged when only notifyMaxChars is set", () => {
    const cfg = validateConfig({ shrink: { enabled: false, notifyMaxChars: 100 } });
    expect(cfg.shrink).toEqual({ enabled: false, maxActive: 32, staleAfterFires: 3, notifyMaxChars: 100 });
  });

  it("(e) invalid values fall back to 2048 with exactly one warn naming the field", () => {
    for (const bad of [0, -1, "x", NaN, Infinity] as unknown[]) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const cfg = validateConfig({ shrink: { notifyMaxChars: bad } });
        expect(cfg.shrink.notifyMaxChars).toBe(2048);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("shrink.notifyMaxChars");
      } finally {
        warn.mockRestore();
      }
    }
  });

  it("(type) shrink.notifyMaxChars is a required number", () => {
    expectTypeOf<MulliganConfig["shrink"]>().toHaveProperty("notifyMaxChars").toEqualTypeOf<number>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN — matched:yes setup (the template every shrink success test clones; see shrink.test.ts L279-289):
//   makePi() + makeCtx({leafId, contextEntries:[msgEntry("toolResult", toolResult("call-A","read",…))]})
//   + run(pi, ctx, {target:{by_tool_call_id:"call-A"}, replacement}).
//   matched:false is NOT a refusal (E8) — use {by_tool_call_id:"does-not-exist"} to get matched:no.

// PATTERN — capture notify via the makeCtx fake (already S2-ready): destructure {ctx, notifyCalls};
//   notifyCalls is [{message, type?}] populated by ctx.ui.notify(m,t). Assert length + message substring + type.

// PATTERN — config validation per-knob block: validateConfig(raw) returns validated cfg; for invalid values
//   spy console.warn, assert exactly N calls + call[0][0] contains the field name; restore in finally.

// GOTCHA — the cap suffix char is U+2026 "…". If a test mysteriously fails on the cap assertion, the #1 cause
//   is having typed three ASCII dots. Copy the ellipsis verbatim from S2's cap() or this PRP.

// GOTCHA — "does NOT contain the replacement" only proves no-echo if the replacement is distinctive and is
//   not a substring of "Mulligan: shrink recorded. Matched: yes./no.". Use a unique token (e.g. "COMPACT-9f2a").
```

### Integration Points
```yaml
TEST FILES (append-only — no registration/wiring needed; vitest auto-discovers *.test.ts):
  - test/tools/shrink.test.ts: append the operator-echo describe block (Task 1)
  - test/config.test.ts:      append the shrink.notifyMaxChars describe block (Task 2)
NO: production code edits, config changes, package.json changes, new files, DB, routes.
```

## Validation Loop

### Level 1: Syntax & Style (after writing each block)
```bash
npm run typecheck                       # tsc --noEmit — must be clean (strict + noImplicitAny)
# (No linter/formatter is configured in package.json; typecheck is the gate.)
# Expected: zero errors. If errors, READ them — the usual cause is a stale import or a wrong cap-suffix char.
```

### Level 2: Unit Tests (the deliverable)
```bash
# The two files this item touches — run first, must be fully green:
npx vitest run test/tools/shrink.test.ts test/config.test.ts

# Expected: ALL pass. If (a)/(b)/(c) fail → S2's terse-result/notify/cap contract isn't as assumed; re-read
#   src/tools/shrink.ts and align the assertion to the ACTUAL S2 output (this PRP's contract is the target).
# If config (a)-(e) fail → re-read src/config.ts L270-271; confirm coerceNumber mustBePositive:true semantics.
```

### Level 3: Full Suite (no regressions)
```bash
npm test                                # vitest run — entire suite
# Expected: green. Confirms S3 added tests without breaking S2's 11 assertion fixes or any other suite.
# Pay special attention if any pre-existing shrink/config test turned red — that means S3 accidentally edited
# a line it shouldn't have (revert; S3 is append-only).
```

### Level 4: Contract spot-check (optional, manual reasoning)
```bash
# Confirm the cap arithmetic the tests rely on (replacement.length=3000, default max=2048):
node -e "const s='X'.repeat(3000);const c=s.slice(0,2048)+'\u2026('+s.length+' chars total)';console.log('suffix present:',c.includes('\u2026(3000 chars total)'),'| full uncapped present:',c.includes(s),'| three-dots:',c.includes('...(3000 chars total)'));"
# Expected: suffix present: true | full uncapped present: false | three-dots: false
# Confirm no-echo by hand: the terse result "Mulligan: shrink recorded. Matched: yes." contains no occurrence
# of the distinctive replacement token (e.g. "COMPACT-9f2a").
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run typecheck` clean.
- [ ] `npx vitest run test/tools/shrink.test.ts test/config.test.ts` fully green.
- [ ] `npm test` (full suite) green — no regressions.

### Feature Validation
- [ ] (a) terse result asserted AND `not.toContain(replacement)` on a matched:yes success.
- [ ] (b) `notifyCalls.length===1` + message contains replacement + type "info" when `hasUI:true`;
      `notifyCalls.length===0` when `hasUI:false`.
- [ ] (c) replacement>2048 → notify message contains `…(<N> chars total)` (U+2026) and not the full replacement.
- [ ] (4) config: valid 100→100, boundary 1→1, absent→2048 no-warn, invalid {0,-1,"x",NaN,Infinity}→2048 +
      exactly one warn naming `shrink.notifyMaxChars`, type is required number.

### Code Quality Validation
- [ ] Append-only: zero edits to the 11 verbose-text assertions or any existing `toEqual` snapshot.
- [ ] New blocks follow the existing lettered-test + describe-naming conventions.
- [ ] No `vi.fn()` for makeCtx/makePi (hand-rolled fakes); console.warn spied with try/finally restore.
- [ ] No production-code, package.json, or new-file changes.

### Documentation & Deployment
- [ ] Mode A: no user-facing/config/API surface change — no README/docs update required (rides with S2).

---

## Anti-Patterns to Avoid
- ❌ Don't edit the 11 verbose-text assertions — S2 owns them; S3 is strictly additive.
- ❌ Don't re-snapshot the full shrink object's defaults in config.test.ts — S1 already did; validate the knob only.
- ❌ Don't use three ASCII dots `...` for the cap suffix — it's U+2026 `…` (copy verbatim).
- ❌ Don't override `notifyMaxChars` inside shrink.test.ts — the cap test relies on the default 2048.
- ❌ Don't use a replacement that is a substring of the terse result for the no-echo assertion — use a unique token.
- ❌ Don't write production code — this item is test-only; if S2's output differs from this PRP's contract,
  align the TEST to reality (and flag the divergence), do not "fix" src/tools/shrink.ts here.

---

**Confidence Score: 9/10** — one-pass success likelihood is high: makeCtx is already S2-ready
(notifyCalls capture confirmed at L76-112), the matched:yes setup template is quoted verbatim, the
config block is a verbatim clone of an existing sibling block, and the test commands are verified.
The only residual risk is S2 landing with a slightly different notify-message wording than the
contract asserts against — but tests (b)/(c) assert on **substrings** (`toContain(replacement)`,
`toContain("…(N chars total)")`) that are robust to the surrounding `Shrunk <desc> — replacement:`
template, so wording drift won't break them. Test (a) asserts the exact terse string, which S2's
own PRP fixes the 11 existing assertions to match — so (a) and S2 converge on the identical string.