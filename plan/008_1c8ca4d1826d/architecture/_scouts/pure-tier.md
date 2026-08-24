# Code Context — pi-mulligan v2.0 delta recon (current-turn scoping of mulligan_shrink)

Repo root: `/home/dustin/projects/pi-mulligan-current-turn-only`. File lengths: `src/transforms.ts` 1551 lines, `src/markers.ts` 475, `src/filter.ts` 470.

## 1. transforms.ts ShrinkTarget union (lines 732–744)

`src/transforms.ts:740`:
```ts
export type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" }
  | { by_content_includes: string };
```
Exported from `src/transforms.ts` (pure tier). Doc comment (732–739) states it is **structurally identical, declared LOCALLY** (duplicated, NOT imported from markers.ts) so transforms.ts stays Pi-free (0-import invariant). Exported for shrink tool (P1.M5.T2), filterPipeline (T5.S1), tests.

## 2. resolveShrinkTarget (transforms.ts:746–812)

Signature at `src/transforms.ts:771`:
```ts
export function resolveShrinkTarget(messages: MessageLike[], target: ShrinkTarget): number | null
```
Branches (discriminator = first present non-empty-string key; precedence by_tool_call_id → by_tool_name → by_content_includes):
- **by_tool_call_id** (775–781): first `role === "toolResult"` message with `toolCallId === id`; else null.
- **by_tool_name + occurrence** (784–797): among toolResults with `toolName === name`, `occurrence === "first"` → first match (immediate return); anything else/missing → "last" (GOTCHA #6, scan keeps last); else null.
- **by_content_includes** (800–807): first message (ANY role, E19) whose `stringifyContent(content)` includes a non-empty needle; empty needle → null (BUG-004). `stringifyContent` is module-private (transforms.ts:1071–1080): string→verbatim, array→JSON.stringify, else "".

Null semantics: non-array messages → null; non-record target → null; no match → null. **No span/scope param exists — it scans the ENTIRE message list.**

Usages: `grep` shows callers only inside `src/transforms.ts` (line 771 def; line 986 use inside applyShrink's live branch; line ~1082 doc mention) and tests. filter.ts does NOT call it directly (filterPipeline handles shrinks internally). tools/shrink.ts mentions pinned resolution but calls `resolvePinnedShrink` only (line 252 doc).

## 3. resolveLastTurn (transforms.ts:317–~380)

```ts
export function resolveLastTurn(
  messages: MessageLike[],
  excludeToolCallId?: string,
): { remove: number[] }
```
iLastUser scan (verbatim, lines 331–337):
```ts
// 1) iLastUser = index of the LAST "user" message.
let iLastUser = -1;
for (let i = 0; i < messages.length; i++) {
  if (isRecord(messages[i]) && readOwn(messages[i], "role") === "user") iLastUser = i;
}
if (iLastUser === -1) return { remove: [] }; // no user message → nothing to rewind (protected)
```
Then builds `rewindOwnIndices` via `partitionIntoUnits` + `assistantIssuedCall` for the exclude id; removal = indices > iLastUser except own unit + mulligan:* notes. Returns `{ remove: number[] }` (empty = no-op). This linear reverse-scan-for-last-user pattern is the precedent convention for "current turn" scoping.

## 4. applyShrink (transforms.ts:895–1010) + stampShrink (944–962)

```ts
export function applyShrink(
  messages: MessageLike[],
  marker: { target: ShrinkTarget; replacement: string; pinnedEntryId?: string },
  branchEntries?: BranchEntry[],
): MessageLike[]
```
(defined at line 963). Behavior: non-array → []; non-record marker → same ref. **Pinned-first**: if `pinnedEntryId` non-empty string → `i = resolvePinnedShrink(messages, branchEntries, pinnedId)` when branchEntries is an array, else null; null → return messages (same ref, identity-or-nothing, NO live fallback). Else live: `i = resolveShrinkTarget(messages, readOwn(marker, "target") as ShrinkTarget)` (line 986). Out-of-range → same ref.

Substitution: `text = stampShrink(rep ?? "")`, content replaced with `[{ type:"text", text }]`, clone via `{...orig, content}` (try/catch → role-preserving fallback); returns `messages.map((m,j)=> j===i ? replacement : m)` — other elements by reference.

stampShrink (lines 956–962):
```ts
const SHRUNK_OPEN = "<context-shrunk>";
const SHRUNK_CLOSE = "</context-shrunk>";
export function stampShrink(rep: string): string {
  return `${SHRUNK_OPEN}\n${rep}\n${SHRUNK_CLOSE}`;
}
```
Render-only; marker's stored `replacement` stays raw/unstamped.

`applyShrinkAt` (module-PRIVATE, line 1030): `(messages: MessageLike[], marker: { replacement?: unknown }, i: number): MessageLike[]` — pre-resolved-index twin, identical substitution body; used only by filterPipeline's pinned path. NOT exported.

## 5. filterPipeline shrink pass (transforms.ts:1513–1548) and filter.ts wrapper

filterPipeline signature (transforms.ts:1374–1381):
```ts
export function filterPipeline(
  messages: MessageLike[],
  markers: MarkerBundle | undefined,
  config: ProtectedConfig | undefined,
  branchEntries?: BranchEntry[],
  diag?: RewindDiag[],
): MessageLike[]
```
Shrink loop verbatim (1522–1547):
```ts
for (const sh of stableSortBySeq(shrinks)) {
    const pinnedId = readOwn(sh, "pinnedEntryId");
    if (typeof pinnedId === "string" && pinnedId.length > 0) {
      // PINNED: resolve against the ORIGINAL messages (aligned with branchEntries). null/absent → no-op this fire
      // (identity-or-nothing — the rewind precedent; NEVER fall back to live resolution).
      const origIdx = resolvePinnedShrink(messages, branch, pinnedId);
      if (origIdx === null) continue;
      if (removedOrig.has(origIdx)) continue; // target removed by a rewind → no-op (spec/06 §5:143)
      // Translate original index → reduced index. reducedToOrig is ascending; binary search for origIdx.
      let lo = 0;
      let hi = reducedToOrig.length - 1;
      let reducedIdx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = reducedToOrig[mid];
        if (v === origIdx) { reducedIdx = mid; break; }
        if (v < origIdx) lo = mid + 1; else hi = mid - 1;
      }
      if (reducedIdx < 0) continue; // defensively not found (shouldn't happen post removedOrig check) → no-op
      m = applyShrinkAt(m, sh, reducedIdx);
    } else {
      // LIVE: re-resolve the selector against the current reduced `m` (compaction-robust; spec/06 §5).
      m = applyShrink(m, sh, branchEntries);
    }
  }
```
`branch = Array.isArray(branchEntries) ? branchEntries : []` (line ~1432). **Yes, filterPipeline knows branchEntries** (4th param; threaded into applyShrink live calls at line 1546 and `branch` for pinned resolution at 1529). Composition model: rewinds run first on `m` maintaining `reducedToOrig` map + `removedOrig` set; pinned resolves against ORIGINAL `messages`, translated to reduced space; live resolves against reduced `m`.

filter.ts wrapper (line 43 imports `filterPipeline, resolvePinnedShrink, stableSortBySeq` from transforms.js). The stale-retirement pass at `src/filter.ts:380–410`: per active shrink with a pinnedEntryId, calls `resolvePinnedShrink(event.messages, branchEntries, pinnedEntryId)` (PRE-filter alignment, line 394); hit → `rt.shrinkMissCounts.set(id, 0)`; miss → increment; `misses >= config.shrink.staleAfterFires` → `appendCancelMarker(pi, ctx, { targetId: id })`. **shrinkMissCounts keyed by `sh.id` (the marker uuid), not entry id** (runtime.ts:83 `shrinkMissCounts: Map<string, number>`). Soft cap follows (~line 410+): `markers.shrinks.length > config.shrink.maxActive` → cancel oldest by seq.

## 6. markers.ts

- **ShrinkTarget DUPLICATED** (not re-exported) at `src/markers.ts:96–99`, byte-identical union. Comment: "EXPORTED for the shrink tool's typebox-free type + the filter + tests."
- **to_previous_prompt precedent** at `src/markers.ts:60–62` (inside `RewindMarker.options`):
```ts
/** Legacy v1.0 field; ignored by the v1.1 resolver — last_turn always keeps the user message. Kept optional so
 *  old persisted markers type-check and read harmlessly. */
to_previous_prompt?: boolean;
```
- **ShrinkMarker** at `src/markers.ts:107–127`: `interface ShrinkMarker extends MulliganEnvelope` with `kind:"shrink"; id: string; target: ShrinkTarget; replacement: string; reason?: string; pinnedEntryId?: string; seq: number; ts: number`. `pinnedEntryId` doc (112–122): stable ENTRY id matched at creation; identity resolution; mirrors hideEntryIds; optional.
- `ShrinkMarkerInput = Omit<ShrinkMarker, "schema"|"v"|"kind"|"id"|"seq"|"ts">` (line 130).
- Storage: `appendShrinkMarker` (line 236) → `pi.appendEntry("mulligan:shrink", entry)`; lookup: `readMarkers(ctx)` in `src/filter.ts:118–190` scans `ctx.sessionManager.getEntries()` for custom entries with `customType === "mulligan:shrink"` and `data.kind === "shrink"`, pushes to `shrinks: ShrinkMarker[]` (bundle shape at filter.ts:99), drops markers whose `data.id` ∈ cancelledIds (from `mulligan:cancel` entries, filter.ts:160–166, 172–187).
- **ShrinkMarkerLike** (transforms.ts:~1126–1141): `{ seq: number; target: ShrinkTarget; replacement: string; pinnedEntryId?: string }` — exported structural slice filterPipeline orders/reads; MarkerBundle `{ rewinds: RewindMarkerLike[]; shrinks: ShrinkMarkerLike[] }`.

## 7. Span-like index-range types

None exist. No `Span`/`Range` types in src/. Closest existing conventions:
- `resolveLastTurn` returns `{ remove: number[] }` — ascending message-index array (transforms.ts:316).
- `filterPipeline`'s `reducedToOrig: number[]` (index map) and `removedOrig: Set<number>` — index-space composition primitives.
- `RewindDiag` diag entries carry `remove: number[]` + `resolvedLen`.
- `Unit` (partitionIntoUnits) holds `indices: number[]` per unit.
Convention: plain `number[]` of ascending indices, not [start,end) pairs.

## 8. transforms.ts exports consumed by test/transforms.test.ts

`test/transforms.test.ts:2`:
```ts
import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint, resolvePinnedHide, resolvePinnedShrink, applyRewind, applyShrink, stampShrink, resolveShrinkTarget, filterPipeline, stableSortBySeq, protectedOk, type Unit, type MessageLike, type BranchEntry, type ShrinkTarget, type RewindMarkerLike, type ShrinkMarkerLike, type MarkerBundle, type ProtectedConfig } from "../src/transforms.js";
```
Also `test/edge-cases.test.ts` calls `applyShrink(msgs, { target: { by_content_includes: "..." }, replacement: "X" })` (lines 992–1055); `test/filter.test.ts` mocks `resolvePinnedShrink` (lines 13–24).

## Verification answers

- **resolveShrinkTarget span/scope param: NO.** Signature is exactly `(messages, target)` — full-list scan.
- **filterPipeline knows branch entries: YES** — `branchEntries?: BranchEntry[]` 4th param (line 1374); `branch` local derived line ~1432; live path passes it to applyShrink at 1546.
- Other current exact signatures for delta planning: `applyShrink(messages, marker, branchEntries?)`, `applyShrinkAt` (private), `filterPipeline(messages, markers, config, branchEntries?, diag?)`, `resolvePinnedShrink(messages, branchEntries, pinnedEntryId): number | null` (transforms.ts:851), `resolveLastTurn(messages, excludeToolCallId?): { remove: number[] }` (317), `BranchEntry` interface at transforms.ts:377 (exported, getBranch()-shaped records).

## Start Here
`src/transforms.ts` lines 740–812 (ShrinkTarget + resolveShrinkTarget) — the exact surface a current-turn scope param would modify; then filterPipeline's shrink loop (1513–1548) and filter.ts:380–410 for the miss-count keying.