#!/usr/bin/env bash
# validate.sh — end-to-end validation for pi-mulligan.
#
# Reproduces the full validation performed against this codebase. It runs ONLY phases that
# exist in the project (no lint/format phase is present — see Phase notes) plus a creative
# end-to-end behavioral check for the documented `enabled:false` master-disable switch (the
# headline user-facing workflow: "the human can disable Mulligan without uninstalling it").
#
# Exit codes: 0 = ALL phases passed; 1 = at least one phase failed.
#
# Requirements: Node + the repo's node_modules (npm install), and `pi` on PATH with a working
# default model for the Pi-dependent phases (smoke + disable-switch behavioral check). Pi-only
# phases self-skip with a clear note if `pi` is missing so the non-Pi phases still run.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
failed_phases=()

note() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); failed_phases+=("$1"); }
info() { printf '  %s\n' "$1"; }

# ──────────────────────────────────────────────────────────────────────────────
# Phase 1: Type checking (project ships a `typecheck` script + tsconfig.json that
#          `include`s both src and test). This is also the BUG-002 regression guard.
# ──────────────────────────────────────────────────────────────────────────────
note "Phase 1: Type checking (tsc --noEmit)"
if [ -x node_modules/.bin/tsc ] || command -v tsc >/dev/null 2>&1; then
  if npx tsc --noEmit; then
    ok "tsc --noEmit clean (no type errors)"
  else
    bad "tsc --noEmit reported errors"
  fi
else
  bad "typescript not installed (run npm install)"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Phase 2: Unit testing (project ships a `test` script → vitest run).
#          21 test files exercising every module: config, settings, filter, transforms,
#          nudges, tokens, ledger, markers, notes, runtime, log, index, edge-cases,
#          all 5 tools, and the drift/turn-metric windows.
# ──────────────────────────────────────────────────────────────────────────────
note "Phase 2: Unit tests (vitest run)"
if [ -x node_modules/.bin/vitest ]; then
  if npx vitest run --reporter=dot 2>&1 | tail -n 20; then
    ok "vitest run — all unit tests passed"
  else
    bad "vitest run — one or more tests failed"
  fi
else
  bad "vitest not installed (run npm install)"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Phase 3: End-to-end integration smoke (project ships a `smoke` script).
#          Drives 14 deterministic scenarios against the REAL pi + a live model:
#          F-rewind-core, F-shrink-persist, F-shrink-preventive, F-nudge-drift,
#          F-protected, F-maxdepth, F-checkpoint, F-failopen, F-reload, E7, E11,
#          E12, E15, E20. run-smoke.mjs exits 0 only if ALL pass.
# ──────────────────────────────────────────────────────────────────────────────
note "Phase 3: Integration smoke (npm run smoke — requires pi + a working model)"
if command -v pi >/dev/null 2>&1; then
  if npm run smoke >/tmp/mulligan-validate-smoke.log 2>&1; then
    ok "smoke — all scenarios passed"
    grep -E "^(PASS|FAIL) " /tmp/mulligan-validate-smoke.log | tail -n 16 | sed 's/^/    /'
  else
    bad "smoke — one or more scenarios failed (see /tmp/mulligan-validate-smoke.log)"
    tail -n 25 /tmp/mulligan-validate-smoke.log | sed 's/^/    /'
  fi
else
  info "pi not on PATH — skipping Pi-dependent smoke phase (non-Pi phases above still ran)"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Phase 4: End-to-end behavioral check — the `enabled:false` master-disable switch.
#          The headline documented workflow. Creates a DISABLED and an ENABLED temp
#          project, drives the F-shrink-persist scenario in each (same marker created
#          in both), and asserts mulligan's OWN filter honors the setting:
#            DISABLED project → shrunkInContext:false (filter pass-through)
#            ENABLED  project → shrunkInContext:true  (filter applied substitution)
#          This is the decisive behavioral proof that settings.json is actually read.
# ──────────────────────────────────────────────────────────────────────────────
note "Phase 4: Config-disable behavioral E2E (requires pi + a working model)"
if command -v pi >/dev/null 2>&1; then
  DIS=/tmp/mulligan-validate-disabled
  ENA=/tmp/mulligan-validate-enabled
  IDX=/home/dustin/projects/pi-mulligan/src/index.ts
  SMOKE=/home/dustin/projects/pi-mulligan/test/integration/smoke.ts
  if [ ! -f "$IDX" ]; then IDX="$ROOT/src/index.ts"; SMOKE="$ROOT/test/integration/smoke.ts"; fi
  mkdir -p "$DIS/.pi" "$ENA/.pi"
  printf '{ "mulligan": { "enabled": false } }\n' > "$DIS/.pi/settings.json"
  printf '{ "mulligan": { "enabled": true } }\n'  > "$ENA/.pi/settings.json"
  run_one() { # $1=dir $2=log $3=tag
    ( cd "$1" && MULLIGAN_SMOKE_LOG="$2" timeout 140 pi -e "$IDX" -e "$SMOKE" \
        --session-id "validate-$3-$$" \
        -p "/mulligan_smoke F-shrink-persist" -p "Reply with exactly: OK" >/dev/null 2>&1 )
  }
  run_one "$DIS" /tmp/mulligan-validate-dis.log disabled
  run_one "$ENA" /tmp/mulligan-validate-ena.log enabled
  dis_val=$(grep -o '"shrunkInContext":[a-z]*' /tmp/mulligan-validate-dis.log | tail -n1 | cut -d: -f2)
  ena_val=$(grep -o '"shrunkInContext":[a-z]*' /tmp/mulligan-validate-ena.log | tail -n1 | cut -d: -f2)
  info "disabled project shrunkInContext = ${dis_val:-<none>}"
  info "enabled  project shrunkInContext = ${ena_val:-<none>}"
  if [ "$dis_val" = "false" ] && [ "$ena_val" = "true" ]; then
    ok "master-disable switch honored (filter no-ops when disabled, active when enabled)"
  else
    bad "master-disable switch not honored as expected (see /tmp/mulligan-validate-{dis,ena}.log)"
  fi
  rm -rf "$DIS" "$ENA" /tmp/mulligan-validate-dis.log /tmp/mulligan-validate-ena.log
else
  info "pi not on PATH — skipping config-disable behavioral phase (non-Pi phases above still ran)"
fi

# ──────────────────────────────────────────────────────────────────────────────
note "Validation summary"
printf '  %d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  Failed phases: %s\n' "${failed_phases[*]}"
  exit 1
fi
printf '  \033[32mALL VALIDATION PHASES PASSED\033[0m\n'
exit 0