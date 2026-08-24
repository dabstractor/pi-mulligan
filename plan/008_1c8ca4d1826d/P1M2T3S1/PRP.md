# PRP — P1.M2.T3.S1: CancelParams two-arm union + CANCEL_DESC (drop by_content_includes)

## Goal

**Feature Goal**: Bring `mulligan_cancel`'s parameter schema into v2.0 lockstep with `mulligan_shrink` (P1.M2.T1.S1): `CancelParams.target` becomes the TWO-arm union (`by_tool_call_id` / `by_tool_name`+`occurrence`) — the legacy `by_content_includes` arm is removed from the SCHEMA — and `CANCEL_DESC` drops the content arm from its hint enumeration. All refusal/no-op/success texts, the markerId fallback wording, idempotency wording, and `prepareObjectArgs` wiring stay UNCHANGED.

**Deliverable**: Edited `src/tools/cancel.ts` only (schema + description strings + adjacent JSDoc comments), plus the two MINIMAL test alignments in `test/tools/cancel.test.ts` needed to keep `npm test` / `npm run typecheck` green (desc-string assertion + type casts). No behavior change to `cancelExecute` — the execute path already accepts `ShrinkTargetRead` (which still includes the legacy read arm), so runtime handling of legacy content-arm targets is unaffected; this is a schema/docs change.

**Success Definition**: `CancelParams.target` union has exactly 2 arms; `Static<typeof CancelParams>` (`CancelArgs["target"]`) no longer admits `{by_content_includes: string}`; the union description and `CANCEL_DESC` read exactly as specified below; `npm test`, `npm run typecheck`, `npm run lint` (if present) all green.

## Why

The v2.0 delta (R5) removes `by_content_includes` from the agent-facing write surface everywhere. `ShrinkParams` (src/tools/shrink.ts, P1.M2.T1.S1) is already 2-arm; `CancelParams` still has the 3-arm union. The parity is a HARD requirement documented in cancel.ts itself: S2 hands `params.target` to `resolveShrinkTarget` (transforms.ts, `ShrinkTargetRead`-typed), and the PRD §5 schema (normative two-arm form) specifies cancel keeps only the two shrink hint arms. The spec §5's cancel description STRING is stale (still lists the content arm) — do NOT copy it; the item description's exact wording below is normative (Mode A: `CANCEL_DESC` + union description ARE the LLM-facing docs and ride with this work).

## What

### Exact edits in `src/tools/cancel.ts`

1. **Remove the third arm** from the `Type.Union([...])` inside `CancelParams` (currently ~lines 105-109):
   ```ts
   Type.Object({
     by_content_includes: Type.String({
       description: "Match a marker whose affected message(s) include this substring.",
     }),
   }),
   ```
   Keep arms 1 (`by_tool_call_id`) and 2 (`by_tool_name` + `occurrence`) byte-identical.

2. **Replace the union `description`** with EXACTLY:
   > "How to identify the marker to cancel — the SAME (two-arm, v2.0) hint shape mulligan_shrink uses. Resolved live each turn (robust to compaction). The most recent active marker (shrink or rewind) whose target/span covers the matched message is retired."

   (Only difference from current: "the SAME hint shape" → "the SAME (two-arm, v2.0) hint shape".)

3. **CANCEL_DESC** (~line 140-148): change the hint-enumeration fragment from
   `"(same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — "`
   to
   `"(same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence) — "`.
   Every other sentence of CANCEL_DESC stays byte-identical (idempotency sentence "Cancelling a non-existent or already-cancelled marker is a safe no-op.", markerId fallback sentence, forward-only sentence — all unchanged).

4. **Update the surrounding JSDoc/comments only where they enumerate 3 arms**, so the file stays self-consistent:
   - The `CancelParams` doc comment (~lines 87-93) says "same 3 arms … (`by_tool_call_id` / `by_tool_name`+`occurrence` / `by_content_includes`)" → rewrite for the 2-arm v2.0 form, mirroring the style of ShrinkParams's comment in src/tools/shrink.ts (~lines 73-79, which lists the two arms with one-line semantics each).
   - The `makeCancelTool` comment mentions "the `target` union is STRUCTURALLY IDENTICAL" — still true (now to the 2-arm form); tweak if it enumerates arms.
   - Do NOT touch: the `markerId` field description, the outer object description ("At least one MUST be present"), the D1 both-Optional decision comment, `prepareArguments: prepareObjectArgs<CancelArgs>(["target"])` (line ~466 — markerId-only calls pass through untouched; this wiring is behavior-neutral), imports, `CancelDetails`, result builders, `cancelExecute`, `resolveTargetUuid` (takes `ShrinkTargetRead` — the write 2-arm type remains assignable to it, so the typecheck holds unchanged).

### Minimal test alignment in `test/tools/cancel.test.ts`

- **Line ~466**: the exact-`CANCEL_DESC` assertion includes `"or by_content_includes"` — update that expected-string fragment to the new enumeration (`"by_tool_call_id, by_tool_name+occurrence) — "`). Keep the rest of the assertion byte-exact.
- **Lines ~658-690** (cases (c) / (c-neg)): these call `run(pi, ctx, { target: { by_content_includes: "…" } })`. With the narrowed `CancelArgs`, they no longer typecheck. Keep the tests (they exercise the legacy READ path → resolver returns null → no-op, still valid runtime behavior via `ShrinkTargetRead`) but cast the target: `target: { by_content_includes: "ENOSPC" } as unknown as CancelArgs["target"]` (precedent: shrink.test.ts did exactly this during its transition). Update the case-(c) title/comment to note the write schema is now 2-arm and the runtime path is the legacy-read no-op (full rewrite is P1.M2.T4.S1 / P1.M4.T1.S2 — do NOT do that rewrite here).
- Add ONE new narrow assertion (cheap, locks this item's contract): a host-pipeline check that `{ target: { by_content_includes: "x" } }` now FAILS schema validation through the tool's real `prepareArguments` — reuse the `hostPipelinePasses` harness pattern from `test/prepare-args.test.ts` (~:42-54: structuredClone → prepareArguments → Value.Convert → `Compile(CancelParams).Check`), same approach P1.M2.T2.S1's PRP specifies for shrink. Also assert a well-formed 2-arm target PASSES. Keep it small (one `it` block); the full cancel test lock is P1.M2.T4.S1's job.

### Success Criteria

- [ ] `CancelParams.target` union contains exactly 2 arms; `grep -n "by_content_includes" src/tools/cancel.ts` matches ZERO occurrences (including comments).
- [ ] Union description and CANCEL_DESC match the strings above byte-exactly.
- [ ] `test/tools/cancel.test.ts` green including updated desc assertion, casted legacy cases, and the new schema-rejection `it`.
- [ ] `npm test` and `npm run typecheck` green.
- [ ] No changes to `cancelExecute`, `resolveTargetUuid`, result texts, markerId handling, or `prepareArguments` wiring.

## All Needed Context

### Context Completeness Check

An implementer who reads only this PRP + the two files below has everything: the exact strings, the exact arm to delete, the type-compatibility argument (2-arm write → `ShrinkTargetRead` param), and the two test touch-points.

### Documentation & References

```yaml
- file: src/tools/cancel.ts
  why: THE file being edited. CancelParams at ~:93-128 (3-arm union, content arm at ~:105-109); CANCEL_DESC at ~:140-148 (enumeration fragment at ~:144); 3-arm JSDoc at ~:87-93; makeCancelTool + prepareObjectArgs at ~:455-470
  pattern: typebox Type.Union arms with per-field description strings — the LLM reads these
  gotcha: keep both params Type.Optional (Decision D1 — markerId-only calls must stay schema-valid); keep all result builders / execute body untouched

- file: src/tools/shrink.ts
  why: THE parity reference — P1.M2.T1.S1 already landed the 2-arm ShrinkParams (:80-106) and its JSDoc (:73-79). Mirror the 2-arm comment style and arm ordering
  gotcha: shrink's union is REQUIRED, cancel's stays OPTIONAL — parity is arm-shape only, not requiredness

- file: src/transforms.ts
  why: ShrinkTargetRead (:787) — the READ-side union that still includes the legacy content arm; resolveTargetUuid's param type (:259). Explains why no execute-path change is needed: the 2-arm write type is assignable to ShrinkTargetRead
  gotcha: do NOT touch transforms.ts

- file: test/tools/cancel.test.ts
  why: desc-string assertion ~:466; legacy content-arm cases ~:658-690 (need `as unknown as CancelArgs["target"]` casts); harness makePi/makeCtx/run at top of file
  gotcha: hand-rolled fakes, NO vi.fn(); .js import paths

- file: test/prepare-args.test.ts
  why: hostPipelinePasses harness pattern (~:42-54) for the new schema-rejection assertion; note its exact typebox Value/Compile imports and mirror them

- file: plan/008_1c8ca4d1826d/P1M2T2S1/PRP.md
  why: PARALLEL work item (shrink test lock). It edits test/tools/shrink.test.ts ONLY — zero overlap with this item's files. Assume it lands as written
- file: plan/008_1c8ca4d1826d/P1M2T3.S2 (next item)
  why: covering-marker check upgrade (pinned identity etc.) — lands AFTER this. This item must not preempt or break its entry points (resolveTargetUuid signature unchanged)
```

### Known Gotchas

```ts
// CRITICAL: typebox Static narrows CancelArgs["target"] to 2 arms → test/tools/cancel.test.ts
// :668/:688 no longer typecheck without `as unknown as CancelArgs["target"]` casts.
// CRITICAL: The 2-arm write union must remain assignable to ShrinkTargetRead (transforms.ts :787)
//   — it is, by construction (Read = Write | legacyArm). resolveTargetUuid needs NO change.
// GOTCHA: spec/05 §6's cancel description string is STALE (still enumerates by_content_includes) —
//   the §5 two-arm schema + this PRP's exact strings are normative. Do not "fix" toward the spec §6 text.
// GOTCHA: prepareObjectArgs<CancelArgs>(["target"]) shim stays — some models send target as a JSON
//   string; removing the arm does not remove that failure class for the 2 live arms.
// GOTCHA: 'At least one of target/markerId' remains a NO-OP at runtime when neither is given —
//   enforced in cancelExecute, not the schema (D1/D2). No change here.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: EDIT src/tools/cancel.ts — CancelParams
  - DELETE the by_content_includes Type.Object arm (~:105-109)
  - REPLACE union description string (exact text above)
  - UPDATE the CancelParams JSDoc 3-arm enumeration → 2-arm (mirror shrink.ts :73-79 style)
  - PRESERVE: Type.Optional on target & markerId, markerId description, outer description, D1 comment

Task 2: EDIT src/tools/cancel.ts — CANCEL_DESC
  - DROP "or by_content_includes" from the enumeration fragment (~:144); everything else byte-identical
  - grep check: `grep -c by_content_includes src/tools/cancel.ts` → 0

Task 3: EDIT test/tools/cancel.test.ts (minimal alignment)
  - :466 expected CANCEL_DESC fragment updated to 2-arm enumeration
  - :668/:688 targets cast `as unknown as CancelArgs["target"]`; comment noting full rewrite is P1.M2.T4.S1
  - ADD one hostPipelinePasses-style schema-rejection `it` (content arm FAILS CancelParams validation
    through tool.prepareArguments; a 2-arm target PASSES) — mirror prepare-args.test.ts harness

Task 4: VALIDATE (see below), fix anything red
```

## Validation Loop

```bash
npx vitest run test/tools/cancel.test.ts   # all green, incl. new schema-rejection it
npm run typecheck                          # tsc --noEmit — catches the narrowed CancelArgs fallout
npm test                                   # full suite green (shrink suite owned by parallel P1.M2.T2.S1)
grep -c "by_content_includes" src/tools/cancel.ts   # → 0
```

## Final Validation Checklist

- [ ] 2-arm union, exact new description + CANCEL_DESC strings
- [ ] Zero `by_content_includes` in src/tools/cancel.ts (code AND comments)
- [ ] cancelExecute / resolveTargetUuid / result texts / prepareArguments untouched
- [ ] `npm test` + `npm run typecheck` green
- [ ] test/cancel cases (c)/(c-neg) still exercise the legacy-read no-op path via casts

## Anti-Patterns to Avoid

- ❌ Don't touch execute-path code, result strings, or the covering-marker logic — that's P1.M2.T3.S2
- ❌ Don't rewrite the cancel test suite — only the two alignments + one new `it` (P1.M2.T4.S1 owns the lock)
- ❌ Don't make `target` required or add config knobs
- ❌ Don't sync to spec §5's stale description string — this PRP's strings win

**Confidence Score: 9/10** — single-file schema/docs edit with exact normative strings, known test touch-points, and an established parity precedent (shrink.ts) already in the tree.