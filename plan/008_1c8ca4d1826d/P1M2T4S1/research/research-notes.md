# Research notes — P1.M2.T4.S1 (cancel test lock)

## Upstream contract (assume landed)
- **P1.M2.T3.S1 (Complete)**: `CancelParams` is the v2.0 TWO-arm union (`by_tool_call_id` | `by_tool_name+occurrence`); `CANCEL_DESC` at src/tools/cancel.ts:137-144 (already the 2-arm wording: "by_tool_call_id, by_tool_name+occurrence" — no `by_content_includes` mention). Test's verbatim assertion at test/tools/cancel.test.ts:464 must match this string.
- **P1.M2.T3.S2 (Implementing, treat as contract)**: `resolveTargetUuid` in src/tools/cancel.ts gains:
  - ONE fresh `ctx.sessionManager.getBranch() as unknown as BranchEntry[]` read inside its try (throw → catch → null, E13);
  - shrink covering arm → two-arm: `pinnedEntryId` non-empty string → identity compare `pinnedEntryId === matchedEntryId`; else `markerTurnSpan(messages, branchEntries, readOwn(e,"id"))` → spanned `resolveShrinkTarget(messages, target, span)`, null span → unspanned fallback;
  - `params.target` hint resolution stays FULL-HISTORY (no span arg);
  - rewind arm, LIFO by seq, markerId path, idempotency, texts unchanged.

## Test file facts (test/tools/cancel.test.ts)
- Fakes: `makePi()` captures appendEntry; `makeCtx({sessionId, leafId, entries, contextEntries, throwOnGetEntries, throwOnBuildContextEntries})`. **makeCtx currently LACKS `getBranch()`** — after T3.S2 lands, every target-path call reads it; a missing method throws inside the try → covering resolution dies. T3.S2's Task 4 says "add minimal getBranch if absent"; this item OWNS the final shape: add `branchEntries` option, default `[]`.
- `makeShrinkEntry(entryId, uuid, {seq, target})` — needs a `pinnedEntryId?` opt (item contract). `makeRewindEntry(entryId, uuid, {hideEntryIds, seq})`, `makeCancelEntry(targetId, seq)`.
- `msgEntry(role, extra)` builds `{type:"message", id:"e-N", message:{role,...extra}}` — `entrySeq` counter reset per-test by `resetSnapshotSeq()` in the S3 describe's beforeEach. Entry ids are `e-1`, `e-2`, … in contextEntries order.
- `toolResult(callId, toolName, text)` → `{role:"toolResult", toolCallId, toolName, content:[{type:"text",text}]}`.
- Existing target-path cases (a1)-(g-idempotent) at :591-~930; case (c)/(c-neg) at :682-:721 are already the interim "legacy READ no-op via cast" form marked "full rewrite: P1.M2.T4.S1".
- Host-validation pipeline test at :481 already exists ("legacy by_content_includes target FAILS CancelParams; 2-arm passes") using `Value.Convert` + `Compile(CancelParams).Check` — mirrors test/prepare-args.test.ts `hostPipelinePasses`.
- Marker-span live fallback tests need `branchEntries` fixture: root→leaf array of the SAME message-entry objects (yield 1) + the marker custom entries (yield 0) placed at the turn boundary. `markerTurnSpan` (src/transforms.ts:1247) walks the post-compaction tail, locates the marker by ENTRY id, computes `markerMsgPos`, then bounds `start`=last user msg before, `end`=first user msg at/after.
- Default `branchEntries: []` keeps ALL existing tests green: marker not found in branch → span null → unspanned fallback = old behavior.

## Line-number index into markerTurnSpan semantics for fixtures
- No compaction → tail = whole branch, tailStartIdx 0.
- Marker entry is custom (yield 0) → sits at a message BOUNDARY, not an index.
- Span end = index of first user message at/after the marker boundary (or messages.length).
- messages must be the SAME snapshot the tool flattens from contextEntries (1:1, each msgEntry yields exactly 1 message).

## Validation commands
- `npx vitest run test/tools/cancel.test.ts` — primary gate (item OUTPUT).
- `npm test`, `npm run typecheck` — no regressions.