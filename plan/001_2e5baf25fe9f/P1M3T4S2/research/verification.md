# Research & Verification — P1.M3.T4.S2 (`resolveShrinkTarget` + `applyShrink`)

> Companion to `../PRP.md`. Captures the spec extracts, design decisions, and live-state proof that make this
> PRP one-pass implementable. **This is the SHRINK half of the `transforms.ts` build** (spec/11 §2 Step 3): it
> ships `ShrinkTarget` + `resolveShrinkTarget` + `applyShrink` — the pure content-substitution transforms that
> `filterPipeline` (T5.S1) consumes as `messages = applyShrinkSafe(messages, m)` per shrink marker (spec/06 §1 L24,
> §12). It is the SIBLING of `applyRewind` (T4.S1, landing in parallel).

---

## 1. Live-state proof (verified this session)

| Check | Command | Result |
|---|---|---|
| `transforms.ts` is Pi-free | `grep -c '^import' src/transforms.ts` | **0** ✅ |
| `transforms.ts` size | `wc -l src/transforms.ts` | **533 lines** |
| `applyRewind` present? | `grep -n applyRewind src/transforms.ts` | NOT YET (only in JSDoc comments — T4.S1 lands it in parallel; treat as a CONTRACT) |
| `applyShrink`/`resolveShrinkTarget`/`ShrinkTarget` present? | grep | **none** (this task APPENDS them) |
| Test file size | `wc -l test/transforms.test.ts` | **883 lines** |
| Current test import line (L2) | `head -2 test/transforms.test.ts` | `import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint, type Unit, type MessageLike, type BranchEntry } from "../src/transforms.js";` |
| Transforms suite | `npx vitest run test/transforms.test.ts` | **84 passed** ✅ |
| Full suite | `npx vitest run` | **371 passed (9 files)** ✅ |
| `markers.ts` already exports `ShrinkTarget`/`ShrinkMarker` | `grep` | **YES** (persistence layer, Pi-coupled) |

**Parallel-contract dependency (P1.M3.T4.S1):** The sibling task `applyRewind` is landing in parallel. Its PRP
states it will (a) APPEND `applyRewind` to the END of `src/transforms.ts` (after `isContextProducingType`), and
(b) EDIT the test import line to add `applyRewind` (after `resolveCheckpoint,`). **This task assumes both have
landed.** This task APPENDS its symbols AFTER `applyRewind` and edits the import line to add `applyShrink,
resolveShrinkTarget, type ShrinkTarget`. If the executor sees `applyRewind` not yet present, it should still
append its own symbols at the file tail and add its own import tokens (order within the import destructure is
immaterial — all symbols must simply be present).

**Symbols already in module scope (REUSE — do NOT redefine/import):** `MessageLike` (exported interface, L~53),
`Unit` (exported), `ContentBlock` (module-private type alias), `isRecord` + `readOwn` (module-private defensive
helpers), `partitionIntoUnits`, `resolveLastToolCallGroup`, `resolveLastTurn`, `resolveCheckpoint`,
`assistantIssuedCall`, `isMulliganCustomMessage`, `entryMessageYield`, `isContextProducingType`. After T4.S1
lands: `applyRewind` (exported) joins them.

---

## 2. Spec extracts (the authoritative contract)

### spec/06-context-filter.md §5 (L119-145) — THE shrink algorithm
```ts
function resolveShrinkTarget(messages: AgentMessage[], target: ShrinkTarget): number | null
// - by_tool_call_id: return index of the ToolResultMessage with toolCallId === id, else null.
// - by_tool_name + occurrence: among ToolResultMessages with toolName === name, return last (or first) index, else null.
// - by_content_includes: return index of the first message whose stringified content includes the substring, else null.

function applyShrink(messages: AgentMessage[], marker: ShrinkMarker): AgentMessage[] {
  const i = resolveShrinkTarget(messages, marker.target);
  if (i === null) return messages;                 // no match this fire → no-op (retry next fire)
  const orig = messages[i];
  const replacement: AgentMessage =
    orig.role === "toolResult"
      ? { ...orig, content: [{ type: "text", text: marker.replacement }] }   // preserve role/toolCallId/toolName/isError
      : { ...orig, content: [{ type: "text", text: marker.replacement }] };  // generic message: replace content, keep role
  return messages.map((m, j) => (j === i ? replacement : m));
}
// Multiple shrinks on the same target: applied in seq order, so the last one wins.
// Shrink after rewind: if a rewind already removed the target message, the shrink no-ops (resolve returns null).
// Pairing: shrink preserves toolCallId/role, so pairing is untouched. Safe.
```
**Key reading:** the §5:136-138 ternary has **IDENTICAL branches** (both `{...orig, content:[...]}`) — only the
*comment* differs (what is "preserved"). Functionally it is ONE expression: spread orig (preserves every field),
override content. Written as a single expression in the PRP (DRY) with the preserved-fields intent documented.

### spec/10-testing.md §1.5 (L32-35) — the 3 PINNED tier-1 tests
- `by_tool_call_id` match → content replaced, `role/toolCallId/toolName/isError` preserved.
- No match → input unchanged (no-op).
- Two shrinks same target, seq order → last wins.

### spec/08-edge-cases.md
- **E17 (L84-86):** two `mulligan:shrink` markers match the same target → applied in seq order; **last wins**
  (its replacement is what's seen). Deterministic.
- **E19 (L92-94):** `by_content_includes` matches a user/assistant/custom message (not a tool result) →
  `applyShrink` replaces `content` but **preserves `role`**. No special handling beyond role preservation. Pairing
  unaffected since it's not a toolResult.
- **E13 (the universal never-throws rule):** every transform sits on the `context`-handler hot path via
  `filterPipeline` → must NEVER throw (fail-open). All field reads go through `isRecord`/`readOwn`.

### spec/04-data-model.md §4 (L142-167) — the persisted marker + matching semantics
```ts
type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | { by_content_includes: string };
interface ShrinkMarker extends MulliganEnvelope {
  kind: "shrink"; id: string; target: ShrinkTarget; replacement: string; reason?: string; seq: number; ts: number;
}
```
"Matching semantics: targets resolve against the **current** `event.messages` each inference
(**compaction-robust**). If multiple markers match the same target, the **last** one wins. If a target matches
nothing (already removed/compacted), the marker is a no-op for that inference (silently retried next inference)."

### spec/06 §1 (L9-42) — where applyShrink sits in the pipeline
```ts
// 2) shrinks, oldest-first
for (const m of stableSortBySeq(markers.shrinks)) {
  messages = applyShrinkSafe(messages, m);   // filter.ts wraps applyShrink (this fn) — pure tier
}
```
Shrinks run AFTER rewinds, oldest-first by `seq`. Each `applyShrink` re-resolves against the CURRENT (already-
rewound) message list → composition is correct by construction. `applyShrinkSafe` is filter.ts's wrapping name
(P1.M4.T2); the PURE function this task exports is `applyShrink`.

---

## 3. Design decisions

### D1 — Declare `ShrinkTarget` LOCALLY in `transforms.ts` (do NOT import from markers.ts)
`markers.ts` already exports `ShrinkTarget`, but `markers.ts` imports Pi (`ExtensionAPI`/`ExtensionContext`).
Importing `ShrinkTarget` from `markers.ts` into `transforms.ts` would make `grep -c '^import'` > 0, **breaking the
Pi-free invariant** that ALL four landed siblings + the foundational JSDoc enforce. Solution: declare a
**structural `ShrinkTarget`** in `transforms.ts` (identical shape). A real `markers.ts` `ShrinkMarker.target`
assigns to it with **no cast** (structural typing). **This is exactly the `MessageLike` convention** —
`transforms.ts` defines its OWN local structural `MessageLike` instead of importing `AgentMessage` from Pi.

### D2 — `applyShrink` marker param is a STRUCTURAL `{target, replacement}`, not `ShrinkMarker`
The item contract: `applyShrink(messages, marker: {target: ShrinkTarget, replacement: string})`. Using the full
`ShrinkMarker` would require importing from `markers.ts` (breaks Pi-free — see D1). The structural type names ONLY
the two fields `applyShrink` reads (`target`, `replacement`). A real `ShrinkMarker` (which has those + `id`/`seq`/
`ts`/`reason`/`kind`/`schema`/`v`) assigns in with **no cast** — excess-property checks do not apply to non-literal
object assignments, so `filterPipeline` passing a real `ShrinkMarker` is type-safe.

### D3 — `by_content_includes` stringification = `stringifyContent` helper
Spec says "stringified content" (§5 L128). Deterministic rule: string content → verbatim; array content (content
blocks) → `JSON.stringify` (so `text` fields are searchable, e.g. `[{"type":"text","text":"ENOSPC at /disk"}]`
includes `"ENOSPC"`); anything else (undefined / throwing-Proxy / circular) → `""`. Wrapped in try/catch → never
throws. Module-private (not exported).

### D4 — "Last wins" (E17) is achieved NATURALLY by sequential re-resolution
No special last-wins logic inside `applyShrink`. The pipeline calls `applyShrink` once per shrink marker in seq
order (spec/06 §1); each call re-resolves against the CURRENT messages. For `by_tool_call_id` (the canonical
"same target" case), the first shrink's spread **preserved `toolCallId`**, so the second shrink matches the same
message again and overwrites its content → the last replacement survives. The unit test verifies this by chaining
two `applyShrink` calls. (For `by_content_includes`, "same target" means the same substring; if the first
replacement removed the substring, the second legitimately no-ops — also correct.)

### D5 — Throwing-Proxy safety on the MATCHED message's spread (E13)
`applyShrink` is the FIRST transform that CLONES a message (`{...orig}`). A throwing-Proxy `orig` with a
non-empty target + throwing `get`-trap would make `{...orig}` throw. (The suite's existing throwing-Proxy fixtures
use `new Proxy({}, {get(){throw}})` — empty target → 0 own keys → spread reads nothing → no throw. But a
non-empty-target throwing-Proxy WOULD throw.) To guarantee E13 (never throws) for ALL Proxy variants: read `role`
via `readOwn` FIRST (safe), then wrap the `{...orig}` spread in `try/catch` with a minimal fallback
(`{role, content}`) built only from the safely-read `role`. The fallback never throws and preserves role (the
E19 guarantee); it may drop other fields, but it only fires on pathological inputs that never occur with real Pi
messages — its sole purpose is to never break the turn (fail-open).

### D6 — `by_tool_name` occurrence default = "last" (defensive)
The `ShrinkTarget` type REQUIRES `occurrence: "last" | "first"`, but `readOwn` returns it as `unknown`.
Defensive rule: `wantFirst = occurrence === "first"`; anything else (missing/invalid/"middle") → **last** (the
spec's primary example and the "most-recent bloated result" intent). Deterministic.

### D7 — `by_content_includes` empty-needle semantics
`"".includes("")` and `"anything".includes("")` are both `true` (JS). So an empty `by_content_includes` needle
matches index 0 (the first message). This is spec-faithful (the type allows empty strings) and deterministic. NOT
guarded out — documented as an edge case. (Real markers carry real substrings; this only matters for a malformed
marker, which is harmless — it substitutes message 0's content, a no-op-ish but non-crashing outcome.)

### D8 — No-op paths return `messages` SAME reference (spec §5:133)
`resolveShrinkTarget` returns null → `applyShrink` returns `messages` **unchanged (same reference)**. This is the
spec's own pattern (`if (i === null) return messages;` §5:133) and matches the `applyRewind` precedent (T4.S1:
empty `remove` → same ref). Asserted with `toBe(messages)`. Safe for the `rt.lastFiltered` cache +
`mulligan_audit` (both are content consumers). Non-array `messages` → `[]` (mirrors `applyRewind`/
`partitionIntoUnits`, NOT same-ref — a non-array input is genuinely invalid).

---

## 4. Naming / divergence notes (do NOT be fooled)

- **`applyShrink` vs `applyShrinkSafe`:** the PURE function this task exports is **`applyShrink`**. The spec/06 §1
  pipeline pseudocode writes `applyShrinkSafe` (the filter.ts WRAPPER that catches + fail-opens, P1.M4.T2). The
  spec/06 §5 + §10 §1.5 + this task all use the canonical pure name **`applyShrink`**. (Same kind of wrapper/pure
  split as `applyRewind`/`applyRewindSafe` in T4.S1.)
- **`ShrinkTarget` is declared LOCALLY** in `transforms.ts` (D1), structurally identical to `markers.ts`'s export.
  The test file imports `type ShrinkTarget` from `../src/transforms.js` (the pure-tier copy).
- **`marker: {target, replacement}`** is structural (D2) — NOT the full `ShrinkMarker`. Do not import ShrinkMarker.
- **External-facing name `AgentMessage[]`** in the task prose = the pure-tier `MessageLike[]` (the local structural
  type). A real Pi `AgentMessage[]` assigns in with no cast.

---

## 5. Validation gates (verified working in this repo)

```bash
npx tsc --noEmit -p tsconfig.json          # exit 0  (type check whole project)
npx vitest run test/transforms.test.ts     # all green (existing 84 + this block; 87+ after)
npx vitest run                             # all green, no regression in any of the 9 suites
grep -c '^import' src/transforms.ts        # → 0   (Pi-free invariant preserved)
```
No linter/formatter configured (no eslint/prettier in package.json) — the gates are `tsc` + `vitest` + the
`grep -c '^import' → 0` invariant. Do NOT invent lint commands.