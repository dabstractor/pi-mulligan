#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# validate.sh — pi-mulligan comprehensive validation script.
#
# Runs every quality gate that EXISTS in this codebase, plus targeted repo-hygiene
# and spec/code-consistency checks. Exits 0 only if everything passes.
#
# Phases (only those that exist are included — see the header of each phase):
#   PHASE 1 — Linting ........... SKIPPED (no eslint/prettier; intentional, see
#                                   VERIFICATION.md #3 + .editorconfig header). A
#                                   lightweight editorconfig sanity check runs instead.
#   PHASE 2 — Type checking ..... `npm run typecheck` (tsc --noEmit, strict).
#   PHASE 3 — Style checking .... lightweight: no tabs / no trailing whitespace /
#                                   final-newline present on src files (the
#                                   .editorconfig lowest-common-denominator rules).
#   PHASE 4 — Unit testing ...... `npm test` (vitest run; pure helpers + tool glue).
#   PHASE 5 — End-to-end ........ `npm run smoke` (14 real `pi -p` scenarios) +
#                                   zero-config extension-load acceptance
#                                   (spec/11 §2 Step 9).
#   PHASE 6 — Repo hygiene ...... stray-file + spec/code-drift checks.
#
# Usage:  ./validate.sh [--skip-smoke]
#        --skip-smoke  omit the ~3-5 min E2E smoke phase (typecheck+unit still run).
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")"

SKIP_SMOKE=0
[[ "${1:-}" == "--skip-smoke" ]] && SKIP_SMOKE=1

# Color helpers (degrade gracefully when not a tty).
if [[ -t 1 ]]; then
  G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=""; Y=""; R=""; B=""; N=""
fi

PASS=0; WARN=0; FAIL=0
section() { printf "\n${B}══ %s ══${N}\n" "$1"; }
ok()      { printf "  ${G}✓ PASS${N}  %s\n" "$1"; PASS=$((PASS+1)); }
warn()    { printf "  ${Y}⚠ WARN${N}  %s\n" "$1"; WARN=$((WARN+1)); }
fail()    { printf "  ${R}✗ FAIL${N}  %s\n" "$1"; FAIL=$((FAIL+1)); }
note()    { printf "  • %s\n" "$1"; }

run() { # run <label> <command...> — captures exit, prints PASS/FAIL
  local label="$1"; shift
  local out
  if out=$("$@" 2>&1); then ok "$label"; printf '%s\n' "$out" | sed 's/^/      /' | tail -n 3
  else fail "$label"; printf '%s\n' "$out" | sed 's/^/      /' | tail -n 15; fi
}

printf "${B}pi-mulligan — comprehensive validation${N}\n"

# ── Pre-flight: dependencies ─────────────────────────────────────────────────
section "Pre-flight"
if ! command -v node >/dev/null 2>&1; then fail "node not found on PATH"; exit 1; fi
note "node: $(node --version)"
if ! command -v pi >/dev/null 2>&1; then
  fail "pi CLI not found on PATH (E2E smoke phase requires it)"
else
  note "pi: $(pi --version 2>/dev/null || echo '(version unavailable)')"
fi
if [[ ! -d node_modules ]]; then
  note "node_modules missing — running 'npm ci --ignore-scripts' …"
  npm ci --ignore-scripts >/dev/null 2>&1 && ok "dependencies installed" || fail "npm ci failed"
else
  ok "node_modules present"
fi

# ── PHASE 1 — Linting (intentionally absent) ─────────────────────────────────
section "Phase 1 — Linting"
note "No eslint/prettier configured (intentional — VERIFICATION.md #3, .editorconfig header)."
note "Phase 1 is skipped; Phase 3 covers the .editorconfig lowest-common-denominator rules."

# ── PHASE 2 — Type checking ──────────────────────────────────────────────────
section "Phase 2 — Type checking (tsc --noEmit, strict)"
if npm run typecheck >/tmp/mulligan-tsc.log 2>&1; then
  ok "tsc --noEmit passes (strict, noImplicitAny)"
else
  fail "tsc --noEmit reported errors"; tail -n 20 /tmp/mulligan-tsc.log | sed 's/^/      /'
fi

# ── PHASE 3 — Style checking (lightweight editorconfig) ──────────────────────
section "Phase 3 — Style checking (.editorconfig sanity)"
# No formatter ships; verify the .editorconfig basics the project commits to.
if grep -rnP '\t' src/ >/dev/null 2>&1; then
  fail "src/ contains tab characters (editorconfig: indent_style = space)"
else
  ok "no tab characters in src/"
fi
if grep -rnP ' +$' src/ >/dev/null 2>&1; then
  fail "src/ contains trailing whitespace (editorconfig: trim_trailing_whitespace = true)"
else
  ok "no trailing whitespace in src/"
fi
# Final newline on every .ts (insert_final_newline = true). Cosmetic — no formatter ships,
# so this is reported as a WARN, not a hard FAIL (the real gates are typecheck + unit + smoke).
nonl=0
for f in $(find src -name '*.ts'); do
  last=$(tail -c1 "$f" | od -An -c | tr -d ' ')
  [[ "$last" != '\\n' ]] && nonl=$((nonl+1))
done
if [[ $nonl -eq 0 ]]; then
  ok "all src/*.ts end with a newline"
else
  warn "$nonl src/*.ts file(s) lack a final newline (.editorconfig: insert_final_newline = true) — cosmetic"
fi

# ── PHASE 4 — Unit testing ───────────────────────────────────────────────────
section "Phase 4 — Unit testing (vitest run)"
if npm test >/tmp/mulligan-vitest.log 2>&1; then
  ok "vitest run — all suites green"
  grep -E 'Test Files|Tests ' /tmp/mulligan-vitest.log | tail -n 2 | sed 's/^/      /'
else
  fail "vitest run reported failures"; tail -n 30 /tmp/mulligan-vitest.log | sed 's/^/      /'
fi

# ── PHASE 5 — End-to-end (real pi -p) ────────────────────────────────────────
section "Phase 5 — End-to-end"
# 5a. Zero-config extension-load acceptance (spec/11 §2 Step 9): loads with NO
#     mulligan config → all defaults → must boot without error and reply.
if [[ $SKIP_SMOKE -eq 1 ]]; then
  warn "--skip-smoke set: skipping zero-config load + 14-scenario smoke suite"
else
  if ! command -v pi >/dev/null 2>&1; then
    fail "pi CLI missing — cannot run E2E (install pi or run with --skip-smoke)"
  else
    load_out=$(timeout 90 pi -e ./src/index.ts -p "Reply with exactly: OK" 2>&1)
    load_rc=$?
    if [[ $load_rc -eq 0 ]] && echo "$load_out" | grep -qi 'OK'; then
      ok "zero-config extension load (spec/11 Step 9): boots with defaults, replies"
    else
      fail "zero-config extension load failed (rc=$load_rc)"; echo "$load_out" | tail -n 10 | sed 's/^/      /'
    fi

    # 5b. The deterministic integration smoke harness: 14 real pi spawns covering
    #     F-rewind-core, F-shrink-persist (+E19 user-msg), F-shrink-preventive,
    #     F-nudge-drift, F-protected, F-maxdepth, F-checkpoint, F-failopen,
    #     F-reload, E7, E11, E12, E15, E20.
    smoke_log=/tmp/mulligan-smoke.log
    if timeout 420 node test/integration/run-smoke.mjs >"$smoke_log" 2>&1; then
      ok "integration smoke suite: all scenarios green"
    else
      fail "integration smoke suite reported failures (or timed out)"
    fi
    grep -E '^[0-9]+/[0-9]+ scenarios passed|^  FAILED' "$smoke_log" | sed 's/^/      /'
    # Surface any per-scenario FAIL lines.
    if grep -qE '^FAIL ' "$smoke_log"; then
      grep -E '^FAIL ' "$smoke_log" | sed 's/^/      /'
    fi
  fi
fi

# ── PHASE 6 — Repo hygiene + spec/code consistency ───────────────────────────
section "Phase 6 — Repo hygiene & spec/code consistency"

# 6a. Stray empty '=' file at repo root (tracked). Likely an accidental
#     `git add` from a shell redirection. Excluded from the npm package but is
#     repo noise.
if git ls-files --error-unmatch '=' >/dev/null 2>&1; then
  warn "stray empty file '=' is tracked by git (0 bytes; commit 250b49ee). Consider 'git rm ='."
else
  ok "no stray '=' file tracked"
fi

# 6b. spec/code drift on nudges.driftThresholdTokens. The code (src/config.ts)
#     ships 4000 (a documented BUG-003 round-2 fix — see VERIFICATION.md + README),
#     but spec/09-configuration.md still documents 6000 in both the JSON example
#     and the rationale table. Functional behavior is correct; the spec companion
#     doc is stale.
code_thr=$(grep -E '^\s*driftThresholdTokens:\s*[0-9]+' src/config.ts | grep -oE '[0-9]+' | head -1)
spec_thr=$(grep -oE '"driftThresholdTokens":\s*[0-9]+' spec/09-configuration.md | grep -oE '[0-9]+' | head -1)
if [[ -n "$code_thr" && -n "$spec_thr" && "$code_thr" != "$spec_thr" ]]; then
  warn "spec/code drift: driftThresholdTokens code=$code_thr vs spec/09=$spec_thr (code change is the documented BUG-003 fix; spec/09 was not updated)."
else
  ok "driftThresholdTokens consistent (code=$code_thr, spec=$spec_thr)"
fi

# 6c. Verify the tool/command inventory matches the v1.1 PRD: 4 agent tools + 3
#     human slash commands.
tools=$(grep -cE 'pi\.registerTool\(' src/index.ts)
cmds=$(grep -cE 'pi\.registerCommand\(' src/index.ts)
if [[ $tools -eq 4 && $cmds -eq 3 ]]; then
  ok "registered surface matches PRD v1.1: 4 agent tools + 3 human commands"
else
  fail "registered surface mismatch: registerTool=$tools (want 4), registerCommand=$cmds (want 3)"
fi

# 6d. No mulligan:nudge should ever be persisted (spec §2.3 invariant) — scan the
#     repo for any committed session JSONL that leaks one (defensive; should be none).
leaked=$(git ls-files | grep -E '\.jsonl$' | xargs -r grep -l '"customType":"mulligan:nudge"' 2>/dev/null | wc -l)
if [[ $leaked -eq 0 ]]; then
  ok "no persisted mulligan:nudge entries in tracked JSONL (spec §2.3 invariant holds)"
else
  fail "$leaked tracked JSONL file(s) contain a persisted mulligan:nudge (spec §2.3 violation)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
section "Summary"
printf "  ${G}PASS${N}: $PASS   ${Y}WARN${N}: $WARN   ${R}FAIL${N}: $FAIL\n"
if [[ $FAIL -gt 0 ]]; then
  printf "\n${R}RESULT: FAIL — %d hard failure(s).${N}\n" "$FAIL"
  exit 1
fi
if [[ $WARN -gt 0 ]]; then
  printf "\n${Y}RESULT: PASS WITH WARNINGS — %d minor issue(s); see validation_report.md.${N}\n" "$WARN"
  exit 0
fi
printf "\n${G}RESULT: ALL CHECKS PASSED.${N}\n"
exit 0