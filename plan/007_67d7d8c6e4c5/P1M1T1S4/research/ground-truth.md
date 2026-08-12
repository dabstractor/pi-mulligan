# Research Notes — P1.M1.T1.S4 (Tests for to_previous_prompt removal)

Ground-truth findings, verified against the live tree at research time. Line numbers
match `architecture/change_surface.md §Change 2` EXACTLY (test files unedited since).

## 1. Premise CONFIRMED: the test suite is currently RED

`tsc --noEmit` exits 2 with **44 errors** (counted via `grep -c "error TS"`). Root causes,
all introduced by the already-complete sibling subtasks S1/S2/S3:

- S1 changed `resolveLastTurn`'s 2nd positional arg from an `opts` object to a `string`
  (`excludeToolCallId`). So every old call `resolveLastTurn(msgs, {})` is now
  `TS2345 "Argument of type '{}' is not assignable to parameter of type 'string'"`, and every
  `resolveLastTurn(msgs, {}, "ID")` is `TS2554 "Expected 1-2 arguments, but got 3"`.
- S2 removed `to_previous_prompt` from `RewindParams` → `TS2339`/`TS2353` wherever tests pass it.
- S2 removed the BUG-006 refusal block; the BUG-006 test's premise is dead.

This means S4 is not "nice to have" — it unblocks the build.

## 2. Occurrence count CONFIRMED: exactly 39

`grep -rcn "to_previous_prompt" test/ | grep -v ":0"`:
- test/transforms.test.ts:13
- test/tools/rewind.test.ts:11
- test/edge-cases.test.ts:8
- test/integration/smoke.ts:4
- test/markers.test.ts:2
- test/tools/cancel.test.ts:1
Total = 39. ✓

The contract's per-file line numbers (549,550,556,... / 442,447,456,... / 318,408,... /
110,119,233,236 / 122,175 / 171) were each spot-checked against the live file and MATCH.

## 3. The NEW contracts (consumed read-only by S4)

### resolveLastTurn (src/transforms.ts:317-357)
```ts
export function resolveLastTurn(
  messages: MessageLike[],
  excludeToolCallId?: string,
): { remove: number[] }
```
Body: find `iLastUser` (last `user` message); if none → `{remove:[]}`. Loop `j = iLastUser+1 ..
end`, pushing `j` to `remove` EXCEPT the rewind's own unit (when `excludeToolCallId` is a non-empty
string matching a toolGroup) and `mulligan:*` custom messages. **`iLastUser` is never pushed** →
the v1.1 guardrail holds by construction. NO opts param, NO nuclear branch, NO third param.

### rewind.ts (S2)
- line 438: `remove = resolveLastTurn(messages, toolCallId).remove;` (2-arg)
- line 596: `options: { protect: config.rewind.protectedRoles },` — the ONLY key emitted. No
  `to_previous_prompt`, no BUG-006 refusal block.

### RewindMarker.options (src/markers.ts:58-66) — S3
```ts
options: {
  to_previous_prompt?: boolean;   // Legacy v1.0 field; ignored by v1.1 resolver. Optional.
  protect?: string[];             // Role list that must not be crossed.
}
```
IMPLICATION: a hand-built persisted-marker fixture (cancel.test.ts:171, markers REWIND_DATA)
that writes `to_previous_prompt` still TYPE-CHECKS. It must still be edited (grep gate + canonical
shape). Also: vitest `toEqual` ignores `undefined`, so stale
`toEqual({ to_previous_prompt: undefined, protect:[...] })` may PASS at runtime but must be cleaned
(grep gate demands 0 references).

## 4. Canonical persisted-options shape to assert
`config.rewind.protectedRoles` default = `["first:user", "latest:user"]` (taken from existing
PASSING assertions in rewind.test.ts:529/585 and edge-cases.test.ts fixtures). So the canonical
post-v1.1 marker `options` = `{ protect: ["first:user", "latest:user"] }`.

## 5. The transformation taxonomy (what each of the 39 edits is)
- **Pattern A — COLLAPSE 3→2 args** (string moves to slot 2): transforms ~567,578,640,641,649,
  963; edge-cases:629. e.g. `resolveLastTurn(msgs, {}, "REW")` → `resolveLastTurn(msgs, "REW")`.
- **Pattern B — drop empty opts** (`{}` → nothing): transforms ~545,589,597,606,613,619,632,679,
  680,681,696,698,707,708,715,716. e.g. `resolveLastTurn(msgs, {})` → `resolveLastTurn(msgs)`.
- **Pattern C — DELETE nuclear line/block** (can't be salvaged): transforms 549-556, 614, 621,
  653-675 (nuclear describe), 685-688 (malformed-opts), 721-725 (ascending-nuclear), 730, 731,
  pipeline 1384-1393; rewind 442-457 (BUG-006), 568-586 (persisted-options-nuclear), 859 (type);
  edge-cases 408-419, 434-446, 448-466; smoke 232-242 (F-protected nuclear drive), 110+119
  (rewindNow opts shape).
- **Pattern D — clean persisted-options** (`{ to_previous_prompt: ..., protect }` → `{ protect }`):
  rewind 529; markers 122 + 175; cancel 171.
- **Pattern E — ADD** (1 new test): positive guardrail in transforms.test.ts.

## 6. Scope guardrails (do NOT touch)
- `checkpoint` option in RewindArgs stays. `args.checkpoint` type assertion (rewind.test.ts:860)
  stays. `rewindParams({ checkpoint })` / `rewindNow(..., { checkpoint })` stay.
- `checkpoint.test.ts`, `audit.test.ts`, `shrink.test.ts`, all non-nuclear `protectedOk` tests
  (edge-cases ~421-432), and every other test file = untouched.
- No `src/`, `spec/`, `README.md`, `PRD.md`, `tasks.json`, `prd_snapshot.md` changes.

## 7. Validation commands (verified present in package.json)
- `npm run typecheck` = `tsc --noEmit` (the authoritative red→green gate; currently exit 2).
- `npm test` = `vitest run`.
- Gates: `grep -rn "to_previous_prompt" test/`, `grep -rn "nuclear" test/`, `grep -rn "BUG-006" test/`
  must all return 0 matches (exit 1).

## 8. Residual risk (confidence 9/10)
The smoke.ts F-protected scenario (Task 4) has two valid resolutions; the implementer must read
`assertProtected()` to choose (repurpose to checkpoint-scope refusal, or stub+log). Everything
else is mechanical and line-pinned.