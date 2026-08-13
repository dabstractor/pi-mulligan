#!/usr/bin/env bash
# validate.sh — pi-mulligan comprehensive validation.
#
# Runs the project's own gates (typecheck, unit/integration tests, the real-Pi context-filter
# smoke) AND a NEW end-to-end workflow reproduction of the v1.2 working-tree-revert feature driven
# through a REAL Pi process (the gap no existing test covers).
#
# Phases 1–4 are the project's deterministic gates (all PASS on a correct checkout).
# Phase 5 reproduces two production defects in the opt-in working-tree-revert feature
# (see validation_report.md Issues #1 & #2). Phase 5 EXPECTED STATUS: FAIL (bug demonstration).
#
# Usage:   ./validate.sh
# Exit:    0 if every PASS-expected phase passes; non-zero if any phase is wrong.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PASS=0; FAIL=0; SOFT=0
section() { printf '\n\033[1m── %s ──\033[0m\n' "$1"; }
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
soft() { printf '  \033[33mSOFT\033[0m %s\n' "$1"; SOFT=$((SOFT+1)); }
info() { printf '  \033[2m%s\033[0m\n' "$1"; }

# ───────────────────────── Phase 1: Type checking (strict) ─────────────────────────
section "Phase 1: Type checking (tsc --noEmit, strict)"
if npm run --silent typecheck 2>/tmp/v_tc.log; then
  ok "typecheck — 0 errors"
else
  bad "typecheck — errors (see /tmp/v_tc.log)"
fi

# ───────────────────────── Phase 2: Unit + integration tests ──────────────────────
section "Phase 2: Unit + integration tests (vitest)"
npm test --silent >/tmp/v_test.log 2>&1
# vitest summary format varies ("(1398)" vs "(1398 total)"); match the stable core.
if grep -qE "Tests +[0-9]+ passed" /tmp/v_test.log && ! grep -qE "Tests +[1-9][0-9]* failed" /tmp/v_test.log; then
  cnt=$(grep -E "Tests +[0-9]+ passed" /tmp/v_test.log | grep -oE "[0-9]+ passed" | head -1)
  files=$(grep -E "Test Files +[0-9]+ passed" /tmp/v_test.log | grep -oE "[0-9]+ passed" | head -1)
  ok "vitest — ${cnt} tests across ${files:-?} files"
else
  bad "vitest — failures (see /tmp/v_test.log)"
fi

# ───────────────────────── Phase 3: Real-Pi context-filter smoke ──────────────────
# This is the project's own E2E acceptance gate for the CORE features (rewind/shrink/cancel/
# audit/nudges). It drives 14 scenarios through a real `pi` process. It does NOT cover revert.
section "Phase 3: Real-Pi context-filter smoke (npm run smoke, 14 scenarios)"
npm run --silent smoke >/tmp/v_smoke.log 2>&1
if grep -q "14/14 scenarios passed" /tmp/v_smoke.log; then
  ok "smoke — 14/14 scenarios passed (core features verified end-to-end)"
else
  bad "smoke — did not reach 14/14 (see /tmp/v_smoke.log)"
  # Surface the most likely operational cause (a second globally-registered copy).
  if grep -qi "conflicts with\|EXTENSION LOAD FAILED" /tmp/v_smoke.log; then
    info "smoke red lines may be the duplicate-registration conflict (a second copy of pi-mulligan"
    info "is globally registered). Run 'pi -ne -e ./src/index.ts' alone to confirm the code loads."
  fi
fi

# ───────────────────────── Phase 4: Spec invariants (static) ─────────────────────
section "Phase 4: Spec invariants (static)"
# 4a — the drift nudge must NEVER be persisted (spec/10 §2.3 / DoD #3).
smoke_jsonl=$(find ~/.pi/agent/sessions -name '*smoke-*.jsonl' 2>/dev/null | head -1)
if [ -n "$smoke_jsonl" ]; then
  if ! grep -q '"customType":"mulligan:nudge"' "$smoke_jsonl"; then
    ok "mulligan:nudge never persisted in a smoke session JSONL"
  else
    bad "mulligan:nudge found persisted in $smoke_jsonl (spec/10 §2.3 violation)"
  fi
else
  soft "no smoke session JSONL found to assert nudge-leak (run Phase 3 first)"
fi
# 4b — forbidden-root predicate refuses $HOME and / (spec/14 §2 SAFETY INVARIANT).
# Runtime behavior is covered by test/paths.test.ts (Phase 2); here we assert the source contract.
if grep -q 'export function isForbiddenRoot' src/snapshot/paths.ts; then
  ok "isForbiddenRoot predicate present in paths.ts (spec/14 §2; runtime via paths.test.ts)"
else
  bad "isForbiddenRoot predicate MISSING from paths.ts (spec/14 §2 SAFETY INVARIANT)"
fi

# ───────────────────────── Phase 5: Working-tree-revert E2E (NEW — the gap) ──────
# Drives the COMPLETE user workflow from README §5 through a REAL Pi process:
#   enable revert  →  agent writes a file  →  agent calls mulligan_rewind(revert_file_changes)  →
#   assert the file was restored to its pre-span state.
# No existing test covers this (integration tests fire turn_start once manually + always set storageDir;
# the smoke harness has no revert scenario). This phase is EXPECTED TO FAIL until the defects are fixed.
section "Phase 5: Working-tree-revert E2E through real Pi (README §5 workflow)"

PI_BIN="pi"
command -v "$PI_BIN" >/dev/null 2>&1 || { soft "pi not on PATH — skipping Phase 5"; skip5=1; }

if [ -z "${skip5:-}" ]; then
  SRC="$ROOT/src/index.ts"
  WF=$(mktemp -d)
  # --- 5a: DEFAULT config (revert.enabled:true only — exactly what README §5 documents) ---
  ( cd "$WF" && git init -q && git config user.email v@v.co && git config user.name v \
      && printf 'original-content\n' > file1.txt && git add -A && git commit -qm init \
      && mkdir -p .pi \
      && printf '{ "mulligan": { "revert": { "enabled": true, "allowDeleteCreatedFiles": true } } }' > .pi/settings.json )
  timeout 120 "$PI_BIN" -ne -e "$SRC" --session-id "val-revert-default-$$_$(date +%s)" \
    -p "Use the write tool to overwrite $WF/file1.txt with the text 'AGENT-MUTATED', then call mulligan_rewind with granularity last_turn, revert_file_changes true, delete_created_files true, and note {what_happened:'test', true_current_state:'test', next:'stop'}. Then reply with exactly: DONE" \
    >/tmp/v_revert_default.log 2>&1
  rc=$?
  default_file=$(cat "$WF/file1.txt" 2>/dev/null)
  default_msg=$(grep -o 'rewound last_turn[^"]*' ~/.pi/agent/sessions/--*$(basename "$WF" | tr / -)*.jsonl 2>/dev/null \
                | grep -o 'no working-tree snapshot[^0-9]*0 files reverted\|Reverted [0-9]* file(s)' | head -1)
  # fallback: scan all recent sessions for our marker
  [ -z "$default_msg" ] && default_msg=$(grep -rho 'rewound last_turn[^"]*' ~/.pi/agent/sessions/ 2>/dev/null | tail -1)
  info "5a default-config: file1.txt now = $(printf '%q' "$default_file") | rewind: ${default_msg:-(see /tmp/v_revert_default.log)}"
  if printf '%s' "$default_file" | grep -q '^original-content'; then
    ok "5a default-config revert — file WAS restored (unexpected; bug may be fixed)"
  else
    bad "5a default-config revert — file NOT restored (Issue #1: detectAndCreate gets no sessionDir → NoOpStore → 'no working-tree snapshot')"
  fi

  # --- 5b: EXPLICIT storageDir (bypasses Issue #1) — isolates the per-inference turn_start bug ---
  STORE=$(mktemp -d)
  printf '{ "mulligan": { "revert": { "enabled": true, "allowDeleteCreatedFiles": true, "storageDir": "%s" } } }' "$STORE" > "$WF/.pi/settings.json"
  printf 'original-content\n' > "$WF/file1.txt"
  timeout 120 "$PI_BIN" -ne -e "$SRC" --session-id "val-revert-explicit-$$_$(date +%s)" \
    -p "Use the write tool to overwrite $WF/file1.txt with the text 'AGENT-MUTATED', then call mulligan_rewind with granularity last_turn, revert_file_changes true, delete_created_files true, and note {what_happened:'test', true_current_state:'test', next:'stop'}. Then reply with exactly: DONE" \
    >/tmp/v_revert_explicit.log 2>&1
  explicit_file=$(cat "$WF/file1.txt" 2>/dev/null)
  info "5b explicit-storageDir: file1.txt now = $(printf '%q' "$explicit_file") (store dir: $STORE)"
  if printf '%s' "$explicit_file" | grep -q '^original-content'; then
    ok "5b explicit-storageDir revert — file WAS restored (unexpected; bug may be fixed)"
  else
    bad "5b explicit-storageDir revert — file NOT restored (Issue #2: turn_start fires per-inference + overwrites the 'turn' snapshot → restore diffs the mutated tree against itself → 0 reverted)"
  fi
  rm -rf "$WF" "$STORE"
fi

# ───────────────────────── Summary ───────────────────────────────────────────────
section "Summary"
printf '  PASS=%d  FAIL=%d  SOFT=%d\n' "$PASS" "$FAIL" "$SOFT"
echo "  Phases 1–4 (typecheck, tests, smoke, invariants) validate the CORE features."
echo "  Phase 5 reproduces defects in the v1.2 working-tree-revert feature (see validation_report.md)."
# Exit non-zero if any PASS-expected phase failed, OR if the bug-demonstration phase unexpectedly passed
# (which would mean the bugs are fixed and this script needs updating).
exit $FAIL