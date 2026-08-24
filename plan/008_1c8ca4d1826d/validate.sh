#!/usr/bin/env bash
# validate.sh — pi-mulligan comprehensive validation
#
# Phases (only those that exist in this codebase):
#   1. Type checking        (npm run typecheck — no linter config exists)
#   2. Unit testing         (npm test — vitest, 24 files)
#   3. Integration smoke    (real `pi` CLI, isolated from global extension conflicts)
#   4. E2E user journeys    (cross-module simulation: tools+markers+nudges+filter with a stateful fake Pi)
#   5. Docs-contract checks (README verbatim quotes, spec refs, stale artifacts)
#
# Usage: bash validate.sh   (from the repo root)
set -u
cd "$(dirname "$0")"

PASS=0; FAIL=0
phase() { echo; echo "════════ PHASE $* ══════════"; }
record() { if [ "$1" -eq 0 ]; then PASS=$((PASS+1)); echo "  ✅ $2"; else FAIL=$((FAIL+1)); echo "  ❌ $3"; fi }
note()   { echo "  ℹ️  $*"; }

──────────() { :; } # no-op guard for editors

# ── Phase 1: Type checking ─────────────────────────────────────────────────
phase "1: TYPE CHECKING"
if command -v npm >/dev/null 2>&1; then
  npm run typecheck >/tmp/validate-typecheck.log 2>&1
  record $? "typecheck (tsc --noEmit) clean" "typecheck FAILED — see /tmp/validate-typecheck.log"
else
  note "npm not found — skipping"
fi

# ── Phase 2: Unit tests ────────────────────────────────────────────────────
phase "2: UNIT TESTS (vitest)"
npx vitest run >/tmp/validate-vitest.log 2>&1
rc=$?
if [ $rc -eq 0 ]; then
  summary=$(grep -E "^ +Tests +" /tmp/validate-vitest.log | tail -1)
  record 0 "unit tests: $summary"
else
  record 1 "unit tests FAILED" "unit tests FAILED — see /tmp/validate-vitest.log"
fi

# ── Phase 3: Integration smoke (real pi CLI) ──────────────────────────────
# NOTE: `npm run smoke` as shipped FAILS 0/14 on any machine that also has a
# globally-installed mulligan package (tool-name conflict at extension load).
# We run the SAME orchestrator patched with `-ne` (disable extension discovery)
# so the repo's own extension is the only one loaded. This is validation-run
# scaffolding only — the repo files are untouched.
phase "3: INTEGRATION SMOKE (real pi, isolated)"
if command -v pi >/dev/null 2>&1; then
  sed 's/"-e", "\.\/src\/index\.ts"/"-ne", "-e", ".\/src\/index.ts"/' \
    test/integration/run-smoke.mjs > "${TMPDIR:-/tmp}/run-smoke-ne.mjs"
  node "${TMPDIR:-/tmp}/run-smoke-ne.mjs" >/tmp/validate-smoke.log 2>&1
  rc=$?
  n=$(grep -c "^PASS" /tmp/validate-smoke.log || true)
  if [ $rc -eq 0 ]; then
    record 0 "integration smoke: ${n}/14 scenarios passed (isolated mode)"
  else
    record 1 "integration smoke FAILED (see /tmp/validate-smoke.log)" "integration smoke FAILED — see /tmp/validate-smoke.log"
    note "un-isolated \`npm run smoke\` additionally fails 0/14 when a global mulligan package is installed (tool conflict)"
  fi
else
  note "pi CLI not on PATH — skipping (CI cannot run this phase either)"
fi

# ── Phase 4: E2E user journeys (cross-module simulation) ───────────────────
phase "4: E2E USER JOURNEYS (cross-module)"
# The journeys drive the REAL src modules (tools, markers, nudges, filter,
# transforms, commands) through complete user workflows with only the Pi
# *surface* faked (stateful session harness — no logic mocked):
#   J1  bloated result → Nudge A reminder → current-turn shrink → view
#       substitution (stamp, pairing) → persistence across later turns →
#       original intact on disk
#   J2  cross-turn shrink target → hard refusal (v2.0) with zero persistence
#   J3  rewind journey: note persisted, pinned hideEntryIds, span hidden,
#       user message kept, note visible, own call kept, no leak-back after
#       new work, redo work visible
#   J4  cancel: marker retracted, hidden content reappears next fire
#   J5  audit: filtered-view report, read-only
#   J6  per-prompt retry budget: first-N allowed, N+1 refused pre-persist,
#       budget reset on new prompt, shrink/audit still callable
#   J7  checkpoint consent: user command sets label+banner, agent checkpoint
#       rewind hides subsequent prompts but never first:user, auto-expiry,
#       last_turn guardrail
#   J8  checkpoint revoke withdraws the grant
#   J9  drift nudge: sustained growth fires, text is awareness-only (v2.0),
#       never persisted
#   J10 disabled master switch: filter pass-through + all 4 tools refuse
#   J11 abortContextFraction: refused at ≥90% of the FILTERED window
#   J12 shrink orientation line: present on activation, absent on refusal
#   J13 C13/E27 prepareArguments shim: stringified-object params repaired,
#       malformed input passed through
mkdir -p "${TMPDIR:-/tmp}/mulligan-validate"
cat > "${TMPDIR:-/tmp}/mulligan-validate/journeys.ts" <<'JOURNEYS_EOF'
import { makeShrinkTool } from "SOURCE/src/tools/shrink.js";
import { makeRewindTool } from "SOURCE/src/tools/rewind.js";
import { makeCancelTool } from "SOURCE/src/tools/cancel.js";
import { auditTool } from "SOURCE/src/tools/audit.js";
import { makeCheckpointCommand, makeCheckpointRevokeCommand } from "SOURCE/src/commands.js";
import { contextHandler } from "SOURCE/src/filter.js";
import { resetRuntime } from "SOURCE/src/runtime.js";
import { setConfig } from "SOURCE/src/config.js";
import { registerBloatReminder, registerTurnEndMetric } from "SOURCE/src/nudges.js";
import { prepareObjectArgs } from "SOURCE/src/prepare-args.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

let PASS = 0, FAIL = 0;
const ok = (c: boolean, n: string) => { if (c) { PASS++; } else { FAIL++; console.log(`  FAIL ${n}`); } };

class FS {
  entries: any[] = []; seq = 0; leafId = "seed"; notifyCalls: any[] = []; widgetState: any = null;
  labels = new Map<string, string | undefined>();
  appendEntry(t: string, d?: unknown) { this.seq++; const id = `entry-${this.seq}`; this.entries.push({ type: "custom", id, parentId: this.leafId, timestamp: new Date().toISOString(), customType: t, data: d }); this.leafId = id; return id; }
  appendMessage(m: any, h?: string) { this.seq++; const id = h ?? `entry-${this.seq}`; this.entries.push({ type: "message", id, parentId: this.leafId, timestamp: new Date().toISOString(), message: m }); this.leafId = id; return id; }
  appendCustomMessage(m: any) { this.seq++; const id = `entry-${this.seq}`; this.entries.push({ type: "custom_message", id, parentId: this.leafId, timestamp: new Date().toISOString(), message: m }); this.leafId = id; return id; }
  setLabel(id: string, l: string | undefined) { this.seq++; const lid = `entry-${this.seq}`; this.entries.push({ type: "label", id: lid, parentId: this.leafId, timestamp: new Date().toISOString(), targetId: id, label: l }); this.leafId = lid; this.labels.set(id, l); }
  getLabel(id: string) { return this.labels.get(id); }
}
let sess: FS;
let usageOverride: any = { tokens: 1000, contextWindow: 100000 };
const pi = (): ExtensionAPI => ({ appendEntry: (t: string, d?: unknown) => sess.appendEntry(t, d), sendMessage: (m: any) => sess.appendCustomMessage(m), setLabel: (id: string, l: string | undefined) => sess.setLabel(id, l), registerTool: () => {}, registerCommand: () => {}, on: () => {} } as unknown as ExtensionAPI);
const ctx = (): ExtensionContext => ({
  sessionManager: { getSessionId: () => "e2e", getLeafId: () => sess.leafId, getEntries: () => sess.entries, getBranch: () => sess.entries.slice(), buildContextEntries: () => sess.entries, getLabel: (id: string) => sess.getLabel(id) },
  hasUI: true, mode: "tui", getContextUsage: () => usageOverride,
  ui: { notify: (m: string, t?: string) => sess.notifyCalls.push({ message: m, type: t }), setWidget: (k: string, c: any) => { sess.widgetState = c === undefined ? null : { key: k, content: c }; } },
} as unknown as ExtensionContext);
const user = (t: string) => ({ role: "user", content: t });
const assistant = (t = "", calls: any[] = []) => ({ role: "assistant", content: [...(t ? [{ type: "text", text: t }] : []), ...calls] });
const call = (id: string, name: string, args: any) => ({ type: "toolCall", id, name, arguments: args });
const result = (id: string, name: string, text: string) => ({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }], isError: false });
const branchMsgs = () => sess.entries.filter((e: any) => e.type === "message" || e.type === "custom_message").map((e: any) => e.type === "message" ? e.message : { role: "custom", ...e.message });
const fire = () => { const o = contextHandler(pi() as any, { type: "context", messages: branchMsgs() } as any, ctx() as any); return o?.messages ?? branchMsgs(); };
const run = async (tool: any, args: any) => await tool.execute("e2e-call", args, undefined, () => {}, ctx() as any);
const fresh = (cfg?: any) => { sess = new FS(); resetRuntime("e2e"); setConfig(cfg); };
const note = { what_happened: "wasted context on a wrong approach", true_current_state: "no changes yet", next: "try a narrower search" };

async function main() {
  const rewind = makeRewindTool(pi() as any);
  const shrink = makeShrinkTool(pi() as any);
  const cancel = makeCancelTool(pi() as any);
  const ckpt = makeCheckpointCommand(pi() as any);
  const revoke = makeCheckpointRevokeCommand(pi() as any);

  // J1: bloat reminder + current-turn shrink + persistence
  fresh();
  sess.appendMessage(user("find the auth bug"), "u1");
  sess.appendMessage(assistant("", [call("c1", "bash", {})]), "a1");
  const big = "AUTH LINE ".repeat(3000);
  sess.appendMessage(result("c1", "bash", big), "r1");
  const bh: any[] = [];
  { const p: any = pi(); p.on = (ev: string, h: any) => { if (ev === "tool_result") bh.push(h); }; registerBloatReminder(p); }
  const bOut = await bh[0]({ type: "tool_result", toolName: "bash", toolCallId: "c1", content: [{ type: "text", text: big }] }, ctx() as any);
  ok(!!bOut && JSON.stringify(bOut).includes("mulligan_shrink"), "J1 nudge A reminder");
  const sh = await run(shrink, { target: { by_tool_name: "bash", occurrence: "last" }, replacement: "3 hits in src/auth/*" });
  ok(JSON.stringify(sh).includes("Context updated: 1 result(s) summarized"), "J1 orientation line");
  const sm = sess.entries.find((e: any) => e.customType === "mulligan:shrink");
  ok(!!sm?.data?.pinnedEntryId, "J1 marker pinned");
  const v1 = fire();
  const r1v = v1.find((m: any) => m.role === "toolResult");
  ok(JSON.stringify(r1v.content).includes("<context-shrunk>") && !JSON.stringify(r1v.content).includes("AUTH LINE"), "J1 view substituted");
  ok(r1v.toolCallId === "c1", "J1 pairing preserved");
  sess.appendMessage(user("next turn"), "u2");
  sess.appendMessage(assistant("working"), "a2");
  const v1b = fire();
  ok(JSON.stringify(v1b.find((m: any) => m.role === "toolResult").content).includes("<context-shrunk>"), "J1 persists next turn");
  ok(JSON.stringify(sess.entries.find((e: any) => e.id === "r1").message.content).includes("AUTH LINE"), "J1 original on disk");

  // J2: cross-turn refusal
  fresh();
  sess.appendMessage(user("turn one"), "u1");
  sess.appendMessage(assistant("", [call("old1", "bash", {})]), "a1");
  sess.appendMessage(result("old1", "bash", "big"), "r1");
  sess.appendMessage(user("turn two"), "u2");
  sess.appendMessage(assistant("", [call("new1", "read", {})]), "a2");
  sess.appendMessage(result("new1", "read", "small"), "r2");
  ok(JSON.stringify(await run(shrink, { target: { by_tool_call_id: "old1" }, replacement: "x" })).includes("previous turn"), "J2 old-turn id refused");
  ok(JSON.stringify(await run(shrink, { target: { by_tool_name: "grep", occurrence: "last" }, replacement: "x" })).includes("refused"), "J2 no-match refused");
  ok(!sess.entries.some((e: any) => e.customType === "mulligan:shrink"), "J2 nothing persisted");
  ok(JSON.stringify(await run(shrink, { target: { by_tool_call_id: "new1" }, replacement: "s" })).includes("shrink recorded"), "J2 same-turn works");

  // J3: rewind journey
  fresh();
  sess.appendMessage(user("fix the bug"), "u1");
  sess.appendMessage(assistant("", [call("g1", "bash", {})]), "a1");
  sess.appendMessage(result("g1", "bash", "foo foo foo"), "r1");
  sess.appendMessage(assistant("", [call("rw1", "mulligan_rewind", {})]), "a3");
  const rw = await rewind.execute("rw1", { note, granularity: "last_tool_call_group" }, undefined, () => {}, ctx() as any);
  ok(JSON.stringify(rw).includes("rewound last_tool_call_group"), "J3 rewind ok");
  const rwm = sess.entries.find((e: any) => e.customType === "mulligan:rewind");
  ok(Array.isArray(rwm?.data?.hideEntryIds) && rwm.data.hideEntryIds.length > 0, "J3 hideEntryIds pinned");
  ok(sess.entries.some((e: any) => e.type === "custom_message" && e.message?.customType === "mulligan:note"), "J3 note persisted");
  sess.appendMessage(result("rw1", "mulligan_rewind", "ok"), "r3");
  const v3 = fire();
  ok(!JSON.stringify(v3).includes('"g1"'), "J3 span hidden");
  ok(v3.some((m: any) => m.role === "user") && v3.some((m: any) => m.role === "custom" && m.customType === "mulligan:note"), "J3 user kept + note visible");
  sess.appendMessage(assistant("redo work"), "a4");
  const v3b = fire();
  ok(!JSON.stringify(v3b).includes('"g1"') && v3b.some((m: any) => JSON.stringify(m).includes("redo work")), "J3 no leak-back, redo visible");

  // J4: cancel
  const cn = await run(cancel, { target: { by_tool_name: "bash", occurrence: "last" } });
  ok(JSON.stringify(cn).includes("cancelled"), "J4 cancel ok");
  ok(JSON.stringify(fire()).includes('"g1"'), "J4 content reappears");

  // J5: audit
  fresh();
  sess.appendMessage(user("audit"), "u1");
  sess.appendMessage(assistant("", [call("b1", "bash", {})]), "a1");
  sess.appendMessage(result("b1", "bash", "X".repeat(20000)), "r1");
  fire();
  const au = await run(auditTool, { top: 5 });
  ok(JSON.stringify(au).includes("Mulligan audit"), "J5 audit renders");
  ok(!sess.entries.some((e: any) => e.customType === "mulligan:rewind" || e.customType === "mulligan:shrink"), "J5 read-only");

  // J6: retry budget
  fresh({ rewind: { maxRetriesPerPrompt: 3, maxDepth: 50 } });
  sess.appendMessage(user("task"), "u1");
  for (const i of [1, 2, 3]) {
    sess.appendMessage(assistant("", [call(`t${i}`, "bash", {})]), `a${i}`);
    sess.appendMessage(result(`t${i}`, "bash", "out"), `r${i}`);
    const r = await run(rewind, { note, granularity: "last_turn" });
    ok(JSON.stringify(r).includes("rewound last_turn"), `J6 rewind #${i} (budget 3)`);
  }
  sess.appendMessage(assistant("", [call("t4", "bash", {})]), "a4");
  sess.appendMessage(result("t4", "bash", "out"), "r4");
  const r6 = JSON.stringify(await run(rewind, { note, granularity: "last_turn" }));
  ok(r6.includes("per-prompt retry budget"), "J6 N+1 refused with budget text");
  ok(!JSON.stringify(await run(shrink, { target: { by_tool_call_id: "t4" }, replacement: "s" })).includes("refused —"), "J6 shrink callable post-budget");
  ok(!JSON.stringify(await run(auditTool, {})).includes("refused"), "J6 audit callable post-budget");
  sess.appendMessage(user("new prompt"), "u2");
  sess.appendMessage(assistant("", [call("t5", "bash", {})]), "a5");
  sess.appendMessage(result("t5", "bash", "out"), "r5");
  ok(JSON.stringify(await run(rewind, { note, granularity: "last_turn" })).includes("rewound last_turn"), "J6 budget resets on new prompt");

  // J7: checkpoint consent
  fresh();
  sess.appendMessage(user("original task"), "u0");
  sess.appendMessage(assistant("starting"), "a0");
  await ckpt.handler("before-wild", ctx() as any);
  ok(sess.notifyCalls.some((n: any) => n.message.includes("may rewind across your subsequent prompts")), "J7 fair warning");
  ok(!!sess.widgetState && JSON.stringify(sess.widgetState).includes("before-wild"), "J7 banner armed");
  sess.appendMessage(user("prompt one"), "u1");
  sess.appendMessage(assistant("w1"), "a1");
  sess.appendMessage(user("prompt two"), "u2");
  sess.appendMessage(assistant("", [call("rw7", "mulligan_rewind", {})]), "a2");
  ok(JSON.stringify(await run(rewind, { note, granularity: "checkpoint", checkpoint: "before-wild" })).includes("rewound"), "J7 checkpoint rewind ok");
  sess.appendMessage(result("rw7", "mulligan_rewind", "ok"), "r2");
  const v7 = JSON.stringify(fire());
  ok(!v7.includes("prompt one") && !v7.includes("prompt two"), "J7 subsequent prompts hidden (consented)");
  ok(v7.includes("original task"), "J7 first:user never hidden");
  ok(JSON.stringify(await run(rewind, { note, granularity: "checkpoint", checkpoint: "before-wild" })).includes("not found"), "J7 auto-expired");

  // J8: revoke
  await ckpt.handler("temp", ctx() as any);
  await revoke.handler("temp", ctx() as any);
  ok(sess.notifyCalls.some((n: any) => n.message.includes("revoked")), "J8 revoke notify");
  ok(JSON.stringify(await run(rewind, { note, granularity: "checkpoint", checkpoint: "temp" })).includes("not found"), "J8 revoked = unreachable");

  // J9: drift nudge awareness-only
  fresh();
  const handlers: any = {};
  { const p: any = pi(); p.on = (ev: string, h: any) => { handlers[ev] = h; }; registerTurnEndMetric(p); }
  for (const i of [1, 2, 3]) {
    sess.appendMessage(user(`t${i}`), `u${i}`);
    fire();
    sess.appendMessage(assistant("", [call(`c${i}`, "bash", {})]), `a${i}`);
    sess.appendMessage(result(`c${i}`, "bash", "x".repeat(20000)), `r${i}`);
    fire();
    await handlers["turn_end"]({ type: "turn_end", turnIndex: i }, ctx() as any);
  }
  sess.appendMessage(user("t4"), "u4");
  const v9 = fire();
  const nudge = v9.find((m: any) => m.role === "custom" && m.customType === "mulligan:nudge");
  ok(!!nudge, "J9 drift nudge fires on sustained growth");
  if (nudge) {
    const txt = typeof nudge.content === "string" ? nudge.content : JSON.stringify(nudge.content);
    ok(!txt.includes("mulligan_rewind") && !txt.includes("mulligan_shrink"), "J9 awareness-only (no prescription)");
    ok(txt.includes("Keep this turn's outputs lean"), "J9 v2.0 tail");
  }
  ok(!sess.entries.some((e: any) => e.type === "custom_message" && e.message?.customType === "mulligan:nudge"), "J9 nudge never persisted");

  // J10: disabled
  fresh({ enabled: false });
  sess.appendMessage(user("x"), "u1");
  sess.appendMessage(assistant("", [call("d1", "bash", {})]), "a1");
  sess.appendMessage(result("d1", "bash", "bloated".repeat(3000)), "r1");
  ok(JSON.stringify(fire()).includes("bloated"), "J10 filter pass-through");
  ok(JSON.stringify(await run(rewind, { note, granularity: "last_tool_call_group" })).includes("disabled"), "J10 rewind refuses");
  ok(JSON.stringify(await run(shrink, { target: { by_tool_call_id: "d1" }, replacement: "s" })).includes("disabled"), "J10 shrink refuses");
  ok(JSON.stringify(await run(auditTool, {})).includes("disabled"), "J10 audit refuses");
  ok(JSON.stringify(await run(cancel, { markerId: "x" })).includes("disabled"), "J10 cancel refuses");

  // J11: abortContextFraction (filtered view filled to ≥90%)
  fresh({ rewind: { maxDepth: 50, maxRetriesPerPrompt: 50 } });
  sess.appendMessage(user("big"), "u1");
  sess.appendMessage(assistant("", [call("b1", "read", {})]), "a1");
  sess.appendMessage(result("b1", "read", "Z".repeat(40000)), "r1");
  sess.appendMessage(assistant("", [call("b2", "bash", {})]), "a2");
  sess.appendMessage(result("b2", "bash", "Y".repeat(360000)), "r2");
  fire();
  usageOverride = { tokens: 95000, contextWindow: 100000 };
  const r11 = JSON.stringify(await run(rewind, { note, granularity: "last_tool_call_group" }));
  ok(/context is at \d+% of the window/.test(r11), "J11 context-fraction refusal");
  ok(!sess.entries.some((e: any) => e.customType === "mulligan:rewind"), "J11 refused before persisting");

  // J12: orientation-line honesty
  fresh();
  sess.appendMessage(user("x"), "u1");
  sess.appendMessage(assistant("", [call("s1", "bash", {})]), "a1");
  sess.appendMessage(result("s1", "bash", "o".repeat(4000)), "r1");
  ok(JSON.stringify(await run(shrink, { target: { by_tool_call_id: "s1" }, replacement: "sum" })).includes("no re-verification or re-reading is needed."), "J12 line on activation");
  ok(!JSON.stringify(await run(shrink, { target: { by_tool_call_id: "nope" }, replacement: "s" })).includes("Context updated:"), "J12 no line on refusal");

  // J13: prepareArguments shim
  const shim = prepareObjectArgs(["target"]);
  const p1: any = shim({ target: '{"by_tool_call_id":"s1"}' });
  ok(typeof p1.target === "object" && p1.target.by_tool_call_id === "s1", "J13 stringified object repaired");
  const p2: any = shim({ target: "not json {" });
  ok(p2.target === "not json {", "J13 malformed passthrough");
  const p3: any = shim({ target: "[1,2]" });
  ok(p3.target === "[1,2]", "J13 array passthrough");

  console.log(`E2E JOURNEYS: ${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("crash:", e); process.exit(2); });
JOURNEYS_EOF
sed -i "s|SOURCE|$(pwd)|g" "${TMPDIR:-/tmp}/mulligan-validate/journeys.ts"
node_modules/.bin/vite-node "${TMPDIR:-/tmp}/mulligan-validate/journeys.ts" >/tmp/validate-e2e.log 2>&1
record $? "E2E journeys passed ($(grep -oE '[0-9]+ passed' /tmp/validate-e2e.log | tail -1))" "E2E journeys FAILED — see /tmp/validate-e2e.log"

# ── Phase 5: Docs-contract checks ─────────────────────────────────────────
phase "5: DOCS CONTRACT"
# 5a. README §4 claims verbatim copies of tool descriptions
node - <<'DOCS_EOF'
const fs = require("fs");
let bad = 0;
const readme = fs.readFileSync("README.md", "utf8");
const tools = [["mulligan_rewind","src/tools/rewind.ts","REWIND_DESC"],["mulligan_shrink","src/tools/shrink.ts","SHRINK_DESC"],["mulligan_audit","src/tools/audit.ts","AUDIT_DESC"],["mulligan_cancel","src/tools/cancel.ts","CANCEL_DESC"]];
for (const [label, file, konst] of tools) {
  const src = fs.readFileSync(file, "utf8");
  const m = src.match(new RegExp("export const " + konst + "\\s*=\\s*((?:\"[^\"]*\"(?:\\s*\\+\\s*)?)+);"));
  if (!m) { console.log(`  ❓ ${label}: DESC not parsed`); continue; }
  const desc = eval(m[1]);
  console.log(readme.includes(desc) ? `  ✅ ${label}: README quote verbatim` : `  ❌ ${label}: README quote DRIFTED from ${konst}`);
  if (!readme.includes(desc)) bad++;
}
// spec file references resolve
const refs = [...readme.matchAll(/spec\/([0-9a-z-]+\.md)/g)].map((m) => m[1]);
for (const r of new Set(refs)) {
  const ok = fs.existsSync("spec/" + r);
  if (!ok) { console.log(`  ❌ README references missing spec/${r}`); bad++; }
}
process.exit(bad ? 1 : 0);
DOCS_EOF
record $? "docs contract holds (README quotes + spec refs)" "docs contract FAILED (see above)"

# 5b. stale build artifact
if [ -f pi-mulligan-0.1.0.tgz ] && [ -f package.json ]; then
  pkgv=$(node -p "require('./package.json').version")
  if [ "$pkgv" != "0.1.0" ]; then
    record 1 "stale artifact pi-mulligan-0.1.0.tgz (package.json is v${pkgv})" "stale artifact pi-mulligan-0.1.0.tgz committed at repo root while package.json is v${pkgv}"
  else
    record 0 "tgz version matches"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────
echo
echo "════════════════ SUMMARY ══════════════════"
echo "  checks passed: $PASS"
echo "  checks failed: $FAIL"
if [ $FAIL -gt 0 ]; then echo "  VERDICT: ISSUES FOUND"; exit 1; else echo "  VERDICT: CLEAN"; exit 0; fi