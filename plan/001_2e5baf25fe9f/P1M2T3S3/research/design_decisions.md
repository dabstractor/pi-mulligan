# Design Decisions — P1.M2.T3.S3 (renderBloatReminder + renderDriftNudge)

The spec (spec/07 §1/§2) pins the TEXT but leaves several rendering details open (rounding, the null-delta shape,
pluralization mechanics, the leading `---` newline, the unused `toolName` param). Each open detail is resolved
below with a PINNED, deterministic choice + rationale. The PRP's pinned `.toBe()` tests assert these EXACTLY.

---

## §1 — KB conversion (renderBloatReminder): `Math.round(bytes / 1024)` → integer KB

- The `<KB>` placeholder is the result size in KB. Input is `bytes` (a UTF-8 byte count from `resultBytes`).
- **Choice:** `kb(n) = Number.isFinite(n) && n >= 0 ? Math.round(n / 1024) : 0` for BOTH `bytes` and
  `thresholdBytes`.
- **Rationale:** every spec example is an integer — `8192 → 8 KB` (default threshold, spec/09), "a 30 KB `read`"
  (spec/07 §1, = 30720 bytes → 30), "8 KB ≈ 2k tokens" (8192/1024 = 8 exactly). The `~` tilde already conveys
  approximation, so integer KB is the right granularity. `Math.round` (not floor/ceil) is symmetric.
- **Defensive guard:** non-finite (`NaN`/`±Infinity`) or negative → 0 (a public helper may receive arbitrary input;
  `resultBytes` never yields these but the guard keeps the function total). NEVER throws.

## §2 — delta→k conversion (renderDriftNudge): round to 1 decimal place; "4.2k", "3k"

- The `<delta>k` placeholder is `TurnMetric.deltaTokens` in thousands. Input is `deltaTokens: number | null`.
- **Choice:** `kTokens(delta) = `${Math.round((delta / 1000) * 10) / 10}k``. Examples: 4200→"4.2k",
  3000→"3k", 9800→"9.8k", 42000→"42k", 0→"0k".
- **Rationale:** spec h2.6 ("The two nudges, plain-language summary") gives the ONLY concrete example number for
  this nudge: `"[mulligan: last turn +4.2k tokens; rewind available]"` — explicitly ONE decimal place. The drift
  threshold (3000) makes one-decimal granularity meaningful (3.2k vs 3.8k). JS numbers drop the trailing ".0"
  naturally (`${3}` === `"3"`, not `"3.0"`), so 3000→"3k" with no special-casing.
- **Why not integer k (like KB):** the h2.6 example pins 1 decimal; integer k would contradict the one concrete
  example. KB and delta genuinely differ (KB examples are all integers; the delta example is 4.2k).
- **Negative delta:** rendered literally (e.g. -2000 → "-2k"). This is UNREACHABLE in practice — the filter
  suppresses the nudge when a `mulligan:rewind`/`mulligan:shrink` marker was created during the turn (spec/07 §2
  edge cases: "Negative delta … To avoid nagging after the agent already acted, the filter suppresses the nudge").
  Rendering literally is honest + deterministic; no special-case needed.

## §3 — `toolName` is ACCEPTED but UNUSED in the v1 text → name it `_toolName`

- The spec/07 §1 ```md text contains NO `<toolName>` placeholder ("[mulligan] This result is ~<KB> KB …"). The
  handler DOES pass `event.toolName` positionally (`renderBloatReminder(event.toolName, bytes, thresholdBytes)`),
  so the param is part of the public signature.
- **Choice:** `export function renderBloatReminder(_toolName: string, bytes: number, thresholdBytes: number): string`.
  The `_` prefix signals "intentionally unused in v1" (reserved for future personalization, e.g. "the `read` result
  is ~30 KB"). The caller passes positionally, so the local name is internal and does not affect the contract.
- **Rationale:** this is the EXACT codebase convention — `tokens.ts` `estimateTokens(messages, _model?: unknown)`
  reserves `_model` the same way (spec/03 §2.3: "the `model` parameter is accepted for forward-compatible,
  model-specific calibration but is NOT used in v1"). `tsconfig` does NOT set `noUnusedParameters`, so an
  unprefixed `toolName` would also compile — but `_toolName` is cleaner, idiomatic, and self-documenting.
- **CRITICAL:** do NOT invent a tool-name mention in the text — the pinned spec text is the authority.

## §4 — `deltaTokens === null` → drop the "added ~<delta>k tokens" clause; lead with bloat

- spec/07 §2 edge cases: "First turn / post-reload: `tokenBaseline` is null → `deltaTokens` null → nudge falls
  back to `bloatHit`-only signaling." spec/04 §5: "If the baseline is missing … `deltaTokens` is `null`."
- **Choice:** build the first line with an explicit if/else over the (deltaPresent × bloatPresent) matrix. The
  bloat clause's SUBJECT differs by position — when bloat LEADS (delta null) it is `Previous turn produced <N> …`;
  when bloat FOLLOWS delta it is `… your context and produced <N> …`. A naive clause-array + `" and "`-join would
  drop the subject (→ `[mulligan] produced 2 bloated results.`), so do NOT join clauses — branch explicitly:
    1. delta only:        `Previous turn added ~4.2k tokens to your context`
    2. delta + bloat:     `Previous turn added ~5k tokens to your context and produced 1 bloated result`
    3. bloat only (null): `Previous turn produced 2 bloated results`
  (each then gets a `.` appended and the `[mulligan] ` prefix).
- **Pluralization:** `resultWord(n) = n === 1 ? "result" : "results"` → 1 hit = "result", 0/N>1 = "results".
  (The count N is only rendered when bloatHits is non-empty, so N ≥ 1 whenever the word appears.)
- **`null` is NOT `0`:** `deltaTokens === null` means "unknown", so it MUST NOT render as "~0k" (that would be a
  lie). Only a REAL `number` renders the delta clause. (`deltaTokens === 0` is a real number → renders "~0k" — that
  is honest, though unreachable via shouldNudge since 0 is not over-threshold.)

## §5 — Defensive empty fallback (unreachable via shouldNudge; kept for totality)

- `renderDriftNudge` is ONLY reached when `shouldNudge(metric)` is true (spec/06 §1 gate) = grewOverThreshold (a
  non-null growth delta) OR bloatHit (non-empty bloatHits). So `deltaTokens === null && bloatHits === []` never
  reaches the renderer in practice.
- **Choice:** for the pure-function totality contract (never throws, always returns a string), if BOTH clauses are
  absent, the first line falls back to `"Previous turn changed your context."` (neutral, grammatical, no invented
  number) followed by the two fixed tail lines. This is documented as unreachable-in-practice.
- **Rationale:** the fixed tail lines ("If that growth was wasteful …" / "Run `mulligan_audit` …") are SPEC-PINNED
  and rendered in ALL cases. Only the first line varies.

## §6 — Input type: a NAMED `DriftNudgeInput` projection of TurnMetric (NOT a full TurnMetric import)

- The work-item contract: `renderDriftNudge` takes `{deltaTokens: number|null, bloatHits: {toolName:string,
  approxTokens:number}[]}`.
- **Choice:** define + EXPORT a minimal `DriftNudgeInput` interface in `notes.ts`:
  ```ts
  export interface DriftNudgeInput {
    deltaTokens: number | null;
    bloatHits: ReadonlyArray<{ toolName: string; approxTokens: number }>;
  }
  ```
- **Rationale:**
  - renderDriftNudge uses ONLY `deltaTokens` and `bloatHits.length`. The per-hit `toolName`/`approxTokens` are part
    of the metric projection (and TurnMetric carries them) but are NOT interpolated into the v1 text (reserved for
    richer future nudges) — same philosophy as renderBloatReminder's unused `toolName`.
  - A real `TurnMetric` (mutable `bloatHits: {...}[]`) is ASSIGNABLE to `DriftNudgeInput` (mutable→readonly array
    is sound) — so `nudges.ts`/`filter.ts` can pass the full metric with no cast (structural typing).
  - NO new module/import: there is no shared data-model module yet (spec/04 types are not centralized in v1's
    build order). Defining the projection inline keeps `notes.ts` self-contained (pure-helper tier, Pi-free). If a
    future task centralizes TurnMetric, structural compatibility means zero churn.
  - Named + exported (not inline-anonymous) matches the codebase convention: `NoteInput`, `NoteValidation`,
    `TokenEstimate`, `FileLedger` are all named + exported interfaces.

## §7 — Defensive reading (mirror S2's `readLedgerList`; reuse `isRecord`/`readOwn`)

- Both renderers sit behind fail-open handlers (spec/07 §1/§2 wrap in try/catch + "fail-open: return nothing").
  The renderers themselves are still defensive (codebase discipline: NEVER throws — see `validateNote`,
  `renderNote`, `tokens.ts`).
- **Choice:** read `metric.deltaTokens` / `metric.bloatHits` via the module-private `readOwn` (S1's, hoisted in
  module scope) + `isRecord`/`Array.isArray` guards, exactly like S2's `readLedgerList`:
  - `readDelta(metric)`: `readOwn(metric,"deltaTokens")` → a finite number, else `null`.
  - `readBloatHits(metric)`: `readOwn(metric,"bloatHits")` → if Array, filter to records with string `toolName` +
    number `approxTokens`; else `[]`. (The COUNT uses the filtered length; malformed entries are not counted —
    consistent with `readLedgerList` filtering to strings.)
- This makes the tests' "never throws" assertions real (null/array/primitive/throwing-Proxy metric → graceful
  render, no exception) — mirroring S1/S2's defensive test blocks.

## §8 — renderBloatReminder's leading `\n---\n` (spec-faithful)

- The spec/07 §1 ```md block LITERALLY begins with a blank line then `---` (a markdown horizontal rule). The
  reminder is appended as `{type:"text", text: reminder}` to the result's content array.
- **Choice:** the returned string is `"\n---\n" + <body>` where body = the 4 body lines joined by `"\n"`. The
  leading `"\n"` is honored verbatim from the spec (it ensures `---` renders as a horizontal rule, not a setext
  heading, regardless of how Pi joins content blocks). NO trailing newline.
- The body lines are pinned VERBATIM (backticks, quotes, the `granularity:"last_tool_call_group"` literal) — do
  NOT re-wrap or reflow the text; the soft line breaks are part of the spec text.

## §9 — Test strategy: pinned `.toBe()` format-contract tests + `toMatchInlineSnapshot()` representatives

- Mirror S2 (renderNote) exactly: authoritative pinned `.toBe()` assertions for each reachable shape + the
  format contract (KB/k rounding, pluralization, null-delta, conditional bloat clause, leading `---`), PLUS
  `toMatchInlineSnapshot()` for a few representative inputs (vitest auto-writes on first run; `-u` if needed).
- Also: defensive "never throws" blocks (null/array/primitive/throwing-Proxy metric; NaN/negative bytes) and
  `expectTypeOf` type tests (renderBloatReminder/renderDriftNudge return string; DriftNudgeInput shape).
- APPEND to `test/notes.test.ts` — add `renderBloatReminder`, `renderDriftNudge`, `type DriftNudgeInput` to the
  existing `../src/notes.js` import; keep S1/S2 tests intact.