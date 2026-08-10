# Delta PRD — pi-mulligan refinements (cancel-by-target · operator echo · checkpoint expiry · nudge text)

**Status:** Draft · **Target:** HEAD `0bcaa814` (post-P4) · **Scope:** code delta making the implementation match the already-updated spec (spec/02 §2.3, spec/05 §1–§5, spec/07 §1/§2/§5.3, spec/08 E15/E21, spec/09 §2/§3, spec/10 §1.11/§2.1).

---

## 0. What this delta is (and is not)

This is a **MEDIUM** delta: four independent, spec-already-written refinements to existing tools/nudges, plus a README sync. There is **no new architecture** — every change is a localized modification to code that already exists. The spec is the source of truth and is already at the target state; the code lags it in four spots.

### Diff summary (previous PRD → current PRD)

| # | Change | Spec location | Code state at HEAD |
|---|---|---|---|
| **1** | `mulligan_cancel` now identifies the marker **by `target`** (same hint shape as `mulligan_shrink`: `by_tool_call_id`/`by_tool_name`+`occurrence`/`by_content_includes`), with explicit `markerId` as optional fallback. LIFO: most-recent active marker covering the matched message is retired. | spec/05 §5, spec/08 E21, spec/06 §1, spec/10 §1.11 + F-cancel | **NOT done** — `cancel.ts` is id-only (`CancelParams = {markerId}`); resolution maps `entry.id → data.id`. Needs full schema+execute rewrite (filter side unchanged). |
| **2** | `mulligan_shrink` surfaces the replacement to the **operator** via `ctx.ui.notify` (zero context cost); the tool **result** stays terse (`"Matched: yes/no."`) and does NOT echo the replacement. New config knob `shrink.notifyMaxChars` (default 2048). | spec/05 §2 (return shape + behavior step 5), spec/04 §7, spec/09 §2/§3 | **NOT done** — `shrink.ts` returns the old verbose `"Matched message will show the replacement from the next turn on. (Matched now: …)"`; no `ctx.ui.notify`; `notifyMaxChars` absent from `config.ts`. |
| **3** | A checkpoint is **auto-retired on consumption**: once a `mulligan_rewind(granularity:"checkpoint")` successfully targets it, the checkpoint is consumed (no longer active in `mulligan_audit`; a second rewind to the same name refuses unless re-created). | spec/02 §2.3, spec/05 §3 step 5, spec/08 E15, spec/10 F-checkpoint | **NOT done** — `checkpoint.ts` / `rewind.ts` have no expiry; `audit.ts` lists all checkpoints as active. |
| **4** | Rewind note's `display:true` is **deliberate** operator-visibility (rationale note added). | spec/05 §1 step 6 + Purpose | **Already done in code** (`markers.ts:383` passes `display:true`). Pure doc/comment. |
| **5** | Per-tool bloat threshold default changed `{bash:32768, read:20480}` → **`{read:24576}`** (bash intentionally omitted → uses 16 KB global to stay sensitive). | spec/04 §7, spec/05 §4, spec/06, spec/07 §1, spec/09 §2/§3 | **Already done** — `config.ts:146` is `{ read: 24576 }`; JSDoc already explains the bash omission. **No task.** |
| **6** | Bloat reminder text simplified + signature: `renderBloatReminder(toolName, bytes)` (threshold arg dropped); text → single line `"This result added ~<KB> KB to your context…"` (no `[mulligan]` prefix, no threshold mention, no "stays on disk" clause). ~30 tokens (was ~40). | spec/07 §1 (`renderBloatReminder`, mechanism, cost) | **NOT done** — `notes.ts:278` is 3-arg `(toolName, bytes, thresholdBytes)`; text is the old `[mulligan] … (threshold <T> KB) … (stays on disk for the human)` form. Call site `nudges.ts:133` passes `threshold`. |
| **7** | Drift nudge text simplified: drop `[mulligan]` prefix + the bloat clause (`"< and produced <N> bloated result(s)"`); condense to ~2 lines. The rendered nudge **never** carries a bloat clause (closes the stale-count rough edge at the rendering layer). | spec/07 §2 (`renderDriftNudge`, edge cases) | **NOT done** — `notes.ts:322` `renderDriftNudge` emits `[mulligan] <firstLine>.` + a bloat-conditional first line + 3 joined lines. |
| **8** | **NEW spec §5.3** — drift nudge MUST NOT fire for a turn in which the agent already issued a rewind/shrink (hard rule, "regardless of delta or bloatHit"). | spec/07 §5.3 (new), spec/07 §2 edge cases, spec/10 F-nudge-drift §5.3 negative | **Functionally done** — `suppressCheck` (`nudges.ts:390`, wired `filter.ts:319`) already suppresses when a rewind/shrink marker's `ts` falls in the metric's turn window. Needs **JSDoc align to cite §5.3** + **confirm/extend the §5.3 negative test**. Mechanism (ts-window vs seq-based) is an acknowledged "simple heuristic"; hardening to seq-based is optional polish, not required. |

**Already-satisfied (no task):** Change 5. **Trivial/doc-only:** Change 4. **Real work:** Changes 1, 2, 3, 6, 7, 8(align).

### Non-goals of this delta
- No change to the filter pipeline, marker data shapes, the `mulligan:cancel` drop logic in `readMarkers` (it keys on uuid `data.id` — unchanged whether the agent cancelled by target or id), the rewind retry-budget/context-fraction guards (P4, complete), or `shouldNudge`'s delta-only return (P4.M2, complete).
- No new model request (D4), no new human command (D8), every tool still fails open (E13).

---

## Phase 1 — Four refinements + README sync

All milestones are **mutually independent** (different files) and may be parallelized. M5 (README) depends on all of M1–M4. Reference the prior session's research at `plan/004_d3d84055c5b2/architecture/codebase_patterns.md` for the `makePi`/`makeCtx` test-fake patterns, the `refusal()` helper shape, and the config-validation (`safeGet`/`coerceNumber`/inline `(0,1]`) patterns — they all still apply.

### Milestone M1 — `mulligan_cancel` target-based API (the headline change)

**Why:** an id captured at issue-time is fragile *by construction* in this system — the toolkit's own operations (`shrink`/`rewind`) can hide the very message that carried the opaque `markerId`. A content/role `target` hint re-resolves live each turn (same compaction-robustness `mulligan_shrink` already enjoys). The filter side is **unchanged**: it still drops by the marker's uuid `data.id` ∈ `cancelledIds`; the cancel *tool* now resolves the target hint → matched message → covering marker → that marker's uuid.

**Task M1.T1 — Rewrite `mulligan_cancel` (schema + execute + description + tests)**

- **Subtask M1.T1.S1 — CancelParams schema + CANCEL_DESC** (`src/tools/cancel.ts`). Replace `CancelParams = Type.Object({ markerId: Type.String(...) })` with the target-union + optional `markerId` (spec/05 §5, verbatim): `target: Type.Union([{by_tool_call_id}, {by_tool_name + occurrence}, {by_content_includes}])` + `markerId: Type.Optional(Type.String(...))`, object-level description "Cancel accepts a `target` (preferred) or an explicit `markerId` (fallback). At least one MUST be present." Update `CANCEL_DESC` to the new wording (identify by `target` — same hint shape as `mulligan_shrink`; most recent marker affecting that content is retired; or explicit `markerId`). Keep the existing `CancelDetails`/`refusal()`/`readOwn`/`isRecord` helpers.
  - *Docs (Mode A):* the `CANCEL_DESC` string IS the LLM-facing doc; update it in this subtask. No separate doc file.
  - `prd_selectors`: spec/05 §5 ("Parameter schema (typebox)" + "Description strings" Cancel), spec/10 §1.11.

- **Subtask M1.T1.S2 — cancelExecute target resolution** (`src/tools/cancel.ts`). Rewrite step 3 to resolve the marker to retire **preferred-by-target** then **fallback-by-markerId** (spec/05 §5 "Behavior"):
  - **target path:** resolve `params.target` against the current message snapshot using the **same pure resolver** `mulligan_shrink` uses (import `resolveShrinkTarget` from `transforms.ts` — live each turn, compaction-robust). Build the message snapshot the same way `mulligan_shrink`/`audit` do (`buildContextEntries()` → `entriesToMessages`, or reuse the shared snapshot helper if one exists). Then collect candidate markers — every **active** `mulligan:rewind`/`mulligan:shrink` whose *effect covers* the matched message: a *shrink* covers the message its own `target` resolves to; a *rewind* covers any message in its hidden span (`hideEntryIds`, resolved read-only against the branch). Pick the **most recent** candidate by `seq` (LIFO). Read its uuid `data.id` via `readOwn`.
  - **markerId fallback:** if `params.markerId` is set (or target matched nothing and markerId present), scan for `entry.id === markerId` ∧ `customType ∈ {rewind,shrink}` → read `data.id` (existing logic). **If both given, `markerId` wins.**
  - Keep steps 4 (not-found no-op), 5 (already-cancelled idempotency), 6 (persist uuid as `targetId`), 7 (return) **as-is** — they already operate on the uuid. The markerId→uuid indirection note (GOTCHA #1) still holds; just add the target→uuid path above it. Wrap new resolution in the existing outer try/catch (E13). A malformed/unreadable marker → not-found no-op.
  - *Reuse, don't duplicate:* `resolveShrinkTarget` and `entriesToMessages` already exist (`transforms.ts` / `audit.ts`). If `entriesToMessages` is module-private in `audit.ts`, export it (or extract a shared snapshot helper) to avoid divergence — mirror the P4 `computeFilteredTotal` extraction precedent.
  - `prd_selectors`: spec/05 §5 ("Behavior (step by step)", "Target resolution → marker uuid", "Refusal / no-op conditions"), spec/08 E21.

- **Subtask M1.T1.S3 — Tests** (`test/tools/cancel.test.ts` + new `test/cancel_target.test.ts` or extend). Mirror spec/10 §1.11: (a) `by_tool_call_id` → retires the uuid of the single marker whose matched message/`hideEntryIds` carries that id; (b) `by_tool_name:"read", occurrence:"last"` → most-recent active shrink/rewind covering the last `read` result; (c) `by_content_includes:"<substr>"` → most-recent covering a message containing the substring; (d) several markers cover → **most recent by `seq`** retired (LIFO), rest stay active; (e) no active marker covers → safe no-op (`cancelled:false`), nothing appended; (f) explicit `markerId` fallback retires that exact marker; unknown id → safe no-op; (g) after a successful cancel, the next `context` fire shows originally-hidden/shrunk content verbatim (E21 (b)); retired marker stays on disk. Extend the existing `makePi`/`makeCtx` fakes; reset config cache per test.
  - `prd_selectors`: spec/10 §1.11, spec/08 E21 acceptance (a)–(d).

---

### Milestone M2 — Operator-visible payloads: shrink echo + rewind-note rationale

**Why (theme):** every self-directed payload the agent writes (the rewind note, the shrink replacement) should be **operator-visible at zero context cost**. The rewind note already surfaces via `display:true`; shrink's replacement currently has NO operator surface and the tool result is about to become terse — so it needs a `ctx.ui.notify` echo.

**Task M2.T1 — `mulligan_shrink` operator echo + terse result**

- **Subtask M2.T1.S1 — Config knob `shrink.notifyMaxChars`** (`src/config.ts`). Add `notifyMaxChars: number` to `MulliganConfig.shrink` (after `staleAfterFires`) + `notifyMaxChars: 2048` to `DEFAULT_CONFIG.shrink` + a `coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true)` validation line in the shrink block (same pattern as `maxActive`/`staleAfterFires` at `config.ts:260-263`). Default 2048. JSDoc cites spec/09 §3 (pure UI side-channel, zero context cost).
  - *Docs (Mode A):* the interface JSDoc update IS this subtask's inline doc.
  - `prd_selectors`: spec/04 §7 (MulliganConfig.shrink), spec/09 §2/§3 (`shrink.notifyMaxChars`).

- **Subtask M2.T1.S2 — Terse result + `ctx.ui.notify` echo** (`src/tools/shrink.ts`). (a) Change the success return text from `"Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: …)"` to the terse `"Mulligan: shrink recorded. Matched: yes/no."` (spec/05 §2 return shape) — the replacement is **NOT** echoed in the result (echoing would place a second copy in context, defeating the tool). (b) Add behavior step 5 (spec/05 §2): after persisting, `if (ctx.hasUI) ctx.ui.notify(\`Shrunk <target desc> — replacement:\\n<<<\\n${cap(replacement, config.shrink.notifyMaxChars)}\\n>>>\`, "info")` — guard with `ctx.hasUI` (no-op in print/JSON). Over-cap, append `"…(<N> chars total)"`. Use a tiny local `cap(s, n)` helper. Wrap the notify in its own try/catch (a UI failure must never break the tool — E13).
  - `prd_selectors`: spec/05 §2 ("Return shape", "Behavior" step 5, "Why not echo in the result").

- **Subtask M2.T1.S3 — Tests** (`test/tools/shrink.test.ts` + `test/config.test.ts`). (a) Success result text is the terse form and does **not** contain the replacement string; (b) `ctx.ui.notify` was called with the replacement (script a `notify` capture in `makeCtx`'s ui fake) when `hasUI:true`, and NOT called when `hasUI:false`; (c) the notify text is capped at `notifyMaxChars` (over-cap → `…(<N> chars total)`); (d) `validateConfig({shrink:{notifyMaxChars: 100}}).shrink.notifyMaxChars === 100`; invalid (0, -1, 'x') → 2048.
  - `prd_selectors`: spec/05 §2, spec/09 §3.

**Task M2.T2 — Rewind-note `display:true` rationale (trivial doc)**

- **Subtask M2.T2.S1 — Comment alignment** (`src/markers.ts` around line 367-383). The code already passes `display:true` (`markers.ts:383`). Add/expand the JSDoc comment to state spec/05 §1 step 6's rationale: `display:true` is deliberate — it surfaces the note to the operator (the human sees exactly what the model told its resumed self); this is the rewind counterpart of shrink's replacement echo. No behavior change, no test change.
  - *Docs (Mode A):* this comment IS the doc.
  - `prd_selectors`: spec/05 §1 step 6 (the bolded `display:true` note), spec/05 §1 Purpose ("flagship UX").

---

### Milestone M3 — Checkpoint auto-expiry on consumption

**Why:** a checkpoint exists to be rewound *to*. Once consumed it has no further purpose; unconsumed throwaway checkpoints otherwise linger in `mulligan_audit`'s active-marker list indefinitely. Re-creating a checkpoint of the same name after consumption is allowed (fresh label).

**Task M3.T1 — Retire a checkpoint when a rewind targets it**

- **Subtask M3.T1.S1 — Consumption hook** (`src/tools/rewind.ts` + `src/tools/audit.ts`). When a `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` **successfully targets** a checkpoint (passes all guards, persists the rewind marker), retire the checkpoint so it no longer appears active: clear its label, OR append a small `mulligan:checkpoint-cancel`/`mulligan:cancel`-style suppression entry (the spec allows either: "its label cleared (or suppressed via a `mulligan:checkpoint-cancel` entry)"). **Recommended:** the simplest robust mechanism is to clear the label via `pi.setLabel(targetEntryId, undefined)` at the end of the rewind tool's persist step (only on the checkpoint-granularity success path). Then `audit.ts`'s checkpoint listing (which scans labels) naturally drops it, and a second rewind to the same name refuses "not found" (the label no longer exists — the existing checkpoint-not-found guard at rewind step 3 handles it). Guard the clear in try/catch (E13 — a label-clear failure must not undo the rewind).
  - *Decision for implementer:* if label-clear proves fragile (Pi label semantics), fall back to a `mulligan:checkpoint-cancel` custom entry that `audit.ts`/the checkpoint scan filters on. Either satisfies spec/05 §3 step 5; pick the one with the smaller blast radius.
  - `prd_selectors`: spec/05 §3 step 5 ("Auto-expiry on consumption"), spec/02 §2.3, spec/08 E15.

- **Subtask M3.T1.S2 — Tests** (`test/tools/rewind.test.ts` / `test/tools/checkpoint.test.ts`). (a) After a successful checkpoint rewind, `mulligan_audit` no longer lists that checkpoint active (spec/10 F-checkpoint); (b) a second `mulligan_rewind(granularity:"checkpoint", checkpoint:"x")` to the consumed name refuses "not found" unless re-created; (c) re-creating (`mulligan_checkpoint("x")` again) sets a fresh label and a subsequent rewind works; (d) a checkpoint that is never consumed persists (unchanged behavior).
  - `prd_selectors`: spec/10 §2.1 F-checkpoint (the bolded "checkpoint is consumed on use" clause).

---

### Milestone M4 — Nudge text simplification + §5.3 alignment

**Why:** the `[mulligan]` prefix and the bloat clause in the drift nudge were noise; the bloat clause in particular could surface stale counts (a since-shrunk result still announced as "N bloated result(s)"). Simplifying both render functions removes the noise and closes the stale-count rough edge at the rendering layer. §5.3 is already functionally implemented by `suppressCheck` — this milestone aligns its docs/tests to the new formal section.

**Task M4.T1 — Bloat reminder text + signature**

- **Subtask M4.T1.S1 — `renderBloatReminder` rewrite** (`src/notes.ts:278`). Drop the `thresholdBytes` parameter → `renderBloatReminder(toolName: string, bytes: number): string` (spec/07 §1). Replace the text with the single line: `"This result added ~<KB> KB to your context. If you don't need the full output, call \`mulligan_shrink\` with a summary or \`mulligan_rewind(granularity:\"last_tool_call_group\")\` if the whole call was a mistake."` (no `[mulligan]` prefix, no threshold mention, no "stays on disk" clause). Update the JSDoc (signature, FORMAT block, the `~30 tokens` cost). Keep `bytesToKb` + the never-throws discipline.
  - Update the call site `src/nudges.ts:133`: `renderBloatReminder(event.toolName, bytes)` (drop the `threshold` arg — the threshold still gates *firing* at line 130-131, it's just no longer *rendered*).
  - `prd_selectors`: spec/07 §1 (`renderBloatReminder(toolName, bytes)`, mechanism code block, "Threshold default & calibration" cost line "~30 tokens").

**Task M4.T2 — Drift nudge text (drop prefix + bloat clause)**

- **Subtask M4.T2.S1 — `renderDriftNudge` rewrite** (`src/notes.ts:322`). Remove the `[mulligan]` prefix and the bloat clause entirely. New text (spec/07 §2): `"Previous turn added ~<delta>k tokens to your context. If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown."` Since the bloat clause is gone, the first-line if/else over `(delta != null) × (bloat)` collapses: when `delta != null` use the delta line; when `delta == null` (first-turn no-baseline), fall back to a bloat-aware lead ONLY for the no-delta fallback path (e.g. `"Previous turn produced <N> bloated result(s)"` — keep this one branch so the no-delta-fallback nudge still has signal) — but the **delta-available** path never mentions bloat. Update the JSDoc FORMAT block + the "bloat counts are cosmetic / never rendered" note. Keep `kTokens`/`readDelta`/`readBloatHits` + never-throws.
  - `prd_selectors`: spec/07 §2 (`renderDriftNudge`, "Why this is zero-extra-requests", edge cases "rendered drift nudge no longer carries a bloat clause").

**Task M4.T3 — §5.3 align + test (suppressCheck already implements it)**

- **Subtask M4.T3.S1 — JSDoc + test align** (`src/nudges.ts:367-390` + `test/drift_nudge.test.ts`/`test/filter.test.ts`). `suppressCheck` already returns true (suppress) iff a rewind/shrink marker's `ts` falls in `(metric.ts − NUDGE_TURN_WINDOW_MS, metric.ts]` — this satisfies spec/07 §5.3's intent. (a) Update the `suppressCheck` JSDoc to cite **spec/07 §5.3** explicitly (not just §2 "Edge cases") and state the §5.3 framing ("hard rule — drift nudge MUST NOT fire for a turn in which the agent already issued a rewind/shrink, regardless of delta or bloatHit"). (b) Confirm/extend the negative test for spec/10 F-nudge-drift's §5.3 clause: a turn that produces a >threshold result AND shrinks/rewinds it in the same turn does NOT fire the drift nudge next turn. If the existing `suppressCheck` test already covers this (it keys on marker ts in-window), just assert the §5.3 acceptance (a)/(b)/(c) explicitly. **Do NOT rewrite suppressCheck to be seq-based** unless a test reveals the ts-window mis-fires — the spec calls the window a valid "simple heuristic."
  - *Docs (Mode A):* the `suppressCheck` JSDoc update IS the doc.
  - `prd_selectors`: spec/07 §5.3 (the new REQUIRED section + acceptance (a)/(b)/(c)), spec/07 §2 edge cases ("hard-suppressed … per §5.3"), spec/10 F-nudge-drift §5.3 negative.

---

### Milestone M5 — Sync README (Mode B; depends on M1–M4)

**Task M5.T1 — README config table + JSON example + blurbs** (`README.md`)

- **Subtask M5.T1.S1 — Config table + JSON example.** Add a `shrink.notifyMaxChars` row to the config table (default 2048; "caps the replacement shown to the operator via `ctx.ui.notify`; zero context cost"). Confirm the `bloatThresholdBytesByTool` row already shows `{ "read": 24576 }` (it should — code is already there). Update the commented JSON example's `shrink` block to include `"notifyMaxChars": 2048`. Confirm the `rewind` JSON example already has the P4 knobs (it should).
  - `prd_selectors`: spec/09 §2/§3.

- **Subtask M5.T1.S2 — Feature blurbs.** Add concise sentences for the four user-visible behavior changes: (1) `mulligan_cancel` now takes a `target` hint (same shape as `mulligan_shrink`) — the most-recent marker affecting that content is retired; (2) `mulligan_shrink` now echoes the replacement to the operator via a UI toast (the tool result stays terse, zero context cost); (3) checkpoints auto-expire when rewound to; (4) the bloat/drift nudge text is shorter and the drift nudge no longer re-announces bloat the agent already addressed. One sentence each with a spec pointer (`spec/05`, `spec/07`). Keep it tight — these are refinements, not new features.
  - `prd_selectors`: spec/05 §2/§3/§5, spec/07 §1/§2/§5.3.

---

## Acceptance (definition of done for this delta)

1. `mulligan_cancel({target:{by_tool_name:"read", occurrence:"last"}})` retires the most-recent active marker covering the last `read` result; the filter drops it next fire (M1).
2. `mulligan_shrink` result is terse (`"Matched: yes/no."`), the replacement is NOT in the result, and the operator sees it via `ctx.ui.notify` when `hasUI` (M2).
3. A checkpoint consumed by a rewind no longer appears active in `mulligan_audit`; a second rewind to it refuses unless re-created (M3).
4. Bloat reminder + drift nudge render the new text (no `[mulligan]` prefix, no threshold/bloat clause in the delta-available drift nudge); `renderBloatReminder` takes 2 args (M4).
5. `suppressCheck` JSDoc cites §5.3 and the §5.3 negative test passes (M4).
6. README reflects `shrink.notifyMaxChars` and the four behavior changes (M5).
7. **All existing tests stay green** (the only intentional assertion changes are the nudge-text snapshot/string assertions in M4.T1/T2 and the shrink-result-text assertion in M2.T1.S3). No new model request; no tool throws on the hot path (E13).

---

## Notes for the breakdown agent

- **Already-done — do NOT create tasks:** Change 5 (threshold `{read:24576}`, `config.ts:146`) and Change 4's behavior (rewind note `display:true`, `markers.ts:383`). M2.T2 (the `display:true` *comment*) is the only rewind-side touch and is trivial.
- **Reuse over duplication:** M1.T1.S2 must reuse `resolveShrinkTarget` (transforms.ts) and the message-snapshot builder (audit.ts/`entriesToMessages`) — extract/export if private, mirroring the P4 `computeFilteredTotal` precedent.
- **Filter side unchanged for cancel:** `readMarkers` already drops by uuid `data.id`; M1 changes only the *tool's* resolution of which uuid to put in `targetId`. Do not touch `filter.ts`'s cancel-drop logic.
- **Parallelizable:** M1, M2, M3, M4 touch disjoint files (`cancel.ts` / `shrink.ts`+`config.ts` / `rewind.ts`+`checkpoint.ts`+`audit.ts` / `notes.ts`+`nudges.ts`). M5 (README) is last.
- **Leverage prior research:** `plan/004_d3d84055c5b2/architecture/codebase_patterns.md` documents the `makePi`/`makeCtx` fakes, the `refusal()` helper, `coerceNumber`/inline `(0,1]` validation, and README locations — all still accurate.