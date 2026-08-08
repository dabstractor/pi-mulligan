# PRP — P1.M5.T4.S1: Implement `mulligan_audit` tool — filtered view read, token breakdown, report rendering

> Work item: **P1.M5.T4.S1** — the 4th (read-only) Mulligan tool. Layer: P1.M5 Agent-Callable Tools.
> Spec contract: `spec/05-tools.md §4` (verbatim), with `§5` (registration + description string),
> `spec/06-context-filter.md §7` (the `lastFiltered` cache + E16 fallback), `spec/08-edge-cases.md E16`
> (audit before first inference), decision **D5** (NEVER `getContextUsage()`). Consumed downstream by
> P1.M7.T1.S1 (`index.ts` factory wiring).

---

## Goal

**Feature Goal**: Ship the read-only diagnostic tool that closes Mulligan's feedback loop — it shows
the agent a token breakdown of the context **the model actually sees** (the *filtered* view), flags the
biggest contributors against the bloat threshold, lists active Mulligan markers, and suggests a shrink.
It persists NOTHING and computes its total from the filtered message list, **never** from
`ctx.getContextUsage()` (which counts hidden tokens — bookkeeping drift, D5).

**Deliverable**: A new file `src/tools/audit.ts` exporting `auditTool: ToolDefinition` (+ the `AuditParams`
typebox schema + two pure render helpers `describeMessage` / `renderAuditReport` for testability). The
tool: (1) reads the cached filtered view `rt.lastFiltered` (primary path); if `null` (E16 — audit before
any inference), falls back to converting `buildContextEntries()` → messages → re-running `filterPipeline`,
flagging confidence `'low'`; (2) estimates per-message tokens, sorts desc, takes `top` (default 8); (3)
renders the `spec/05 §4` markdown report (total, active markers, protected note, top rows with bloat
flags, shrink suggestion); (4) returns `{content:[{type:"text", text:report}], details}`. Plus a unit
test file `test/tools/audit.test.ts`.

**Success Definition**:
- `npx tsc --noEmit` passes with zero errors (highest-risk gate — see CRITICAL GOTCHA #1 `details`).
- `npx vitest run test/tools/audit.test.ts` passes.
- `auditTool.name === "mulligan_audit"`, `.description === AUDIT_DESC` (verbatim spec/05 §5 string),
  `.parameters === AuditParams`, `.execute` returns the `spec/05 §4` report shape.
- The total is computed via `estimateTokens(filtered)`, **never** `ctx.getContextUsage()` (assert in tests
  that a `getContextUsage` spy is NEVER called).
- The primary path (cached `lastFiltered`) is exercised; the E16 fallback path (null `lastFiltered`) is
  exercised with confidence `'low'`.
- Nothing is persisted: the fake `pi` records ZERO `appendEntry`/`sendMessage`/`setLabel` calls.

## User Persona

**Target User**: The LLM agent itself (agent-callable; no human UI).

**Use Case**: The agent suspects context is bloated (a big `read`, a chatty `grep`) and wants an honest
picture of what it is carrying BEFORE deciding to `mulligan_shrink` or `mulligan_rewind`. Without this
tool it would have to guess (or be misled by Pi's `getContextUsage()` which counts already-hidden tokens).

**User Journey**:
1. Agent notices a large tool result and wonders whether to act.
2. Agent calls `mulligan_audit({ top: 8 })`.
3. Tool returns a markdown report: total filtered tokens, the top contributors with token counts + bloat
   flags, active markers, and a concrete shrink suggestion naming the largest message.
4. Agent reads "the `read src/big.log` result is the largest contributor. Consider mulligan_shrink." and
   calls `mulligan_shrink` (P1.M5.T2.S1) to replace it with a summary.

**Pain Points Addressed**: Blindness to per-message token cost; the `getContextUsage()` lie (it reports
hidden tokens as if present — the audit's whole value is honesty about the filtered view, D5).

## Why

- Completes the four-tool set. `rewind`/`shrink`/`checkpoint` are **write** tools; `audit` is the single
  **read-only** exception (spec/05 "Shared tool conventions"). It is the feedback loop that makes the
  other three trustworthy: the agent can see the effect of a rewind ("did it actually drop those tokens?")
  and the size of a shrink candidate.
- It is the **only** tool that reads `rt.lastFiltered` (the filter's cached output, spec/06 §7). Using the
  cache avoids re-running `filterPipeline` on the hot path and guarantees the audit reflects exactly what
  the model saw on the last inference.
- It is the **only** place Mulligan deliberately re-runs `filterPipeline` — and only on the rare E16
  fallback (no cached view yet). This isolation keeps the "one transform pipeline" invariant (spec/04 §4
  architecture) intact: the audit never invents a second transform.

## What

A `ToolDefinition` named `mulligan_audit` that:
- Declares `AuditParams = Type.Object({ top: Type.Optional(Type.Number({ description })) })`.
- In `execute(toolCallId, params, signal, onUpdate, ctx)`: resolves the **filtered** message list
  (cached `rt.lastFiltered`, else the E16 fallback), estimates tokens, renders the `spec/05 §4` report,
  and returns `{ content:[{type:"text",text:report}], details:{...} }`.
- **Persists nothing** — never calls `pi.appendEntry`/`pi.sendMessage`/`pi.setLabel`. (It does not even
  need `pi` at all — every read goes through `ctx` or pure helpers; see CRITICAL INSIGHT #1.)
- Wraps its whole body in try/catch (shared tool convention: never throws — returns a text result on any
  failure). Has NO config gate (audit is always-on diagnostics — see GOTCHA #4).

### Success Criteria

- [ ] `src/tools/audit.ts` exists, exporting `auditTool`, `AuditParams`, `describeMessage`, `renderAuditReport`.
- [ ] `auditTool.name === "mulligan_audit"`, `.label === "Mulligan Audit"`, `.description === AUDIT_DESC`.
- [ ] `auditTool.parameters === AuditParams` (`Type.Object({ top: Type.Optional(Type.Number({...})) })`).
- [ ] Primary path: `rt.lastFiltered` non-null → report uses it; confidence = `config.audit.estimateConfidence`.
- [ ] E16 fallback: `rt.lastFiltered === null` → builds from `buildContextEntries()`, runs `filterPipeline`,
      confidence = `'low'`.
- [ ] Total computed via `estimateTokens(filtered)`; `ctx.getContextUsage()` is **never** called.
- [ ] Report lines match `spec/05 §4` (header, total, active markers, protected, top rows, suggestion).
- [ ] Bloat flag fires when a message's bytes exceed `config.nudges.bloatThresholdBytes`.
- [ ] Nothing persisted (fake `pi` records 0 writes).
- [ ] `npx tsc --noEmit` passes; `npx vitest run test/tools/audit.test.ts` passes.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed?_ **Yes** — the spec
contract (`spec/05 §4`) is reproduced verbatim below; the two upstream helpers (`filterPipeline`,
`readMarkers`) are pinned with exact signatures; the Pi `ToolDefinition`/`AgentToolResult` contract is
pinned with the one non-obvious gotcha (`details`) empirically verified against this exact tsconfig; the
report format is decomposed line-by-line; and the test fake idiom is reproduced from `test/markers.test.ts`.

### Documentation & References

```yaml
# MUST READ — the authoritative tool contract (schema, return shape, behavior, report format, D5)
- url: spec/05-tools.md  (read §4 "mulligan_audit" IN FULL + §5 registration/description strings)
  why: §4 is the verbatim contract — AuditParams schema, the markdown report format, the 5-step behavior,
       and the D5 note ("Why audit must use the filtered view"). §5 gives the exact AUDIT_DESC string.
  critical: "§4 Return shape shows ONLY `{ content:[...] }` — that is a SIMPLIFICATION. The real Pi type
    REQUIRES a `details` field. See CRITICAL GOTCHA #1. The total MUST be estimateTokens(filtered), NEVER
    ctx.getContextUsage() (D5; bookkeeping drift). Persist NOTHING."

# MUST READ — the lastFiltered cache + the E16 fallback (the two code paths)
- url: spec/06-context-filter.md §7 "Caching the filtered view for mulligan_audit"
  why: Defines the primary path (read rt.lastFiltered) AND the fallback (buildContextEntries() → messages
        → pipeline, confidence 'low') AND the explicit "Never use ctx.getContextUsage() for the total".
  critical: "rt.lastFiltered is null until the first context.fire (E16). The fallback must NOT crash and
    must flag confidence 'low'. This is the ONLY place filterPipeline is re-run intentionally."

# MUST READ — edge case E16 (audit before first inference) + E12 (getContextUsage undefined)
- url: spec/08-edge-cases.md §E16, §E12
  why: E16 is the fallback trigger; E12 confirms audit tolerates undefined usage (irrelevant since we
        never call it, but documents the tolerance).
  critical: "E16 fallback is reachable when audit is the agent's FIRST action (no inference yet). Handle it."

# MUST READ — the marker data shapes the audit summarizes
- url: spec/04-data-model.md §1 (envelope/customType table), §3 (RewindMarker.granularity), §4 (ShrinkMarker), §6 (Checkpoint label)
  why: The "Active markers" line counts rewinds (by granularity) + shrinks + checkpoints. Checkpoints are
        LabelEntries (NOT custom entries) → the audit scans them itself (readMarkers does not return them).
  critical: "Checkpoint names live in label entries `mulligan:checkpoint:<name>`; strip the prefix for the report."

# MUST READ — the two upstream dependencies (build-order preconditions — verify they exist FIRST)
- file: src/transforms.ts   (filterPipeline — P1.M3.T5.S1, NOT yet shipped)
  why: filterPipeline(messages, markers, config, ctx): AgentMessage[] — re-applies rewinds/shrinks on the
        E16 fallback path. Signature from spec/06 §12. NEVER throws.
  pattern: "Call ONLY when rt.lastFiltered === null. Pass the MarkersBundle from readMarkers(ctx) verbatim."
  gotcha: "GOTCHA #2 — this symbol is NOT in src yet. Run `rg -n 'export function filterPipeline' src/transforms.ts`;
    if absent, STOP — P1.M3.T5.S1 must land first (build order Step 3 before Step 6). Import path `../transforms.js`."

- file: src/filter.ts       (readMarkers — P1.M4.T2.S1, NOT yet shipped; src/filter.ts does not exist yet)
  why: readMarkers(ctx): { rewinds: RewindMarker[]; shrinks: ShrinkMarker[]; metric: TurnMetric | null }.
        Scans getEntries() for `type==='custom' && customType.startsWith('mulligan:')`. NEVER throws.
  pattern: "Always called (the report always lists active markers). Does NOT return checkpoints."
  gotcha: "GOTCHA #2 — src/filter.ts does not exist yet. Run `rg -n 'export function readMarkers' src/`; if
    absent, STOP — P1.M4.T2.S1 must land first (build order Step 5 before Step 6). Import path `../filter.js`.
    (If P1.M4.T2.S1 instead placed readMarkers in ../markers.js, import from there — the NAME is stable.)"

# MUST READ — the COMPLETE helpers this tool reuses (all shipped)
- file: src/tokens.ts   (estimateTokens, resultBytes, MessageLike — P1.M2.T1, COMPLETE)
  why: estimateTokens(messages): {tokens, confidence} → per-message = estimateTokens([msg]); total =
        estimateTokens(filtered). resultBytes((TextContent|ImageContent)[]) → UTF-8 bytes for the bloat flag.
  pattern: "Reuse resultBytes for array content; handle string content locally (messageBytes helper)."
  gotcha: "estimateTokens returns confidence 'medium' by default — the audit OVERRIDES it (config value on the
    primary path, 'low' on the fallback). resultBytes counts base64 image data at face value (an overestimate)."

- file: src/runtime.ts   (getRuntime, SessionRuntime.lastFiltered — P1.M1.T4, COMPLETE)
  why: rt = getRuntime(ctx.sessionManager.getSessionId()); rt.lastFiltered is the cached filtered view (null
        until first context.fire). Read FRESH each call (C12).
  pattern: "const rt = getRuntime(sessionId); if (rt.lastFiltered) {...primary...} else {...fallback...}"
  gotcha: "getRuntime is keyed by sessionId and backed by a MODULE-SCOPED Map → tests MUST clearAll() before/after
    (mirror test/markers.test.ts) or a prior test's lastFiltered leaks in."

- file: src/config.ts   (getConfig, MulliganConfig — P1.M1.T2, COMPLETE)
  why: config.audit.estimateConfidence (the reported confidence label, default 'medium'),
        config.nudges.bloatThresholdBytes (the bloat flag threshold, default 8192),
        config.rewind.protectedRoles (the 'Protected:' line, default ['first:user','latest:user']).
  gotcha: "NO config.audit.enabled exists — do NOT gate (GOTCHA #4). getConfig() returns a fresh clone each call."

- file: src/markers.ts   (RewindMarker / ShrinkMarker / TurnMetric TYPES — P1.M4.T1, COMPLETE)
  why: Type-only imports for narrowing readMarkers output (rewinds[*].granularity, shrinks.length). The audit
        does NOT call any markers.ts WRITE wrapper (it persists nothing).
  gotcha: "Import TYPES only (import type). markers.ts is fully Pi-coupled but we use zero of its functions."

# MUST READ — the Pi type contract (the `details` gotcha)
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts (ToolDefinition, line 343)
  + node_modules/.../pi-agent-core/dist/types.d.ts (AgentToolResult<T>, line 316)
  why: "ToolDefinition<TParams> = { name,label,description,parameters,execute(toolCallId, params:Static<TParams>,
        signal, onUpdate, ctx): Promise<AgentToolResult<TDetails>> }. AgentToolResult<T> = { content:(TextContent|
        ImageContent)[]; details: T; usage?; ... }."
  pattern: "params = Static<typeof AuditParams> = { top?: number }. ctx = ExtensionContext."
  gotcha: "CRITICAL GOTCHA #1 — `details` is REQUIRED (not optional). Empirically verified: returning
    `{content:[...]}` alone FAILS `tsc --strict`. Return a structured details object (see report-format note)."

# Reference — a working (but UNtypechecked) registerTool call to copy the execute shape from
- file: spec/reference/looper-smoke.proto.ts
  why: Shows the pi.registerTool({ name,label,description,parameters, async execute(){...} }) shape and the
        `{ content:[{type:"text" as const, text}] }` return idiom.
  gotcha: "EXCLUDED from tsconfig → can OMIT `details` and still 'work'. YOUR file in src/ IS strict-typechecked
    → you MUST add `details`. Do not copy its return verbatim."

# typebox (bare `typebox` package v1.3.x — NOT @sinclair/typebox)
- file: node_modules/typebox/build/index.d.mts
  why: "Exports `Type` (namespace) + `Static`. Type.Object / Type.Optional / Type.Number all available."
  pattern: "AuditParams = Type.Object({ top: Type.Optional(Type.Number({ description: '...' })) })."
  gotcha: "package.json dep is `\"typebox\": \"*\"`. Do NOT import from @sinclair/typebox."

# Test pattern to mirror EXACTLY
- file: test/markers.test.ts   (the house test idiom)
  why: vitest; hand-rolled makeCtx() fakes (no vi.fn()); `.js` import paths; expectTypeOf; clearAll() reset.
  pattern: "Reuse the makeCtx() shape; EXTEND it with getEntries()/buildContextEntries()/getSessionId(). The
    audit needs NO makePi() (it never touches pi) — but include a spy pi to ASSERT 0 writes."
```

### Current Codebase tree (relevant slice)

```bash
src/
├── index.ts            # no-op factory stub — P1.M7.T1.S1 will wire auditTool here (NOT this item)
├── config.ts           # getConfig() + MulliganConfig (audit: { estimateConfidence })            COMPLETE
├── runtime.ts          # getRuntime(sessionId) → SessionRuntime.lastFiltered                     COMPLETE
├── tokens.ts           # estimateTokens, resultBytes, MessageLike                                COMPLETE
├── markers.ts          # RewindMarker/ShrinkMarker/TurnMetric TYPES (write wrappers UNUSED here)  COMPLETE
├── transforms.ts       # partitionIntoUnits, resolveLastToolCallGroup SHIPPED; filterPipeline NOT YET
├── (filter.ts)         # DOES NOT EXIST YET — P1.M4.T2.S1 ships readMarkers + writes lastFiltered
└── tools/
    └── (checkpoint.ts) # being built in parallel (P1.M5.T3.S1) — creates the src/tools/ dir
test/
├── markers.test.ts     # house test idiom (makePi/makeCtx fakes, clearAll, .js imports)
└── (tools/)            # this item creates test/tools/audit.test.ts
```

### Desired Codebase tree with files to be added

```bash
src/tools/
└── audit.ts            # NEW — exports auditTool (ToolDefinition), AuditParams (typebox),
                        #   describeMessage + renderAuditReport (PURE helpers, for tests).
                        #   Reads rt.lastFiltered (primary) or buildContextEntries()→filterPipeline (E16),
                        #   estimates tokens, renders spec/05 §4 report. Persists NOTHING. No `pi` needed.
test/tools/
└── audit.test.ts       # NEW — primary path (cached), E16 fallback (confidence 'low'), D5 (never
                        #   getContextUsage), bloat flagging, marker/checkpoint summary, report shape,
                        #   never-persists (0 writes), never-throws, types.
```

`src/index.ts` is **NOT modified by this item** — wiring `pi.registerTool(auditTool)` is P1.M7.T1.S1
(explicitly out of scope; the item contract says only "Consumed by index.ts").

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 — `details` is REQUIRED on the tool result (spec/05 omits it; the type does not).
// Empirically verified against this exact tsconfig:
//   return { content:[{type:"text", text}] }                       // ❌ tsc ERROR: 'details' missing
//   return { content:[{type:"text", text}], details: {...} }       // ✅ compiles
// Root cause: AgentToolResult<T> = { content:...; details: T; ... } and TDetails defaults to `unknown`.
// The spec/05 §4 "Return shape" is a SIMPLIFICATION. ALWAYS return `details`.

// CRITICAL GOTCHA #2 — TWO upstream symbols are NOT in src yet (build-order preconditions).
//   filterPipeline  → src/transforms.ts  (P1.M3.T5.S1)
//   readMarkers     → src/filter.ts      (P1.M4.T2.S1)
// Build order (spec/11): Step 3 (transforms) → Step 5 (filter.ts) → Step 6 (tools). So they MUST exist
// before this item compiles/tests. FIRST ACTION: `rg -n "export function filterPipeline" src/transforms.ts`
// and `rg -n "export function readMarkers" src/`; if EITHER is absent, STOP and flag the blocker.
// Import paths: `../transforms.js` and `../filter.js` (GOTCHA #3 ESM .js convention).

// GOTCHA #3 — ESM `.js` import paths for sibling TS modules (house convention):
//   import { filterPipeline } from "../transforms.js";   // NOT "../transforms.ts"
//   import { readMarkers } from "../filter.js";
//   import { estimateTokens, resultBytes } from "../tokens.js";
//   import { getRuntime } from "../runtime.js";
//   import { getConfig } from "../config.js";
// Required by Bundler/NodeNext resolution (see test/markers.test.ts: `from "../src/markers.js"`).

// GOTCHA #4 — NO config gate. spec/09's `audit` section has only `estimateConfidence`; there is NO
// `config.audit.enabled` and the audit does NOT refuse when `config.enabled === false`. The audit is
// always-on diagnostics (read-only). Do NOT invent a gate (mirror checkpoint GOTCHA #4).

// CRITICAL INSIGHT #1 — audit needs NO `pi` at all (unlike checkpoint/rewind/shrink).
//   readMarkers(ctx) and filterPipeline(messages, markers, config, ctx) both take `ctx`, not `pi`.
//   getRuntime/getConfig/estimateTokens/resultBytes are pure. ctx.sessionManager is read-only.
//   → auditTool is a PLAIN `export const` (no makeAuditTool(pi) factory, no closure, no module-scoped pi).
//   Tests call auditTool.execute("c1", {top}, undefined, undefined, fakeCtx) directly.

// GOTCHA #5 — D5: NEVER use ctx.getContextUsage() for the total. It counts hidden tokens (bookkeeping
// drift) — reporting it would make a rewind look like it "didn't work." Compute total via
// estimateTokens(filtered). Assert in tests that a getContextUsage spy is NEVER called.

// GOTCHA #6 — getRuntime() is backed by a MODULE-SCOPED Map keyed by sessionId. Tests MUST clearAll()
// before AND after each test (mirror test/markers.test.ts) or a prior test's lastFiltered leaks in. The
// fake ctx's getSessionId() must match the key you pre-seed via getRuntime(sessionId).lastFiltered = ...

// GOTCHA #7 — Checkpoints are NOT in readMarkers output. readMarkers returns {rewinds, shrinks, metric}
// from `type==='custom'` entries. Checkpoints are `type==='label'` entries (label `mulligan:checkpoint:<name>`).
// The audit scans getEntries() ITSELF for checkpoint labels (strip the prefix for the report name list).

// GOTCHA #8 — The `top` default is 8 (spec/05 §4 AuditParams description: "Default 8"). Apply
// `const top = typeof params.top === 'number' && params.top > 0 ? Math.floor(params.top) : 8;`. The total
// line uses ALL filtered messages (not just top); only the "Top messages by size" block is truncated to `top`.

// GOTCHA #9 — Read every message field defensively via a local readOwn (a Proxy get-trap may throw; the
// audit must never crash — it sits on the tool path). estimateTokens/resultBytes already defend internally,
// but describeMessage/messageBytes/the checkpoint scan touch raw message fields → wrap reads.

// GOTCHA #10 — Never throw (shared tool convention, spec/05). Wrap the whole execute body in try/catch;
// on any error return { content:[{type:"text", text:"Mulligan: audit failed — <reason>"}], details:{error} }.
```

## Implementation Blueprint

### Data models and structure

No new persisted data model (the audit persists nothing). The only new structures are the typebox schema,
the tool definition, and two small pure render helpers + their input type:

```typescript
// src/tools/audit.ts
import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition, AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { estimateTokens, resultBytes } from "../tokens.js";          // GOTCHA #3: .js
import { getRuntime } from "../runtime.js";                           // primary path source
import { getConfig } from "../config.js";                             // estimateConfidence + thresholds
import { filterPipeline } from "../transforms.js";                    // GOTCHA #2: upstream (E16 fallback)
import { readMarkers } from "../filter.js";                           // GOTCHA #2: upstream (active markers)
import type { RewindMarker, ShrinkMarker } from "../markers.js";      // types only

// 1) Parameter schema (spec/05 §4). Static<typeof AuditParams> === { top?: number }.
export const AuditParams = Type.Object({
  top: Type.Optional(
    Type.Number({ description: "Report only the top N messages by token size. Default 8." }),
  ),
});
export type AuditArgs = Static<typeof AuditParams>;

// 2) The description string (spec/05 §5 — Mode A LLM-facing docs; copy VERBATIM).
const AUDIT_DESC =
  "Show a token breakdown of the context you're currently carrying (what the model actually sees), " +
  "flag the biggest contributors, and list active Mulligan markers. Use this to decide whether to " +
  "rewind or shrink.";

// 3) A label row in the "Top messages by size" block. Exported so the pure renderer is testable.
export interface AuditRow {
  tokens: number;
  role: string;
  label: string;
  bloaty: boolean;
}

// 4) The `details` payload (REQUIRED — CRITICAL GOTCHA #1). Small structured object for logs/debug.
interface AuditDetails {
  totalTokens: number;
  confidence: "low" | "medium" | "high";
  source: "cached" | "fallback"; // primary (lastFiltered) vs E16 (buildContextEntries)
  nRewinds: number;
  nShrinks: number;
  nCheckpoints: number;
  top: AuditRow[];
  error?: string; // present only on the catch path
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY upstream dependencies exist (GOTCHA #2 — do this FIRST, before writing any code)
  - RUN: rg -n "export function filterPipeline" src/transforms.ts   → MUST print a line
  - RUN: rg -n "export function readMarkers" src/                   → MUST print a line (src/filter.ts expected)
  - IF EITHER IS ABSENT: stop and report the blocker (P1.M3.T5.S1 / P1.M4.T2.S1 must land first per build order).
  - NOTE the readMarkers file (../filter.js vs ../markers.js) and use that import path.

Task 1: CREATE src/tools/audit.ts
  - IMPLEMENT AuditParams typebox schema (Type.Object({ top: Type.Optional(Type.Number({description})) })) — spec/05 §4.
  - IMPLEMENT AUDIT_DESC verbatim (spec/05 §5).
  - IMPLEMENT pure helper messageBytes(msg): resultBytes(content) for arrays; Buffer.byteLength(str,"utf8") for
    strings; 0 otherwise. (Reuses tokens.ts resultBytes — no byte-logic duplication.)
  - IMPLEMENT pure helper describeMessage(msg, callLookup): toolResult→`${toolName} ${briefArgs(call)}`;
    assistant→block-count summary; user/custom→role/snippet. All reads via readOwn (GOTCHA #9).
  - IMPLEMENT pure helper buildCallLookup(messages): Map<toolCallId,{name,args}> from assistant toolCall blocks.
  - IMPLEMENT pure helper listCheckpoints(getEntries): scan label entries with `mulligan:checkpoint:` prefix → names.
  - IMPLEMENT pure helper entriesToMessages(entries): E16 fallback conversion (message→.message;
    custom_message→reconstruct; compaction/branch_summary→{role:"system",content:summary}; skip others). spec/06 §7.
  - IMPLEMENT pure helper renderAuditReport({totalTokens, confidence, rewinds, shrinks, checkpointNames, protectedRoles,
    thresholdBytes, rows, suggestion}): string — spec/05 §4 format (see report-format research note).
  - IMPLEMENT auditExecute(_toolCallId, params, _signal, _onUpdate, ctx): 
      (a) try/catch whole body → failure text + details.error (GOTCHA #10).
      (b) config = getConfig(); sessionId = ctx.sessionManager.getSessionId(); rt = getRuntime(sessionId).
      (c) PRIMARY: if Array.isArray(rt.lastFiltered) && rt.lastFiltered.length... → filtered=rt.lastFiltered,
          source="cached", confidence=config.audit.estimateConfidence.
      (d) E16 FALLBACK: else entries=ctx.sessionManager.buildContextEntries(); base=entriesToMessages(entries);
          filtered=filterPipeline(base, readMarkers(ctx), config, ctx); source="fallback", confidence="low".
      (e) total=estimateTokens(filtered).tokens.
      (f) rows = filtered.map(m => ({tokens: estimateTokens([m]).tokens, msg:m})) sort desc, take top (params.top ?? 8, GOTCHA #8);
          label=describeMessage(m, buildCallLookup(filtered)); bloaty = messageBytes(m) > config.nudges.bloatThresholdBytes.
      (g) markers = readMarkers(ctx); ckpts = listCheckpoints(ctx.sessionManager.getEntries()).
      (h) report = renderAuditReport({...}); suggestion names rows[0].label (omit if filtered empty).
      (i) return { content:[{type:"text",text:report}], details:{totalTokens,confidence,source,nRewinds,nShrinks,nCheckpoints,top:rows,details} }.
  - EXPORT: auditTool = defineTool({ name:"mulligan_audit", label:"Mulligan Audit", description: AUDIT_DESC,
      parameters: AuditParams, execute: auditExecute }). (PLAIN const — CRITICAL INSIGHT #1, no factory.)
  - EXPORT: AuditParams, describeMessage, renderAuditReport (for tests). 
  - FOLLOW pattern: spec/05 §5 (name/label/description) + spec/reference/looper-smoke.proto.ts (execute idiom)
    BUT add `details` (CRITICAL GOTCHA #1) and the `.js` imports (GOTCHA #3).
  - DO NOT: modify src/index.ts (wiring is P1.M7.T1.S1). DO NOT call pi.* DO NOT call ctx.getContextUsage() (GOTCHA #5).

Task 2: CREATE test/tools/audit.test.ts
  - IMPLEMENT: mirror test/markers.test.ts — hand-rolled makeCtx() fake (NO vi.fn()) EXTENDED with
    getEntries()/buildContextEntries()/getSessionId(). Use clearAll() before/after each (GOTCHA #6).
    Include a NO-OP makePi() spy whose appendEntry/sendMessage/setLabel PUSH to arrays you assert are EMPTY.
  - CASES:
      a) PRIMARY path: pre-seed getRuntime("s1").lastFiltered=[...]; call execute → report contains
         "Total (filtered): ~<N> tokens  (estimate, confidence: medium)"; details.source==="cached";
         getContextUsage NEVER called (D5); fake pi records 0 writes.
      b) E16 FALLBACK: leave lastFiltered null; fake buildContextEntries() returns message entries;
         readMarkers+fakes... → details.source==="fallback", confidence==="low", report still renders.
      c) D5 guard: assert ctx.getContextUsage is NOT in the call list (track calls[] on the fake ctx).
      d) top param: {top:2} truncates the "Top messages" block to 2 rows; default (undefined) → 8.
      e) bloat flag: a toolResult with bytes > config.nudges.bloatThresholdBytes → row contains
         "⚠ above bloat threshold (8 KB)".
      f) active markers + checkpoints: fake getEntries() includes rewind/shrink custom entries + checkpoint
         labels → "Active markers: 1 rewind (last_tool_call_group), 1 shrink, 2 checkpoints [a, b]".
      g) suggestion: names rows[0].label; empty filtered → no suggestion, "No messages" note.
      h) never-persists: assert appended/sent/labels arrays all length 0.
      i) never-throws: a throwing getEntries()/buildContextEntries() → execute returns a text result (catch path).
      j) result shape: content is [{type:"text",text}] AND "details" in result (CRITICAL GOTCHA #1).
      k) types: expectTypeOf(auditTool).toMatchTypeOf<ToolDefinition>(); params inferred as {top?:number};
         describeMessage/renderAuditReport are pure (no ctx) — unit-test label construction directly.
  - FOLLOW pattern: test/markers.test.ts (vitest describe/it/expect/expectTypeOf, .js imports, fakes, clearAll).
  - NAMING: test/tools/audit.test.ts; describe("mulligan_audit ...").
  - COVERAGE: both paths, D5, top truncation, bloat, markers+checkpoints, suggestion, never-persists,
    never-throws, result shape incl. details, pure-helper labels.
  - PLACEMENT: test/tools/ directory.
  - NOTE: because readMarkers/filterPipeline are real imports, the test must satisfy their contract via the
    fake ctx (getEntries returns the entries readMarkers scans). Do NOT mock the modules — feed real-shaped entries.
```

### Implementation Patterns & Key Details

```typescript
// ── CRITICAL INSIGHT #1: auditExecute needs NO `pi`. ctx carries everything. ────────────────────────────
async function auditExecute(
  _toolCallId: string,
  params: Static<typeof AuditParams>,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<AgentToolResult<AuditDetails>> {
  try {
    const config = getConfig();
    const sessionId = ctx.sessionManager.getSessionId();   // read FRESH (C12)
    const rt = getRuntime(sessionId);

    // (c)+(d) Resolve the FILTERED view. NEVER ctx.getContextUsage() (D5 / GOTCHA #5).
    let filtered: Record<string, unknown>[];
    let source: "cached" | "fallback";
    let confidence: "low" | "medium" | "high";
    if (Array.isArray(rt.lastFiltered)) {
      filtered = rt.lastFiltered;                           // primary: the filter's cached output (spec/06 §7)
      source = "cached";
      confidence = config.audit.estimateConfidence;
    } else {
      // E16 fallback (spec/06 §7, spec/08 E16): entries → messages → re-run the SAME pipeline.
      const entries = ctx.sessionManager.buildContextEntries();
      const base = entriesToMessages(entries);
      filtered = filterPipeline(base, readMarkers(ctx), config, ctx);  // GOTCHA #2: upstream deps
      source = "fallback";
      confidence = "low";
    }

    // (e) Total from the filtered view (NOT getContextUsage — D5).
    const totalTokens = estimateTokens(filtered).tokens;

    // (f) Top-N rows.
    const top = typeof params.top === "number" && params.top > 0 ? Math.floor(params.top) : 8; // GOTCHA #8
    const callLookup = buildCallLookup(filtered);
    const threshold = config.nudges.bloatThresholdBytes;
    const all = filtered
      .map((m) => ({ tokens: estimateTokens([m]).tokens, msg: m }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, top);
    const rows: AuditRow[] = all.map(({ tokens, msg }) => ({
      tokens,
      role: readStr(msg, "role") ?? "?",
      label: describeMessage(msg, callLookup),
      bloaty: messageBytes(msg) > threshold,
    }));

    // (g) Active markers + checkpoints (checkpoints scanned separately — GOTCHA #7).
    const markers = readMarkers(ctx);
    const checkpointNames = listCheckpoints(ctx.sessionManager.getEntries());

    // (h) Render. Suggestion names the largest row (omit if filtered empty).
    const report = renderAuditReport({
      totalTokens, confidence,
      rewinds: markers.rewinds as RewindMarker[],
      shrinks: markers.shrinks as ShrinkMarker[],
      checkpointNames,
      protectedRoles: config.rewind.protectedRoles,
      thresholdBytes: threshold,
      rows,
      filtered,
    });

    // (i) Return. `details` is REQUIRED (CRITICAL GOTCHA #1).
    return {
      content: [{ type: "text" as const, text: report }],
      details: {
        totalTokens, confidence, source,
        nRewinds: markers.rewinds.length,
        nShrinks: markers.shrinks.length,
        nCheckpoints: checkpointNames.length,
        top: rows,
      },
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text" as const, text: `Mulligan: audit failed — ${reason}` }],
      details: { totalTokens: 0, confidence: "low", source: "fallback", nRewinds: 0, nShrinks: 0, nCheckpoints: 0, top: [], error: reason },
    };
  }
}

// ── The render signature (PURE → unit-testable without ctx) ────────────────────────────────────────────
export function renderAuditReport(args: {
  totalTokens: number;
  confidence: "low" | "medium" | "high";
  rewinds: RewindMarker[];
  shrinks: ShrinkMarker[];
  checkpointNames: string[];
  protectedRoles: string[];
  thresholdBytes: number;
  rows: AuditRow[];
  filtered: unknown[];
}): string {
  const L: string[] = [];
  L.push("## Mulligan audit — context you are currently carrying");
  L.push(`Total (filtered): ~${args.totalTokens} tokens  (estimate, confidence: ${args.confidence})`);
  const gran = [...new Set(args.rewinds.map((r) => r.granularity))].join(", ");
  L.push(
    `Active markers: ${args.rewinds.length} rewind${gran ? ` (${gran})` : ""}, ` +
    `${args.shrinks.length} shrink, ${args.checkpointNames.length} checkpoints` +
    (args.checkpointNames.length ? ` [${args.checkpointNames.join(", ")}]` : " []"),
  );
  L.push(`Protected: will not rewind past ${describeProtected(args.protectedRoles)}.`);
  L.push("");
  if (args.filtered.length === 0) {
    L.push("No messages in filtered view.");
  } else {
    L.push("Top messages by size:");
    const kb = Math.round(args.thresholdBytes / 1024);
    for (const r of args.rows) {
      const flag = r.bloaty ? `  ⚠ above bloat threshold (${kb} KB)` : "";
      L.push(`  ${String(r.tokens).padStart(6)}  ${r.role.padEnd(11)} ${r.label}${flag}`);
    }
    L.push("");
    L.push(`Suggestion: the \`${args.rows[0].label}\` result is the largest contributor. Consider mulligan_shrink.`);
  }
  return L.join("\n");
}

// ── describeMessage (PURE; best-effort label; spec/05 §4 example) ──────────────────────────────────────
export function describeMessage(
  msg: Record<string, unknown>,
  callLookup: Map<string, { name: string; args: Record<string, unknown> }>,
): string {
  const role = readStr(msg, "role");
  if (role === "toolResult") {
    const toolName = readStr(msg, "toolName") ?? "?";
    const callId = readStr(msg, "toolCallId");
    const call = callId ? callLookup.get(callId) : undefined;
    return `${toolName} ${briefArgs(call, msg)}`.trim();
  }
  if (role === "assistant") return summarizeAssistantContent(readOwn(msg, "content"));
  if (role === "user") return `user${snippet(contentFirstText(msg))}`;
  if (role === "custom") return readStr(msg, "customType") ?? "custom";
  return role ?? "message";
}
```

(`readOwn`/`readStr`/`snippet`/`briefArgs`/`summarizeAssistantContent`/`buildCallLookup`/`listCheckpoints`/
`entriesToMessages`/`messageBytes`/`describeProtected` are small module-local pure helpers — all read via
`readOwn`, never throw, fully unit-testable. See the report-format research note for `briefArgs` arg
precedence: `path`/`file_path` → `command` → `query`/`pattern`/`search_query`, 40-char truncation.)

### Integration Points

```yaml
FACTORY (index.ts — P1.M7.T1.S1, NOT this item):
  - add to: src/index.ts  (the `export default function (pi: ExtensionAPI)` factory)
  - pattern: "pi.registerTool(auditTool);"   # plain const — no factory, no pi closure (CRITICAL INSIGHT #1)
  - This item only DELIVERS the tool definition; it does not edit index.ts.

CONFIG:
  - reads: config.audit.estimateConfidence (default "medium"), config.nudges.bloatThresholdBytes (default 8192),
           config.rewind.protectedRoles (default ["first:user","latest:user"]).
  - NO config gate (GOTCHA #4). No new env vars.

RUNTIME:
  - reads: rt.lastFiltered (written by filter.ts, P1.M4.T2.S1). This item only READS it.

ROUTES / DATABASE:
  - none. The audit persists nothing — no migration, no index, no env var, no marker.
```

## Validation Loop

### Level 1: Type & Syntax (the highest-risk gate — run FIRST after writing the file)

```bash
# CRITICAL: this is where the `details` gotcha + the upstream-import resolution surface. Must be zero errors.
npx tsc --noEmit

# If you see: "Property 'details' is missing in type '{ content: ... }' but required in type 'AgentToolResult<...>'"
# → you returned {content:[...]} without details. Add the AuditDetails object. See CRITICAL GOTCHA #1.
# If you see: "Cannot find module '../filter.js'" or "'readMarkers' is not exported"
# → GOTCHA #2: P1.M4.T2.S1 (filter.ts) / P1.M3.T5.S1 (filterPipeline) are not shipped yet. They are build-order
#   preconditions — flag the blocker (do NOT stub around it).

# Expected: zero errors. Fix before proceeding to tests. (No lint script configured; tsc is the type/style gate.)
```

### Level 2: Unit Tests (Component Validation)

```bash
# The new tool test only:
npx vitest run test/tools/audit.test.ts

# Full suite (ensure no regression in the existing 8 test files — esp. markers.test.ts which this mirrors):
npx vitest run

# Expected: all pass. The report-string assertions are verbatim-format matches; if one fails, diff against
# spec/05 §4 exactly (the "~N tokens" prefix, the two-space "(estimate" gutter, the "⚠ above bloat threshold
# (8 KB)" wording, the backticked suggestion label).
```

### Level 3: Integration (System Validation — informational; full F-audit scenario is P1.M7.T2.S1)

```bash
# This tool cannot be invoked through `pi` until index.ts wires it (P1.M7.T1.S1). So a live `pi -p` run is NOT
# possible from this item alone. The unit test (Level 2) is the authoritative gate HERE.
# (When index.ts is later wired, the F-audit scenario — call audit, assert the filtered total drops after a
#  rewind — is the end-to-end check; that harness is built in P1.M7.T2.S1.)

# Quick load-smoke (optional, confirms the module imports cleanly — needs the upstream deps to exist):
npx tsc --noEmit && node --input-type=module -e "import('./src/tools/audit.js').then(m=>console.log(Object.keys(m)))" 2>&1 | head
```

### Level 4: Domain-Specific Validation

```bash
# N/A for this item. There is no network, DB, TUI, or performance surface.
# The domain checks are: (1) D5 honored (assert getContextUsage NEVER called — a unit-test assertion, not a
# shell command); (2) the description string matches spec/05 §5 verbatim — assert in the unit test.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` passes with zero errors (the `details` field is present in every return path; the
      upstream imports `../transforms.js`/`../filter.js` resolve).
- [ ] `npx vitest run test/tools/audit.test.ts` passes.
- [ ] `npx vitest run` (full suite) still passes — no regression in `test/markers.test.ts` et al.

### Feature Validation
- [ ] `auditTool.name === "mulligan_audit"`, `.label === "Mulligan Audit"`, `.description === AUDIT_DESC`.
- [ ] `.parameters === AuditParams` (`Type.Object({ top: Type.Optional(Type.Number({...})) })`).
- [ ] Primary path (cached `lastFiltered`): confidence = `config.audit.estimateConfidence`, `details.source==="cached"`.
- [ ] E16 fallback (null `lastFiltered`): builds from `buildContextEntries()` → `filterPipeline`, confidence `'low'`,
      `details.source==="fallback"`.
- [ ] Total via `estimateTokens(filtered)`; `ctx.getContextUsage()` is **never** called (D5 — asserted in test).
- [ ] `top` defaults to 8; `{top:N}` truncates only the "Top messages" block (total stays over ALL filtered).
- [ ] Bloat flag fires when a message's bytes exceed `config.nudges.bloatThresholdBytes` ("⚠ above bloat threshold (8 KB)").
- [ ] Active-markers line lists rewind granularities + shrink count + checkpoint names (checkpoints scanned separately).
- [ ] Suggestion names `rows[0].label`; empty filtered → "No messages in filtered view." + no suggestion.
- [ ] Nothing persisted: fake `pi` records 0 `appendEntry`/`sendMessage`/`setLabel`.
- [ ] `execute` never throws on any input (try/catch returns a failure text + `details.error`).

### Code Quality Validation
- [ ] `details` present on every `AgentToolResult` (CRITICAL GOTCHA #1).
- [ ] Imports use `.js` extensions for sibling TS modules (GOTCHA #3); typebox from bare `typebox` package.
- [ ] NO `pi` closure / factory (CRITICAL INSIGHT #1) — `auditTool` is a plain `export const`.
- [ ] NO config gate invented (GOTCHA #4); `index.ts` not modified (wiring is P1.M7.T1.S1).
- [ ] Pure helpers (`describeMessage`, `renderAuditReport`, `messageBytes`, `buildCallLookup`, `listCheckpoints`,
      `entriesToMessages`) are exported/used and unit-tested in isolation.
- [ ] All message-field reads go through `readOwn` (GOTCHA #9 — a throwing Proxy trap never crashes the audit).

### Documentation
- [ ] The tool `description` string IS the documentation (Mode A, per the item contract) — no separate doc file.
- [ ] Schema field `top` carries a `description` guiding default behavior (Default 8).

---

## Anti-Patterns to Avoid

- ❌ Don't return `{ content:[...] }` without `details` — `tsc --strict` rejects it (CRITICAL GOTCHA #1). The spec/05 §4 "Return shape" is a simplification.
- ❌ Don't use `ctx.getContextUsage()` for the total — it counts hidden tokens (D5 / GOTCHA #5). That is the single most important correctness property of this tool.
- ❌ Don't introduce a `makeAuditTool(pi)` factory or a module-scoped `pi` — the audit needs NO `pi` at all (CRITICAL INSIGHT #1). It only uses `ctx` + pure helpers.
- ❌ Don't invent a `config.audit.enabled` gate or refuse on `config.enabled === false` (GOTCHA #4) — audit is always-on diagnostics.
- ❌ Don't re-run `filterPipeline` on the primary path — `rt.lastFiltered` is already the filtered output (spec/06 §7). Re-running it only on the E16 fallback avoids double work and keeps the "one transform pipeline" invariant.
- ❌ Don't expect `readMarkers` to return checkpoints — they are `LabelEntry`s; scan `getEntries()` yourself (GOTCHA #7).
- ❌ Don't edit `src/index.ts` to wire `registerTool` here — that is explicitly P1.M7.T1.S1.
- ❌ Don't import typebox from `@sinclair/typebox` — the dep is the bare `typebox` package.
- ❌ Don't use `.ts`/extensionless imports for siblings — use `.js` (GOTCHA #3).
- ❌ Don't skip the try/catch because "it only reads" — the shared tool convention requires the tool itself to be fail-open to text (GOTCHA #10), and a throwing `getEntries()`/`buildContextEntries()`/Proxy trap must not crash the turn.
- ❌ Don't proceed past Task 0 if `filterPipeline`/`readMarkers` are not yet exported (GOTCHA #2) — they are build-order preconditions; stubbing around them would ship a tool that cannot compile or that silently lies.

---

## Confidence Score: 8/10

**Why 8**: The contract is fully pinned — `spec/05 §4` is reproduced verbatim, the report format is decomposed
line-by-line, the `AgentToolResult.details` gotcha is empirically verified, and every shipped dependency
(`estimateTokens`, `resultBytes`, `getRuntime`, `getConfig`, the marker types) is confirmed present with
exact signatures. The two residual uncertainties (−2 total):

1. **Upstream dependency timing (−1).** `filterPipeline` (P1.M3.T5.S1) and `readMarkers` (P1.M4.T2.S1) are
   not yet shipped. The build order guarantees they precede this item, and the PRP makes Task 0 a hard
   verify-or-stop gate, but if the orchestrator runs this item before them the imports won't resolve. The
   PRP is explicit about this so the implementer flags the blocker rather than stubbing.
2. **Best-effort fidelity of the fallback + labels (−1).** The E16 `entriesToMessages` conversion and the
   `describeMessage` arg-extraction are "best-effort" (spec/05 §4 / spec/06 §7 say so explicitly). The
   report's exact wording for the largest-message label depends on the matched toolCall's arguments, which
   the audit reconstructs by scanning — faithful to the spec example but not byte-pinned by any test fixture
   in the spec. The PRP pins the precedence rules so the output is deterministic and testable.

The design is clean where it can be: no `pi`, no factory, no config gate, no persistence — a plain read-only
tool that closes the feedback loop. The primary path is a cache read; the fallback is isolated and the only
intentional re-run of the single transform pipeline.