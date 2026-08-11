# Research Notes — P1.M3.T1.S2 (Update README.md to reflect drift-nudge + tool-disabled changes)

**Task**: Sync `README.md` (root, 26 KB, 275 lines) to the post-fix codebase after P1.M1 (BUG-001/002/003)
+ P1.M2 (BUG-004/005/006/007). The contract lists 4 candidate behavioral touchpoints (drift threshold,
suppression window, compaction/pinned-hide, checkpoint-disabled). A precise grep of README.md determines
which actually have stale claims.

---

## A. Precise grep of README.md — which touchpoints have stale claims?

| Touchpoint | Grep result | Verdict |
|---|---|---|
| (a) drift threshold `6000` | **3 hits**: line 98 (table rationale "6k a quiet, accurate trip point", "Raised from the previous 3k"), line 116 (JSON example `"driftThresholdTokens": 6000`), line 95 (`perTurnDrift` row references "token threshold" generically — no number) | **STALE — MUST FIX** (6000 → 4000) |
| (b) suppression window "10 min"/"minutes"/"turn-based" | **0 hits** for "10 min", "minutes", "suppress", "turn-based" | **NO-OP** (README never documented the suppression window) |
| (c) compaction E24 / pinned hide / leak | hits for "compaction"/"leak"/"robust to compaction" — but the only pinned-hide-adjacent claim is line 161 "Target matchers ... robust to compaction" (about SHRINK targets, not pinned hides) and line 246 "Compaction leak (E7)" (transient summary leak, a DIFFERENT issue from BUG-002's pinned-hide-break) | **NO-OP** (README has no claim that pinned hides survive compaction; the E7 note stays accurate) |
| (d) checkpoint + disabled / config.enabled | **2 hits**: line 123 ("Only `checkpoint` remains available as an always-on read-only diagnostic"), line 258 ("BUG-005 ... mulligan_audit now refuses when enabled:false") | **STALE — MUST FIX** (checkpoint is now gated per BUG-007) |

**CONCLUSION**: Only **TWO** of the four touchpoints need edits — (a) drift threshold and (d) checkpoint gate.
Touchpoints (b) and (c) are NO-OPs (the README never made the now-stale claim). The implementing agent
must VERIFY this (don't assume the contract's list maps 1:1 to edits — it's a search directive).

## B. The two REQUIRED edits (verified against post-fix source)

### Edit 1 — BUG-003: drift threshold 6000 → 4000 (3 spots in README)

**Post-fix source facts (verified this session):**
- `src/config.ts:158` → `driftThresholdTokens: 4000` (was 6000).
- `src/nudges.ts:321-322` → `shouldNudge` slices `recentMetrics.slice(0, driftWindowTurns)` and compares
  `avg >= driftThresholdTokens` (the comparison changed from strict `>` to `>=` — BUG-003).
- `src/nudges.ts:296-299` JSDoc proves all three §5.1 criteria now hold with `>=` + 4000:
  `(a) avg([8k,0.5k,0.5k])=3k >= 4k? No → no fire ✓; (b) avg([4k,4k,4k])=4k >= 4k? Yes → fire ✓; (c) avg(~0) >= 4k? No → no fire ✓`.

**README spots to fix:**

1. **Line 98 (table rationale)** — the current text is doubly wrong:
   ```
   | `nudges.driftThresholdTokens` | `6000` | Windowed (`spec/07-preventive-and-nudges.md` §5.1) per-turn token delta that triggers the drift nudge. Raised from the previous 3k default after live use showed 3k false-positived on routine multi-file reads; the §5.1 windowing is what makes 6k a quiet, accurate trip point. |
   ```
   - The Default cell says `6000` → change to `4000`.
   - The rationale ("Raised from 3k... makes 6k a quiet trip point") is now FALSE. The real story: the
     threshold was lowered 6000→4000 AND the comparison changed `>`→`>=` to satisfy §5.1 criterion (b)
     ("three ~4k turns in a row DO fire"). With 6000+`>`, `avg([4k,4k,4k])=4k` did NOT fire. Rewrite the
     rationale to reflect this (lowered to 4000 so the windowed moving-average + `>=` fires on sustained
     ~4k/turn growth per §5.1 (b), while still suppressing single heavy turns per §5.1 (a)).

2. **Line 116 (JSON example)** — `"driftThresholdTokens": 6000` → `4000`.

3. **Line 95 (`perTurnDrift` row)** — references "token threshold" generically (no number); NO number
   change needed, but verify it doesn't imply a specific value. (It says "when a turn grew past the token
   threshold" — accurate and value-agnostic; LEAVE AS-IS.)

### Edit 2 — BUG-007: checkpoint is now gated (1 spot in README, but the whole Disabling sentence)

**Post-fix source facts (verified this session):**
- `src/tools/checkpoint.ts:27-28` JSDoc + `:138` code: `if (!getConfig().enabled)` → refuses with
  `"Mulligan: refused — Mulligan is disabled."` BEFORE name validation (no label written).
- This is the SAME gate + SAME refusal text as the other four tools (rewind/shrink/audit/cancel).

**README spot to fix — line 123 (the Disabling paragraph):**
```
`enabled: false` makes the **entire extension a no-op**: no context transform (the filter passes messages through untouched), the nudges are inert, and the four state-affecting tools refuse cleanly with `Mulligan: refused — Mulligan is disabled.` (`rewind`, `shrink`, `cancel`, **and `audit`** all gate on the master switch — audit refuses when disabled while staying read-only). Only `checkpoint` remains available as an always-on read-only diagnostic (it sets a harmless label, no transform). The human can disable Mulligan without uninstalling it.
```
This is now FALSE on TWO counts:
- "the **four** state-affecting tools" → now **five** (checkpoint joined the gated set).
- "Only `checkpoint` remains available as an always-on read-only diagnostic (it sets a harmless label,
  no transform)" → checkpoint now refuses like the others (BUG-007); no tool stays available when disabled.

**Rewrite**: all FIVE tools (rewind/shrink/audit/cancel/checkpoint) now refuse with the standard text
when `enabled: false`; the filter passes through; the nudges are inert. There is no "always-on" exception.
(The audit remains read-only in its normal operation, but it too refuses when disabled.)

## C. The two NO-OP touchpoints (verify, don't edit)

### (b) suppressCheck suppression window (BUG-001) — NO README claim exists
README's drift-nudge description (line 225) describes WHAT the nudge does (windowed delta, §5.1) but
NEVER mentions the post-rewind/shrink suppression window (the old 10-min wall-clock, now turn-based).
Since README never documented the suppression mechanic, there is nothing stale to fix. **The contract
explicitly says: "If README does not reference these specifics, no changes needed."** Do NOT add a new
description of the suppression — that would be scope-creep (the implementing subtask S1.M1.T1 owns the
code; README describes user-facing behavior, and the suppression is an internal correctness detail that
was never user-documented). LEAVE IT.

### (c) compaction/pinned-hide (BUG-002) — the README claims are about a DIFFERENT issue
- Line 246 documents "Compaction leak (E7)" — Pi's auto-compaction may transiently leak a hidden span via
  its summary. This is E7 (a transient summary leak), NOT BUG-002 (pinned hides becoming no-ops post-
  compaction). The E7 note remains accurate and is unaffected by BUG-002.
- Line 161 "Target matchers (resolved live each turn, robust to compaction)" — about SHRINK target
  resolution (live re-match each turn), not pinned-hide permanence.
- README makes NO claim that pinned hides survive compaction (the BUG-002 finding). So there's nothing
  stale. The fix (compaction-aware retained-tail walk) is an internal correctness improvement; README
  doesn't document the pinned-hide-vs-compaction interaction. LEAVE IT. (If a maintainer later wants to
  DOCUMENT the now-fixed behavior, that's a separate task — not this sync.)

## D. Scope discipline — what NOT to touch

- **`src/*`, `test/*`** → the fixes' owners (P1.M1/P1.M2); READ-ONLY.
- **`VERIFICATION.md`** → sibling P1.M3.T1.S1 (owns the DoD #4 + checkpoint-note + fix-log table there).
- **`spec/*`** → READ-ONLY (spec/07 §5.1, spec/08 E7/E14, spec/05 §3 are the cited authorities).
- **The "Resolved bugs (BUG-001–BUG-006)" table at README lines 255-260** — this is a PRIOR round's
  history (checkpoint-consumption, config-floor, empty-needle, audit-gate, etc.). The CURRENT round
  ALSO numbers BUG-001..BUG-007 but for DIFFERENT issues. **Do NOT overwrite or edit the prior table.**
  (If a new "Resolved bugs" entry for THIS round is desired, that's a judgment call — see PRP §What. The
  minimal/safe path is to NOT add a round-2 table to README; S1 adds the round-2 fix-log to VERIFICATION.md
  where the prior round's table already lives. README's prior table stays as accurate history.)

## E. Validation gates (confirmed green at research time)

- `npm run typecheck` (= `tsc --noEmit`): exits 0. A README edit cannot affect this; run as no-regression sanity.
- `npx vitest run`: suite green (the bug fixes landed in P1.M1/P1.M2 with regression tests). Unaffected by README.
- `grep -n "6000" README.md`: after Edit 1, should return 0 hits (or only non-driftThreshold hits — verify).
- `grep -niE "always-on|checkpoint.*remains available|four state-affecting" README.md`: after Edit 2, 0 hits.
- Scope guard: `git status --short` shows ONLY `README.md`.

## F. Cross-references used

- `README.md` — the edit target (lines 95-116 config table, 118-124 Disabling, 240-260 limitations).
- `src/config.ts:158` — driftThresholdTokens=4000 (BUG-003).
- `src/nudges.ts:321-322,296-299` — shouldNudge `>=` comparison + §5.1 criteria proof.
- `src/tools/checkpoint.ts:27-28,138` — getConfig().enabled gate (BUG-007).
- `plan/.../architecture/system_context.md` — the 7 bug descriptions (fix-log source of truth for S1).
- Sibling P1.M3.T1S1 PRP — owns VERIFICATION.md; confirms no file overlap (README is S2's).
- spec/07-preventive-and-nudges.md §5.1 — the three drift-nudge acceptance criteria (the BUG-003 authority).
- spec/08-edge-cases.md E14 — the "tools refuse when disabled" contract (the BUG-007 authority).