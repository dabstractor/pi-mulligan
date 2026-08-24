# Research — P1.M4.T1.S1 test sweep (transforms / markers / prepare-args / edge-cases)

Verified state of the working tree (all line numbers from `grep -n`):

## Current `by_content_includes` occurrences in the four target files

- `test/transforms.test.ts`
  - :1037 — applyShrink no-op assertion (already v2.0 no-op expectation, but uses the legacy literal)
  - :1072-1079 — two legacy no-op tests (P1.M1.T3.S1 rewrites, still use the literal)
  - :1095, :1096 — resolver direct null assertions
  - :1119, :1120, :1123, :1124, :1127, :1128 — E13 throwing-Proxy / BUG-004 empty-needle assertions
  - :2424 (comment), :2473-2476 + block (d) 2473-2481 — v2.0 span-semantics describe block, legacy→null-always lock (typed via ShrinkTargetRead)
- `test/markers.test.ts` :541,:548,:549,:553 — already the intended LEGACY-READ fixture ("ShrinkTarget is the 2-arm write union; ShrinkTargetRead adds the legacy arm"). Test title already updated (no "3-arm" text remains in markers.test.ts).
- `test/prepare-args.test.ts` :153 — it.each row `['{"by_content_includes": "pclntab"}', false]`; :11 comment `"must be object" ×3`.
- `test/edge-cases.test.ts` — E19 describe at :992: user shrink :1001, assistant shrink :1009, filterPipeline E19 :1019, immutability (a) :1036, (b) :1046, (c) :1058 (7 occurrences).

## Type/source facts

- `src/transforms.ts` :771-807, :875 — `ShrinkTarget` is the 2-arm WRITE union; `ShrinkTargetRead` (markers.ts :107-130, transforms.ts :782-793) adds the deprecated `{ by_content_includes: string }` arm for READ sites (persisted v1.x markers).
- resolver: legacy content-only target → falls through to null → no-op everywhere (P1.M1.T1.S2).
- prepare-args it.each table: rows are `[targetJson, shouldPass]` run through `hostPipelinePasses(ShrinkParams, {target: targetJson, replacement:"r"}, tool.prepareArguments)`. ShrinkParams has exactly 2 arms (P1.M2.T1.S1) — a `{"by_tool_call_id": ...}` JSON string row passes (true); a non-matching object fails.

## Conventions (from architecture/_scouts/tests.md §1)

- vitest; no vi.fn() except filter.test.ts; `.js` imports; `clearAll()` reset only needed in tools tests (none here except edge-cases filterPipeline usage — edge-cases currently does NOT call clearAll; filterPipeline is pure).
- Message factories per file: `user(text)`, `asst(callId)`, `asstText(text)`, `result(callId)`, `toolResult(callId, toolName, text)`, `custom(type)`; `expectPairingInvariant`; `stampShrink` import for render-stamp comparisons.
- Test command: `npx vitest run test/transforms.test.ts test/markers.test.ts test/prepare-args.test.ts test/edge-cases.test.ts` (vitest ^1, package.json:52; script `test: vitest run`).

## Grep gate

`grep -rn by_content_includes test/transforms.test.ts test/markers.test.ts test/prepare-args.test.ts test/edge-cases.test.ts`
must show hits ONLY in markers.test.ts after the sweep. Comments count — comment text mentioning the literal must be reworded/removed in the other three files.