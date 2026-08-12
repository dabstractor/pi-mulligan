# Research Notes — P1.M2.T1.S2

**Work item**: Update cross-reload integration test to verify production rebuild path
(remove manual simulation). BUG-002 test conversion + helper extraction.

## The core decision: Approach (a) — extract a shared exported helper

The item_description offers two paths. **(a) wins decisively** because of an exact
codebase precedent.

### The precedent: `gcTurnSnapshots` (src/capture.ts:59)

`gcTurnSnapshots(rt: SessionRuntime)` is an **exported** helper in `capture.ts` that is:
- Called by `session_start` in `index.ts:125` (`await gcTurnSnapshots(rt)`)
- Called directly by the integration test (`test/integration/revert-edge.test.ts:54` imports it, `:600` calls it)
- Unit-tested in its own `describe("gcTurnSnapshots — shared prompt-boundary GC helper")` block in `test/capture.test.ts:371-452`

`rebuildCheckpointSnapshots(ctx, rt)` is the **identical pattern** for the BUG-002 rebuild:
it needs the same dual caller shape (production `session_start` + the test). S1
(P1.M2.T1.S1) implemented the rebuild **inline** in index.ts session_start per its PRP
("NO other file is touched"). S2's job is to **extract** that inline block into the same
exported-helper shape, so the test calls the SAME production code instead of a replica.

Approach (b) (replicate inline, flip the comment) is rejected: it is *still* manual
simulation, just relabeled. The task TITLE is "verify production rebuild path (REMOVE
manual simulation)" — only (a) removes it.

## Helper signature

```ts
export async function rebuildCheckpointSnapshots(
  ctx: ExtensionContext,
  rt: SessionRuntime,
): Promise<void>
```

- Takes `ctx` (unlike gcTurnSnapshots) because it must read `ctx.sessionManager.getEntries()`.
- Takes `rt` for `rt.store.has(ref)` (the optional verify) + `rt.snapshots.set(...)`.
- Both types are **already imported** in capture.ts (`ExtensionContext`, `SessionRuntime`).
- Returns void, never throws (fail-open; the defensive entry-scan idiom from
  `clearCheckpointByName` lives INSIDE, with per-entry try/catch + the outer guard).

The body = S1's inline rebuild moved verbatim (the Array.isArray + per-entry object guard
+ customType filter + typeof field guards + `has()` verify + `rt.snapshots?.set(...)`).

## Test-fake equivalence (critical correctness proof)

`makeSessionCtx` (revert-edge.test.ts:~206-248) returns `appended: entries` where `entries`
is the SHARED mutable array; `sessionManager.getEntries()` returns the SAME `entries`. The
current manual rebuild iterates `appended`; the helper will iterate
`ctx.sessionManager.getEntries()` → **identical data**. So replacing the manual loop with
`await rebuildCheckpointSnapshots(ctx, rt2)` is behavior-equivalent AND now exercises the
production code path.

The control entry shape produced by `makeCheckpointCommand` (via `pi.appendEntry`):
`{ type: "custom", id: "e-N", customType: "mulligan:revert-checkpoint",
   data: { label: "ckpt:x", ref: R0, backend: "git" } }` — matches exactly what the helper
expects (`type==="custom" && customType==="mulligan:revert-checkpoint"` → data.label/ref/backend).

## Files in scope (approach (a))

1. **src/capture.ts** — ADD `rebuildCheckpointSnapshots` (exported helper + JSDoc). No new imports.
2. **src/index.ts** — REFACTOR: replace S1's inline rebuild with `await rebuildCheckpointSnapshots(ctx, rt)`;
   add `rebuildCheckpointSnapshots` to the capture.ts import block (line ~16). Behavior-preserving.
3. **test/integration/revert-edge.test.ts** — CONVERT: remove the manual rebuild block
   (~lines 601-619), call `await rebuildCheckpointSnapshots(ctx, rt2)` instead, flip the
   comment from "production NEVER does this" → "production DOES this (BUG-002 fixed)".
   Add `rebuildCheckpointSnapshots` to the capture.ts import (line ~54).
4. **test/capture.test.ts** — RECOMMENDED: add a `describe("rebuildCheckpointSnapshots")` unit-test
   block mirroring the gcTurnSnapshots unit tests (happy-path, no-store no-op, malformed entry
   skipped, has()===false skipped, throwing-Proxy entry skipped). This is the direct precedent.

## The block to REMOVE in the test (verbatim, ~lines 601-619)

```ts
    // REBUILD rt2.snapshots from the persisted mulligan:revert-checkpoint control entries. Production NEVER does
    // this read-side — it is the BUG-002 gap tracked by P1.M2.T1: a future session_start hook will scan the
    // mulligan:revert-checkpoint entries and rebuild rt.snapshots ...
    const controlEntries = (appended as unknown[]).filter(...);
    for (const ce of controlEntries) {
      rt2.snapshots!.set(ce.data.label, { label: ..., backend: ..., beforeRef: ..., turnIndex: -1, ts: Date.now() });
    }

    // ASSERT the rebuilt snapshot restored ckpt:x's beforeRef === R0.
    const rebuiltCkpt = rt2.snapshots?.get("ckpt:x") as RevertCheckpoint | undefined;
    expect(rebuiltCkpt).toBeTruthy();
    expect(rebuiltCkpt!.beforeRef).toBe(R0);
    expect(rebuiltCkpt!.backend).toBe("git");
```

## Dependency & ordering

S2 DEPENDS on S1 being implemented first (S1's inline rebuild must exist before extraction).
S2 is a behavior-preserving refactor of S1's freshly-written code + the test conversion.
S1's PRP GOTCHA #4 explicitly defers this conversion to S2.

## Validation gates (verified)

- `npm run typecheck` = `tsc --noEmit` (strict)
- `npm test` = `vitest run`
- Targeted: `npx vitest run test/integration/revert-edge.test.ts`
- NO ruff/mypy/eslint (those are Python/template — do NOT apply).

## Key references gathered

- src/capture.ts:59 (gcTurnSnapshots — the precedent to mirror)
- src/capture.ts imports (ExtensionContext, SessionRuntime already present)
- src/index.ts:113-126 (session_start revert block — the inline rebuild lives here post-S1)
- src/index.ts:16 (capture.ts import block)
- src/markers.ts:121 (RevertCheckpoint interface)
- src/runtime.ts:123,132 (snapshots?, store?)
- test/integration/revert-edge.test.ts:52-55 (capture.ts imports), :601-619 (block to remove),
  :206-248 (makeSessionCtx — shared-array proof)
- test/capture.test.ts:371-452 (gcTurnSnapshots unit-test block — the precedent for the new tests)
- plan/.../P1M2T1S1/PRP.md (S1's inline implementation — the code to extract)
- plan/.../architecture/bug_fix_analysis.md §BUG-002 (root cause + "Existing Test Impact")