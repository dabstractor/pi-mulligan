#!/usr/bin/env bash
# ============================================================================
# validate.sh — Mulligan (pi-mulligan) comprehensive validation harness
# ----------------------------------------------------------------------------
# Scope: the P2 "Per-Tool Bloat Threshold" changeset + the bug-hunt findings
#        (BUG-001 prototype-key leak, BUG-002 stale spec/04, BUG-003 stale
#        spec/10 + spec/01). This script gates the full quality surface:
#        type-check, unit tests, integration smoke (x2 for idempotency), and a
#        targeted regression that exercises the per-tool bloat resolution +
#        the BUG-001 prototype-key fix end-to-end through the REAL handler.
#
# Exit codes: 0 = ALL phases passed; non-zero = at least one phase failed.
# Each phase prints a clear PASS/FAIL banner. The whole script `set -e`s so
# the first hard failure stops the run (smoke idempotency + regression are
# advisory-checked but report their result).
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Color/banner helpers (plain fallback if not a tty).
say()  { printf '\n\033[1m>>> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    [PASS]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m    [FAIL]\033[0m %s\n' "$*" >&2; }
note() { printf '          %s\n' "$*"; }

FAIL=0

# ----------------------------------------------------------------------------
# Phase 1 — Linting
# ----------------------------------------------------------------------------
# NOTE: this project configures NO linter (no .eslintrc, no biome, no eslint/
# biome/prettier in devDependencies). Linting is therefore intentionally
# absent; the strict `tsc --noEmit` gate (Phase 2) is the static-analysis
# surface. Phase 1 is documented as N/A so the phase list stays honest.
say "Phase 1 — Linting"
note "No linter configured (no eslint/biome/.eslintrc). Skipped — tsc strict gate covers static analysis."
ok "Phase 1 (N/A — no linter present)"

# ----------------------------------------------------------------------------
# Phase 2 — Type checking (strict tsconfig.json)
# ----------------------------------------------------------------------------
say "Phase 2 — Type checking (tsc --noEmit, strict)"
if npx --no-install tsc --noEmit; then
  ok "tsc --noEmit clean (strict mode)"
else
  fail "tsc --noEmit reported errors"
  FAIL=1
fi

# ----------------------------------------------------------------------------
# Phase 3 — Style checking
# ----------------------------------------------------------------------------
# NOTE: no formatter is configured either (no .prettierrc, no prettier dep).
# Documented as N/A for honesty; tsc strict is the gate.
say "Phase 3 — Style checking"
note "No formatter configured (no prettier/.prettierrc). Skipped."
ok "Phase 3 (N/A — no formatter present)"

# ----------------------------------------------------------------------------
# Phase 4 — Unit testing (vitest)
# ----------------------------------------------------------------------------
say "Phase 4 — Unit tests (vitest run)"
set +e
npx --no-install vitest run > /tmp/mulligan-validate-unit.log 2>&1
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  # Pull the summary line (e.g. "Tests  743 passed (743)").
  SUMMARY="$(grep -E '^\s*Tests\s+' /tmp/mulligan-validate-unit.log | tail -1 | sed 's/^[[:space:]]*//')"
  ok "Unit tests passed — ${SUMMARY:-all green}"
else
  fail "Unit tests FAILED (exit $RC)"
  tail -25 /tmp/mulligan-validate-unit.log >&2
  FAIL=1
fi

# ----------------------------------------------------------------------------
# Phase 5 — End-to-end testing
# ----------------------------------------------------------------------------
# Three E2E layers:
#   5a. Integration smoke harness (the deterministic F-*/E* scenarios — the
#       authoritative integration gate documented in test/integration/scenarios.md).
#   5b. Smoke idempotency — run #2 back-to-back (regresses the documented
#       "session JSONL accumulates across runs" flakiness; must stay 14/14).
#   5c. Per-tool bloat regression — exercises bloatReminderHandler with the
#       REAL handler + DEFAULT config across read/bash/grep/prototype-colliding
#       tool names, confirming per-tool resolution + the BUG-001 fix end-to-end
#       (no 'NaN KB', no always-fires).
say "Phase 5a — Integration smoke harness (npm run smoke, 14 scenarios)"
set +e
npm run --silent smoke > /tmp/mulligan-validate-smoke1.log 2>&1
SMOKE1=$?
set -e
if [ "$SMOKE1" -eq 0 ] && grep -q '14/14 scenarios passed' /tmp/mulligan-validate-smoke1.log; then
  ok "Smoke run #1: 14/14 scenarios passed"
else
  fail "Smoke run #1 failed (exit $SMOKE1)"
  tail -20 /tmp/mulligan-validate-smoke1.log >&2
  FAIL=1
fi

say "Phase 5b — Smoke idempotency (run #2, back-to-back — regresses session-reuse flakiness)"
if [ "$FAIL" -eq 0 ]; then
  set +e
  npm run --silent smoke > /tmp/mulligan-validate-smoke2.log 2>&1
  SMOKE2=$?
  set -e
  if [ "$SMOKE2" -eq 0 ] && grep -q '14/14 scenarios passed' /tmp/mulligan-validate-smoke2.log; then
    ok "Smoke run #2: 14/14 scenarios passed (idempotent — run-scoped session IDs hold)"
  else
    fail "Smoke run #2 failed / not idempotent (exit $SMOKE2)"
    tail -20 /tmp/mulligan-validate-smoke2.log >&2
    FAIL=1
  fi
else
  note "Skipped (run #1 already failed)"
fi

say "Phase 5c — Per-tool bloat regression (BUG-001 + per-tool resolution, via REAL handler)"
REGRESS=/tmp/mulligan-validate-bloat.mts
cat > "$REGRESS" <<'TS'
import { setConfig, validateConfig } from "SRC/config.ts";
import { bloatReminderHandler } from "SRC/nudges.ts";
import { getRuntime } from "SRC/runtime.ts";

setConfig(validateConfig(undefined));          // DEFAULT: global 16384, bash 32768, read 20480
const sid = "regress-session";
getRuntime(sid);                               // pre-seed runtime for the handler's getRuntime(sid)

const mk = (tool: string, kb: number) => ({
  type: "tool_result", toolCallId: "c1", toolName: tool, input: {},
  content: [{ type: "text", text: "x".repeat(kb * 1024) }], isError: false,
});
const ctx = { sessionManager: { getSessionId: () => sid } };

let bad = 0;
// [tool, KB, expectReminder?]
const cases: [string, number, boolean][] = [
  ["read", 18, false], ["read", 21, true],     // per-tool read threshold 20 KB
  ["bash", 30, false], ["bash", 33, true],     // per-tool bash threshold 32 KB
  ["grep", 15, false], ["grep", 17, true],     // global 16 KB
];
for (const [t, kb, want] of cases) {
  const fired = bloatReminderHandler(mk(t, kb), ctx as any) !== undefined;
  if (fired !== want) { console.log(`  FAIL ${t} ${kb}KB fired=${fired} want=${want}`); bad++; }
}
// BUG-001 regression: prototype-colliding names must resolve to global (NOT leak a function/NaN).
for (const proto of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
  // 1 KB is well under global 16384 → must NOT fire (proves it resolved to a finite number, not a fn).
  const fired = bloatReminderHandler(mk(proto, 1), ctx as any) !== undefined;
  if (fired) { console.log(`  FAIL ${proto}: reminder fired on a 1KB result (BUG-001 regression — NaN/always-fires)`); bad++; }
}
console.log(bad === 0 ? "REGRESS PASS" : `REGRESS FAIL (${bad})`);
process.exit(bad === 0 ? 0 : 1);
TS
# Patch the SRC placeholder to the absolute repo path.
sed -i "s#SRC#$ROOT/src#g" "$REGRESS"
set +e
npx --no-install tsx "$REGRESS" > /tmp/mulligan-validate-bloat.log 2>&1
BL=$?
set -e
if [ "$BL" -eq 0 ] && grep -q 'REGRESS PASS' /tmp/mulligan-validate-bloat.log; then
  ok "Per-tool bloat regression: read/bash/grep thresholds correct; BUG-001 prototype keys resolve to global"
else
  fail "Per-tool bloat regression FAILED (exit $BL)"
  cat /tmp/mulligan-validate-bloat.log >&2
  FAIL=1
fi

# ----------------------------------------------------------------------------
# Verdict
# ----------------------------------------------------------------------------
say "VERDICT"
if [ "$FAIL" -eq 0 ]; then
  ok "ALL VALIDATION PHASES PASSED — codebase is production-ready for the P2 per-tool bloat changeset."
  exit 0
else
  fail "One or more phases failed — see output above."
  exit 1
fi