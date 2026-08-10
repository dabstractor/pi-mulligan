# Research Notes — P1.M2.T1.S1: `needle.length > 0` guard in resolveShrinkTarget's by_content_includes arm (BUG-004)

> Surgical defense-in-depth fix: add `&& needle.length > 0` to the by_content_includes guard in
> `src/transforms.ts` so an empty needle resolves to `null` (no-op) instead of matching messages[0].
> Mirrors the existing length>0 guards on the other two arms. Plus a REQUIRED corollary: one existing test
> (transforms.test.ts:1145–1150) relies on the old empty-needle-matches behavior and MUST be rewritten.

## 1. The defect (verified verbatim — src/transforms.ts:789–797)

```ts
  // by_content_includes: first message (ANY role — E19) whose stringified content includes the substring.
  const needle = readOwn(target, "by_content_includes");
  if (typeof needle === "string") {          // ← BUG: no needle.length > 0 guard
    for (let i = 0; i < messages.length; i++) {
      if (stringifyContent(readOwn(messages[i], "content")).includes(needle)) return i;
      //  String.prototype.includes("") === true for EVERY string → matches messages[0]
    }
    return null;
  }
```
An empty `needle` ("") passes `typeof === "string"` and `"".includes("") === true` → returns index `0` (the
first message), silently substituting the first message's content on every fire. The shrink TOOL layer
(`targetIsStructurallyValid`) refuses empty, but any marker constructed WITHOUT the tool (old/persisted,
hand-crafted, or later-emptied) would hit this path.

## 2. The sibling arms already guard (the pattern to mirror)
- `by_tool_call_id` (line 764): `if (typeof callId === "string" && callId.length > 0)`
- `by_tool_name` (line 775): `if (typeof name === "string" && name.length > 0)`

## 3. The fix (one condition; src/transforms.ts:791)
```ts
  if (typeof needle === "string" && needle.length > 0) {
```
An empty needle now falls through to the final `return null` (no match → no-op). Preserves E13 (never throws —
just returns null) and mirrors the other arms exactly. The for-loop + `return null` are unchanged.

## 4. Downstream safety (verified)
`applyShrink` calls `resolveShrinkTarget` for LIVE/unpinned shrinks; when it returns `null`, applyShrink
returns the messages UNCHANGED (same reference — a documented no-op; see contract OUTPUT). `filterPipeline`
unchanged. PINNED shrinks use `resolvePinnedShrink` (identity resolver, not affected). So the only behavioral
change is: empty needle → null instead of 0.

## 5. JSDoc updates (Mode A — rides with the work; src/transforms.ts ~738–748)
(a) by_content_includes strategy (lines 744–745): "includes the substring" → "includes the NON-EMPTY substring
(an empty needle resolves to null — defense-in-depth, BUG-004; …)".
(b) dispatcher line (747–748): "a non-string/empty id/name, resolves to null" → "a non-string/empty
id/name/needle, resolves to null" (so the doc covers the new needle guard).
(c) inline comment (line 789): "includes the substring." → "includes a NON-EMPTY substring." (consistency).

## 6. ⚠️ CRITICAL — the test that BREAKS (required corollary)

`test/transforms.test.ts:1138–1150` (the "spec/08 E13 — NEVER throws" test) uses an empty `by_content_includes: ""`
as the ONLY way to match an all-throwing Proxy `trap` (whose content can't be stringified), then asserts the
trap's content is REPLACED with "r":
```ts
    // applyShrink where the throwing-Proxy IS matched (empty needle matches empty stringified content) → … content replaced.
    expect(() => applyShrink([trap], { target: { by_content_includes: "" }, replacement: "r" })).not.toThrow();
    const out = applyShrink([trap], { target: { by_content_includes: "" }, replacement: "r" });
    expect(out).toHaveLength(1);
    expect(textOf(out[0])).toBe("r");   // ← BREAKS: out[0] is now the unchanged trap; textOf(trap) throws
```
After the fix: empty needle → null → applyShrink is a NO-OP → returns the SAME array ref (the trap unchanged).
`expect(textOf(out[0])).toBe("r")` fails (and `textOf(trap)` would throw, since the trap reads throw).
**REWRITE** to assert the new no-op behavior (same ref, never throws) — do NOT read the trap's content.

Other empty-needle sites in tests (DO NOT break; verify they stay green):
- `test/transforms.test.ts:1140` — `expect(() => resolveShrinkTarget([trap], { by_content_includes: "" })).not.toThrow();`
  → still passes (returns null, doesn't throw). STRENGTHEN with `.toBeNull()`.
- `test/transforms.test.ts:1117` — `by_content_includes: "u"` (NON-empty) → `.toBe(0)` — unaffected. ADD a
  sibling empty-needle regression assertion right after it.
- `test/tools/shrink.test.ts:251` — `["by_content_includes empty", { by_content_includes: "" }]` — a TOOL-layer
  parametrized case asserting `targetIsStructurallyValid` REFUSES empty. NOT affected (the tool still refuses;
  it never reaches resolveShrinkTarget). Leave unchanged.

## 7. Test plan (keep suite green + lock in the new behavior)
- **Add** (after line 1117, inside the existing matcher `it(...)`): a positive regression
  `expect(resolveShrinkTarget(msgs, { by_content_includes: "" })).toBeNull();` on a NORMAL array.
- **Strengthen** (line 1140): add `expect(resolveShrinkTarget([trap], { by_content_includes: "" })).toBeNull();`.
- **Rewrite** (lines 1145–1150): replace the "matched → replaced" assertions with "no-op → same ref, never throws".
- NO new `it(...)` blocks → the reported test COUNT stays 952 (only `expect()` calls added/changed).

## 8. Baseline + conflict check (verified)
- `npx tsc --noEmit` → exit 0 (clean).
- `npx vitest run` → **952 passed (952)**.
- Parallel item P1.M1.T2.S1 edits `src/config.ts` + `test/config.ts` (Math.floor guard on maxActive/
  staleAfterFires). Does NOT touch `src/transforms.ts` or `test/transforms.test.ts`. Zero overlap; either order.
- This PRP edits `src/transforms.ts` (guard + JSDoc + inline comment) + `test/transforms.test.ts` (3 test
  edits). Nothing else.

## 9. Spec cross-references
- spec/06-context-filter.md §5 (L126-128 — the three matcher strategies; by_content_includes substring match).
- spec/08 E13 (never throws) + E19 (by_content_includes matches ANY role). The fix is defense-in-depth for E13.
- spec/04-data-model.md §4 (ShrinkTarget discriminated union).