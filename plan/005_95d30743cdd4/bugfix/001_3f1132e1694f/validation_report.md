# pi-mulligan — Validation Report

**Validator approach:** independent end-to-end validation against the full spec
(`spec/SPEC.md` + companions 01–12) and the real source. I (1) mapped every
MUST/REQUIRED clause, (2) read all 17 source modules + 5 tool modules, (3) wrote
behavioral **probe tests** that reproduce each of the 6 PRD-described bug
scenarios and assert the *correct* behavior (a passing probe ⇒ bug is fixed),
ran them against the live code, then deleted the probes and re-ran the shipped
suite to confirm no regression, and (4) ran the project's own integration smoke
harness end-to-end.

---

## Headline result

- **Type check:** PASS (`tsc --noEmit`, strict)
- **Unit tests:** PASS — **956/956** (vitest)
- **Zero-config extension load:** PASS (`pi -e ./src/index.ts`)
- **Integration smoke (E2E):** **FAIL — 13/14 scenarios, exit 1** (`npm run smoke`)

**All six bugs described in the PRD are already FIXED** in the current source
(verified by behavioral probes, not just comments). I found **one NEW Major
issue** the PRD does not mention: the BUG-006 fix changed the `mulligan_rewind`
tool from a no-op-success to a refusal, but the **integration smoke harness and
two docs were never updated to match** — so the project's documented E2E gate
(`npm run smoke`, claimed "14/14 passed" in `VERIFICATION.md`) is now red.

---

## PRD-described bugs — all RESOLVED (verified, not issues)

Each was confirmed fixed by a behavioral probe that reproduces the bug's exact
reproduction steps. The source also carries a comment citing each `BUG-00X` id
at the fix site.

| ID | Claim | Verification (probe asserts the FIXED behavior) | Result |
|----|-------|--------------------------------------------------|--------|
| BUG-001 | Checkpoint not consumed when same name set on two targets (`src/tools/rewind.ts`) | Faithful Pi fake (`labelsById: Map`, `setLabel`+`getLabel` share state) with the same checkpoint name on two distinct targetIds; after one rewind, **both** targets cleared and a **second** rewind by the same name **refuses** | ✅ FIXED |
| BUG-002 | `nudges.driftWindowTurns` 0.5 → 0 (`src/config.ts`) | `validateConfig({nudges:{driftWindowTurns:0.5}})` → `3` (default), not `0`; `0` and `-2` also fall back | ✅ FIXED |
| BUG-003 | `shrink.maxActive`/`staleAfterFires` accept fractions (`src/config.ts`) | `0.5` for each → `32` / `3` defaults (the `Math.floor(n)>=1` guard) | ✅ FIXED |
| BUG-004 | `resolveShrinkTarget` empty `by_content_includes` matches first msg (`src/transforms.ts`) | `resolveShrinkTarget(msgs,{by_content_includes:""})` → `null`, not `0` | ✅ FIXED |
| BUG-005 | `mulligan_audit` runs when `config.enabled===false` (`src/tools/audit.ts`) | With `enabled:false` + persisted markers + `lastFiltered` null (forces the fallback path), audit returns the **"Mulligan is disabled"** refusal and reports **no** active markers / transformed total | ✅ FIXED |
| BUG-006 | Nuclear `last_turn` on first/only user message persists a no-op marker (`src/tools/rewind.ts`) | Single-user-message branch + `granularity:"last_turn", to_previous_prompt:true` → tool **refuses**, **zero** `mulligan:rewind` markers appended, **zero** notes sent | ✅ FIXED |

Methodology note: the shipped unit tests for BUG-001 simulate the consumed state
by *swapping in a fresh ctx* (rewind.test.ts ~L1254), so they never exercise the
two-same-name-targets case through one session. My probe wires a faithful shared
`labelsById` map and confirms the consumption clears **both** targets end-to-end.

---

## Issues found

### Issue 1 — Integration smoke suite is RED: `F-protected` fails after the BUG-006 fix (stale assertion + stale docs)
**Severity:** Major
**ID:** VAL-001
**Locations:**
- `test/integration/run-smoke.mjs` — `assertProtected()` (≈L314–334), specifically
  `const zeroHidden = /0 messages will be hidden/i.test(text);` (L328) and its
  `assert(... "protected rewind hid 0 messages (filter no-op)", zeroHidden ...)` (L329)
- `test/integration/smoke.ts` — the `F-protected` case (≈L232–235) invokes
  `rewindNow(pi, ctx, "smoke-prot-1", "last_turn", { to_previous_prompt: true })`
  with only the `/mulligan_smoke` prompt present (single user message)
- `test/integration/scenarios.md` (L218, L224) — documents the now-stale expectation
- `VERIFICATION.md` (L18, L41) — claims "`npm run smoke` → **14/14 scenarios passed** ✅"

**Description:**
The BUG-006 fix correctly makes a nuclear `last_turn` rewind **refuse before
persisting** when it would cross the first/only user message (spec/08 E3 +
spec/10 §2.1 F-protected), returning `"Mulligan: refused — would cross a
protected message …"`. The integration smoke scenario `F-protected` triggers
exactly that case (single user message + `to_previous_prompt:true`). But the
harness's `assertProtected` was never updated: it still asserts the **pre-fix**
behavior — that the tool *succeeds* with the text `"0 messages will be hidden"`
(filter no-op). After the fix the tool text is a refusal, so the `zeroHidden`
regex no longer matches and the assertion fails.

Consequently `npm run smoke` now exits **1** with `13/14 scenarios passed,
FAILED: F-protected`. This is invisible to the unit suite (956/956 green) — it
only surfaces in the integration harness. The harness's own `NOTE`
("…the tool-refusal case is model-driven") acknowledges the refusal is the real
behavior, but the deterministic assertion was left on the obsolete success path.
`VERIFICATION.md` and `scenarios.md` compound the problem by still claiming the
suite is 14/14 green (a Definition-of-Done item that is now false).

**Why it matters:** `npm run smoke` is the project's documented end-to-end gate
and is listed as a release DoD. A red gate either blocks shipping or, worse,
trains operators to ignore a failing gate. The product code is correct; the
**test + docs are stale** relative to the (correct) BUG-006 fix.

**Steps to reproduce:**
```bash
npm run smoke          # → exits 1
# tail shows:
#   ✗ protected rewind hid 0 messages (filter no-op) — Mulligan: refused — would cross a protected message …
#   FAIL F-protected
#   13/14 scenarios passed
```

**Recommended fix (for the fixer, not applied here):** update `assertProtected`
to expect the refusal (e.g. assert `/refused/i.test(text)` and that **no**
`mulligan:rewind` marker was persisted), refresh the stale comments at
`run-smoke.mjs:318/327` and `smoke.ts:232`, and correct `scenarios.md:218/224`
and the `VERIFICATION.md` 14/14 claim.

---

## Testing summary
- **Total new issues found: 1** (Major)
- **Critical: 0 · Major: 1 · Minor: 0**
- PRD-described bugs: 6/6 already fixed (verified by probe) — not counted as open issues.
- No crashes, no pairing/serialization breakage, no data-loss vectors observed.
- One acceptable, documented trade-off noted (not a bug): the BUG-006 guard also
  refuses a nuclear `last_turn` when the read-only preview *throws* (k falls back
  to 0). This is deliberate fail-safe behavior ("when in doubt, protect the
  original task") and is safe per spec E3; flagged only for completeness.

## How to re-validate
```bash
./validate.sh        # runs typecheck + unit tests + integration smoke (+ optional pi load)
```
The script exits non-zero while VAL-001 is open.