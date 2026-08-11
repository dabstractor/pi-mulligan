# Research Notes — P1.M1.T2.S2 (compaction-aware retained-tail walk in resolvePinnedShrink)

All facts below VERIFIED by direct read. This is the sibling-mirror of T2.S1 (resolvePinnedHide).

## 1. The algorithmic CONTRACT = T2.S1's PRP (resolvePinnedHide retained-tail walk)

T2.S1 rewrites `resolvePinnedHide` with this algorithm (treat as the spec to mirror):
```ts
let lastCompactionIdx = -1;
for (let i = branchEntries.length - 1; i >= 0; i--) {       // scan END→start → first hit = LAST compaction
  const t = isRecord(branchEntries[i]) ? readOwn(branchEntries[i], "type") : undefined;
  if (t === "compaction") { lastCompactionIdx = i; break; }
}
const tailEntries = branchEntries
  .slice(lastCompactionIdx + 1)                              // entries AFTER the last compaction
  .filter((e) => entryMessageYield(e) > 0);                  // message/custom_message/branch_summary ONLY (yield 1)
const tailStartIdx = messages.length - tailEntries.length;   // retained tail ↔ the LAST tailEntries.length messages
if (tailStartIdx < 0) return <REFUSE>;                       // defensive: alignment lost
// walk tail pushing tailStartIdx + k for each pinned entry...
```
KEY: filter the tail with `entryMessageYield(e) > 0` (NOT `isContextProducingType` — that INCLUDES compaction,
wrong for the tail). `lastCompactionIdx === -1` (no compaction) → degenerates to the legacy forward walk
(tailStartIdx === 0).

## 2. resolvePinnedShrink CURRENT state (src/transforms.ts:829 declaration; body ~833-842)

```ts
export function resolvePinnedShrink(messages: MessageLike[], branchEntries: BranchEntry[],
  pinnedEntryId: string): number | null {
  if (!Array.isArray(messages) || !Array.isArray(branchEntries)) return null;
  if (typeof pinnedEntryId !== "string" || pinnedEntryId.length === 0) return null;

  const ctxEntries = branchEntries.filter((e) =>
    isContextProducingType(isRecord(e) ? readOwn(e, "type") : undefined),   // ← INCLUDES compaction (THE BUG)
  );

  let msgCursor = 0;
  for (const e of ctxEntries) {
    const y = entryMessageYield(e);
    if (y < 0) return null;                       // ← BAILS on compaction → permanent no-op (THE BUG)
    if (msgCursor + y > messages.length) return null;
    const id = isRecord(e) ? readOwn(e, "id") : undefined;
    if (typeof id === "string" && id === pinnedEntryId) return msgCursor;
    msgCursor += y;
  }
  return null;
}
```

## 3. Differences from resolvePinnedHide (what the mirror must adapt)

| Aspect | resolvePinnedHide (T2.S1) | resolvePinnedShrink (THIS task) |
|--------|---------------------------|---------------------------------|
| Lookup | SET of ids (`hideSet.has(id)`) | SINGLE id (`id === pinnedEntryId`) |
| Return type | `number[]` (ascending indices) | `number \| null` (ONE index or null) |
| Defensive refuse | `return []` | `return null` |
| Not-found | `return []` (empty array) | `return null` |
| Walk action | `remove.push(tailStartIdx + k)` (collect all) | `return tailStartIdx + k` on FIRST match (IDs unique → at most one) |
| Defensive checks | 3 array checks + empty hideEntryIds | 2 array checks + non-string/empty pinnedEntryId (ALREADY present, KEEP) |

So: KEEP the 2 existing defensive checks verbatim; REPLACE the `ctxEntries`+forward-walk block with the
retained-tail walk; refuse returns `null`; walk RETURNS the index on match (early return), else `null`.

## 4. The ONE breaking test (analogous to T2.S1's test (c))

test/transforms.test.ts ~line 1757, test (c):
```ts
it("(c) compaction refusal — a branch containing a compaction entry → null (entryMessageYield === -1 → no-op)", () => {
  const msgs: MessageLike[] = [user("u"), asst("c1")];
  const branch: BranchEntry[] = [entry("e1","message"), entry("eC","compaction"), entry("e2","message")];
  expect(resolvePinnedShrink(msgs, branch, "e2")).toBeNull(); // ← ASSERTS THE BUG
});
```
TRACE post-fix: lastCompactionIdx=1 (eC at idx1); tailEntries=slice(2).filter(yield>0)=[e2] (len1);
tailStartIdx=2-1=1; walk k=0 e2 id "e2"===pinnedEntryId "e2" → return 1+0=1. **Returns 1, NOT null.**
⇒ MUST update (c) to expect `toBe(1)` and rename it (no longer "compaction refusal").

## 5. Tests that STAY GREEN (traced under the new algorithm)

- (a) basic: branch=[e1,e2,e3] msgs=3 pin"e2" → no compaction, tailStartIdx=3-3=0, e2 at k=1 → 1 ✓
- (b) LOCK: branchGrown=[e1,e2,e3,e4] msgs=4 pin"e1" → tailStartIdx=4-4=0, e1 k=0 → 0 ✓
- (d) not-found: pin"nonexistent-id" → not in tail → null ✓
- (e) defensive: non-array/empty pinnedEntryId → null (checks unchanged) ✓
- (f) throwing-Proxy: readOwn is THROW-SAFE (try/catch → undefined; see §7), so lastCompactionIdx scan + tail
  filter handle the trap without throwing → tailEntries=[] (trap filtered out) → return null, `.not.toThrow()` ✓
- (g) types: return type unchanged `number | null` → `toEqualTypeOf<number | null>()` ✓

## 6. Call sites consume null as no-op (CONFIRMED — NO change needed)

- applyShrink (~src/transforms.ts:922): `i = Array.isArray(branchEntries) ? resolvePinnedShrink(...) : null; if (i === null) return messages;` (SAME ref no-op).
- filterPipeline (~src/transforms.ts:1471): `const origIdx = resolvePinnedShrink(messages, branch, pinnedId); if (origIdx === null) continue;` (no-op).
Both already handle `null` correctly. Signature `number | null` UNCHANGED → zero call-site edits.

## 7. readOwn / isRecord / entryMessageYield / isContextProducingType (module-private, REUSED unchanged)

- `isRecord(v)`: `typeof v === "object" && v !== null && !Array.isArray(v)` (L173).
- `readOwn(obj, key)` (L178): `if (!isRecord(obj)) return undefined; try { return obj[key]; } catch { return undefined; }`
  — **THROW-SAFE** (catches Proxy get traps). ⇒ the new lastCompactionIdx scan calling readOwn directly is safe (test f green).
- `entryMessageYield(entry)` (~L549): returns 1 for message/custom_message/branch_summary; -1 for compaction/other.
  USE as the tail filter predicate (`> 0`).
- `isContextProducingType(type)` (~L555): true for message/custom_message/branch_summary/**compaction**.
  DO NOT use for the tail filter (includes compaction). UNCHANGED (resolveCheckpoint needs it).

## 8. Test fixture helpers (test/transforms.test.ts)

- `entry(id, type, extra={})` → `{type,id,parentId:null,timestamp:"t",...extra}` (L738). BranchEntry built root→leaf.
- `compactionSummary(text="summary"): MessageLike` (L743) — EXISTS; use directly for compaction-summary msgs.
- `user(text)`, `asst(...callIds)`, `result(toolCallId)`, `asstText(text)` (L9-33).
- compaction BRANCH ENTRY shape: `entry("eC","compaction",{summary:"s", firstKeptEntryId:"e3"})` (mirror resolveCheckpoint tests ~838-860).

## 9. Architecture rationale (system_context.md §BUG-002)

- Root cause: getBranch() is RAW (compacted-away + compaction + tail); event.messages is compaction-aware.
  The 1:1 walk breaks past a compaction boundary.
- Fix: retained-tail-only walk. The entries AFTER the last compaction map 1:1 to the LAST N messages.
- BOTH resolvePinnedHide AND resolvePinnedShrink have the SAME bug; T2.S1 = hide, T2.S2 = shrink (this).
- entryMessageYield/isContextProducingType NOT changed (resolveCheckpoint keeps bail-on-compaction for its
  contiguous-sweep semantics; only the two pinned resolvers become compaction-aware).

## 10. tsc bar & validation

- `npx vitest run test/transforms.test.ts` → all pass (updated (c) + new cases; resolvePinnedHide tests are
  T2.S1's separate describe block — NO overlap/conflict).
- `npx tsc --noEmit` → no new errors (signature unchanged; entryMessageYield reused as predicate returns number).
- resolveCheckpoint's compaction tests (~838-860) must stay green (proves shared helpers untouched).