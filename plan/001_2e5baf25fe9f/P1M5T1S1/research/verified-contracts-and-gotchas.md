# Research — P1.M5.T1.S1 (`mulligan_rewind` tool) verified contracts & gotchas

All signatures below were verified against the INSTALLED code (src/*.ts, test/*.ts,
node_modules/@earendil-works/pi-coding-agent/dist/**.d.ts) during this research pass.

## 1. execute() signature + ToolDefinition (VERIFIED, api_verification.md §8 + dist .d.ts)

```ts
// dist/core/extensions/types.d.ts — ToolDefinition.execute (VERIFIED)
execute(
  toolCallId: string,                         // FIRST arg — used for excludeToolCallId
  params: Static<TParams>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
  ctx: ExtensionContext
): Promise<AgentToolResult<TDetails>>;
```

- `toolCallId` is the FIRST positional arg. It becomes `excludeToolCallId` on the
  marker (so the filter skips the rewind's own tool-call group — spec/05 §1 step 6,
  api_verification.md §8 NOTE).
- `pi` (ExtensionAPI) is NOT an execute arg → captured via the `makeRewindTool(pi)`
  factory closure (the checkpoint.ts precedent).

## 2. AgentToolResult shape (VERIFIED) — `details` is REQUIRED on every return path

```ts
// from @earendil-works/pi-agent-core, re-exported
interface AgentToolResult<TDetails = unknown> {
  content: (TextContent | ImageContent)[];   // Mulligan always returns [{type:"text", text}]
  details?: TDetails;
  isError?: boolean;
  usage?: Usage;
}
```

checkpoint.ts "CRITICAL GOTCHA #1": every `AgentToolResult<T>` return path includes a
`details` field. spec/05 §1's `{content:[...]}`-only shape is a SIMPLIFICATION; the Pi
type requires `details` under strict mode. Use a small structured object per path.

## 3. defineTool + factory pattern (VERIFIED, checkpoint.ts)

```ts
import { defineTool, type AgentToolResult, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Static } from "typebox";

export function makeRewindTool(pi: ExtensionAPI): ToolDefinition<typeof RewindParams, RewindDetails> {
  return defineTool({ name, label, description, parameters: RewindParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) { return rewindExecute(pi, toolCallId, ...); } });
}
```
- `.js` extension on relative imports (ESM/Bundler resolution, tsconfig moduleResolution:"Bundler").
- index.ts (P1.M7.T1.S1) will do `pi.registerTool(makeRewindTool(pi))`.

## 4. ★★★ CRITICAL CROSS-TASK GOTCHA — persist the `checkpoint` name ★★★

**Problem:** `RewindMarker` / `RewindMarkerInput` in `src/markers.ts` (P1.M4.T1.S1 —
ALREADY SHIPPED & FROZEN & unit-tested) has **NO `checkpoint` field** (spec/04 §3 omits
it; markers.ts followed spec/04 §3 literally). BUT `filterPipeline` (src/transforms.ts,
P1.M3.T5.S1) reads checkpoint granularity via:
```ts
const cpRaw = readOwn(rw, "checkpoint");
const cpName = typeof cpRaw === "string" ? cpRaw : "";
remove = resolveCheckpoint(m, branchEntries, cpName, excludeId)?.remove ?? [];
```
and `RewindMarkerLike` (transforms.ts) has `checkpoint?: string`. The transforms.ts
author DOCUMENTED the gap: "spec/04 §3 ... has NO `checkpoint` field though spec/06 §12 +
spec/05 require it ... This type includes BOTH".

**Consequence:** the rewind tool is the SOLE writer of rewind markers. If it does NOT
persist `checkpoint`, then `readOwn(rw,"checkpoint")` returns undefined → cpName="" →
resolveCheckpoint returns null → **every checkpoint rewind silently no-ops**.

**Fix (tool MUST do):** include `checkpoint: params.checkpoint` in the data object passed
to `appendRewindMarker`. `appendRewindMarker` does `{...data, schema, v, kind, id, seq, ts}`
— the spread PRESERVES extra fields, so the persisted marker WILL carry `checkpoint`, and
filterPipeline's readOwn will find it. The frozen `RewindMarkerInput` type omits
`checkpoint`, so build the input as a widened local object and cast at the call site
(structurally sound; the wrapper's spread preserves it at runtime). This is the
spec-reconciliation point transforms.ts explicitly anticipated.

## 5. RewindMarkerInput (markers.ts — the appendRewindMarker payload)

```ts
export type RewindMarkerInput = Omit<RewindMarker, "schema" | "v" | "kind" | "id" | "seq" | "ts">;
// => { granularity, options:{to_previous_prompt?, protect?}, excludeToolCallId?, note, ledger }
// (PLUS checkpoint, per §4 above — tool adds it; cast to satisfy the frozen type)
```
appendRewindMarker(pi, ctx, data) returns `string | null` (the new marker's ENTRY id via
getLeafId, or null on failure — never throws). The marker's uuid `id` is stamped by the
wrapper (randomUUID), NOT available to the tool.

## 6. leaveNote (markers.ts) — leaveNote(pi, content, rewindId)

```ts
export function leaveNote(pi: ExtensionAPI, content: string, rewindId: string): void
```
- `content` = renderNote(...) output. `rewindId` correlates note↔marker.
- spec/04 §3 names `<marker.id>` (uuid); appendRewindMarker returns the ENTRY id. Both are
  unique-per-entry → correlation holds either way (markers.ts interface note).
- Pass `markerId ?? toolCallId` (fallback when appendRewindMarker returned null).
- leaveNote NEVER throws (swallows sendMessage failures); it passes NO options arg (C8 —
  mid-turn, triggerTurn stays default false).

## 7. Pure helper signatures (VERIFIED from src)

- `validateNote(note: NoteInput): { valid: boolean; reason?: string }` — reason (when
  invalid) is always `NOTE_INVALID_REASON` = `"note fields must all be non-empty"` (NO
  trailing period). All four fields non-empty after trim. Never throws. (notes.ts)
- `renderNote(note, ledger: FileLedger, granularity: Granularity): string` (notes.ts)
- `extractFileLedger(messages: MessageLike[]|null, range: number[]|null): FileLedger` —
  `range` is a number[] of MESSAGE INDICES (NOT a [start,end) tuple); scans assistant
  messages at those indices. `{readFiles, modifiedFiles, bashSideEffects}` each sorted,
  deduped. (ledger.ts)
- `getConfig(): MulliganConfig` — returns a fresh clone each call. Master switch
  `config.enabled`; `config.rewind.{enabled, protectedRoles[], maxDepth, requireMutationWarning}`. (config.ts)
- `Granularity = "last_tool_call_group" | "last_turn" | "checkpoint"` (config.ts)
- Resolvers (transforms.ts, PURE, Pi-FREE): `partitionIntoUnits(messages): Unit[]`,
  `resolveLastToolCallGroup(units, messages, excludeToolCallId?): number[]|null`,
  `resolveLastTurn(messages, opts:{to_previous_prompt?}, excludeToolCallId?): {remove:number[]}`,
  `resolveCheckpoint(messages, branchEntries:BranchEntry[], checkpointName, excludeToolCallId?): {remove}|null`.

## 8. Snapshot → messages for read-only ledger/K resolution (VERIFIED importable)

The tool is WRITE-ONLY w.r.t. event.messages (it never receives the context event).
For the ADVISORY ledger + K estimate, build a snapshot:
- `sessionEntryToContextMessages` + `SessionEntry` + `buildContextEntries` ARE re-exported
  from the MAIN package `@earendil-works/pi-coding-agent` (dist/index.d.ts line 19 — VERIFIED).
  So the tool imports them directly (no deep import).
- `ctx.sessionManager.buildContextEntries(): SessionEntry[]` (compaction-aware active branch).
- `sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[]` — flatten via
  `entries.flatMap(e => sessionEntryToContextMessages(e))` → message-like array.
- AgentMessage[] is structurally assignable to BOTH ledger.MessageLike[] and
  transforms.MessageLike[] (both are `{role?, content?, [key]:unknown}`).
- `ctx.sessionManager.getBranch(): SessionEntry[]` (leaf→root) for checkpoint resolution
  (resolveCheckpoint takes branchEntries; it reverses internally).
- BEST-EFFORT + FAIL-OPEN: wrap the whole snapshot+resolution+extract in try/catch → on
  any failure, ledger = empty FileLedger, K = 0 (spec/05 §1 step 5: "the ledger is
  advisory"; E13 fail-open). The AUTHORITATIVE hiding happens later in the filter.

## 9. K = removal-set length (the resolver output)

Each resolver returns the message INDICES to remove:
- last_tool_call_group: `resolveLastToolCallGroup(units, m, excludeId) ?? []`
- last_turn: `resolveLastTurn(m, {to_previous_prompt}, excludeId).remove`
- checkpoint: `resolveCheckpoint(m, branchEntries, name, excludeId)?.remove ?? []`
K = that array's `.length`. Same removal set fed to extractFileLedger(messages, remove).
K=0 → reported honestly (spec/05 step 8). The snapshot won't contain the current in-flight
rewind call yet, so "last tool-call group" resolves to the PREVIOUS one (correct for the
preview; the filter re-resolves authoritatively later — D7).

## 10. Depth guard + checkpoint-existence scan source

- Depth guard (spec/05 §1 step 4, E4): count active `mulligan:rewind` markers; if
  `>= config.rewind.maxDepth` → refuse. Count = `getEntries().filter(e => e.type==="custom"
  && e.customType==="mulligan:rewind").length` (consistency with filter readMarkers which
  scans getEntries()). Spec says "on the branch"; in a linear session getEntries==branch.
- Checkpoint existence (spec/05 §1 step 3, E10): scan for label
  `mulligan:checkpoint:${params.checkpoint}`. Use getEntries() filtering
  `type==="label" && label===needle`. Not found → refuse. A malformed name simply won't
  match → refuse (format validation is the checkpoint TOOL's job at creation).

## 11. Mutation warning (spec/05 §1 step 7, spec/08 E5)

If `config.rewind.requireMutationWarning && (ledger.modifiedFiles.length>0 ||
ledger.bashSideEffects.length>0)` → append to the success text (VERBATIM spec/08 E5):
`"⚠ The hidden span modified files/ran side-effecting commands (see note). Those effects
PERSIST on disk; do not blindly redo them."`

## 12. Success/refusal text formats (spec/05 §1 Return shape)

- Success: `"Mulligan: rewound <granularity>. <K> messages will be hidden from your view
  starting next turn. Note left.< mutation warning?>"`
- K=0 honesty (step 8): report 0 truthfully — e.g. append " (nothing matched to hide)".
- All refusals: `"Mulligan: refused — <reason>."` (shared convention prefix; checkpoint.ts).

## 13. test idiom (test/tools/checkpoint.test.ts + test/markers.test.ts)

- vitest; hand-rolled `makePi()`/`makeCtx()` fakes (NO vi.fn()). clearAll() before/after.
- makePi captures appendEntry/sendMessage/setLabel; flags throwOn*.
- makeCtx scripts getSessionId/getLeafId; for rewind also needs getEntries() (marker list +
  labels) + getBranch() (checkpoint resolution) + buildContextEntries() (snapshot).
- expectTypeOf for ToolDefinition/AgentToolResult type assertions.
- `firstText(res)` helper narrows content[0] to text before reading .text.