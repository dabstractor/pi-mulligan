# pi-mulligan — Delta PRD: v2.0 current-turn scoping

**Base:** Draft 1.2 (implemented; sessions 001–007) → **Target:** Draft 2.0
**Repo state:** `src/` implements v1.2 (4 agent tools, 3 human commands, banner, pinned shrinks, v1.2 orientation line). `spec/` is **already at v2.0** (owner commit landed the amendment text) — **no spec edits are part of this delta.**

---

## 1. Diff analysis (what actually changed)

The delta is **one normative design change** — *the agent may only modify context it produced in the current turn* — realized as five concrete edits (v2.0 amendment, `SPEC.md`):

| # | Change | Spec anchor | Impact type |
|---|---|---|---|
| 1 | `mulligan_shrink` targets are **current-turn-scoped**; `by_content_includes` arm **removed** (3→2 arms); out-of-scope / no-in-turn-match → **hard refusal** | `@05` §2 (+v2.0 note), `@04` §4 | Modified requirement |
| 2 | **Filter scope guard**: `resolveShrinkTarget` gains a `turnSpan` bound; a marker whose target predates its turn **no-ops** at every fire (defense in depth) | `@06` §5 (v2.0 block) | Modified requirement |
| 3 | **Nudge B (drift) becomes awareness-only**: re-worded, must not prescribe rewind/shrink (the reported turn is out of modification scope) | `@07` §2 (v2.0 block + new `renderDriftNudge` text) | Modified requirement |
| 4 | `mulligan_cancel` target union drops `by_content_includes` in lockstep (2 arms); cancel's *marker* resolution stays full-history | `@05` §5 (v2.0 note) | Modified requirement |
| 5 | Supersedes unspec'd "rewrite budget" (r1) work | v2.0 amendment §4 | **No-op — verified**: `grep -rn "rewrite budget|moment|r1\b" src/` finds nothing; there is no r1 code to remove |

Removed-for-awareness (no tasks): **E19 is MOOT** (`@08` §E19 v2.0) — with the content arm gone and both arms toolResult-only, shrinking a user/assistant/custom message is no longer expressible. The previous session's P4 E19 user-message-shrink coverage is superseded. Rewind (`last_tool_call_group`/`last_turn`/checkpoint), Nudge A, high-water signal, v1.2 orientation line, banner, human commands: **unchanged**.

**Sizing:** medium — ~6 src files, ~8 test files, README. Not a full-structure PRD.

---

## 2. Interpretation ruling (REQUIRED — read before implementing)

`@06` §5 says the filter enforces "the same bound" as the tool. **The bound is the marker's *issuing* turn, not the fire-time current turn.** Concretely:

- **Eligibility** (creation, `@05` §2 step 3): the target must match within the current turn's span — everything after the latest `user` message (same `iLastUser` computation as `resolveLastTurn`, `src/transforms.ts:325-329`).
- **Persistence is retained.** `@05` §5 (v2.0 text) still says the replacement "persists for as long as the marker exists (permanent soft substitution)", and the cache rationale only works if it does: the substitution enters the message array once, tail-adjacent, and later turns cache *that* form. A fire-time-current-turn bound would expire markers at the next prompt, **resurrect the shed bloat, and re-invalidate the cache** — worst of both worlds. Rejected.
- **Filter guard:** a shrink marker must never substitute a message from a turn *earlier than the marker's own*. Compute the marker's turn span from the marker's **own stable branch position** (its entry id is already available in the filter — `rt.shrinkMissCounts` is keyed by it, `src/filter.ts:400-403`; `branchEntries` is already threaded into `filterPipeline`, `src/transforms.ts:1546`). Pinned identity resolution (`resolvePinnedShrink`) is inherently scope-safe; the explicit span check no-ops malformed/legacy markers.
- **Live (unpinned) selectors** resolve only within the marker's turn span — never onto earlier *or* later content (kills the moving-target drift for the fallback path too).

---

## 3. Requirements

### R1 — Pure tier: scoped resolver + removed arm (`src/transforms.ts`, `src/markers.ts`)

1. `ShrinkTarget` union (`transforms.ts:743`, `markers.ts:99`): **remove** the `by_content_includes` arm from the write path. Keep it on the *read* type marked `@deprecated legacy v1.x field` (the `to_previous_prompt` precedent, `markers.ts:60`) so old persisted markers type-check; the resolver simply stops recognizing it → legacy content-shrinks resolve `null` → **no-op** (consistent with "scope holds under all circumstances").
2. `resolveShrinkTarget(messages, target, span?)` — add an **optional** `span` bound (index range):
   - `by_tool_call_id` / `by_tool_name`+`occurrence` search **only inside `span`**; a match outside `span` returns `null`.
   - `span` omitted/undefined = **full range** — this is `mulligan_cancel`'s usage (its hint resolution is *not* current-turn-scoped, `@05` §5 v2.0 note).
   - Delete the `by_content_includes` branch (`transforms.ts:802-807`).
3. Add a small pure helper `currentTurnSpan(messages): Span` (or `turnSpanAfter(iLastUser)`) reusing the `iLastUser` scan; export for the tool and tests.
4. `filterPipeline` shrink pass (`transforms.ts:1537-1548`): enforce the marker's turn bound on **both** paths — pinned (identity hit must fall in the marker's span, else no-op) and live (selector resolved within the marker's span). If the marker's span cannot be determined from `branchEntries`, no-op the marker (fail-safe; matches E8-style silence).
5. `applyShrink` (`transforms.ts:963`) and the `<context-shrunk>` stamp: **unchanged** (E25, render-only discipline stay).

**Mode A docs:** JSDoc on `ShrinkTarget`, `resolveShrinkTarget`, and the new span helper citing `@06` §5 v2.0 (current-turn scope, defense in depth) and this ruling. Rides with the work.

### R2 — `mulligan_shrink` tool (`src/tools/shrink.ts`)

1. `ShrinkParams` (`shrink.ts:80-99`): 2-arm union; update descriptions to current-turn wording (`by_tool_call_id`: "must be a call from the CURRENT turn"; `occurrence`: "first/last matching result within the current turn").
2. Step 3 (match-now, `resolveTargetEntryId` ~`shrink.ts:256-276`): build the snapshot, compute `currentTurnSpan`, resolve **within it**. Outcomes:
   - Match in-span → proceed (pin `pinnedEntryId` as today).
   - Selector resolves only to an **earlier-turn** result, or **no in-turn match**, or structurally invalid → **hard refusal**: `"Mulligan: refused — that result is from a previous turn; only this turn's tool calls can be shrunk."` (structurally-invalid keeps its own discriminator message).
   - **Advisory throw** (`buildContextEntries` etc.): keep the E13 rule — persist with `matched:false` (the filter guard makes an unverifiable marker inherently safe; it can only ever apply within its own turn). The v1.2 orientation line's `~0` path (`@05` §2 step 6, `@10` §1.12) remains reachable exactly here.
3. `targetIsStructurallyValid` (`shrink.ts:205-220`): drop the `by_content_includes` branch.
4. `describeTarget` (`shrink.ts:186-192`): drop the content branch.
5. `SHRINK_DESC` (`shrink.ts:120`): reword to current-turn scope ("Replace the current turn's tool result…"). **Do not copy spec `@05` §6's summary string verbatim — it is internally stale** (still says "past tool result"; see §5 below). The normative §2 purpose text is the source.
6. `prepareArguments` shim, notify echo, v1.2 orientation line: **unchanged**.

**Mode A docs:** `ShrinkParams` field descriptions + `SHRINK_DESC` are the LLM-facing docs — ride with this work.

### R3 — `mulligan_cancel` tool (`src/tools/cancel.ts`)

1. `CancelParams.target` union (`cancel.ts:96-116`): remove the `by_content_includes` arm; update the union description ("two-arm, v2.0 — same hint shape mulligan_shrink uses").
2. Hint resolution (`cancel.ts:268`): call `resolveShrinkTarget(messages, target)` **without** a span → full history (cancel acts on the marker, not the old content).
3. Covering-marker check (`cancel.ts:284-286`): prefer pinned identity (`shrink.pinnedEntryId === matchedEntryId`); live fallback resolves the shrink's target **within that marker's turn span**. `markerId` fallback, idempotency, refusal texts: unchanged.
4. `CANCEL_DESC` (`cancel.ts:140-145`): drop "or by_content_includes" (spec `@05` §6's description string is stale — the §5 schema is normative).

**Mode A docs:** `CANCEL_DESC` + union description ride with this work.

### R4 — Nudge B awareness-only (`src/notes.ts`)

Replace **only the prescribing tail** of `renderDriftNudge` (`notes.ts:337`):

```
OLD: `${lead}. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result.`
NEW: `${lead}. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.`
```

- Exact text per `@07` §2 v2.0. The three `lead` variants (delta / bloat-fallback / totality) and the `(sustained over the last N turns)` clause are **unchanged**; the new tail is fixed on all paths.
- `shouldNudge`, `injectNudge`, windowing (§5.1), high-water (§5.2, already awareness-only), suppression (§5.3): **unchanged**. Nudge A (`renderBloatReminder`): **unchanged** — it is the one compliant prescribing nudge (rides the result inside the producing turn).
- The master `SPEC.md` §6 example (`[mulligan: last turn +4.2k tokens; keep current-turn outputs lean]`) is illustrative; do not reformat the renderer around it.

**Mode A docs:** update the FORMAT JSDoc block (`notes.ts:284-300`) to the v2.0 tail + cite `@07` §2 v2.0.

### R5 — Tests (ride with each requirement; one reconciliation sweep)

Per-requirement (as subtasks of R1–R4):

- **R1:** `resolveShrinkTarget` span restriction (both arms; match outside span → null); omitted span = full range; legacy `by_content_includes` target → null. `filterPipeline`: **the critical persistence regression** — a pinned in-turn shrink issued in turn N *keeps applying* after the user sends message N+1 (guards the §2 ruling); an out-of-scope marker no-ops; a live selector never re-targets beyond its marker's turn.
- **R2:** earlier-turn `by_tool_call_id` → hard refusal with the exact text; well-formed selector with no in-turn match → hard refusal; in-span match → success + pin; orientation line unchanged on the advisory-throw path. Schema: `by_content_includes` now **fails validation**.
- **R3:** two-arm resolution tests retained; full-history hint resolution preserved (a marker issued last turn is still cancellable by hint); covering-check pinned-identity path.
- **R4:** exact new tail asserted in `test/notes.test.ts` (3 exact-string sites), `test/drift_nudge.test.ts` (2), and the injectNudge content test; add a negative assertion — the drift nudge output contains **no** `mulligan_rewind`/`mulligan_shrink` mention.

Sweep (one task, after R1–R4): reconcile the **~46 `by_content_includes` occurrences** — `test/transforms.test.ts` (13), `test/tools/shrink.test.ts` (11), `test/edge-cases.test.ts` (7, incl. the E19 block at 1029–1060 → rewrite as "no longer expressible / legacy marker no-ops"), `test/tools/cancel.test.ts` (7, cases at 658–690), `test/integration/smoke.ts` (4: F-shrink-persist at 187–196 and the **E19 user-message case at 206–213 → remove/replace with a current-turn toolResult case**), `test/markers.test.ts` (2, 538–544 legacy-read fixtures), `test/prepare-args.test.ts` (151, anyOf fixture). E27 regression language "all three anyOf arms" → two. `test/tools/shrink.test.ts:253-254` structural-invalid table rows for the content arm → move to schema-rejection tests.

### R6 — Sync changeset-level documentation (Mode B; depends on R1–R5)

`README.md` only (spec is already v2.0; JSDoc/descs were Mode A):

- §`mulligan_shrink` blurb (line ~157): "past tool result" → current-turn eligibility + the hard-refusal sentence.
- Drift-nudge paragraph (line ~234): replace the quoted old nudge string with the v2.0 text; note awareness-only.
- E19 trust note (line ~173): E19 is moot — reword the "even summarizing a user message (E19) is lossless" clause (the invariant itself — view substitution, original on disk — stays true and worth keeping; drop the user-message-shrink framing).
- Grep `README.md` (and `VERIFICATION.md`) for `by_content_includes`, "past tool result", "If wasteful" — no stale references remain.

---

## 4. Known spec-internal inconsistencies (do NOT copy into code; report to owner)

The owner's v2.0 spec commit left three stale spots — the **schemas/behavior sections are normative**, these are not:

1. `@05` §6 Shrink description string still says "past tool result" (contradicts §2 v2.0).
2. `@05` §6 Cancel description string still lists `by_content_includes` (contradicts the §5 two-arm schema).
3. `@10` §1.11 still lists a `by_content_includes` cancel-hint test bullet; §1.5/§2.1 were not updated for v2.0 (test requirements in R5 are derived from the normative sections instead).

Implement to the schemas; mention these in the wrap-up notes so the owner can patch the spec.

---

## 5. Explicitly out of scope

- Rewind paths, checkpoint/consent machinery, banner, human commands — untouched.
- Nudge A text, high-water text, bloat thresholds, config schema — untouched (no new knobs; v2.0 adds none).
- Marker migration/GC for legacy `by_content_includes` markers — they no-op naturally (R1.1).
- r1 "rewrite budget" removal — verified absent from `src/`; nothing to do.
- Any spec-file edit (already at v2.0).