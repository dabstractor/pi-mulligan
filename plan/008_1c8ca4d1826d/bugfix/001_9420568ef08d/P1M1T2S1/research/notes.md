# Research Notes — P1.M1.T2.S1 (bugfix changeset 001_9420568ef08d)

## Verified code facts (read directly from this worktree)

- `countRetriesAtLatestPrompt(ctx)` — src/tools/rewind.ts:~283-340. Module-local. Steps: try `ctx.sessionManager.getEntries()` (catch → 0); non-array → 0; find INDEX of LAST entry `type === "message" && message.role === "user"` (throwing-Proxy safe via try/catch per entry, structural casts `{type?, message?:{role?}}`); if -1 → 0; BUG-005 pass: collect `mulligan:cancel` `data.targetId`s from the post-prompt slice into `cancelledRewindIds` Set; then count post-prompt `mulligan:rewind` entries whose `data.id` is NOT in the set (unreadable id → counted).
- `countRewindMarkers(ctx)` — src/tools/rewind.ts:~218-266. Same cancel-exclusion pattern but branch-wide. JSDoc names the "BUG-004" exclusion.
- Cancel-exclusion polarity convention: "a rewind with an UNREADABLE data.id is COUNTED / KEPT — never exclude on bad data"; malformed cancel (non-string/empty targetId) skipped fail-open.
- `RewindMarker` (src/markers.ts:~50-85): `{ schema, v, kind:"rewind", id, granularity, ..., note: NoteInput, ledger, seq, ts }` — `note` is the raw NoteInput persisted into marker data. So `data.note.what_happened` exists on disk for every production rewind marker. (Contract's "markers.ts:80" ≈ this note field.)
- `NoteInput` (src/notes.ts:39): `{ what_happened: string; true_current_state: string; avoid: string; lesson: string; next?: string }` (spec/04 §2.1). BUG-002 spec text: "same what_happened after trim/lowercase — which now includes the avoid/lesson" → ONE field suffices.
- Test harness (test/tools/rewind.test.ts):
  - `makeCtx({entries})` ~:181 — builds `{sessionManager:{getEntries:()=>entries}}` cast to ExtensionContext; `makePi()` captures appended entries.
  - `run(pi, ctx, params, toolCallId="call-1")` ~:186 — invokes tool.execute.
  - `firstText(res)` ~:197 — narrows first content block to text.
  - Fixtures: `msgEntry(message)` :244, `user(text)` :289, `rewindEntry(seq)` :207 (data has NO note/id), `rewindEntryWithId(seq, id)` :211 (data has id+kind but NO note).
  - NoteInput is required in RewindParams — production markers always carry note; the OLD fixtures just never modeled it.
- Parallel item P1.M1.T1.S1 touches only REWIND_DESC/checkpoint-param strings + their test assertions — zero overlap with this helper.
- Test commands: `npm test` (vitest run), `npx tsc --noEmit`.

## Spec ground
- spec/08-edge-cases.md:117 (E22 advisory): "substantively identical notes (same `what_happened` after trim/lowercase…)" across TWO CONSECUTIVE rewinds re-landing at the same prompt. No new persistent state — derive from the entry stream each call.
- spec text for the advisory (consumed by P1.M1.T2.S2): "⚠ You have rewound with an identical note — the re-attempt is reproducing the mistake. Change approach or shrink the offending result rather than rewinding again."