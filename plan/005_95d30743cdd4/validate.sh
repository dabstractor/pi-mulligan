#!/usr/bin/env bash
# validate.sh — Comprehensive validation for pi-mulligan.
#
# Runs every applicable phase (lint / typecheck / style / unit / E2E) and reports a
# pass/fail summary. Exits 0 only if EVERY phase that exists in this codebase passes.
#
# This codebase is a Pi extension (TypeScript, no build step — jiti transpiles at load).
# There is NO eslint/prettier config (Phases 1 & 3 are intentionally absent — noted, not
# failed). The authoritative gates are: tsc --noEmit (types), vitest (943 unit tests),
# and `npm run smoke` (14 integration scenarios driven against a real `pi` binary).
#
# Usage:  ./validate.sh
# Env:    PI must be on PATH (the smoke phase shells out to `pi`). `node` + `npx` required.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Color helpers (disabled when not a TTY).
if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; N=$'\033[0m'
else
  G=""; R=""; Y=""; D=""; N=""
fi

PASS=0; FAIL=0; SKIP=0
section() { printf '\n%s════ %s ════%s\n' "$Y" "$1" "$N"; }
ok()      { printf '  %s✓ PASS%s  %s\n' "$G" "$N" "$1"; PASS=$((PASS+1)); }
bad()     { printf '  %s✗ FAIL%s  %s\n' "$R" "$N" "$1"; FAIL=$((FAIL+1)); }
skip()    { printf '  %s⊘ SKIP%s  %s\n' "$Y" "$N" "$1"; SKIP=$((SKIP+1)); }

printf '%s╔═══════════════════════════════════════════════════════════════╗%s\n' "$Y" "$N"
printf '%s║  pi-mulligan — comprehensive validation                     ║%s\n' "$Y" "$N"
printf '%s╚═══════════════════════════════════════════════════════════════╝%s\n' "$Y" "$N"
printf 'Root: %s\n' "$ROOT"

# ─── Prerequisite checks ─────────────────────────────────────────────────────
section "Prerequisites"
command -v node >/dev/null 2>&1 && ok "node: $(node --version)" || { bad "node not found (required)"; exit 1; }
command -v npx  >/dev/null 2>&1 && ok "npx available"            || { bad "npx not found (required)"; exit 1; }
[ -d node_modules ] && ok "node_modules present" || {
  printf '  %s!%s node_modules missing — running %snpm install%s first\n' "$Y" "$N" "$D" "$N"
  npm install >/tmp/mulligan-validate-npm-install.log 2>&1 \
    && ok "npm install completed" \
    || { bad "npm install failed (see /tmp/mulligan-validate-npm-install.log)"; exit 1; }
}
command -v pi >/dev/null 2>&1 && ok "pi: $(pi --version 2>&1 | head -1)" \
  || { printf '  %s!%s pi not on PATH — E2E (smoke) phase will be skipped\n' "$Y" "$N"; }

# ─── Phase 1: Linting ────────────────────────────────────────────────────────
section "Phase 1 — Linting"
if ls .eslintrc* eslint.config.* 2>/dev/null | grep -q . || grep -q '"eslint"' package.json 2>/dev/null; then
  if grep -q '"lint"' package.json; then
    npm run lint >/tmp/mulligan-validate-lint.log 2>&1 && ok "npm run lint" || { bad "npm run lint (see log)"; tail -20 /tmp/mulligan-validate-lint.log; }
  else
    npx eslint . >/tmp/mulligan-validate-lint.log 2>&1 && ok "eslint ." || { bad "eslint . (see log)"; tail -20 /tmp/mulligan-validate-lint.log; }
  fi
else
  skip "No eslint config present (Phase 1 not applicable to this repo)"
fi

# ─── Phase 2: Type Checking ──────────────────────────────────────────────────
section "Phase 2 — Type checking (tsc --noEmit, strict)"
if npx tsc --noEmit >/tmp/mulligan-validate-tsc.log 2>&1; then
  ok "tsc --noEmit (exit 0 — strict + skipLibCheck clean)"
else
  bad "tsc --noEmit reported errors"
  tail -40 /tmp/mulligan-validate-tsc.log
fi

# ─── Phase 3: Style / formatting ─────────────────────────────────────────────
section "Phase 3 — Style / formatting"
if ls .prettierrc* prettier.config.* 2>/dev/null | grep -q . || grep -q '"prettier"' package.json 2>/dev/null \
   || ls .editorconfig 2>/dev/null | grep -q .; then
  if grep -q '"format:check"' package.json; then
    npm run format:check >/tmp/mulligan-validate-style.log 2>&1 && ok "npm run format:check" || { bad "format:check (see log)"; tail -20 /tmp/mulligan-validate-style.log; }
  else
    skip "Style config present but no automated check script"
  fi
else
  skip "No prettier/editorconfig present (Phase 3 not applicable to this repo)"
fi

# ─── Phase 4: Unit testing (pure helpers + tool/filter/nudge glue) ───────────
section "Phase 4 — Unit tests (vitest run)"
if npm test >/tmp/mulligan-validate-vitest.log 2>&1; then
  ok "npm test — $(grep -E 'Tests +[0-9]+ passed' /tmp/mulligan-validate-vitest.log | tail -1 | sed 's/^[[:space:]]*//')"
else
  bad "npm test failed"
  tail -40 /tmp/mulligan-validate-vitest.log
fi

# ─── Phase 5: End-to-end / integration (real `pi` binary) ────────────────────
section "Phase 5 — End-to-end (integration smoke + zero-config load)"

# 5a. Zero-config load (spec/11 §2 Step 9 acceptance): extension must load with NO
#     mulligan config and respond to a trivial prompt.
if command -v pi >/dev/null 2>&1; then
  ZERO=$(mktemp); printf 'Reply with the single word: ok' > "$ZERO"
  if pi -e ./src/index.ts -p "$(cat "$ZERO")" >/tmp/mulligan-validate-zeroconfig.log 2>&1; then
    if grep -qi 'Error loading extension' /tmp/mulligan-validate-zeroconfig.log; then
      bad "zero-config load — extension load error detected"
      tail -20 /tmp/mulligan-validate-zeroconfig.log
    else
      ok "zero-config load (pi -e ./src/index.ts loads cleanly with all defaults)"
    fi
  else
    # A non-zero exit AFTER the factory ran may still be a successful LOAD (a later
    # model/API error is not a load failure — spec/11 §2 Step 9 gates on LOAD only).
    if grep -qi 'Error loading extension' /tmp/mulligan-validate-zeroconfig.log; then
      bad "zero-config load — extension load error detected"
      tail -20 /tmp/mulligan-validate-zeroconfig.log
    else
      ok "zero-config load (factory ran; non-zero exit was post-load, not a load failure)"
    fi
  fi
  rm -f "$ZERO"
else
  skip "zero-config load — pi not on PATH"
fi

# 5b. Integration smoke harness (14 scenarios: 9 F-* + 5 E-*).
#     Clean smoke state first for idempotency (per VERIFICATION.md DoD #2 note).
if command -v pi >/dev/null 2>&1; then
  rm -rf /tmp/mulligan-smoke 2>/dev/null
  rm -f ~/.pi/agent/sessions/*/*smoke-*test* 2>/dev/null || true
  if npm run smoke >/tmp/mulligan-validate-smoke.log 2>&1; then
    PASSED=$(grep -c '^PASS' /tmp/mulligan-validate-smoke.log || true)
    if grep -q 'scenarios passed' /tmp/mulligan-validate-smoke.log; then
      ok "npm run smoke — $(grep 'scenarios passed' /tmp/mulligan-validate-smoke.log | tail -1 | sed 's/^[[:space:]]*//')"
    else
      ok "npm run smoke (exit 0; $PASSED PASS lines)"
    fi
  else
    bad "npm run smoke — one or more scenarios failed"
    tail -40 /tmp/mulligan-validate-smoke.log
  fi
else
  skip "npm run smoke — pi not on PATH (install pi 0.84.x to run the E2E suite)"
fi

# 5c. Nudge-leak invariant (DoD #3): mulligan:nudge / mulligan:high-water must NEVER
#     be persisted as custom_message entries in any smoke session JSONL.
if command -v pi >/dev/null 2>&1; then
  LEAK=$(grep -rh '"customType":"mulligan:nudge"\|"customType":"mulligan:high-water"' \
            ~/.pi/agent/sessions/*/*smoke* 2>/dev/null | wc -l | tr -d ' ')
  if [ "$LEAK" = "0" ]; then
    ok "nudge-leak invariant — 0 persisted mulligan:nudge / mulligan:high-water entries"
  else
    bad "nudge-leak invariant — $LEAK persisted nudge/high-water entries found (must be 0)"
  fi
else
  skip "nudge-leak invariant — pi not on PATH"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
section "Summary"
printf '  %s%d passed%s · %s%d failed%s · %s%d skipped%s\n' \
  "$G" "$PASS" "$N" "$R" "$FAIL" "$N" "$Y" "$SKIP" "$N"

# Note: automated gates are GREEN. The checkpoint-consumption spec deviation
# (validation_report.md) is a code/logic finding NOT caught by these gates — it
# requires a targeted multi-entry test the current suite does not exercise.
printf '\n  %sNote:%s automated gates (types/unit/smoke) do NOT cover the checkpoint\n' "$Y" "$N"
printf '  consumption bug cluster documented in validation_report.md — review that\n'
printf '  report for findings the gates do not catch.\n'

if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0