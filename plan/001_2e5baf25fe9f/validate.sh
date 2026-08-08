#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# validate.sh — pi-mulligan comprehensive validation
#
# Runs every verification phase that exists in this repo, plus embedded
# end-to-end functional checks (using the REAL production pipeline + REAL
# contextHandler, no mocks) that prove the headline behaviors the unit tests
# only cover in isolation.
#
# Phases:
#   1. Type checking        (npx tsc --noEmit)
#   2. Unit testing          (npm test → vitest, 671 tests)
#   3. Load smoke            (pi -e ./src/index.ts loads with zero config)
#   4. Integration smoke     (npm run smoke → 14 F-*/E-* scenarios, cleaned state)
#   5. End-to-end functional (real pipeline: rewind-hide, shrink-substitute,
#                             checkpoint-target, mutation-warning, nudge-suppress)
#   6. Static integrity      (settings-reading gap, LICENSE, stray console.*)
#
# Exit non-zero if ANY phase fails. Each phase prints a clear PASS/FAIL banner.
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")"

PASS=0
FAIL=0
declare -a FAILURES

banner() {
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "════════════════════════════════════════════════════════════════"
}

record() { # name pass/fail [detail]
  if [ "$2" = "pass" ]; then
    echo "  ✅ PASS — $1${3:+  ($3)}"
    PASS=$((PASS + 1))
  else
    echo "  ❌ FAIL — $1${3:+  ($3)}"
    FAIL=$((FAIL + 1))
    FAILURES+=("$1${3:+ — $3}")
  fi
}

# ── Phase 1: Type checking ───────────────────────────────────────────────────
banner "Phase 1 — Type checking (npx tsc --noEmit, strict mode)"
if npx tsc --noEmit 2>/tmp/pi-mulligan-tsc.log; then
  record "tsc --noEmit" pass "exit 0, strict + skipLibCheck"
else
  record "tsc --noEmit" fail "$(head -5 /tmp/pi-mulligan-tsc.log | tr '\n' ' ')"
fi

# ── Phase 2: Unit testing ────────────────────────────────────────────────────
banner "Phase 2 — Unit testing (npm test → vitest)"
UNIT_OUT=$(npm test 2>&1)
UNIT_EXIT=$?
# vitest prints "Tests  N passed (N)" / "N failed"
if echo "$UNIT_OUT" | grep -qE "Tests +[0-9]+ passed \([0-9]+\)"; then
  COUNT=$(echo "$UNIT_OUT" | grep -oE "Tests +[0-9]+ passed" | grep -oE "[0-9]+" | head -1)
  record "npm test (unit suite)" pass "$COUNT tests"
else
  record "npm test (unit suite)" fail "exit $UNIT_EXIT"
  echo "$UNIT_OUT" | tail -20
fi

# ── Phase 3: Zero-config load smoke (spec/11 §2 Step 9) ─────────────────────
banner "Phase 3 — Zero-config load (pi -e ./src/index.ts)"
LOAD_OUT=$(timeout 90 pi -e ./src/index.ts -p "Reply with exactly: OK" 2>&1)
LOAD_EXIT=$?
if [ $LOAD_EXIT -eq 0 ] && ! echo "$LOAD_OUT" | grep -qi "error loading extension\|Error loading"; then
  record "extension loads with no mulligan config" pass "pi exit 0"
else
  record "extension loads with no mulligan config" fail "exit $LOAD_EXIT"
  echo "$LOAD_OUT" | tail -10
fi

# ── Phase 4: Integration smoke harness (npm run smoke, cleaned state) ────────
banner "Phase 4 — Integration smoke (npm run smoke, cleaned state)"
# Clean smoke state for a deterministic run (VERIFICATION.md harness note).
rm -rf /tmp/mulligan-smoke
rm -f ~/.pi/agent/sessions/*pi-mulligan*/*smoke*.jsonl 2>/dev/null
SMOKE_OUT=$(timeout 900 npm run smoke 2>&1)
SMOKE_EXIT=$?
if echo "$SMOKE_OUT" | grep -qE "[0-9]+/[0-9]+ scenarios passed" && [ $SMOKE_EXIT -eq 0 ]; then
  record "npm run smoke" pass "$(echo "$SMOKE_OUT" | grep -oE '[0-9]+/[0-9]+ scenarios passed' | head -1)"
else
  record "npm run smoke" fail "exit $SMOKE_EXIT"
  echo "$SMOKE_OUT" | grep -E "PASS|FAIL|scenarios passed|FAILED:" | tail -20
fi

# ── Phase 5: End-to-end functional checks (REAL pipeline, no mocks) ──────────
banner "Phase 5 — End-to-end functional (real filterPipeline + contextHandler)"
E2E="./_validate-e2e.mts"
cat > "$E2E" <<'TYPESCRIPT'
import { contextHandler } from "./src/filter.ts";
import { makeRewindTool } from "./src/tools/rewind.ts";
import { setConfig } from "./src/config.ts";
import type { ContextEvent, ExtensionContext, SessionEntry, ExtensionAPI } from "@earendil-works/pi-coding-agent";
setConfig(undefined);
type R = { name: string; pass: boolean; detail?: string };
const results: R[] = [];
function check(name: string, pass: boolean, detail?: string) { results.push({ name, pass, detail }); }

function mkCtx(entries: SessionEntry[], branch: SessionEntry[] = [], sessionId = "s"): ExtensionContext {
  return { sessionManager: { getSessionId: () => sessionId, getEntries: () => entries, getBranch: () => branch } } as unknown as ExtensionContext;
}
function rewindMarker(excludeId: string, seq = 1, granularity = "last_tool_call_group", extra: Record<string, unknown> = {}): SessionEntry {
  return { type: "custom", id: "m", parentId: null, timestamp: "t", customType: "mulligan:rewind",
    data: { schema: "pi-mulligan", v: 1, kind: "rewind", id: "rw", granularity, options: {}, excludeToolCallId: excludeId, seq, ts: 1,
      note: { what_happened: "x", avoid: "x", true_current_state: "x", next: "x" },
      ledger: { readFiles: [], modifiedFiles: [], bashSideEffects: [] }, ...extra } } as unknown as SessionEntry;
}
function shrinkMarker(seq: number, target: Record<string, unknown>, replacement: string): SessionEntry {
  return { type: "custom", id: "m", parentId: null, timestamp: "t", customType: "mulligan:shrink",
    data: { schema: "pi-mulligan", v: 1, kind: "shrink", id: "sh", seq, ts: 1, target, replacement } } as unknown as SessionEntry;
}

// (1) Rewind last_tool_call_group hides the bloated toolGroup, keeps rewind's own unit + user.
{
  const CANARY = "BLOATED-XYZ-9999";
  const ev = { type: "context", messages: [
    { role: "user", content: "task" },
    { role: "assistant", content: [{ type: "toolCall", id: "g1", name: "grep", arguments: {} }] },
    { role: "toolResult", toolCallId: "g1", toolName: "grep", content: [{ type: "text", text: CANARY }] },
    { role: "assistant", content: [{ type: "toolCall", id: "rw", name: "mulligan_rewind", arguments: {} }] },
    { role: "toolResult", toolCallId: "rw", toolName: "mulligan_rewind", content: [{ type: "text", text: "ok" }] },
  ] } as unknown as ContextEvent;
  const res = contextHandler(ev, mkCtx([rewindMarker("rw")])) as { messages: unknown[] };
  const s = JSON.stringify(res.messages);
  check("rewind hides bloated toolGroup", !s.includes(CANARY), `5→${res.messages.length}`);
  check("rewind keeps own unit (mid-turn)", s.includes('"rw"'));
  check("rewind keeps user task", s.includes("task"));
}
// (2) Shrink substitutes content, preserves pairing fields (role/toolCallId/toolName).
{
  const ev = { type: "context", messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "toolCall", id: "r1", name: "read", arguments: {} }] },
    { role: "toolResult", toolCallId: "r1", toolName: "read", content: [{ type: "text", text: "x".repeat(20000) }], isError: false },
  ] } as unknown as ContextEvent;
  const res = contextHandler(ev, mkCtx([shrinkMarker(1, { by_tool_call_id: "r1" }, "[summary]")])) as { messages: unknown[] };
  const t = res.messages[2] as { content: { text: string }[]; toolCallId: string; toolName: string; role: string };
  check("shrink substitutes content", t.content[0].text === "[summary]");
  check("shrink preserves toolCallId (pairing)", t.toolCallId === "r1");
  check("shrink preserves toolName", t.toolName === "read");
}
// (3) Checkpoint rewind maps entry→message position + hides after checkpoint.
{
  const branchLTR = [
    { type: "message", id: "e5", parentId: "e4", timestamp: "t5" },
    { type: "message", id: "e4", parentId: "e3", timestamp: "t4" },
    { type: "label", id: "e3", parentId: "e2", timestamp: "t3", label: "mulligan:checkpoint:alpha", targetId: "e2" },
    { type: "message", id: "e2", parentId: "e1", timestamp: "t2" },
    { type: "message", id: "e1", parentId: null, timestamp: "t1" },
  ];
  const ev = { type: "context", messages: [
    { role: "user", content: "u1" }, { role: "assistant", content: [{ type: "text", text: "a1" }] },
    { role: "user", content: "u2" }, { role: "assistant", content: [{ type: "text", text: "a2" }] },
  ] } as unknown as ContextEvent;
  const res = contextHandler(ev, mkCtx([rewindMarker("rw", 1, "checkpoint", { checkpoint: "alpha" })], branchLTR, "ckpt")) as { messages: unknown[] };
  const s = JSON.stringify(res.messages);
  check("checkpoint rewind hides after checkpoint", !s.includes("u2") && !s.includes("a2"), `4→${res.messages.length}`);
  check("checkpoint rewind keeps prefix", s.includes("u1") && s.includes("a1"));
}
// (4) Mutation warning (E5) — ledger extracts modifiedFiles + warning appended.
{
  const entries = [
    { type: "message", id: "e1", parentId: null, timestamp: "t1", message: { role: "user", content: "do" } },
    { type: "message", id: "e2", parentId: "e1", timestamp: "t2", message: { role: "assistant", content: [{ type: "toolCall", id: "w1", name: "write", arguments: { path: "out.ts" } }] } },
    { type: "message", id: "e3", parentId: "e2", timestamp: "t3", message: { role: "toolResult", toolCallId: "w1", toolName: "write", content: [{ type: "text", text: "ok" }] } },
  ] as unknown as SessionEntry[];
  const ctx = { sessionManager: { getSessionId: () => "m", getEntries: () => [], getBranch: () => [], buildContextEntries: () => entries, getLeafId: () => "leaf" } } as unknown as ExtensionContext;
  const pi = { appendEntry: () => {}, sendMessage: () => {}, setLabel: () => {} } as unknown as ExtensionAPI;
  const res = await makeRewindTool(pi).execute("rw1", {
    note: { what_happened: "w", avoid: "w", true_current_state: "w", next: "w" }, granularity: "last_tool_call_group",
  }, undefined, undefined, ctx);
  const text = (res.content as { text?: string }[])[0]?.text ?? "";
  check("mutation warning (E5) appended", text.includes("⚠"));
  check("ledger modifiedFiles extracted", JSON.stringify((res.details as { ledger?: { modifiedFiles?: string[] } }).ledger?.modifiedFiles).includes("out.ts"));
}
// (5) Fail-open: malformed marker never breaks the turn (E13/E8).
{
  const malformed = { type: "custom", id: "x", parentId: null, timestamp: "t", customType: "mulligan:rewind",
    data: { kind: "rewind", granularity: "last_tool_call_group" } } as unknown as SessionEntry; // missing note/ledger/seq
  const ev = { type: "context", messages: [{ role: "user", content: "hi" }] } as unknown as ContextEvent;
  let threw = false; let out: unknown = undefined;
  try { out = contextHandler(ev, mkCtx([malformed])); } catch { threw = true; }
  check("fail-open: malformed marker doesn't throw", !threw);
  check("fail-open: returns messages (pass-through-safe)", out !== undefined);
}
// (6) Protected boundary: cannot rewind past the first user message (E3).
{
  // Nuclear last_turn when only ONE user message exists → resolveLastTurn refuses (remove=[]).
  const ev = { type: "context", messages: [
    { role: "user", content: "only-task" },
    { role: "assistant", content: [{ type: "toolCall", id: "rw", name: "mulligan_rewind", arguments: {} }] },
    { role: "toolResult", toolCallId: "rw", toolName: "mulligan_rewind", content: [{ type: "text", text: "ok" }] },
  ] } as unknown as ContextEvent;
  const res = contextHandler(ev, mkCtx([rewindMarker("rw", 1, "last_turn", { options: { to_previous_prompt: true } })])) as { messages: unknown[] };
  // Refused: the user task survives (resolveLastTurn nuclear refuses when iFirst===iLast).
  check("protected: first user message not removed (nuclear refused)", JSON.stringify(res.messages).includes("only-task"));
}

let anyFail = false;
for (const r of results) {
  console.log(`  ${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  if (!r.pass) anyFail = true;
}
console.log(`E2E_SUMMARY:${anyFail ? "FAIL" : "PASS"}`);
process.exit(anyFail ? 1 : 0);
TYPESCRIPT
E2E_OUT=$(npx tsx "$E2E" 2>&1)
E2E_EXIT=$?
rm -f "$E2E"
echo "$E2E_OUT" | grep -E "^  [✅❌]"
if [ $E2E_EXIT -eq 0 ] && echo "$E2E_OUT" | grep -q "E2E_SUMMARY:PASS"; then
  record "end-to-end functional (rewind/shrink/checkpoint/mutation/failopen/protected)" pass
else
  record "end-to-end functional (rewind/shrink/checkpoint/mutation/failopen/protected)" fail
fi

# ── Phase 6: Static integrity checks ─────────────────────────────────────────
banner "Phase 6 — Static integrity (settings gap, LICENSE, console.*)"

# 6a. Settings-reading gap: for the documented config/disable to work, the factory must feed
#     real settings into setConfig. Check CODE (strip // comments) so a doc-comment mentioning
#     'settings.mulligan' does not count as reading it. Real reading = a setConfig(...) call
#     whose argument is NOT exactly `undefined`, OR an actual getSettingsPath() call.
# shellcheck disable=SC2016
INDEX_CODE=$(sed -e 's|//.*$||' src/index.ts)
REAL_SETCFG=$(printf '%s\n' "$INDEX_CODE" | grep -E 'setConfig\(' | grep -vE 'setConfig\(undefined\)' || true)
USES_SETTINGSPATH=$(grep -rE 'getSettingsPath' src/*.ts src/**/*.ts 2>/dev/null | grep -vE '^\s*//' || true)
if [ -n "$REAL_SETCFG" ] || [ -n "$USES_SETTINGSPATH" ]; then
  record "settings.json is read at runtime (README §3 / spec/09 §1)" pass
else
  record "settings.json is read at runtime (README §3 / spec/09 §1)" fail \
    "index.ts calls only setConfig(undefined); settings.mulligan never read → enabled:false / maxDepth / thresholds have no runtime effect"
fi

# 6b. LICENSE file (README §8 + SPEC.md say MIT).
if [ -f LICENSE ]; then
  record "LICENSE file present (MIT per README §8)" pass
else
  record "LICENSE file present (MIT per README §8)" fail "no LICENSE file; package.json has no license field"
fi

# 6c. Stray console.* (VERIFICATION.md claims exactly 1 documented console.warn in config.ts).
STRAY=$(grep -rn "console\.\(log\|error\|debug\|info\)" src/ | wc -l)
if [ "$STRAY" -eq 0 ]; then
  record "no stray console.log/error/debug/info in src/" pass
else
  record "no stray console.log/error/debug/info in src/" fail "$STRAY found"
fi

# 6d. npm test passes (cross-check phase 2 exit).
[ $UNIT_EXIT -eq 0 ] && record "npm test exit 0 (cross-check)" pass || record "npm test exit 0 (cross-check)" fail

# ── Summary ──────────────────────────────────────────────────────────────────
banner "Validation summary"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
if [ $FAIL -gt 0 ]; then
  echo ""
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do echo "    - $f"; done
fi
echo ""

# Exit non-zero if any phase failed.
[ $FAIL -eq 0 ]