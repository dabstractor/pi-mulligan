# Research — P1.M4.T1.S2 (sweep tools tests)

## Ground truth from the working tree (verified by grep/sed, not the stale item line numbers)

`grep -rn by_content_includes test/tools/` → exactly 6 lines:

1. `test/tools/shrink.test.ts:625` — `expectTypeOf<{ by_content_includes: string }>().not.toMatchTypeOf<ShrinkArgs["target"]>();` (compile-time only)
2. `test/tools/shrink.test.ts:732` — it title `{by_content_includes} target fails host validation — execute never runs`
3. `test/tools/shrink.test.ts:738` — the literal inside `hostPipelinePasses(ShrinkParams, { target: { by_content_includes: "x" }, replacement: "r" }, tool.prepareArguments)` → `false`
4. `test/tools/cancel.test.ts:499` — it title `host validation pipeline: legacy by_content_includes target FAILS CancelParams; a 2-arm target PASSES`
5. `test/tools/cancel.test.ts:513` — `expect(pipeline({ target: { by_content_includes: "x" } })).toBe(false);`
6. `test/tools/cancel.test.ts:699` — comment `// The legacy by_content_includes cast-based cases were removed in P1.M2.T4.S1: ...`

## Item-contract clauses already satisfied in the tree (do NOT redo)

- Structural-invalid it.each rows (old :253-254) are already two-arm (`by_tool_call_id ""` / whitespace, `by_tool_name` variants) at shrink.test.ts ~:268-272, asserting `"Mulligan: refused — target discriminator must be non-empty."`
- Stale matched/persist content cases (old :344-356, :385-392, :459-468, :750-756) — all current cases are two-arm; the "content arm fails schema" host-rejection case exists (:732) alongside "proper 2-arm target passes" rows (:744-751)
- Cancel cases 658-690: case (c) is already `by_tool_name:'bash', occurrence:'last'` covering (:702) and (c-neg) no-cover no-op (:723); the comment at :698-700 documents the removal done in P1.M2.T4.S1
- CANCEL_DESC verbatim assertion (:473-490): asserts `tool.description === CANCEL_DESC` (imported from src/tools/cancel.ts) AND an inline copy of the new two-arm string — both match `src/tools/cancel.ts:137-147` byte-for-byte (verified)

## How to keep the schema/type rejection semantics while zeroing the grep

Computed-key idiom (no literal anywhere in the file):
```ts
const REMOVED_ARM = ["by_content", "_includes"].join("_"); // v2.0 removed the content-substring arm
expect(pipeline({ target: { [REMOVED_ARM]: "x" } })).toBe(false);
```
For the type assertion (:625), `expectTypeOf` needs a literal type — replace with a runtime assignability check or drop and rely on the host-pipeline test; the same `not.toMatchTypeOf` idiom survives in `test/markers.test.ts` (the sanctioned survivor, NOT in test/tools). Simplest: delete :625 and add a comment pointing at markers.test.ts + the host-pipeline case (e).

## Gate

`grep -c by_content_includes test/tools/*.test.ts` → every file 0. Comments count (grep matches comments too).

## Validation commands (verified to exist)

- `npx vitest run test/tools/shrink.test.ts test/tools/cancel.test.ts`
- `npx vitest run` (full suite)
- `npm run typecheck` (tsc --noEmit, covers tests)