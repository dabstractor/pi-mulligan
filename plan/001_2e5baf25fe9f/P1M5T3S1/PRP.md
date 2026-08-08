# PRP — P1.M5.T3.S1: Implement `mulligan_checkpoint` tool

> Work item: **P1.M5.T3.S1** — "Implement mulligan_checkpoint tool — name validation, setLabel"
> Layer: P1.M5 Agent-Callable Tools. Depends on P1.M4.T1.S2 (`setCheckpoint` wrapper — **already complete & shipped** in `src/markers.ts`). Consumed downstream by P1.M7.T1.S1 (`index.ts` factory wiring).

---

## Goal

**Feature Goal**: Ship the third of four agent-callable Mulligan tools — `mulligan_checkpoint` — that lets the agent name the current transcript position so a later `mulligan_rewind(granularity:"checkpoint", checkpoint:"<name>")` can target it precisely in one shot.

**Deliverable**: A new file `src/tools/checkpoint.ts` exporting `checkpointTool: ToolDefinition` (and the `CheckpointParams` typebox schema). The tool: (1) validates the checkpoint name against `/^[a-z0-9_-]{1,40}$/`; (2) delegates to the existing `setCheckpoint(pi, ctx, name)` wrapper from `src/markers.ts`; (3) returns the agent-facing success/refusal text. Plus a unit test file `test/tools/checkpoint.test.ts` covering validation accept/reject, success path, no-leaf refusal, and the never-throws try/catch.

**Success Definition**:
- `npx tsc --noEmit` passes with zero errors (this is the highest-risk gate — see CRITICAL GOTCHA #1).
- `npx vitest run test/tools/checkpoint.test.ts` passes.
- The exported `checkpointTool` has `name:"mulligan_checkpoint"`, the exact spec description string, a `CheckpointParams` schema, and an `execute` that returns the exact success/refusal text from spec/05 §3.
- Name validation lives in the **tool** (not the wrapper) — invalid names are refused with a clear reason; the wrapper is never called with a bad name.

## User Persona

**Target User**: The LLM agent itself (the tool is agent-callable; there is no human UI surface).

**Use Case**: The agent is about to embark on a speculative/experimental sub-task (a refactor experiment, a risky approach) and wants to leave a named landmark it can rewind straight back to if the experiment goes wrong — without shedding the whole turn.

**User Journey**:
1. Agent decides "I'm about to try something I might want to undo wholesale."
2. Agent calls `mulligan_checkpoint({ name: "before-refactor-experiment" })`.
3. Tool validates the name, labels the current leaf via `pi.setLabel`, and replies with the entry id + the exact rewind command to use later.
4. Later, if the experiment fails, the agent calls `mulligan_rewind({ granularity:"checkpoint", checkpoint:"before-refactor-experiment", note:{...} })` (implemented in P1.M5.T1.S1) to jump back to that position.

**Pain Points Addressed**: Precise, one-shot undo targeting that the two relative granularities (`last_tool_call_group`, `last_turn`) cannot express — anchoring an undo point that is neither "the most recent thing" nor "the whole turn."

## Why

- Completes the checkpoint *creation* half of the checkpoint feature. The *consumption* half (rewind targeting a checkpoint + the entry→message mapping in the filter, P1.M3.T3.S1 / P1.M4.T2) is out of scope for this item — this tool only **writes** a label.
- Checkpoints are Pi `LabelEntry`s (NOT `CustomEntry`s, NOT in LLM context) — cheap, non-noisy, and resolvable only when a rewind targets them. This tool is the sole writer of the `mulligan:checkpoint:` label namespace.
- The `setCheckpoint` Pi-coupling wrapper already exists (P1.M4.T1.S2) and is fully unit-tested; this tool is a **thin, typebox-schema'd, validation-owning adapter** on top of it. The work is small (0.5 pts) but correctness-critical because the LLM's reliable use depends on the exact name/description/parameter shape.

## What

A `ToolDefinition` named `mulligan_checkpoint` that:
- Declares a typebox `CheckpointParams = Type.Object({ name: Type.String({...}) })`.
- Validates the name against `/^[a-z0-9_-]{1,40}$/` **before** delegating to `setCheckpoint`; refuses (returns text, never throws) on invalid names.
- On success returns `{ content:[{type:"text", text:"Mulligan: checkpoint '<name>' set at entry <id>. Rewind to it with mulligan_rewind(granularity:'checkpoint', checkpoint:'<name>')."}], details }`.
- On `setCheckpoint` failure (`{error}`) or any thrown error returns a descriptive text result (fail-open; the shared tool convention: never throw — spec/05 "Shared tool conventions").

### Success Criteria

- [ ] `src/tools/checkpoint.ts` exists, exporting `checkpointTool` and `CheckpointParams`.
- [ ] `checkpointTool.name === "mulligan_checkpoint"`, `.label === "Mulligan Checkpoint"`, `.description === CKPT_DESC` (verbatim string below).
- [ ] `checkpointTool.parameters` is `CheckpointParams` (`Type.Object({ name: Type.String({...}) })`).
- [ ] `execute` validates the name; invalid → refusal text; valid → `setCheckpoint(pi, ctx, name)` → success/refusal text.
- [ ] `execute` return object **includes a `details` field** (CRITICAL GOTCHA #1) and never throws.
- [ ] `npx tsc --noEmit` passes; `npx vitest run test/tools/checkpoint.test.ts` passes.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, would they have everything needed to implement this successfully?_ **Yes** — the wrapper it delegates to is fully defined and tested; the exact Pi `ToolDefinition`/`AgentToolResult` shapes are pinned below with the one non-obvious gotcha (`details`) empirically verified; the test fake pattern is reproduced from the existing `markers.test.ts`.

### Documentation & References

```yaml
# MUST READ — the authoritative tool contract (schema, return text, behavior, registration, description string)
- url: spec/05-tools.md  (read §3 "mulligan_checkpoint" and §5 "Tool registration summary" + description strings)
  why: §3 is the verbatim contract for THIS tool (param schema, return shape, 4-step behavior). §5 gives registration name/label/description and the exact CKPT_DESC string.
  critical: "§3 Return shape shows ONLY `{ content:[...] }` — that is a SIMPLIFICATION. The real Pi type requires a `details` field. See CRITICAL GOTCHA #1. Behavior §3 step 1 puts name validation in the TOOL; step 2-3 are already done by the `setCheckpoint` wrapper."

# MUST READ — the checkpoint data model (LabelEntry, name regex, prefix)
- url: spec/04-data-model.md §6 "Checkpoint"
  why: Defines what a checkpoint IS: a Pi LabelEntry via `pi.setLabel(leafId, "mulligan:checkpoint:<name>")`, NOT a CustomEntry, NOT in LLM context. Names MUST match /^[a-z0-9_-]{1,40}$/.
  critical: "The `mulligan:checkpoint:` prefix distinguishes Mulligan checkpoints from user/bookmark labels. The wrapper owns the prefix; the tool owns the name regex."

# MUST READ — edge case E10 (name validation responsibility split)
- url: spec/08-edge-cases.md §E10 "Checkpoint name invalid or not found"
  why: "mulligan_checkpoint validates the name FORMAT at creation; mulligan_rewind validates EXISTENCE." Confirms THIS tool's job is format validation only.
  critical: Do NOT try to check existence here — existence is a rewind-time concern (P1.M5.T1.S1).

# MUST READ — the wrapper this tool delegates to (ALREADY SHIPPED, do not reimplement)
- file: src/markers.ts
  why: Contains `setCheckpoint(pi, ctx, name): SetCheckpointResult` + the exported `SetCheckpointResult` type. The tool imports BOTH.
  pattern: "setCheckpoint already does: null-check getLeafId() → {error:'no leaf'}; pi.setLabel(leafId, `mulligan:checkpoint:${name}`); try/catch → {error:string} on throw; success → {entryId:string}. It TRUSTS the caller's name (GOTCHA #7) and only prefixes it."
  gotcha: "Import path is `../markers.js` (NOT `../markers.ts`) — see GOTCHA #2 (ESM .js convention). `setCheckpoint` NEVER throws, but the tool MUST still wrap its own body in try/catch per the shared tool convention."

# MUST READ — the Pi ToolDefinition + AgentToolResult shapes (the type contract)
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: "ToolDefinition<TParams> = { name, label, description, parameters:TParams, execute(toolCallId, params:Static<TParams>, signal, onUpdate, ctx): Promise<AgentToolResult<TDetails>> }. AgentToolResult<T> = { content:(TextContent|ImageContent)[]; details:T; usage?; ... }."
  pattern: "params is auto-typed as Static<typeof CheckpointParams> = { name: string }. ctx is ExtensionContext (the SAME type setCheckpoint takes)."
  gotcha: "CRITICAL GOTCHA #1 — `details` is REQUIRED (not optional). Empirically verified: returning `{content:[...]}` alone FAILS `tsc --strict` with 'Property details is missing ... required in type AgentToolResult<unknown>'. Return `details: undefined` (or a small object)."

# Reference — a working (but UNtypechecked) registerTool call to copy the execute shape from
- file: spec/reference/looper-smoke.proto.ts  (lines ~110-170)
  why: Shows the `pi.registerTool({ name, label, description, parameters: Type.Object({}), async execute(){...} })` shape and the `{ content:[{type:"text" as const, text}] }` return idiom.
  gotcha: "This file is EXCLUDED from tsconfig (include is [src,test]) so it is NOT typechecked — that is exactly why it can OMIT `details` and still 'work'. YOUR file in src/ IS strict-typechecked, so you MUST add `details`. Do not copy its return verbatim."

# typebox package (v1.3.11 — the bare `typebox` package, rebranded @sinclair/typebox)
- file: node_modules/typebox/build/index.d.mts
  why: "Exports `Type` (namespace) and types `Static`, `TSchema`, `TObject` from the package root. `import { Type } from "typebox"` and `import type { Static } from "typebox"` both resolve."
  pattern: "Build the schema with `Type.Object({ name: Type.String({ description: "..." }) })`. params type = `Static<typeof CheckpointParams>` = `{ name: string }`."
  gotcha: "package.json dependency is literally `\"typebox\": \"*\"`. Do NOT import from `@sinclair/typebox` (not installed)."

# Test pattern to mirror EXACTLY
- file: test/markers.test.ts  (the `setCheckpoint` describe block + the makePi/makeCtx fakes)
  why: Shows the house test idiom: vitest, hand-rolled `makePi()`/`makeCtx()` fakes (no vi.fn()), `.js` import paths, `expectTypeOf` for type assertions, `clearAll()` runtime reset.
  pattern: "Reuse the SAME `makePi` (captures `labels`/`setLabel` calls) and `makeCtx` (scripts `getLeafId`). For tool tests you also need to assert the returned `content[0].text` string."
```

### Current Codebase tree (relevant slice)

```bash
src/
├── index.ts            # factory stub — currently a no-op (P1.M7.T1.S1 will wire checkpointTool here)
├── config.ts           # MulliganConfig, getConfig() (this tool does NOT gate on config — see GOTCHA #4)
├── markers.ts          # setCheckpoint(pi, ctx, name): SetCheckpointResult  ← DELEGATE TARGET (complete)
├── runtime.ts          # SessionRuntime map + nextSeq + clearAll
└── (no tools/ dir yet) # P1.M5 creates src/tools/
test/
├── markers.test.ts     # house test idiom: makePi/makeCtx fakes, vitest, .js imports
└── (no tools/ dir yet)
package.json            # scripts: "test": "vitest run", "smoke": "pi -e ..."; deps: typebox, vitest, typescript
tsconfig.json           # strict:true, moduleResolution:Bundler, include:["src","test"]
```

### Desired Codebase tree with files to be added

```bash
src/tools/
└── checkpoint.ts       # NEW — exports `checkpointTool` (ToolDefinition) + `CheckpointParams` (typebox schema)
                        #   thin adapter: validate name regex → setCheckpoint(pi, ctx, name) → text result (+details)
test/tools/
└── checkpoint.test.ts  # NEW — unit tests mirroring test/markers.test.ts fakes; covers regex accept/reject,
                        #   success text verbatim, no-leaf refusal, setLabel-throw → text (never throws), types
```

`src/index.ts` is **NOT modified by this item** — wiring `pi.registerTool(checkpointTool)` into the factory is P1.M7.T1.S1 (explicitly out of scope here; the item contract says only "Consumed by index.ts").

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 — `details` is REQUIRED on the tool result (spec/05 omits it; the type does not).
// Empirically verified against this exact tsconfig:
//   return { content:[{type:"text", text:"..."}] }            // ❌ tsc ERROR: Property 'details' is missing
//   return { content:[{type:"text", text:"..."}], details: undefined }  // ✅ compiles
// The spec/05 §3 "Return shape" is a SIMPLIFICATION. ALWAYS return `details` (undefined or a small object).
// Root cause: AgentToolResult<T> = { content:...; details: T; ... } and TDetails defaults to `unknown`.

// GOTCHA #2 — ESM `.js` import paths. Every import of a sibling TS file uses the `.js` extension:
//   import { setCheckpoint } from "../markers.js";   // NOT "../markers.ts", NOT "../markers"
// This is the house convention (see test/markers.test.ts: `from "../src/markers.js"`). Required by Bundler/NodeNext resolution.

// GOTCHA #3 — Name validation is the TOOL's job, NOT the wrapper's (markers.ts setCheckpoint trusts the caller).
// Validate `/^[a-z0-9_-]{1,40}$/` BEFORE calling setCheckpoint. Refuse (return text) on mismatch. Never pass a bad name down.

// GOTCHA #4 — No config gate here. Unlike mulligan_rewind (config.rewind.enabled) / mulligan_shrink, the checkpoint
// tool has NO `config.checkpoint.enabled` switch (spec/09 has no checkpoint config section). Do NOT invent one.
// Checkpoints are inert labels; there is nothing to disable.

// GOTCHA #5 — setCheckpoint NEVER throws, but the tool MUST still wrap its OWN body in try/catch (shared tool
// convention, spec/05 "Shared tool conventions": "on error it returns a text result describing the failure (never
// throws — a thrown tool error is noisy and can confuse the loop)"). A throw from the regex test is implausible,
// but defense-in-depth: catch and return text.

// GOTCHA #6 — getLeafId() returning null is handled by setCheckpoint ({error:"no leaf"}), NOT by the tool.
// The tool just inspects the discriminated result: `"entryId" in r` (success) vs `"error" in r` (refuse).
// Do NOT call getLeafId() yourself; that would duplicate the wrapper and read stale state.

// GOTCHA #7 — `details: undefined` is fine for the type, but a small structured object is more useful for
// logs/audit: e.g. `details: { name, entryId }` on success, `details: { name }` on refusal. Either compiles.
// (Recommended: structured object — matches the audit/debug intent of `details` in the type docs.)
```

## Implementation Blueprint

### Data models and structure

No new persisted data model is created by this item — the `LabelEntry` shape is Pi's, written via `setCheckpoint`. The only new structures are the typebox schema and the tool definition:

```typescript
// src/tools/checkpoint.ts
import { Type } from "typebox";
import type { Static } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { setCheckpoint } from "../markers.js";            // GOTCHA #2: .js extension
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// 1) The parameter schema (spec/05 §3). Typebox; `Static<typeof CheckpointParams>` === { name: string }.
export const CheckpointParams = Type.Object({
  name: Type.String({
    description:
      "Checkpoint name. lowercase, digits, hyphen, underscore only; max 40 chars. e.g. 'before-refactor-experiment'.",
  }),
});
// (Optional but useful:) export the inferred params type for the execute signature / tests.
export type CheckpointArgs = Static<typeof CheckpointParams>;

// 2) The name-format guard (spec/05 §3 step 1; spec/04 §6; spec/08 E10). LIVES IN THE TOOL (GOTCHA #3).
const NAME_RE = /^[a-z0-9_-]{1,40}$/;
function validCheckpointName(name: string): boolean {
  return typeof name === "string" && NAME_RE.test(name);
}
```

`SetCheckpointResult` (the discriminated return of `setCheckpoint`) is **already exported** from `src/markers.ts` — import the type only if you want to narrow it; otherwise inspect with `"entryId" in r` / `"error" in r`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/tools/checkpoint.ts
  - IMPLEMENT: CheckpointParams typebox schema (Type.Object({ name: Type.String({description}) })) — verbatim from spec/05 §3.
  - IMPLEMENT: NAME_RE = /^[a-z0-9_-]{1,40}$/ + validCheckpointName guard (spec/05 §3 step1, spec/04 §6, E10).
  - IMPLEMENT: checkpointExecute async function: (1) validate name → refuse text if invalid; (2) setCheckpoint(pi, ctx, name);
    (3a) on {entryId} → success text; (3b) on {error} → refusal text. Whole body in try/catch → failure text. Return {content, details}.
  - EXPORT: checkpointTool = defineTool({ name:"mulligan_checkpoint", label:"Mulligan Checkpoint",
    description: CKPT_DESC, parameters: CheckpointParams, execute: checkpointExecute }).
  - EXPORT: CheckpointParams (and optionally CheckpointArgs).
  - FOLLOW pattern: spec/05 §5 registration summary (name/label/description) + spec/reference/looper-smoke.proto.ts (execute idiom)
    BUT add `details` (CRITICAL GOTCHA #1) and the `.js` import (GOTCHA #2).
  - NAMING: file `src/tools/checkpoint.ts`; exported const `checkpointTool`; schema `CheckpointParams`.
  - PLACEMENT: new src/tools/ directory.
  - DO NOT: modify src/index.ts (wiring is P1.M7.T1.S1). DO NOT reimplement setLabel/getLeafId (delegate to markers.ts).

Task 2: CREATE test/tools/checkpoint.test.ts
  - IMPLEMENT: mirror test/markers.test.ts — reuse the makePi() (captures setLabel via `labels`) and makeCtx() fakes.
    Because `execute` needs (pi, ctx), construct the args: checkpointTool.execute("call-1", {name}, undefined, undefined, ctx) with a makePi pi.
  - CASES:
      a) success: name "before-refactor" + leafId "leaf-9" → setLabel called once with ("leaf-9","mulligan:checkpoint:before-refactor");
         result.content[0].text === "Mulligan: checkpoint 'before-refactor' set at entry leaf-9. Rewind to it with mulligan_rewind(granularity:'checkpoint', checkpoint:'before-refactor')."
      b) regex accept boundary: "a", "a-b_c1", 40-char name → success; do NOT call setLabel with malformed prefix.
      c) regex reject: "" (empty), "With Space", "UPPER", "dot.dot", "name!" , 41-char name → refusal text containing the name/regex reason; setLabel NOT called.
      d) no-leaf: leafId null → setCheckpoint returns {error:"no leaf"} → refusal text; setLabel NOT called.
      e) never-throws: a throwing setLabel (setCheckpoint swallows it → {error}) → still a text result, execute does not throw.
      f) result shape: content is [{type:"text",text:string}] AND `details` is present (assert "details" in result).
      g) types: expectTypeOf(checkpointTool).toMatchTypeOf<ToolDefinition>(); params inferred as {name:string}.
  - FOLLOW pattern: test/markers.test.ts (vitest describe/it/expect/expectTypeOf, .js imports, fakes).
  - NAMING: test/tools/checkpoint.test.ts; describe("mulligan_checkpoint ...").
  - COVERAGE: validation accept+reject, success text verbatim, refusal paths, never-throws, result shape incl. details.
  - PLACEMENT: new test/tools/ directory.
```

### Implementation Patterns & Key Details

```typescript
// ── The exact description string (spec/05 §5 — Mode A LLM-facing docs; copy VERBATIM) ──────────────────
const CKPT_DESC =
  "Name the current position so a later mulligan_rewind can jump straight back to it. " +
  "Use before a speculative sub-task you might want to undo in one shot.";

// ── The execute body (spec/05 §3 behavior; shared tool convention = never throws) ─────────────────────
async function checkpointExecute(
  _toolCallId: string,
  params: Static<typeof CheckpointParams>,
  _signal: AbortSignal | undefined,
  _onUpdate: unknown,
  ctx: ExtensionContext,
): Promise<AgentToolResult<unknown>> {
  // NOTE: execute ALSO receives `pi`? — NO. The Pi ExtensionAPI is NOT passed to execute().
  //       Resolution: capture `pi` via closure at tool-construction time (the factory in index.ts closes over the
  //       `pi` it receives). For unit tests, construct the tool with a captured pi. SEE "The `pi` closure" note below.
  try {
    const name = params.name;                       // Static<typeof CheckpointParams> = { name: string }
    // (1) Validate name format (spec/05 §3 step 1; spec/04 §6; spec/08 E10) — THE TOOL OWNS THIS (GOTCHA #3).
    if (!validCheckpointName(name)) {
      return refusal(
        `invalid checkpoint name '${name}' — must match /^[a-z0-9_-]{1,40}$/ (lowercase, digits, hyphen, underscore; 1-40 chars).`,
        name,
      );
    }
    // (2) Delegate (markers.ts setCheckpoint: null-checks getLeafId, prefixes, try/catches; trusts the name).
    const res = setCheckpoint(pi, ctx, name);
    if ("entryId" in res) {
      // (3a) success — spec/05 §3 return text, verbatim.
      const text =
        `Mulligan: checkpoint '${name}' set at entry ${res.entryId}. ` +
        `Rewind to it with mulligan_rewind(granularity:'checkpoint', checkpoint:'${name}').`;
      return { content: [{ type: "text" as const, text }], details: { name, entryId: res.entryId } };
    }
    // (3b) wrapper-reported failure (e.g. {error:"no leaf"} or a swallowed setLabel throw).
    return refusal(`could not set checkpoint: ${res.error}`, name);
  } catch (e) {
    // Shared tool convention: never throw — return a text result describing the failure.
    return refusal(`unexpected error: ${e instanceof Error ? e.message : String(e)}`, params?.name);
  }
}

// helper: build a refusal result (text content + details; ALWAYS includes details — CRITICAL GOTCHA #1)
function refusal(reason: string, name?: string): AgentToolResult<unknown> {
  return {
    content: [{ type: "text" as const, text: `Mulligan: refused — ${reason}` }],
    details: { name },
  };
}

// ── Export the tool (use defineTool to preserve CheckpointParams inference when assigning to a variable) ──
export const checkpointTool: ToolDefinition<typeof CheckpointParams> = defineTool({
  name: "mulligan_checkpoint",
  label: "Mulligan Checkpoint",
  description: CKPT_DESC,
  parameters: CheckpointParams,
  execute: checkpointExecute,
});
```

**The `pi` closure (the one design decision to make explicitly).** The Pi `ExtensionAPI` is passed to the extension **factory** (`export default function (pi: ExtensionAPI)` in `src/index.ts`) and is NOT an argument to a tool's `execute(toolCallId, params, signal, onUpdate, ctx)`. So `checkpointTool` needs `pi` via a closure. Two acceptable shapes — pick ONE and be consistent:

- **(Recommended) Factory function** — export a builder so the wiring site captures `pi`:
  ```typescript
  export function makeCheckpointTool(pi: ExtensionAPI): ToolDefinition<typeof CheckpointParams> {
    return defineTool({ name:"mulligan_checkpoint", label:"Mulligan Checkpoint", description: CKPT_DESC,
      parameters: CheckpointParams, execute: (id, p, s, u, ctx) => checkpointExecute(pi, id, p, s, u, ctx) });
  }
  ```
  Then `index.ts` (P1.M7.T1.S1) does `pi.registerTool(makeCheckpointTool(pi))`. For unit tests: `const tool = makeCheckpointTool(fakePi);`.
- **(Alternative) Module-scoped `pi`** set by an init setter — rejected: it adds mutable global state, which this codebase avoids (see `config.ts` `setConfig` is the only such seam and is config-only).

> ⚠ If you instead export a bare `checkpointTool` const that references a module-scoped `pi`, unit tests cannot inject a fake. The factory form is testable and matches how the prototype wires tools inside the `pi`-receiving factory. **Use the `makeCheckpointTool(pi)` factory form and re-export the result type.** (If the orchestrator's plan strictly expects an exported `checkpointTool` symbol, export BOTH: a factory `makeCheckpointTool` AND, for the index.ts wiring step, call it once to produce the registered tool. The unit test exercises the factory with a fake pi.)

### Integration Points

```yaml
FACTORY (index.ts — P1.M7.T1.S1, NOT this item):
  - add to: src/index.ts  (the `export default function (pi: ExtensionAPI)` factory)
  - pattern: "pi.registerTool(makeCheckpointTool(pi));"  (or pi.registerTool(checkpointTool) if a module-scoped pi seam is later chosen)
  - This item only DELIVERS the tool definition + factory; it does not edit index.ts.

CONFIG:
  - none. There is no config.checkpoint section (GOTCHA #4). Do not read getConfig() in this tool.

ROUTES / DATABASE:
  - none. A checkpoint is a Pi LabelEntry written by setCheckpoint; no migration, no index, no env var.
```

## Validation Loop

### Level 1: Type & Syntax (the highest-risk gate — run FIRST after writing the file)

```bash
# CRITICAL: this is where the `details` gotcha surfaces. Must be zero errors.
npx tsc --noEmit

# If you see: "Property 'details' is missing in type '{ content: ... }' but required in type 'AgentToolResult<unknown>'"
# → you returned {content:[...]} without details. Add `details: undefined` (or {name, entryId}). See CRITICAL GOTCHA #1.

# Expected: zero errors. Fix before proceeding to tests.
```

(There is no ESLint/Ruff configured in this repo — `package.json` has no lint script. `tsc --noEmit` is the type/style gate. Vitest provides no separate format step.)

### Level 2: Unit Tests (Component Validation)

```bash
# The new tool test only:
npx vitest run test/tools/checkpoint.test.ts

# Full suite (ensure no regression to the existing 7 test files, esp. markers.test.ts which setCheckpoint lives in):
npx vitest run

# Expected: all pass. The success-text assertion is a verbatim string match — if it fails, diff your text against
# spec/05 §3 exactly (apostrophes around the name, the literal "granularity:'checkpoint'" wording).
```

### Level 3: Integration (System Validation — informational; the full F-checkpoint scenario is P1.M7.T2.S1)

```bash
# This tool cannot be invoked through `pi` until index.ts wires it (P1.M7.T1.S1). So a live `pi -p` run is NOT
# possible from this item alone. The unit test (Level 2) is the authoritative gate HERE.
# (When index.ts is later wired, the F-checkpoint scenario in spec/10 §2 — set a checkpoint, then rewind to it —
#  is the end-to-end check; that harness is built in P1.M7.T2.S1.)

# Quick load-smoke (optional, confirms the module imports cleanly with no syntax error):
node --input-type=module -e "import('./src/tools/checkpoint.js').then(m => console.log(Object.keys(m)))" 2>&1 | head
# (Note: under tsconfig's Bundler resolution a raw node import of the .ts may need a loader; prefer `tsc --noEmit`.)
```

### Level 4: Domain-Specific Validation

```bash
# N/A for this item. There is no network, DB, TUI, or performance surface.
# The domain check is "does the LLM-facing description string match spec/05 §5 verbatim?" — assert in the unit test.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` passes with zero errors (the `details` field is present in every return path).
- [ ] `npx vitest run test/tools/checkpoint.test.ts` passes.
- [ ] `npx vitest run` (full suite) still passes — no regression in `test/markers.test.ts`.

### Feature Validation
- [ ] `checkpointTool.name === "mulligan_checkpoint"`, `.label === "Mulligan Checkpoint"`.
- [ ] `.description` equals the CKPT_DESC verbatim string from spec/05 §5.
- [ ] `.parameters === CheckpointParams` (Type.Object({ name: Type.String({...}) })).
- [ ] Invalid names (empty, uppercase, spaces, dots, special chars, >40 chars) → refusal text; `setLabel` NOT called.
- [ ] Valid names (incl. boundary `a` and a 40-char name) → success; `setLabel` called once with `mulligan:checkpoint:<name>`.
- [ ] Success text is byte-identical to spec/05 §3 (apostrophes + the rewind-command wording).
- [ ] `setCheckpoint` `{error:"no leaf"}` path → refusal text (the tool does not call `getLeafId` itself).
- [ ] `execute` never throws on any input or on a failing `pi` (try/catch returns text).

### Code Quality Validation
- [ ] Name validation lives in the tool; the wrapper is never called with an invalid name.
- [ ] `details` is present on every `AgentToolResult` (CRITICAL GOTCHA #1).
- [ ] Imports use `.js` extensions for sibling TS modules (GOTCHA #2).
- [ ] `pi` is injected via a factory/testable closure (not module-scoped mutable state).
- [ ] No config gate invented (GOTCHA #4); `index.ts` not modified (wiring is P1.M7.T1.S1).

### Documentation
- [ ] The tool `description` string IS the documentation (Mode A, per the item contract) — no separate doc file.
- [ ] Schema field carries a `description` guiding valid name format.

---

## Anti-Patterns to Avoid

- ❌ Don't return `{ content:[...] }` without `details` — `tsc --strict` rejects it (CRITICAL GOTCHA #1). The spec/05 §3 "Return shape" is a simplification.
- ❌ Don't reimplement `pi.setLabel` / `getLeafId()` / the prefix / the null-check — `setCheckpoint` already does all of it and is tested. Delegate.
- ❌ Don't move name validation into the wrapper — it is intentionally the tool's job (markers.ts GOTCHA #7 / spec/08 E10).
- ❌ Don't skip the try/catch in `execute` because "setCheckpoint never throws" — the shared tool convention requires the tool itself to be fail-open to text.
- ❌ Don't invent a `config.checkpoint.enabled` gate (none exists; GOTCHA #4).
- ❌ Don't edit `src/index.ts` to wire `registerTool` here — that is explicitly P1.M7.T1.S1.
- ❌ Don't import typebox from `@sinclair/typebox` — the dep is the bare `typebox` package.
- ❌ Don't use `.ts`/extensionless imports for siblings — use `.js` (GOTCHA #2).
- ❌ Don't make `pi` a module-scoped mutable variable — it breaks testability; use a `makeCheckpointTool(pi)` factory.

---

## Confidence Score: 9/10

**Why 9**: The delegate target (`setCheckpoint`) is already implemented and fully unit-tested; the Pi `ToolDefinition`/`AgentToolResult` contract is pinned with the single non-obvious gotcha (`details`) empirically verified against this exact tsconfig; the test fake idiom is reproduced from the existing house test. The one residual uncertainty (−1) is the `pi`-injection seam: the spec shows `pi.registerTool(...)` inside the factory, but a standalone exported tool needs a closure — the PRP prescribes the testable `makeCheckpointTool(pi)` factory and flags the decision explicitly so the implementer does not flounder or introduce module-scoped state.