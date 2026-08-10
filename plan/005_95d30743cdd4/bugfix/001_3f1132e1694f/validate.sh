#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# validate.sh — pi-mulligan comprehensive validation harness
#
# Runs every validation phase the project ships, plus an end-to-end integration
# check that mirrors the documented user/agent workflows (the 5 mulligan_* tools
# driven through a real Pi session via test/integration/run-smoke.mjs).
#
# Phases (only those the codebase actually has):
#   1. Lint        — N/A (no eslint/biome config; .editorconfig only — intentional)
#   2. Type check  — `npm run typecheck`  (tsc --noEmit, strict)
#   3. Style       — N/A (no prettier/eslint; .editorconfig only — intentional)
#   4. Unit tests  — `npm test`           (vitest run, the full suite)
#   5. E2E         — `npm run smoke`      (14 deterministic integration scenarios)
#                    + optional zero-config extension load (`pi -e ./src/index.ts`)
#
# Exit code is non-zero if ANY required phase fails, so this is a real gate.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Color helpers (degrade gracefully if not a tty)
if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=""; R=""; Y=""; B=""; N=""
fi

declare -a PHASE_NAME PHASE_STATUS PHASE_DETAIL
FAIL=0
note()   { printf "  %sℹ%s %s\n" "$Y" "$N" "$1"; }
pass()   { printf "  %s✓ PASS%s — %s\n" "$G" "$N" "$1"; }
fail()   { printf "  %s✗ FAIL%s — %s\n" "$R" "$N" "$1"; FAIL=1; }

run_phase() {
  # run_phase <label> <command...>
  local label="$1"; shift
  printf "\n%s▶ %s%s\n" "$B" "$label" "$N"
  if "$@" > /tmp/mulligan_validate_"${label// /_}".log 2>&1; then
    pass "$label"
    PHASE_NAME+=("$label"); PHASE_STATUS+=("PASS"); PHASE_DETAIL+=("")
  else
    fail "$label (see log tail below)"
    tail -n 20 /tmp/mulligan_validate_"${label// /_}".log | sed 's/^/      /'
    PHASE_NAME+=("$label"); PHASE_STATUS+=("FAIL"); PHASE_DETAIL+=("see /tmp/mulligan_validate_${label// /_}.log")
  fi
}

printf "%s═══ pi-mulligan validation ═══%s\n" "$B" "$N"
printf "root: %s\n" "$ROOT"

# Sanity: node + npm available, deps installed
command -v node >/dev/null 2>&1 || { printf "%sFATAL: node not on PATH%s\n" "$R" "$N"; exit 2; }
command -v npm  >/dev/null 2>&1 || { printf "%sFATAL: npm not on PATH%s\n" "$R" "$N"; exit 2; }
[ -d node_modules ] || { printf "%sinstalling deps (no node_modules)%s\n" "$Y" "$N"; npm install --no-audit --no-fund >/dev/null || { printf "%snpm install failed%s\n" "$R" "$N"; exit 2; }; }

# ── Phase 1: Lint ────────────────────────────────────────────────────────────
printf "\n%s▶ Phase 1: Linting%s\n" "$B" "$N"
# A phase is "configured" only if a real config file OR a matching npm script exists.
has_lint_cfg() { ls .eslintrc* biome.json biome.jsonc .ruff.toml 2>/dev/null | grep -q .; }
has_script()   { node -e "const s=require('./package.json').scripts||{};process.exit(typeof s[process.argv[1]]==='string'?0:1)" "$1"; }
if has_lint_cfg || has_script lint; then
  run_phase "lint" npm run lint
else
  note "No linter configured (no eslint/biome/ruff; no 'lint' script). .editorconfig only — intentional per VERIFICATION.md #3."
  PHASE_NAME+=("Lint"); PHASE_STATUS+=("SKIP"); PHASE_DETAIL+=("no linter configured")
fi

# ── Phase 2: Type check ──────────────────────────────────────────────────────
run_phase "Type check (tsc)" npm run typecheck

# ── Phase 3: Style ───────────────────────────────────────────────────────────
printf "\n%s▶ Phase 3: Style checking%s\n" "$B" "$N"
if has_script format:check || has_script stylecheck || ls .prettierrc* .editorconfig-checker.json 2>/dev/null | grep -q .; then
  run_phase "style check" npm run format:check
else
  note "No formatter check configured (no prettier/eslint; .editorconfig only — intentional)."
  PHASE_NAME+=("Style"); PHASE_STATUS+=("SKIP"); PHASE_DETAIL+=("no formatter configured")
fi

# ── Phase 4: Unit tests ──────────────────────────────────────────────────────
run_phase "Unit tests (vitest)" npm test

# ── Phase 5: End-to-end (integration smoke = real agent workflows) ───────────
printf "\n%s▶ Phase 5: End-to-end (integration smoke)%s\n" "$B" "$N"
printf "  Drives the 5 mulligan_* tools through a real Pi session (test/integration/run-smoke.mjs)\n"
run_phase "E2E smoke (npm run smoke)" npm run smoke

# Optional: zero-config extension load (VERIFICATION.md DoD #6). Best-effort —
# requires the `pi` CLI + a model; skip (not fail) if unavailable/headless.
printf "\n%s▶ Phase 5b: Zero-config extension load (optional)%s\n" "$B" "$N"
if command -v pi >/dev/null 2>&1; then
  if timeout 90 pi -e ./src/index.ts -p "Reply with the single word: ok" >/tmp/mulligan_validate_load.log 2>&1; then
    if grep -qi "ok" /tmp/mulligan_validate_load.log; then
      pass "zero-config pi load + model reply"
      PHASE_NAME+=("pi zero-config load"); PHASE_STATUS+=("PASS"); PHASE_DETAIL+=("")
    else
      note "pi loaded but no 'ok' reply (model-driven); load itself succeeded. Treat as soft."
      PHASE_NAME+=("pi zero-config load"); PHASE_STATUS+=("SOFT"); PHASE_DETAIL+=("model reply not 'ok'")
    fi
  else
    note "pi load exited non-zero (possibly model/timeout). See /tmp/mulligan_validate_load.log. Not counted as hard failure (model-driven)."
    PHASE_NAME+=("pi zero-config load"); PHASE_STATUS+=("SOFT"); PHASE_DETAIL+=("model/timeout")
  fi
else
  note "pi CLI not on PATH — skipping zero-config load check (the smoke suite already covers extension load via GOTCHA #12)."
  PHASE_NAME+=("pi zero-config load"); PHASE_STATUS+=("SKIP"); PHASE_DETAIL+=("pi not on PATH")
fi

# ── Summary ──────────────────────────────────────────────────────────────────
printf "\n%s═══ Validation summary ═══%s\n" "$B" "$N"
printf "  %-32s %s\n" "PHASE" "RESULT"
for i in "${!PHASE_NAME[@]}"; do
  name="${PHASE_NAME[$i]}"; st="${PHASE_STATUS[$i]}"
  color="$G"; case "$st" in FAIL) color="$R";; SKIP|SOFT) color="$Y";; esac
  printf "  %-32s %s%s%s\n" "$name" "$color" "$st" "$N"
done
printf "%s────────────────────────────────%s\n" "$B" "$N"
if [ "$FAIL" -eq 0 ]; then
  printf "%s✅ All required phases passed.%s\n" "$G" "$N"
  exit 0
else
  printf "%s❌ One or more required phases FAILED. See logs above + /tmp/mulligan_validate_*.log%s\n" "$R" "$N"
  exit 1
fi