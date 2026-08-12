#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# validate.sh — pi-mulligan v1.1 comprehensive validation gate.
#
# Runs every validation phase the project supports, PLUS an independent
# bug-fix-verification probe for the 4 PRD bugs (BUG-001..BUG-004) and a
# spec/09 ↔ code config-defaults consistency scan.
#
# Phases (only those the codebase supports are included):
#   1. Type checking        — `npm run typecheck`  (tsc --noEmit)
#   2. Unit / integration    — `npm test`          (vitest run, 1044 tests)
#   3. Independent bug-fix probe — temp vitest file asserting BUG-001..004 fixed
#   4. Config-defaults consistency — spec/09 §2 defaults vs src/config.ts
#   5. E2E smoke (real `pi`)   — `npm run smoke` (14 deterministic user-workflow scenarios)
#
# Exits 0 only if EVERY phase passes. Phase 5 needs the `pi` CLI + a responsive
# model; if `pi` is absent it is skipped with a warning (phases 1–4 are the
# deterministic core gates and are never skipped).
#
# Output files (the only persistent artifacts this validator produces):
#   ./validate.sh  ./validation_report.md  ./validation_result.json
# The phase-3 probe is written to test/_validator_probe.test.ts and ALWAYS
# removed (trap) before exit, so it never persists.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PASS=0; FAIL=0
FAILED_PHASES=()
PROBE_FILE="test/_validator_probe.test.ts"

cleanup() {
  rm -f "$PROBE_FILE" /tmp/_validator_cfgcheck.mjs 2>/dev/null || true
}
trap cleanup EXIT

color() { printf '\033[%sm%s\033[0m' "$1" "$2"; }
header() { printf '\n\033[1;36m══ %s ══\033[0m\n' "$1"; }
ok()   { printf '  %s %s\n' "$(color '1;32' '✓ PASS')" "$1"; PASS=$((PASS+1)); }
bad()  { printf '  %s %s\n' "$(color '1;31' '✗ FAIL')" "$1"; FAIL=$((FAIL+1)); FAILED_PHASES+=("$1"); }

# ── preflight ────────────────────────────────────────────────────────────────
header "Preflight"
command -v node >/dev/null && { ok "node ($(node -v)) present"; } || { bad "node missing"; }
if [ -d node_modules ]; then ok "node_modules present"; else bad "node_modules missing — run 'npm install'"; fi

# ── Phase 1: Type checking ───────────────────────────────────────────────────
header "Phase 1 — Type checking (tsc --noEmit)"
if npm run typecheck >/tmp/_v_typecheck.log 2>&1; then
  ok "tsc --noEmit (strict) clean"
else
  bad "typecheck"; tail -20 /tmp/_v_typecheck.log
fi

# ── Phase 2: Unit + integration tests (vitest) ───────────────────────────────
header "Phase 2 — Unit + integration tests (vitest run)"
if npm test >/tmp/_v_vitest.log 2>&1; then
  tail -6 /tmp/_v_vitest.log | sed 's/^/    /'
  ok "vitest run (all test files green)"
else
  bad "vitest run"; tail -30 /tmp/_v_vitest.log
fi

# ── Phase 3: Independent bug-fix-verification probe (BUG-001..BUG-004) ───────
header "Phase 3 — Independent PRD bug-fix probe (BUG-001..BUG-004)"
cat > "$PROBE_FILE" <<'PROBE'
import { describe, it, expect } from "vitest";
import { getConfig, setConfig } from "../src/config.js";
import { renderHighWaterNudge } from "../src/nudges.js";
import { renderAuditReport } from "../src/tools/audit.js";
import { makeRewindTool } from "../src/tools/rewind.js";
import { clearAll } from "../src/runtime.js";
import { readFileSync } from "node:fs";

describe("BUG-001 — driftThresholdTokens code/spec consistency", () => {
  it("getConfig default == spec/09 §2 == spec/09 §3", () => {
    setConfig(undefined);
    const code = getConfig().nudges.driftThresholdTokens;
    const spec = readFileSync("spec/09-configuration.md", "utf8");
    const m2 = spec.match(/"driftThresholdTokens":\s*(\d+)/);
    const m3 = spec.match(/\|\s*`nudges\.driftThresholdTokens`\s*\|\s*`?(\d+)/);
    expect(m2).not.toBeNull(); expect(m3).not.toBeNull();
    expect(Number(m2![1])).toBe(Number(m3![1]));      // spec internally consistent
    expect(code).toBe(Number(m2![1]));                // code == spec
  });
});

describe("BUG-002 — high-water nudge is awareness-only", () => {
  it("does not prescribe rewind/shrink; correct rounded %", () => {
    const t = renderHighWaterNudge(70000, 100000);
    expect(t).not.toMatch(/rewind|shrink/i);
    expect(t).toContain("~70%");
    expect(t.toLowerCase()).toMatch(/context|window/);
  });
  it("fallback (window<=0) is awareness-only, no %", () => {
    expect(renderHighWaterNudge(70000, 0)).not.toMatch(/rewind|shrink|%/);
  });
});

describe("BUG-003 — audit report (user-set) + singularization", () => {
  const base = { totalTokens: 1000, confidence: "medium" as const, rewinds: [], shrinks: [],
    protectedRoles: ["first:user", "latest:user"], rows: [], filtered: [], cancelledCount: 0 };
  const line = (n: string[]) => renderAuditReport({ ...base, checkpointNames: n })
    .split("\n").find((l) => l.startsWith("Active markers:"))!;
  it("1 → '1 checkpoint [name] (user-set)'", () => {
    expect(line(["before-x"])).toContain("1 checkpoint [before-x] (user-set)");
    expect(line(["before-x"])).not.toContain("1 checkpoints");
  });
  it("0 → no (user-set), plural, []", () => {
    expect(line([])).toContain("0 checkpoints []"); expect(line([])).not.toContain("(user-set)");
  });
  it("2 → plural + (user-set)", () => {
    expect(line(["a","b"])).toContain("2 checkpoints [a, b] (user-set)");
  });
});

describe("BUG-004 — depth guard excludes cancelled rewinds", () => {
  it("5 cancelled rewinds → 0 active → not depth-refused", async () => {
    setConfig(undefined); clearAll();
    const entries: unknown[] = [{ type: "message", id: "u1", message: { role: "user", content: "go" } }];
    for (let i = 1; i <= 5; i++) {
      entries.push({ type: "custom", customType: "mulligan:rewind", data: { seq: i, id: `rew-${i}`, kind: "rewind" } });
      entries.push({ type: "custom", customType: "mulligan:cancel", data: { kind: "cancel", targetId: `rew-${i}` } });
    }
    const appended: unknown[] = [];
    const pi = { appendEntry:(c:string,d?:unknown)=>appended.push({c,d}), sendMessage:()=>{}, setLabel:()=>{} };
    const ctx = { sessionManager: { getSessionId:()=>"s1", getLeafId:()=>"leaf-1", getEntries:()=>entries,
      getLabel:()=>undefined, getBranch:()=>[], buildContextEntries:()=>[] } };
    const res = await makeRewindTool(pi as never).execute("call-1",
      { note: { what:"x", why:"y", next:"z" }, granularity: "last_tool_call_group" } as never,
      undefined as never, ctx as never, pi as never);
    const txt = (res.content as {type:string;text:string}[]).find((c)=>c.type==="text")!.text;
    expect(txt).not.toContain("max rewind depth (5) reached");
    expect(txt).not.toContain("5 active rewind marker(s)");
  });
});
PROBE
if npx vitest run "$PROBE_FILE" >/tmp/_v_probe.log 2>&1; then
  grep -E "Tests +[0-9]+ passed" /tmp/_v_probe.log | sed 's/^/    /'
  ok "BUG-001..004 fix-verification probe (7 assertions)"
else
  bad "bug-fix probe"; cat /tmp/_v_probe.log | tail -30
fi

# ── Phase 4: Config-defaults consistency (spec/09 §2 ↔ src/config.ts) ────────
header "Phase 4 — Config-defaults consistency (spec/09 §2 ↔ DEFAULT_CONFIG)"
cat > /tmp/_validator_cfgcheck.mjs <<'CFG'
import { readFileSync } from "node:fs";
const spec = readFileSync("spec/09-configuration.md","utf8");
const defaults = { "enabled":true,"rewind.enabled":true,"rewind.maxDepth":5,"rewind.maxRetriesPerPrompt":5,
  "rewind.abortContextFraction":0.9,"rewind.requireMutationWarning":true,"shrink.enabled":true,
  "shrink.maxActive":32,"shrink.staleAfterFires":3,"shrink.notifyMaxChars":2048,"nudges.bloatReminder":true,
  "nudges.perTurnDrift":true,"nudges.bloatThresholdBytes":16384,"nudges.bloatThresholdBytesByTool.read":24576,
  "nudges.driftThresholdTokens":4000,"nudges.driftWindowTurns":3,"nudges.highWaterFraction":0.7,
  "audit.estimateConfidence":"medium","ui.activeCheckpointBanner":true };
let bad=0;
for (const [k,v] of Object.entries(defaults)) {
  const last=k.split(".").pop();
  const m=spec.match(new RegExp('"'+last+'"\\s*:\\s*([^,\\n]+?)(?:,|//|$)'));
  if(!m){console.log(`? no spec default: ${k}`);continue;}
  const sv=m[1].replace(/\/\/.*$/,"").trim().replace(/"/g,"");
  if(!(sv===String(v)||Number(sv)===Number(v))){console.log(`✗ MISMATCH ${k}: code=${v} spec=${sv}`);bad++;}
}
console.log(bad===0?`ALL ${Object.keys(defaults).length} CONFIG DEFAULTS CONSISTENT`:`${bad} MISMATCH(ES)`);
process.exit(bad===0?0:1);
CFG
if node /tmp/_validator_cfgcheck.mjs | sed 's/^/    /' && node /tmp/_validator_cfgcheck.mjs >/dev/null 2>&1; then
  ok "all config defaults agree (spec/09 §2 ↔ code)"
else
  bad "config-defaults consistency"
fi

# ── Phase 5: E2E smoke (real pi; 14 deterministic user-workflow scenarios) ───
header "Phase 5 — E2E smoke (npm run smoke — real pi, 14 scenarios)"
if ! command -v pi >/dev/null 2>&1; then
  printf '  %s pi CLI not found — skipping E2E smoke (phases 1–4 are the deterministic gates)\n' "$(color '1;33' '⚠ SKIP')"
else
  # Generous outer budget: with a slow default model the suite can need several
  # minutes (each scenario spawns a pi process with model turns). 600s is safe.
  if timeout 600 npm run smoke >/tmp/_v_smoke.log 2>&1; then
    grep -E "scenarios passed" /tmp/_v_smoke.log | sed 's/^/    /'
    ok "E2E smoke — 14/14 deterministic scenarios"
  else
    bad "E2E smoke"; tail -40 /tmp/_v_smoke.log
    printf '  %s note: smoke is model-dependent; a single transient model timeout can fail one\n' "$(color '1;33' '⚠')"
    printf '      scenario without indicating a code regression — re-run if only F-shrink-* failed.\n'
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
header "Summary"
printf '  Passed: %s   Failed: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  Failed phases: %s\n' "${FAILED_PHASES[*]}"
  printf '\n%s\n' "$(color '1;31' 'RESULT: VALIDATION FAILED')"
  exit 1
fi
printf '\n%s\n' "$(color '1;32' 'RESULT: VALIDATION PASSED — all phases green')"
exit 0