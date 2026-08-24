#!/usr/bin/env bash
# validate.sh — comprehensive validation for pi-mulligan v2.0 (current-turn-scoped shrink).
#
# Phases (only tooling that exists in this repo — no eslint/prettier configs exist, so no
# lint/style phases):
#   0. Prerequisites  — node >= 22.19, npm deps installed, `pi` CLI on PATH (smoke needs it)
#   1. Type checking  — tsc --noEmit (strict)
#   2. Unit testing   — vitest run (full suite)
#   3. E2E testing    — the real-pi integration smoke suite (spawn `pi -p` per scenario:
#                       agent tools, human slash commands, banner widget, consent model,
#                       reload persistence, fail-open, edge cases)
#   4. v2.0 invariants — fast static regression guards for the surfaces this PRD changed
#
# Exit 0 only if EVERY phase passes.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; NC=$'\033[0m'
PHASE_FAILED=0

phase() { printf '\n%s========== %s ==========%s\n' "$YELLOW" "$1" "$NC"; }
ok()    { printf '%s  ✔ %s%s\n' "$GREEN" "$1" "$NC"; }
bad()   { printf '%s  ✘ %s%s\n' "$RED" "$1" "$NC"; PHASE_FAILED=1; }

# ─── Phase 0: Prerequisites ─────────────────────────────────────────────────
phase "Phase 0: Prerequisites"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${node_major:-0}" -ge 22 ]; then
  ok "node $(node --version) (>= 22.19 required)"
else
  bad "node $(node --version) is < 22 (engines requires >=22.19.0)"
fi

[ -d node_modules ] && ok "node_modules present" || { bad "node_modules missing — run: npm ci"; }

if command -v pi >/dev/null 2>&1; then
  ok "pi CLI on PATH (required by Phase 3 smoke)"
else
  bad "pi CLI not on PATH — Phase 3 will fail; install @earendil-works/pi-coding-agent"
fi

# ─── Phase 1: Type checking ─────────────────────────────────────────────────
phase "Phase 1: Type checking (tsc --noEmit, strict)"
if npm run --silent typecheck; then
  ok "tsc --noEmit clean"
else
  bad "tsc --noEmit reported errors"
fi

# ─── Phase 2: Unit testing ──────────────────────────────────────────────────
phase "Phase 2: Unit testing (vitest run)"
if npm test --silent; then
  ok "unit suite passed"
else
  bad "unit suite FAILED"
fi

# ─── Phase 3: End-to-end testing (real pi -p integration smoke) ────────────
# Drives COMPLETE user workflows against a real pi process per scenario:
#   agent workflows : mulligan_rewind (last_tool_call_group/last_turn/checkpoint),
#                     mulligan_shrink (current-turn success + out-of-turn refusal),
#                     mulligan_audit, mulligan_cancel, E22 backstops, E15 50-marker storm
#   human workflows : /mulligan_checkpoint + /mulligan_checkpoint_revoke label lifecycle
#                     (F-ckptcmd), active-checkpoint banner set/persist/clear/restore (F-banner),
#                     consented user-prompt hiding (F-consent), /mulligan_audit report parity +
#                     sink separation (F-useraudit), D10 user-paste exemption (F-drift-userexempt)
#   platform paths  : marker persistence across reload/resume (F-reload, E11), malformed-marker
#                     fail-open (F-failopen), JSONL entry-type invariants (§2.3, every scenario)
phase "Phase 3: End-to-end testing (real-pi integration smoke suite)"
if npm run --silent smoke; then
  ok "smoke suite passed"
else
  bad "smoke suite FAILED"
fi

# ─── Phase 4: v2.0 source invariants (static regression guards) ─────────────
# Fast greps pinning the surfaces this PRD governs. A regression in any of these
# changes behavior the unit/smoke suites may not surface (schema/description drift).
phase "Phase 4: v2.0 source invariants"

grep -q "granularity 'checkpoint' rewinds back to a checkpoint a user set" src/tools/rewind.ts \
  && ok "REWIND_DESC carries the v1.1 checkpoint/consent sentence" \
  || bad "REWIND_DESC lost the checkpoint/consent sentence (BUG-001 regression)"

grep -q "set via the /mulligan_checkpoint command" src/tools/rewind.ts \
  && ok "checkpoint param references the human slash command" \
  || bad "checkpoint param no longer references /mulligan_checkpoint (BUG-001 regression)"

grep -q "reproducing the mistake" src/tools/rewind.ts \
  && ok "E22 identical-note advisory present (BUG-002 fix)" \
  || bad "E22 identical-note advisory missing (BUG-002 regression)"

grep -q "that result is from a previous turn; only this turn's tool calls can be shrunk" src/tools/shrink.ts \
  && ok "shrink creation-time current-turn hard refusal present" \
  || bad "shrink creation-time current-turn hard refusal missing"

grep -q "if (span === null) continue; // fail-safe no-op" src/transforms.ts \
  && ok "filter issuing-turn guard fails safe (no-op on indeterminate span)" \
  || bad "filter issuing-turn fail-safe no-op missing"

if grep -rn "by_content_includes" src/tools/shrink.ts src/tools/cancel.ts >/dev/null 2>&1; then
  bad "by_content_includes leaked back into a WRITE schema (shrink/cancel)"
else
  ok "by_content_includes absent from both write schemas"
fi

for scen in F-consent F-ckptcmd F-banner F-useraudit F-drift-userexempt; do
  grep -q "\"$scen\"" test/integration/run-smoke.mjs \
    && ok "smoke suite drives $scen (BUG-003 fix)" \
    || bad "smoke suite does not drive $scen (BUG-003 regression)"
done

grep -q "Context updated: \${k} result(s) summarized" src/tools/shrink.ts \
  && ok "v1.2 orientation line text intact" \
  || bad "v1.2 orientation line text drifted"

grep -q 'placement: "aboveEditor"' src/banner.ts \
  && ok "E26 banner placement aboveEditor" \
  || bad "E26 banner placement regressed"

grep -q "<context-shrunk>" src/transforms.ts \
  && ok "E25 <context-shrunk> stamp present" \
  || bad "E25 stamp missing"

# ─── Summary ────────────────────────────────────────────────────────────────
printf '\n%s══════════════════════════════════════%s\n' "$YELLOW" "$NC"
if [ "$PHASE_FAILED" -eq 0 ]; then
  printf '%s  VALIDATION PASSED — all phases green%s\n' "$GREEN" "$NC"
  exit 0
else
  printf '%s  VALIDATION FAILED — see ✘ items above%s\n' "$RED" "$NC"
  exit 1
fi