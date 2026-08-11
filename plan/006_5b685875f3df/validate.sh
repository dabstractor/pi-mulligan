#!/usr/bin/env bash
# validate.sh - pi-mulligan comprehensive validation script.
# Runs every verification gate the project exposes (typecheck, unit tests, integration smoke)
# PLUS targeted end-to-end probes that exercise real agent workflows and edge cases the
# existing suite does not cover (notably: pinned-marker composition across multiple rewinds/shrinks).
set -uo pipefail
cd "$(dirname "$0")"
PASS=0; FAIL=0; GATE=""
ok()  { echo "PASS  $GATE"; PASS=$((PASS+1)); }
bad() { echo "FAIL  $GATE  ($1)"; FAIL=$((FAIL+1)); }
section() { echo ""; echo "-- $1 --"; }

section "Phase 1 - Type checking (tsc --noEmit)"
GATE="tsc --noEmit (strict)"
if npx tsc --noEmit; then ok; else bad "type errors"; fi

section "Phase 2 - Linting / formatting"
GATE="no stray console.log/error/info/debug in src"
STRAY=$(grep -rn 'console\.\(log\|error\|info\|debug\)' src/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$STRAY" -eq 0 ]; then ok; else bad "$STRAY stray console.* calls"; fi

section "Phase 3 - Unit tests (vitest)"
GATE="vitest run"
if npx vitest run >/tmp/vitest-validate.log 2>&1; then
  ok; grep -E "Test Files|Tests " /tmp/vitest-validate.log | tail -2 | sed 's/^/    /'
else
  bad "unit test failures"; tail -20 /tmp/vitest-validate.log | sed 's/^/    /'
fi

section "Phase 4 - Integration smoke (real pi -p runs)"
GATE="npm run smoke (14 F-*/E-* scenarios)"
rm -rf /tmp/mulligan-smoke
rm -f ~/.pi/agent/sessions/--home-dustin-projects-pi-mulligan--/*smoke-* 2>/dev/null || true
if timeout 600 npm run smoke >/tmp/smoke-validate.log 2>&1; then
  ok; grep -E "scenarios passed" /tmp/smoke-validate.log | tail -1 | sed 's/^/    /'
else
  bad "smoke scenario failures"; tail -30 /tmp/smoke-validate.log | sed 's/^/    /'
fi

section "Phase 5 - Zero-config load (spec/11 Step 9)"
GATE="pi -e ./src/index.ts (no config loads clean)"
if timeout 60 pi -e ./src/index.ts -p "Reply with exactly: OK" 2>/dev/null | grep -qi "ok"; then ok; else bad "load failed"; fi

section "Phase 6 - Settings-driven disable (E2E)"
GATE="enabled:false in settings -> extension no-ops + loads"
TD=$(mktemp -d); mkdir -p "$TD/.pi"
echo '{"mulligan":{"enabled":false}}' > "$TD/.pi/settings.json"
cp -r src "$TD/"; cp package.json tsconfig.json "$TD/"
if (cd "$TD" && timeout 60 pi -e ./src/index.ts -p "Reply with exactly: OK" 2>/dev/null | grep -qi "ok"); then ok; else bad "disabled load failed"; fi
GATE="malformed settings.json -> fail-open (still loads)"
echo '{ broken json' > "$TD/.pi/settings.json"
if (cd "$TD" && timeout 60 pi -e ./src/index.ts -p "Reply with exactly: OK" 2>/dev/null | grep -qi "ok"); then ok; else bad "fail-open failed"; fi
rm -rf "$TD"

section "Phase 7 - Config validation robustness"
GATE="validateConfig never throws + coerces"
node --input-type=module -e '
const { validateConfig } = await import(process.cwd()+"/src/config.ts");
let p=0,f=0;
const cases = [
  ["null",[null], c=>c.enabled===true],
  ["array",[[1,2]], c=>c.enabled===true],
  ["abortContextFraction=1.5",[{"rewind":{"abortContextFraction":1.5}}], c=>c.rewind.abortContextFraction===0.9],
  ["maxRetriesPerPrompt=0",[{"rewind":{"maxRetriesPerPrompt":0}}], c=>c.rewind.maxRetriesPerPrompt===5],
  ["driftWindowTurns=0.5",[{"nudges":{"driftWindowTurns":0.5}}], c=>c.nudges.driftWindowTurns===3],
  ["highWaterFraction=1.0",[{"nudges":{"highWaterFraction":1.0}}], c=>c.nudges.highWaterFraction===0.7],
];
for (const [n,args,check] of cases){try{if(check(validateConfig(...args)))p++;else{f++;console.log("  FAIL:",n)}}catch(e){f++;console.log("  THROW:",n)}}
console.log("  config probes: "+p+" pass, "+f+" fail");
if(f>0)process.exit(1);
' >/tmp/config-probe.log 2>&1 && ok && cat /tmp/config-probe.log | sed 's/^/    /' || { bad "config probe"; cat /tmp/config-probe.log | sed 's/^/    /'; }

section "Phase 8 - Pinned-marker composition (E2E correctness)"
GATE="two pinned rewinds (distinct spans) both hide"
node --input-type=module -e '
import { filterPipeline } from "./src/transforms.ts";
const msgs = [
  {role:"user",content:"t"},
  {role:"assistant",content:[{type:"toolCall",id:"c1",name:"grep",arguments:{}}]},
  {role:"toolResult",toolCallId:"c1",toolName:"grep",content:[{type:"text",text:"GREP_OUT"}]},
  {role:"assistant",content:[{type:"toolCall",id:"c2",name:"read",arguments:{}}]},
  {role:"toolResult",toolCallId:"c2",toolName:"read",content:[{type:"text",text:"READ_OUT"}]},
  {role:"assistant",content:[{type:"toolCall",id:"rw1",name:"mulligan_rewind",arguments:{}}]},
  {role:"toolResult",toolCallId:"rw1",toolName:"mulligan_rewind",content:[{type:"text",text:"ok"}]},
  {role:"custom",customType:"mulligan:note",content:"n1"},
  {role:"assistant",content:[{type:"toolCall",id:"rw2",name:"mulligan_rewind",arguments:{}}]},
  {role:"toolResult",toolCallId:"rw2",toolName:"mulligan_rewind",content:[{type:"text",text:"ok"}]},
  {role:"custom",customType:"mulligan:note",content:"n2"},
];
const branch=[0,1,2,3,4,5,6,7,8,9,10].map(i=>({type:(i===7||i===10)?"custom_message":"message",id:"e"+i}));
const markers={rewinds:[
  {seq:1,granularity:"last_tool_call_group",excludeToolCallId:"rw1",hideEntryIds:["e1","e2"]},
  {seq:2,granularity:"last_tool_call_group",excludeToolCallId:"rw2",hideEntryIds:["e3","e4"]},
],shrinks:[]};
const out=filterPipeline(msgs,markers,{rewind:{protectedRoles:["first:user","latest:user"]}},branch);
const g=!out.some(m=>JSON.stringify(m).includes("GREP_OUT"));
const r=!out.some(m=>JSON.stringify(m).includes("READ_OUT"));
console.log("  grep hidden:"+g+" | read hidden:"+r+" | len:"+out.length+" (expect 7)");
process.exit(g&&r?0:1);
' >/tmp/composition-probe.log 2>&1 && ok || { bad "2nd pinned rewind leaks back"; cat /tmp/composition-probe.log | sed 's/^/    /'; }

GATE="pinned shrink after rewind still substitutes"
node --input-type=module -e '
import { filterPipeline } from "./src/transforms.ts";
const msgs=[
  {role:"user",content:"t"},
  {role:"assistant",content:[{type:"toolCall",id:"c1",name:"grep",arguments:{}}]},
  {role:"toolResult",toolCallId:"c1",toolName:"grep",content:[{type:"text",text:"GREP_OUT"}]},
  {role:"assistant",content:[{type:"toolCall",id:"c2",name:"read",arguments:{}}]},
  {role:"toolResult",toolCallId:"c2",toolName:"read",content:[{type:"text",text:"READ_OUT"}]},
];
const branch=[0,1,2,3,4].map(i=>({type:"message",id:"e"+i}));
const markers={rewinds:[{seq:1,granularity:"last_tool_call_group",excludeToolCallId:"rw1",hideEntryIds:["e1","e2"]}],
  shrinks:[{seq:2,target:{by_tool_name:"read",occurrence:"last"},replacement:"[SHRUNK]",pinnedEntryId:"e4"}]};
const out=filterPipeline(msgs,markers,{rewind:{protectedRoles:["first:user","latest:user"]}},branch);
const r=out.find(m=>m.toolName==="read"); const txt=r?.content?.[0]?.text;
console.log("  read content:"+JSON.stringify(txt)+" (expect [SHRUNK])");
process.exit(txt==="[SHRUNK]"?0:1);
' >/tmp/shrink-probe.log 2>&1 && ok || { bad "pinned shrink no-ops after rewind"; cat /tmp/shrink-probe.log | sed 's/^/    /'; }

section "Phase 9 - Tool workflow E2E (refusals + cancel idempotency)"
GATE="tool refusal paths + cancel idempotency"
cat > /tmp/e2e-wf-driver.ts <<DRIVER
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { makeRewindTool } from "$(pwd)/src/tools/rewind.js";
import { makeShrinkTool } from "$(pwd)/src/tools/shrink.js";
import { makeCancelTool } from "$(pwd)/src/tools/cancel.js";
import { auditTool } from "$(pwd)/src/tools/audit.js";;
const LOG="/tmp/mulligan-wf-results.jsonl"; let pass=0,fail=0;
function log(t:string,ok:boolean){appendFileSync(LOG,JSON.stringify({test:t,status:ok?"pass":"fail"})+"\n");if(ok)pass++;else fail++;}
export default function(pi: ExtensionAPI): void {
  pi.on("session_start", async (_e, ctx) => {
    try {
      appendFileSync(LOG,"# wf\n");
      const rw=makeRewindTool(pi),sh=makeShrinkTool(pi),ca=makeCancelTool(pi);
      const t=(r:any)=>r.content[0]?.text??"";
      const r1=await rw.execute("w1",{note:{what_happened:"",true_current_state:"",next:""},granularity:"last_tool_call_group"},undefined,undefined,ctx);
      log("rewind.invalid_note_refused",/refused/i.test(t(r1))&&/non-empty/.test(t(r1)));
      const r2=await rw.execute("w2",{note:{what_happened:"x",true_current_state:"y",next:"z"},granularity:"last_tool_call_group"},undefined,undefined,ctx);
      const mid=r2.details?.markerId; log("rewind.success",!/refused/i.test(t(r2)));
      const r3=await sh.execute("w3",{target:{by_tool_name:"read",occurrence:"last"},replacement:"  "},undefined,undefined,ctx);
      log("shrink.empty_refused",/refused/i.test(t(r3)));
      if(mid){
        const r4=await ca.execute("w4",{markerId:mid},undefined,undefined,ctx);
        log("cancel.byId",r4.details?.cancelled===true);
        const r5=await ca.execute("w5",{markerId:mid},undefined,undefined,ctx);
        log("cancel.idempotent",/already cancelled/i.test(t(r5))&&r5.details?.cancelled===false);
      }
      const r6=await auditTool.execute("w6",{top:5},undefined,undefined,ctx);
      log("audit.report",/Mulligan audit/.test(t(r6)));
      appendFileSync(LOG,JSON.stringify({summary:{pass,fail}})+"\n");
    }catch(e){appendFileSync(LOG,JSON.stringify({test:"driver",status:"fail",detail:{error:String(e)}})+"\n");}
  });
}
DRIVER
rm -f /tmp/mulligan-wf-results.jsonl
timeout 60 pi -e ./src/index.ts -e /tmp/e2e-wf-driver.ts -p "Reply with exactly: OK" >/dev/null 2>&1
WF_FAIL=$(python3 -c "import json;d=[json.loads(l) for l in open('/tmp/mulligan-wf-results.jsonl') if l.strip() and not l.startswith('#')];s=[x for x in d if 'summary' in x];print(s[0]['summary']['fail'] if s else 1)" 2>/dev/null || echo 1)
if [ "$WF_FAIL" -eq 0 ]; then ok; else bad "workflow failures"; cat /tmp/mulligan-wf-results.jsonl | python3 -c "import json,sys;[print('   ',('PASS' if json.loads(l).get('status')=='pass' else 'FAIL'),json.loads(l).get('test','?')) for l in sys.stdin if l.strip() and not l.startswith('#')]" 2>/dev/null; fi

echo ""
echo "=================================================="
echo "  VALIDATION SUMMARY:  $PASS passed, $FAIL failed"
echo "=================================================="
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
