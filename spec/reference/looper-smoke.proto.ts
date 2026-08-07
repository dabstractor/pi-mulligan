/**
 * looper-smoke.ts — feasibility harness for agent self-rewind.
 *
 * Proves the primitives that "rewind-and-auto-prompt" depends on:
 *   A1  pi.appendEntry()        -> CustomEntry, NOT in LLM context
 *   A2  pi.sendMessage()        -> CustomMessage, IS in LLM context
 *   A4  pi.setLabel()/getLabel  -> checkpoint round-trip
 *   A5  ctx.navigateTree()      -> real tree branch (command context)
 *   A6  pi.sendUserMessage({deliverAs:"followUp"}) from a tool -> command dispatch
 *   B1  context-event filter    -> next inference sees reduced set (auto-prompt)
 *
 * Run:
 *   pi -e ./looper-smoke.ts -p "/looper_test"                 # deterministic suite (A1,A2,A4,A5)
 *   pi -e ./looper-smoke.ts -p "<prompt calling looper_rewind>" # model-loop suite (A6,B1)
 *
 * Results -> /tmp/looper-smoke.log (JSONL).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendFileSync, writeFileSync } from "node:fs";

const LOG = "/tmp/looper-smoke.log";
function log(test: string, status: "pass" | "fail" | "info", detail: unknown) {
  const line = JSON.stringify({ ts: new Date().toISOString(), test, status, detail });
  appendFileSync(LOG, line + "\n");
  // also surface on stderr so print mode captures it
  process.stderr.write(`[looper] ${status.toUpperCase()} ${test}: ${JSON.stringify(detail)}\n`);
}

export default function (pi: ExtensionAPI) {
  try {
    writeFileSync(LOG, `# looper smoke ${new Date().toISOString()}\n`);
  } catch {}

  let cmdTestArmed = false; // one-shot guard for the agent_settled command-dispatch test

  // ---- Pre-inject a "canary" custom message at session start so we have ----
  pi.on("input", async (event, _ctx) => {
    try {
      log("input.fire", "info", { text: String(event.text).slice(0, 40), source: event.source, streamingBehavior: (event as any).streamingBehavior });
    } catch (e) {
      log("input.fire", "fail", { error: String(e) });
    }
  });
  // ---- something concrete for the context filter to drop.                ----
  pi.on("session_start", (_event, ctx) => {
    try {
      pi.sendMessage({ customType: "looper_canary", content: "CANARY-BASE-0xABCD — big noisy bloat", display: false });
      log("setup.canary", "info", { leaf: ctx.sessionManager.getLeafId() });
    } catch (e) {
      log("setup.canary", "fail", { error: String(e) });
    }
  });

  // ---- THE ephemeral-filter proof: logs every context fire, drops canary ----
  // ---- once a rewind marker exists.                                      ----
  pi.on("context", async (event, ctx) => {
    try {
      const msgs = event.messages as any[];
      const canaryIdx = msgs.findIndex((m) => m?.customType === "looper_canary");
      const noteIdx = msgs.findIndex((m) => m?.customType === "looper_note");
      const entries = ctx.sessionManager.getEntries();
      const hasMarker = entries.some(
        (e: any) => e.type === "custom" && e.customType === "looper_rewind_marker",
      );
      log("context.fire", "info", {
        count: msgs.length,
        canaryPresent: canaryIdx >= 0,
        notePresent: noteIdx >= 0,
        hasRewindMarker: hasMarker,
        shrinkCanaryInContext: msgs.some((m: any) => JSON.stringify(m).includes("SHRINK_ME_CANARY_123")),
        shrunkInContext: msgs.some((m: any) => JSON.stringify(m).includes("SHRUNK-RESULT")),
      });
      if (hasMarker && canaryIdx >= 0) {
        const filtered = msgs.filter((_, i) => i !== canaryIdx);
        log("context.filter", "pass", { before: msgs.length, after: filtered.length });
        return { messages: filtered };
      }
    } catch (e) {
      log("context.fire", "fail", { error: String(e) });
    }
  });

  // ---- A6-alt: can an extension dispatch a slash command when IDLE (not ----
  // ---- mid-stream followUp)? agent_settled fires after the turn ends.   ----
  pi.on("agent_settled", async (_event, _ctx) => {
    if (!cmdTestArmed) return;
    cmdTestArmed = false;
    try {
      // idle now; no deliverAs -> normal user-message delivery path
      pi.sendUserMessage("/looper_cmdtest");
      log("A6alt.armed", "info", { sent: "/looper_cmdtest via agent_settled" });
    } catch (e) {
      log("A6alt.armed", "fail", { error: String(e) });
    }
  });

  pi.registerCommand("looper_cmdtest", {
    description: "internal: proves command dispatch from agent_settled",
    handler: async (_args, _ctx) => {
      try {
        pi.appendEntry("looper_cmdtest_ran", { at: Date.now() });
        log("A6alt.cmdtest", "pass", { ran: true });
      } catch (e) {
        log("A6alt.cmdtest", "fail", { error: String(e) });
      }
    },
  });

  pi.registerTool({
    name: "looper_arm_cmd",
    label: "Arm Cmd Test",
    description: "TEST TOOL. Call once when asked. Arms a command-dispatch test that fires after the turn ends.",
    parameters: Type.Object({}),
    async execute() {
      cmdTestArmed = true;
      log("tool.looper_arm_cmd", "pass", { armed: true });
      return { content: [{ type: "text" as const, text: "Armed. The command test will fire after this turn ends." }] };
    },
  });
  // ---- shrink_result proof: tool_result handler replaces big output ----
  pi.on("tool_result", async (event, _ctx) => {
    try {
      const text = (event.content || [])
        .map((c: any) => (c?.type === "text" ? c.text : ""))
        .join("");
      if (text.includes("SHRINK_ME_CANARY_123")) {
        const shrunk = `SHRUNK-RESULT (orig ${text.length} chars; bloat removed)`;
        log("shrink.tool_result", "pass", { origLen: text.length, replacedWith: shrunk });
        return { content: [{ type: "text" as const, text: shrunk }] };
      }
    } catch (e) {
      log("shrink.tool_result", "fail", { error: String(e) });
    }
  });

  pi.registerTool({
    name: "looper_big",
    label: "Big Result",
    description: "TEST TOOL. Returns a large result containing a canary. Call once when asked.",
    parameters: Type.Object({}),
    async execute() {
      const big = "SHRINK_ME_CANARY_123 " + "x".repeat(2000);
      log("tool.looper_big", "info", { producedLen: big.length });
      return { content: [{ type: "text" as const, text: big }] };
    },
  });

  // ---- a follow-up command (A6) all in one call.                      ----
  pi.registerTool({
    name: "looper_rewind",
    label: "Rewind",
    description:
      "TEST TOOL. Call this exactly once when asked. It records a rewind marker, leaves a note, and queues a follow-up command.",
    parameters: Type.Object({ note: Type.String({ description: "short note to leave for your resumed self" }) }),
    async execute(_id, params: any) {
      try {
        pi.appendEntry("looper_rewind_marker", { note: params.note ?? "(no note)", ts: Date.now() });
        pi.sendMessage({
          customType: "looper_note",
          content: `REWIND NOTE: ${params.note ?? "(no note)"}`,
          display: true,
        });
        pi.sendUserMessage("/looper_flag", { deliverAs: "followUp" });
        log("tool.looper_rewind", "pass", { note: params.note });
        return { content: [{ type: "text" as const, text: "Rewind applied: marker set, note left, /looper_flag queued." }] };
      } catch (e) {
        log("tool.looper_rewind", "fail", { error: String(e) });
        return { content: [{ type: "text" as const, text: `rewind failed: ${e}` }] };
      }
    },
  });

  // ---- A5 (clean): navigateTree to a real USER-message target ----
  pi.registerCommand("looper_navtest", {
    description: "internal: navigateTree to the earliest user message on the branch",
    handler: async (_args, ctx) => {
      const sm = ctx.sessionManager as any;
      try {
        const branch = sm.getBranch() as any[]; // leaf -> root
        const userMsgs = branch.filter((e) => e.type === "message" && e.message?.role === "user");
        if (userMsgs.length === 0) { log("A5.user_target", "fail", { reason: "no user messages on branch" }); return; }
        const target = userMsgs[userMsgs.length - 1]; // earliest (closest to root)
        const assistantAfter = branch.filter((e) => e.type === "message" && e.message?.role === "assistant");
        const leafBefore = sm.getLeafId();
        const res: any = await ctx.navigateTree(target.id, { summarize: false });
        const leafAfter = sm.getLeafId();
        const branchAfterIds = (sm.getBranch() as any[]).map((e) => e.id);
        const targetStillOnBranch = branchAfterIds.includes(target.id);
        const assistantAbandoned = !branchAfterIds.some((id) => assistantAfter.some((a) => a.id === id));
        const pass = !res?.cancelled && targetStillOnBranch && assistantAbandoned;
        log("A5.user_target", pass ? "pass" : "fail", {
          target: target.id, leafBefore, leafAfter, branchAfterIds,
          editorText: res?.editorText?.slice(0, 40), cancelled: res?.cancelled,
          targetStillOnBranch, assistantAbandoned,
        });
      } catch (e) {
        log("A5.user_target", "fail", { error: String(e) });
      }
    },
  });

  // ---- Command: deterministic suite (A1,A2,A4,A5) ----
  pi.registerCommand("looper_test", {
    description: "run deterministic looper feasibility suite",
    handler: async (_args, ctx) => {
      const sm = ctx.sessionManager as any;

      // A1: appendEntry -> CustomEntry (note: returns void, not an id)
      try {
        const leafBefore = sm.getLeafId();
        pi.appendEntry("looper_state", { hello: "world" });
        const leafAfter = sm.getLeafId();
        const ce = sm.getLeafEntry();
        const isCustom = ce?.type === "custom" && ce.customType === "looper_state" && leafAfter !== leafBefore;
        log("A1.appendEntry", isCustom ? "pass" : "fail", { leafBefore, leafAfter, type: ce?.type, customType: ce?.customType });
      } catch (e) {
        log("A1.appendEntry", "fail", { error: String(e) });
      }

      // A2: sendMessage -> custom_message entry that participates in context
      try {
        const before = sm.getLeafId();
        pi.sendMessage({ customType: "looper_probe", content: "PROBE", display: false });
        const leaf = sm.getLeafEntry();
        const ok = leaf?.type === "custom_message" && leaf.customType === "looper_probe";
        log("A2.sendMessage", ok ? "pass" : "fail", { before, leafType: leaf?.type, customType: leaf?.customType, id: leaf?.id });
      } catch (e) {
        log("A2.sendMessage", "fail", { error: String(e) });
      }

      // A4: setLabel / getLabel round-trip
      try {
        pi.sendMessage({ customType: "looper_anchor", content: "ANCHOR", display: false });
        const anchor = sm.getLeafEntry();
        pi.setLabel(anchor.id, "looper-checkpoint");
        const label = sm.getLabel(anchor.id);
        log("A4.setLabel", label === "looper-checkpoint" ? "pass" : "fail", { id: anchor.id, label });
      } catch (e) {
        log("A4.setLabel", "fail", { error: String(e) });
      }

      // A5: navigateTree -> real branch. Create A then B, navigate back to A.
      try {
        pi.sendMessage({ customType: "looper_a", content: "A", display: false });
        const aId = sm.getLeafId();
        pi.sendMessage({ customType: "looper_b", content: "B", display: false });
        const bId = sm.getLeafId();
        const res: any = await ctx.navigateTree(aId, { summarize: false });
        const leafAfter = sm.getLeafId();
        const branchAfter = (sm.getBranch() as any[]).map((e) => e.id);
        const treeAfter = sm.getTree();
        // Correct rewind semantics: new leaf's branch passes THROUGH aId and
        // does NOT include bId (B is now on an abandoned sibling branch).
        const includesA = branchAfter.includes(aId);
        const excludesB = !branchAfter.includes(bId);
        // Dump getTree() shape once for the record.
        const treeShape = JSON.stringify(treeAfter).slice(0, 400);
        const pass = !res?.cancelled && includesA && excludesB && leafAfter !== bId;
        const topo = (sm.getEntries() as any[])
          .filter((e) => [aId, bId, leafAfter, "7360a27d"].includes(e.id) || e.parentId === aId || e.id === aId)
          .map((e) => ({ id: e.id, parent: e.parentId, type: e.type, customType: e.customType }));
        const aEntry = sm.getEntry(aId);
        const leafEntry = sm.getEntry(leafAfter);
        log("A5.navigateTree", pass ? "pass" : "fail", {
          targetA: aId, bId, leafAfter, branchAfter,
          includesA, excludesB, cancelled: res?.cancelled,
          aEntry: { id: aEntry?.id, parent: aEntry?.parentId, type: aEntry?.type },
          leafEntry: { id: leafEntry?.id, parent: leafEntry?.parentId, type: leafEntry?.type },
          res: { editorText: res?.editorText, aborted: res?.aborted, hasSummary: !!res?.summaryEntry },
          topo,
        });
      } catch (e) {
        log("A5.navigateTree", "fail", { error: String(e) });
      }

      log("suite.done", "info", { note: "deterministic suite complete" });
    },
  });

  // ---- Command: target of the followUp dispatch probe (A6) ----
  pi.registerCommand("looper_flag", {
    description: "internal: marks that followUp dispatch worked",
    handler: async (_args, _ctx) => {
      try {
        pi.appendEntry("looper_followup_flag", { firedAt: Date.now() });
        log("A6.looper_flag", "pass", { ran: true });
      } catch (e) {
        log("A6.looper_flag", "fail", { error: String(e) });
      }
    },
  });
}