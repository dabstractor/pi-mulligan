# PRP — P1.M5.T1.S1: `mulligan_rewind` tool — schema, validation, persistence, confirmation

**Work item:** P1.M5.T1.S1 · **Points:** 2 · **Stage:** Agent-Callable Tools (spec/11 §2 Step 6 — `tools/rewind.ts`,
the "mulligan" itself; spec/05 §1; spec/03 §5; spec/04 §2.3/§3).
**Scope:** **CREATE two new files** — `src/tools/rewind.ts` (the `mulligan_rewind` tool: the typebox
`RewindParams` schema + the `execute` body that validates, resolves a read-only preview for the advisory ledger +
K, persists the rewind marker + note, and returns a confirmation) and `test/tools/rewind.test.ts` (registration
metadata, validation refusals, depth guard, checkpoint existence, persistence calls, K/mutation-warning text,
never-throws, types). **No other file is touched.** This is the SOLE writer of `mulligan:rewind` markers — the
first of the four agent-callable tools (spec/05 §5); `mulligan_checkpoint` (P1.M5.T3.S1 — DONE) is the proven
pattern to mirror.

> **PREREQUISITE (read first):** All consumed modules are DONE & shipped & unit-tested — `src/markers.ts`
> (P1.M4.T1.S1+S2: `appendRewindMarker`, `leaveNote`, `RewindMarkerInput`), `src/notes.ts` (P1.M2.T3.S1+S2:
> `validateNote`, `NOTE_INVALID_REASON`, `renderNote`, `NoteInput`), `src/ledger.ts` (P1.M2.T2.S1:
> `extractFileLedger`, `FileLedger`), `src/config.ts` (P1.M1.T2.S2: `getConfig`, `Granularity`), `src/transforms.ts`
> (P1.M3.*: `partitionIntoUnits`, `resolveLastToolCallGroup`, `resolveLastTurn`, `resolveCheckpoint`,
> `BranchEntry`), `src/runtime.ts` (`nextSeq` is called INSIDE `appendRewindMarker` — the tool does NOT call it
> directly). **Verify before coding:** `npx tsc --noEmit` exits 0 today (confirmed during research) and the four
> consumed exports resolve: `grep -n "export function appendRewindMarker\|export function leaveNote\|export
> function validateNote\|export function renderNote\|export function extractFileLedger" src/markers.ts src/notes.ts
> src/ledger.ts`.

> **Runs in parallel with P1.M4.T2.S1** (the `context` filter handler). Treat P1.M4.T2.S1's `src/filter.ts` as a
> CONTRACT: when this tool begins, the filter reads `mulligan:rewind` markers via `readMarkers(ctx)` (scanning
> `getEntries()`) and resolves them via `filterPipeline`. This tool writes the markers the filter consumes; the two
> share NO file. The **checkpoint-field gotcha** (§"Known Gotchas" #1) is the one cross-cutting contract subtlety
> between this writer and that reader — it is fully specified below.

---

## Goal

**Feature Goal**: Ship the **`mulligan_rewind`** tool — the "mulligan." When the agent realizes a recent tool
interaction was a bloated mistake or a whole turn pursued the wrong direction, it calls this tool with a structured
four-field note + a granularity. The tool: (1) refuses cleanly when disabled / the note is vacuous / a named
checkpoint is absent / the max-depth cap is hit; (2) does a **best-effort read-only** resolution of the target span
to extract a deterministic `FileLedger` and estimate K (messages to hide) — purely advisory, never mutating live
context; (3) persists a `mulligan:rewind` marker (control state, NOT in context) carrying the targeting **spec**
(granularity + options + `excludeToolCallId` + the **checkpoint name**); (4) leaves the rendered note as an
in-context `mulligan:note` CustomMessage; (5) returns a short confirmation naming K, appending a side-effect warning
when the hidden span mutated files/ran bash. The marker is resolved authoritatively by the `context` filter on the
NEXT inference (D7 — record a spec, not indices). The tool is **write-only w.r.t. the message list**: it never
reads/transforms `event.messages` (it never sees the context event); it records a spec and lets the filter resolve it.

**Deliverable** (CREATE two new files):
1. **`src/tools/rewind.ts`** — exports:
   - `export const RewindParams` — the typebox `Type.Object({...})` parameter schema (spec/05 §1, VERBATIM).
   - `export type RewindArgs = Static<typeof RewindParams>` — the inferred execute-time params type.
   - `export const REWIND_DESC` — the LLM-facing description string (spec/05 §5, VERBATIM).
   - `export interface RewindDetails` — the structured `details` payload (`{ granularity, k?, ledger?, markerId? }`)
     surfaced to logs/audit/UI on every return path.
   - `export function makeRewindTool(pi: ExtensionAPI): ToolDefinition<typeof RewindParams, RewindDetails>` — the
     factory that captures `pi` via closure (the proven checkpoint.ts shape). index.ts (P1.M7.T1.S1) does
     `pi.registerTool(makeRewindTool(pi))`. Unit tests do `makeRewindTool(fakePi)`.
2. **`test/tools/rewind.test.ts`** — hand-rolled `makePi()`/`makeCtx()` fakes (no `vi.fn()`; house idiom from
   test/markers.test.ts + test/tools/checkpoint.test.ts), with describe blocks for: registration metadata;
   config-disabled refusal; validateNote refusal (empty note field); checkpoint granularity existence refusal;
   depth-guard refusal; success path (marker persisted with the EXACT payload incl. `checkpoint` + `excludeToolCallId`
     = toolCallId, note left, success text with K); K=0 honesty; mutation warning; best-effort ledger
     (snapshot-throw → empty ledger + K=0 + still success); never-throws; result shape (details on every path);
     types (ToolDefinition/AgentToolResult).

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (rewind.ts compiles under `strict`; the `execute` signature is
  `(toolCallId, params, signal, onUpdate, ctx)`; every return path includes `details`; the typebox + Pi + pure-helper
  imports resolve).
- `npx vitest run test/tools/rewind.test.ts` → all rewind tests pass.
- `npx vitest run` → **all-green, no regression** (rewind.ts adds 2 new files; it touches nothing else).
- **Disabled** (`config.rewind.enabled === false`) → refusal text `"Mulligan: refused — rewind is disabled."`, and
  `appendRewindMarker`/`leaveNote` are NEVER called.
- **validateNote invalid** (any of the 4 note fields empty/whitespace) → refusal text using `NOTE_INVALID_REASON`
  (`"note fields must all be non-empty"`), prefixed `"Mulligan: refused — "`; no persistence.
- **checkpoint granularity + checkpoint name not on the branch** → refusal `"Mulligan: refused — checkpoint '<name>'
  not found on this branch."`; no persistence. (A malformed name naturally fails the label scan.)
- **depth guard** (active `mulligan:rewind` marker count `>= config.rewind.maxDepth`) → refusal naming the count +
  suggesting `mulligan_shrink` / continuing; no persistence.
- **success path persists** via `appendRewindMarker(pi, ctx, payload)` where `payload` = `{ granularity, options:
  { to_previous_prompt, protect: config.rewind.protectedRoles }, excludeToolCallId: toolCallId, note, ledger,
  checkpoint }` — and the persisted data carries `checkpoint` (gotcha #1). Then `leaveNote(pi, rendered, markerId)`.
- **`excludeToolCallId === toolCallId`** (the execute first arg) on every persisted marker.
- **success text** matches spec/05 §1: `"Mulligan: rewound <granularity>. <K> messages will be hidden from your view
  starting next turn. Note left.< mutation warning?>"`; K=0 appends `" (nothing matched to hide)"`.
- **mutation warning** appends the verbatim spec/08 E5 string iff
  `config.rewind.requireMutationWarning && (ledger.modifiedFiles.length || ledger.bashSideEffects.length)`.
- **best-effort ledger**: a throwing `buildContextEntries()` (or resolver) → empty ledger + K=0 + STILL success
  (never throws — E13); the note is still left.
- **never throws**: any unexpected exception → caught → text result describing the failure (shared tool convention).

---

## User Persona

**Target User**: The **LLM agent itself** (design principle #5: "the agent is the user"). Secondary consumers:
`index.ts` (P1.M7.T1.S1) registers the tool; the `context` filter (P1.M4.T2.S1) consumes the markers this tool
writes; `mulligan_audit` (P1.M5.T4.S1) reads `RewindDetails`-style data; the test suite + integration smoke harness
(P1.M7.T2).

**Use Case**: Mid-session, the agent ran a tool call whose output was far larger than useful (e.g. a 38k-token
`grep -r auth .`), or it realizes a recent turn went down the wrong path. It calls `mulligan_rewind` with a
structured note (what happened / what to avoid / the true current state / what to do next) and a granularity
(`last_tool_call_group` for surgical, `last_turn` for the whole turn, `checkpoint` for a named anchor set earlier).
The tool validates, persists a marker + note, and confirms. On the NEXT inference (which was already going to
happen — zero extra requests, design principle #3), the filter hides the span; the resumed model sees `[kept prefix]
+ [note] + [rewind confirmation]` and re-attempts better-informed. The hidden content stays on disk (soft-over-hard,
design principle #2) — recoverable and auditable via `/tree`.

**User Journey**:
1. `index.ts` factory: `pi.registerTool(makeRewindTool(pi))` once at startup.
2. Agent, mid-turn, decides a recent tool interaction / turn was a mistake → calls `mulligan_rewind({note, granularity,
   to_previous_prompt?, checkpoint?})`.
3. `execute(toolCallId, params, signal, onUpdate, ctx)`:
   a. `getConfig()` → disabled? refuse.
   b. `validateNote(params.note)` → invalid? refuse.
   c. granularity `checkpoint`? scan `getEntries()` for label `mulligan:checkpoint:<name>`; absent? refuse.
   d. depth guard: count active `mulligan:rewind` markers; `>= maxDepth`? refuse.
   e. read-only preview: snapshot = `buildContextEntries().flatMap(sessionEntryToContextMessages)`; resolve removal
      set by granularity (pure resolvers); `ledger = extractFileLedger(snapshot, remove)`; `K = remove.length`.
      (best-effort; try/catch → empty ledger + K=0.)
   f. `renderNote(note, ledger, granularity)`.
   g. `appendRewindMarker(pi, ctx, { granularity, options, excludeToolCallId: toolCallId, note, ledger, checkpoint })`
      → `markerId`.
   h. `leaveNote(pi, rendered, markerId ?? toolCallId)`.
   i. mutation warning iff applicable.
   j. return `{content:[{type:"text", text: success}], details:{granularity, k, ledger, markerId}}`.
4. Agent loop continues → next inference fires `context` → filter reads the fresh marker, hides the span.

**Pain Points Addressed**: (a) Without a rewind, a bloated tool result or a wrong turn pollutes context for the rest
of the task, burning tokens and confusing the model. (b) The structured four-field note is the PRIMARY defense
against confabulation (design principle / D2): the resumed model is told explicitly what happened, what to avoid, the
true state, and what to do next — so it re-attempts rather than blindly redoing. (c) The deterministic `FileLedger` +
mutation warning prevent compounding side effects (E5): the model is warned that disk effects persist, so it does not
blindly re-apply an edit or re-`mkdir`. (d) Recording a SPEC (not indices) makes rewinds robust to compaction (D7):
the filter re-resolves live each inference.

---

## Why

- **This tool IS the "mulligan"** — the headline operation that gives the project its name (spec/05 §1: "The
  'mulligan.' Shed recent context... and leave itself a structured note"). Until it ships, there is no way for the
  agent to trigger a rewind at all; the filter (P1.M4.T2) and the whole "soft rewind, zero extra requests" thesis
  (looper-smoke B1 proves the primitive) have nothing to apply.
- **The structured note is the confabulation defense (D2).** A rewind without a good note makes the resumed model
  guess why context changed → confabulation. `validateNote` (all 4 fields non-empty after trim) makes a half-hearted
  note a hard refusal (E9). The deterministic `FileLedger` augments the agent's `true_current_state` with a
  machine-extracted read/modified/bash classification so the model does not redo side-effectful work.
- **Advisory ledger + K, fail-open.** The tool does NOT have `event.messages` (it is not the context event). It builds
  a best-effort snapshot to extract the ledger and estimate K — purely advisory. The AUTHORITATIVE hiding happens in
  the filter on the next inference. If the snapshot/resolution fails, the ledger is empty + K=0 + the rewind STILL
  proceeds (the marker spec is what matters). This keeps the tool robust to compaction drift (D7, E8) and never lets
  an advisory computation block a legitimate rewind.
- **Soft-over-hard + zero-extra-requests (design principles #2, #3).** The tool writes control state (marker, NOT in
  context) + a context note (IN context); it never mutates the session tree and never costs an extra inference. The
  originals persist on disk for `/tree` inspection.
- **Honest bookkeeping (design principle #6).** K is computed from the filtered/resolved preview, and the mutation
  warning is honest about persisted disk effects.

---

## What

CREATE `src/tools/rewind.ts` and `test/tools/rewind.test.ts`. Behavior (spec/05 §1 steps 1–8):

- **Schema** (`RewindParams`, spec/05 §1 VERBATIM): `Type.Object({ note: Type.Object({ what_happened, avoid,
  true_current_state, next } each Type.String with its description), granularity: Type.Union([Literal
  "last_tool_call_group", Literal "last_turn", Literal "checkpoint"]), to_previous_prompt: Type.Optional(Type.Boolean),
  checkpoint: Type.Optional(Type.String) })`.
- **Description** (`REWIND_DESC`, spec/05 §5 VERBATIM).
- **execute** (body in ONE try/catch; never throws — E13):
  1. **config** (spec/05 §1 step 1; E14): `const config = getConfig(); if (!config.rewind.enabled) return refusal("rewind
     is disabled", params.granularity)`.
  2. **note** (step 2; E9): `const nv = validateNote(params.note); if (!nv.valid) return refusal(NOTE_INVALID_REASON,
     params.granularity)`.
  3. **granularity/checkpoint** (step 3; E10): if `params.granularity === "checkpoint"` → read `params.checkpoint`;
     if absent/empty → `refusal("checkpoint granularity requires a checkpoint name")`; else scan
     `ctx.sessionManager.getEntries()` for an entry with `type === "label" && label === \`mulligan:checkpoint:${name}\``;
     none → `refusal(\`checkpoint '${name}' not found on this branch\`, "checkpoint")`. (`last_tool_call_group` /
     `last_turn` → always valid.)
  4. **depth guard** (step 4; E4): `const depth = countRewindMarkers(ctx); if (depth >= config.rewind.maxDepth) return
     refusal(\`max rewind depth (${config.rewind.maxDepth}) reached; consider mulligan_shrink or continue\`, params.granularity)`.
  5. **read-only ledger + K preview** (step 5; best-effort): `const { ledger, k } = resolvePreview(ctx, params,
     toolCallId, config)` — wrapped in try/catch returning `{ ledger: emptyLedger(), k: 0 }` on any failure.
  6. **render note**: `const rendered = renderNote(params.note, ledger, params.granularity)`.
  7. **persist**: build the marker payload (incl. `checkpoint` — gotcha #1) and call `appendRewindMarker(pi, ctx,
     payload)` → `markerId`; then `leaveNote(pi, rendered, markerId ?? toolCallId)`.
  8. **mutation warning** (step 7; E5): iff `config.rewind.requireMutationWarning && (ledger.modifiedFiles.length ||
     ledger.bashSideEffects.length)` → `warning = " " + MUTATION_WARNING`.
  9. **return** success text with K (step 8): `successText(params.granularity, k, !!warning)` + `details:{ granularity,
     k, ledger, markerId }`.
  - **catch**: `refusal(\`unexpected error: ${e.message}\`, params?.granularity)`.

### Success Criteria
- [ ] All 9 behavior steps implemented exactly (config → note → checkpoint-existence → depth → preview → render →
      persist → warning → return), in that order.
- [ ] Tool is write-only w.r.t. messages (never receives/transforms `event.messages`).
- [ ] `checkpoint` is persisted on the marker (gotcha #1) — verifiable by inspecting `appendRewindMarker`'s captured
      `data.checkpoint`.
- [ ] `excludeToolCallId === toolCallId` on every persisted marker.

---

## All Needed Context

### Context Completeness Check

✅ "No Prior Knowledge" test PASSED: an implementer who knows nothing about this codebase gets — (a) the EXACT execute
signature + the factory-closure pattern (verified against dist .d.ts + checkpoint.ts); (b) the EXACT consumed
signatures of all 6 imported modules (markers/notes/ledger/config/transforms/Pi); (c) the EXACT spec text for the
schema, description, behavior steps, return texts, and mutation warning; (d) the critical cross-task `checkpoint`
gotcha with the verified reconciliation; (e) the verified import path for the snapshot conversion helper; (f) the
test idiom with the exact fake shapes needed (getEntries/getBranch/buildContextEntries).

### Documentation & References

```yaml
# MUST READ — the tool's own spec (VERBATIM schema + behavior + return texts)
- url: spec/05-tools.md#1-mulligan_rewind
  why: §1 RewindParams typebox schema (copy verbatim), the 8-step behavior, the Return shape (success/refusal text),
       step 5 (read-only ledger preview), step 7 (mutation warning), step 8 (K + K=0 honesty).
  critical: step 3 says last_tool_call_group/last_turn are "always valid" (the filter no-ops if nothing matches → tool
            STILL reports success with K=0). step 5 says the ledger is ADVISORY/best-effort. The success text template
            and the K=0 "(nothing matched to hide)" wording are load-bearing.

- url: spec/05-tools.md#5-tool-registration-summary-for-indexts
  why: §5 gives the REWIND_DESC description string VERBATIM (copy it) + the registerTool shape
       ({name:"mulligan_rewind", label:"Mulligan Rewind", description, parameters, execute}).
  critical: "Description strings (craft carefully — they drive LLM usage)" — copy the Rewind desc EXACTLY; it is the
            tool's user-facing documentation for the LLM (Mode A docs).

- url: spec/08-edge-cases.md
  why: E4 (maxDepth refusal — name the count + suggest shrink/continue), E5 (mutation warning — VERBATIM warning
       string), E9 (note validation — "note fields must all be non-empty"), E10 (checkpoint invalid/not found refuse),
       E13 (tool never throws — return text result), E14 (disabled → refuse "Mulligan is disabled").
  critical: E5's warning string is VERBATIM (do not rephrase). E13 = wrap the whole execute body in try/catch.

- url: spec/04-data-model.md
  why: §2.1 NoteInput (4 required non-empty fields), §2.2 FileLedger shape, §2.3 renderNote format, §3 RewindMarker
       (the persisted marker — note the spec/04 §3 granularity lists ONLY the 2 relative literals and has NO
       checkpoint field; see gotcha #1).
  critical: §3 is the source of the checkpoint-field gap (gotcha #1). The marker's `id` (uuid) is stamped by
            appendRewindMarker; the tool never sees it — leaveNote receives the marker ENTRY id.

- url: plan/001_2e5baf25fe9f/architecture/api_verification.md#8-tooldefinition--verified
  why: §8 VERIFIES the execute signature (toolCallId FIRST arg) + AgentToolResult shape (content + details? + isError?).
  critical: "NOTE on execute signature: The first argument is toolCallId — Mulligan's mulligan_rewind tool uses this
            to set excludeToolCallId on the rewind marker." AgentToolResult.details is REQUIRED (checkpoint.ts GOTCHA #1).

# PATTERN FILES — copy the structure/conventions, not the logic
- file: src/tools/checkpoint.ts
  why: the ONLY shipped tool — the canonical pattern (factory closure makeCheckpointTool(pi), defineTool, refusal()
       builder with details on every path, CKPT_DESC verbatim, try/catch never-throws, .js imports).
  pattern: mirror EXACTLY — makeRewindTool(pi) factory; refusal(reason, granularity) helper; REWIND_DESC verbatim;
           whole body try/catch; defineTool return; exports {RewindParams, RewindArgs, REWIND_DESC, RewindDetails, makeRewindTool}.
  gotcha: checkpoint.ts is SIMPLER (no read-only preview, no ledger, no K). The rewind tool ADDS the preview + ledger +
          mutation warning + depth guard + checkpoint-existence scan on top of the same skeleton.

- file: test/tools/checkpoint.test.ts
  why: the canonical tool-test idiom — vitest, hand-rolled makePi()/makeCtx() (NO vi.fn()), clearAll() before/after,
       expectTypeOf, firstText() helper, registration-metadata describe block.
  pattern: mirror the structure; ADD a richer makeCtx (getEntries for markers+labels; getBranch; buildContextEntries)
           and a richer makePi (appendEntry + sendMessage capture, already in test/markers.test.ts makePi).

- file: test/markers.test.ts
  why: the makePi() fake that captures appendEntry/sendMessage/setLabel (copy its shape); the makeCtx() fake shape.
  pattern: reuse makePi's {appended, sent, labels} capture. For rewind's makeCtx, script getEntries() (return an
           array of entries — rewind markers for depth, label entries for checkpoint existence), getBranch(), and
           buildContextEntries().

# CONSUMED MODULE CONTRACTS (DONE — import from these; do NOT reimplement)
- file: src/markers.ts
  why: appendRewindMarker(pi, ctx, data: RewindMarkerInput): string|null  +  leaveNote(pi, content, rewindId): void.
  pattern: appendRewindMarker stamps {schema,v,kind,id(uuid),seq(via nextSeq),ts} onto {...data}; returns the marker
           ENTRY id (getLeafId) or null (never throws). leaveNote calls pi.sendMessage({customType:"mulligan:note",
           content, display:true, details:{schema,v,kind:"note",rewindId}}) with NO options arg (C8); never throws.
  gotcha: RewindMarkerInput has NO checkpoint field — the tool MUST add it (gotcha #1).

- file: src/notes.ts
  why: validateNote(note): {valid, reason?}  (reason === NOTE_INVALID_REASON, NO trailing period); renderNote(note,
       ledger, granularity): string. NOTE_INVALID_REASON exported.
  gotcha: validateNote is defensive + never throws. reason is the SAME single string for every failure.

- file: src/ledger.ts
  why: extractFileLedger(messages: MessageLike[]|null, range: number[]|null): FileLedger. `range` = message INDICES.
  pattern: pass the resolved removal-set indices; it scans assistant messages at those indices.
  gotcha: ledger's MessageLike is structural {role?, content?, [key]} — a Pi AgentMessage[] assigns in.

- file: src/config.ts
  why: getConfig(): MulliganConfig (fresh clone each call); Granularity union; config.rewind.{enabled,
       protectedRoles[], maxDepth, requireMutationWarning}.
  gotcha: getConfig returns a clone — read once at the top of execute.

- file: src/transforms.ts
  why: the PURE resolvers for the read-only preview — partitionIntoUnits(messages): Unit[];
       resolveLastToolCallGroup(units, messages, excludeId?): number[]|null;
       resolveLastTurn(messages, opts:{to_previous_prompt?}, excludeId?): {remove:number[]};
       resolveCheckpoint(messages, branchEntries:BranchEntry[], name, excludeId?): {remove}|null.
  pattern: mirror filterPipeline's granularity dispatch (re-partition fresh for last_tool_call_group; read
           options.to_previous_prompt VERBATIM; pass branchEntries DATA not ctx).
  gotcha: transforms is Pi-FREE (0 imports) — importing it into the tool is safe (no circular dep). For checkpoint,
          pass ctx.sessionManager.getBranch() (leaf→root; resolveCheckpoint reverses internally).

- file: src/runtime.ts
  why: nextSeq(sessionId) — BUT the tool does NOT call it; appendRewindMarker calls it internally. Documented for
       awareness only.
```

### Current Codebase tree

```bash
src/
├── index.ts            # stub factory (P1.M7.T1.S1 will wire tools) — DO NOT TOUCH
├── config.ts           # getConfig, Granularity, MulliganConfig, DEFAULT_CONFIG   ✓ DONE
├── log.ts              # structured JSONL logger (log(level,event,sessionId,meta)) ✓ DONE
├── runtime.ts          # getRuntime, nextSeq, resetRuntime, clearAll             ✓ DONE
├── tokens.ts           # estimateTokens, resultBytes, approxTokens               ✓ DONE (not needed here)
├── ledger.ts           # extractFileLedger, FileLedger, MessageLike              ✓ DONE (consumed)
├── notes.ts            # validateNote, NOTE_INVALID_REASON, renderNote, NoteInput ✓ DONE (consumed)
├── transforms.ts       # partitionIntoUnits, resolve*, apply*, filterPipeline    ✓ DONE (consumed: resolvers)
├── markers.ts          # appendRewindMarker, leaveNote, RewindMarkerInput        ✓ DONE (consumed)
├── filter.ts           # context handler (P1.M4.T2.S1 — in parallel)             ◐ CONTRACT (reads markers)
└── tools/
    └── checkpoint.ts   # the ONLY shipped tool — the PATTERN to mirror            ✓ DONE (pattern)
test/
├── tools/checkpoint.test.ts   # the tool-test idiom (pattern)
├── markers.test.ts            # makePi/makeCtx fakes with appendEntry/sendMessage (pattern)
└── ... (config/log/runtime/tokens/ledger/notes/transforms.test.ts — all green)
```

### Desired Codebase tree with files to be added

```bash
src/tools/
├── checkpoint.ts        # unchanged
└── rewind.ts            # ★ NEW — RewindParams schema + makeRewindTool(pi) factory + execute body
test/tools/
├── checkpoint.test.ts   # unchanged
└── rewind.test.ts       # ★ NEW — registration, refusals (4), persistence, K/mutation text, never-throws, types
```

**File responsibilities:**
- `src/tools/rewind.ts` — the `mulligan_rewind` tool definition (schema + description + factory + execute). Owns:
  typebox schema, all 9 validation/behavior steps, the read-only preview helper (snapshot → resolvers → ledger → K),
  the refusal/success text builders, the `details` payload. Delegates persistence to `appendRewindMarker`/`leaveNote`
  (markers.ts) and never reimplements `pi.appendEntry`/`pi.sendMessage`.
- `test/tools/rewind.test.ts` — unit tests with hand-rolled fakes; verifies the 4 refusal paths, the success path
  (exact persisted payload incl. checkpoint + excludeToolCallId, note left), K/K=0 text, mutation warning,
  best-effort ledger (snapshot-throw), never-throws, result shape, and types.

### Known Gotchas of our codebase & Library Quirks

```ts
// ★★★ GOTCHA #1 (CRITICAL, cross-task): PERSIST THE checkpoint NAME.
// RewindMarker / RewindMarkerInput in src/markers.ts (P1.M4.T1.S1 — FROZEN) have NO `checkpoint` field (spec/04 §3
// omits it). BUT filterPipeline (src/transforms.ts) reads checkpoint granularity via `readOwn(rw, "checkpoint")`
// and RewindMarkerLike has `checkpoint?: string`. The transforms.ts author DOCUMENTED this gap. The rewind tool is
// the SOLE writer — if it does NOT persist `checkpoint`, every checkpoint rewind SILENTLY NO-OPS.
// FIX: include `checkpoint: params.checkpoint` in the data object passed to appendRewindMarker. The wrapper does
// `{...data, schema, v, kind, id, seq, ts}` → the spread PRESERVES the extra field at runtime. The frozen
// RewindMarkerInput TYPE omits it → build the payload as a widened local object and cast at the call site:
//   const payload = { granularity, options, excludeToolCallId: toolCallId, note, ledger, checkpoint: params.checkpoint };
//   appendRewindMarker(pi, ctx, payload as RewindMarkerInput);   // cast: frozen type omits checkpoint (spec/04 §3)
// (The cast is structurally sound — runtime preserves it; filterPipeline's readOwn finds it.)

// GOTCHA #2: toolCallId is the FIRST execute arg (NOT params). It becomes excludeToolCallId on the marker so the
// filter skips the rewind's OWN tool-call group (spec/05 §1 step 6; api_verification.md §8 NOTE).
//   async execute(toolCallId, params, signal, onUpdate, ctx) { ... excludeToolCallId: toolCallId ... }

// GOTCHA #3: pi (ExtensionAPI) is NOT an execute arg — capture it via the makeRewindTool(pi) factory closure
// (checkpoint.ts precedent). index.ts does pi.registerTool(makeRewindTool(pi)).

// GOTCHA #4: AgentToolResult<T> requires a `details` field on EVERY return path (checkpoint.ts CRITICAL GOTCHA #1;
// strict mode). spec/05 §1's {content:[...]}-only shape is a SIMPLIFICATION. Use a small RewindDetails object.

// GOTCHA #5: the tool is WRITE-ONLY w.r.t. messages — it NEVER receives event.messages (it is not the context event).
// For the advisory ledger + K, build a SNAPSHOT via ctx.sessionManager.buildContextEntries().flatMap(
// sessionEntryToContextMessages). sessionEntryToContextMessages + SessionEntry ARE re-exported from the MAIN package
// "@earendil-works/pi-coding-agent" (dist/index.d.ts line 19 — VERIFIED). Import them directly (no deep import).

// GOTCHA #6: the snapshot may DIFFER from event.messages (the authoritative list the filter uses) and will NOT
// contain the current in-flight rewind call yet. That is FINE and intended: the ledger is ADVISORY (spec/05 §1
// step 5: "the ledger is advisory"); K is an ESTIMATE (step 8); the AUTHORITATIVE hiding happens in the filter on
// the next inference (D7 — record a spec, not indices). Wrap the preview in try/catch → empty ledger + K=0 + still
// success. NEVER let an advisory computation block/refuse a legitimate rewind.

// GOTCHA #7: extractFileLedger's `range` is a number[] of MESSAGE INDICES (NOT a [start,end) tuple). Feed it the
// resolver's removal set (the same indices K counts). It scans assistant messages at those indices only.

// GOTCHA #8: resolveCheckpoint takes branchEntries DATA (ctx.sessionManager.getBranch(), leaf→root) — NOT ctx
// (transforms.ts is Pi-FREE). Pass getBranch() directly; resolveCheckpoint reverses internally.

// GOTCHA #9: countRewindMarkers for the depth guard — scan ctx.sessionManager.getEntries() for
// {type:"custom", customType:"mulligan:rewind"}. (Filter's readMarkers scans getEntries() too; consistent.)
// Spec says "on the branch" — in a linear session getEntries() == branch. Markers are permanent (never cleared),
// so ALL persisted rewind markers count toward maxDepth.

// GOTCHA #10: leaveNote(pi, content, rewindId) — rewindId correlates note↔marker. appendRewindMarker returns the
// marker ENTRY id (getLeafId); spec/04 §3 names <marker.id> (uuid). Both are unique-per-entry → correlation holds
// either way (markers.ts interface note). Pass `markerId ?? toolCallId` (fallback when append returned null).
// leaveNote NEVER throws (swallows sendMessage failures) and passes NO options arg (C8 — mid-turn).

// GOTCHA #11: renderNote is called with the ALREADY-VALIDATED note + the extracted ledger + the granularity. It
// does NOT re-validate (validateNote already passed). It omits empty ledger blocks (<files-read> etc.) automatically.

// GOTCHA #12: the success text for K=0 — report honestly (spec/05 §1 step 8: "0 is reported honestly as 'nothing
// matched to hide'"). Append " (nothing matched to hide)" so the agent is not misled.

// GOTCHA #13: .js extension on ALL relative imports (ESM/Bundler resolution; tsconfig moduleResolution:"Bundler").
// Pi imports use the bare specifier "@earendil-works/pi-coding-agent".

// GOTCHA #14: getConfig() returns a fresh CLONE each call — read once at the top of execute and reuse the local
// (do not call getConfig() repeatedly).

// GOTCHA #15 (parallel-item awareness): P1.M4.T2.S1 (filter.ts) runs IN PARALLEL. It reads mulligan:rewind markers
// via readMarkers(ctx) and resolves them via filterPipeline. This tool writes those markers. The checkpoint field
// (gotcha #1) is the shared contract. Do NOT touch filter.ts; do NOT reimplement readMarkers. The marker this tool
// persists must be consumable by filterPipeline's RewindMarkerLike shape (granularity, options, excludeToolCallId,
// checkpoint) — which it is by construction.
```

---

## Implementation Blueprint

### Data models and structure

```ts
// RewindDetails — the AgentToolResult.details payload (REQUIRED on every path — GOTCHA #4).
export interface RewindDetails {
  /** The requested granularity (present on every path for correlation). */
  granularity: Granularity;
  /** Estimated messages to hide (success path only). */
  k?: number;
  /** The extracted file ledger (success path only; empty on best-effort failure). */
  ledger?: FileLedger;
  /** The persisted marker's entry id (success path; null/omitted when append returned null). */
  markerId?: string | null;
}

// RewindParams — the typebox schema (spec/05 §1 VERBATIM — copy the Type.Object exactly, incl. field descriptions).
export const RewindParams = Type.Object({
  note: Type.Object({
    what_happened: Type.String({ description: "Past tense: what specifically went wrong and wasted context. Be concrete." }),
    avoid: Type.String({ description: "Imperative: what NOT to do again on resume." }),
    true_current_state: Type.String({ description: "The TRUE current state as of this rewind — files changed, commands run, decisions made on the span being discarded. This prevents redoing work. (A deterministic file ledger is auto-appended.)" }),
    next: Type.String({ description: "Imperative: the immediate next action to take when you resume." }),
  }, { description: "The note your resumed self will read. All four fields required." }),
  granularity: Type.Union([
    Type.Literal("last_tool_call_group"),
    Type.Literal("last_turn"),
    Type.Literal("checkpoint"),
  ], { description: "last_tool_call_group = hide just the most recent tool interaction (the assistant turn that issued tool calls + their results). Surgical. last_turn = hide all your work after the most recent user message, landing back at that prompt to re-attempt the turn. checkpoint = hide back to a named checkpoint you set earlier (requires `checkpoint`)." }),
  to_previous_prompt: Type.Optional(Type.Boolean({ description: "Only for granularity=last_turn. If true, also discard the most recent user message (nuclear: you abandon the current ask entirely). Default false." })),
  checkpoint: Type.Optional(Type.String({ description: "Required when granularity=checkpoint. The name of a checkpoint set via mulligan_checkpoint." })),
});
export type RewindArgs = Static<typeof RewindParams>;

// MUTATION_WARNING — the spec/08 E5 VERBATIM warning appended to the success text (GOTCHA: leading space + ⚠).
const MUTATION_WARNING =
  "⚠ The hidden span modified files/ran side-effecting commands (see note). " +
  "Those effects PERSIST on disk; do not blindly redo them.";

// emptyLedger — the fail-open fallback ({readFiles:[], modifiedFiles:[], bashSideEffects:[]}).
function emptyLedger(): FileLedger { return { readFiles: [], modifiedFiles: [], bashSideEffects: [] }; }
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/tools/rewind.ts — imports + schema + constants
  - IMPORT (Pi): `import { defineTool, type AgentToolResult, type ExtensionAPI, type ExtensionContext, type ToolDefinition, sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent"` (GOTCHA #5: sessionEntryToContextMessages + SessionEntry ARE re-exported from main — VERIFIED dist/index.d.ts line 19).
  - IMPORT (typebox): `import { Type } from "typebox"; import type { Static } from "typebox"`.
  - IMPORT (markers): `import { appendRewindMarker, leaveNote, type RewindMarkerInput } from "../markers.js"` (GOTCHA #13: .js).
  - IMPORT (notes): `import { validateNote, renderNote, NOTE_INVALID_REASON, type NoteInput } from "../notes.js"`.
  - IMPORT (ledger): `import { extractFileLedger, type FileLedger } from "../ledger.js"`.
  - IMPORT (config): `import { getConfig, type Granularity } from "../config.js"`.
  - IMPORT (transforms resolvers): `import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint, type BranchEntry } from "../transforms.js"`.
  - DEFINE: `RewindParams` (Type.Object, spec/05 §1 VERBATIM incl. every field description), `RewindArgs`, `RewindDetails`, `REWIND_DESC` (spec/05 §5 VERBATIM), `MUTATION_WARNING` (spec/08 E5 VERBATIM), `emptyLedger()`.
  - FOLLOW pattern: src/tools/checkpoint.ts (import block + const-export ordering).
  - NAMING: RewindParams (PascalCase schema), RewindArgs/RewindDetails (types), REWIND_DESC/MUTATION_WARNING (SCREAMING_SNAKE consts).

Task 2: CREATE src/tools/rewind.ts — text builders (refusal / success)
  - IMPLEMENT `function refusal(reason: string, granularity: Granularity): AgentToolResult<RewindDetails>` → `{ content:[{type:"text", text:\`Mulligan: refused — ${reason}.\`}], details:{ granularity } }` (GOTCHA #4: details on every path; shared "Mulligan: refused — <reason>." prefix).
  - IMPLEMENT `function successText(granularity, k, hasWarning): { text, warning }` → returns the text `Mulligan: rewound <granularity>. <k> messages will be hidden from your view starting next turn< (nothing matched to hide) if k===0>. Note left.< ⚠... if hasWarning>` (spec/05 §1 Return shape + step 8 K=0 honesty — GOTCHA #12).
  - FOLLOW pattern: checkpoint.ts refusal() builder (same shape, different details payload).
  - NAMING: refusal, successText (snake_case functions).

Task 3: CREATE src/tools/rewind.ts — pure preview helpers (read-only ledger + K)
  - IMPLEMENT `function countRewindMarkers(ctx): number` — scan `ctx.sessionManager.getEntries()` for entries where `type === "custom" && customType === "mulligan:rewind"`; return the count. Defensive (never throws; non-array → 0). (Depth guard source — GOTCHA #9.)
  - IMPLEMENT `function checkpointExists(ctx, name): boolean` — scan `ctx.sessionManager.getEntries()` for an entry where `type === "label" && label === \`mulligan:checkpoint:${name}\``; return found. Defensive (never throws). (Checkpoint-existence — step 3, GOTCHA: a malformed name naturally returns false.)
  - IMPLEMENT `function resolvePreview(ctx, params, toolCallId, config): { ledger: FileLedger; k: number }`:
      * `const entries = ctx.sessionManager.buildContextEntries();`
      * `const messages = entries.flatMap((e) => sessionEntryToContextMessages(e));` (GOTCHA #5 — snapshot; structurally MessageLike[]).
      * granularity dispatch (mirror filterPipeline — spec/06 §12):
          - "last_tool_call_group": `const units = partitionIntoUnits(messages); const remove = resolveLastToolCallGroup(units, messages, toolCallId) ?? [];`
          - "last_turn": `const remove = resolveLastTurn(messages, { to_previous_prompt: params.to_previous_prompt }, toolCallId).remove;`
          - "checkpoint": `const branchEntries = ctx.sessionManager.getBranch() as BranchEntry[]; const remove = resolveCheckpoint(messages, branchEntries, params.checkpoint ?? "", toolCallId)?.remove ?? [];`
      * `const ledger = extractFileLedger(messages, remove);` (GOTCHA #7: remove = message indices)
      * `return { ledger, k: remove.length };`
      * The CALLER wraps resolvePreview in try/catch → { ledger: emptyLedger(), k: 0 } (GOTCHA #6).
  - FOLLOW pattern: src/transforms.ts filterPipeline granularity dispatch (re-partition fresh for last_tool_call_group; read options.to_previous_prompt VERBATIM).
  - NAMING: countRewindMarkers, checkpointExists, resolvePreview (snake_case, descriptive).
  - PLACEMENT: module-private helpers in rewind.ts (not exported — only makeRewindTool + schema/types/desc are public).

Task 4: CREATE src/tools/rewind.ts — execute body (the 9 steps)
  - IMPLEMENT `async function rewindExecute(pi, toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<RewindDetails>>` with the WHOLE body in ONE try/catch (E13 — never throws):
      1. `const config = getConfig(); if (!config.rewind.enabled) return refusal("rewind is disabled", params.granularity);` (step 1, E14)
      2. `const nv = validateNote(params.note); if (!nv.valid) return refusal(NOTE_INVALID_REASON, params.granularity);` (step 2, E9 — NOTE_INVALID_REASON has NO trailing period; refusal() adds the ".".)
      3. `if (params.granularity === "checkpoint") { const name = params.checkpoint; if (!name || name.length === 0) return refusal("checkpoint granularity requires a checkpoint name", "checkpoint"); if (!checkpointExists(ctx, name)) return refusal(\`checkpoint '${name}' not found on this branch\`, "checkpoint"); }` (step 3, E10)
      4. `const depth = countRewindMarkers(ctx); if (depth >= config.rewind.maxDepth) return refusal(\`max rewind depth (${config.rewind.maxDepth}) reached — ${depth} active rewind marker(s). Consider mulligan_shrink or just continuing; if stuck in a loop, the human should intervene\`, params.granularity);` (step 4, E4)
      5. `let ledger: FileLedger; let k: number; try { ({ ledger, k } = resolvePreview(ctx, params, toolCallId, config)); } catch { ledger = emptyLedger(); k = 0; }` (step 5 — best-effort, GOTCHA #6)
      6. `const rendered = renderNote(params.note, ledger, params.granularity);` (step 6 — note already validated)
      7. persist (step 7 — GOTCHA #1 checkpoint):
           ```
           const payload = {
             granularity: params.granularity,
             options: { to_previous_prompt: params.to_previous_prompt, protect: config.rewind.protectedRoles },
             excludeToolCallId: toolCallId,            // GOTCHA #2: the execute first arg
             note: params.note,
             ledger,
             checkpoint: params.checkpoint,            // GOTCHA #1: MUST persist (frozen type omits it → cast)
           };
           const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput);  // cast: spec/04 §3 omits checkpoint
           leaveNote(pi, rendered, markerId ?? toolCallId);                             // GOTCHA #10: entry id, fallback toolCallId
           ```
      8. mutation warning (step 7/E5): `const hasWarning = config.rewind.requireMutationWarning && (ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0);`
      9. return success (step 8): `const { text } = successText(params.granularity, k, hasWarning); return { content:[{type:"text", text}], details:{ granularity: params.granularity, k, ledger, markerId } };`
      - catch: `return refusal(\`unexpected error: ${e instanceof Error ? e.message : String(e)}\`, params?.granularity ?? "last_tool_call_group");`
  - FOLLOW pattern: checkpoint.ts checkpointExecute (pi as first arg via closure; try/catch; refusal() on every error path).
  - DEPENDENCIES: Tasks 1–3 (schema, builders, helpers).
  - NAMING: rewindExecute, makeRewindTool.

Task 5: CREATE src/tools/rewind.ts — the factory (defineTool)
  - IMPLEMENT `export function makeRewindTool(pi: ExtensionAPI): ToolDefinition<typeof RewindParams, RewindDetails>`:
      ```
      return defineTool({
        name: "mulligan_rewind",
        label: "Mulligan Rewind",
        description: REWIND_DESC,           // spec/05 §5 VERBATIM
        parameters: RewindParams,
        async execute(toolCallId, params, signal, onUpdate, ctx) { return rewindExecute(pi, toolCallId, params, signal, onUpdate, ctx); },
      });
      ```
  - FOLLOW pattern: checkpoint.ts makeCheckpointTool (defineTool preserves RewindParams inference).
  - NAMING: makeRewindTool (camelCase factory).

Task 6: CREATE test/tools/rewind.test.ts — registration metadata
  - IMPLEMENT describe "registration metadata (spec/05 §5)": tool.name === "mulligan_rewind"; tool.label === "Mulligan Rewind"; tool.description === REWIND_DESC (assert the VERBATIM spec/05 §5 string); tool.parameters === RewindParams.
  - FOLLOW pattern: test/tools/checkpoint.test.ts registration describe block.
  - NAMING: file test/tools/rewind.test.ts; reuses makePi/makeCtx/firstText/run helpers.

Task 7: CREATE test/tools/rewind.test.ts — the 4 refusal paths
  - config-disabled: setConfig({rewind:{enabled:false}}) → refusal "rewind is disabled"; appendRewindMarker NOT called.
  - invalid note: run with note.what_happened === "" (and a whitespace-only variant) → refusal contains NOTE_INVALID_REASON; no persistence.
  - checkpoint not found: granularity "checkpoint", checkpoint "nope", ctx.getEntries returns NO matching label → refusal "checkpoint 'nope' not found on this branch"; no persistence. ALSO test a checkpoint that EXISTS → passes the existence check (proceeds to depth/preview).
  - depth guard: ctx.getEntries returns `maxDepth` (default 5) mulligan:rewind markers → refusal "max rewind depth (5) reached"; no persistence.
  - FOLLOW pattern: checkpoint.test.ts refusal describe blocks (it.each for boundary values where useful).
  - COVERAGE: each refusal is a DISTINCT text; details.granularity present on each.

Task 8: CREATE test/tools/rewind.test.ts — success path (the contract)
  - happy path (last_tool_call_group): a snapshot with an assistant tool-call group + results → success; assert makePi.appended has ONE entry with customType "mulligan:rewind" and data fields: `granularity`, `options:{to_previous_prompt, protect}`, `excludeToolCallId === "call-1"` (the toolCallId), `note` (the 4 fields), `ledger`, AND `checkpoint` (gotcha #1 — assert the field is present even for non-checkpoint granularity, as undefined is acceptable; for checkpoint granularity assert checkpoint === name). Assert leaveNote called once (makePi.sent has one mulligan:note with content = renderNote output). Assert success text contains K and "Note left.".
  - checkpoint success: granularity "checkpoint", checkpoint "anchor", ctx.getEntries includes a label `mulligan:checkpoint:anchor` → success; assert appended marker data.checkpoint === "anchor" (gotcha #1 — THE key assertion).
  - excludeToolCallId === toolCallId on every persisted marker.
  - K from preview: script buildContextEntries to return entries that flatten to messages with a known tool-call group; assert K matches the resolver output (mirror transforms.test.ts fixtures).
  - FOLLOW pattern: markers.test.ts makePi (capture appended/sent); checkpoint.test.ts success-path assertions.

Task 9: CREATE test/tools/rewind.test.ts — K=0 honesty + mutation warning + best-effort ledger
  - K=0: snapshot with NO tool-call group (last_tool_call_group resolves to []) → success text contains "0 messages" AND "(nothing matched to hide)".
  - mutation warning: ledger with modifiedFiles non-empty (script snapshot with an assistant `write`/`edit` toolCall in the removal set) AND config.rewind.requireMutationWarning true → success text contains the VERBATIM MUTATION_WARNING substring ("⚠ The hidden span modified files"). When requireMutationWarning false → no warning. When ledger empty → no warning.
  - best-effort ledger: ctx.buildContextEntries() THROWS → resolvePreview catch → success with empty ledger + K=0 + STILL leaves the note + STILL returns success (E13 — never blocks).
  - FOLLOW pattern: checkpoint.test.ts never-throws describe block (throwOn* flags).

Task 10: CREATE test/tools/rewind.test.ts — never-throws + result shape + types
  - never-throws: a throwing getEntries (depth guard) / validateNote on a malformed note / throwing appendRewindMarker (fake pi.throwOnAppend) → execute resolves to a text result (never rejects). NOTE: appendRewindMarker swallows internally (returns null) — so a throw inside it does not surface; test a throwing getConfig or a throwing getEntries instead.
  - result shape: every path's content is [{type:"text", text:string}] AND details present (gotcha #4).
  - types: expectTypeOf(makeRewindTool(pi)).toEqualTypeOf<ToolDefinition<typeof RewindParams, RewindDetails>>(); RewindArgs === Static<typeof RewindParams>; execute returns AgentToolResult<RewindDetails>.
  - FOLLOW pattern: checkpoint.test.ts "types" describe block + "result shape" describe block.
  - COVERAGE: positive + negative for each public surface.
```

### Implementation Patterns & Key Details

```ts
// PATTERN: the factory closure (pi is NOT an execute arg — checkpoint.ts precedent)
export function makeRewindTool(pi: ExtensionAPI): ToolDefinition<typeof RewindParams, RewindDetails> {
  return defineTool({
    name: "mulligan_rewind",
    label: "Mulligan Rewind",
    description: REWIND_DESC,
    parameters: RewindParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return rewindExecute(pi, toolCallId, params, signal, onUpdate, ctx);   // pi captured via closure
    },
  });
}

// PATTERN: the execute body — ONE try/catch, refusal() on every error path (never throws — E13)
async function rewindExecute(pi, toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<RewindDetails>> {
  try {
    const config = getConfig();                                   // GOTCHA #14: read ONCE
    if (!config.rewind.enabled) return refusal("rewind is disabled", params.granularity);

    const nv = validateNote(params.note);                         // notes.ts — never throws
    if (!nv.valid) return refusal(NOTE_INVALID_REASON, params.granularity);  // reason has NO trailing "."

    if (params.granularity === "checkpoint") {                    // step 3, E10
      const name = params.checkpoint;
      if (!name) return refusal("checkpoint granularity requires a checkpoint name", "checkpoint");
      if (!checkpointExists(ctx, name)) return refusal(`checkpoint '${name}' not found on this branch`, "checkpoint");
    }

    const depth = countRewindMarkers(ctx);                        // step 4, E4
    if (depth >= config.rewind.maxDepth)
      return refusal(`max rewind depth (${config.rewind.maxDepth}) reached — ${depth} active rewind marker(s). Consider mulligan_shrink or just continuing; if stuck in a loop, the human should intervene`, params.granularity);

    let ledger: FileLedger; let k: number;                        // step 5 — best-effort, GOTCHA #6
    try { ({ ledger, k } = resolvePreview(ctx, params, toolCallId, config)); }
    catch { ledger = emptyLedger(); k = 0; }                      // advisory — never block a rewind

    const rendered = renderNote(params.note, ledger, params.granularity);   // step 6 — note already validated

    // step 7 — persist (GOTCHA #1: checkpoint MUST be in the payload; GOTCHA #2: excludeToolCallId = toolCallId)
    const payload = {
      granularity: params.granularity,
      options: { to_previous_prompt: params.to_previous_prompt, protect: config.rewind.protectedRoles },
      excludeToolCallId: toolCallId,
      note: params.note,
      ledger,
      checkpoint: params.checkpoint,                             // GOTCHA #1: persists even when undefined
    };
    const markerId = appendRewindMarker(pi, ctx, payload as RewindMarkerInput);  // cast: spec/04 §3 omits checkpoint
    leaveNote(pi, rendered, markerId ?? toolCallId);             // GOTCHA #10: entry id; fallback toolCallId

    const hasWarning = config.rewind.requireMutationWarning      // step 7/E5
      && (ledger.modifiedFiles.length > 0 || ledger.bashSideEffects.length > 0);
    const { text } = successText(params.granularity, k, hasWarning);   // step 8 — K + K=0 honesty

    return { content: [{ type: "text", text }], details: { granularity: params.granularity, k, ledger, markerId } };
  } catch (e) {
    return refusal(`unexpected error: ${e instanceof Error ? e.message : String(e)}`, params?.granularity ?? "last_tool_call_group");
  }
}

// PATTERN: the read-only preview (mirror filterPipeline's granularity dispatch — spec/06 §12)
function resolvePreview(ctx, params, toolCallId, _config): { ledger: FileLedger; k: number } {
  const entries = ctx.sessionManager.buildContextEntries();        // GOTCHA #5: snapshot, compaction-aware
  const messages = entries.flatMap((e) => sessionEntryToContextMessages(e));  // AgentMessage[] ≡ MessageLike[]

  let remove: number[];
  if (params.granularity === "last_tool_call_group") {
    const units = partitionIntoUnits(messages);                    // re-partition FRESH (filterPipeline GOTCHA #2)
    remove = resolveLastToolCallGroup(units, messages, toolCallId) ?? [];
  } else if (params.granularity === "last_turn") {
    remove = resolveLastTurn(messages, { to_previous_prompt: params.to_previous_prompt }, toolCallId).remove;
  } else { // checkpoint
    const branchEntries = ctx.sessionManager.getBranch() as BranchEntry[];   // GOTCHA #8: DATA, not ctx
    remove = resolveCheckpoint(messages, branchEntries, params.checkpoint ?? "", toolCallId)?.remove ?? [];
  }
  const ledger = extractFileLedger(messages, remove);              // GOTCHA #7: remove = message indices
  return { ledger, k: remove.length };
}

// CRITICAL: successText K=0 honesty (spec/05 §1 step 8)
function successText(granularity: Granularity, k: number, hasWarning: boolean): { text: string } {
  const kClause = k === 0
    ? "0 messages will be hidden from your view starting next turn (nothing matched to hide)"
    : `${k} messages will be hidden from your view starting next turn`;
  let text = `Mulligan: rewound ${granularity}. ${kClause}. Note left.`;
  if (hasWarning) text += " " + MUTATION_WARNING;                  // spec/08 E5 VERBATIM
  return { text };
}
```

### Integration Points

```yaml
TOOL REGISTRATION (P1.M7.T1.S1 — NOT this task; do NOT touch index.ts):
  - index.ts will: pi.registerTool(makeRewindTool(pi));
  - pattern: src/tools/checkpoint.ts (makeCheckpointTool) + spec/05 §5 registerTool summary.

PERSISTED STATE (written via markers.ts — this tool does NOT call pi.appendEntry/pi.sendMessage directly):
  - pi.appendEntry("mulligan:rewind", { schema:"pi-mulligan", v:1, kind:"rewind", id:<uuid>, granularity, options:{to_previous_prompt, protect}, excludeToolCallId:<toolCallId>, seq, note, ledger, checkpoint, ts })  ← via appendRewindMarker (stamps envelope/id/seq/ts; the tool passes the rest + checkpoint)
  - pi.sendMessage({ customType:"mulligan:note", content:<renderedNote>, display:true, details:{schema:"pi-mulligan", v:1, kind:"note", rewindId:<markerEntryId>} })  ← via leaveNote (NO options arg — C8)
  - READ (control state, for guards/preview): ctx.sessionManager.getEntries() (markers + labels), .getBranch() (checkpoint resolution), .buildContextEntries() (snapshot → messages).

CONSUMED (read by the filter, P1.M4.T2.S1 — this tool WRITES, filter READS):
  - filter.ts readMarkers(ctx) scans getEntries() for customType "mulligan:rewind" → RewindMarker[]; filterPipeline
    resolves via granularity/options/excludeToolCallId/checkpoint. The checkpoint field (gotcha #1) is the shared contract.

CONFIG (read-only, config.ts):
  - config.rewind.enabled (master switch for THIS tool — E14)
  - config.rewind.protectedRoles (persisted into marker.options.protect)
  - config.rewind.maxDepth (depth-guard cap)
  - config.rewind.requireMutationWarning (gates the E5 warning)
  - (config.enabled is the EXTENSION master switch; spec/05 §1 step 1 gates on config.rewind.enabled specifically. If
    you want belt-and-suspenders, also short-circuit on !config.enabled — but spec/05 §1 step 1 names config.rewind.enabled.)

NO DATABASE / NO ROUTES / NO NEW ENV VARS.
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Run after creating src/tools/rewind.ts — fix before proceeding
npx tsc --noEmit -p tsconfig.json          # strict typecheck; expect exit 0
# (This project uses tsc for typecheck + vitest for tests — NO ruff/mypy; those are Python tools in the template.)
# Expected: Zero errors. If errors exist, READ the output — the most likely causes are:
#   - a missing .js on a relative import (GOTCHA #13)
#   - a return path missing `details` (GOTCHA #4)
#   - the checkpoint cast (GOTCHA #1) — ensure `payload as RewindMarkerInput`
#   - the execute signature order (GOTCHA #2 — toolCallId FIRST)
npx vitest run test/tools/rewind.test.ts   # run the new tests in isolation
# Expected: all green.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new tool in isolation
npx vitest run test/tools/rewind.test.ts -v
# Expected: all rewind tests pass — registration metadata, 4 refusal paths, success path (incl. checkpoint field
#   assertion — gotcha #1), K/K=0 honesty, mutation warning, best-effort ledger, never-throws, result shape, types.

# Full suite — NO regression (rewind.ts adds 2 files; touches nothing else)
npx vitest run
# Expected: all-green. If a sibling test fails, it is NOT caused by this task (rewind.ts imports only from
#   already-shipped modules and adds no module-scoped mutable state beyond the makeRewindTool closure).
```

### Level 3: Integration Testing (System Validation)

```bash
# This task is a pure unit-tested tool module — there is NO running service to curl. The integration smoke harness
# (P1.M7.T2) exercises the tool end-to-end through a real Pi session. For THIS task, validate the contract via:
#   1. tsc --noEmit (Level 1) — the type system confirms the execute signature + AgentToolResult shape.
#   2. vitest (Level 2) — hand-rolled fakes confirm the 9 behavior steps + the persisted marker payload.
# Optional manual sanity (requires a Pi session with the extension loaded — deferred to P1.M7.T2):
#   echo '{"method":"tools/call","params":{"name":"mulligan_rewind","arguments":{...}}}' | pi -e ./src/index.ts -p "..."
# Expected: a text tool result matching the success/refusal format; a mulligan:rewind marker in /tree.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Cross-task contract check (the checkpoint gotcha — GOTCHA #1):
# After implementation, confirm the persisted marker carries `checkpoint` by reading the test assertion OR by
# temporarily logging makeRewindTool's appended[0].data.checkpoint. This is the single most important correctness
# property: WITHOUT it, checkpoint rewinds silently no-op in the filter (P1.M4.T2 reads rw.checkpoint).

# Parallel-item non-interference:
# Confirm rewind.ts does NOT import from filter.ts (P1.M4.T2 runs in parallel) and does NOT touch index.ts.
grep -n "filter.js\|index.js\|registerTool" src/tools/rewind.ts   # Expected: no matches (wiring is P1.M7.T1.S1)
```

---

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (strict).
- [ ] `npx vitest run test/tools/rewind.test.ts` → all green.
- [ ] `npx vitest run` → all-green, no regression.
- [ ] No lint issues (this repo has no linter configured beyond tsc strict).

### Feature Validation
- [ ] All 9 behavior steps implemented in order (config → note → checkpoint-existence → depth → preview → render → persist → warning → return).
- [ ] Disabled → refusal; invalid note → refusal (NOTE_INVALID_REASON); checkpoint not found → refusal; maxDepth → refusal.
- [ ] Success path persists the marker with `checkpoint` (gotcha #1) + `excludeToolCallId === toolCallId` (gotcha #2) + leaves the note.
- [ ] K reported honestly (incl. K=0 "(nothing matched to hide)"); mutation warning verbatim (spec/08 E5) when applicable.
- [ ] Best-effort ledger: snapshot/resolver failure → empty ledger + K=0 + still success (never blocks).
- [ ] Never throws (whole body try/catch → text result on any exception — E13).

### Code Quality Validation
- [ ] Mirrors src/tools/checkpoint.ts conventions (factory closure, defineTool, refusal() builder, verbatim DESC, .js imports).
- [ ] Delegates persistence to appendRewindMarker/leaveNote (markers.ts) — does NOT reimplement pi.appendEntry/sendMessage.
- [ ] Delegates validation to validateNote (notes.ts) — does NOT reimplement note-field checks.
- [ ] Delegates resolution to the pure transforms.ts resolvers — does NOT reimplement partitioning/resolution.
- [ ] `details` present on every return path (gotcha #4).

### Documentation & Deployment
- [ ] REWIND_DESC is the spec/05 §5 VERBATIM string (Mode A — the description IS the LLM-facing docs).
- [ ] RewindParams field descriptions are spec/05 §1 VERBATIM (the LLM reads them).
- [ ] No new env vars; no config changes (reads existing config.rewind.* knobs).

---

## Anti-Patterns to Avoid

- ❌ Don't call `pi.appendEntry`/`pi.sendMessage` directly — delegate to `appendRewindMarker`/`leaveNote` (markers.ts owns the envelope + seq + leaf capture + C8).
- ❌ Don't omit `checkpoint` from the persisted marker (gotcha #1) — checkpoint rewinds will silently no-op.
- ❌ Don't reimplement note validation, partitioning, resolution, or ledger extraction — import the shipped pure helpers.
- ❌ Don't make the read-only preview a hard gate — it is ADVISORY; a failure MUST fall back to empty ledger + K=0 + still succeed (E13, spec/05 §1 step 5).
- ❌ Don't read/transform `event.messages` — the tool is write-only w.r.t. messages (it never receives the context event).
- ❌ Don't call `getConfig()` repeatedly — read once at the top of execute (gotcha #14).
- ❌ Don't forget `details` on any return path (gotcha #4 — strict mode requires it).
- ❌ Don't hardcode the description or warning text — copy spec/05 §5 and spec/08 E5 VERBATIM.
- ❌ Don't touch index.ts / filter.ts / markers.ts — wiring is P1.M7.T1.S1; the filter runs in parallel; markers.ts is frozen.
- ❌ Don't catch all exceptions silently without returning a text result — return a refusal describing the failure (E13).

---

## Confidence Score: 9/10

**Why 9, not 10:** the one residual uncertainty is the EXACT K value a hand-rolled snapshot fixture yields (the
resolver's removal-set length depends on how `buildContextEntries().flatMap(sessionEntryToContextMessages)` maps to
the test's message fixtures). The PRP specifies the resolution approach precisely (mirror filterPipeline's
granularity dispatch + feed the removal set to extractFileLedger), and the success text is K-parameterized, so the
implementer can compute K from their own fixture and assert it. Everything else — the execute signature, the consumed
signatures, the persistence payload (incl. the checkpoint gotcha), the description/warning verbatim strings, the test
idiom — is fully verified against the installed code and spec. One-pass implementation success is highly likely.

**Key risk to watch:** the `payload as RewindMarkerInput` cast (gotcha #1). If the implementer forgets it, `tsc`
will error (excess property) — a clear signal. If they add it but forget the `checkpoint` field, the success-path
test (Task 8: assert `data.checkpoint === name` for checkpoint granularity) will catch it. Both gates are in place.