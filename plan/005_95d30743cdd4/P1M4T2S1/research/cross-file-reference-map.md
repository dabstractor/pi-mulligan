# Research Note — P1.M4.T2.S1: renderDriftNudge rewrite

## Method
Read the prior PRP (P1.M4.T1.S1 — sibling bloat-reminder rewrite), the architecture note
(`plan/005_95d30743cdd4/architecture/m4_nudge_text_simplification.md`), the current `src/notes.ts`,
and grep-verified every reference to `renderDriftNudge` / its output text across `src/` + `test/`.

## COMPLETE reference set (grep-verified — these are ALL the files that touch drift-nudge text)

| File | Lines | What | Action |
|------|-------|------|--------|
| `src/notes.ts` | 295–321 (JSDoc), 322–340 (fn) | `renderDriftNudge` + JSDoc | REWRITE (drop prefix, collapse 4→3 branches, condense tail to one line) |
| `test/notes.test.ts` | 405–407 | `DRIFT_TAIL` constant (2-elem array) | REWRITE (tail is now ONE string, "call" not "consider") |
| `test/notes.test.ts` | 486–545 | pinned-format `describe` (4 `it`s) | REWRITE assertions (no `[mulligan]`, no bloat on delta path, new tail) |
| `test/notes.test.ts` | 548–568 | rounding & pluralization | KEEP logic; "produced N bloated result(s)" stays (null-delta fallback) |
| `test/notes.test.ts` | 571–611 | defensive (never-throws) | DROP `[mulligan]` from the 2 `.toContain("[mulligan] Previous turn changed your context.")` |
| `test/notes.test.ts` | 614–640 | snapshot-style (2 inline snapshots) | REWRITE both snapshots to new single-line text |
| `test/notes.test.ts` | 645–646 | type test | UNCHANGED (no arity change) |
| **`test/edge-cases.test.ts`** | **986–1000** | **E18 "consider" assertions** | **REWRITE: `toContain("consider")`→`toContain("call")` ×2 (CROSS-FILE — contract missed)** |
| **`test/drift_nudge.test.ts`** | **151–156** | **`startsWith("[mulligan]")`** | **REWRITE: assert non-empty string / new shape (CROSS-FILE — contract missed)** |

## CRITICAL FINDING (analogous to T1's GOTCHA #2)
The item contract names `src/notes.ts` (the function + JSDoc) + its own JSDoc as [Mode A] doc.
It does NOT name `test/edge-cases.test.ts` (E18) or `test/drift_nudge.test.ts`. BOTH break:
- `edge-cases.test.ts:988,997` assert `text.toContain("consider")` → the new text says **"call"** → FAIL.
- `drift_nudge.test.ts:155` asserts `content.startsWith("[mulligan]")` → the prefix is REMOVED → FAIL.

`npx vitest run` is RED until both are fixed. T2 owns these fixes (it caused the breakage; "leave the
suite green" principle). The `it` NAME on edge-cases.test.ts:986 also still says "SUGGESTS consider"
— update to "SUGGESTS rewind/shrink".

## OUT OF SCOPE (confirmed — do NOT touch)
- `renderHighWaterNudge` (src/nudges.ts:480) — DIFFERENT nudge (§5.2 high-water). It ALSO uses `[mulligan]`
  prefix + "Consider", but it is NOT the drift nudge. Leave it. Its tests (drift_nudge.test.ts:322+) stay.
- `renderBloatReminder` (T1's scope — sibling, being implemented in parallel).
- `suppressCheck` (T3's scope — §5.3 align).
- README (P1.M5 scope).

## Exact target text (verified vs architecture note + selected_prd_content h2.77)
The delta path is a SINGLE physical string (NO embedded `\n`):
`Previous turn added ~<k> tokens to your context. If that growth was wasteful, call \`mulligan_rewind\` (undo the turn) or \`mulligan_shrink\` (compact a result); run \`mulligan_audit\` for a breakdown.`

Key deltas vs old: (1) no `[mulligan] ` prefix; (2) "call" not "consider"; (3) tail condensed to one
line via "; run" (was two lines: ".\nRun..."); (4) delta path NEVER mentions bloat (4-branch → 3-branch:
delta!=null wins regardless of bloat).

## Structural note on `DRIFT_TAIL`
Currently `const DRIFT_TAIL = [line2, line3]` (2-elem array) used as `[..., ...DRIFT_TAIL].join("\n")`.
New output is ONE string (no `\n`), so the cleanest rewrite makes DRIFT_TAIL a single tail STRING
appended after the lead. The `resultWord` + `kTokens` + `readDelta` + `readBloatHits` helpers are
REUSED unchanged (contract point (d)).