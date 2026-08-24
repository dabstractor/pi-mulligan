# Research notes — P1.M2.T3.S1 (CancelParams two-arm union)

## Verified codebase state (src/tools/cancel.ts, read directly)

- `CancelParams` at ~:93-128: `Type.Optional(Type.Union([...]))` with 3 arms; the `by_content_includes` arm is the third `Type.Object` at ~:105-109.
- Union description at ~:111-113 currently reads "the SAME hint shape mulligan_shrink uses…" — needs the "(two-arm, v2.0)" insertion per the item's exact string.
- `CANCEL_DESC` at ~:140-148; the enumeration fragment `"… by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — "` is at ~:144.
- `makeCancelTool` at ~:455-470 wires `prepareArguments: prepareObjectArgs<CancelArgs>(["target"])` — must stay; markerId-only calls pass through untouched.
- `resolveTargetUuid(pi, ctx, target: ShrinkTargetRead, …)` at ~:259 — takes the READ-side union (transforms.ts:787, still includes the legacy content arm), so the narrowed 2-arm write type remains assignable; NO execute-path change needed.

## Parity precedent (src/tools/shrink.ts, P1.M2.T1.S1 landed)

- `ShrinkParams` at :80-106 is already the 2-arm union (required, unlike cancel's optional); JSDoc at :73-79 lists the two arms with one-line semantics — mirror this comment style in cancel.ts.
- `SHRINK_DESC` at :119-123 reworded for v2.0; note "the spec §5/§6 description strings are INTERNALLY STALE" — same applies to cancel; the item's exact strings are normative.

## Test touch-points (test/tools/cancel.test.ts)

- :466 — exact-`CANCEL_DESC` assertion contains "or by_content_includes" → must be updated in lockstep.
- :658-690 — cases (c)/(c-neg) call `run(pi, ctx, { target: { by_content_includes: … } })` → will no longer typecheck against narrowed `CancelArgs`; fix with `as unknown as CancelArgs["target"]` casts (shrink.test.ts precedent), full rewrite deferred to P1.M2.T4.S1.
- `hostPipelinePasses` harness pattern for schema-rejection lives in test/prepare-args.test.ts ~:42-54.

## Validation commands (verified in package.json)

- `npm test` = `vitest run`; `npm run typecheck` = `tsc --noEmit`.