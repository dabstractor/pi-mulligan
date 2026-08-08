# Research — P1.M6.T1.S1: tool_result bloat annotator + bloat hit recording

Verified live against the installed `node_modules` + the COMPLETE upstream modules. All signatures below
are quoted from the actual `.d.ts` / `.ts` files (not spec prose). Build baseline confirmed: `npx tsc
--noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 9 test files all-green.

## 1. The Pi `tool_result` event contract (VERIFIED against types.d.ts)

`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`:

```ts
// line 862
export type ExtensionHandler<E, R = undefined> =
  (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;

// line 897  (the EXACT overload this task registers on)
on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;

// line 691 — ToolResultEventBase (base for all variants)
interface ToolResultEventBase {
  type: "tool_result";
  toolCallId: string;
  input: Record<string, unknown>;
  content: (TextContent | ImageContent)[];   // ALWAYS an array (non-optional)
  isError: boolean;
  usage?: Usage;
}
// Every variant ADDS `toolName` (always present on the union):
//   BashToolResultEvent.toolName: "bash"; ReadToolResultEvent.toolName: "read"; ...
//   CustomToolResultEvent.toolName: string;  (← mulligan_* tools land here)
export type ToolResultEvent = BashToolResultEvent | ReadToolResultEvent | ... | CustomToolResultEvent;
//   ⇒ On the union, `event.toolName` is ALWAYS a string (never undefined).

// line 795
export interface ToolResultEventResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  usage?: Usage;
}
```

**Implications:**
- Handler may be SYNC (`ExtensionHandler` permits `R | void` with no Promise). The spec/07 §1 pseudocode
  shows `async`, but there are zero `await`s here → a sync function is cleaner fail-open (no unhandled
  rejection path) and type-checks identically. Either is valid.
- Returning `{ content: [...existing, block] }` APPENDS to the result; returning nothing (void) is a
  pass-through (result unchanged). api_verification.md §7.2 confirms: "The bloat-reminder nudge returns
  `{ content: [...existing, { type: "text", text: reminder }] }`."
- `event.toolName` is a string on every variant → `event.toolName.startsWith("mulligan_")` is safe with
  NO optional chaining (the spec's `?.` is overly defensive; harmless to keep but not required).
- `event.content` is always a non-empty array in practice; spec uses `[...(event.content ?? [])]`
  defensively — keep the defensive form.

## 2. GOTCHA (CRITICAL): `TextContent`/`ImageContent` are NOT re-exported

Confirmed: `grep TextContent node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.d.ts`
→ NO match. The top-level `dist/index.d.ts` re-export list also omits them. And `@earendil-works/pi-ai`
(the package that defines them) is NOT resolvable from this repo (not hoisted into node_modules).

⇒ Same situation as `AgentMessage` (filter.ts PRP GOTCHA #2): referenced inside the package's `.d.ts` but
NOT importable. **Do NOT write `import type { TextContent } from "@earendil-works/pi-coding-agent"`** —
it will not resolve.

**Solution — indexed-access type + ONE assertion at the new block** (mirrors filter.ts's
single-cast-at-boundary strategy; no need to name `TextContent`):
```ts
import type { ToolResultEvent, ToolResultEventResult, ExtensionAPI, ExtensionContext }
  from "@earendil-works/pi-coding-agent";
// The appended text block. ToolResultEvent["content"][number] == TextContent | ImageContent (exact).
const block: ToolResultEvent["content"][number] = { type: "text", text: reminder };
const content = [...event.content, block];   // type: (TextContent|ImageContent)[]
return { content };                          // assignable to ToolResultEventResult (no cast needed)
```
The single assertion on `block` is sound (it IS a valid text block in practice). The spread of
`event.content` (already `(TextContent|ImageContent)[]`) + the typed `block` yields
`(TextContent|ImageContent)[]` automatically → `return {content}` type-checks with NO boundary cast.

## 3. `log()` takes `sessionId: string`, NOT `ctx` (VERIFIED — src/log.ts line 61)

```ts
export function log(level: "debug"|"info"|"warn"|"error", event: string, sessionId: string, data?: unknown): void
```
The spec/07 §1 pseudocode `log("error", "nudge.bloat", ctx, {...})` is WRONG for this codebase (ctx is not
a string). Pattern (read sessionId first so the catch can log it):
```ts
let sessionId = "";
try {
  sessionId = ctx.sessionManager.getSessionId();   // read FIRST
  ...
} catch (e) {
  log("error", "nudge.bloat", sessionId, { error: String(e) });  // "" if getSessionId threw — log never throws
}
```

## 4. Upstream deps — ALL COMPLETE (verified the source files exist + export the symbols)

| Symbol | Module | Status | Signature |
|---|---|---|---|
| `resultBytes` | src/tokens.ts | ✅ COMPLETE | `resultBytes(content: ResultContentBlock[] \| null \| undefined): number` (UTF-8 bytes; `event.content` assigns in) |
| `approxTokens` | src/tokens.ts | ✅ COMPLETE | `approxTokens(bytes: number): number` (= `Math.ceil(bytes/4)`; `8192→2048`) |
| `renderBloatReminder` | src/notes.ts | ✅ COMPLETE | `renderBloatReminder(_toolName: string, bytes: number, thresholdBytes: number): string` |
| `getRuntime` | src/runtime.ts | ✅ COMPLETE | `getRuntime(sessionId: string): SessionRuntime` (mutable ref) |
| `BloatHit` (type) | src/runtime.ts | ✅ COMPLETE | `{ toolName: string; approxTokens: number }` |
| `SessionRuntime.pendingBloatHits` | src/runtime.ts | ✅ COMPLETE | `BloatHit[]` (mutable; cleared at turn_end by P1.M6.T2.S1) |
| `getConfig` | src/config.ts | ✅ COMPLETE | `getConfig(): MulliganConfig` (defensive clone each call) |
| `log` | src/log.ts | ✅ COMPLETE | `log(level, event, sessionId, data?)` |

`config.nudges.bloatReminder: boolean` (default true), `config.nudges.bloatThresholdBytes: number`
(default 8192), `config.enabled: boolean` (default true) — all in MulliganConfig (config.ts).

## 5. `recordBloatHit` is PSEUDOCODE — there is no helper

spec/07 §1 calls `recordBloatHit(ctx, event.toolName, approxTokens(bytes))` but NO such function exists
or is planned. "Record a bloat hit" == inline mutation of the runtime map (runtime.ts docs: "callers
mutate fields in place"):
```ts
rt.pendingBloatHits.push({ toolName: event.toolName, approxTokens: approxTokens(bytes) });
```
Only THIS task WRITES pendingBloatHits; P1.M6.T2.S1 only READS + clears it. Keep the push inline (matches
the codebase's inline-runtime-mutation style; no new helper needed).

## 6. Canonical module = `src/nudges.ts` (CREATE it here)

spec/11-build-order.md §31: `nudges.ts # tool_result annotator + turn_end metric + shouldNudge/injectNudge`
spec/03-architecture.md §189: `nudges.ts // tool_result annotator + turn_end metric + context nudge injection`

⇒ `nudges.ts` is the home for ALL nudges. **THIS task CREATES `src/nudges.ts` with ONLY
`registerBloatReminder(pi)` + the `tool_result` handler.** P1.M6.T2.S1 APPENDs the `turn_end` metric
handler; P1.M6.T2.S2 APPENDs `shouldNudge`/`injectNudge` (and updates filter.ts to import them, replacing
filter.ts's local stubs — those stubs are filter.ts's concern, NOT this task's).

## 7. `filter.ts` does NOT exist yet — do NOT import from it

filter.ts (P1.M4.T2.S1) is "Ready" (not Complete) and is NOT in `src/`. It contains LOCAL no-op stubs for
shouldNudge/injectNudge. **This task must NOT import shouldNudge/injectNudge from anywhere** (no real impl
exists yet). This task has NO dependency on filter.ts. Deps are config/log/runtime/tokens/notes only — all
COMPLETE. (Parallel item P1.M5.T4.S1 creates src/tools/audit.ts — also no conflict with src/nudges.ts.)

## 8. Test idiom (mirrors test/markers.test.ts — VERIFIED pattern)

- Hand-rolled fakes for Pi objects (NO `vi.fn`): `makePi` capturing `.on(eventName, handler)` calls +
  `appendEntry`/`sendMessage`/`setLabel` captures; `makeCtx` with `getSessionId`.
- `clearAll()` (from runtime.ts) in beforeEach/afterEach — the module-scoped runtime Map must be reset or
  pendingBloatHits leaks across tests (runtime.ts GOTCHA #7; mirror test/markers.test.ts + test/runtime.test.ts).
- Import from `"../src/nudges.js"` (.js resolves to .ts under Bundler — established convention).
- The registered handler is captured via the fake `.on`; tests invoke it directly with synthetic
  ToolResultEvent-shaped objects (no Pi runtime needed).
- No lint/format tool (devDeps = typescript + vitest + @types/node). Gate = `tsc --noEmit` + `vitest run`.

## 9. Fail-open is a HARD guarantee (spec/03 §2.4, spec/08 E13)

The ENTIRE handler body is ONE try/catch. On ANY throw (getConfig, resultBytes, getRuntime,
getSessionId, renderBloatReminder), `log("error", "nudge.bloat", sessionId, {error})` + return nothing
(pass-through). An extension bug must NEVER break a tool result / agent turn. This mirrors markers.ts,
filter.ts, and log.ts discipline.

## 10. Threshold calibration (spec/07 §1)

Default `bloatThresholdBytes = 8192` (8 KB ≈ 2k tokens). Deliberately BELOW Pi's ~50 KB built-in cap to
catch meaningful-but-not-catastrophic results (e.g. a 30 KB `read`). The threshold is in UTF-8 BYTES of
the in-context text representation (resultBytes is multibyte-aware). The reminder is APPENDED (not
replacing) — the agent may need the data now; the hint is about future turns (advisory, D3).