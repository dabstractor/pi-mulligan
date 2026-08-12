# PRP — P1.M1.T1.S4: Tests for `to_previous_prompt` removal (39 occurrences, 6 files)

---

## Goal

**Feature Goal**: Update the test suite to match the v1.1 API surface established by the already-complete sibling subtasks (S1 `transforms.ts`, S2 `rewind.ts`, S3 `markers.ts`). Remove all 39 references to `to_previous_prompt`, collapse the now-2-arg `resolveLastTurn` call sites, delete every "nuclear-mode" test case, and replace the removed behavior coverage with a positive **v1.1 guardrail** assertion: a `last_turn` rewind **never** removes a user message. The end state is a fully green suite (`tsc --noEmit` + `vitest run`) with **zero** references to `to_previous_prompt` or "nuclear" in the test tree.

**Deliverable**: Modified versions of exactly 6 test files (NO source/`src/` changes):
- `test/transforms.test.ts` (13 occurrences — the bulk)
- `test/tools/rewind.test.ts` (11)
- `test/edge-cases.test.ts` (8)
- `test/integration/smoke.ts` (4)
- `test/markers.test.ts` (2)
- `test/tools/cancel.test.ts` (1)

**Success Definition**:
- `npx tsc --noEmit` exits 0 (currently exits 2 with ~44 errors).
- `npm test` (`vitest run`) is fully green.
- `grep -rn "to_previous_prompt\|nuclear" test/` returns **0** matches.
- A positive guardrail test asserts a `last_turn` rewind leaves the latest user message in the surviving tail.

---

## Why

- **Unblocks the build.** S1/S2/S3 deliberately broke the old tests (the API they exercised no longer exists). The repo currently fails `tsc --noEmit` because the tests still call the removed 2-arg/opts `resolveLastTurn` and the removed `RewindParams.to_previous_prompt`. S4 is the test-corollary that restores green.
- **Locks in the v1.1 guardrail in tests, not just code.** `last_turn` now keeps the latest user message *by construction* (the loop starts at `iLastUser + 1`). Deleting the nuclear tests is only half the job — the contract (item_description) explicitly requires *strengthening* the keep-user-message assertions into guardrail tests so a future regression is caught.
- **Scope boundary.** This is **test-only** (Mode A, no docs). S4 must NOT touch any file under `src/`, `PRD.md`, `tasks.json`, or the `spec/` tree. It must also NOT pre-empt later subtasks: P1.M3 removes the `mulligan_checkpoint` agent tool and its tests — leave `checkpoint.test.ts` and the `checkpoint` granularity path **untouched** here (the `checkpoint` option in `RewindArgs` is unrelated to `to_previous_prompt`).

---

## What

### Background — what S1/S2/S3 changed (the contract this PRP conforms to)

1. **S1 (`src/transforms.ts`)** — `resolveLastTurn` signature changed from
   `(messages, opts?, excludeToolCallId?)` to **`(messages, excludeToolCallId?)`**. The `opts` object (which carried `to_previous_prompt`) is **gone**; the nuclear `iFirstUser`-scan refusal block is gone. The new body computes `iLastUser` and removes everything strictly after it (loop starts at `iLastUser + 1`), keeping `mulligan:*` notes and the rewind's own unit. **The latest user message is never in the removal set** (guardrail by construction).
2. **S2 (`src/tools/rewind.ts`)** — `RewindParams` no longer has a `to_previous_prompt` property; the BUG-006 refusal block (dead code) was removed; `payload.options` now emits only `{ protect: config.rewind.protectedRoles }` (verified at `src/tools/rewind.ts:596`); the call site is `resolveLastTurn(messages, toolCallId)` (`rewind.ts:438`).
3. **S3 (`src/markers.ts`)** — `RewindMarker.options` keeps `to_previous_prompt?: boolean` **optional** (legacy reads of old persisted markers) **plus** `protect?: string[]` (verified at `src/markers.ts:58-66`). This means a persisted-marker *assertion* can still type-check against `to_previous_prompt`, but at runtime rewind.ts no longer emits it → stale assertions must be cleaned.

**The single most important transformation rule** (read this twice):

> The 2nd positional argument of `resolveLastTurn` **changed type** from an `opts` object to a `string` (`excludeToolCallId`). Therefore every 3-arg call `resolveLastTurn(msgs, {}, "ID")` does **not** merely drop arg 2 — the **3rd arg (the string) collapses into the 2nd slot**: `resolveLastTurn(msgs, "ID")`. Getting this wrong (e.g. writing `resolveLastTurn(msgs, "ID", "ID")`) reintroduces "Expected 1-2 arguments" errors.

### Success Criteria

- [ ] `grep -rn "to_previous_prompt" test/` → 0 lines.
- [ ] `grep -rn "nuclear" test/` → 0 lines.
- [ ] `npx tsc --noEmit` → exit 0.
- [ ] `npm test` → all green.
- [ ] At least one positive guardrail test asserts a `last_turn` rewind leaves the latest `user` message in the surviving tail (in `transforms.test.ts`).
- [ ] No file under `src/`, `spec/`, `PRD.md`, or `tasks.json` is modified.

---

## All Needed Context

### Context Completeness Check

✅ Passes "No Prior Knowledge" test: every call site is listed with its **current line number**, the **exact current code**, and the **exact replacement**. The implementer needs no familiarity with mulligan internals beyond this document.

### Documentation & References

```yaml
# MUST READ — the spec authority for WHY nuclear is gone and the guardrail replaces it
- docfile: plan/007_67d7d8c6e4c5/prd_snapshot.md
  why: |
    h3.60 (resolveLastTurn): "[u0,a,r,u1,a,r] → remove indices AFTER u1 (keep u1; last_turn never wipes
    user input — v1.1 guardrail)". h2.127 §1: "This is why v1's to_previous_prompt option is removed — it
    discarded the latest user message." These two sentences ARE the rationale for every deletion below.
  section: h3.60, h2.127 (guardrail table), h2.71 (protected messages)
  critical: |
    The guardrail is enforced BY CONSTRUCTION in resolveLastTurn, not by a refusal. So the old "nuclear
    refused → {remove:[]}" tests do NOT become "guardrail refuses" tests — they are DELETED, because there
    is no longer any nuclear code path. The guardrail is asserted positively (user msg survives), not via
    a refusal assertion.

# The verified change surface (exact src touchpoints already done by S1/S2/S3 — DO NOT modify these)
- file: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: §Change 2 lists every test occurrence with line numbers. This PRP cross-checks each.
  pattern: "Test files (39 occurrences)" subsection
  gotcha: The line numbers in change_surface.md are STILL ACCURATE — confirmed against the live tree
          (the test files have not been edited since the doc was written).

# The NEW resolveLastTurn contract the tests must conform to (READ the body before editing transforms.test.ts)
- file: src/transforms.ts
  why: Lines 317-357 — the current signature + body. The loop at line ~345 `for (let j = iLastUser + 1; ...)`
        is the guardrail (iLastUser is never pushed). No opts param, no nuclear branch.
  pattern: "export function resolveLastTurn(messages: MessageLike[], excludeToolCallId?: string): { remove: number[] }"
  critical: excludeToolCallId is the ONLY optional param. There is no third param.

# The NEW rewind tool behavior (what persisted markers now look like)
- file: src/tools/rewind.ts
  why: Line 596 emits `options: { protect: config.rewind.protectedRoles }` — so a freshly-persisted rewind
        marker's options is `{ protect: ["first:user","latest:user"] }` with NO to_previous_prompt key.
        Line 438: `resolveLastTurn(messages, toolCallId)` (2-arg).
  pattern: "options: { protect: config.rewind.protectedRoles }"

# The marker TYPE (still allows optional to_previous_prompt for legacy reads — explains why some assertions
# type-check but are semantically stale)
- file: src/markers.ts
  why: Lines 58-66 — `options: { to_previous_prompt?: boolean; protect?: string[] }`. The `to_previous_prompt`
        key is OPTIONAL so OLD persisted data still parses. New markers never set it.
  gotcha: toEqual({ protect:[...] }) vs toEqual({ to_previous_prompt: undefined, protect:[...] }) —
          vitest's toEqual treats undefined properties as absent, so the stale assertion MAY still pass at
          runtime. Clean it up anyway per the contract (clarity + the grep-must-be-zero gate).

# Test framework + runner
- file: package.json
  why: scripts.test = "vitest run"; scripts.typecheck = "tsc --noEmit". vitest ^1, typescript ^5, ESM.
  pattern: "npm test" and "npm run typecheck"
```

### Current Codebase tree (test tree only — the scope of this PRP)

```bash
test/
├── transforms.test.ts        # ← 13 edits (resolveLastTurn suite + 1 pipeline test)
├── edge-cases.test.ts        # ← 8 edits  (rewindParams helper + E3 nuclear cases)
├── markers.test.ts           # ← 2 edits  (REWIND_DATA fixture + verbatim-spread assertion)
├── bug-replay-repro.test.ts  # untouched
├── config.test.ts            # untouched
├── drift_nudge.test.ts       # untouched
├── filter.test.ts            # untouched
├── index.test.ts             # untouched (P1.M3 owns tool-count changes)
├── ledger.test.ts            # untouched
├── log.test.ts               # untouched
├── notes.test.ts             # untouched
├── nudges.test.ts            # untouched
├── runtime.test.ts           # untouched
├── settings.test.ts          # untouched
├── tokens.test.ts            # untouched
├── turn_metric.test.ts       # untouched
├── integration/
│   ├── smoke.ts              # ← 4 edits (rewindNow helper + F-protected case)
│   ├── run-smoke.mjs         # untouched (runner; smoke.ts is the scenario lib)
│   └── scenarios.md          # untouched
└── tools/
    ├── rewind.test.ts        # ← 11 edits (BUG-006 test + persisted options + RewindArgs type)
    ├── cancel.test.ts        # ← 1 edit   (options fixture line 171)
    ├── checkpoint.test.ts    # untouched (P1.M3 owns it)
    ├── audit.test.ts         # untouched
    └── shrink.test.ts        # untouched
```

### Desired Codebase tree with files added/removed

**No files added or removed.** All 6 target files are modified in place. The deletion of "nuclear" `it(...)` blocks shrinks some `describe` groups but leaves the file structure intact.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — the resolveLastTurn 2nd-arg type swap (THE #1 source of tsc errors)
// OLD (v1.0): resolveLastTurn(messages, opts?: {to_previous_prompt?:boolean}, excludeToolCallId?: string)
// NEW (v1.1): resolveLastTurn(messages, excludeToolCallId?: string)
// => `resolveLastTurn(msgs, {}, "REW")` is NOT "drop the {}"; it is COLLAPSE the string into slot 2:
//    resolveLastTurn(msgs, "REW")
// Confirmed by live tsc output: "error TS2554: Expected 1-2 arguments, but got 3"
//                          and: "error TS2345: Argument of type '{}' is not assignable to parameter of type 'string'"

// CRITICAL — RewindArgs no longer has to_previous_prompt (S2 removed it from RewindParams).
// `grep -rn "to_previous_prompt" test/` MUST reach 0. That includes:
//   - the RewindArgs TYPE assertion (rewind.test.ts:859)
//   - the rewindParams() helper spreading the override (edge-cases.test.ts:318)
//   - the smoke rewindNow() opts shape (smoke.ts:110,119)
// A `as RewindArgs` cast that sets to_previous_prompt will type-error (good — it forces removal).

// GOTCHA — vitest toEqual ignores undefined properties.
// `expect(entry.options).toEqual({ to_previous_prompt: undefined, protect:[...] })` may still PASS at runtime
// even though rewind.ts no longer emits the key. The contract still requires cleaning it to
// `{ protect:[...] }` because (a) the grep gate demands 0 references and (b) it is semantically stale.

// GOTCHA — RewindMarker.options KEEPS to_previous_prompt?: boolean (optional, src/markers.ts:61, S3).
// So a persisted-marker FIXTURE (e.g. cancel.test.ts:171, markers.test.ts REWIND_DATA) that writes
// `options: { to_previous_prompt: false }` still TYPE-CHECKS. It must still be edited (grep gate + the
// new canonical shape is { protect:[...] }).

// GOTCHA — `checkpoint` in RewindArgs is UNRELATED and must stay. The RewindArgs type test must keep the
// `args.checkpoint` assertion; only drop the `args.to_previous_prompt` assertion. Do NOT remove checkpoint
// option from rewindParams() / rewindNow() helpers.

// LIBRARY — vitest ^1, run via `npm test` (= `vitest run`). Type-check via `npm run typecheck`
// (= `tsc --noEmit`). tsconfig includes both `src` and `test`, so test-only type errors fail the build.
```

---

## Implementation Blueprint

### Data models and structure

No data models are created. This PRP consumes the existing types:

```typescript
// src/transforms.ts (S1) — the NEW signature tests must conform to:
export function resolveLastTurn(
  messages: MessageLike[],
  excludeToolCallId?: string,
): { remove: number[] }

// src/markers.ts (S3) — RewindMarker.options (the asserted shape):
options: { to_previous_prompt?: boolean; protect?: string[] }  // to_previous_prompt legacy-optional

// src/tools/rewind.ts (S2) — RewindArgs (Static<typeof RewindParams>): note + granularity + checkpoint
//   (NO to_previous_prompt). payload.options emitted = { protect: config.rewind.protectedRoles }.
```

### Implementation Tasks (ordered: largest/dependency-root first)

```yaml
Task 1: EDIT test/transforms.test.ts  (13 occurrences — DO THIS FIRST, it is the type-error epicenter)
  Scope: the "resolveLastTurn — ..." describe blocks (lines ~535-732) + one pipeline test (~1384-1393).
  The "PINNED contract" group (lines 537-557):
    - DELETE the whole `it("to_previous_prompt:true → ALSO remove u1 ...")` (lines 549-551).
    - DELETE the whole `it("u1 is the FIRST user → nuclear refused ...")` (lines 553-556).
    - In the surviving `it("default → remove indices AFTER u1 ...")` (lines 544-547):
        * `resolveLastTurn(twoTurns(), {}).remove` → `resolveLastTurn(twoTurns()).remove`
        * `resolveLastTurn(twoTurns(), undefined).remove` → keep but re-comment: drop the "opts may be
          undefined" comment; this now asserts excludeToolCallId=undefined is fine. e.g.
          `resolveLastTurn(twoTurns(), undefined).remove`  (still valid — undefined is the default).
    - STRENGTHEN this test into the guardrail: after the existing expects, add an assertion that
      `twoTurns()[3].role === "user"` (u1) is NOT in `resolveLastTurn(twoTurns()).remove`.
  The "OWN unit survives" group (lines 560-579):
    - `resolveLastTurn(msgs, {}, "REW")` → `resolveLastTurn(msgs, "REW")`  (COLLAPSE 3→2 args)  [×2: 567, 578]
  The "mulligan:* notes survive" group (lines 582-607):
    - `resolveLastTurn(msgs, {}).remove` → `resolveLastTurn(msgs).remove`  [×3: 589, 597, 606]
  The "no-op cases" group (lines 610-622):
    - DELETE the second expect on line 614 (`resolveLastTurn(msgs, { to_previous_prompt: true })`).
    - DELETE the second expect on line 621 (`resolveLastTurn(msgs, { to_previous_prompt: true }).remove ...`).
    - `resolveLastTurn(msgs, {})` (lines 613, 619) → `resolveLastTurn(msgs)`.
  The "excludeToolCallId semantics" group (lines 625-650):
    - `resolveLastTurn(msgs, {}).remove` (632) → `resolveLastTurn(msgs).remove`
    - `resolveLastTurn(msgs, {}, "").remove` (640) → `resolveLastTurn(msgs, "").remove`  (COLLAPSE)
    - `resolveLastTurn(msgs, {}, 123 as unknown as string).remove` (641) →
        `resolveLastTurn(msgs, 123 as unknown as string).remove`  (COLLAPSE — keeps the defensive non-string test)
    - `resolveLastTurn(msgs, {}, "DOES-NOT-EXIST").remove` (649) → `resolveLastTurn(msgs, "DOES-NOT-EXIST").remove`
  The "nuclear edge cases" describe block (lines 653-675):
    - DELETE the entire `describe("resolveLastTurn — nuclear edge cases", ...)` block (653-675). All three
      its are nuclear. (The 3rd `it("default is NEVER refused on a single-user list...")` at 671-674 is
      arguably guardrail-worthy; if you want to preserve its spirit, RE-HOME it as a new guardrail test in
      Task 1b. Otherwise delete — the new guardrail test in Task 1b covers the same property.)
  The "defensive (NEVER throws)" group (lines 677-710):
    - DELETE the entire `it("malformed opts (non-object / missing field) → treated as default (not nuclear)")`
      (lines 685-688) — opts no longer exists, so "malformed opts" is meaningless. (This is the line-686
      "bad-opts defensive test" named in the contract.)
    - `resolveLastTurn(null as unknown as MessageLike[], {})` (679) → `resolveLastTurn(null as unknown as MessageLike[])`
    - `resolveLastTurn(undefined as unknown as MessageLike[], {})` (680) → `resolveLastTurn(undefined as unknown as MessageLike[])`
    - `resolveLastTurn("nope" as unknown as MessageLike[], {})` (681) → `resolveLastTurn("nope" as unknown as MessageLike[])`
    - Lines 696, 698, 707, 708: every `resolveLastTurn(msgs, {})` → `resolveLastTurn(msgs)` (drop the {}).
  The "purity, ordering, types" group (lines 712-732):
    - Line 715-716: `resolveLastTurn(msgs, {})` → `resolveLastTurn(msgs)`  [×2]
    - DELETE the `it("remove is ASCENDING ... for the nuclear case")` (721-725) — nuclear is gone. (If you
      want to keep an ascending-order assertion, rewrite it on the DEFAULT case:
      `const remove = resolveLastTurn(msgs).remove;` and keep the sort check.)
    - Type test (727-731): replace with the 2-arg signature assertions:
        `expectTypeOf(resolveLastTurn([])).toEqualTypeOf<{ remove: number[] }>();`
        `expectTypeOf(resolveLastTurn([], "x")).toEqualTypeOf<{ remove: number[] }>();`
        DELETE the `resolveLastTurn([], { to_previous_prompt: true })` and `resolveLastTurn([], undefined, "x")`
        lines (they reference the removed opts/third-arg).
  Pipeline test (~line 1384-1393, the `it("spec/10 §1.9 bullet 3 — protected message → rewind skipped ...")`):
    - This test's marker is `{ options: { to_previous_prompt: true }, excludeToolCallId: "c" }` (line 1389).
      The whole premise (resolver refuses nuclear → no-op) is GONE. REPURPOSE into a guardrail test OR
      DELETE. Recommended: REWRITE to assert that a `last_turn` rewind over the SAME `[user, asst, result]`
      snapshot removes ONLY the assistant+result (`remove=[1,2]`) and the user survives:
        markers: [mkRewind(1, "last_turn", { excludeToolCallId: "c" })]   // drop options entirely
        expect(out).toHaveLength(1)            // only the user survives
        expect(out[0].role).toBe("user")
      (Drop the `options` key from mkRewind entirely — options is now optional.) Verify mkRewind's signature
      accepts no options by reading its definition near the top of the file first.
  ALSO scan line 963: `const { remove } = resolveLastTurn(msgs, {}, exclude);` — COLLAPSE to
    `const { remove } = resolveLastTurn(msgs, exclude);` (this is a non-nuclear resolver test; not in the
    contract's 13 list but it WILL tsc-error with "got 3 args". Fix it.)
  NAMING/PLACEMENT: keep all describe/it slugs; only delete nuclear ones. Comments referencing "nuclear",
    "iFirstUser===iLastUser", or "BUG-006" in this file must be removed or rewritten (grep gate).

Task 1b: ADD the positive guardrail test to test/transforms.test.ts
  - Inside the "resolveLastTurn — spec/10 §1.3 PINNED contract" describe (or a new sibling describe), add:
      it("v1.1 guardrail: a last_turn rewind NEVER removes the latest user message", () => {
        const msgs: MessageLike[] = [
          user("u0"), asst("c0"), result("c0"),
          user("the latest ask"), asst("c1"), result("c1"),
        ];
        const { remove } = resolveLastTurn(msgs); // iLastUser=3
        expect(remove).not.toContain(3);          // the latest user message is NEVER removed
        // surviving tail after a rewind keeps u1:
        const surviving = msgs.filter((_, i) => !remove.includes(i));
        expect(surviving.at(-1)?.role ?? surviving.at(-2)?.role).toBeDefined();
        expect(surviving.some((m) => m.role === "user")).toBe(true);
      });
  - This is the ONE addition; everything else is deletion/collapse. (Match the existing user()/asst()/result()
    helper names already imported at the top of the file.)

Task 2: EDIT test/tools/rewind.test.ts  (11 occurrences)
  - DELETE the BUG-006 refusal test: the entire
      `it("nuclear last_turn (to_previous_prompt:true) on the FIRST/ONLY user message → refusal; NO marker created (BUG-006)")`
      block (lines 442-457). It is the only `it` in the "refusal: protected message (step 5b ...)" describe.
      If that describe becomes empty, delete the describe header too (or repopulate with a non-nuclear
      protected refusal — see note). NOTE: the contract says "remove the BUG-006 nuclear test" — just delete.
  - Persisted-options assertion (line 529): inside the "persists a mulligan:rewind marker with the EXACT
      payload" test, change
      `expect(entry.options).toEqual({ to_previous_prompt: undefined, protect: ["first:user", "latest:user"] });`
      → `expect(entry.options).toEqual({ protect: ["first:user", "latest:user"] });`
  - DELETE the entire
      `it("persisted options.to_previous_prompt === undefined when omitted; === the passed value when set (last_turn)")`
      block (lines 568-586). Its premise (passing to_previous_prompt:true) is impossible now — RewindParams
      has no such field. This also removes the line-583 call and the line-585 assertion.
  - RewindArgs type test (lines 851-860): in the
      `it("RewindArgs (Static<typeof RewindParams>) has note + granularity + optional to_previous_prompt + checkpoint")`:
      * RENAME the `it` title: drop "optional to_previous_prompt +"; → "...has note + granularity + checkpoint".
      * DELETE line 859: `expectTypeOf(args.to_previous_prompt).toEqualTypeOf<boolean | undefined>();`
      * KEEP the `args.note`, `args.granularity`, and `args.checkpoint` assertions.

Task 3: EDIT test/edge-cases.test.ts  (8 occurrences)
  - rewindParams() helper (lines 314-321): remove the `to_previous_prompt: over.to_previous_prompt,` line
      (318). Resulting helper spreads only note/granularity/checkpoint. Keep the `as RewindArgs` cast.
  - DELETE these nuclear resolver/tool tests inside the "E3 — Rewinding across a protected message" describe:
      * `it("resolveLastTurn nuclear (to_previous_prompt) REFUSES when iFirstUser === iLastUser ...")`
        (lines 408-412) — references `resolveLastTurn(msgs, { to_previous_prompt: true }, "rw-1")`.
      * `it("resolveLastTurn nuclear removes iLastUser NOT iFirstUser when they differ")` (lines 414-419)
        — same removed call.
      * `it("filterPipeline NO-OPS a rewind whose remove would cross first:user ...")` (lines 434-446) —
        its marker is `{ options: { to_previous_prompt: true }, ... }`.
      * `it("the TOOL refuses a nuclear protected rewind before persisting ... (BUG-006)")` (lines 448-466)
        — calls `rewindParams({ granularity: "last_turn", to_previous_prompt: true })`.
  - KEEP the two `protectedOk` tests in that describe (lines ~421-432) — they do NOT reference
      to_previous_prompt and assert `protectedOk` blocks `first:user`. They are still valid (protectedOk
      still enforces first:user). If the describe becomes sparse, that is fine.
  - Line 629 (NOT in the contract's 8-list but WILL tsc-error): inside
      `it("resolveLastTurn keeps the WHOLE shared unit ...")`, the call
      `resolveLastTurn(msgs, undefined, "R")` → COLLAPSE to `resolveLastTurn(msgs, "R")`.

Task 4: EDIT test/integration/smoke.ts  (4 occurrences)
  - rewindNow() helper (lines 105-143): in the signature, change
      `opts?: { to_previous_prompt?: boolean; checkpoint?: string }` → `opts?: { checkpoint?: string }`.
    In the payload object (lines ~116-122), DELETE the `to_previous_prompt: opts?.to_previous_prompt,` line
      (119). Keep `checkpoint: opts?.checkpoint`.
  - F-protected scenario (lines 232-242): the case body calls
      `rewindNow(pi, ctx, "smoke-prot-1", "last_turn", { to_previous_prompt: true })` and relies on a BUG-006
      pre-persist refusal. Since nuclear is gone, this scenario is no longer drivable this way.
      RECOMMENDED: convert F-protected to a `checkpoint`-granularity refusal (the v1.1 meaning of F-protected,
      per prd_snapshot h3.69 row "F-protected": "attempt a checkpoint rewind whose scope would reach the first
      user message"). Minimal change that keeps the scenario meaningful without new code:
        case "F-protected": {
          // v1.1: F-protected = a checkpoint rewind whose scope would reach first:user is refused/blocked.
          // last_turn can no longer cross a user message (guardrail), so drive via checkpoint granularity.
          await rewindNow(pi, ctx, "smoke-prot-1", "checkpoint", { checkpoint: "no-such-checkpoint" });
          break;
        }
      If a "no-such-checkpoint" refusal is not what assertProtected() checks, the safe fallback is to DELETE
      the F-protected case body's to_previous_prompt drive AND the corresponding assertProtected call, leaving
      a `case "F-protected": smokeLog(...,"info",{note:"moved to checkpoint scope; see spec/10 §2.1"}); break;`.
      Read assertProtected()'s implementation before choosing. Either way the to_previous_prompt drive is removed.

Task 5: EDIT test/markers.test.ts  (2 occurrences)
  - REWIND_DATA fixture (line 122): `options: { to_previous_prompt: false },` → `options: { protect: ["first:user", "latest:user"] },`
      (the new canonical persisted shape; matches what rewind.ts emits).
  - Verbatim-spread assertion (line 175): `expect(entry.options).toEqual({ to_previous_prompt: false });` →
      `expect(entry.options).toEqual({ protect: ["first:user", "latest:user"] });`
  - This test asserts appendRewindMarker spreads the caller payload VERBATIM, so the fixture + assertion must
      agree. Using the real emitted shape keeps the test meaningful.

Task 6: EDIT test/tools/cancel.test.ts  (1 occurrence)
  - Fixture line 171: `options: { to_previous_prompt: false, protect: ["first:user", "latest:user"] },` →
      `options: { protect: ["first:user", "latest:user"] },`
  - This is a hand-built persisted-marker fixture the cancel tool reads via readOwn; dropping the legacy key
      makes it match real v1.1 markers.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN A — the 3-arg → 2-arg COLLAPSE (applies ~8 times in transforms.test.ts + once in edge-cases.test.ts)
// BEFORE: resolveLastTurn(msgs, {}, "REW")      // opts={} in slot 2, excludeId in slot 3
// AFTER:  resolveLastTurn(msgs, "REW")          // excludeId now in slot 2; opts gone
// BEFORE: resolveLastTurn(msgs, {}, "")         // defensive empty-string excludeId
// AFTER:  resolveLastTurn(msgs, "")
// BEFORE: resolveLastTurn(msgs, undefined, "R") // edge-cases.test.ts:629
// AFTER:  resolveLastTurn(msgs, "R")

// PATTERN B — the opts-less default call (applies ~20 times)
// BEFORE: resolveLastTurn(msgs, {})
// AFTER:  resolveLastTurn(msgs)
// BEFORE: resolveLastTurn(msgs, {}).remove
// AFTER:  resolveLastTurn(msgs).remove

// PATTERN C — DELETION of a nuclear assertion line that shares an `it` with a kept assertion
// In transforms.test.ts no-op group, line 613-614:
//   expect(resolveLastTurn(msgs, {})).toEqual({ remove: [] });                            // KEEP (→ drop {})
//   expect(resolveLastTurn(msgs, { to_previous_prompt: true })).toEqual({ remove: [] });  // DELETE
// Do NOT try to "merge" — just delete the second line.

// PATTERN D — the persisted-options cleanup (rewind.test.ts:529 + markers.test.ts:122/175 + cancel.test.ts:171)
// The runtime value rewind.ts now emits is { protect: config.rewind.protectedRoles }.
// config default protectedRoles = ["first:user","latest:user"] (confirmed via DEFAULT_CONFIG; the existing
// passing assertions already use exactly this list).
// AFTER:  expect(entry.options).toEqual({ protect: ["first:user", "latest:user"] });

// PATTERN E — the guardrail ADDITION (the one new test; transforms.test.ts)
// Use the existing user()/asst()/result()/custom() helpers already imported.
// Assert: (1) the latest user index is NOT in remove; (2) ≥1 user message survives.

// CRITICAL — do NOT touch checkpoint-related code paths
// RewindArgs.checkpoint stays. resolveCheckpoint/filterPipeline checkpoint tests stay. P1.M3 owns
// the mulligan_checkpoint agent tool + checkpoint.test.ts. S4's only job is to_previous_prompt/nuclear.
```

### Integration Points

```yaml
NO source changes. This PRP edits only test/ files.
Types consumed (read-only):
  - src/transforms.ts:317      resolveLastTurn(messages, excludeToolCallId?)
  - src/markers.ts:58-66       RewindMarker.options { to_previous_prompt?; protect? }
  - src/tools/rewind.ts:438,596  resolveLastTurn(messages, toolCallId); payload.options = { protect }
NO config / database / routes changes.
```

---

## Validation Loop

> These commands are verified to exist and run in this repo (package.json scripts). Node >=22.19. The repo is ESM + vitest ^1 + typescript ^5.

### Level 1: Type-check (the gate that is currently RED — fix until green)

```bash
# Run after editing each file. Currently exits 2 with ~44 errors; target: exit 0.
npm run typecheck          # = tsc --noEmit (covers both src/ and test/)

# Faster iteration on a single file (tsc still compiles the whole project, errors are per-file):
npx tsc --noEmit 2>&1 | grep "test/" | head -40

# EXPECTED: zero "error TS" lines. The current errors you are eliminating are exclusively:
#   TS2554 "Expected 1-2 arguments, but got 3"   (3-arg resolveLastTurn calls — Pattern A)
#   TS2345 "Argument of type '{}' is not assignable to parameter of type 'string'"  (Pattern B)
#   TS2339 "Property 'to_previous_prompt' does not exist on type 'RewindArgs'"      (rewind.test.ts:859)
#   TS2353 "'to_previous_prompt' does not exist in type '...RewindArgs'"            (smoke.ts:119, edge 318/455)
```

### Level 2: Unit/component tests

```bash
# Per-file (run as you edit each):
npx vitest run test/transforms.test.ts
npx vitest run test/tools/rewind.test.ts
npx vitest run test/edge-cases.test.ts
npx vitest run test/markers.test.ts
npx vitest run test/tools/cancel.test.ts
# smoke.ts is a scenario LIB imported by run-smoke.mjs; it has no direct vitest tests, so typecheck is its gate.

# Full suite:
npm test            # = vitest run

# EXPECTED: all green. If a test fails, READ the assertion message — it is almost certainly a stale
# expectation (e.g. still expecting { to_previous_prompt: ... } or a nuclear remove set).
```

### Level 3: Integration / smoke harness (smoke.ts is exercised here)

```bash
# smoke.ts is imported by the runner; a broken export/type fails the build. After Task 4, confirm the
# scenario lib still type-checks and the runner still loads it:
npm run typecheck                                    # must include test/integration/smoke.ts cleanly
node test/integration/run-smoke.mjs --list 2>/dev/null || node -e "import('./test/integration/smoke.ts').catch(e=>console.log('smoke import err:',e.message))"
# If run-smoke supports a dry-run/--list flag use it; otherwise the typecheck above is the gate for smoke.ts.
# NOTE: actually executing run-smoke.mjs requires a live pi runtime and is out of scope for S4 (it is the
# Tier-2 harness). Green typecheck + green vitest is the S4 bar.
```

### Level 4: The grep gates (deterministic, zero-cost — run LAST)

```bash
# GATE 1: zero to_previous_prompt references anywhere in tests
grep -rn "to_previous_prompt" test/ ; echo "exit=$?"
# EXPECTED: no output, exit=1 (grep found nothing). If anything prints, you missed a line.

# GATE 2: zero "nuclear" references in tests (catches leftover comments/it-titles)
grep -rn "nuclear" test/ ; echo "exit=$?"
# EXPECTED: no output, exit=1.

# GATE 3: zero BUG-006 references (the BUG-006 test was nuclear-only)
grep -rn "BUG-006" test/ ; echo "exit=$?"
# EXPECTED: no output, exit=1. (src/ may still reference BUG-006 in changelog comments — that is fine; this gate is test/-only.)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` exits 0 (was: exit 2, ~44 errors).
- [ ] `npm test` is fully green (vitest run).
- [ ] Gate 1: `grep -rn "to_previous_prompt" test/` → 0 matches.
- [ ] Gate 2: `grep -rn "nuclear" test/` → 0 matches.
- [ ] Gate 3: `grep -rn "BUG-006" test/` → 0 matches.

### Feature Validation

- [ ] All 39 `to_previous_prompt` references removed (13+11+8+4+2+1 = 39).
- [ ] Every 3-arg `resolveLastTurn(msgs, {}, "id")` collapsed to `resolveLastTurn(msgs, "id")` (no "got 3 args" errors).
- [ ] Every 2-arg `resolveLastTurn(msgs, {})` reduced to `resolveLastTurn(msgs)` (no "not assignable to string" errors).
- [ ] Nuclear-mode `it(...)` blocks deleted (transforms: PINNED-contract nuclear its, nuclear-edge-cases describe, ascending-nuclear, malformed-opts; rewind: BUG-006, persisted-options-nuclear; edge-cases: 4 E3 nuclear its).
- [ ] New positive guardrail test present in `transforms.test.ts`: a `last_turn` rewind leaves the latest user message in the surviving tail.
- [ ] Persisted-options assertions/fixtures emit the canonical `{ protect: ["first:user","latest:user"] }` shape.

### Code Quality Validation

- [ ] No file under `src/`, `spec/`, `README.md`, `PRD.md`, `tasks.json`, `prd_snapshot.md` modified.
- [ ] `checkpoint` option and checkpoint-granularity tests left INTACT (owned by P1.M3 / P2 — out of scope).
- [ ] Deleted `it`/`describe` blocks removed cleanly (no dangling braces, no orphaned comments referencing removed tests).
- [ ] Surviving comments no longer reference "nuclear", "to_previous_prompt", or "BUG-006".

### Documentation & Deployment

- [ ] Mode A confirmed: no README/spec/doc changes (test-only). `grep -rn "to_previous_prompt" README.md spec/` is out of scope and expected to be unchanged.

---

## Anti-Patterns to Avoid

- ❌ **Don't** "drop the middle `{}` arg" of a 3-arg call and leave the string in slot 3 — that yields `resolveLastTurn(msgs, "REW", "REW")` (still 3 args) or `resolveLastTurn(msgs, undefined, "REW")`. COLLAPSE the string into slot 2. (Pattern A.)
- ❌ **Don't** convert nuclear refusal tests into "guardrail refusal" tests. The guardrail is enforced by construction, not by a refusal — there is no refusal to assert. Delete the nuclear test and add the POSITIVE guardrail test instead.
- ❌ **Don't** touch `checkpoint.test.ts`, `RewindArgs.checkpoint`, the `checkpoint` granularity, or the `mkRewind(..., { checkpoint })` paths. P1.M3 owns checkpoint-tool changes; S4 is strictly `to_previous_prompt`/nuclear.
- ❌ **Don't** edit any file under `src/`. S1/S2/S3 are complete and frozen for this subtask.
- ❌ **Don't** leave stale `toEqual({ to_previous_prompt: undefined, ... })` assertions just because vitest's toEqual would pass them — the grep gate and the contract require removal.
- ❌ **Don't** skip the `npm run typecheck` gate. vitest alone will NOT catch the `resolveLastTurn` arity/type errors as reliably as tsc; tsc is the authoritative red→green signal for this subtask.

---

## Confidence Score: 9/10

**Why 9, not 10**: The single residual uncertainty is the `smoke.ts` **F-protected** scenario (Task 4). The contract says "remove the F-protected nuclear scenario," but F-protected is also a named Tier-2 scenario in the spec (prd_snapshot h3.69). Two safe resolutions are given (repurpose to checkpoint-scope, or stub+log); the implementer must read `assertProtected()` to pick. Everything else is mechanical, line-pinned, before/after-specified, and verified against the live tree. The type-check + grep gates make success objectively verifiable.