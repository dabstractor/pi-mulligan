# Research Notes — P1.M3.T1.S2 (Tests: drop checkpoint-tool registration assertion + tool-count refs)

**Task**: After S1 (which unregisters `mulligan_checkpoint` from `src/index.ts`, dropping the agent-tool
count 5 → 4), update the tests that assert the registration state. The contract lists 5 candidate files;
a precise grep shows **only ONE actually needs edits** (`test/index.test.ts`).

---

## A. The contract's 5 candidate files — grep verdict per file

| File | Contract concern | Grep verdict | Action |
|---|---|---|---|
| `test/index.test.ts` | asserts 5 tools + names array w/ checkpoint + length===5 | **3 stale assertions** (lines 66, 72, 79) | **FIX** (the core deliverable) |
| `test/integration/smoke.ts` | imports makeCheckpointTool (line 40); calls it at 252, 268 (F-checkpoint) | imports the FACTORY directly (not via index.ts); NO "5 tools"/registration-count assertion | **NO-OP** (factory retained → calls still work) |
| `test/edge-cases.test.ts` | "5 tools" / checkpoint references | imports makeCheckpointTool/validCheckpointName DIRECTLY (line 45); tests the FACTORY (lines 668, 807); NO "5 tools"/registration-count assertion | **NO-OP** (factory tests, not registration tests) |
| `test/tools/audit.test.ts` | checkpoint-as-agent-tool references | line 198 is a COMMENT in a `checkpointEntry` fixture helper describing how checkpoints label distinct targets — NOT a checkpoint-as-agent-tool claim | **NO-OP** (fixture comment, accurate) |
| `test/tools/checkpoint.test.ts` | tests the checkpoint tool directly | tests the FACTORY (`makeCheckpointTool`); contract says LEAVE | **LEAVE** (factory retained) |

**CONCLUSION**: Only `test/index.test.ts` needs edits. The contract's own step (b) anticipates this for
smoke.ts ("it already does call the factory directly"), and steps (c)/(d) are explicitly conditional
("search for … and update" → the search finds nothing). The implementing agent must VERIFY this (don't
edit files that have no stale claim).

## B. The exact assertions to fix in `test/index.test.ts` (lines 66-80)

Current text (verified verbatim this session):
```ts
  it("registers all 5 tools with the exact names", () => {                          // line 66
    const { tools, pi } = makePi();
    indexFactory(pi);

    expect(tools).toHaveLength(5);                                                   // line 70
    expect(tools.map((t) => t.name).sort()).toEqual(                                // line 71
      ["mulligan_audit", "mulligan_cancel", "mulligan_checkpoint", "mulligan_rewind", "mulligan_shrink"].sort(),  // line 72
    );
  });

  it("does not register extra tools", () => {                                        // line 77
    const { tools, pi } = makePi();
    indexFactory(pi);
    expect(tools.length).toBe(5);                                                    // line 79
  });
```

**Three edits:**
1. **Line 66** test name: `"registers all 5 tools with the exact names"` → `"registers all 4 tools with the exact names"`.
2. **Line 70**: `expect(tools).toHaveLength(5)` → `expect(tools).toHaveLength(4)`.
3. **Line 72** names array: drop `"mulligan_checkpoint"` → `["mulligan_audit", "mulligan_cancel", "mulligan_rewind", "mulligan_shrink"]`.
4. **Line 79**: `expect(tools.length).toBe(5)` → `expect(tools.length).toBe(4)`.

That's it — 4 surgical edits in ONE test file. The factory (`makePi`/`indexFactory` helpers) and the test
structure are unchanged.

## C. Why the other 4 files are no-ops (verified)

### `test/integration/smoke.ts` — calls the factory directly
- Line 40: `import { makeCheckpointTool } from "../../src/tools/checkpoint.js";` — imports the FACTORY file,
  NOT via index.ts. S1 does NOT delete checkpoint.ts (Phase 2 reuse), so this import resolves fine.
- Lines 252, 268 (F-checkpoint / F-checkpoint-set scenarios): `const cpTool = makeCheckpointTool(pi);` then
  `await cpTool.execute(...)`. These construct the tool from the factory and call execute directly — they do
  NOT go through the extension's registration. So S1's registration removal does not affect them.
- **NO "5 tools" / `tools.length === 5` / registration-count assertion** exists in smoke.ts (grep confirms;
  the "registerTool"/"registerCommand" hits at lines 14/18/500/504/515/518 are the SMOKE HARNESS's OWN
  `mulligan_smoke_big` test tool + `/mulligan_smoke` command — unrelated to the agent-tool inventory).
- **Contract step (b) explicitly says**: "the F-checkpoint scenario calls `makeCheckpointTool(pi)` directly —
  this still works since the factory file is retained." → NO EDIT.

### `test/edge-cases.test.ts` — tests the factory, not registration
- Line 45: `import { makeCheckpointTool, validCheckpointName } from "../src/tools/checkpoint.js";` — factory import.
- Lines 668-672, 807-815: `makeCheckpointTool(pi)` constructed + execute called — FACTORY behavior tests
  (invalid name refusal; throwing-setLabel never-throws). Not registration tests.
- **NO "5 tools" / registration-count assertion** (grep confirms zero hits for `5 tools`, `tools.length`,
  `toBe(5)`, `toHaveLength(5)`, `registered`, `registerTool`).
- **NO EDIT.**

### `test/tools/audit.test.ts:198` — a fixture comment, not a claim
- Line 198 is inside the `checkpointEntry(name, targetId)` fixture helper's JSDoc: "…is current when
  mulligan_checkpoint runs, so two checkpoints have different targetIds." It describes how the LABEL fixture
  mirrors production label-setting — it is NOT a claim that checkpoint is a registered agent tool. The
  comment is accurate regardless of registration status (the factory still sets labels when called directly).
- **NO EDIT.** (If a maintainer wants to reword it for v1.1 clarity later, that's a separate nicety, not
  this task.)

### `test/tools/checkpoint.test.ts` — LEAVE (factory retained)
- The contract step (e) explicitly says: "Leave test/tools/checkpoint.test.ts in place (the factory still
  exports makeCheckpointTool — tests stay green)." The entire file tests the factory directly
  (`makeCheckpointTool(pi)`, name/label/description metadata, regex, disabled-refusal, never-throws). S1
  retains checkpoint.ts, so every test in this file still passes.
- **LEAVE.**

## D. The validation nuance — the suite goes RED→GREEN when S1+S2 both land

- S1 (index.ts) is being implemented in parallel. S1's edit makes `test/index.test.ts` RED (it asserts 5
  tools; now 4). S1 does NOT touch tests (its PRP explicitly gates on "the isolated index.test.ts failure
  is the S2 handoff").
- S2 (this task) fixes `test/index.test.ts` → the suite returns to GREEN.
- If S2 runs BEFORE S1 lands: `test/index.test.ts` will FAIL on the NEW 4-tool assertions (index.ts still
  registers 5). That's the inverse handoff — also expected. The two tasks are a red→green pair; order does
  not matter for correctness, only for which assertion direction is "red" at a given moment.
- **S2's gate**: after S2's edit (and assuming S1 landed), `npx vitest run test/index.test.ts` is GREEN
  (4 tools); `npm run typecheck` clean; full `npx vitest run` green.

## E. Scope discipline — what NOT to touch

- **`src/*`** → S1 owns index.ts; checkpoint.ts stays (Phase 2 reuse). READ-ONLY for S2.
- **`test/integration/smoke.ts`** → no stale assertion (factory called directly). NO-OP.
- **`test/edge-cases.test.ts`** → no stale assertion (factory tested directly). NO-OP.
- **`test/tools/audit.test.ts`** → line 198 is an accurate fixture comment. NO-OP.
- **`test/tools/checkpoint.test.ts`** → contract says LEAVE (factory retained).
- **`spec/*`** → READ-ONLY (spec/05 §3 is the authority; it already says REMOVED).
- **`test/integration/run-smoke.mjs`** → the grep hit at line 342 ("exactly 5 mulligan:rewind") is the
  F-maxdepth scenario (5 rewind markers, 6th refused) — UNRELATED to the agent-tool inventory. NO-OP.

## F. Validation gates (confirmed green at research time for the pre-change state)

- `npm run typecheck` (= `tsc --noEmit`): exits 0. Test edits use the same helpers; no type impact.
- `npx vitest run test/index.test.ts`: GREEN after S1+S2 both land (4 tools).
- `npx vitest run`: full suite green. (The other checkpoint-touching tests — smoke.ts, edge-cases.test.ts,
  checkpoint.test.ts — import the retained factory and are unaffected.)
- `grep -nE "5 tools|toHaveLength\(5\)|toBe\(5\)" test/index.test.ts`: after the edit, 0 hits.
- `grep -n "mulligan_checkpoint" test/index.test.ts`: after the edit, 0 hits.
- Scope guard: `git status --short` shows ONLY `test/index.test.ts`.

## G. Cross-references used

- `test/index.test.ts` — the single file to edit (lines 66, 70, 72, 79).
- `plan/007_67d7d8c6e4c5/P1M3T1S1/PRP.md` — S1 contract (unregisters checkpoint; index.ts registers 4 tools).
- `plan/007_67d7d8c6e4c5/architecture/change_surface.md §Change 1` — the authoritative test-touchpoint list
  (confirms index.test.ts is the fix; smoke.ts/edge-cases/checkpoint.test.ts/audit.test.ts are NO-OPs).
- spec/05-tools.md §3 (h2.58) — "mulligan_checkpoint — REMOVED as an agent tool (v1.1)".
- spec/08 E23 (h2.104) — "RESOLVED in v1.1" (checkpoint moved to human slash command).
- `src/tools/checkpoint.ts` — READ-ONLY; the retained factory (still exports makeCheckpointTool).