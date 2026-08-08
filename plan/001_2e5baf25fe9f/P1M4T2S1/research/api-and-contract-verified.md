# P1.M4.T2.S1 — Verified API + Contract Research

All signatures below were verified LIVE against the installed Pi type defs at
`/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/` and against the
existing `src/*.ts` modules. This note is the evidence base for the PRP.

---

## 1. The `context` event — VERIFIED (dist/core/extensions/types.d.ts)

```ts
// line 499
export interface ContextEvent { type: "context"; messages: AgentMessage[]; }   // deep copy, safe to mutate
// line 774
export interface ContextEventResult { messages?: AgentMessage[]; }              // messages OPTIONAL → void = pass-through (C4)
// line 862
export type ExtensionHandler<E, R = undefined> =
  (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;
// line 878
on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): void;
```

So `registerFilterHandler(pi)` calls `pi.on("context", handler)` where
`handler: (event: ContextEvent, ctx: ExtensionContext) => ContextEventResult | void`.
Returning `undefined`/`void` = pass-through (C4). Returning `{ messages }` = transform.

`ContextEvent`, `ContextEventResult`, `ExtensionAPI`, `ExtensionContext` ARE all re-exported
from the package root (`dist/index.d.ts` line 7) — import them from
`@earendil-works/pi-coding-agent`.

## 2. `AgentMessage` is NOT exported — VERIFIED GOTCHA

```
grep "AgentMessage" dist/index.d.ts   →  (no matches)
```
The authoritative Pi `AgentMessage` union lives in pi-agent-core and is NOT re-exported by
`@earendil-works/pi-coding-agent`. **You cannot name the element type of `event.messages`.**

This is EXACTLY the situation runtime.ts (P1.M1.T4.S1) already solved: it defines a LOCAL
opaque alias `export type AgentMessage = Record<string, unknown>` and documents "a real Pi
AgentMessage[] is assignable INTO lastFiltered". filter.ts MUST reuse that same alias
(`import type { AgentMessage } from "./runtime.js"`) for the `rt.lastFiltered` cache.

### Type-flow strategy that compiles in ALL cases (whether filterPipeline is generic or not)

Work with the messages value normalized to transforms.ts's exported `MessageLike` type
(`import type { MessageLike } from "./transforms.js"`):

```ts
let messages: MessageLike[] = filterPipeline(event.messages, markers, config, branchEntries);
//   ^^^^^^^^^^^ explicit annotation normalizes the type:
//     - if filterPipeline returns MessageLike[]  → identity
//     - if filterPipeline is generic <M>(...): M[] → PiAgentMessage[] downcasts to MessageLike[] (OK)
// injectNudge stub takes/returns MessageLike[] → stays MessageLike[]
rt.lastFiltered = messages;   // MessageLike[] → (Record<string,unknown>)[] — NO cast (index sig)
return { messages: messages as unknown as NonNullable<ContextEventResult["messages"]> };
//     ^^^ ONE cast at the return boundary (MessageLike[] → Pi's AgentMessage[]); bulletproof
```

Why the storage needs NO cast: `MessageLike` has `[key: string]: unknown`, so a `MessageLike`
is assignable to `Record<string, unknown>` (= runtime's `AgentMessage`). Therefore
`MessageLike[]` → `AgentMessage[]`. ✅ Verified by reasoning; matches runtime.ts's documented
claim.

## 3. ReadonlySessionManager read methods — VERIFIED (dist/core/session-manager.d.ts)

```ts
// line 140 — ReadonlySessionManager = Pick<SessionManager, ...read methods only...>
getSessionId(): string;            // line 207 — never null
getLeafId(): string | null;        // line 239 — CAN be null
getBranch(fromId?: string): SessionEntry[];   // line 261 — leaf→root walk
getEntries(): SessionEntry[];                 // line 281 — ALL entries (every branch), excl. header
```

`SessionEntry` IS re-exported from the package root (dist/index.d.ts line 19). filter.ts MAY
`import type { SessionEntry } from "@earendil-works/pi-coding-agent"` to type `branchEntries`
and the readMarkers entry scan. (C12: read `ctx.sessionManager` FRESH each fire — never cache
the handle.)

### CustomEntry shape (dist/core/session-manager.d.ts, api_verification §5)
```ts
interface CustomEntry<T> extends SessionEntryBase {
  type: "custom";        // ← the discriminator readMarkers filters on
  customType: string;    // ← "mulligan:rewind" | "mulligan:shrink" | "mulligan:turn-metric"
  data?: T;              // ← the FULL marker (envelope stamped in by markers.ts: schema/v/kind/id/seq/ts + payload)
}
```
Key: markers.ts appends via `pi.appendEntry(customType, entry)` where `entry` ALREADY contains
the envelope fields — so `entry.data` IS the complete `RewindMarker | ShrinkMarker | TurnMetric`.
readMarkers just casts `data`. The `mulligan:note` is a `custom_message` entry (type
`"custom_message"`, IN context) — readMarkers filters on `type === "custom"`, so it is correctly
IGNORED. Checkpoints are `label` entries — also correctly ignored.

## 4. `log()` takes `sessionId`, NOT `ctx` — VERIFIED GOTCHA (src/log.ts)

```ts
// src/log.ts line 61 — VERIFIED
export function log(level: Level, event: string, sessionId: string, data?: unknown): void;
// Level = "debug" | "info" | "warn" | "error"   (src/log.ts line 18)
```

**The spec/06 §1 pseudocode writes `log("error", "filter.fire", ctx, {...})` — that is WRONG.**
The real `log()` takes `sessionId: string` (3rd arg). filter.ts already has `sessionId` (from
`ctx.sessionManager.getSessionId()`), so call `log("error", "filter.fire", sessionId, { error:
String(e) })`. log() NEVER throws (swallows; spec/03 #4) — wrapping it in its own try/catch is
belt-and-suspenders, not required.

## 5. `estimateTokens()` — VERIFIED (src/tokens.ts line 114)

```ts
export function estimateTokens(messages: MessageLike[] | null | undefined, _model?: unknown): TokenEstimate;
// returns { tokens: number; confidence: "low"|"medium"|"high" }; NEVER throws
```
tokens.ts has its OWN `MessageLike` (line 61, structurally identical to transforms.ts's). Passing
transforms `MessageLike[]` is structurally fine. Used ONLY for an optional defensive observability
log line (never in the hot logic (a)–(h)); the item's explicit LOGIC does not require it.

## 6. filterPipeline contract — NONE EXISTS YET (I OWN IT)

- `grep filterPipeline plan/.../architecture/` → only function-NAME mentions in system_context.md
  (lines 68/93/136); NO signature.
- No `P1M3T5*` plan directory exists (P1.M3.T5.S1 is still "Planned", not yet researched/implemented).
- transforms.ts is Pi-FREE ("Imports NOTHING — not Pi"). Therefore filterPipeline CANNOT take
  `ctx: ExtensionContext` (the spec/06 §12 pseudocode `filterPipeline(messages, markers, config,
  ctx)` is aspirational/reference-only). The pure pipeline needs the branch info that
  `resolveCheckpoint` (spec/06 §6) reads from `ctx.sessionManager.getBranch()` — passed in as a
  PLAIN `SessionEntry[]`.

**filterPipeline contract this task consumes (documented in the PRP):**
```ts
filterPipeline(
  messages: MessageLike[],
  markers: { rewinds: RewindMarker[]; shrinks: ShrinkMarker[]; metric: TurnMetric | null },
  config: MulliganConfig,
  branchEntries: SessionEntry[],
): MessageLike[]
```
P1.M3.T5.S1 implements this in transforms.ts (importing the marker types type-only from
markers.js — they are Pi-free interfaces). TS structural typing makes filter.ts's `MarkersBundle`
assignable to filterPipeline's `markers` param with ZERO shared-type coordination.

**HARD PREREQUISITE:** filter.ts statically imports `filterPipeline` from "./transforms.js". If
P1.M3.T5.S1 is NOT yet implemented, `tsc` fails on the import. This task MUST be implemented
AFTER P1.M3.T5.S1 (dependency order). Stated as a banner in the PRP.

## 7. shouldNudge / injectNudge — stub contract (spec/07 §2)

Eventual real signatures (nudges.ts, P1.M6.T2.S2):
```ts
shouldNudge(metric: TurnMetric, config: MulliganConfig): boolean   // = metric.grewOverThreshold || metric.bloatHit
injectNudge(messages: AgentMessage[], metric: TurnMetric): AgentMessage[]   // appends ephemeral mulligan:nudge CustomMessage
```
This task ships LOCAL no-op stubs in filter.ts (shouldNudge → false; injectNudge → messages
unchanged) so the wiring compiles now. P1.M6.T2.S2 will replace them with imports from nudges.ts.

## 8. The looper-smoke proof pattern (spec/reference/looper-smoke.proto.ts) — mirror for fakes

```ts
pi.on("context", async (event, ctx) => {
  try {
    const msgs = event.messages as any[];
    const entries = ctx.sessionManager.getEntries();
    const hasMarker = entries.some((e) => e.type === "custom" && e.customType === "looper_rewind_marker");
    if (hasMarker && canaryIdx >= 0) {
      const filtered = msgs.filter((_, i) => i !== canaryIdx);
      return { messages: filtered };
    }
  } catch (e) { log("context.fire", "fail", { error: String(e) }); }
});
```
This PROVES: (a) `event.messages` is the deep-copied array; (b) `ctx.sessionManager.getEntries()`
returns the custom entries; (c) returning `{ messages }` transforms; (d) returning nothing /
throwing → pass-through. The unit-test fakes mirror this with hand-rolled objects.

## 9. Baseline (verified before writing)

- `npx tsc --noEmit -p tsconfig.json` → exit 0 (current src/* compiles).
- src/markers.ts ships the three `append*` wrappers + leaveNote + setCheckpoint + the marker
  interfaces (RewindMarker/ShrinkMarker/TurnMetric/MulliganEnvelope). filter.ts imports the
  marker INTERFACES (type-only) from markers.js.
- src/runtime.ts exports `getRuntime`, `AgentMessage` (opaque alias), `SessionRuntime`.
- src/config.ts exports `getConfig`, `MulliganConfig`. src/log.ts exports `log`, `Level`.
- src/transforms.ts exports `MessageLike`, `partitionIntoUnits`, `resolveLastToolCallGroup` — NOT
  yet `filterPipeline` (P1.M3.T5.S1).
- tsconfig: strict, noUnusedParameters NOT set, target ES2022, moduleResolution Bundler → test
  imports use `.js` extension resolving to `.ts` (convention).
- devDeps = typescript + vitest + @types/node ONLY. NO eslint/prettier/biome. Type+style gate =
  `tsc --noEmit`.