# Research Note — BUG-006: Split cancel no-op text by resolution path (P1.M2.T3.S1)

> Code+test change. Small (0.5 pts). `mulligan_cancel` returns ONE hardcoded not-found string for BOTH
> resolution paths; spec/05 §5 specifies distinct texts. Fix = emit path-specific text.

## 1. The bug (architecture/system_context.md §BUG-006)

`cancelExecute` (`src/tools/cancel.ts`) resolves the marker via two paths, then step 4 returns a not-found
no-op if neither yields a `targetUuid`:

- **(3a) MARKERID PATH** — `cancel.ts:368`: `if (typeof params.markerId === "string" && params.markerId.length > 0)`
  → scans entries for matching `mulligan:rewind`/`mulligan:shrink` with `id === markerId`.
- **(3b) TARGET PATH** — `cancel.ts:375`: `else if (params.target)` → `resolveTargetUuid(...)`.
- **(4) NOT-FOUND NO-OP** — `cancel.ts:391-396`: returns ONE hardcoded string regardless of path:
  `"Mulligan: no active marker found with that id — nothing to cancel."`

The bug: when the agent cancels by `target` (the preferred/documented path) and nothing matches, it is told
"with that id" — misleading (no id was supplied) and diverges from spec/05 §5.

## 2. spec/05 §5 verbatim source-of-truth (READ-ONLY — already correct)

- `spec/05-tools.md:264` — target-path text (verbatim): `"Mulligan: no active marker found for that target — nothing to cancel."`
- `spec/05-tools.md:280` — step 4: "Not-found no-op: if no marker resolved … → return the `\"no active marker found for that target\"` no-op text + `details:{cancelled:false}`."
- ⇒ TARGET path text = `"Mulligan: no active marker found for that target — nothing to cancel."`
- ⇒ MARKERID path text = current string, UNCHANGED: `"Mulligan: no active marker found with that id — nothing to cancel."`

## 3. The code change — `src/tools/cancel.ts:390-396` (verbatim)

The `usedMarkerId` test MUST mirror the (3a) condition at line 368 EXACTLY (`typeof params.markerId === "string"
&& params.markerId.length > 0`) so the emitted text always matches the path actually taken (Decision D1 —
markerId wins when both are given).

```ts
// CURRENT (cancel.ts:390-396):
    // (4) not-found no-op (spec/05 §5 step 4; E21 (d) — safe no-op, never throws). appendCancelMarker NOT called.
    if (targetUuid === null) {
      return {
        content: [{ type: "text", text: "Mulligan: no active marker found with that id — nothing to cancel." }],
        details: { cancelled: false },
      };
    }

// AFTER (BUG-006): declare usedMarkerId before the if; ternary picks the path-specific text.
    // (4) not-found no-op (spec/05 §5 step 4; E21 (d) — safe no-op, never throws). appendCancelMarker NOT called.
    //     BUG-006: emit path-specific text. markerId path keeps "with that id"; target/neither path uses the
    //     spec/05 §5 verbatim "for that target" text (Decision D1 — markerId wins when both are given).
    const usedMarkerId = typeof params.markerId === "string" && params.markerId.length > 0;
    if (targetUuid === null) {
      return {
        content: [
          {
            type: "text",
            text: usedMarkerId
              ? "Mulligan: no active marker found with that id — nothing to cancel."
              : "Mulligan: no active marker found for that target — nothing to cancel.",
          },
        ],
        details: { cancelled: false },
      };
    }
```

Notes: `details` stays `{ cancelled: false }`. No behavior change beyond the text. No new refusal path
("neither" → usedMarkerId=false → target text; matches Decision D2 — no new refusal). The `else if (params.target)`
at line 375 and the rest of steps 5-7 are UNCHANGED.

## 4. The test map — `test/tools/cancel.test.ts` (CRITICAL — 7 identical assertion lines)

The assertion line is IDENTICAL at **7 sites**:
`    expect(firstText(res)).toBe("Mulligan: no active marker found with that id — nothing to cancel.");`

### 3 sites STAY "with that id" (MARKERID path — `run(pi, ctx, { markerId: ... })`)
| Line | Preceding run() | Why stay |
|------|-----------------|----------|
| **342** | `run(pi, ctx, { markerId: "nope" })` (L339) | markerId non-empty → markerId path → "with that id" correct |
| **362** | `run(pi, ctx, { markerId: "entry-rw-1" })` (L360) — malformed entry w/ no `data.id` | markerId path → stays |
| **432** | `run(pi, ctx, { markerId: "entry-rw-1" })` (L431) — throwing getEntries → [] | markerId path → stays |

### 4 sites CHANGE to "for that target" (TARGET path — `run(pi, ctx, { target: ... })`)
| Line | Nearest unique anchor (above the assertion) | Change |
|------|---------------------------------------------|--------|
| **765** | `expect(appended).toHaveLength(0); // markers EXIST but none COVER → no-op` (L764) | → "for that target" |
| **784** | plain `expect(appended).toHaveLength(0);` (L783) — anchor on enclosing `it(\"…\")` title | → "for that target" |
| **803** | plain `expect(appended).toHaveLength(0);` (L802) — anchor on enclosing `it(\"…\")` title | → "for that target" |
| **908** | `expect(appended).toHaveLength(0); // null targetUuid → no-op` (L907) + preceding `await expect(run(...)).resolves.toBeDefined()` | → "for that target" |

**CRITICAL GOTCHA:** a naive global find/replace of the assertion line changes all 7 — it would WRONGLY flip the
3 markerId-path tests (they'd then expect "for that target" but the code returns "with that id" → 3 FAILs). The
implementer MUST target ONLY the 4 target-path sites. Distinguish by the preceding `run()` call: `target:` →
change; `markerId:` → keep. For 784/803 (whose immediate trio is identical), extend the edit anchor upward to
the test's `it(\"…\")` title line (they differ) to make each oldText unique.

### The stale flag-comment — `test/tools/cancel.test.ts:559-561`
Documents the deviation; after the fix it is stale and must be updated:
```
// CURRENT (559-561):
// ⚠️ VERIFY-AT-IMPLEMENTATION RESOLUTION (research flagged this): S2's cancel.ts returns the SAME not-found
// text for BOTH paths — "Mulligan: no active marker found with that id — nothing to cancel." (NOT a separate
// "...for that target" string). The target-path no-op cases below pin that shared string.
```
Replace with text reflecting the split (markerId→"with that id"; target→"for that target").

## 5. The JSDoc at `src/tools/cancel.ts:325` — NO change needed
`*   4. not-found no-op (step 4): return the "no active marker found" no-op text + details:{cancelled:false};`
This is already generic ("the 'no active marker found' no-op text") — it does not pin a path-specific string,
so it stays accurate after the fix. (Optional: could note the split, but not required.)

## 6. Repo-wide grep — ALL references (confirm scope is exactly cancel.ts + cancel.test.ts + spec/05)

`grep -rnE 'no active marker found|with that id|for that target' --include='*.ts' --include='*.md' .`
- `spec/05-tools.md:264,280` — source-of-truth (READ-ONLY)
- `src/tools/cancel.ts:325` — generic JSDoc (no change); `:393` — THE FIX
- `test/tools/cancel.test.ts` — 7 assertions + the 559-561 comment
- **NO other consumers.** README does not document tool result text (it's runtime agent-facing text, not a
  config/API surface — confirmed by the contract: "tool result text is not externally documented").

## 7. Parallel-sibling coordination (no file conflict)
P1.M2.T2.S1 (in progress) edits `src/tools/rewind.ts` (`countRetriesAtLatestPrompt`) + `test/tools/rewind.test.ts`.
This task edits `src/tools/cancel.ts` + `test/tools/cancel.test.ts` — **no overlap**. Both can run in parallel;
the full-suite gate validates both together.

## 8. Validation gates
- `npx tsc --noEmit` → exit 0 (the ternary is a `string` literal union; no type change).
- `npx vitest run test/tools/cancel.test.ts` → all pass (3 markerId tests still assert "with that id" ✓;
  4 target tests now assert "for that target" ✓).
- `npx vitest run` → full suite green (convergence with sibling rewind.ts work).
- grep: cancel.ts now contains BOTH strings; markerId-path assertions (342/362/432) still say "with that id";
  target-path assertions (765/784/803/908) now say "for that target".