# Research Notes — P1.M3.T4.S1 `applyRewind`

Subject: `applyRewind(messages: MessageLike[], remove: number[]): MessageLike[]` — the pure gap-closing
index-removal helper (spec/06 §3, §4, §12). The DUMB half of rewind application: the resolvers
(`resolveLastToolCallGroup`, `resolveLastTurn`, `resolveCheckpoint`) compute unit-aware `remove` index sets;
`applyRewind` filters those indices out and closes the gap.

## 1. Verified current state of the two target files (live, post parallel-PRP landing)

The parallel item **P1.M3.T3.S1 (`resolveCheckpoint`) has LANDED.** When this item is implemented, the
starting state is:

`src/transforms.ts` (533 lines, `grep -c '^import'` → **0**, Pi-free) exports, in order:
`MessageLike` (L53), `Unit` (L71), `partitionIntoUnits` (L109), `resolveLastToolCallGroup` (L223),
`resolveLastTurn` (L319), `BranchEntry` (L394), `resolveCheckpoint` (L450); module-private helpers
`isRecord`/`readOwn`/`assistantIssuedCall`/`isMulliganCustomMessage`/`entryMessageYield`/
`isContextProducingType`. **Last symbol in the file = `isContextProducingType`** (the tail) → `applyRewind`
APPENDS here.

`test/transforms.test.ts` import line (L2, CURRENT verbatim):
```ts
import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint, type Unit, type MessageLike, type BranchEntry } from "../src/transforms.js";
```
Last `describe` block = `resolveCheckpoint — …` (appended by S3). `applyRewind`'s block APPENDS here.

Baseline (verified green this session): `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run
test/transforms.test.ts` → **84 passed**.

## 2. No existing stub/usage (greenfield)

Subagent scout (`da95179f`, read-only) confirmed: **no definition, stub, or runtime usage** of
`applyRewind`, `removeIndices`, or `applyRewindSafe` exists in `src/` or `test/`. All occurrences are JSDoc
comments (e.g. `src/transforms.ts:15,25,69,202,211,245,249`) and spec/plan prose. Three distinct names to
keep apart:

- **`applyRewind(messages, remove)`** ← THIS TASK. The pure gap-closer (low-level).
- **`removeIndices`** — the §12 pipeline *pseudocode*'s placeholder name for the SAME call
  (`spec/06-context-filter.md:254` `m = removeIndices(m, remove);`). Reference-only divergence (same kind as
  the `u ? u.indices : []` divergence already noted at `src/transforms.ts:210`). Implement/export as
  **`applyRewind`**; `filterPipeline` (T5.S1) writes `m = applyRewind(m, remove)`.
- **`applyRewindSafe(messages, marker, config, ctx)`** — a DIFFERENT, higher-level *config-aware wrapper*
  from the §1 handler glue sketch (`spec/06:21`), NOT in scope, NOT built here. Lives in `filter.ts` (P1.M4).

## 3. The single call site & the type at that point

`spec/06 §12` pipeline (the authoritative consumer contract), inside
`for (const rw of stableSortBySeq(markers.rewinds))`:
```
let remove: number[];                       // L243
... remove = u ? u.indices : [];            // L246  last_tool_call_group (a Unit's indices, or [])
... remove = resolveLastTurn(...).remove;   // L248  last_turn (number[])
... remove = res ? res.remove : [];         // L251  checkpoint (number[], or [] on null)
if (!protectedOk(m, remove, config)) { ... continue; }   // L253  guard is UPSTREAM
m = removeIndices(m, remove);               // L254  ← becomes m = applyRewind(m, remove)
```
**`remove` is always a `number[]`** (possibly empty). The `protectedOk` guard (L253) runs BEFORE
`applyRewind` and `continue`s on failure, so `applyRewind` is never reached on a protected-miss; it IS
reached with `remove = []` whenever a resolver returns null/empty/no-op. That empty path is the documented
idempotent no-op (spec/10 §1.4). **`applyRewind` does NOT take config, NOT take a marker, NOT call
protectedOk, NOT call a resolver** — all upstream. It is a pure function of `(messages, remove)`.

## 4. Design decisions (LOCKED, scout-verified)

- **Signature:** `export function applyRewind(messages: MessageLike[], remove: number[]): MessageLike[]`.
  Use the **local `MessageLike[]`** (NOT `AgentMessage[]`) — `transforms.ts` is Pi-FREE (0 imports); all 4
  shipped siblings use `MessageLike` (`src/transforms.ts:53`). A real `AgentMessage[]` assigns in with no
  cast. (Task prose says `AgentMessage[]`; that is the external-facing type, `MessageLike[]` is the
  module-internal structural twin — GOTCHA G3.)
- **Param name `remove: number[]`** (matches `spec/06:254` + the task; spec/03:65 `range` is the older
  name — GOTCHA G5).
- **Empty/non-array `remove` ⇒ return `messages` UNCHANGED (same reference).** Confirmed safe + preferred:
  - applyShrink already does exactly this (`spec/06:133` `if (i === null) return messages;`).
  - `rt.lastFiltered` cache + `mulligan_audit` are CONTENT consumers (§7) — never compare references.
  - Same-reference is the idempotent optimum (strengthened referential transparency).
  - spec/10 §1.4 phrasing is "input unchanged (idempotent)" (content wording) — same-reference satisfies it.
- **Non-array `messages` ⇒ return `[]`** (defensive; mirrors `partitionIntoUnits` L113's
  `Array.isArray(messages) ? messages : []`). The function must be TOTAL (E13; hot path).
- **Build a `Set<number>`** from `remove`'s numeric entries; non-numbers / out-of-range / negatives never
  match a valid array index ⇒ harmless (the resolvers never emit those, but stay total). If the Set ends up
  empty (e.g. `remove = [NaN, "x"]`) ⇒ return `messages` unchanged.
- **Filter & close the gap:** `return messages.filter((_msg, i) => !removeSet.has(i));`. `Array.filter`
  yields a contiguous new array (gap closed). **The callback IGNORES the element** (`_msg`) — so a
  throwing-Proxy message element's get-trap NEVER fires ⇒ `applyRewind` NEVER throws on malformed/proxy
  messages even though it uses no `isRecord`/`readOwn`. This is the ONE transform that touches no message
  internals ⇒ trivially safe vs the siblings.
- **Pairing is preserved BY CONSTRUCTION** because the caller already computed unit-aware ranges (a toolGroup
  is removed as `[assistant, ...results]` — both sides go together, never orphaning either). `applyRewind`
  itself does NOT re-verify pairing (it cannot — it only sees indices, not content). spec/06 §3/§4 define
  `applyRewind for this granularity = remove the resolved unit's indices (then close the gap)`.
- **No mutation of input** — `Array.filter` returns a new array; the empty path returns the (unmuted) same ref.
- **NO new imports.** Reuses only `MessageLike` (in module scope). `grep -c '^import' src/transforms.ts`
  stays **0**.

## 5. GOTCHA G1 — the spec/06 §11 example is INTERNALLY INCONSISTENT (scout proven)

`spec/06:224-225` states, for two sequential `last_tool_call_group` rewinds:
```
rewind#1: resolve last toolGroup excluding res3's call → the a2/r2 unit (the read). Remove → [u0,a1,r1,a3,res3,note,a4,res4]
rewind#2: resolve last toolGroup excluding res4's call → the a1/r1 unit (the grep). Remove → [u0,a3,res3,note,a4,res4]
```
Traced against the ACTUAL `resolveLastToolCallGroup` (`src/transforms.ts:223`, walk end→start, skip ONLY the
unit whose assistant issued `excludeToolCallId`): rewind#1's single `excludeToolCallId` (= a3's call @idx5)
skips only `{5,6}` (a3+res3); the LAST toolGroup `{8,9}` (a4+res4) is NOT skipped ⇒ target should be `{8,9}`,
NOT `{3,4}` (a2/r2) as the spec claims. **The stated per-rewind targets and intermediate arrays do not follow
from the §3 algorithm.** ⇒ DO NOT copy §11's arrays as a verbatim pipeline-test oracle. For `applyRewind`
the §11 example reduces to the trivial fact `remove=[3,4]` on a 10-elem array → 8 elems (gap closed), which is
correct regardless of §11's targeting bug. **The full-pipeline composition is a T5.S1 (`filterPipeline`)
concern, not this item's.** Test `applyRewind` in isolation + a resolver-composition test whose expected
output is DERIVED by simulating the resolver (not copied from §11).

## 6. Test contract — spec/10 §1.4 (verbatim)
```
### 1.4 `applyRewind`
- Removing a toolGroup unit keeps pairing intact (no orphan results/calls remain).
- Removing `last_turn` keeps the rewind's own unit + mulligan notes at the tail.
- Empty `remove` → input unchanged (idempotent).
```
Expanded coverage (derived): basic removal + gap-close (contiguous & non-contiguous); empty `remove` ⇒ SAME
reference (`toBe`, intentional strengthening per G4); non-array `messages` ⇒ `[]`; non-array `remove` ⇒ same
ref; out-of-range/negative/non-number/duplicate indices in `remove` ⇒ harmless; throwing-Proxy element ⇒ no
throw (filter ignores element); pairing preservation (remove a whole toolGroup's [asst,result], re-partition
the result, assert no orphan toolCall/toolResult — reuse `expectPairingInvariant`); last_turn composition
(`remove = resolveLastTurn(msgs, {}, excludeCallId).remove`; `applyRewind(msgs, remove)` yields tail
`[user] + [mulligan:note] + [rewind asst + result]`); monotonic shrinkage (`out.length <= in.length`);
purity (input not mutated); return type `MessageLike[]` (`expectTypeOf`).

## 7. Validation gates (verified executable this session)
- `npx tsc --noEmit -p tsconfig.json` → exit 0 (baseline green).
- `npx vitest run test/transforms.test.ts` → all green (baseline 84 tests; this item ADDS a new block).
- `npx vitest run` → all green (no regression).
- `grep -c '^import' src/transforms.ts` → **0** (Pi-free preserved).

## 8. Source citations
- spec/06-context-filter.md: §3 (L77-95, `applyRewind for this granularity = remove the resolved unit's
  indices, then close the gap`), §4 (L113-115, `applyRewind for last_turn = remove remove indices, gap-closed,
  unit-aware`), §7 (L174, `lastFiltered` cache write is downstream of every transform), §11 (L218-227, the
  INCONSISTENT composition example — see G5), §12 (L243-254, the pipeline call site; `remove: number[]`).
- spec/10-testing.md: §1.4 (L27-31, applyRewind tier-1 tests), §3 (L56-58, idempotency property;
  L59-60, monotonic shrinkage property).
- spec/08-edge-cases.md: E8 (marker targets nothing → no-op, retried next fire), E13 (never throws; fail-open).
- src/transforms.ts: L53 (`MessageLike`), L109 (`partitionIntoUnits` non-array→[] precedent), L223
  (`resolveLastToolCallGroup` — `applyRewind copies`/`applyRewind no-ops` JSDoc refs at L245/L249), L319
  (`resolveLastTurn` — the remove-set this feeds).
- applyShrink same-ref precedent: spec/06 §5 L133.