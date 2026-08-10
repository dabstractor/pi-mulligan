# Verification Findings — P1.M3.T1.S1 (Checkpoint consumption hook in rewind.ts)

**Task**: Add a checkpoint **consumption hook** in `src/tools/rewind.ts` `rewindExecute`: after a
successful checkpoint-granularity rewind persist (step 7) and before the success return (step 9),
scan for the consumed checkpoint's `LabelEntry`, read its `targetId`, and call
`pi.setLabel(targetId, undefined)` to clear the label. This retires the checkpoint so `mulligan_audit`
no longer lists it and a second rewind to the same name refuses "not found". E13-wrapped (a label-clear
failure must never undo the rewind). Mode A inline comment cites spec/05 §3 step 5.

Ground truth read: `src/tools/rewind.ts` (rewindExecute body, checkpointExists:~293, persist step 7,
return step 9, makeRewindTool closure), `src/tools/audit.ts` (listCheckpoints:324), `src/markers.ts`
(setCheckpoint:433 — the pi.setLabel precedent), `test/tools/rewind.test.ts` (makePi/makeCtx +
checkpointLabelEntry:192 + the existing checkpoint success test:340), `spec/05-tools.md` (§3 step 5:182),
`plan/005_95d30743cdd4/architecture/m3_checkpoint_expiry.md`.

---

## A. THE EXACT INSERTION POINT (rewindExecute, src/tools/rewind.ts)

The execute body is one big try/catch (E13). The numbered steps in order:
- (1) config gate · (2) note validation · (3) checkpoint existence · (4) depth guard · (4b) retry budget ·
  (4c) context-fraction stop · (5) resolvePreview (ledger/K/hideEntryIds) · (6) renderNote ·
  **(7) persist** · (8) mutation warning · (9) success return.

Step 7 (the persist) ends with:
```ts
    const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput); // cast: frozen type omits checkpoint
    leaveNote(pi, rendered, markerId ?? toolCallId); // GOTCHA #10: entry id; fallback toolCallId
```
**INSERT the consumption hook (call it step 7b) immediately AFTER `leaveNote(...)` and BEFORE the
step 8 `hasWarning` line** (`// (8) mutation warning (step 7 / E5) ...`). Step 8/9 compute from
`ledger`/`k`/`hasWarning`/`granularity` — none affected by the consumption — so insertion is safe.

## B. THE SCAN + CLEAR (verified API)

- **LabelEntry shape** (pi-coding-agent `session-manager.d.ts`): `{ type:"label", targetId:string,
  label:string|undefined } extends SessionEntryBase`. The matching entry has `type==="label"` &&
`label===\`mulligan:checkpoint:${name}\``; its `targetId` is what `pi.setLabel` needs.
- **`pi.setLabel(entryId, label)` signature** (`types.d.ts:942`): `setLabel(entryId: string, label:
  string | undefined): void`. Passing `undefined` CLEARS the label. Precedent: markers.ts `setCheckpoint`
  (line ~462) calls `pi.setLabel(stableId, \`mulligan:checkpoint:${name}\`)` to SET; we pass `undefined`
  to CLEAR.
- **rewind.ts does NOT import `readOwn`/`isRecord`** — its own scanners (`checkpointExists`:~293,
  `countRewindMarkers`, `countRetriesAtLatestPrompt`) use **defensive inline `(e as {type?:unknown})`
  casts with a per-entry try/catch**. Contract step 3 says: "Use the existing readOwn helper in rewind.ts
  (if rewind.ts doesn't have one, it has checkpointExists which reads entries defensively — follow the
  same defensive pattern)." → rewind.ts has NO readOwn → **mirror checkpointExists's inline-cast style**
  (do NOT import readOwn from audit/transforms — keep the file's existing idiom; consistency > DRY here).

## C. DOWNSTREAM EFFECT (verified — why clearing works)

| Consumer | Before clear | After `setLabel(targetId, undefined)` |
|---|---|---|
| `audit.ts:listCheckpoints` (324) | lists `mulligan:checkpoint:` labels | SKIPS — `typeof label !== "string"` guard (line: `if (typeof label !== "string") continue;`) → name drops |
| `rewind.ts:checkpointExists` (293) | returns true | returns false — `label === needle` no longer matches (label is now undefined) → step 3 refuses `checkpoint '<name>' not found on this branch` |
| `checkpoint.ts` (re-create) | sets fresh label | works normally — `setCheckpoint` calls `pi.setLabel` unconditionally |

So clearing naturally drops the checkpoint from the audit AND makes a second rewind refuse "not found",
with NO changes needed in audit.ts / checkpoint.ts / checkpointExists. The hook is the single source.

## D. `pi` AVAILABILITY (verified)

`pi` is captured via the `makeRewindTool(pi)` factory closure (rewind.ts:~592) and passed to
`rewindExecute(pi, toolCallId, params, signal, onUpdate, ctx)` as its FIRST arg. It is ALREADY used in
step 7 (`appendRewindMarker(pi, ctx, …)` + `leaveNote(pi, …)`). So `pi.setLabel(targetId, undefined)`
is a direct call — no plumbing. (Contrast: `ctx.sessionManager` is READ-ONLY [C1] — labels are written
through `pi`, read through `ctx.sessionManager`. setCheckpoint follows the same C1/C9 split.)

## E. E13 WRAPPING (critical — the one real failure mode)

rewindExecute's whole body is in ONE try/catch (site 9) that returns `refusal("unexpected error: …")`
on ANY exception. If the consumption hook throws and is NOT locally caught, that throw propagates to the
outer catch → the rewind (which ALREADY succeeded — marker persisted at step 7) is retroactively
reported as an "unexpected error" REFUSAL. **That inverts a success into a failure** — exactly what
E13 forbids. **THEREFORE the consumption hook MUST be wrapped in its OWN try/catch that swallows**
(so the step 9 success return proceeds regardless). This is the contract's explicit E13 requirement:
"a label-clear failure must never undo the rewind; the rewind marker is already persisted."

## F. TEST HARNESS (for S2 — NOT this task; context only)

- `makePi()` (rewind.test.ts:62) returns `{ appended, sent, labels, pi }` where `labels:
  { entryId: string; label: string|undefined }[]` captures every `pi.setLabel` call, and `throwOnSetLabel`
  simulates a Pi failure. **It already captures setLabel — S2 needs no harness change.**
- `makeCtx()` scripts `getEntries()` (incl. label entries) + `getBranch()` + `buildContextEntries()`.
- `checkpointLabelEntry(name, targetId="leaf-1")` (rewind.test.ts:192) returns
  `{ type:"label", targetId, label:\`mulligan:checkpoint:${name}\` }` — the reusable LabelEntry fixture.
- **Existing checkpoint success-path test** (rewind.test.ts:340 "a checkpoint that EXISTS → proceeds")
  uses `checkpointLabelEntry("anchor")` and asserts on `appended`/`sent`/text — it does NOT assert on
  `labels`. **Therefore the new `setLabel` call on that path is NON-BREAKING** (grep confirms no
  existing rewind test asserts `labels.length`/`labels[0]`). The full suite stays green (21 files).

## G. SCOPE FENCE
- EDIT: `src/tools/rewind.ts` ONLY (add step 7b consumption hook + Mode A inline comment).
- DO NOT write tests (sibling P1.M3.T1.S2 — "Tests for checkpoint consumption").
- DO NOT edit audit.ts, markers.ts, checkpoint.ts, spec/*, index.ts, transforms.ts.
- The hook fires ONLY on `granularity === "checkpoint"` (guarded by `if`). last_tool_call_group /
  last_turn paths are untouched (no setLabel call — confirmed: those tests assert labels-free behavior).

## H. VALIDATION BASELINES (confirmed this session)
- `npm run typecheck` (= `tsc --noEmit`) → **exit 0** (green).
- `npx vitest run` → **21 test files pass** (full suite green). Existing checkpoint-path rewind tests
  stay green (they don't assert on `labels`).

## I. CITATION (for the inline comment)
spec/05-tools.md:182 (§3 `mulligan_checkpoint` → Behavior → step 5): *"**Auto-expiry on consumption
(REQUIRED):** a checkpoint exists to be rewound to. Once a `mulligan_rewind(granularity:"checkpoint",
checkpoint:"<name>")` successfully targets it, the checkpoint is **consumed** and MUST be retired — its
label cleared … so it no longer appears active in `mulligan_audit`."*

## J. FILES READ (evidence)
src/tools/rewind.ts (full: rewindExecute, checkpointExists, persist step 7, return step 9, factory),
src/tools/audit.ts (listCheckpoints:324), src/markers.ts (setCheckpoint:433), test/tools/rewind.test.ts
(makePi:62, checkpointLabelEntry:192, checkpoint success test:340), test/tools/checkpoint.test.ts
(makePi pattern), spec/05-tools.md (§3 step 5:182), architecture/m3_checkpoint_expiry.md (full),
P1M2T2S1/PRP.md (parallel-sibling contract — comment-only in markers.ts, no file overlap).