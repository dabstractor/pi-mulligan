# PRP — P1.M5.T2.S1: `mulligan_shrink` tool — schema, validation, persistence, match feedback

**Work item:** P1.M5.T2.S1 · **Points:** 1.5 · **Stage:** Agent-Callable Tools (spec/11 §2 Step 6 — `tools/shrink.ts`,
the soft-substitution tool; spec/05 §2; spec/04 §4; spec/06 §5).
**Scope:** **CREATE two new files** — `src/tools/shrink.ts` (the `mulligan_shrink` tool: the typebox `ShrinkParams`
schema + the `execute` body that gates on config, validates the replacement + target, does a best-effort live match
for immediate yes/no feedback, persists the shrink marker, and returns the feedback text) and
`test/tools/shrink.test.ts` (registration metadata; disabled/empty-replacement/structurally-impossible refusals;
best-effort match yes/no; no-match-is-NOT-a-refusal; persistence payload; never-throws; result shape; types).
**No other file is touched.** This is the SOLE writer of `mulligan:shrink` markers — the second of the four
agent-callable tools (spec/05 §5); `mulligan_checkpoint` (P1.M5.T3.S1 — DONE) and `mulligan_rewind` (P1.M5.T1.S1 —
in parallel) are the patterns to mirror.

> **PREREQUISITE (read first):** All consumed modules are DONE & shipped & unit-tested — `src/markers.ts`
> (P1.M4.T1.S1: `appendShrinkMarker`, `ShrinkMarkerInput`, `ShrinkTarget`), `src/transforms.ts` (P1.M3.T4.S2:
> `resolveShrinkTarget`, `MessageLike`), `src/config.ts` (P1.M1.T2.S2: `getConfig`, where `config.shrink === {enabled}`).
> **Verify before coding:** `npx tsc --noEmit` exits 0 today (confirmed during research) and the three consumed
> exports resolve: `grep -n "export function appendShrinkMarker\|export type ShrinkMarkerInput\|export type ShrinkTarget" src/markers.ts`
> and `grep -n "export function resolveShrinkTarget" src/transforms.ts`.

> **Runs in parallel with P1.M5.T1.S1** (`mulligan_rewind`) AND P1.M4.T2.S1 (the `context` filter). Treat both as
> CONTRACTS: when this tool begins, (a) `src/tools/rewind.ts` will export `makeRewindTool` following the SAME
> factory-closure + `defineTool` + refusal() + verbatim-DESC skeleton you mirror here (copy its shape, not its
> rewind-specific logic — shrink has NO note, NO depth guard, NO checkpoint, NO mutation warning, NO cast); (b)
> `src/filter.ts` reads `mulligan:shrink` markers via `readMarkers(ctx)` and resolves them with `applyShrink` /
> `resolveShrinkTarget`. This tool WRITES the markers the filter consumes; the two share NO file. The marker's
> `{target, replacement, reason}` shape (spec/04 §4) is the shared contract — it already matches `ShrinkMarkerInput`
> exactly, so NO cast is required at the `appendShrinkMarker` call site.

---

## Goal

**Feature Goal**: Ship the **`mulligan_shrink`** tool — the soft-substitution operation. When a past tool result
(or message) is too bloated to keep carrying verbatim but too useful to delete, the agent calls this tool with a
**matcher-based target** (`by_tool_call_id` / `by_tool_name+occurrence` / `by_content_includes` — compaction-robust,
D7) and a compact `replacement` string. The tool: (1) refuses cleanly when disabled / the replacement is empty / the
target is **structurally impossible** (a discriminator that can provably never match — i.e. empty after trim); (2)
does a **best-effort read-only** match against a snapshot to report immediate feedback (`matched: yes/no`); (3) does
**NOT** refuse on a current no-match (the content may appear before compaction settles — the marker persists and the
filter re-resolves it each inference); (4) persists a `mulligan:shrink` marker carrying the `{target, replacement,
reason}` spec (control state, NOT in context); (5) returns the feedback text. The tool is **write-only w.r.t. the
message list**: it never reads/transforms `event.messages`; it records a spec and lets the filter substitute on the
NEXT inference.

**Deliverable** (CREATE two new files):
1. **`src/tools/shrink.ts`** — exports:
   - `export const ShrinkParams` — the typebox `Type.Object({...})` parameter schema (spec/05 §2, VERBATIM, incl. the
     three-arm `target` union + every field description).
   - `export type ShrinkArgs = Static<typeof ShrinkParams>` — the inferred execute-time params type.
   - `export const SHRINK_DESC` — the LLM-facing description string (spec/05 §5, VERBATIM).
   - `export interface ShrinkDetails` — the structured `details` payload (`{ matched?, markerId? }`) surfaced to
     logs/audit/UI on every return path.
   - `export function makeShrinkTool(pi: ExtensionAPI): ToolDefinition<typeof ShrinkParams, ShrinkDetails>` — the
     factory that captures `pi` via closure (the proven checkpoint.ts shape). index.ts (P1.M7.T1.S1) does
     `pi.registerTool(makeShrinkTool(pi))`. Unit tests do `makeShrinkTool(fakePi)`.
2. **`test/tools/shrink.test.ts`** — hand-rolled `makePi()`/`makeCtx()` fakes (no `vi.fn()`; house idiom from
   test/markers.test.ts + test/tools/checkpoint.test.ts), with describe blocks for: registration metadata;
   config-disabled refusal; empty-replacement refusal; structurally-impossible-target refusal; best-effort match
   (matched:yes on a scripted toolResult by each of the 3 matchers); no-match-is-NOT-a-refusal (matched:no + still
   persists); persistence payload exactness (`{target, replacement, reason}` stamped with envelope); never-throws;
   result shape (details on every path); types (ToolDefinition/AgentToolResult).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (shrink.ts compiles under `strict`; the `execute` signature is
  `(_toolCallId, params, signal, onUpdate, ctx)`; every return path includes `details`; the typebox + Pi + pure-helper
  imports resolve).
- `npx vitest run test/tools/shrink.test.ts` → all shrink tests pass.
- `npx vitest run` → **all-green, no regression** (shrink.ts adds 2 new files; it touches nothing else).
- **Disabled** (`config.shrink.enabled === false`) → refusal text `"Mulligan: refused — shrink is disabled."`, and
  `appendShrinkMarker` is NEVER called.
- **Empty `replacement`** (empty or whitespace-only) → refusal text `"Mulligan: refused — replacement must be non-empty."`;
  no persistence.
- **Structurally impossible target** (the present discriminator — `by_tool_call_id` / `by_tool_name` /
  `by_content_includes` — is empty or whitespace-only after trim) → refusal text naming the problem; no persistence.
- **Best-effort match yes:** a snapshot whose flattened messages contain a matching target → the tool STILL persists
  the marker and returns the feedback text with **`(Matched now: yes)`**.
- **Best-effort match no (NOT a refusal):** a target that does not currently match (but is non-empty) → the tool STILL
  persists the marker and returns the feedback text with **`(Matched now: no)`**. appendShrinkMarker IS called.
- **Persistence:** success persists via `appendShrinkMarker(pi, ctx, { target: params.target, replacement:
  params.replacement, reason: params.reason })` — the captured `appended[0]` has `customType === "mulligan:shrink"`
  and `data` stamped with `{schema:"pi-mulligan", v:1, kind:"shrink", id:<uuid>, seq, ts}` spread over the payload.
  NO cast at the call site (`ShrinkMarkerInput` already matches — verified).
- **Feedback text** matches spec/05 §2 VERBATIM: `"Mulligan: shrink recorded. Matched message will show the
  replacement from the next turn on. (Matched now: yes|no)"`.
- **Never throws:** any unexpected exception (incl. a throwing `buildContextEntries`) → caught → the match falls back
  to `matched:false` if it happens mid-match, or a refusal text if it happens outside; the tool never rejects (E13).

---

## User Persona

**Target User**: The **LLM agent itself** (design principle #5: "the agent is the user"). Secondary consumers:
`index.ts` (P1.M7.T1.S1) registers the tool; the `context` filter (P1.M4.T2.S1) consumes the markers this tool
writes; `mulligan_audit` (P1.M5.T4.S1) lists active shrink markers; the test suite + integration smoke harness (P1.M7.T2).

**Use Case**: Mid-session, the agent ran a tool call that was *fine* but whose *output* is bloated (e.g. a 9k-token
`read` of a big log, a 12k-token `bash` test run). The call itself and its outcome are worth keeping (the model needs
to know "the test failed" or "the bug is on line 42"), but the verbatim output is dead weight for the rest of the
task. The agent calls `mulligan_shrink` with a matcher (`by_tool_call_id`, `by_tool_name:"read", occurrence:"last"`,
or `by_content_includes:"ENOSPC"`) and a compact `replacement` summary. The tool validates, persists a marker, and
confirms whether the target matched right now. On the NEXT inference, the filter substitutes the matched message's
`content` with `[{type:"text", text: replacement}]` (preserving `role`/`toolCallId`/`toolName`/`isError` so the
tool-pairing invariant holds — C-pairing). The substituted content is what the model treats as ground truth from then on.

**User Journey**:
1. `index.ts` factory: `pi.registerTool(makeShrinkTool(pi))` once at startup.
2. Agent, mid-turn, decides a past result is bloated but useful → calls `mulligan_shrink({target, replacement, reason?})`.
3. `execute(_toolCallId, params, signal, onUpdate, ctx)`:
   a. `getConfig()` → `config.shrink.enabled`? false → refuse.
   b. `params.replacement` empty after trim? → refuse.
   c. structural check: the present target discriminator empty after trim? → refuse (can never match).
   d. best-effort match (try/catch → matched:false): snapshot = `buildContextEntries().flatMap(sessionEntryToContextMessages)`;
      `matched = resolveShrinkTarget(snapshot, params.target) !== null`.
   e. `appendShrinkMarker(pi, ctx, { target: params.target, replacement: params.replacement, reason: params.reason })`
      → `markerId` (entry id or null).
   f. return feedback text with `(Matched now: yes|no)` + `details:{ matched, markerId }`.
4. Agent loop continues → next inference fires `context` → filter reads the fresh marker, substitutes content.

**Pain Points Addressed**: (a) A bloated-but-useful result pollutes context for the rest of the task, burning tokens.
Shrink keeps the call's slot (pairing intact) but swaps in a faithful summary. (b) Matcher-based targeting (not
index-based) makes shrinks robust to compaction (D7): indices shift under compaction, but a `by_tool_call_id` /
`by_content_includes` resolves live each inference. (c) "Match now, don't refuse on no-match" handles the pre-compaction
race (spec/05 §2 step 3): the agent can record a shrink against content that will appear once compaction settles, and
the filter will pick it up on a later inference. (d) The agent gets immediate feedback (`matched: yes/no`) so it knows
whether to trust the substitution this turn or wait.

---

## Why

- **Shrink is the complement to rewind** (spec/05 §2 "When to use it vs mulligan_rewind"): rewind SHEDS a span
  (call was a mistake); shrink SUMMARIZES a span (call was fine, output is bloated). Until it ships, the agent has no
  way to trim a single bloated result while keeping its pairing — the filter (P1.M4.T2) and the whole "permanent soft
  substitution" thesis (spec/06 §5) have nothing to apply.
- **Matcher-based targets are the compaction-robustness primitive (D7).** Index-based shrink would break the moment
  compaction shifts positions. The three matchers (`by_tool_call_id` — unique; `by_tool_name`+occurrence — semantic;
  `by_content_includes` — content-based) resolve against the LIVE message list each inference, so a shrink survives
  compaction and re-points at the right message automatically (spec/04 §4: "targets resolve against the current
  messages each inference").
- **"Match now, don't refuse on no-match"** is the deliberate tolerance for the pre-compaction race (spec/05 §2 step 3,
  E8): the tool records a spec, the filter keeps trying. The only hard refusal on the target side is **structural
  impossibility** (a discriminator that can never match — operationalized as empty-after-trim), because persisting a
  provably-dead marker is pure noise.
- **Soft-over-hard + zero-extra-requests (design principles #2, #3).** The tool writes control state (marker, NOT in
  context); it never mutates the session tree and never costs an extra inference. The original content stays on disk
  for `/tree` inspection; only the model's VIEW is substituted.
- **Honest bookkeeping (design principle #6).** The `matched: yes/no` feedback tells the agent whether the
  substitution will take effect this turn or is pending a later match — no false confidence.

---

## What

CREATE `src/tools/shrink.ts` and `test/tools/shrink.test.ts`. Behavior (spec/05 §2 steps 1–5):

- **Schema** (`ShrinkParams`, spec/05 §2 VERBATIM): `Type.Object({ target: <3-arm union>, replacement: Type.String,
  reason: Type.Optional(Type.String) })`. The union arms + their field descriptions are copied verbatim (the LLM reads them).
- **Description** (`SHRINK_DESC`, spec/05 §5 VERBATIM).
- **execute** (body in ONE try/catch; never throws — E13):
  1. **config** (step 1; E14): `const config = getConfig(); if (!config.shrink.enabled) return refusal("shrink is disabled");`.
  2. **replacement** (step 2): `if (!isNonEmpty(params.replacement)) return refusal("replacement must be non-empty");`.
  3. **structural target** (step 3 — the "structurally impossible" refusal): `if (!targetIsStructurallyValid(params.target))
     return refusal("target discriminator must be non-empty")`. (A non-empty-but-currently-unmatched target is NOT refused.)
  4. **best-effort match** (step 3 — the yes/no feedback; best-effort): `let matched = false; try { const entries =
     ctx.sessionManager.buildContextEntries(); const messages = entries.flatMap((e) => sessionEntryToContextMessages(e));
     matched = resolveShrinkTarget(messages, params.target) !== null; } catch { matched = false; }` (E13 — never block).
  5. **persist** (step 4): `const markerId = appendShrinkMarker(pi, ctx, { target: params.target, replacement:
     params.replacement, reason: params.reason });` (NO cast — `ShrinkMarkerInput` matches exactly).
  6. **return** (step 5): `feedbackText(matched)` + `details:{ matched, markerId }`.
  - **catch**: `return refusal(\`unexpected error: ${e.message}\`);`.

### Success Criteria
- [ ] All 6 behavior steps implemented exactly (config → replacement → structural-target → best-effort match → persist →
      return), in that order.
- [ ] Tool is write-only w.r.t. messages (never receives/transforms `event.messages`; the snapshot is read-only + advisory).
- [ ] The persisted marker's `data` is `{...{target, replacement, reason}, schema:"pi-mulligan", v:1, kind:"shrink",
      id:<uuid>, seq, ts}` — verified by inspecting `appendShrinkMarker`'s captured `appended[0].data`.
- [ ] No-match is NOT a refusal: a non-empty target that resolves to `null` STILL persists + returns `(Matched now: no)`.
- [ ] `matched` is computed from the snapshot via `resolveShrinkTarget` (not a hand-rolled scan).

---

## All Needed Context

### Context Completeness Check

✅ "No Prior Knowledge" test PASSED: an implementer who knows nothing about this codebase gets — (a) the EXACT execute
signature + the factory-closure pattern (verified against dist .d.ts + checkpoint.ts + the parallel rewind.ts PRP);
(b) the EXACT consumed signatures of all 3 imported modules (markers/transforms/config) + the Pi re-exports
(`defineTool`, `sessionEntryToContextMessages`); (c) the EXACT spec text for the schema, description, behavior steps,
and feedback text; (d) the "structurally impossible target" operationalization (the one design judgment) with the
verified reasoning against `resolveShrinkTarget` internals; (e) the verified SessionMessageEntry fixture shape for the
best-effort-match test; (f) the test idiom with the exact fake shapes needed (getSessionId/getLeafId/buildContextEntries
on ctx; appendEntry capture on pi); (g) the explicit list of what shrink does NOT have vs the sibling rewind tool
(no note, no depth guard, no checkpoint, no cast) so the implementer does not cargo-cult rewind's gotchas.

### Documentation & References

```yaml
# MUST READ — the tool's own spec (VERBATIM schema + behavior + return text)
- url: spec/05-tools.md#2-mulligan_shrink
  why: §2 ShrinkParams typebox schema (copy verbatim, incl. the 3-arm target union + every field description), the 5-step
       behavior, the Return shape (the VERBATIM feedback text with the yes/no slot).
  critical: step 3 is the load-bearing nuance — "a no match now is NOT a hard refusal" (content may appear before a
            compaction settles); "refuse only if the target is structurally impossible, not merely currently-unmatched."
            The feedback text template ("Mulligan: shrink recorded. Matched message will show the replacement from the
            next turn on. (Matched now: yes/no)") is load-bearing — copy it, fill yes/no from the best-effort match.

- url: spec/05-tools.md#5-tool-registration-summary-for-indexts
  why: §5 gives the SHRINK_DESC description string VERBATIM (copy it) + the registerTool shape
       ({name:"mulligan_shrink", label:"Mulligan Shrink", description, parameters, execute}).
  critical: "Description strings (craft carefully — they drive LLM usage)" — copy the Shrink desc EXACTLY; it is the
            tool's user-facing documentation for the LLM (Mode A docs).

- url: spec/08-edge-cases.md
  why: E8 (marker targets nothing/compacted → no-op this fire, retried next fire — THIS is why no-match is not a refusal),
       E13 (tool never throws — return a text result), E14 (disabled → refuse "Mulligan is disabled" framing),
       E17 (two shrinks same target → last wins — the FILTER's concern, not the tool's), E19 (shrink a non-toolResult
       message → applyShrink preserves role — the tool does NOT restrict by role).
  critical: E13 = wrap the whole execute body in try/catch. E8 + E14 define the two refusal-vs-accept boundaries.

- url: spec/04-data-model.md
  why: §4 ShrinkMarker (the persisted marker) + ShrinkTarget (the 3-arm union) + the matching-semantics prose
       ("targets resolve against the current messages each inference ... last wins ... no-op + retried next inference").
  critical: §4 confirms ShrinkMarker's persisted fields are {id, target, replacement, reason?, seq, ts} over the
            envelope — exactly what appendShrinkMarker stamps. The marker's `id` (uuid) is stamped by the wrapper;
            the tool never sees it.

- url: spec/06-context-filter.md
  why: §5 (how the filter consumes shrink markers — applyShrink substitutes content, preserving role/toolCallId/
       toolName/isError; shrinks applied AFTER rewinds, oldest-first by seq, last-wins). §1 (readMarkers scans
       getEntries() for customType "mulligan:shrink").
  critical: the tool WRITES the {target, replacement, reason} the filter's applyShrink/resolveShrinkTarget READS. The
            filter is the AUTHORITATIVE substitutor; the tool only records the spec. Do not reimplement resolution.

- url: plan/001_2e5baf25fe9f/architecture/api_verification.md#8-tooldefinition--verified
  why: §8 VERIFIES the execute signature (toolCallId FIRST arg) + AgentToolResult shape (content + details? + isError?).
  critical: "NOTE on execute signature: The first argument is toolCallId." AgentToolResult.details — the .d.ts shows
            `details?` (optional), but checkpoint.ts + rewind.ts INCLUDE it on every path. Follow the house convention.

# PATTERN FILES — copy the structure/conventions, not the logic
- file: src/tools/checkpoint.ts
  why: the canonical tool pattern (factory closure makeCheckpointTool(pi), defineTool, refusal() builder with details on
       every path, CKPT_DESC verbatim, try/catch never-throws, .js imports). The SIMPLEST sibling to mirror.
  pattern: mirror EXACTLY — makeShrinkTool(pi) factory; refusal(reason) helper; SHRINK_DESC verbatim; whole body
           try/catch; defineTool return; exports {ShrinkParams, ShrinkArgs, SHRINK_DESC, ShrinkDetails, makeShrinkTool}.
  gotcha: checkpoint.ts validates a NAME regex; shrink validates the replacement + the target discriminator instead
          (no regex). checkpoint names the first execute arg `_toolCallId` (unused) — shrink does the same (it does NOT
          use toolCallId; the target is explicit).

- file: plan/001_2e5baf25fe9f/P1M5T1S1/PRP.md   # the PARALLEL sibling (rewind) — the richest reference
  why: the rewind PRP is the gold-standard PRP for this exact stage. It documents the shared skeleton (factory closure,
       refusal(), verbatim DESC, try/catch, details-on-every-path, .js imports, sessionEntryToContextMessages snapshot)
       AND the consumed-module contracts you also depend on.
  pattern: copy the SKELETON and the consumed-contract citations. Do NOT copy rewind-specific logic: shrink has NO note
           (no leaveNote/renderNote/validateNote), NO depth guard (config.shrink has only enabled), NO checkpoint scan,
           NO excludeToolCallId, NO mutation warning, NO FileLedger, and NO cast at the appendShrinkMarker call site
           (ShrinkMarkerInput already matches the payload exactly — the single biggest simplification vs rewind).

- file: test/tools/checkpoint.test.ts
  why: the canonical tool-test idiom — vitest, hand-rolled makePi()/makeCtx() (NO vi.fn()), clearAll() before/after,
       expectTypeOf, firstText() helper, registration-metadata + refusal + success + never-throws + result-shape + types
       describe blocks.
  pattern: mirror the structure; ADD buildContextEntries to makeCtx (the shrink snapshot source) + a msgEntry() fixture
           helper for the best-effort-match tests.

- file: test/markers.test.ts
  why: the makePi() fake that captures appendEntry (copy its shape — shrink uses appendShrinkMarker which calls
       pi.appendEntry); the makeCtx() fake shape (getSessionId + getLeafId).
  pattern: reuse makePi's {appended} capture (shrink does NOT use sendMessage/setLabel, so a trimmed makePi suffices).

# CONSUMED MODULE CONTRACTS (DONE — import from these; do NOT reimplement)
- file: src/markers.ts
  why: appendShrinkMarker(pi, ctx, data: ShrinkMarkerInput): string|null  +  ShrinkMarkerInput + ShrinkTarget types.
  pattern: appendShrinkMarker stamps {schema,v,kind:"shrink",id(uuid),seq(via nextSeq),ts} onto {...data}; calls
           pi.appendEntry("mulligan:shrink", entry); returns ctx.sessionManager.getLeafId() (the ENTRY id) or null;
           NEVER throws (whole body try/catch → null). ShrinkMarkerInput === {target, replacement, reason?}.
  gotcha: NO cast needed (unlike rewind's checkpoint gotcha) — ShrinkMarkerInput already has exactly {target,
          replacement, reason}. The returned id is the ENTRY id (getLeafId), distinct from the marker's uuid `id`.

- file: src/transforms.ts
  why: resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null — the PURE best-effort resolver.
  pattern: by_tool_call_id → first toolResult with that toolCallId (needs length>0); by_tool_name+occurrence → last
           (default) or first index among toolResults with that toolName (needs length>0); by_content_includes → first
           message (ANY role) whose stringified content includes the substring (NO length check → empty needle matches
           the first message — degenerate). First present non-empty discriminator wins; else null.
  gotcha: transforms is Pi-FREE (0 imports) — importing it into the tool is safe (no circular dep). An empty
          discriminator either never matches (by_tool_call_id/by_tool_name) or degenerately matches the first message
          (by_content_includes) → the tool's structural-validity check refuses both (empty-after-trim).

- file: src/config.ts
  why: getConfig(): MulliganConfig (fresh clone each call). config.shrink === { enabled: boolean } — the ONLY shrink knob.
  gotcha: getConfig returns a clone — read once at the top of execute. config.shrink has NO maxDepth/threshold (unlike
          config.rewind) — do not read any non-existent field.
```

### Current Codebase tree

```bash
src/
├── index.ts            # stub factory (P1.M7.T1.S1 will wire tools) — DO NOT TOUCH
├── config.ts           # getConfig, MulliganConfig (config.shrink === {enabled})   ✓ DONE (consumed)
├── log.ts              # structured JSONL logger                            ✓ DONE (not needed)
├── runtime.ts          # getRuntime, nextSeq, resetRuntime, clearAll        ✓ DONE (nextSeq used INSIDE appendShrinkMarker)
├── tokens.ts           # estimateTokens, resultBytes, approxTokens          ✓ DONE (not needed)
├── ledger.ts           # extractFileLedger                                  ✓ DONE (NOT used by shrink)
├── notes.ts            # validateNote, renderNote                           ✓ DONE (NOT used by shrink)
├── transforms.ts       # resolveShrinkTarget, applyShrink, filterPipeline   ✓ DONE (consumed: resolveShrinkTarget)
├── markers.ts          # appendShrinkMarker, ShrinkMarkerInput, ShrinkTarget ✓ DONE (consumed)
├── filter.ts           # context handler (P1.M4.T2.S1 — in parallel)        ◐ CONTRACT (reads markers)
└── tools/
    ├── checkpoint.ts   # the canonical tool PATTERN to mirror               ✓ DONE (pattern)
    └── rewind.ts       # the parallel sibling (P1.M5.T1.S1 — in parallel)    ◐ CONTRACT (same skeleton)
test/
├── tools/checkpoint.test.ts   # the tool-test idiom (pattern)
├── markers.test.ts            # makePi (appendEntry capture) + makeCtx (getSessionId/getLeafId) — pattern
└── ... (config/log/runtime/tokens/ledger/notes/transforms/filter.test.ts — all green; 436 tests)
```

### Desired Codebase tree with files to be added

```bash
src/tools/
├── checkpoint.ts        # unchanged
├── rewind.ts            # parallel sibling (P1.M5.T1.S1) — NOT this task
└── shrink.ts            # ★ NEW — ShrinkParams schema + makeShrinkTool(pi) factory + execute body
test/tools/
├── checkpoint.test.ts   # unchanged
├── rewind.test.ts       # parallel sibling — NOT this task
└── shrink.test.ts       # ★ NEW — registration, refusals (3), best-effort match (yes/no per matcher),
                          #          no-match-is-not-a-refusal, persistence payload, never-throws, shape, types
```

**File responsibilities:**
- `src/tools/shrink.ts` — the `mulligan_shrink` tool definition (schema + description + factory + execute). Owns:
  the typebox schema, the 6 validation/behavior steps, the structural-target-validity helper, the best-effort-match
  snapshot helper (buildContextEntries → flatMap → resolveShrinkTarget → matched boolean), the refusal/feedback text
  builders, the `details` payload. Delegates persistence to `appendShrinkMarker` (markers.ts) and never reimplements
  `pi.appendEntry`. Delegates resolution to `resolveShrinkTarget` (transforms.ts) and never reimplements matching.
- `test/tools/shrink.test.ts` — unit tests with hand-rolled fakes; verifies the 3 refusal paths, the best-effort match
  (yes/no for each of the 3 matchers), no-match-is-not-a-refusal, the exact persisted payload, never-throws, result
  shape, and types.

### Known Gotchas of our codebase & Library Quirks

```ts
// GOTCHA #1 (the SINGLE biggest difference from the sibling rewind tool): NO CAST, NO note, NO extras.
// rewind needs `payload as RewindMarkerInput` because of the checkpoint-field gap (spec/04 §3 omits checkpoint).
// shrink has NO such gap: ShrinkMarkerInput === { target, replacement, reason? } EXACTLY. The tool builds
//   { target: params.target, replacement: params.replacement, reason: params.reason }
// and passes it DIRECTLY to appendShrinkMarker — NO cast, NO extra field, NO leaveNote call. Do NOT cargo-cult
// rewind's checkpoint cast or its leaveNote/renderNote/validateNote machinery — shrink has none of it.

// GOTCHA #2: toolCallId is the FIRST execute arg, but shrink does NOT use it (the target is explicit). Name it
// `_toolCallId` (checkpoint.ts precedent for unused args). There is no excludeToolCallId concept for shrink.
//   async execute(_toolCallId, params, signal, onUpdate, ctx) { ... }

// GOTCHA #3: pi (ExtensionAPI) is NOT an execute arg — capture it via the makeShrinkTool(pi) factory closure
// (checkpoint.ts precedent). index.ts does pi.registerTool(makeShrinkTool(pi)).

// GOTCHA #4: AgentToolResult<T> — details is OPTIONAL per the .d.ts, but checkpoint.ts + rewind.ts (the patterns to
// mirror) INCLUDE `details` on EVERY return path. Follow the house convention: refusal() returns details too (even if
// just `{}` or a partial). Use a small ShrinkDetails object ({ matched?, markerId? }).

// GOTCHA #5: the tool is WRITE-ONLY w.r.t. messages — it NEVER receives event.messages (it is not the context event).
// For the best-effort match, build a SNAPSHOT via ctx.sessionManager.buildContextEntries().flatMap(
// sessionEntryToContextMessages). sessionEntryToContextMessages + SessionEntry ARE re-exported from the MAIN package
// "@earendil-works/pi-coding-agent" (dist/index.d.ts line 19 — VERIFIED). Import them directly (no deep import).

// GOTCHA #6: the best-effort match is ADVISORY feedback only — it NEVER gates persistence. A matched:false (currently-
// unmatched target) STILL persists + returns "(Matched now: no)" (spec/05 §2 step 3; E8). Wrap the match in try/catch
// → matched:false (a throwing buildContextEntries/sessionEntryToContextMessages must never block a legitimate shrink —
// E13). The AUTHORITATIVE substitution happens in the filter on the next inference (D7).

// GOTCHA #7 ("structurally impossible target" — the one design judgment): refuse ONLY when the target can NEVER match.
// Operationalize as: the present discriminator (by_tool_call_id → by_tool_name → by_content_includes, whichever is a
// string) is EMPTY or WHITESPACE-ONLY after trim. Verified reasoning against resolveShrinkTarget internals:
//   - by_tool_call_id:"" / by_tool_name:"" → resolveShrinkTarget skips the arm (length>0 check) → null forever.
//   - by_content_includes:"" → NO length check → degenerate match on the FIRST message (every string includes "").
// A NON-EMPTY-but-currently-unmatched target is NOT refused (compaction-robust; content may appear later — E8).
// occurrence is typebox-constrained to "last"|"first"; resolveShrinkTarget defaults non-"first" to "last" → do NOT
// validate occurrence.

// GOTCHA #8: the persisted marker's `data` is `{...{target, replacement, reason}, schema, v:1, kind:"shrink", id:uuid,
// seq, ts}`. appendShrinkMarker STAMPS envelope+id+seq+ts via spread over the caller payload. The returned value is
// the ENTRY id (ctx.sessionManager.getLeafId()), NOT the marker's uuid `id` (spec/04 §4 names <marker.id>; both are
// unique-per-entry). It may be null (append threw / no leaf) — pass it through to details.markerId regardless.

// GOTCHA #9: .js extension on ALL relative imports (ESM/Bundler resolution; tsconfig moduleResolution:"Bundler").
//   import { appendShrinkMarker, type ShrinkMarkerInput } from "../markers.js";
//   import { resolveShrinkTarget } from "../transforms.js";
//   import { getConfig } from "../config.js";
// Pi imports use the bare specifier "@earendil-works/pi-coding-agent".

// GOTCHA #10: getConfig() returns a fresh CLONE each call — read once at the top of execute and reuse the local
// (do not call getConfig() repeatedly).

// GOTCHA #11 (parallel-item awareness): P1.M5.T1.S1 (rewind.ts) AND P1.M4.T2.S1 (filter.ts) run IN PARALLEL.
//   - rewind.ts follows the SAME skeleton (factory closure, refusal(), verbatim DESC, try/catch, details-on-every-path,
//     .js imports, sessionEntryToContextMessages snapshot). Copy its SHAPE; do NOT copy its note/depth/checkpoint/mutation
//     logic (shrink has none of those — GOTCHA #1).
//   - filter.ts reads mulligan:shrink markers via readMarkers(ctx) and resolves them with applyShrink/resolveShrinkTarget.
//     This tool writes those markers. The {target, replacement, reason} shape (spec/04 §4) is the shared contract.
//     Do NOT touch filter.ts; do NOT reimplement readMarkers/applyShrink.

// GOTCHA #12 (test fixture shape): buildContextEntries() → SessionEntry[]; flatMap(sessionEntryToContextMessages) →
// AgentMessage[]. A SessionMessageEntry is { type:"message", id, parentId, timestamp, message: AgentMessage } and
// flattens to [entry.message]. So a toolResult fixture:
//   { type:"message", id:"e1", parentId:null, timestamp:"", message:{ role:"toolResult", toolCallId:"call-A",
//     toolName:"read", content:[{type:"text", text:"big log..."}] } } as unknown as SessionEntry
// flattens to [{role:"toolResult", toolCallId:"call-A", toolName:"read", content:[...]}] → resolveShrinkTarget matches
// it by each matcher. The test imports the REAL sessionEntryToContextMessages (do not fake it) so the flatten is exact.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// ShrinkDetails — the AgentToolResult.details payload (present on every path — GOTCHA #4).
export interface ShrinkDetails {
  /** Best-effort "does the target match a message right now" result. true/false on the success path; omitted on
   *  refusal (no match attempted). Drives the "(Matched now: yes|no)" feedback + audit correlation. */
  matched?: boolean;
  /** The persisted marker's ENTRY id (appendShrinkMarker's return; null when append threw / no leaf). Success path. */
  markerId?: string | null;
}

// ShrinkParams — the typebox schema (spec/05 §2 VERBATIM — copy the 3-arm target union + every field description).
export const ShrinkParams = Type.Object({
  target: Type.Union([
    Type.Object({ by_tool_call_id: Type.String({ description: "The toolCallId of the result to shrink." }) }),
    Type.Object({
      by_tool_name: Type.String({ description: "e.g. 'read', 'bash'" }),
      occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]),
    }),
    Type.Object({ by_content_includes: Type.String({ description: "Shrink the (first) message whose text contains this substring." }) }),
  ], { description: "How to identify the message to shrink. Resolved live each turn (robust to compaction)." }),
  replacement: Type.String({
    description: "The compact text that replaces the matched message's content. Make it a faithful summary — the model will treat it as ground truth from now on.",
  }),
  reason: Type.Optional(Type.String({ description: "Why (surfaced in audit). Optional." })),
});
export type ShrinkArgs = Static<typeof ShrinkParams>;
// Static<typeof ShrinkParams> === { target: ShrinkTarget; replacement: string; reason?: string } === ShrinkMarkerInput.

// SHRINK_DESC — spec/05 §5 VERBATIM (Mode A LLM-facing docs). Copy exactly; it drives LLM usage.
export const SHRINK_DESC =
  "Replace a specific past tool result with a compact summary you provide, in your view, going forward. " +
  "Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in " +
  "context (just with your summary as its result).";
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/tools/shrink.ts — imports + schema + constants
  - IMPORT (Pi): `import { defineTool, sessionEntryToContextMessages, type AgentToolResult, type ExtensionAPI, type ExtensionContext, type SessionEntry, type ToolDefinition } from "@earendil-works/pi-coding-agent"` (GOTCHA #5/#9: sessionEntryToContextMessages + SessionEntry ARE re-exported from main — VERIFIED dist/index.d.ts line 19).
  - IMPORT (typebox): `import { Type } from "typebox"; import type { Static } from "typebox"`.
  - IMPORT (markers): `import { appendShrinkMarker, type ShrinkMarkerInput } from "../markers.js"` (GOTCHA #1/#9: NO cast; ShrinkMarkerInput matches the payload exactly).
  - IMPORT (transforms): `import { resolveShrinkTarget } from "../transforms.js"` (Pi-free; no circular dep).
  - IMPORT (config): `import { getConfig } from "../config.js"`.
  - DEFINE: `ShrinkParams` (Type.Object, spec/05 §2 VERBATIM incl. the 3-arm target union + every field description), `ShrinkArgs`, `ShrinkDetails`, `SHRINK_DESC` (spec/05 §5 VERBATIM).
  - FOLLOW pattern: src/tools/checkpoint.ts (import block + const-export ordering).
  - NAMING: ShrinkParams (PascalCase schema), ShrinkArgs/ShrinkDetails (types), SHRINK_DESC (SCREAMING_SNAKE const).

Task 2: CREATE src/tools/shrink.ts — text builders (refusal / feedback)
  - IMPLEMENT `function refusal(reason: string): AgentToolResult<ShrinkDetails>` → `{ content:[{type:"text", text:\`Mulligan: refused — ${reason}.\`}], details:{} }` (GOTCHA #4: details on every path; shared "Mulligan: refused — <reason>." prefix — match checkpoint.ts; NOTE checkpoint's refusal has NO trailing period on the reason but the rewind sibling ADDS "." — for shrink, end the reason with "." in the helper OR in the message; pick ONE and keep refusal() consistent: emit `Mulligan: refused — ${reason}.`).
  - IMPLEMENT `function feedbackText(matched: boolean): string` → the spec/05 §2 VERBATIM feedback text with the yes/no slot filled: \`Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: ${matched ? "yes" : "no"})\`.
  - FOLLOW pattern: checkpoint.ts refusal() builder (same shape; shrink's details is {} on refusal — no identifying scalar like checkpoint's name).
  - NAMING: refusal, feedbackText (snake_case functions).

Task 3: CREATE src/tools/shrink.ts — pure validation + match helpers
  - IMPLEMENT `function isNonEmpty(s: unknown): boolean` → `typeof s === "string" && s.trim().length > 0` (defensive: a non-string is false, never throws). Used for replacement + the target discriminator.
  - IMPLEMENT `function targetIsStructurallyValid(target: ShrinkArgs["target"]): boolean` (GOTCHA #7): read the present discriminator in order (by_tool_call_id → by_tool_name → by_content_includes — whichever is a string; exactly one is present after typebox validation, but be defensive); return `isNonEmpty(discriminator)`. If no recognizable string discriminator → false. Never throws.
  - IMPLEMENT `function bestEffortMatch(ctx, target): boolean` (GOTCHA #5/#6 — best-effort, never blocks):
      ```
      try {
        const entries = ctx.sessionManager.buildContextEntries();
        const messages = entries.flatMap((e) => sessionEntryToContextMessages(e));
        return resolveShrinkTarget(messages, target) !== null;
      } catch {
        return false;
      }
      ```
  - FOLLOW pattern: checkpoint.ts (module-private helpers, not exported). isNonEmpty/targetIsStructurallyValid mirror checkpoint's defensive style.
  - NAMING: isNonEmpty, targetIsStructurallyValid, bestEffortMatch (snake_case, descriptive).
  - PLACEMENT: module-private helpers in shrink.ts (only makeShrinkTool + schema/types/desc are public).

Task 4: CREATE src/tools/shrink.ts — execute body (the 6 steps)
  - IMPLEMENT `async function shrinkExecute(pi, _toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<ShrinkDetails>>` with the WHOLE body in ONE try/catch (E13 — never throws):
      1. `const config = getConfig(); if (!config.shrink.enabled) return refusal("shrink is disabled");` (step 1, E14)
      2. `if (!isNonEmpty(params?.replacement)) return refusal("replacement must be non-empty");` (step 2)
      3. `if (!targetIsStructurallyValid(params?.target)) return refusal("target discriminator must be non-empty");` (step 3 — structural impossibility, GOTCHA #7)
      4. `let matched: boolean; try { matched = bestEffortMatch(ctx, params.target); } catch { matched = false; }` (step 3/4 — best-effort yes/no; the inner try/catch is belt-and-suspenders since bestEffortMatch already catches)
      5. persist (step 4 — GOTCHA #1: NO cast, NO leaveNote):
           ```
           const markerId = appendShrinkMarker(pi, ctx, {
             target: params.target,
             replacement: params.replacement,
             reason: params.reason,
           });
           ```
      6. return feedback (step 5): `return { content:[{type:"text", text: feedbackText(matched)}], details:{ matched, markerId } };`
      - catch: `return refusal(\`unexpected error: ${e instanceof Error ? e.message : String(e)}\`);`
  - FOLLOW pattern: checkpoint.ts checkpointExecute (pi as first arg via closure; _toolCallId unused; try/catch; refusal() on every error path).
  - DEPENDENCIES: Tasks 1–3 (schema, builders, helpers).
  - NAMING: shrinkExecute, makeShrinkTool.

Task 5: CREATE src/tools/shrink.ts — the factory (defineTool)
  - IMPLEMENT `export function makeShrinkTool(pi: ExtensionAPI): ToolDefinition<typeof ShrinkParams, ShrinkDetails>`:
      ```
      return defineTool({
        name: "mulligan_shrink",
        label: "Mulligan Shrink",
        description: SHRINK_DESC,           // spec/05 §5 VERBATIM
        parameters: ShrinkParams,
        async execute(_toolCallId, params, signal, onUpdate, ctx) { return shrinkExecute(pi, _toolCallId, params, signal, onUpdate, ctx); },
      });
      ```
  - FOLLOW pattern: checkpoint.ts makeCheckpointTool (defineTool preserves ShrinkParams inference).
  - NAMING: makeShrinkTool (camelCase factory).

Task 6: CREATE test/tools/shrink.test.ts — fakes + registration metadata
  - IMPLEMENT makePi({throwOnAppend?}) (reuse markers.test.ts shape, trimmed to appendEntry — shrink does NOT use sendMessage/setLabel): captures `appended: {customType, data}[]`.
  - IMPLEMENT makeCtx({sessionId?, leafId?, entries?, throwOnBuildContextEntries?}): scripts getSessionId + getLeafId (appendShrinkMarker reads both) AND buildContextEntries (the shrink snapshot source — GOTCHA #12). Default entries:[].
  - IMPLEMENT `function msgEntry(role: string, extra: Record<string, unknown> = {}): SessionEntry` → `{ type:"message", id:\`e-\${++n}\`, parentId:null, timestamp:"", message:{role, ...extra} } as unknown as SessionEntry` (GOTCHA #12 — flattens via the REAL sessionEntryToContextMessages to [message]).
  - IMPLEMENT `async function run(pi, ctx, params)` → `makeShrinkTool(pi).execute("call-1", params, undefined, undefined, ctx)` and `firstText(res)` (narrow content[0] to text — copy from checkpoint.test.ts).
  - describe "registration metadata (spec/05 §5)": tool.name === "mulligan_shrink"; tool.label === "Mulligan Shrink"; tool.description === SHRINK_DESC (assert the VERBATIM spec/05 §5 string); tool.parameters === ShrinkParams.
  - FOLLOW pattern: test/tools/checkpoint.test.ts registration describe block + makePi/makeCtx from markers.test.ts.

Task 7: CREATE test/tools/shrink.test.ts — the 3 refusal paths
  - config-disabled: setConfig({shrink:{enabled:false}}) (via config.ts setConfig) → refusal "shrink is disabled"; appendShrinkMarker NOT called (appended.length === 0).
  - empty replacement: run with replacement === "" and a whitespace-only "   " variant (valid non-empty target) → refusal "replacement must be non-empty"; no persistence.
  - structurally impossible target: each of `{by_tool_call_id:""}`, `{by_tool_call_id:"   "}`, `{by_tool_name:"", occurrence:"last"}`, `{by_content_includes:""}` → refusal "target discriminator must be non-empty"; no persistence. (These targets can never match sensibly — GOTCHA #7.)
  - ASSERT for each refusal: content is [{type:"text"}], firstText contains "Mulligan: refused —", details is present ({}) , AND appended.length === 0.
  - FOLLOW pattern: checkpoint.test.ts refusal describe blocks (it.each for the structural variants).
  - COVERAGE: each refusal is a DISTINCT text; NO persistence on any refusal.

Task 8: CREATE test/tools/shrink.test.ts — best-effort match (yes, for each matcher) + persistence payload
  - by_tool_call_id match: ctx.entries = [msgEntry("toolResult", {toolCallId:"call-A", toolName:"read", content:[{type:"text",text:"x"}]})]; run with target {by_tool_call_id:"call-A"} → success; feedbackText contains "(Matched now: yes)"; appended[0].customType === "mulligan:shrink"; appended[0].data.target === {by_tool_call_id:"call-A"}; appended[0].data.replacement === <replacement>; appended[0].data stamped with {schema:"pi-mulligan", v:1, kind:"shrink", id:<uuid>, seq:<number>, ts:<number>}.
  - by_tool_name+occurrence match: entries with two read toolResults; target {by_tool_name:"read", occurrence:"last"} → matched:yes (the LAST one); occurrence:"first" → matched:yes (the FIRST one). (Both match — assert the yes feedback; exact-index resolution is resolveShrinkTarget's tested concern, not the tool's.)
  - by_content_includes match: entries with a message whose content includes "ENOSPC"; target {by_content_includes:"ENOSPC"} → matched:yes.
  - reason persisted: run with reason:"too big" → appended[0].data.reason === "too big". run WITHOUT reason → appended[0].data.reason === undefined.
  - markerId in details: appendShrinkMarker returns getLeafId() (script leafId:"leaf-9") → details.markerId === "leaf-9". When leafId null → details.markerId === null (still success).
  - FOLLOW pattern: markers.test.ts appendShrinkMarker describe block (the persisted-data assertions) + checkpoint.test.ts success path.

Task 9: CREATE test/tools/shrink.test.ts — no-match-is-NOT-a-refusal + best-effort-failure
  - no match now (NON-refusal): entries with a read toolResult toolCallId:"call-A"; target {by_tool_call_id:"does-not-exist"} (non-empty → structurally valid, but currently unmatched) → SUCCESS: feedbackText contains "(Matched now: no)"; appended.length === 1 (the marker STILL persists — E8); details.matched === false.
  - by_content_includes no match: target {by_content_includes:"ZZZ-NOT-PRESENT"} with entries lacking it → matched:no + STILL persists.
  - best-effort failure: ctx with throwOnBuildContextEntries:true → match try/catch → matched:false; STILL success + STILL persists (E13 — never block); feedbackText "(Matched now: no)".
  - FOLLOW pattern: checkpoint.test.ts never-throws describe (the throwOn* flags).

Task 10: CREATE test/tools/shrink.test.ts — never-throws + result shape + types
  - never-throws: a throwing getEntries is NOT used (shrink uses buildContextEntries); instead test a throwing getSessionId (inside appendShrinkMarker → it returns null → tool STILL succeeds with markerId:null), a throwing getConfig, and a malformed params (params?.target undefined → targetIsStructurallyValid returns false → refusal, no throw). execute resolves to a text result on EVERY path (never rejects).
  - result shape: every path's content is [{type:"text", text:string}] AND details present (gotcha #4). Check success, each refusal, and the best-effort-failure path.
  - types: expectTypeOf(makeShrinkTool(pi)).toEqualTypeOf<ToolDefinition<typeof ShrinkParams, ShrinkDetails>>(); ShrinkArgs === Static<typeof ShrinkParams>; execute returns AgentToolResult<ShrinkDetails>.
  - FOLLOW pattern: checkpoint.test.ts "types" + "result shape" describe blocks.
  - COVERAGE: positive + negative for each public surface.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the factory closure (pi is NOT an execute arg — checkpoint.ts precedent)
export function makeShrinkTool(pi: ExtensionAPI): ToolDefinition<typeof ShrinkParams, ShrinkDetails> {
  return defineTool({
    name: "mulligan_shrink",
    label: "Mulligan Shrink",
    description: SHRINK_DESC,
    parameters: ShrinkParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return shrinkExecute(pi, _toolCallId, params, signal, onUpdate, ctx);   // pi captured via closure
    },
  });
}

// PATTERN: the execute body — ONE try/catch, refusal() on every error path (never throws — E13)
async function shrinkExecute(pi, _toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<ShrinkDetails>> {
  try {
    const config = getConfig();                                   // GOTCHA #10: read ONCE
    if (!config.shrink.enabled) return refusal("shrink is disabled");            // step 1, E14

    if (!isNonEmpty(params?.replacement)) return refusal("replacement must be non-empty");  // step 2

    if (!targetIsStructurallyValid(params?.target)) return refusal("target discriminator must be non-empty");  // step 3, GOTCHA #7

    // step 3/4 — best-effort yes/no; ADVISORY, never blocks (GOTCHA #6)
    let matched: boolean;
    try { matched = bestEffortMatch(ctx, params.target); }
    catch { matched = false; }

    // step 4 — persist (GOTCHA #1: NO cast, NO leaveNote — ShrinkMarkerInput matches exactly)
    const markerId = appendShrinkMarker(pi, ctx, {
      target: params.target,
      replacement: params.replacement,
      reason: params.reason,
    });

    // step 5 — feedback text (yes/no from the best-effort match)
    return { content: [{ type: "text", text: feedbackText(matched) }], details: { matched, markerId } };
  } catch (e) {
    return refusal(`unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// PATTERN: the best-effort match (read-only snapshot → pure resolver → boolean; never throws)
function bestEffortMatch(ctx: ExtensionContext, target: ShrinkArgs["target"]): boolean {
  try {
    const entries = ctx.sessionManager.buildContextEntries();                  // GOTCHA #5: snapshot
    const messages = entries.flatMap((e) => sessionEntryToContextMessages(e)); // AgentMessage[] ≡ MessageLike[]
    return resolveShrinkTarget(messages, target) !== null;                     // pure resolver (transforms.ts)
  } catch {
    return false;                                                              // GOTCHA #6: never block
  }
}

// PATTERN: the structural-validity check (GOTCHA #7 — "structurally impossible" operationalization)
function targetIsStructurallyValid(target: ShrinkArgs["target"] | undefined): boolean {
  if (!target || typeof target !== "object") return false;
  if ("by_tool_call_id" in target) return isNonEmpty(target.by_tool_call_id);
  if ("by_tool_name" in target) return isNonEmpty(target.by_tool_name);
  if ("by_content_includes" in target) return isNonEmpty(target.by_content_includes);
  return false;   // no recognizable discriminator
}

// CRITICAL: feedback text is spec/05 §2 VERBATIM, with the yes/no slot filled
function feedbackText(matched: boolean): string {
  return `Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: ${matched ? "yes" : "no"})`;
}
```

### Integration Points

```yaml
TOOL REGISTRATION (P1.M7.T1.S1 — NOT this task; do NOT touch index.ts):
  - index.ts will: pi.registerTool(makeShrinkTool(pi));
  - pattern: src/tools/checkpoint.ts (makeCheckpointTool) + spec/05 §5 registerTool summary.

PERSISTED STATE (written via markers.ts — this tool does NOT call pi.appendEntry directly):
  - pi.appendEntry("mulligan:shrink", { schema:"pi-mulligan", v:1, kind:"shrink", id:<uuid>, target, replacement, reason, seq, ts })  ← via appendShrinkMarker (stamps envelope/id/seq/ts; the tool passes {target, replacement, reason})
  - READ (best-effort match, advisory only): ctx.sessionManager.buildContextEntries() (snapshot → messages).
  - NOTE: shrink does NOT call pi.sendMessage (no note — GOTCHA #1) and does NOT call setLabel.

CONSUMED (read by the filter, P1.M4.T2.S1 — this tool WRITES, filter READS):
  - filter.ts readMarkers(ctx) scans getEntries() for customType "mulligan:shrink" → ShrinkMarker[]; the pipeline
    applies applyShrink (which calls resolveShrinkTarget) AFTER rewinds, oldest-first by seq, last-wins (spec/06 §5).
    The {target, replacement, reason} shape is the shared contract.

CONFIG (read-only, config.ts):
  - config.shrink.enabled (the master switch for THIS tool — E14).
  - (config.enabled is the EXTENSION master switch; spec/05 §2 step 1 gates on config.shrink.enabled specifically.)

NO DATABASE / NO ROUTES / NO NEW ENV VARS / NO config.shrink.maxDepth (it does not exist).
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating src/tools/shrink.ts — fix before proceeding
npx tsc --noEmit -p tsconfig.json          # strict typecheck; expect exit 0
# (This project uses tsc for typecheck + vitest for tests — NO ruff/mypy; those are Python tools in the template.)
# Expected: Zero errors. If errors exist, READ the output — the most likely causes are:
#   - a missing .js on a relative import (GOTCHA #9)
#   - a return path missing `details` (GOTCHA #4)
#   - the execute signature order (GOTCHA #2 — toolCallId FIRST, named _toolCallId since unused)
#   - a stray cast at the appendShrinkMarker call site (GOTCHA #1 — there should be NONE; remove it)
npx vitest run test/tools/shrink.test.ts   # run the new tests in isolation
# Expected: all green.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new tool in isolation
npx vitest run test/tools/shrink.test.ts -v
# Expected: all shrink tests pass — registration metadata, 3 refusal paths (disabled / empty-replacement /
#   structurally-impossible-target), best-effort match (yes for each of the 3 matchers), no-match-is-NOT-a-refusal
#   (matched:no + still persists), persistence payload (target/replacement/reason + envelope/id/seq/ts),
#   best-effort failure (throwing buildContextEntries → matched:no + still persists), never-throws, result shape, types.

# Full suite — NO regression (shrink.ts adds 2 files; touches nothing else)
npx vitest run
# Expected: all-green. Baseline before this task: 436 tests / 10 files. If a sibling test fails, it is NOT caused by
#   this task (shrink.ts imports only from already-shipped modules and adds no module-scoped mutable state beyond the
#   makeShrinkTool closure).
```

### Level 3: Integration Testing (System Validation)

```bash
# This task is a pure unit-tested tool module — there is NO running service to curl. The integration smoke harness
# (P1.M7.T2) exercises the tool end-to-end through a real Pi session. For THIS task, validate the contract via:
#   1. tsc --noEmit (Level 1) — the type system confirms the execute signature + AgentToolResult shape.
#   2. vitest (Level 2) — hand-rolled fakes confirm the 6 behavior steps + the persisted marker payload + match feedback.
# Optional manual sanity (requires a Pi session with the extension loaded — deferred to P1.M7.T2):
#   echo '{"method":"tools/call","params":{"name":"mulligan_shrink","arguments":{...}}}' | pi -e ./src/index.ts -p "..."
# Expected: a text tool result matching the feedback format; a mulligan:shrink marker in /tree.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Parallel-item non-interference:
# Confirm shrink.ts does NOT import from filter.ts (P1.M4.T2 runs in parallel) or index.ts, and does NOT touch
# markers.ts/transforms.ts/config.ts (frozen). It also must not duplicate rewind.ts's note/depth/checkpoint logic.
grep -n "filter.js\|index.js\|registerTool" src/tools/shrink.ts        # Expected: no matches (wiring is P1.M7.T1.S1)
grep -n "leaveNote\|validateNote\|renderNote\|extractFileLedger\|maxDepth\|checkpoint" src/tools/shrink.ts  # Expected: no matches (shrink has none of these — GOTCHA #1)

# Contract-shape check: the persisted marker's data has exactly {target, replacement, reason, schema, v, kind, id, seq, ts}.
# Confirmed by the Task 8 assertions (read appended[0].data). This is the shape the filter's applyShrink reads.
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (strict).
- [ ] `npx vitest run test/tools/shrink.test.ts` → all green.
- [ ] `npx vitest run` → all-green, no regression (436 baseline + new shrink tests).
- [ ] No lint issues (this repo has no linter configured beyond tsc strict).

### Feature Validation
- [ ] All 6 behavior steps implemented in order (config → replacement → structural-target → best-effort match → persist → return).
- [ ] Disabled → refusal; empty replacement → refusal; structurally-impossible target (empty/whitespace discriminator) → refusal.
- [ ] Success path persists the marker with `{target, replacement, reason}` (stamped with envelope + uuid id + seq + ts).
- [ ] No-match is NOT a refusal: a non-empty currently-unmatched target → success with `(Matched now: no)` + the marker STILL persists.
- [ ] Best-effort match reports yes/no honestly for each of the 3 matchers; a throwing buildContextEntries → matched:no + still success.
- [ ] Never throws (whole body try/catch → text result on any exception — E13).

### Code Quality Validation
- [ ] Mirrors src/tools/checkpoint.ts conventions (factory closure, defineTool, refusal() builder, verbatim DESC, .js imports).
- [ ] Delegates persistence to `appendShrinkMarker` (markers.ts) — does NOT reimplement pi.appendEntry.
- [ ] Delegates resolution to `resolveShrinkTarget` (transforms.ts) — does NOT reimplement matching.
- [ ] NO cast at the appendShrinkMarker call site (GOTCHA #1); NO leaveNote/validateNote/renderNote/extractFileLedger/maxDepth/checkpoint (shrink has none of these).
- [ ] `details` present on every return path (gotcha #4).

### Documentation & Deployment
- [ ] SHRINK_DESC is the spec/05 §5 VERBATIM string (Mode A — the description IS the LLM-facing docs).
- [ ] ShrinkParams field descriptions are spec/05 §2 VERBATIM (the LLM reads them, incl. the 3-arm target union descriptions).
- [ ] No new env vars; no config changes (reads existing config.shrink.enabled knob).

---

## Anti-Patterns to Avoid

- ❌ Don't call `pi.appendEntry` directly — delegate to `appendShrinkMarker` (markers.ts owns the envelope + seq + leaf capture).
- ❌ Don't cast the payload at the `appendShrinkMarker` call site — `ShrinkMarkerInput` already matches `{target, replacement, reason}` exactly (the rewind tool's checkpoint cast is rewind-specific; shrink has no equivalent gap — GOTCHA #1).
- ❌ Don't call `leaveNote` / `renderNote` / `validateNote` / `extractFileLedger` — shrink has NO note, NO ledger, NO mutation warning. (These are rewind's concerns; cargo-culting them here is a bug.)
- ❌ Don't add a depth guard — `config.shrink` has only `enabled` (no maxDepth). Spec/05 §2 has no depth step.
- ❌ Don't refuse on a current no-match — it is ADVISORY feedback only; the marker persists and the filter re-resolves it (E8, D7). Refuse ONLY on a structurally-impossible target (empty-after-trim discriminator — GOTCHA #7).
- ❌ Don't reimplement matching — `resolveShrinkTarget` (transforms.ts) is the shipped pure resolver. Feed it the snapshot.
- ❌ Don't read/transform `event.messages` — the tool is write-only w.r.t. messages (the snapshot via buildContextEntries is read-only + advisory).
- ❌ Don't call `getConfig()` repeatedly — read once at the top of execute (gotcha #10).
- ❌ Don't forget `details` on any return path (gotcha #4 — the house convention includes it on every path).
- ❌ Don't hardcode the description or feedback text — copy spec/05 §5 and spec/05 §2 VERBATIM.
- ❌ Don't touch index.ts / filter.ts / markers.ts / transforms.ts / config.ts — wiring is P1.M7.T1.S1; the filter runs in parallel; the others are frozen.
- ❌ Don't catch all exceptions silently without returning a text result — return a refusal describing the failure (E13).

---

## Confidence Score: 9/10

**Why 9, not 10:** shrink is SIMPLER than its sibling rewind (no note, no depth guard, no checkpoint, no mutation
warning, no ledger, no cast at the persistence call site), and every consumed signature is verified against the
installed source. The two residual judgment calls are: (a) the **"structurally impossible target"** operationalization
(empty-after-trim discriminator) — the spec is deliberately fuzzy here ("use judgement"); the PRP pins a defensible
reading with verified reasoning, but a reviewer might prefer a stricter/looser line; (b) the exact `details` shape on
refusal paths (the PRP uses `{}` — present-but-empty — to honor the house "details on every path" convention without
inventing a correlation scalar shrink lacks). Neither blocks one-pass success: the success-path tests, the
no-match-is-not-a-refusal test, and the persistence-payload test are all fully specified against verified fixtures.

**Key risks to watch:** (1) the `sessionEntryToContextMessages` flatten in the test must use a REAL
SessionMessageEntry shape (`{type:"message", message:{role,...}}`) — the PRP gives the exact fixture (GOTCHA #12).
(2) The feedback text must be copied VERBATIM (incl. the "from the next turn on" clause and the `(Matched now: yes|no)`
slot) — the Task 2/feedback-text spec pins it. Both gates are in place.