# pi-mulligan — Validation Report

**Validation target:** `pi-mulligan` v1.1 (Pi `0.84.x` extension for autonomous context self-rewind)
**Date:** 2025-08-12
**Validator:** automated `validate.sh` + deep manual codebase analysis

---

## TL;DR — Verdict

**No Critical or Major issues. 4 Minor issues found.** The codebase is production-quality: strict `tsc` typecheck passes, **1033 unit tests pass (23 suites)**, all **14 real-`pi -p` E2E smoke scenarios pass**, and the zero-config extension load (spec/11 §2 Step 9 acceptance) boots and replies correctly. The live mulligan extension was observed functioning correctly throughout this validation session — the **bloat reminder** fired on large `read` results, and the **drift nudge** fired correctly on sustained context growth. All 7 previously-identified bugs (BUG-001…BUG-007 across two remediation rounds) are resolved with regression tests.

The 4 findings are all Minor: one documentation/spec drift, one repo-hygiene stray file, one cosmetic style-rule violation, and one advisory-UX wart. None affect correctness, compilation, tests, or runtime behavior.

---

## How the codebase was validated

| Phase | Gate | Result |
|---|---|---|
| 1 — Linting | *(none — no eslint/prettier, intentional per VERIFICATION.md #3 + `.editorconfig` header)* | n/a |
| 2 — Type checking | `npm run typecheck` (`tsc --noEmit`, strict, `noImplicitAny`) | ✅ PASS |
| 3 — Style | `.editorconfig` sanity (no tabs, no trailing whitespace, final newline) | ⚠ tabs/whitespace clean; **final-newline rule violated (Minor #4)** |
| 4 — Unit testing | `npm test` (vitest run) | ✅ **1033/1033 pass, 23 suites** |
| 5 — End-to-end | `npm run smoke` (14 real `pi -p` scenarios) + zero-config load | ✅ **14/14 smoke scenarios pass**; zero-config load replies `OK` |
| 6 — Repo hygiene & spec/code consistency | targeted checks | ⚠ **2 findings (Minor #1, #2)** + ✅ tool/command inventory matches PRD v1.1 (4 tools + 3 commands); ✅ no persisted `mulligan:nudge` in tracked JSONL (spec §2.3 invariant holds) |

### E2E coverage (the 14 integration scenarios — real `pi -p` runs)
`F-rewind-core`, `F-shrink-persist` (incl. E19 user-message shrink + on-disk survival), `F-shrink-preventive`, `F-nudge-drift`, `F-protected`, `F-maxdepth`, `F-checkpoint` (incl. BUG-003 set/rewind + auto-expiry/consumption), `F-failopen` (filter pass-through), `F-reload` (marker survival across `--session-id`), `E7` (compaction-leak known limitation), `E11` (reload mid-task), `E12` (`getContextUsage` undefined → E16 fallback), `E15` (50 markers — filter terminates), `E20` (appendEntry/sendMessage ordering).

---

## Issues found

### Minor #1 — Spec/code drift: `driftThresholdTokens` default is 6000 in the spec but 4000 in the code
- **Severity:** Minor (documentation consistency — no functional defect).
- **Evidence:**
  - `spec/09-configuration.md` line 45 (JSON example) **and** line 84 (rationale table) both document the default as **`6000`**.
  - `src/config.ts:168` ships **`4000`**; `README.md` (defaults table) documents **`4000`**.
- **Context:** The change is **intentional and well-documented** as the "BUG-003 (round 2)" fix in `VERIFICATION.md`: the default was lowered 6000→4000 **and** the comparison changed from `>` to `>=` so that spec/07 §5.1 acceptance criterion (b) — *"three ~4k turns in a row DO fire"* — actually holds (at 6000 with strict `>`, `avg([4000,4000,4000])=4000` never fired). The code is self-consistent and has a regression test (`test/drift_nudge.test.ts`). The **input PRD also states 6000**.
- **Impact:** A maintainer/reader following `spec/09-configuration.md` expects 6000; the shipped behavior is 4000. Pure documentation-companion drift.
- **Recommendation:** Update `spec/09-configuration.md` (JSON example L45 + rationale row L84) from `6000` to `4000`, matching the code and README.

### Minor #2 — Stray empty file `=` is tracked in git at the repo root
- **Severity:** Minor (repo hygiene).
- **Evidence:** `git ls-files --error-unmatch '='` succeeds; the file is **0 bytes**; introduced in commit `250b49ee` ("Fix sustained drift nudge miss via threshold lower").
- **Context:** Almost certainly an accidental commit from a shell redirection mishap (e.g. `git add = …` or a stray `> =`). It is **excluded from the published npm package** (`package.json "files"` whitelists `src`/`README.md`/`LICENSE`), so consumers are unaffected.
- **Impact:** Repo noise; would briefly confuse a fresh cloner. No build/test/runtime effect.
- **Recommendation:** `git rm =`.

### Minor #3 — Drift-nudge rendered text reports the latest single-turn delta, but the nudge fires on the windowed average (UX wart)
- **Severity:** Minor (advisory-UX; spec-consistent, not a violation).
- **Evidence:**
  - `shouldNudge` (`src/nudges.ts`) fires when the **windowed moving-average** of `deltaTokens` over `driftWindowTurns` (default 3) is `>= driftThresholdTokens` (4000).
  - `renderDriftNudge` / the injected nudge text reports **only the latest single turn's** delta: `"Previous turn added ~Xk tokens to your context. …"`.
  - **Observed live during this validation:** the drift nudge fired multiple times while the rendered text said `"~0.7k"`, `"~0.8k"`, `"~0.9k"`, and `"~1.2k"` tokens — all well below the 4000 threshold — because the windowed average (driven by earlier large `read` calls) was still `>= 4000`.
- **Context:** This is **spec-consistent** — spec/07 §2 `renderDriftNudge` only references the latest metric — so it is *not* a spec violation. But it is a genuine readability wart: an agent reading "0.8k tokens added" while the nudge fires is misleading (0.8k alone would not trip it), and the message gives no hint that *sustained/windowed* growth is the true trigger.
- **Impact:** Low — the nudge is advisory (D3); no data loss or correctness impact. Possible mild agent confusion about why it fired.
- **Recommendation (low priority):** When the latest single-turn delta is below threshold but the windowed average trips the nudge, append a clause like "(sustained over the last N turns)" to the rendered text, or report the windowed average instead. Pure advisory polish.

### Minor #4 — `src/*.ts` files lack a trailing newline, violating the project's own `.editorconfig`
- **Severity:** Minor (cosmetic style-rule violation).
- **Evidence:** All **19** TypeScript files under `src/` end without a final newline (last byte is `}` or `;`), but `.editorconfig` specifies `insert_final_newline = true`.
- **Context:** No functional/build/test impact — `tsc`, `vitest`, and the smoke suite all pass. Purely a self-inconsistent style rule (the project ships no formatter by design, so the rule is unenforced).
- **Recommendation:** One-time normalize: `for f in $(find src -name '*.ts'); do printf '\n' >> "$f"; done`, **or** relax the `.editorconfig` rule to match actual practice.

---

## Verified non-issues (documented for completeness)

- **No eslint/prettier CI** — **intentional.** `.editorconfig` header and `VERIFICATION.md` #3 explicitly state a full eslint/prettier pass was deliberately omitted "to avoid churning the clean hand-formatted diff." `.editorconfig` covers the lowest-common-denominator drift vectors. Source is clean: **no tab characters, no trailing whitespace, no `TODO`/`FIXME`/`HACK`/`XXX` markers** in `src/`.
- **BUG-001…BUG-007** — all **resolved** with regression tests (per `VERIFICATION.md` two remediation rounds). No regression observed in this validation.
- **`.pi/` and `.pi-subagents/`** artifact directories — **not git-tracked** (harness-generated session/transcript artifacts); correctly absent from version control.
- **`plan/`** directory — tracked (455 files) but is read-only planning material; outside this validation's scope and untouched.
- **Architecture matches the PRD v1.1 surface:** `src/index.ts` registers exactly **4 agent-callable tools** (`mulligan_rewind`, `mulligan_shrink`, `mulligan_audit`, `mulligan_cancel`) and **3 human slash commands** (`/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit`) — verified by `validate.sh` Phase 6c. The removed `mulligan_checkpoint` agent tool (E23) and the removed `to_previous_prompt` option are gone; the active-checkpoint banner, agent-attributable drift delta (D10), and pinned-hide permanent soft-delete (BUG-001/002 fixes) are all present.
- **Spec §2.3 invariant holds:** zero persisted `mulligan:nudge` entries in any tracked session JSONL (the nudge is constructed in the filter copy only).

---

## Summary table

| # | Severity | Area | Finding |
|---|---|---|---|
| 1 | Minor | Docs/spec drift | `driftThresholdTokens`: spec/09 says 6000, code ships 4000 (documented BUG-003 fix; spec not updated) |
| 2 | Minor | Repo hygiene | Stray empty `=` file tracked in git (0 bytes; commit 250b49ee) |
| 3 | Minor | UX (advisory) | Drift-nudge text reports latest single-turn delta but fires on windowed average (spec-consistent; misleading) |
| 4 | Minor | Cosmetic | 19 `src/*.ts` files lack a trailing newline (`.editorconfig` violation) |

**Totals:** Critical 0 · Major 0 · Minor 4 · **Total issues: 4**