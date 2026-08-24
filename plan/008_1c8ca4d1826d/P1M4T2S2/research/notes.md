# Research — P1.M4.T2.S2 (stale-reference sweep + spec-staleness wrap-up)

## Current grep hits (pre-T2.S1-implementation, on this working tree)

`grep -n 'by_content_includes\|past tool result\|If wasteful' README.md VERIFICATION.md`:

- README.md:157 "past tool result" (shrink blurb) → T2.S1 Task 1 fixes
- README.md:169 by_content_includes (matcher list) → T2.S1 Task 2
- README.md:187, :189 by_content_includes (cancel) → T2.S1 Task 4
- README.md:234 "If wasteful" (drift nudge quote) → T2.S1 Task 5
- README.md:266 BUG-004 note by_content_includes → T2.S1 Task 6
- VERIFICATION.md:209 BUG-004 round-1 table row — **HISTORICAL LOG: keep verbatim, never rewrite** (file's own convention: "preserved here as an accurate historical snapshot and is not rewritten"). Append-only delta rows instead.

## VERIFICATION.md structure & append convention

- Sections: v1.0 DoD table → remediation round 1 (956) → round 2 (974) → field reports (1067). Each pass APPENDS a new section with a table (|Bug|Severity|Root cause|Fix|Regression test|) and a closing `npm test → N passed, 0 failed` line noting prior baselines are preserved.
- This task appends a **v2.0 delta section** (not a bug round — a scope-change verification row set) with 4 rows: current-turn scope guard (filter + resolver), removed content arm, awareness-only nudge tail, persistence regression test. No new bug numbers needed — use plain labels.

## Spec staleness registry

`plan/008_1c8ca4d1826d/architecture/scope_guard_design.md` §6 (lines ~97-105), six numbered entries; the item contract enumerates 5 for the owner's wrap-up + 1 interpretation note (spec 04 §4 has no `matched` field — do NOT add). Spec files are READ-ONLY for this delta.

## Gates

package.json scripts: `typecheck` = `tsc --noEmit`, `test` = `vitest run`, `smoke` = `node test/integration/run-smoke.mjs`. Current baseline: 1067+ unit tests (field-report round), plus P1.M1–M4 additions; smoke = 14 scenarios (P1.M4.T1.S3 adds/syncs one).

## Sibling contract

P1M4T2S1/PRP.md: edits README only, six sites, targets zero `by_content_includes`/`If wasteful`/`past tool result`/`any role` hits in README. This task re-runs the sweep as the closing gate and owns VERIFICATION.md + wrap-up notes.