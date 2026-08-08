# PRP — P1.M2.T3.S3: `renderBloatReminder` + `renderDriftNudge` text renderers

**Work item:** P1.M2.T3.S3 · **Points:** 0.5 · **Stage:** Pure Helper Library → Note Validation & Rendering
**Scope:** **APPEND to two existing files** — `src/notes.ts` (the `renderBloatReminder` + `renderDriftNudge` pure
functions + a `DriftNudgeInput` interface + five module-private helpers) and `test/notes.test.ts` (vitest Tier-1
tests for both renderers). **No other file is touched.** Zero Pi dependency; neither renderer throws. This is
**S3 of a 3-part `notes.ts`** (S1 = `validateNote`/`NoteInput`, DONE; S2 = `renderNote`, DONE) — S3 ships the two
nudge renderers and COMPLETES `notes.ts` (spec/11 §1: "notes.ts PURE: validateNote, renderNote, renderBloatReminder,
renderDriftNudge").

> **PARALLEL-EXECUTION NOTE:** S1 + S2 LANDED **before** this task — verified on disk: `src/notes.ts` = 222 lines
> (S1 `validateNote`/`NoteInput`/`isRecord`/`readOwn` + S2 `renderNote`/`readNoteField`/`readLedgerList`/
> `LEDGER_BLOCKS` + the two `import type` lines at the very top); `test/notes.test.ts` = 392 lines / 41 tests;
> baseline **6 files / 187 tests green, `tsc --noEmit` exit 0**. S3 **APPENDS** to both. Treat the S1/S2 PRPs + the
> on-disk `src/notes.ts` as the contract: REUSE the module-private `isRecord`/`readOwn` (hoisted; do NOT redefine),
> and do NOT touch S1/S2 exports.

---

## Goal

**Feature Goal**: Ship Mulligan's two **nudge text renderers** — pure, Pi-free, side-effect-free functions that
compose the advisory text the agent sees when a single tool result is bloated (`renderBloatReminder`, Nudge A) or
when a turn grew context substantially (`renderDriftNudge`, Nudge B). The text is **spec-pinned verbatim** in
`spec/07-preventive-and-nudges.md §1` and `§2`; this task implements the rendering logic around that fixed text
(byte→KB rounding, token-delta→"k" rounding, null-delta fallback, bloat-hit pluralization, the conditional bloat
clause). Both renderers ride inferences/results that were already happening — **zero extra model requests** (D4).

**Deliverable** (APPEND to two EXISTING files — do NOT rewrite either):
1. `src/notes.ts` — APPEND (at the END, after S2's `readLedgerList`):
   - `export interface DriftNudgeInput { deltaTokens: number | null; bloatHits: ReadonlyArray<{ toolName: string; approxTokens: number }> }` — the minimal projection of `TurnMetric` (spec/04 §5) the renderer needs.
   - `export function renderBloatReminder(_toolName: string, bytes: number, thresholdBytes: number): string` — Nudge A text (spec/07 §1).
   - `export function renderDriftNudge(metric: DriftNudgeInput): string` — Nudge B text (spec/07 §2).
   - five module-private helpers: `bytesToKb`, `kTokens`, `resultWord`, `readDelta`, `readBloatHits` (the last two
     reuse S1's `isRecord`/`readOwn`; do NOT redefine those).
   - **REUSES** S1's `isRecord`/`readOwn` + S2's nothing-else. S1/S2 exports are NOT modified. **S3 adds NO
     imports** (no new type-only imports — `DriftNudgeInput` is defined inline; notes.ts stays Pi-free).
2. `test/notes.test.ts` — APPEND: add `renderBloatReminder`, `renderDriftNudge`, `type DriftNudgeInput` to the
   existing `../src/notes.js` import, and APPEND `renderBloatReminder` + `renderDriftNudge` `describe` blocks
   (pinned `.toBe()` format-contract tests + `toMatchInlineSnapshot()` representative cases + defensive never-throws
   + `expectTypeOf`). Mirror S2's conventions (no `beforeEach`; `describe`/`it`/`expect`/`expectTypeOf`).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (new code + tests type-sound under `strict`).
- `npx vitest run` is **all-green** — the grown `notes` suite **AND** the pre-existing suites (baseline 6 files /
  187 tests → 6 files / 187+N; the new tests are additive).
- Neither renderer **ever throws** (defensive on null/array/primitive metric, throwing-Proxy metric, NaN/negative
  bytes) — both sit on fail-open nudge handlers (spec/07 §1/§2; E13 discipline).
- The **pinned text contract (spec/07 §1 + §2)**: the rendered strings EXACTLY match the spec's text — the bloat
  reminder's leading `\n---\n` + 4-line body with `<KB>`/`<T>` filled, the drift nudge's `[mulligan]` first line +
  two fixed tail lines, with correct KB/k rounding, pluralization, null-delta handling, and the conditional bloat clause.

---

## User Persona

**Target User**: The implementing AI agent for `nudges.ts` (P1.M6.T1.S1 tool_result annotator +
P1.M6.T2.S2 `shouldNudge`/`injectNudge`) — the SOLE runtime consumer in v1. The **bloat annotator** (spec/07 §1)
calls `renderBloatReminder(event.toolName, bytes, config.nudges.bloatThresholdBytes)` and appends the returned
string as `{type:"text", text: <rendered>}` to the result's content. The **drift injector** (spec/06 §1 +
spec/07 §2) calls `renderDriftNudge(metric)` and injects the returned string as a NON-persisted `mulligan:nudge`
custom message's `content`. The SECOND consumer is the test suite (spec/10 §2.1 F-shrink-preventive /
F-nudge-drift assert the rendered text appears).

**Use Case**: An agent runs a `read` that returns ~30 KB. The `tool_result` handler measures `resultBytes` (30720),
sees it exceeds `bloatThresholdBytes` (8192), and appends `renderBloatReminder("read", 30720, 8192)` → the
`[mulligan] This result is ~30 KB in your context (threshold 8 KB).` block telling the agent a shrink/rewind is
available. Separately, a turn that grew ~5k tokens and produced 1 bloated result triggers the next inference's
`context` handler to inject `renderDriftNudge({deltaTokens:5000, bloatHits:[{toolName:"read",approxTokens:7680}]})`
→ the `[mulligan] Previous turn added ~5k tokens to your context and produced 1 bloated result.` annotation. Both
are **advisory** (D3) — the agent decides whether to act; the nudge just makes rewind/shrink salient at the moment
the bloat/drift is visible.

**User Journey**:
1. A bloated `tool_result` fires → handler calls `renderBloatReminder(toolName, bytes, thresholdBytes)` → reminder
   text appended to that result's content (rides the result, no extra request).
2. At `turn_end` a `TurnMetric` is computed + persisted (deltaTokens, bloatHits).
3. On the NEXT inference, the `context` handler reads the latest metric; `shouldNudge(metric)` is true → calls
   `renderDriftNudge(metric)` → the nudge string becomes a `mulligan:nudge` custom message appended to the in-flight
   copy (NOT persisted; rides the inference that was already happening).
4. The agent sees the annotation, and may call `mulligan_rewind` / `mulligan_shrink` / `mulligan_audit`.

**Pain Points Addressed**: Mulligan's two operations (rewind/shrink) are useless if the agent never notices it
*should* use them. The nudges make bloat/drift visible at the exact moment they occur — without spending a model
request (D4). `renderBloatReminder`/`renderDriftNudge` are the functions that turn the measured numbers into that
readable, salient, spec-exact advisory text.

---

## Why

- **Unblocks `nudges.ts` (P1.M6.T1.S1 + P1.M6.T2.S2) — both handlers need the renderers.** spec/07 §1 names
  `renderBloatReminder` in the tool_result handler; spec/07 §2 + spec/06 §1 name `renderDriftNudge` in `injectNudge`.
  The Pi-coupled glue cannot ship without the pure text functions. Shipping them now (pure-helper tier, completing
  `notes.ts`) lets the downstream nudge layer focus on Pi wiring.
- **Spec-pinned text → deterministic, no judgement calls beyond documented rounding.** The exact reminder/nudge text
  is quoted verbatim in spec/07 §1/§2. The only open details (KB/k rounding, null-delta shape, pluralization, the
  unused `toolName`) are RESOLVED + PINNED in `research/design_decisions.md` §1–§8 — implement the documented
  choices exactly.
- **Pure-helper tier & unit-testable in isolation.** Both renderers import NOTHING new (S3 adds zero imports; notes.ts
  is already Pi-free with S2's two type-only imports). They are pure string functions covered by fast unit tests
  (spec/07 §3: "driven by pure helpers … unit-tested without Pi"; spec/10 §1).
- **Advisory, never auto-act (D3).** The text preserves agent agency — it tells the agent a rewind/shrink exists; it
  never discards data. A correct, spec-exact renderer is load-bearing for the whole "ride-along, zero-extra-request"
  preventive property.

---

## What

APPEND `renderBloatReminder` + `renderDriftNudge` + `DriftNudgeInput` + five helpers to `src/notes.ts`. The two
renderers:

- **`renderBloatReminder(_toolName, bytes, thresholdBytes)`** returns `"\n---\n" + <4-line body>` where the body
  interpolates `bytesToKb(bytes)` and `bytesToKb(thresholdBytes)` into the spec/07 §1 text. `_toolName` is accepted
  (the handler passes `event.toolName`) but NOT interpolated (the spec text has no tool-name placeholder) — prefixed
  `_` to signal "reserved for future use", mirroring `tokens.ts`'s `estimateTokens(messages, _model)`. NO trailing
  newline.
- **`renderDriftNudge(metric)`** returns 3 lines joined by `"\n"`: a `[mulligan] <first line>.` that VARIES by
  input (see Implementation Blueprint) + two FIXED tail lines (spec/07 §2). The first line is built by an explicit
  if/else over `(delta != null) × (bloatHits non-empty)`:
  - delta only → `Previous turn added ~<k> tokens to your context`
  - delta + bloat → `Previous turn added ~<k> tokens to your context and produced <N> bloated result(s)`
  - bloat only (null delta) → `Previous turn produced <N> bloated result(s)`
  - both empty (defensive, unreachable via `shouldNudge`) → `Previous turn changed your context`
  where `<k>` = `kTokens(delta)` (delta/1000, 1 decimal: `4200→"4.2k"`, `3000→"3k"`), `<N>` = `bloatHits.length`,
  and `result(s)` = `resultWord(N)` (`1→"result"`, else `"results"`). NO trailing newline.

This subtask does **NOT**: rewrite S1/S2's `notes.ts` exports (UNCHANGED); implement the Pi-coupled nudge handlers
(P1.M6 — `shouldNudge`/`injectNudge`/the `tool_result`+`turn_end` handlers); implement `TurnMetric` persistence
(P1.M4); mutate inputs; invent tool-name mentions in the bloat text (the spec text is the authority); or widen the
public signatures.

### Success Criteria

- [ ] `src/notes.ts` APPENDS `renderBloatReminder` + `renderDriftNudge` + `DriftNudgeInput` + the 5 module-private
      helpers, leaving S1/S2 exports and `isRecord`/`readOwn` UNCHANGED, and adding **NO imports**.
- [ ] `test/notes.test.ts` APPENDS renderer test blocks (pinned `.toBe()` + `toMatchInlineSnapshot()` + defensive +
      types); the whole suite is green (`npx vitest run`).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **Pinned bloat text (spec/07 §1):** output = `"\n---\n"` + the 4-line body; `<KB>`=`bytesToKb(bytes)`,
      `<T>`=`bytesToKb(thresholdBytes)`; body lines VERBATIM (backticks, the `granularity:"last_tool_call_group"`
      literal, the soft line breaks); NO trailing newline.
- [ ] **KB rounding:** `bytesToKb(8192)=8`, `bytesToKb(30720)=30`, `bytesToKb(8704)=9` (Math.round); non-finite/
      negative → 0.
- [ ] **Pinned drift text (spec/07 §2):** 3 lines joined by `"\n"`; first line varies per the if/else matrix;
      the two tail lines are FIXED and present in ALL cases; NO trailing newline.
- [ ] **k rounding:** `kTokens(4200)="4.2k"`, `kTokens(3000)="3k"`, `kTokens(9800)="9.8k"` (1 decimal).
- [ ] **Pluralization:** `resultWord(1)="result"`, `resultWord(2)="results"`, `resultWord(5)="results"`.
- [ ] **Null delta:** `deltaTokens===null` → the "added ~<k> tokens" clause is DROPPED; bloat leads as
      "Previous turn produced <N> bloated result(s)" (NOT rendered as "~0k", NOT missing a subject).
- [ ] **Never throws:** null/array/primitive metric, throwing-Proxy metric, NaN/negative/Infinity bytes → renders
      gracefully, no exception; `expect(() => renderDriftNudge(...)).not.toThrow()`.
- [ ] **Signatures exact:** `renderBloatReminder(_toolName: string, bytes: number, thresholdBytes: number): string`
      and `renderDriftNudge(metric: DriftNudgeInput): string` (not widened).
- [ ] **Snapshot tests (spec/10 §1.8-style):** representative bloat + drift inputs captured via `toMatchInlineSnapshot()`.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact `renderBloatReminder` + `renderDriftNudge` + helpers + `DriftNudgeInput` to
> APPEND are given verbatim below (Task 1), with the exact pinned expected-output strings (computed from spec/07
> §1/§2). The text is quoted verbatim from spec/07; the open rendering details (rounding/null-delta/pluralization/
> unused-toolName) are resolved in `research/design_decisions.md` §1–§8; the consumer contract from spec/07 §1/§2
> + spec/06 §1; the TurnMetric projection from spec/04 §5; the config defaults (8192/3000) from spec/09. The type
> seam (`DriftNudgeInput`) is defined inline. The baseline (6 files / 187 tests, tsc exit 0) and the snapshot
> convention (`toMatchInlineSnapshot`, `test/tokens.test.ts:48`) are verified live. No prior knowledge beyond
> "this APPENDS two pure renderers to the S1+S2 `notes.ts`" is required.

### Scope decision (READ BEFORE CODING)

- **APPEND to `src/notes.ts` — it ALREADY EXISTS (S1+S2 landed).** This is **S3 of 3**: ship ONLY
  `renderBloatReminder` + `renderDriftNudge` + `DriftNudgeInput` + the 5 module-private helpers. This COMPLETES
  `notes.ts` (spec/11 §1). Do NOT touch S1's `validateNote`/`NoteInput`/`NoteValidation`/`NOTE_INVALID_REASON`/
  `NOTE_FIELDS` or S2's `renderNote`/`LEDGER_BLOCKS`/`readNoteField`/`readLedgerList`.
- **APPEND to `test/notes.test.ts` — it ALREADY EXISTS (S1+S2 landed).** Keep S1/S2 tests intact; add the 3 names
  to the import and APPEND new `describe` blocks.
- **REUSE S1's module-private `isRecord` + `readOwn` (hoisted in module scope).** `readDelta`/`readBloatHits` call
  `readOwn`; `readBloatHits` calls `isRecord`. Do NOT redefine either. (Mirrors how S2's `readLedgerList` reused them.)
- **S3 adds NO imports.** `DriftNudgeInput` is defined inline (it is a self-contained 2-field projection); the
  renderers take primitives / the inline type. notes.ts's import block stays exactly the S2 two type-only lines.
- **Do NOT invent a tool-name mention in the bloat text.** The spec/07 §1 text has no `<toolName>` placeholder;
  `_toolName` is accepted-but-unused (reserved), exactly like `tokens.ts`'s `_model`. See GOTCHA #4.
- **Do NOT widen the public signatures.** Keep `renderBloatReminder(_toolName: string, bytes: number,
  thresholdBytes: number): string` and `renderDriftNudge(metric: DriftNudgeInput): string`. Use internal
  `readOwn`/`isRecord`/finite-number guards for runtime defense WITHOUT changing the param types (mirrors S2
  `renderNote` GOTCHA #7).

### Documentation & References

```yaml
# MUST READ — authoritative sources for the two renderers
- file: spec/07-preventive-and-nudges.md
  section: "§1 Nudge A — bloated-result reminder (renderBloatReminder)"
  why: "THE source of the exact bloat text (the ```md block: leading blank line + '---' + 4-line body with
        <KB>/<T>), the handler call site (renderBloatReminder(event.toolName, bytes, thresholdBytes) → pins the
        signature + that toolName is passed but NOT in the text), the 'threshold in BYTES' note, and the
        '~40 tokens, appended not replacing, advisory (D3)' contract."
  critical: "Text is VERBATIM — backticks, the granularity:\"last_tool_call_group\" literal, the soft line breaks.
             Leading blank line + '---' is a markdown horizontal rule → output starts with '\\n---\\n'. <KB> and <T>
             are bytes→KB via Math.round(n/1024)."

- file: spec/07-preventive-and-nudges.md
  section: "§2 Nudge B — per-turn drift nudge (renderDriftNudge)"
  why: "THE source of the exact drift text (the ```md block: '[mulligan] Previous turn added ~<delta>k tokens to
        your context< and produced <N> bloated result(s)>.' + 2 fixed tail lines), the conditional bloat clause
        '<...>', the 'deltaTokens null → bloatHit-only signaling' edge case, and the 'reached only when
        shouldNudge (= grewOverThreshold || bloatHit)' gate."
  critical: "First line VARIES (delta/bloat/both/null); the two tail lines are FIXED in all cases. <delta>k is
             deltaTokens/1000 with 1 decimal (h2.6 example '4.2k'). result(s) pluralizes. deltaTokens===null →
             drop the delta clause, lead with 'Previous turn produced <N> …'."

- file: spec/04-data-model.md
  section: "§5 Turn metric (for the nudge)"
  why: "THE TurnMetric schema (deltaTokens: number|null, bloatHits: {toolName:string; approxTokens:number}[]).
        renderDriftNudge takes the MINIMAL PROJECTION (deltaTokens + bloatHits) — DriftNudgeInput — not the full
        TurnMetric. Confirms a real TurnMetric is structurally assignable to DriftNudgeInput (mutable[] →
        ReadonlyArray is sound)."

- file: spec/06-context-filter.md
  section: "§1 (the context handler gate: shouldNudge(markers.metric, config) → injectNudge → renderDriftNudge)"
  why: "Confirms renderDriftNudge is reached ONLY when shouldNudge is true (grewOverThreshold || bloatHit), so the
        both-empty case is unreachable in practice — but the pure function is total (never throws)."

- file: spec/09-configuration.md
  section: "nudges defaults (bloatThresholdBytes:8192, driftThresholdTokens:3000)"
  why: "THE default thresholds the test fixtures use: 8192 bytes = 8 KB exactly; 3000 tokens = 3k."

- file: spec/10-testing.md
  section: "§1 Tier 1 (pure helpers, Vitest) + §2.1 F-shrink-preventive / F-nudge-drift"
  why: "Confirms notes.ts renderers are Tier-1 unit-tested (snapshot-style) and that the integration scenarios
        assert the rendered [mulligan] reminder / mulligan:nudge content appears."

- file: spec/11-build-order.md
  section: "§1 (notes.ts PURE: validateNote, renderNote, renderBloatReminder, renderDriftNudge) + Step 2"
  why: "Confirms notes.ts OWNS all four renderers (S3 completes it) and is consumed BY nudges.ts (P1.M6)."

# FILES TO CONSUME / APPEND TO (read-only contracts + the append targets)
- file: src/notes.ts
  why: "THE APPEND TARGET (S1+S2 landed it). REUSE the module-private isRecord + readOwn (defined ≈ lines 111-122) —
        call readOwn from readDelta/readBloatHits; call isRecord from readBloatHits. Do NOT redefine them. Leave
        S1/S2 exports UNCHANGED. S3 adds NO imports."
  pattern: "APPEND the S3 block at the END (after readLedgerList). Mirror the S1→S2 append style (the
            'S2 (P1.M2.T3.S2)' banner in src/notes.ts is the template for an 'S3 (P1.M2.T3.S3)' banner)."

- file: src/tokens.ts
  why: "The unused-param convention: estimateTokens(messages, _model?: unknown) reserves _model 'accepted for
        forward-compatible … calibration but NOT used in v1'. renderBloatReminder's _toolName follows the SAME
        convention (the handler passes toolName; the spec text doesn't use it). Also the defensive finite-number
        guard pattern (approxTokens: Number.isFinite guard) to mirror in bytesToKb."

- file: test/notes.test.ts
  why: "THE APPEND TARGET (S1+S2 landed it). Keep S1/S2 tests intact. Add renderBloatReminder + renderDriftNudge +
        type DriftNudgeInput to the existing ../src/notes.js import; APPEND renderer describe blocks. Reuse the
        module's TAIL-of-drift-nudge literal by defining a local DRIFT_TAIL constant."
  pattern: "Mirror test/tokens.test.ts (toMatchInlineSnapshot at line 48) + the S2 renderNote describe blocks
            (pinned .toBe() + toMatchInlineSnapshot + defensive + expectTypeOf)."

- file: test/tokens.test.ts
  why: "The snapshot convention: expect(...).toMatchInlineSnapshot(`11`) at line 48. Confirms vitest inline
        snapshots are the house style."
  pattern: "toMatchInlineSnapshot() — vitest AUTO-WRITES a NEW inline snapshot on first run (or run `npx vitest
            run -u` once). The pinned .toBe() tests are the AUTHORITATIVE format contract (fully deterministic)."

- file: plan/001_2e5baf25fe9f/P1M2T3S2/PRP.md
  why: "The S2 contract (the immediate predecessor, LANDED). Confirms the append-to-notes.ts style, the
        isRecord/readOwn reuse, the never-throws defensive discipline, the toMatchInlineSnapshot convention, and the
        'tsc + vitest, no lint command' gate. Treat as a contract."

- file: plan/001_2e5baf25fe9f/P1M2T3S3/research/design_decisions.md
  why: "THE resolution of every spec-open rendering detail (KB rounding §1, k rounding §2, _toolName §3, null-delta
        §4, defensive fallback §5, DriftNudgeInput type §6, defensive reading §7, leading \\n---\\n §8, test
        strategy §9). Implement EXACTLY these choices."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; devDeps typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler', include:['src','test']
│                           #   (NO noUnusedParameters/noUnusedLocals → unused params compile; codebase prefixes with _)
├── src/
│   ├── index.ts            # no-op stub. DO NOT TOUCH.
│   ├── config.ts           # exports Granularity. DO NOT TOUCH.
│   ├── log.ts / runtime.ts # DO NOT TOUCH.
│   ├── tokens.ts           # pure helper sibling (the _model unused-param convention; finite-number guard). DO NOT TOUCH.
│   ├── ledger.ts           # exports FileLedger. DO NOT TOUCH.
│   └── notes.ts            # S1+S2 LANDED (222 lines). APPEND renderBloatReminder + renderDriftNudge HERE.
├── test/
│   ├── config/ledger/log/runtime/tokens .test.ts   # Read-only.
│   └── notes.test.ts       # S1+S2 LANDED (392 lines / 41 tests). APPEND renderer tests HERE.
└── spec/                   # 07 §1/§2 (THE text) + 04 §5 (TurnMetric) + 06 §1 (gate) + 09 (defaults) + 10 §1 + 11 §1.
# VERIFIED BASELINE (run before starting): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` →
#   6 files / 187 tests green (config 21, ledger 39, log 15, notes 41, runtime 20, tokens 51). This task is pure +
#   additive (appends to 2 existing files); it cannot regress the baseline.
# NOTE: there is NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only).
#   The type+style gate is `tsc --noEmit` (TS strict). Do NOT invent a lint/format command.
```

### Desired Codebase tree with files to be APPENDED (THIS subtask)

```bash
pi-mulligan/
├── src/
│   └── notes.ts            # APPENDED — +DriftNudgeInput + renderBloatReminder + renderDriftNudge + 5 private helpers (end).
└── test/
    └── notes.test.ts       # APPENDED — +3 import names + renderBloatReminder/renderDriftNudge describe blocks.
# No other files touched. S1/S2 exports + isRecord/readOwn are UNCHANGED. NO new imports.
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — APPEND, do NOT rewrite src/notes.ts. S1+S2 landed validateNote/NoteInput/renderNote/
#   readNoteField/readLedgerList/LEDGER_BLOCKS/isRecord/readOwn. S3 ADDS: DriftNudgeInput + renderBloatReminder +
#   renderDriftNudge + bytesToKb/kTokens/resultWord/readDelta/readBloatHits at the END. REUSE isRecord/readOwn
#   (call them from readDelta/readBloatHits) — do NOT redefine them. Do NOT modify S1/S2 exports. (Mirrors how S2's
#   readLedgerList reused S1's readOwn.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — S3 adds NO imports. DriftNudgeInput is defined inline (a self-contained 2-field
#   projection of TurnMetric). The renderers take primitives / DriftNudgeInput. notes.ts's import block stays
#   EXACTLY the S2 two type-only lines (FileLedger, Granularity). Do NOT add `import type { TurnMetric }` — there
#   is no shared data-model module in v1's build order, and renderDriftNudge takes the minimal projection, not the
#   full metric. (A real TurnMetric is structurally assignable to DriftNudgeInput — mutable[] → ReadonlyArray.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 (CRITICAL) — renderBloatReminder output STARTS with "\n---\n" (a leading newline + the markdown
#   horizontal rule). This is VERBATIM from spec/07 §1's ```md block (blank line then '---'). The body is the 4
#   lines joined by "\n". NO trailing newline. Do NOT drop the leading "\n" (it ensures '---' renders as a rule,
#   not a setext heading, when Pi concatenates content blocks) and do NOT add a trailing "\n".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 (CRITICAL) — _toolName is ACCEPTED but UNUSED in the v1 text. The spec/07 §1 text has NO <toolName>
#   placeholder ("[mulligan] This result is ~<KB> KB …"). The handler passes event.toolName positionally. Name the
#   param `_toolName` (the `_` prefix signals intentional non-use) — this is the EXACT codebase convention: tokens.ts
#   `estimateTokens(messages, _model?: unknown)`. Do NOT invent a tool-name mention; do NOT drop the param (the
#   contract + handler call site require it). Callers pass positionally so the local name is internal.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 (CRITICAL) — KB rounding = Math.round(n/1024), applied to BOTH bytes and thresholdBytes. Non-finite
#   (NaN/±Infinity) or negative → 0 (a public helper may receive arbitrary input). bytesToKb(8192)=8,
#   bytesToKb(30720)=30 (the spec's "30 KB read"), bytesToKb(8704)=9 (Math.round(8.5)=9). The '~' tilde conveys
#   approximation, so integer KB is the granularity. k rounding (drift) = 1 decimal: kTokens(4200)="4.2k",
#   kTokens(3000)="3k" (JS drops the trailing .0 naturally). Do NOT mix the two (KB=integer per spec examples;
#   delta=1 decimal per the h2.6 "4.2k" example).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (CRITICAL) — renderDriftNudge first line is an explicit if/else over (delta!=null)×(bloat non-empty),
#   NOT a clause-array + " and "-join. The bloat clause's SUBJECT differs by position: when bloat LEADS (null
#   delta) it is "Previous turn produced <N> …"; when bloat FOLLOWS delta it is "… your context and produced <N>
#   …". A naive join would drop the subject (→ "[mulligan] produced 2 bloated results.") — WRONG. Branch explicitly.
#   deltaTokens===null means UNKNOWN (first turn/post-reload) — do NOT render it as "~0k" (that would be a lie);
#   drop the delta clause entirely and lead with bloat.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 (CRITICAL) — NEVER throws (fail-open nudge handlers; spec/07 §1/§2; E13). Read metric fields via
#   readOwn (Proxy-safe; a throwing-Proxy get-trap returns undefined, not an exception) + isRecord/Array.isArray
#   guards (mirrors S2's readLedgerList). A null/array/primitive/throwing-Proxy metric, NaN/negative bytes → render
#   gracefully, NEVER an exception. `expect(() => renderDriftNudge(...)).not.toThrow()` must pass. At the type
#   level DriftNudgeInput always has the fields, so TS may mark the defensive branches partly-unreachable — that is
#   fine; they compile cleanly and the runtime guard still executes for a type-violating caller. Do NOT add @ts-ignore.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — The two drift tail lines are FIXED in ALL cases: "If that growth was wasteful, consider
#   `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result)." and "Run `mulligan_audit` for a
#   breakdown." Only the first line varies. Return [firstLine, tail1, tail2].join("\n") — NO trailing newline.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — renderDriftNudge uses ONLY bloatHits.length for the count "<N>". The per-hit toolName/approxTokens
#   are part of the DriftNudgeInput projection (TurnMetric carries them) but are NOT interpolated into the v1 text
#   (reserved for richer future nudges) — same philosophy as renderBloatReminder's unused _toolName. Do NOT list
#   individual tools in the nudge.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — The test imports from "../src/notes.js" (.js extension, even though the file is notes.ts).
#   moduleResolution:"Bundler" + type:"module" → TS resolves .js to .ts. This is the established convention. Add
#   renderBloatReminder + renderDriftNudge + type DriftNudgeInput to the EXISTING ../src/notes.js import block.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — There is NO lint/format tool configured (devDeps = typescript + vitest + @types/node only). The
#   "Level 1 syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent a
#   ruff/eslint/prettier command — it would fail "command not found". Validation = tsc + vitest, nothing else.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #12 — toMatchInlineSnapshot(): vitest AUTO-WRITES a NEW (empty/missing) inline snapshot on the first
#   `vitest run` (a missing inline snapshot is treated as out-of-date and updated). So an empty
#   toMatchInlineSnapshot() call passes on first run AND populates the source. If your vitest version requires -u,
#   run `npx vitest run -u` once, then `npx vitest run` to confirm green. The pinned .toBe() tests are the
#   AUTHORITATIVE format contract and pass WITHOUT any snapshot write.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #13 — Body text VERBATIM. The bloat reminder body lines contain backticks (around tool names), a
#   `granularity:"last_tool_call_group"` literal with embedded double-quotes, and specific soft line breaks. Copy
#   them EXACTLY from the spec/07 §1 ```md block (provided verbatim in Task 1 below). Do NOT re-wrap, reflow,
#   "fix" the grammar, or change punctuation. The drift tail lines likewise — copy verbatim.
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

One new EXPORTED interface (`DriftNudgeInput`) + two EXPORTED functions. No new imports. The renderer consumes the
existing `TurnMetric` (spec/04 §5) by PROJECTION, not by import:

```ts
// NEW (defined inline in src/notes.ts — the minimal projection of TurnMetric, spec/04 §5):
export interface DriftNudgeInput {
  /** Signed estimate of how much context grew this turn; null when unknown (first turn / post-reload). */
  deltaTokens: number | null;
  /** Bloated tool results recorded this turn (empty array if none). Only .length is interpolated in v1 text. */
  bloatHits: ReadonlyArray<{ toolName: string; approxTokens: number }>;
}
// A real TurnMetric (mutable bloatHits: {...}[]) is ASSIGNABLE to DriftNudgeInput (mutable → readonly is sound) —
// so nudges.ts / filter.ts pass the full metric with NO cast (structural typing).
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY BASELINE (no edits — run only)
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 6 files / 187 tests green (notes = 41)
  - RUN: test -f src/notes.ts && grep -q 'export function renderNote' src/notes.ts && echo "ok: S2 notes.ts present"
  - RUN: grep -q 'function readOwn' src/notes.ts && grep -q 'function isRecord' src/notes.ts && echo "ok: isRecord/readOwn present (reuse — do NOT redefine)"

Task 1: APPEND renderBloatReminder + renderDriftNudge to src/notes.ts   (exact content below — copy verbatim)
  - EDIT (END of file): append the S3 comment banner + DriftNudgeInput + renderBloatReminder + renderDriftNudge +
    bytesToKb/kTokens/resultWord/readDelta/readBloatHits, AFTER S2's readLedgerList.
  - CONSTRAINTS:
      * NO imports added (DriftNudgeInput inline) — GOTCHA #2.
      * renderBloatReminder output starts "\n---\n"; _toolName unused; body VERBATIM — GOTCHA #3/#4/#13.
      * bytesToKb = Math.round(n/1024), non-finite/negative → 0; kTokens 1 decimal — GOTCHA #5.
      * renderDriftNudge first line via explicit if/else (NOT clause-join); null delta drops the delta clause —
        GOTCHA #6. Two tail lines FIXED — GOTCHA #8. Only bloatHits.length used — GOTCHA #9.
      * read defensively via readOwn/isRecord (reuse S1's); never throw — GOTCHA #7. No @ts-ignore.
      * signatures exactly renderBloatReminder(_toolName, bytes, thresholdBytes): string and
        renderDriftNudge(metric: DriftNudgeInput): string.
      * REUSE S1's isRecord/readOwn; do NOT redefine; do NOT touch S1/S2 exports — GOTCHA #1.
  - NAMING/PLACEMENT: src/notes.ts. New exports: DriftNudgeInput, renderBloatReminder, renderDriftNudge. New
    module-private: bytesToKb, kTokens, resultWord, readDelta, readBloatHits.

Task 2: APPEND renderer tests to test/notes.test.ts   (exact content below — copy verbatim)
  - EDIT 1 (imports): add renderBloatReminder + renderDriftNudge + type DriftNudgeInput to the ../src/notes.js import.
  - EDIT 2 (end): append a DRIFT_TAIL constant + the renderBloatReminder + renderDriftNudge describe blocks (pinned
    .toBe() + toMatchInlineSnapshot + defensive + expectTypeOf).
  - CONSTRAINTS: NO beforeEach (pure, stateless). Mirror tokens.test.ts + the S2 renderNote blocks. Keep S1/S2 tests.
  - COVERAGE: bloat pinned format (8 KB / 30 KB; leading \n---\n; no trailing newline; body verbatim); KB rounding
    (8704→9); defensive bytes (NaN/negative/Infinity→0 KB); drift pinned format (delta-only / delta+1-bloat /
    delta+3-bloat / null+2-bloat / null+empty); k rounding (3000→3k, 9800→9.8k); pluralization (1→result, 2/5→results);
    never-throws defensive (null/array/primitive/throwing-Proxy metric); expectTypeOf (both return string;
    DriftNudgeInput shape); snapshot representatives (toMatchInlineSnapshot).

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest, incl. `-u` once if a snapshot needs populating). Levels 3/4 N/A (pure helpers).
```

#### Exact content to APPEND — `src/notes.ts` (at the END of the file, after S2's `readLedgerList`)

```ts
// ─────────────────────────────────────────────────────────────────────────────
// S3 (P1.M2.T3.S3) — renderBloatReminder + renderDriftNudge (spec/07-preventive-and-nudges.md §1 + §2).
// APPENDED below the S1 exports/helpers + the S2 renderNote block, which are UNCHANGED and REUSED here
// (isRecord/readOwn are hoisted in this module scope; no redeclaration). This module already imports TYPE-ONLY
// { FileLedger } + { Granularity } (S2); S3 adds NO imports — DriftNudgeInput is defined inline, so notes.ts stays
// Pi-free and unit-testable in isolation. These two renderers are the TEXT core of the two nudges (P1.M6): consumed
// by nudges.ts (tool_result annotator + turn_end→context injector) but pure + unit-tested without Pi (spec/07 §3,
// spec/10 §1). This COMPLETES notes.ts (spec/11 §1: "validateNote, renderNote, renderBloatReminder, renderDriftNudge").
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DriftNudgeInput — the minimal projection of TurnMetric (spec/04-data-model.md §5) that renderDriftNudge needs.
 * A real TurnMetric is STRUCTURALLY ASSIGNABLE to this (a mutable `{...}[]` widens to `ReadonlyArray<{...}>`
 * soundly), so nudges.ts / filter.ts pass the full metric with NO cast. EXPORTED so the consumer + tests share one
 * type. `deltaTokens` is `null` when the token baseline is unknown (first turn / post-reload) — renderDriftNudge
 * then drops the "added ~<delta>k tokens" clause and leads with bloat (spec/07 §2 edge cases). Only `.length` of
 * bloatHits is interpolated into the v1 text; the per-hit toolName/approxTokens are reserved for richer nudges.
 */
export interface DriftNudgeInput {
  /** Signed estimate of how much context grew this turn; null when unknown (first turn / post-reload). */
  deltaTokens: number | null;
  /** Bloated tool results recorded this turn (empty array if none). */
  bloatHits: ReadonlyArray<{ toolName: string; approxTokens: number }>;
}

/**
 * renderBloatReminder — Nudge A's text (spec/07-preventive-and-nudges.md §1). Composes the short reminder the
 * tool_result handler APPENDS to a result's content when its byte size exceeds the threshold. The returned string
 * is the `text` of a `{type:"text"}` content block appended via `[...(event.content ?? []), {type:"text",
 * text:reminder}]`. ~40 tokens, incurred once per bloated result; advisory (D3) — appended, not replacing.
 *
 * FORMAT (spec/07 §1 — VERBATIM; the leading "\n" + "---" is a markdown horizontal rule separating the reminder
 * from the result body above it; body lines have SPEC-pinned soft line breaks — do NOT reflow):
 *     \n---\n
 *     [mulligan] This result is ~<KB> KB in your context (threshold <T> KB).
 *     If you don't need the full output going forward, call `mulligan_shrink` with a
 *     summary, or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole
 *     call was a mistake. (The hidden/shrunk content stays on disk for the human.)
 * <KB> = bytesToKb(bytes); <T> = bytesToKb(thresholdBytes). NO trailing newline.
 *
 * `toolName` is ACCEPTED (the handler passes event.toolName) but is NOT interpolated into the v1 text (the spec
 * text has no <toolName> placeholder) — RESERVED for future personalization, hence the `_` prefix. This mirrors
 * tokens.ts `estimateTokens(messages, _model?: unknown)` — the SAME convention for an accepted-but-unused param.
 *
 * DEFENSIVE — NEVER throws (fail-open nudge handler; spec/07 §1; E13). Non-finite/negative bytes or thresholdBytes
 * render as 0 KB (a public helper may receive arbitrary input; resultBytes never yields these but the guard keeps
 * the function total).
 *
 * @param _toolName       the tool that produced the result (ACCEPTED, NOT used in v1 text; reserved for future use)
 * @param bytes           the result's UTF-8 byte size (from resultBytes — spec/07 §1)
 * @param thresholdBytes  the configured bloat threshold in bytes (config.nudges.bloatThresholdBytes, default 8192)
 * @returns the reminder string (leading "\n---\n" + 4-line body; NO trailing newline)
 */
export function renderBloatReminder(
  _toolName: string,
  bytes: number,
  thresholdBytes: number,
): string {
  const resultKb = bytesToKb(bytes);
  const thresholdKb = bytesToKb(thresholdBytes);
  const body = [
    `[mulligan] This result is ~${resultKb} KB in your context (threshold ${thresholdKb} KB).`,
    "If you don't need the full output going forward, call `mulligan_shrink` with a",
    'summary, or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole',
    "call was a mistake. (The hidden/shrunk content stays on disk for the human.)",
  ].join("\n");
  return `\n---\n${body}`;
}

/**
 * renderDriftNudge — Nudge B's text (spec/07-preventive-and-nudges.md §2). Composes the annotation the context
 * handler injects as a NON-persisted `mulligan:nudge` custom message (via injectNudge — spec/06 §1 + spec/07 §2)
 * when the previous turn grew context over threshold OR produced bloated results. ~25–40 tokens, only when it fires.
 *
 * FORMAT (spec/07 §2 — the FIRST line VARIES by input; the two tail lines are FIXED in all cases):
 *     [mulligan] <first line>.
 *     If that growth was wasteful, consider `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result).
 *     Run `mulligan_audit` for a breakdown.
 * <first line> is an explicit if/else over (delta != null) × (bloat non-empty) — the bloat clause's SUBJECT differs
 * by position (see GOTCHA #6):
 *   - delta only:        "Previous turn added ~<k> tokens to your context"
 *   - delta + bloat:     "Previous turn added ~<k> tokens to your context and produced <N> bloated result(s)"
 *   - bloat only (null): "Previous turn produced <N> bloated result(s)"
 *   - both empty:        "Previous turn changed your context"   (unreachable via shouldNudge; totality fallback)
 * <k> = kTokens(delta) (delta/1000, 1 decimal: 4200→"4.2k", 3000→"3k"); <N> = bloatHits.length;
 * result(s) = resultWord(N) (1→"result", else "results"). NO trailing newline.
 *
 * DEFENSIVE — NEVER throws (fail-open nudge handler; spec/07 §2; E13). deltaTokens/bloatHits are read via readOwn
 * + isRecord/Array.isArray guards (mirrors S2's readLedgerList); a malformed/throwing-Proxy metric renders
 * gracefully. renderDriftNudge is reached ONLY when shouldNudge is true (grewOverThreshold || bloatHit — spec/06 §1),
 * so the both-empty case is unreachable in practice; it still returns a deterministic string so the pure function
 * is total. deltaTokens===null means UNKNOWN (first turn) — it is NOT rendered as "~0k" (a lie); the delta clause
 * is dropped and bloat leads.
 *
 * @param metric the drift metric projection (DriftNudgeInput — deltaTokens + bloatHits)
 * @returns the nudge string (3 lines joined by "\n"; NO trailing newline)
 */
export function renderDriftNudge(metric: DriftNudgeInput): string {
  const delta = readDelta(metric);
  const hits = readBloatHits(metric);
  let firstLine: string;
  if (delta != null && hits.length > 0) {
    firstLine = `Previous turn added ~${kTokens(delta)} tokens to your context and produced ${hits.length} bloated ${resultWord(hits.length)}`;
  } else if (delta != null) {
    firstLine = `Previous turn added ~${kTokens(delta)} tokens to your context`;
  } else if (hits.length > 0) {
    firstLine = `Previous turn produced ${hits.length} bloated ${resultWord(hits.length)}`;
  } else {
    firstLine = "Previous turn changed your context"; // unreachable via shouldNudge; totality fallback
  }
  return [
    `[mulligan] ${firstLine}.`,
    "If that growth was wasteful, consider `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result).",
    "Run `mulligan_audit` for a breakdown.",
  ].join("\n");
}

// ── S3 module-private helpers (mirror S2's readLedgerList; reuse S1's isRecord/readOwn) ─────────────

/**
 * bytesToKb — convert a byte count to an integer KB value for display (spec/07 §1 "<KB> KB"). Math.round(n/1024);
 * non-finite (NaN/±Infinity) or negative → 0. `bytesToKb(8192)=8`, `bytesToKb(30720)=30` (the spec's "30 KB
 * read"), `bytesToKb(8704)=9`. Module-private. NEVER throws.
 */
function bytesToKb(n: number): number {
  return Number.isFinite(n) && n >= 0 ? Math.round(n / 1024) : 0;
}

/**
 * kTokens — render a token delta as a "k" string (spec/07 §2 "~<delta>k"). Round to 1 decimal place: 4200→"4.2k",
 * 3000→"3k", 9800→"9.8k" (the spec h2.6 example shows "4.2k"; JS drops the trailing ".0" naturally). Module-private.
 */
function kTokens(delta: number): string {
  return `${Math.round((delta / 1000) * 10) / 10}k`;
}

/**
 * resultWord — pluralize "result" for the drift nudge bloat clause (spec/07 §2 "result(s)"). 1→"result",
 * else→"results". Module-private.
 */
function resultWord(n: number): string {
  return n === 1 ? "result" : "results";
}

/**
 * readDelta — read metric.deltaTokens as a finite number, else null (null = "unknown", e.g. first turn — spec/07 §2
 * edge cases). Defensive, never throws (a Proxy get-trap may throw — readOwn swallows it). Module-private; reuses
 * S1's readOwn. `deltaTokens === 0` is a real number (returns 0, not null); only a missing/non-number → null.
 */
function readDelta(metric: unknown): number | null {
  const v = readOwn(metric, "deltaTokens");
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * readBloatHits — read metric.bloatHits as a filtered array of {toolName, approxTokens} (only records with a string
 * toolName + finite number approxTokens survive; [] if absent/non-array). The COUNT (renderDriftNudge uses .length)
 * is therefore robust to malformed entries. Defensive, never throws. Module-private; reuses S1's isRecord/readOwn
 * (mirrors S2's readLedgerList).
 */
function readBloatHits(metric: unknown): Array<{ toolName: string; approxTokens: number }> {
  const v = readOwn(metric, "bloatHits");
  if (!Array.isArray(v)) return [];
  const out: Array<{ toolName: string; approxTokens: number }> = [];
  for (const hit of v) {
    if (isRecord(hit)) {
      const toolName = readOwn(hit, "toolName");
      const approxTokens = readOwn(hit, "approxTokens");
      if (typeof toolName === "string" && typeof approxTokens === "number" && Number.isFinite(approxTokens)) {
        out.push({ toolName, approxTokens });
      }
    }
  }
  return out;
}
```

#### Exact content to APPEND — `test/notes.test.ts` EDIT 1: extend the existing `../src/notes.js` import

Replace the existing import block:
```ts
import {
  validateNote,
  renderNote,
  NOTE_INVALID_REASON,
  type NoteInput,
  type NoteValidation,
} from "../src/notes.js";
```
with (add the three new names — alphabetical-ish within the existing order):
```ts
import {
  validateNote,
  renderNote,
  renderBloatReminder,
  renderDriftNudge,
  NOTE_INVALID_REASON,
  type NoteInput,
  type NoteValidation,
  type DriftNudgeInput,
} from "../src/notes.js";
```

#### Exact content to APPEND — `test/notes.test.ts` EDIT 2: the renderer test blocks (at the END of the file)

```ts
// ─────────────────────────────────────────────────────────────────────────────
// S3 (P1.M2.T3.S3) — renderBloatReminder + renderDriftNudge tests
// (spec/07-preventive-and-nudges.md §1 + §2; spec/10-testing.md §1 Tier 1).
// APPENDED below the S1 validateNote + S2 renderNote tests, which are UNCHANGED.
// ─────────────────────────────────────────────────────────────────────────────

/** The two FIXED tail lines of the drift nudge (spec/07 §2) — reused across every drift case. */
const DRIFT_TAIL = [
  "If that growth was wasteful, consider `mulligan_rewind` (undo the turn) or `mulligan_shrink` (compact a result).",
  "Run `mulligan_audit` for a breakdown.",
];

describe("renderBloatReminder — spec/07 §1 pinned format", () => {
  it("8 KB result at the 8 KB default threshold → '~8 KB … (threshold 8 KB)'; leading \\n---\\n; no trailing newline", () => {
    const out = renderBloatReminder("read", 8192, 8192);
    expect(out).toBe(
      "\n---\n" +
        [
          "[mulligan] This result is ~8 KB in your context (threshold 8 KB).",
          "If you don't need the full output going forward, call `mulligan_shrink` with a",
          'summary, or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole',
          "call was a mistake. (The hidden/shrunk content stays on disk for the human.)",
        ].join("\n"),
    );
    expect(out.startsWith("\n---\n")).toBe(true);
    expect(out.endsWith("\n")).toBe(false); // GOTCHA #3 — no trailing newline
  });

  it("30 KB result (the spec's '30 KB read') at 8 KB threshold → '~30 KB … (threshold 8 KB)'", () => {
    const out = renderBloatReminder("read", 30720, 8192);
    expect(out).toContain("[mulligan] This result is ~30 KB in your context (threshold 8 KB).");
  });

  it("bytes round to the nearest KB (8704 bytes = 8.5 KB → '~9 KB')", () => {
    const out = renderBloatReminder("bash", 8704, 8192);
    expect(out).toContain("This result is ~9 KB in your context (threshold 8 KB).");
  });

  it("body text is VERBATIM (backticks, the granularity literal, the soft line breaks — GOTCHA #13)", () => {
    const out = renderBloatReminder("read", 8192, 8192);
    expect(out).toContain("call `mulligan_shrink` with a\nsummary, or");
    expect(out).toContain('`mulligan_rewind(granularity:"last_tool_call_group")`');
    expect(out).toContain("(The hidden/shrunk content stays on disk for the human.)");
  });

  it("toolName is accepted but NOT interpolated into the v1 text (GOTCHA #4)", () => {
    const a = renderBloatReminder("read", 8192, 8192);
    const b = renderBloatReminder("grep", 8192, 8192);
    expect(a).toBe(b); // identical regardless of toolName — the spec text has no tool-name placeholder
    expect(a).not.toContain("read");
    expect(a).not.toContain("grep");
  });
});

describe("renderBloatReminder — defensive (NEVER throws / bad numbers → 0 KB — GOTCHA #5/#7)", () => {
  it("NaN bytes → '~0 KB'", () => {
    expect(renderBloatReminder("read", NaN, 8192)).toContain("This result is ~0 KB in your context (threshold 8 KB).");
  });
  it("negative bytes → '~0 KB'", () => {
    expect(renderBloatReminder("read", -100, 8192)).toContain("This result is ~0 KB in your context (threshold 8 KB).");
  });
  it("Infinity bytes → '~0 KB'", () => {
    expect(renderBloatReminder("read", Infinity, 8192)).toContain("This result is ~0 KB in your context (threshold 8 KB).");
  });
  it("non-finite threshold → 'threshold 0 KB'", () => {
    expect(renderBloatReminder("read", 8192, NaN)).toContain("(threshold 0 KB).");
  });
  it("never throws on any number input", () => {
    expect(() => renderBloatReminder("read", NaN, NaN)).not.toThrow();
    expect(() => renderBloatReminder("read", -Infinity, Infinity)).not.toThrow();
  });
});

describe("renderBloatReminder — snapshot-style (spec/10 §1.8-style)", () => {
  // toMatchInlineSnapshot() with no argument: vitest AUTO-WRITES the snapshot on first run (GOTCHA #12).
  // If your vitest version requires it, run `npx vitest run -u` once, then `npx vitest run`.
  it("representative 30 KB read at the 8 KB default threshold", () => {
    expect(renderBloatReminder("read", 30720, 8192)).toMatchInlineSnapshot();
  });
});

describe("renderDriftNudge — spec/07 §2 pinned format (first line varies; tails FIXED)", () => {
  it("delta only (4200 tokens) → 'added ~4.2k tokens'; no bloat clause; no trailing newline", () => {
    const out = renderDriftNudge({ deltaTokens: 4200, bloatHits: [] });
    expect(out).toBe(["[mulligan] Previous turn added ~4.2k tokens to your context.", ...DRIFT_TAIL].join("\n"));
    expect(out.endsWith("\n")).toBe(false);
    expect(out).not.toContain("bloated");
  });

  it("delta + 1 bloat hit → '… and produced 1 bloated result' (singular)", () => {
    const out = renderDriftNudge({
      deltaTokens: 5000,
      bloatHits: [{ toolName: "read", approxTokens: 7680 }],
    });
    expect(out).toBe(
      ["[mulligan] Previous turn added ~5k tokens to your context and produced 1 bloated result.", ...DRIFT_TAIL].join("\n"),
    );
  });

  it("delta + 3 bloat hits → '… and produced 3 bloated results' (plural)", () => {
    const out = renderDriftNudge({
      deltaTokens: 8000,
      bloatHits: [
        { toolName: "read", approxTokens: 2000 },
        { toolName: "bash", approxTokens: 1500 },
        { toolName: "read", approxTokens: 3000 },
      ],
    });
    expect(out).toContain("[mulligan] Previous turn added ~8k tokens to your context and produced 3 bloated results.");
  });

  it("null delta + 2 bloat hits (first turn) → bloat LEADS as 'Previous turn produced 2 bloated results' (GOTCHA #6)", () => {
    const out = renderDriftNudge({
      deltaTokens: null,
      bloatHits: [
        { toolName: "read", approxTokens: 2048 },
        { toolName: "bash", approxTokens: 1024 },
      ],
    });
    expect(out).toBe(["[mulligan] Previous turn produced 2 bloated results.", ...DRIFT_TAIL].join("\n"));
    expect(out).not.toContain("added ~"); // the delta clause is DROPPED, not rendered as "~0k"
  });

  it("null delta + empty bloat (defensive, unreachable via shouldNudge) → neutral fallback line", () => {
    const out = renderDriftNudge({ deltaTokens: null, bloatHits: [] });
    expect(out).toBe(["[mulligan] Previous turn changed your context.", ...DRIFT_TAIL].join("\n"));
  });

  it("the two tail lines are FIXED and present in EVERY case", () => {
    const cases: DriftNudgeInput[] = [
      { deltaTokens: 4200, bloatHits: [] },
      { deltaTokens: 5000, bloatHits: [{ toolName: "read", approxTokens: 7680 }] },
      { deltaTokens: null, bloatHits: [{ toolName: "read", approxTokens: 2048 }] },
      { deltaTokens: null, bloatHits: [] },
    ];
    for (const c of cases) {
      const out = renderDriftNudge(c);
      expect(out).toContain(DRIFT_TAIL[0]);
      expect(out).toContain(DRIFT_TAIL[1]);
    }
  });
});

describe("renderDriftNudge — rounding & pluralization", () => {
  it("kTokens: 3000→'3k' (trailing .0 dropped), 9800→'9.8k', 42000→'42k'", () => {
    expect(renderDriftNudge({ deltaTokens: 3000, bloatHits: [] })).toContain("added ~3k tokens");
    expect(renderDriftNudge({ deltaTokens: 9800, bloatHits: [] })).toContain("added ~9.8k tokens");
    expect(renderDriftNudge({ deltaTokens: 42000, bloatHits: [] })).toContain("added ~42k tokens");
  });

  it("pluralization: 1→'result', 2→'results', 5→'results'", () => {
    const one = renderDriftNudge({ deltaTokens: null, bloatHits: [{ toolName: "x", approxTokens: 1 }] });
    expect(one).toContain("produced 1 bloated result.");
    const two = renderDriftNudge({
      deltaTokens: null,
      bloatHits: [{ toolName: "a", approxTokens: 1 }, { toolName: "b", approxTokens: 2 }],
    });
    expect(two).toContain("produced 2 bloated results.");
    const five = renderDriftNudge({
      deltaTokens: null,
      bloatHits: [1, 2, 3, 4, 5].map((i) => ({ toolName: `t${i}`, approxTokens: i })),
    });
    expect(five).toContain("produced 5 bloated results.");
  });
});

describe("renderDriftNudge — defensive (NEVER throws — GOTCHA #7)", () => {
  it("a null metric passed as DriftNudgeInput → neutral fallback, not a throw", () => {
    expect(() => renderDriftNudge(null as unknown as DriftNudgeInput)).not.toThrow();
    expect(renderDriftNudge(null as unknown as DriftNudgeInput)).toContain("[mulligan] Previous turn changed your context.");
  });

  it("an array metric → neutral fallback, not a throw", () => {
    expect(() => renderDriftNudge([1, 2, 3] as unknown as DriftNudgeInput)).not.toThrow();
  });

  it("a metric with non-array bloatHits → no bloat clause, not a throw", () => {
    const out = renderDriftNudge({ deltaTokens: 4000, bloatHits: "nope" as unknown as DriftNudgeInput["bloatHits"] });
    expect(out).toContain("added ~4k tokens to your context.");
    expect(out).not.toContain("bloated");
  });

  it("a metric with malformed bloat-hit entries → they are not counted", () => {
    const out = renderDriftNudge({
      deltaTokens: null,
      bloatHits: [{ toolName: "read", approxTokens: 100 }, { foo: "bar" }, null, 42] as unknown as DriftNudgeInput["bloatHits"],
    });
    // only the first (valid) entry counts → "produced 1 bloated result."
    expect(out).toContain("produced 1 bloated result.");
  });

  it("does not throw on a throwing-Proxy metric (readOwn swallows the get-trap)", () => {
    const trap = new Proxy(
      { deltaTokens: 4200, bloatHits: [] } as DriftNudgeInput,
      new Proxy(
        {},
        {
          get() {
            throw new Error("trap");
          },
        },
      ),
    );
    expect(() => renderDriftNudge(trap)).not.toThrow();
    // every read throws → delta null + bloat [] → neutral fallback
    expect(renderDriftNudge(trap)).toContain("[mulligan] Previous turn changed your context.");
  });
});

describe("renderDriftNudge — snapshot-style (spec/10 §1.8-style)", () => {
  it("representative drift-only nudge (~4.2k tokens)", () => {
    expect(renderDriftNudge({ deltaTokens: 4200, bloatHits: [] })).toMatchInlineSnapshot();
  });

  it("representative first-turn bloat-only nudge (null delta + 2 hits)", () => {
    expect(
      renderDriftNudge({
        deltaTokens: null,
        bloatHits: [
          { toolName: "read", approxTokens: 2048 },
          { toolName: "bash", approxTokens: 1024 },
        ],
      }),
    ).toMatchInlineSnapshot();
  });
});

describe("renderers — types", () => {
  it("renderBloatReminder returns a string", () => {
    expectTypeOf(renderBloatReminder("read", 8192, 8192)).toEqualTypeOf<string>();
  });

  it("renderDriftNudge returns a string", () => {
    expectTypeOf(renderDriftNudge({ deltaTokens: 4200, bloatHits: [] })).toEqualTypeOf<string>();
  });

  it("DriftNudgeInput is the 2-field metric projection (spec/04 §5)", () => {
    expectTypeOf<DriftNudgeInput>().toEqualTypeOf<{
      deltaTokens: number | null;
      bloatHits: ReadonlyArray<{ toolName: string; approxTokens: number }>;
    }>();
  });
});
```

### Implementation Patterns & Key Details

```ts
// PATTERN (renderBloatReminder): build the 4-line body, prefix "\n---\n" (GOTCHA #3). _toolName unused (GOTCHA #4).
//   KB via bytesToKb (Math.round(n/1024), guarded). Body lines VERBATIM (GOTCHA #13). NO trailing newline.
const body = [
  `[mulligan] This result is ~${bytesToKb(bytes)} KB in your context (threshold ${bytesToKb(thresholdBytes)} KB).`,
  "If you don't need the full output going forward, call `mulligan_shrink` with a",
  'summary, or `mulligan_rewind(granularity:"last_tool_call_group")` if the whole',
  "call was a mistake. (The hidden/shrunk content stays on disk for the human.)",
].join("\n");
return `\n---\n${body}`;

// PATTERN (renderDriftNudge): explicit if/else over (delta!=null)×(bloat) — NOT a clause-join (GOTCHA #6). The
//   bloat clause's SUBJECT differs by position ("Previous turn produced" leads; "and produced" follows). null
//   delta is DROPPED, never rendered as "~0k". Two tail lines FIXED (GOTCHA #8). Only bloatHits.length used (GOTCHA #9).
const delta = readDelta(metric);                  // finite number | null (readOwn-guarded — GOTCHA #7)
const hits = readBloatHits(metric);               // filtered {toolName,approxTokens}[] (isRecord/Array-guarded)
let firstLine: string;
if (delta != null && hits.length > 0) {
  firstLine = `Previous turn added ~${kTokens(delta)} tokens to your context and produced ${hits.length} bloated ${resultWord(hits.length)}`;
} else if (delta != null) {
  firstLine = `Previous turn added ~${kTokens(delta)} tokens to your context`;
} else if (hits.length > 0) {
  firstLine = `Previous turn produced ${hits.length} bloated ${resultWord(hits.length)}`;
} else {
  firstLine = "Previous turn changed your context";
}
return [`[mulligan] ${firstLine}.`, DRIFT_TAIL_1, DRIFT_TAIL_2].join("\n");   // NO trailing newline (GOTCHA #8)

// PATTERN: read defensively via readOwn/isRecord (S1's helpers) so the renderers NEVER throw (GOTCHA #7). At the
//   type level DriftNudgeInput always has the fields, so TS may mark the defensive branches partly-unreachable —
//   that is fine; they compile cleanly and the runtime guard still executes for a type-violating caller.
function readDelta(metric: unknown): number | null {
  const v = readOwn(metric, "deltaTokens");
  return typeof v === "number" && Number.isFinite(v) ? v : null;   // null = unknown (first turn), NOT 0
}
function readBloatHits(metric: unknown): Array<{ toolName: string; approxTokens: number }> {
  const v = readOwn(metric, "bloatHits");
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const hit of v) {
    if (isRecord(hit)) {
      const toolName = readOwn(hit, "toolName");
      const approxTokens = readOwn(hit, "approxTokens");
      if (typeof toolName === "string" && typeof approxTokens === "number" && Number.isFinite(approxTokens)) {
        out.push({ toolName, approxTokens });
      }
    }
  }
  return out;
}
```

### Integration Points

```yaml
# This task adds NO runtime integration points — it APPENDS two pure helpers + a type. It PERSISTS nothing and calls
# nothing. The only seams are the EXPORTS:

EXPORTS (consumed by downstream tasks):
  - renderBloatReminder → nudges.ts tool_result annotator (P1.M6.T1.S1): the tool_result handler calls
    renderBloatReminder(event.toolName, bytes, config.nudges.bloatThresholdBytes) and appends the returned string
    as {type:"text", text:<rendered>} to the result's content (spec/07 §1).
  - renderDriftNudge → nudges.ts injectNudge (P1.M6.T2.S2): the context handler calls renderDriftNudge(metric)
    when shouldNudge(metric) is true and injects the returned string as a NON-persisted mulligan:nudge custom
    message's content (spec/06 §1 + spec/07 §2).
  - DriftNudgeInput → the type nudges.ts / filter.ts pass as `metric` (a projection of TurnMetric; structurally
    assignable, no cast needed).

IMPORTS: NONE added (S3 adds zero imports; DriftNudgeInput is inline).

REUSED (from S1, UNCHANGED):
  - isRecord / readOwn → module-private; called by readDelta/readBloatHits. NOT redefined.

CONFIG:    none (the thresholds are PASSED IN as params by the handler; renderers take no config).
DATABASE:  none (pure; persists nothing).
ROUTES:    none (no Pi surface at S3).
RUNTIME:   none (pure; no module-scoped mutable state added).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after appending src/notes.ts — fix before proceeding.
# NOTE: there is NO eslint/prettier/biome configured (devDeps = typescript + vitest + @types/node only).
# TS strict IS the type+style gate. (GOTCHA #11 — do NOT invent a lint/format command.)

# Type-check the appended module + test under strict.
npx tsc --noEmit -p tsconfig.json            # Expected: exit 0. If errors, READ the output and fix.

# Sanity: S3 added NO imports (the import block is still exactly S2's two type-only lines).
test -z "$(grep -nE '^import ' src/notes.ts | grep -v 'import type ')" && echo "ok: no runtime imports" \
  || { echo "FAIL: a runtime import was added"; grep -nE '^import ' src/notes.ts | grep -v 'import type '; }
test "$(grep -cE '^import type \{ (FileLedger|Granularity) \}' src/notes.ts)" -eq 2 && echo "ok: only the 2 S2 type-only imports"

# Sanity: both renderers are exported and reuse S1's readOwn/isRecord (not redefined).
grep -q 'export function renderBloatReminder' src/notes.ts && echo "ok: renderBloatReminder exported"
grep -q 'export function renderDriftNudge' src/notes.ts && echo "ok: renderDriftNudge exported"
test "$(grep -c 'function readOwn' src/notes.ts)" -eq 1 && echo "ok: readOwn defined once (reused)"
test "$(grep -c 'function isRecord' src/notes.ts)" -eq 1 && echo "ok: isRecord defined once (reused)"

# Expected: tsc exit 0; "ok" lines for the sanity checks.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Run the grown notes suite (S1 validateNote + S2 renderNote + S3 renderer tests).
npx vitest run test/notes.test.ts          # Expected: all notes tests pass.

# toMatchInlineSnapshot() auto-writes NEW snapshots on first run (GOTCHA #12). If your vitest version requires -u:
npx vitest run test/notes.test.ts -u       # populate the inline snapshots, then re-run clean:
npx vitest run test/notes.test.ts          # Expected: green (snapshots now pinned in source).

# Full suite — confirm NO regression to the baseline (6 files / 187 tests → 6 files / 187+N).
npx vitest run                             # Expected: 6 files all green.

# Expected: all tests pass. If failing, debug root cause and fix the implementation (do NOT weaken the tests —
#   the pinned text + rounding + pluralization + null-delta contract is spec-mandated).
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A — both renderers are pure helpers with NO Pi runtime surface. There is no server to start, no endpoint, no
# MCP tool, no database. Integration is exercised later by nudges.ts (P1.M6.T1.S1 tool_result annotator calls
# renderBloatReminder; P1.M6.T2.S2 injectNudge calls renderDriftNudge) and the integration smoke harness
# (P1.M7.T2.S1: F-shrink-preventive asserts the appended [mulligan] reminder is in the result content; F-nudge-drift
# asserts the mulligan:nudge custom message ends the filtered view). This subtask's "integration" is the tsc +
# vitest gates above. (See GOTCHA #11 — do not invent commands.)
```

### Level 4: Creative & Domain-Specific Validation

```bash
# N/A for these pure helpers. The domain-specific validation (the advisory, zero-extra-request, salient-at-the-
# moment property — D3/D4) is encoded directly in the Level-2 pinned-format tests: the rendered strings EXACTLY
# match spec/07 §1/§2 (bloat reminder = leading \n---\n + the 4-line body with <KB>/<T> filled; drift nudge = the
# varying first line + the two fixed tail lines), with correct KB/k rounding, pluralization, null-delta handling,
# and the conditional bloat clause. There is nothing further to run at S3. (Performance/security/load testing apply
# to the handler layer, not these pure string functions.)
```

---

## Final Validation Checklist

### Technical Validation

- [ ] Level 1 green: `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] S3 added NO imports (the import block is still exactly S2's two `import type` lines; no runtime import).
- [ ] Both renderers exported; `readOwn`/`isRecord` each defined ONCE (reused from S1, not redefined).
- [ ] Level 2 green: `npx vitest run` → 6 files all pass (no regression to the 187-test baseline).
- [ ] `npx vitest run test/notes.test.ts` → all notes tests pass (S1 + S2 + S3); snapshots populated (`-u` if needed).

### Feature Validation

- [ ] **Pinned bloat text (spec/07 §1):** output starts `"\n---\n"`; `<KB>`=`bytesToKb(bytes)`, `<T>`=`bytesToKb(thresholdBytes)`;
      body lines VERBATIM; NO trailing newline.
- [ ] **KB rounding:** `bytesToKb(8192)=8`, `bytesToKb(30720)=30`, `bytesToKb(8704)=9`; non-finite/negative → 0.
- [ ] **Pinned drift text (spec/07 §2):** 3 lines joined by `"\n"`; first line via the if/else matrix; the two tail
      lines FIXED in all cases; NO trailing newline.
- [ ] **k rounding:** `kTokens(4200)="4.2k"`, `kTokens(3000)="3k"`, `kTokens(9800)="9.8k"`.
- [ ] **Pluralization:** `resultWord(1)="result"`, `resultWord(2)="results"`, `resultWord(5)="results"`.
- [ ] **Null delta:** `deltaTokens===null` → delta clause DROPPED (not "~0k"); bloat leads as
      "Previous turn produced <N> bloated result(s)".
- [ ] **Conditional bloat clause:** present iff `bloatHits` non-empty.
- [ ] **_toolName:** accepted, NOT interpolated (identical output regardless of toolName).
- [ ] **Never throws:** null/array/primitive/throwing-Proxy metric, NaN/negative/Infinity bytes → renders, no exception.
- [ ] **Signatures exact:** `renderBloatReminder(_toolName: string, bytes: number, thresholdBytes: number): string`
      and `renderDriftNudge(metric: DriftNudgeInput): string`.

### Code Quality Validation

- [ ] Mirrors `tokens.ts`/S1-`notes.ts`/S2-`notes.ts` conventions (module banner, defensive reads, never-throws,
      `_`-prefix for unused params).
- [ ] APPENDS to the existing files (S1/S2 exports + `isRecord`/`readOwn` UNCHANGED); does NOT rewrite.
- [ ] `bytesToKb`/`kTokens`/`resultWord`/`readDelta`/`readBloatHits` are module-private (not exported).
- [ ] Anti-patterns avoided (see below).

### Documentation & Deployment

- [ ] S3 banner cites spec/07 §1/§2 + the S1/S2-reuse + the snapshot-test mandate + that this completes notes.ts.
- [ ] Both renderers' doc-comments reproduce the spec/07 format + the defensive contract + the rounding rules.
- [ ] No new environment variables (pure; zero imports added).

---

## Anti-Patterns to Avoid

- ❌ Don't REWRITE `src/notes.ts` — APPEND (GOTCHA #1). Reuse S1's `isRecord`/`readOwn`; leave S1/S2 exports intact.
- ❌ Don't add an import (GOTCHA #2) — `DriftNudgeInput` is inline; there is no shared data-model module to import
  `TurnMetric` from, and the renderer takes the minimal projection anyway.
- ❌ Don't drop the leading `"\n---\n"` from the bloat reminder (GOTCHA #3) — it is verbatim from spec/07 §1.
- ❌ Don't invent a tool-name mention in the bloat text (GOTCHA #4) — the spec text has no placeholder; `_toolName`
  is reserved. Don't drop the param either (the contract + handler call site require it).
- ❌ Don't mix the KB/delta rounding (GOTCHA #5) — KB = integer `Math.round(n/1024)`; delta = 1-decimal `kTokens`.
  Don't render a non-finite/negative number as NaN/Infinity — guard to 0.
- ❌ Don't build the drift first line with a clause-array + `" and "`-join (GOTCHA #6) — the bloat clause loses its
  subject when it leads. Branch explicitly. Don't render `null` delta as `"~0k"` (a lie) — drop the clause.
- ❌ Don't read metric fields directly (`metric.deltaTokens`) bypassing Proxy safety, and don't CRASH on a malformed
  metric — use `readOwn`/`isRecord` so the renderer never throws (GOTCHA #7). Don't add `@ts-ignore` for the
  partly-unreachable defensive branches — they compile cleanly.
- ❌ Don't vary the two drift tail lines or add a trailing newline (GOTCHA #8) — they are FIXED; `join("\n")` is
  correct as-is.
- ❌ Don't interpolate individual bloat-hit tool names/tokens into the drift nudge (GOTCHA #9) — only `.length` is
  used in v1; the per-hit data is reserved.
- ❌ Don't reflow/reformat the spec body text (GOTCHA #13) — copy the lines VERBATIM (backticks, the
  `granularity:"last_tool_call_group"` literal, the soft line breaks).
- ❌ Don't widen the signatures (e.g. `metric: DriftNudgeInput | null`) — keep the pinned types; use internal guards.