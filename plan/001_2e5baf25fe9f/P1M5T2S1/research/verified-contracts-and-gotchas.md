# Research — P1.M5.T2.S1: `mulligan_shrink` tool (verified contracts + gotchas)

Goal: record the VERIFIED facts an implementer needs, so the PRP can cite them with confidence.
All signatures below were read from the installed source (not the spec prose) and cross-checked
against `dist/*.d.ts`. Baseline before this task: `tsc --noEmit` → exit 0; `vitest run` → 436 passed.

## 1. The tool contract (spec/05-tools.md §2 — read verbatim)

- **Purpose:** replace the content of ONE specific past message (usually a bloated `toolResult`)
  with a compact replacement, persistently, in the model's view — WITHOUT removing it.
- **ShrinkParams** (typebox, copy VERBATIM incl. every field description):
  ```ts
  Type.Object({
    target: Type.Union([
      Type.Object({ by_tool_call_id: Type.String({ description: "The toolCallId of the result to shrink." }) }),
      Type.Object({ by_tool_name: Type.String({ description: "e.g. 'read', 'bash'" }),
                    occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]) }),
      Type.Object({ by_content_includes: Type.String({ description: "Shrink the (first) message whose text contains this substring." }) }),
    ], { description: "How to identify the message to shrink. Resolved live each turn (robust to compaction)." }),
    replacement: Type.String({ description: "The compact text that replaces the matched message's content. Make it a faithful summary — the model will treat it as ground truth from now on." }),
    reason: Type.Optional(Type.String({ description: "Why (surfaced in audit). Optional." })),
  })
  ```
  → `Static<typeof ShrinkParams>` === `{ target: ShrinkTarget; replacement: string; reason?: string }`.
  This is EXACTLY `ShrinkMarkerInput` (target + replacement + optional reason).

- **Return shape (spec/05 §2, VERBATIM):**
  `{ content:[{ type:"text", text: "Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: yes/no)" }] }`
  → the "yes/no" is filled from the best-effort match.

- **Behavior (spec/05 §2 steps 1–5):**
  1. Validate config (`config.shrink.enabled`). → refuse if disabled.
  2. Validate `replacement` non-empty (after trim). → refuse if empty.
  3. **Match now (best-effort):** resolve `target` against the current snapshot → (a) immediate feedback
     (matched yes/no) + (b) reject STRUCTURALLY-impossible targets. **A "no match now" is NOT a hard
     refusal** (content may appear before compaction settles). Refuse ONLY if the target can never match.
  4. `pi.appendEntry("mulligan:shrink", { schema, v:1, kind:"shrink", id, target, replacement, reason, seq, ts })`
     — via `appendShrinkMarker` (stamps envelope + id + seq + ts).
  5. Return feedback text.

- **SHRINK_DESC (spec/05 §5, VERBATIM — Mode A LLM-facing docs):**
  `"Replace a specific past tool result with a compact summary you provide, in your view, going forward. Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in context (just with your summary as its result)."`

- **registerTool shape (spec/05 §5):**
  `{ name:"mulligan_shrink", label:"Mulligan Shrink", description: SHRINK_DESC, parameters: ShrinkParams, execute: shrinkExecute }`

## 2. Consumed module contracts (ALL DONE — import, do NOT reimplement)

### markers.ts — `appendShrinkMarker` + `ShrinkMarkerInput` (FROZEN, shipped, 41 markers tests green)
```ts
export type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | { by_content_includes: string };

export interface ShrinkMarker extends MulliganEnvelope {
  kind: "shrink"; id: string; target: ShrinkTarget; replacement: string;
  reason?: string; seq: number; ts: number;
}
export type ShrinkMarkerInput = Omit<ShrinkMarker, "schema" | "v" | "kind" | "id" | "seq" | "ts">;
//   === { target: ShrinkTarget; replacement: string; reason?: string }

export function appendShrinkMarker(pi, ctx, data: ShrinkMarkerInput): string | null;
//   - stamps {schema:'pi-mulligan', v:1, kind:'shrink', id: randomUUID(), seq: nextSeq(sessionId), ts: Date.now()} onto {...data}
//   - pi.appendEntry("mulligan:shrink", entry); returns ctx.sessionManager.getLeafId() (or null)
//   - NEVER throws (whole body try/catch → null). Returns the ENTRY id (getLeafId), NOT the marker.uuid `id`.
```
**KEY (vs rewind):** `ShrinkMarkerInput` has EXACTLY `{target, replacement, reason}`. There is NO field
the tool must add that the frozen type omits → **NO CAST is needed** (this is the single biggest difference
from the rewind tool's `checkpoint` gotcha — shrink has no such gotcha). `appendShrinkMarker` returns the
leaf/entry id (may be null when append threw or no leaf) — pass it through to `details.markerId`.

Shrink does **NOT** call `leaveNote` (no note — shrink substitutes content, it does not shed a span + leave
a note). Shrink does **NOT** use `appendRewindMarker`/`setCheckpoint`/`appendTurnMetric`.

### transforms.ts — `resolveShrinkTarget` (pure, Pi-FREE; 132 transforms tests green)
```ts
export function resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null;
```
- **by_tool_call_id:** FIRST toolResult whose `.toolCallId === id` (unique → ≤1); else null. Requires
  `callId.length > 0` (empty string → this arm is SKIPPED → falls through).
- **by_tool_name + occurrence:** among toolResults with `.toolName === name`: `occurrence:"first"` → first
  index; anything else (incl. "last"/missing) → LAST index; else null. Requires `name.length > 0`.
- **by_content_includes:** FIRST message (ANY role — E19) whose stringified content includes the substring
  (string content verbatim; array content → JSON.stringify). NOTE: this arm has NO length check → an EMPTY
  needle matches the FIRST message (every string includes ""). ← degenerate, must be refused by the tool.
- The FIRST present non-empty-string discriminator decides the variant; a target with no recognizable
  discriminator → null. **Pure + defensive: never throws** (isRecord/readOwn; non-array messages → null).

### config.ts — `getConfig` + the shrink config surface
```ts
export function getConfig(): MulliganConfig;   // fresh structuredClone EACH call — read once at top of execute
// config.shrink === { enabled: boolean }   ← THE ONLY shrink knob (no maxDepth, no threshold, nothing else)
// config.enabled === the EXTENSION master switch
```
Spec/05 §2 step 1 gates on `config.shrink.enabled` specifically (mirror rewind gating on `config.rewind.enabled`).
For belt-and-suspenders you MAY also short-circuit on `!config.enabled`, but the named gate is `config.shrink.enabled`.

## 3. The Pi tool shape (api_verification.md §8 — VERIFIED against dist)

```ts
interface ToolDefinition<TParams, TDetails, TState> {
  name; label; description; parameters: TParams;
  execute(toolCallId: string, params, signal, onUpdate, ctx): Promise<AgentToolResult<TDetails>>;
}
interface AgentToolResult<TDetails = unknown> {
  content: (TextContent | ImageContent)[];
  details?: TDetails;   // the .d.ts shows OPTIONAL, but checkpoint.ts + rewind.ts (the patterns to mirror)
  isError?: boolean;     //   INCLUDE `details` on EVERY return path. Follow the house convention: always include it.
  usage?: Usage;
}
```
- **execute signature:** `(toolCallId, params, signal, onUpdate, ctx)` — toolCallId is FIRST.
- **`pi` is NOT an execute arg** → capture via `makeShrinkTool(pi)` factory closure (checkpoint.ts precedent).
- **Shrink does NOT use `toolCallId`** (the target is explicit: by_tool_call_id/by_tool_name/by_content_includes;
  there is no "self-exclude" concept). Name the first arg `_toolCallId` (checkpoint.ts precedent for unused args).

## 4. The best-effort match snapshot (the ONE place a tool reads entries — read-only, never transforms live ctx)

Spec/05 §2 step 3 + the item contract: "convert buildContextEntries() to messages, call resolveShrinkTarget".
```ts
const entries = ctx.sessionManager.buildContextEntries();          // compaction-aware active-branch snapshot
const messages = entries.flatMap((e) => sessionEntryToContextMessages(e));  // AgentMessage[] ≡ MessageLike[]
const idx = resolveShrinkTarget(messages, params.target);          // pure resolver
const matched = idx !== null;                                       // the yes/no feedback
```
- `sessionEntryToContextMessages` + `SessionEntry` ARE re-exported from the MAIN package
  (`@earendil-works/pi-coding-agent`, dist/index.d.ts line 19 — VERIFIED). Import them directly (no deep import).
- `sessionEntryToContextMessages(SessionMessageEntry)` → `[entry.message]` (a `{type:"message", message:{role,...}}`
  entry yields that message). A toolResult fixture: `{ type:"message", id, parentId, timestamp, message:{ role:"toolResult", toolCallId:"call-A", toolName:"read", content:[{type:"text", text:"..."}] } }`.
- **Wrap the match in try/catch → matched:false** (best-effort; a throwing buildContextEntries/sessionEntryToContextMessages
  must NEVER block a legitimate shrink — E13). The match is ADVISORY feedback only; the AUTHORITATIVE substitution
  happens in the filter on the next inference (D7 — record a spec, not indices).
- The snapshot may differ from `event.messages` (the authoritative list the filter uses) and will NOT contain the
  current in-flight shrink call yet. That is FINE and intended.

## 5. "Structurally impossible target" — operationalization (the one design judgment)

Spec/05 §2 step 3 is in tension: "reject obviously-invalid targets (e.g. by_tool_call_id that does not exist anywhere)"
vs. "a no match now is NOT a hard refusal." The item contract resolves it: **refuse ONLY if structurally impossible,
not merely currently-unmatched.** Operationalize "can never match" as: **the present discriminator string is empty
after trim.** Rationale (verified against resolveShrinkTarget internals):
- `{by_tool_call_id:""}` → resolveShrinkTarget skips the arm (length>0 check) → null forever (never matches).
- `{by_tool_name:""}` → same → null forever.
- `{by_content_includes:""}` → degenerate: matches the FIRST message (every string includes "") — unwanted.
- A non-empty-but-currently-unmatched target is NOT refused (compaction-robust; content may appear later).

Helper: read the present discriminator (`by_tool_call_id` → `by_tool_name` → `by_content_includes`, first present),
trim it, refuse if empty. occurrence is typebox-constrained to "last"|"first"; resolveShrinkTarget defaults non-"first"
to "last" → no structural issue, do not validate occurrence.

## 6. What shrink does NOT have (vs the sibling rewind tool — do NOT cargo-cult these)

- ❌ NO note (`leaveNote`/`renderNote`/`validateNote`/`NoteInput`). Shrink substitutes content; it does not shed a span + leave a note.
- ❌ NO depth guard. `config.shrink` has only `enabled` (no `maxDepth`). Spec/05 §2 has no depth step.
- ❌ NO checkpoint concept. No `getEntries()` label scan.
- ❌ NO `excludeToolCallId`. The target is explicit; `_toolCallId` is unused.
- ❌ NO mutation warning / NO FileLedger / NO `extractFileLedger`. Shrink does not remove a span of work; it swaps content.
- ❌ NO cast at the `appendShrinkMarker` call site. `ShrinkMarkerInput` already matches the payload exactly.

## 7. The canonical pattern to mirror: src/tools/checkpoint.ts (+ test/tools/checkpoint.test.ts)

`makeShrinkTool(pi)` factory-closure → `defineTool({name,label,description,parameters,execute})`. execute delegates
to a module-private `shrinkExecute(pi, _toolCallId, params, _signal, _onUpdate, ctx)`. Whole body in ONE try/catch
(E13 — never throws; return a refusal text on any exception). `refusal(reason)` builder returns
`{ content:[{type:"text", text:`Mulligan: refused — ${reason}`}], details: {...} }`. `details` present on every path.
Exports: `ShrinkParams`, `ShrinkArgs`, `SHRINK_DESC`, `ShrinkDetails`, `makeShrinkTool`.

## 8. Test idiom (test/tools/checkpoint.test.ts + test/markers.test.ts — hand-rolled fakes, no vi.fn())

- `beforeEach/afterEach(() => clearAll())` (runtime.ts seq is module-scoped; mirror sibling tests for hygiene —
  shrink itself doesn't call nextSeq, but appendShrinkMarker does).
- `makePi({throwOnAppend?})` from markers.test.ts: captures `{customType, data}[]` via `appended` (appendShrinkMarker
  calls pi.appendEntry). shrink does NOT call sendMessage/setLabel, so a trimmed makePi (appendEntry only) suffices.
- `makeCtx({sessionId?, leafId?, entries?, throwOnBuildContextEntries?})`: scripts `getSessionId`, `getLeafId`
  (appendShrinkMarker reads both), AND `buildContextEntries` (the shrink tool's snapshot source). The entries
  flatten via the REAL `sessionEntryToContextMessages` → assert matched yes/no against scripted toolResult fixtures.
- Fixture helper: `msgEntry(role, extra)` → `{ type:"message", id, parentId:null, timestamp, message:{role,...extra} } as unknown as SessionEntry`.
- `run(pi, ctx, params)` → `makeShrinkTool(pi).execute("call-1", params, undefined, undefined, ctx)`.
- `firstText(res)` helper (narrow content[0] to text). `expectTypeOf` for ToolDefinition/AgentToolResult types.

## 9. Key spec edge cases that touch shrink (spec/08)

- **E8** (marker targets nothing/compacted) → resolver returns null → no-op for that fire, retried next fire.
  THIS is why the tool does NOT refuse on "matched: no" — the marker persists and the filter keeps trying.
- **E13** (tool throws internally) → whole execute body in try/catch → text result describing the failure.
- **E14** (extension disabled) → tools refuse with "Mulligan is disabled" framing (shrink: "shrink is disabled").
- **E17** (two shrinks same target) → applied in seq order, last wins — the FILTER's concern, NOT the tool's.
  The tool just persists its marker; it does not dedup.
- **E19** (shrink target is a non-toolResult message) → applyShrink preserves role. The TOOL does not restrict
  by role (by_content_includes may match a non-toolResult); the description steers the agent toward tool results.

## 10. Verified baseline commands
- `npx tsc --noEmit -p tsconfig.json` → exit 0 (today).
- `npx vitest run` → 436 passed, 10 files (config 22, markers 41, filter 17, log 15, tokens 51, transforms 132,
  tools/checkpoint 29, + ledger/notes/runtime/transforms others). Adding shrink.ts (1 src + 1 test) must keep all green.
- This repo uses `tsc` (strict) for typecheck + `vitest` for tests. NO ruff/mypy (those are Python template leftovers).