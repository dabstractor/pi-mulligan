# Research Findings — P4.M1.T1.S1: RewindParams schema additions + REWIND_DESC update

## Scope (from item description — the CONTRACT)
Add two **optional** boolean fields to `RewindParams` (Type.Object in `src/tools/rewind.ts`),
append one sentence to `REWIND_DESC`, and add/update tests. The descriptions are VERBATIM from
spec/05 §1; the description-string update is VERBATIM from spec/05 §6 (line 320).

This is a **pure schema + LLM-facing-description** task. The actual revert *logic* (step 6b —
resolving snapshot handle, calling `store.restore`, folding results) is a LATER item
(P4.M2.T1), NOT this one. This item adds the two params to the schema so P4.M2.T1 can read
`params.revert_file_changes` / `params.delete_created_files` from `RewindArgs`.

## Files (the ONLY two touched)
1. `src/tools/rewind.ts` — add fields + append sentence.
2. `test/tools/rewind.test.ts` — update affected tests + add new ones.

No other file changes. `RewindArgs` is `Static<typeof RewindParams>`, so it auto-picks up the
new fields — no separate type edit needed.

## Current state (verified by reading the source)

### RewindParams (`src/tools/rewind.ts`, lines ~37–94)
Currently has: `note` (object), `granularity` (union of 3 literals), `checkpoint` (optional
string). The `checkpoint` field is the LAST property; the `Type.Object({...})` closes with
`});`. The new fields insert BEFORE that closing `});`.

### REWIND_DESC (`src/tools/rewind.ts`, line 126)
Currently (ENDS at "...from the user's last message."):
```
"Shed recent context you produced by mistake (a bloated tool result, or a whole wrong-direction turn) and leave yourself a note so you can try again with a clean view. The content is hidden from your context going forward (it stays on disk for the human). Costs only a short note. Use granularity 'last_tool_call_group' to undo just the last tool interaction, or 'last_turn' to redo the whole turn from the user's last message."
```

### IMPORTANT — append ONLY the revert sentence, NOT the full §6 string
spec/05 §6 (h3.43) gives the FULL v1.2 description, which ALSO contains a checkpoint sentence:
`granularity 'checkpoint' rewinds back to a checkpoint a user set — and may hide the user's
prompts after it (they consented by setting it).` That sentence is NOT in the current code and
is OUT OF SCOPE for this item. The item description is authoritative: append EXACTLY:
```
 Set revert_file_changes to also restore the working-tree files you modified, so you need not re-read them on resume (v1.2, opt-in, last_turn/checkpoint only).
```
(note the LEADING SPACE — separates it from the preceding sentence).

## config.revert dependency — CONFIRMED present
The description strings reference `config.revert` ("Requires revert to be enabled in config")
and `config.revert.allowDeleteCreatedFiles`. These are just TEXT in description strings — no
runtime dependency. But confirmed they exist: `src/config.ts` lines 82–116 (interface),
205–207 (defaults), 351–356 (validation). `allowDeleteCreatedFiles: false` default at line 207.
So the description text is accurate against the shipped config (P1.M1.T1 = Complete).

## Tests — affected existing tests + new tests

### AFFECTED (will FAIL after the append unless updated)
- `test/tools/rewind.test.ts` line 299: `it("description is the spec/05 §5 verbatim string")` —
  asserts the OLD REWIND_DESC. MUST be updated to the new string (append the sentence).

### NEW tests required (per item description)
1. RewindArgs type includes the two new optional fields —
   `expectTypeOf(args.revert_file_changes).toEqualTypeOf<boolean | undefined>()` (×2).
   Add to the existing RewindArgs type test (line 809) OR a new block.
2. Schema accepts `{note, granularity}` WITHOUT the new fields (backward-compat runtime) —
   call `run(pi, ctx, {note, granularity})` and assert a normal outcome.

## Test idiom (from test/tools/rewind.test.ts)
- vitest, hand-rolled `makePi()`/`makeCtx()` fakes (NO vi.fn()).
- `.js` import paths (Node ESM convention).
- `expectTypeOf` for type assertions; `clearAll()` + `setConfig(undefined)` in beforeEach/afterEach.
- `run(pi, ctx, params, toolCallId)` helper drives `makeRewindTool(pi).execute(...)`.
- VALID_NOTE constant + `firstText(res)` extractor.
- typebox `RewindParams.properties` is a plain object → `expect(RewindParams.properties).toHaveProperty(...)`.

## Parallel-execution context (P3.M2.T1.S1)
P3.M2.T1.S1 (checkpoint command step 4b — snapshot capture) is being implemented in parallel.
It is INDEPENDENT of this item: it touches `src/commands.ts` (the checkpoint command), this item
touches `src/tools/rewind.ts`. No conflict. This item is CONSUMED BY P4.M2.T1 (step 6b logic),
which reads `params.revert_file_changes` / `params.delete_created_files` from the schema added here.