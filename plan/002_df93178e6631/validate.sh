#!/usr/bin/env bash
# =============================================================================
# validate.sh — pi-mulligan comprehensive validation
#
# Phases (only those that exist in this repo are included):
#   1. Type checking        — `tsc --noEmit` (strict; the ONLY static check —
#                              there is no eslint/prettier/biome config)
#   2. Unit testing         — `vitest run` (pure-logic + tool/resolver coverage)
#   3. Integration smoke    — `npm run smoke` (14 deterministic Pi E2E scenarios)
#   4. §2.3 invariants      — entry-type rules + ZERO persisted mulligan:nudge
#   5. Zero-config load     — extension loads with NO mulligan config block
#
# KNOWN HARNESS CHARACTERISTIC (see validation_report.md FINDING 1):
#   `npm run smoke` is NOT idempotent. Each scenario uses a STABLE
#   `--session-id smoke-<scenario>`, so Pi APPENDS to the same session JSONL on
#   every run. Accumulated SEED_HIDDEN assistant replies from prior runs defeat
#   the "seed fully hidden" guard on F-rewind-core / F-checkpoint (the
#   BUG-001/002/003 regression guards), producing FALSE failures on the 2nd+ run.
#   This script therefore WIPES the smoke session files FIRST (Phase 3 precondition)
#   so the smoke phase is reproducible. A v1.1 harness fix would use a
#   run-scoped unique --session-id per scenario.
#
# Exit status: 0 only if every phase passes. A summary is printed at the end.
# =============================================================================
set -uo pipefail

# Run the suite from the repo root regardless of where it is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PROJECT_SESSION_DIR="$HOME/.pi/agent/sessions/--home-dustin-projects-pi-mulligan--"

# Color/lightweight helpers (works on no-color terminals too).
mark_pass() { echo "✓ PASS  — $1"; }
mark_fail() { echo "✗ FAIL  — $1"; }
section()   { echo; echo "════════ PHASE $1: $2 ════════"; }

FAIL=0
fail() { FAIL=$((FAIL + 1)); }

# Quick precondition: is `pi` available (needed for Phase 3 + 5)?
have_pi=1
command -v pi >/dev/null 2>&1 || have_pi=0
if [ "$have_pi" -eq 0 ]; then
  echo "NOTE: \`pi\` not on PATH — Phase 3 (smoke) and Phase 5 (zero-config load) will be SKIPPED."
  echo "      (Phase 1 + 2 + 4 still run.)"
fi

# -----------------------------------------------------------------------------
# PHASE 1 — Type checking (tsc, strict)
# -----------------------------------------------------------------------------
section 1 "Type checking — tsc --noEmit (strict)"
if npx tsc --noEmit; then
  mark_pass "tsc --noEmit (strict) is clean"
else
  mark_fail "tsc --noEmit reported errors"
  fail
fi

# -----------------------------------------------------------------------------
# PHASE 2 — Unit tests (vitest)
# -----------------------------------------------------------------------------
section 2 "Unit tests — vitest run"
# Capture full output, surface a concise verdict. vitest exits non-zero on any failure.
if vitest_out="$(npx vitest run 2>&1)"; then
  mark_pass "vitest run — all tests passed"
else
  mark_fail "vitest run — one or more tests FAILED (see below)"
  fail
fi
# Always print the per-file summary + any failure block so failures are visible.
echo "$vitest_out" | grep -E "Test Files|Tests |FAIL |❯ test" || true
echo "$vitest_out" | sed -n '/⎯⎯⎯.*Failed Tests/,/⎯⎯⎯\[1\/1\]⎯/p' || true

# -----------------------------------------------------------------------------
# PHASE 3 — Integration smoke (deterministic Pi E2E)
# -----------------------------------------------------------------------------
section 3 "Integration smoke — npm run smoke (14 scenarios)"
if [ "$have_pi" -eq 0 ]; then
  echo "SKIP — \`pi\` not available"
else
  # PRECONDITION: wipe accumulated smoke sessions so the suite is reproducible.
  # Without this, F-rewind-core + F-checkpoint flake on the 2nd+ run (FINDING 1).
  if [ -d "$PROJECT_SESSION_DIR" ]; then
    rm -f "$PROJECT_SESSION_DIR"/*smoke-*.jsonl
    echo "      (cleared accumulated smoke session files for a reproducible run)"
  fi
  rm -rf /tmp/mulligan-smoke  # smoke per-scenario log dir

  if smoke_out="$(npm run smoke 2>&1)"; then
    mark_pass "npm run smoke — 14/14 scenarios passed (on clean state)"
  else
    mark_fail "npm run smoke — one or more scenarios FAILED (see below)"
    fail
  fi
  echo "$smoke_out" | grep -E "PASS |FAIL |scenarios passed|FAILED:" || true
fi

# -----------------------------------------------------------------------------
# PHASE 4 — §2.3 invariants on the smoke session JSONLs
#   (a) mulligan:rewind / shrink / turn-metric MUST be type:custom (NOT in context)
#   (b) mulligan:note MUST be type:custom_message (IN context)
#   (c) mulligan:checkpoint: labels MUST be type:label
#   (d) ZERO mulligan:nudge entries persisted on disk (nudges are ephemeral)
# -----------------------------------------------------------------------------
section 4 "§2.3 invariants — entry types + ZERO persisted mulligan:nudge"
inv_ok=1
if [ -d "$PROJECT_SESSION_DIR" ]; then
  files=( "$PROJECT_SESSION_DIR"/*smoke-*.jsonl )
  if [ "${#files[@]}" -eq 0 ]; then
    echo "      (no smoke session JSONLs found — run Phase 3 first)"
  else
    # (d) the headline invariant: nudges are NEVER persisted.
    nudge_count=$(grep -h '"customType":"mulligan:nudge"' "${files[@]}" 2>/dev/null | wc -l)
    if [ "$nudge_count" -eq 0 ]; then
      mark_pass "ZERO persisted mulligan:nudge across ${#files[@]} smoke session file(s)"
    else
      mark_fail "$nudge_count persisted mulligan:nudge entries found (nudges MUST be ephemeral)"
      inv_ok=0; fail
    fi

    # (a) markers must be type:custom
    bad_markers=$(grep -hE '"customType":"mulligan:(rewind|shrink|turn-metric)"' "${files[@]}" 2>/dev/null \
                  | grep -cv '"type":"custom"')
    if [ "$bad_markers" -eq 0 ]; then
      mark_pass "all mulligan:rewind/shrink/turn-metric entries are type:custom"
    else
      mark_fail "$bad_markers marker entries are NOT type:custom"
      inv_ok=0; fail
    fi

    # (b) notes must be type:custom_message
    bad_notes=$(grep -h '"customType":"mulligan:note"' "${files[@]}" 2>/dev/null \
                | grep -cv '"type":"custom_message"')
    if [ "$bad_notes" -eq 0 ]; then
      mark_pass "all mulligan:note entries are type:custom_message"
    else
      mark_fail "$bad_notes note entries are NOT type:custom_message"
      inv_ok=0; fail
    fi

    # (c) checkpoint labels must be type:label
    bad_labels=$(grep -hE '"label":"mulligan:checkpoint:' "${files[@]}" 2>/dev/null \
                 | grep -cv '"type":"label"')
    if [ "$bad_labels" -eq 0 ]; then
      mark_pass "all mulligan:checkpoint: labels are type:label"
    else
      mark_fail "$bad_labels checkpoint labels are NOT type:label"
      inv_ok=0; fail
    fi
  fi
else
  echo "      (no project session dir — invariant phase needs Phase 3 to have run)"
fi

# -----------------------------------------------------------------------------
# PHASE 5 — Zero-config load (spec/11 §2 Step 9 acceptance check)
#   The extension must LOAD with no `mulligan` config block and no factory error.
# -----------------------------------------------------------------------------
section 5 "Zero-config load — pi -e ./src/index.ts (spec/11 §2 Step 9)"
if [ "$have_pi" -eq 0 ]; then
  echo "SKIP — \`pi\` not available"
else
  # Load-only acceptance: a load failure prints "Error loading extension" / a stack
  # trace from the factory. We do NOT require a model response (model/API errors
  # happen AFTER the factory ran and are not load failures).
  load_out="$(pi -e ./src/index.ts -p 'Reply with the single word: ok' 2>&1)"
  if echo "$load_out" | grep -qiE 'Error loading extension|TypeError|at .*src/index'; then
    mark_fail "extension failed to load (factory error detected in output)"
    fail
    echo "$load_out" | grep -iE 'Error loading extension|TypeError|at ' | head -5
  else
    mark_pass "extension loaded cleanly with zero config (no factory error)"
  fi
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo
echo "════════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  RESULT: ALL PHASES PASSED"
else
  echo "  RESULT: $FAIL PHASE(S) REPORTED FAILURES — see validation_report.md"
fi
echo "════════════════════════════════════════════════════════════"
exit "$FAIL"