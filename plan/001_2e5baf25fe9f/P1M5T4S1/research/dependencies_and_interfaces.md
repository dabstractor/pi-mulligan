# Research — Upstream dependencies & exact interfaces for `mulligan_audit`

## Verdict: two upstream deps are NOT yet shipped; build-order-guaranteed to precede this item

`mulligan_audit` (P1.M5.T4.S1 = spec/11 **Step 6 Tools**) hard-imports two helpers that
ship in earlier build-order steps. Confirmed by `rg` over `src/` on 2025-08-07:

| Symbol | Lives in | Status (plan_status) | Used for |
|---|---|---|---|
| `estimateTokens`, `resultBytes`, `MessageLike` | `src/tokens.ts` (P1.M2.T1) | ✅ **COMPLETE** | token + byte measurement |
| `getRuntime`, `SessionRuntime`, `clearAll` | `src/runtime.ts` (P1.M1.T4) | ✅ **COMPLETE** | read `rt.lastFiltered` |
| `getConfig`, `MulliganConfig` | `src/config.ts` (P1.M1.T2) | ✅ **COMPLETE** | `audit.estimateConfidence`, `nudges.bloatThresholdBytes`, `rewind.protectedRoles` |
| `RewindMarker`, `ShrinkMarker`, `TurnMetric` (types) | `src/markers.ts` (P1.M4.T1) | ✅ **COMPLETE** | narrowing readMarkers output |
| **`filterPipeline`** | `src/transforms.ts` (P1.M3.T5.S1) | ⚠️ **PLANNED — not in src yet** | E16 fallback: re-apply transforms on `buildContextEntries()` |
| **`readMarkers`** | `src/filter.ts` (P1.M4.T2.S1) | ⚠️ **RESEARCHING — `src/filter.ts` does not exist** | active-marker summary (rewinds/shrinks/metric) |

**Build-order guarantee (spec/11 §2):** Step 3 (transforms incl. filterPipeline) → Step 5
(filter.ts incl. readMarkers + the writer of `rt.lastFiltered`) → Step 6 (tools incl. audit).
So when the audit item runs, BOTH upstream symbols MUST already be exported. The implementer's
first action is to `rg -n "export function filterPipeline" src/transforms.ts` and
`rg -n "export function readMarkers" src/filter.ts` and STOP if either is missing.

## Exact interfaces to import (verified against shipped src + spec/06)

### 1. `filterPipeline` — from `../transforms.js`
spec/06 §12 pseudocode signature:
```ts
function filterPipeline(messages: AgentMessage[], markers, config, ctx): AgentMessage[]
```
- `messages`: `AgentMessage[]` (= `Record<string,unknown>[]`, runtime.ts opaque alias — a real
  Pi message[] assigns in with no cast).
- `markers`: the `MarkersBundle` returned by `readMarkers(ctx)` (see below). Pass it through verbatim.
- `config`: `MulliganConfig` from `getConfig()`.
- `ctx`: `ExtensionContext` (filterPipeline needs it only for `resolveCheckpoint` label lookups).
- Returns the filtered `AgentMessage[]` (rewinds removed, shrinks substituted, nudge injected).
- NEVER throws (E13 fail-open discipline — it sits on the context hot path).

The audit calls it ONLY on the E16 fallback path (`rt.lastFiltered === null`). On the primary
path the filter already cached its output in `rt.lastFiltered`, so the audit does NOT re-run it
(avoids double work; spec/06 §7).

### 2. `readMarkers` — from `../filter.js`
Confirmed home is `filter.ts` (spec/06 §1 uses it inside the `context` handler; P1.M4.T2.S1
research line 139 names its return `MarkersBundle`). Interface (spec/06 §1 + §7):
```ts
interface MarkersBundle {
  rewinds: RewindMarker[];   // all mulligan:rewind custom entries, in entry order
  shrinks: ShrinkMarker[];   // all mulligan:shrink custom entries, in entry order
  metric: TurnMetric | null; // the LATEST mulligan:turn-metric on the branch (only latest is consulted)
}
function readMarkers(ctx: ExtensionContext): MarkersBundle
```
- It scans `ctx.sessionManager.getEntries()` FRESH each call (C12 — read fresh, never cache a
  sessionManager handle), filters `type === "custom"` && `customType.startsWith("mulligan:")`,
  and casts `data` to the marker interfaces (markers.ts already stamps the envelope).
- It does NOT return checkpoints — checkpoints are `LabelEntry`s (`type === "label"`), not
  custom entries. The audit lists checkpoints via its OWN scan (see report-format note).
- NEVER throws (filter hot path).

> GOTCHA for the implementer: if P1.M4.T2.S1 instead exports `readMarkers` from `../markers.js`,
> import from there. The symbol NAME is stable (`readMarkers`); only the file is in question.
> Verify with `rg -n "export function readMarkers" src/`.

## Why the audit tool needs NO `pi` closure (differs from checkpoint)

The checkpoint tool (P1.M5.T3.S1) needs `pi` because it calls `pi.setLabel`. The audit tool
**persists nothing** and every read goes through `ctx`:
- `ctx.sessionManager.getEntries()` / `buildContextEntries()` / `getSessionId()` (read-only surface)
- `readMarkers(ctx)` — takes ctx, not pi
- `filterPipeline(messages, markers, config, ctx)` — takes ctx, not pi
- `getRuntime(sessionId)` / `getConfig()` / `estimateTokens()` / `resultBytes()` — pure, no pi

CONSEQUENCE: `auditTool` is a **plain `export const`** (no `makeAuditTool(pi)` factory). This is
SIMPLER and more testable than checkpoint — tests call `auditTool.execute("c1", {top}, undefined,
undefined, fakeCtx)` directly. Do NOT introduce a factory or module-scoped `pi`.

## `AgentMessage` type for this module

Reuse `runtime.ts`'s exported `AgentMessage = Record<string, unknown>` alias (the opaque element
type filter.ts also reuses — P1.M4.T2.S1 research line 41). `estimateTokens`/`resultBytes` take
`MessageLike` (tokens.ts) which is structurally compatible. For the report's per-message
introspection (role, toolName, toolCallId, content blocks), read fields defensively via a local
`readOwn` (a throwing-Proxy trap must never crash the audit). `lastFiltered` elements ARE real Pi
messages; the opaque type just hides that from the compiler.

## E16 fallback: `buildContextEntries()` → messages conversion

`buildContextEntries(): SessionEntry[]` returns the active-branch entries WITH compaction applied
(spec/01 §4.2). It returns ENTRIES, not messages. The audit converts best-effort (spec/05 §4 step1,
spec/06 §7, spec/08 E16) and flags confidence `'low'`. Conversion map:

| `entry.type` | → message | rationale |
|---|---|---|
| `"message"` | `entry.message` (the `AgentMessage`, verbatim) | primary message carrier |
| `"custom_message"` | `{ role:"custom", customType, content, display, details, timestamp }` | in-context custom message (mulligan:note etc.) |
| `"compaction"` | `{ role:"system", content: entry.summary }` | best-effort; the summary text is what's estimated |
| `"branch_summary"` | `{ role:"system", content: entry.summary }` | best-effort |
| everything else (`custom`, `label`, `model_change`, `session_info`, …) | **skip** | not message-producing |

Then `filterPipeline(converted, readMarkers(ctx), config, ctx)` re-applies rewinds/shrinks so the
fallback reflects post-rewind reality (spec/05 §4 step1: "Apply the same transforms the filter
would"). Confidence is `'low'` regardless (it's an estimate off entries, not the real view).

Reachability: `rt.lastFiltered === null` iff (a) no `context.fire` has happened this session yet
(agent calls audit as its very first action — spec/08 E16), OR (b) filter.ts not yet wired during
dev. In production with filter.ts wired, only (a) — rare but must not crash.