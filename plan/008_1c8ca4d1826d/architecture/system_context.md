# System Context — pi-mulligan v2.0 delta (current-turn scoping)

Synthesized from 5 parallel read-only scout runs (raw briefs in `_scouts/`) + orchestrator spot-reads, 2026-08-24.
Repo: `/home/dustin/projects/pi-mulligan-current-turn-only` — implements v1.2; `spec/` is **already at v2.0** (verified).
Runtime evidence src/ lags spec: the live drift nudges fired in the orchestrating session carry the OLD prescribing tail
(`If wasteful, mulligan_rewind … mulligan_shrink …`) — pre-v2.0 wording.

## 1. Repo shape

- TypeScript ESM Pi extension, `main: ./src/index.ts`, `type: module`. Node >= 22.19. Peer deps:
  `@earendil-works/pi-coding-agent` (0.84.1 dev), `typebox`.
- `src/`: `index.ts` (registration: `pi.registerTool(makeRewindTool(pi)); makeShrinkTool; auditTool; makeCancelTool`, lines 53–56),
  `transforms.ts` (1551 ln, **Pi-free pure tier, 0 imports**), `markers.ts` (475), `filter.ts` (470),
  `notes.ts` (416, pure text renderers), `nudges.ts`, `tools/{rewind,shrink,cancel,audit,checkpoint}.ts`,
  `prepare-args.ts`, plus `banner/commands/config/ledger/log/runtime/settings/tokens`.
- Tests: **vitest** (`vitest run`; `npm run smoke` = `node test/integration/run-smoke.mjs`; `typecheck` = `tsc --noEmit`).
  House idiom: hand-rolled fakes (NO `vi.fn()`), `.js` import paths, `clearAll()` from `src/runtime.js` around each test,
  `it.each` tables, `toMatchInlineSnapshot`, `expectTypeOf` union assertions.
- No `docs/` directory. Docs surfaces: `README.md`, `VERIFICATION.md`, JSDoc on every exported symbol
  (uniform convention: multi-paragraph JSDoc citing `spec/NN §X`, GOTCHAs, E-cases, DEFENSIVE never-throws notes).

## 2. Verified key surfaces (exact, current line numbers)

### transforms.ts (pure tier)
- `ShrinkTarget` union, **line 740** (3 arms incl. `by_content_includes`); declared LOCALLY (duplicated, NOT imported from
  markers.ts) to keep transforms.ts Pi-free; **structurally identical duplicate at `src/markers.ts:96–99`** — the two must
  stay structurally identical (hard contract).
- `resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null` — **line 771**. Arm branches:
  `by_tool_call_id` (775–781, first toolResult with `toolCallId === id`), `by_tool_name`+`occurrence` (784–797,
  "last" default via GOTCHA #6), `by_content_includes` (**800–807**, any role, E19; empty needle → null, BUG-004).
  **No span/scope param exists today** — full-list scan. Discriminator precedence: call_id → name → content.
  Pure + defensive (isRecord/readOwn, never throws — E13 hot path).
- `resolveLastTurn(messages, excludeToolCallId?): { remove: number[] }` — line 317; the **iLastUser scan at 331–337**
  (last `role === "user"` index; `-1` → no-op) is the precedent for current-turn span computation.
- `resolvePinnedShrink(messages, branchEntries, pinnedEntryId): number | null` — line 851. Retained-tail identity walk
  (BUG-002/E24 upgrade): lastCompactionIdx → tailEntries (entryMessageYield > 0) → `tailStartIdx = messages.length - tailEntries.length`
  → first entry with `id === pinnedEntryId`. Identity-or-nothing, never falls back to live.
- `applyShrink(messages, marker {target, replacement, pinnedEntryId?}, branchEntries?)` — line 963. Pinned-first, else live
  `resolveShrinkTarget` (line 986). Substitution: `content` → `[{type:"text", text: stampShrink(rep)}]`, role preserved,
  clone `{...orig, content}`, others by reference. `stampShrink` (956–962) wraps `<context-shrunk>` (render-only; E25 discipline).
  `applyShrinkAt(messages, marker, i)` — **module-private, line 1030** — pre-resolved-index twin used by filterPipeline's pinned path.
- `filterPipeline(messages, markers: MarkerBundle|undefined, config, branchEntries?, diag?)` — line 1374.
  Shrink pass **1522–1547**: pinned → `resolvePinnedShrink(messages /*ORIGINAL*/, branch, pinnedId)`; `removedOrig.has(origIdx)` → no-op;
  binary-search `reducedToOrig` (ascending) to translate orig→reduced; `applyShrinkAt(m, sh, reducedIdx)`. Live →
  `applyShrink(m, sh, branchEntries)` against the post-rewind reduced `m`. `branch = Array.isArray(branchEntries) ? branchEntries : []` (~1432).
- `ShrinkMarkerLike` (~1126–1141): `{ seq; target; replacement; pinnedEntryId? }` — structural slice; `MarkerBundle {rewinds, shrinks}`.
  filter.ts passes full `ShrinkMarker[]` (has `id` = marker uuid) — structurally assignable; widen `ShrinkMarkerLike` with optional
  `id?: string` to formalize uuid access (minimal change).
- Exports consumed by tests: see `test/transforms.test.ts:2` import list (partitionIntoUnits … ProtectedConfig).

### markers.ts
- `ShrinkTarget` duplicate at 96–99 (keep structurally identical to transforms.ts).
- **`to_previous_prompt` legacy-field precedent at 60–62** (inside RewindMarker.options): optional, `@deprecated`-style JSDoc
  "Legacy v1.0 field … Kept optional so old persisted markers type-check and read harmlessly."
- `ShrinkMarker` 107–127: `kind, id (uuid), target, replacement (RAW), reason?, pinnedEntryId?, seq, ts`.
  **NO `matched` field** — "Matched: yes/no" is tool-result rendering (05 §2), not persisted (spec confirmed).
- `appendShrinkMarker` (236) → `pi.appendEntry("mulligan:shrink", entry)` then `ctx.sessionManager.getLeafId()` same tick (C7/GOTCHA #5);
  returns the ENTRY id (becomes `details.markerId`; the cancel `markerId` fallback matches `readOwn(e,"id") === params.markerId`).
- `readMarkers` in `src/filter.ts:118–190` scans `getEntries()` for customType `mulligan:shrink` ∧ `data.kind === "shrink"`;
  drops markers whose `data.id` ∈ cancelledIds (from `mulligan:cancel` entries).

### filter.ts (context handler)
- Wraps `filterPipeline`; **stale-retirement pass 380–410**: per active pinned shrink, `resolvePinnedShrink(event.messages, branchEntries, pinnedEntryId) !== null`
  → hit resets `rt.shrinkMissCounts` (keyed by **marker uuid `sh.id`**, runtime.ts:83); miss++ ; `misses >= config.shrink.staleAfterFires`
  → `appendCancelMarker({targetId: id})`. Soft cap: `markers.shrinks.length > config.shrink.maxActive` → cancel oldest by seq.
  Consequence (accepted, no code change): a permanently out-of-scope pinned marker misses every fire → auto-retires after
  staleAfterFires — correct disposition for a marker that can never apply again.

### tools/shrink.ts
- `ShrinkParams` **lines 80–106** (3-arm typebox union; descriptions v1 wording). `SHRINK_DESC` **112–116** ("Replace a specific
  past tool result …"). `describeTarget` **185–192** (has content branch). `targetIsStructurallyValid` **215–222** (content branch;
  refuses only empty/whitespace discriminators — GOTCHA #7). `refusal(reason)` 135–139 → `{content:[{type:"text", text: \`Mulligan: refused — ${reason}.\`}], details:{}}`
  (return-object refusals, never throws).
- `entryIdAtMessageIndex` (~228–243): cursor-walk `entries.flatMap(sessionEntryToContextMessages)` → exact message-index→ENTRY-id map.
- `resolveTargetEntryId` **258–275**: snapshot = `ctx.sessionManager.buildContextEntries()` (GOTCHA #5, compaction-aware) flatMapped to
  messages → `resolveShrinkTarget` → `entryIdAtMessageIndex` + `estimateTokens` (origTokens). try/catch → `{entryId:null, origTokens:0}` (E13).
- Execute order: config gates → replacement non-empty → structural validity → advisory match+pin →
  `appendShrinkMarker(pi, ctx, {target, replacement, reason, ...(entryId ? {pinnedEntryId: entryId} : {})})` →
  `feedbackText(matched)` (`Mulligan: shrink recorded. Matched: yes|no.`) + orientation line when markerId truthy:
  `shrinkOrientationLine(k, tokensShed)` (165–167): `Context updated: ${k} result(s) summarized (~${tokensShed} tokens shed). Continue exactly where you left off — no re-verification or re-reading is needed.`
  tokensShed = max(0, origTokens − est(replacement)). Notify echo via `ctx.ui.notify` + `cap` (E13-wrapped). Whole body in ONE try/catch (never throws).
- `prepareArguments: prepareObjectArgs<ShrinkArgs>(["target"])` (line 400).

### tools/cancel.ts
- `CancelParams` **93–133**: `target` Optional 3-arm union (hard parity with ShrinkParams — `params.target` is handed to
  `resolveShrinkTarget` directly) + `markerId` Optional; "at least one" is a no-op not a refusal (D1/D2).
- `CANCEL_DESC` **140–148**: contains "by_tool_name+occurrence, or by_content_includes" — must drop the content mention.
- `resolveTargetUuid` (256–316, call site 387): snapshot `buildContextEntries()` → `resolveShrinkTarget(messages, target)` (FULL history today,
  no span) → `entryIdAtMessageIndex`. Covering check **~285–305**: shrink → `covers = resolveShrinkTarget(messages, shrinkTarget) === matchedIndex`
  (**LIVE resolution, deliberately NOT pinnedEntryId** — documented at line 241); rewind → `hideEntryIds.includes(matchedEntryId)`.
  LIFO: highest `data.seq` wins. markerId fallback (372–385) matches entry id ∧ customType ∈ {rewind, shrink}. Idempotency (412–420):
  existing `mulligan:cancel` with same targetId → "already cancelled" no-op.
- Texts: refusals only "Mulligan is disabled" + "unexpected error"; no-ops "no active marker found with that id/for that target —
  nothing to cancel."; idempotent "that marker is already cancelled."; success "marker cancelled. The transform will no longer apply
  from the next turn on." + `details {cancelled, markerId}`.
- `prepareArguments: prepareObjectArgs<CancelArgs>(["target"])` (466).

### notes.ts / nudges.ts
- `renderDriftNudge(metric: DriftNudgeInput): string` — **lines 310–338**. Lead 3-branch (delta / bloat-fallback / totality),
  optional ` (sustained over the last ${sustainedN} turns)` clause when `sustainedN > 0 && delta < LARGE_SINGLE_TURN_DELTA` (4000).
  **Fixed tail at line 337**: `` `${lead}. If wasteful, \`mulligan_rewind\` to undo the turn or \`mulligan_shrink\` to compact a result.` ``
  → NEW: `` `${lead}. Keep this turn's outputs lean — pipe large command output, read slices, or summarize results as you produce them.` ``
  FORMAT JSDoc **288–297** must be updated in lockstep. Single physical line, no `\n`, no `[mulligan]` prefix, no trailing newline.
- `renderBloatReminder` (278–282, Nudge A) prescribes `mulligan_shrink` — **UNTOUCHED** (compliant: rides the result inside the producing turn).
- `nudges.ts` treats the rendered line as opaque (`injectNudge` line 395 `const line = renderDriftNudge(input)` → `mulligan:nudge`
  CustomMessage, `display:false`, ephemeral). `shouldNudge` (§5.1 windowed), `shouldHighWater` (§5.2), `suppressCheck` (§5.3) — all unchanged.

## 3. Host/tooling mechanics that constrain this delta

- **C13 (h2.35)**: the host validates tool args BEFORE `execute()` (typebox `Value.Convert` + compiled `Check`).
  Removing the `by_content_includes` arm from `ShrinkParams`/`CancelParams` makes content-arm calls **dead on arrival at the host**
  (anyOf "must be object" ×2) — `execute` never runs. Tool-body branches for the content arm become unreachable-in-practice
  (still remove them per PRD). Schema-rejection TESTS must exercise the typebox schema (e.g. via the `hostPipelinePasses`
  harness in `test/prepare-args.test.ts`), not `execute`.
- **E27 shim** (`prepare-args.ts`, 61 ln, Pi-free): parses JSON-string object params pre-validation. The anyOf fixture
  `{"by_content_includes": "pclntab"}` (prepare-args.test.ts:151) must become a 2-arm fixture; "×3" comments → "×2".
- **GOTCHA #5**: tools snapshot via `ctx.sessionManager.buildContextEntries()` (NOT event.messages); marker entry id via
  `getLeafId()` same synchronous tick. **GOTCHA #8**: `clearAll()` between tests; smoke canaries byte-identical between
  `test/integration/smoke.ts` and `test/integration/run-smoke.mjs` — **changing smoke scenarios requires synchronized edits to run-smoke.mjs**.
- Turn simulation in unit tests = literal message arrays with multiple `user(...)` messages (e.g. transforms.test.ts:1391–1399).
  **No existing test shows a shrink marker re-applying after a NEW user message** (closest: transforms.test.ts:1434–1454, pinned
  no-drift with session growth, no new user msg) — the persistence regression test is NEW work.

## 4. Docs surfaces (grep-verified)

- README.md:157 "past tool result" (shrink blurb); **169, 187, 189** `by_content_includes` mentions; **173** E19 trust note
  ("even summarizing a user message (E19) is lossless"); **234** drift paragraph quoting the OLD nudge string; **266** BUG-004 note
  referencing the content arm.
- VERIFICATION.md:209 — BUG-004 historical row referencing `by_content_includes` (historical log; mark as historical/append v2.0 rows
  rather than rewriting history).
- LLM-facing docs that are Mode A: `ShrinkParams` descriptions + `SHRINK_DESC`, `CancelParams` union description + `CANCEL_DESC`,
  JSDoc on `ShrinkTarget`/`resolveShrinkTarget`/span helpers, `renderDriftNudge` FORMAT JSDoc.

## 5. Sizing & risk

- ~6 src files (transforms, markers, filter[no code change expected — verify], tools/shrink, tools/cancel, notes), ~8 test files, README.
- Highest-risk piece: the filterPipeline scope guard (both paths + reduced-space translation) — the §2 ruling (issuing-turn bound,
  persistence retained) must hold; see `scope_guard_design.md`.
-filter.ts likely needs NO edits (guard lives in the pure `filterPipeline`); the retirement pass follows automatically (§2 above).