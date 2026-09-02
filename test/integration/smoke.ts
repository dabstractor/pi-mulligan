/**
 * smoke.ts — Mulligan integration smoke harness (Pi HELPER extension, loaded SECOND).
 *
 * Loaded via `pi -e ./src/index.ts -e ./test/integration/smoke.ts …`. Because context/tool_result/turn_end
 * handlers CHAIN in `-e` flag order (Pi runner.js emitContext), the smoke helper runs AFTER Mulligan's filter
 * → it observes the POST-filter messages. It is an OBSERVER ONLY: its `context` handler returns VOID so it
 * never overrides Mulligan's real filter (GOTCHA #1).
 *
 * Responsibilities (spec/10 §2; the PRP "What → Artifact 1"):
 *   (1) Truncate the smoke JSONL log once at factory time; provide a never-throwing smokeLog() helper.
 *   (2) session_start → log sessionFile (so the orchestrator can find the session JSONL) + inject a msg-canary.
 *   (3) context handler (OBSERVER → void) → log {count, msgCanaryPresent, resultCanaryPresent, notePresent,
 *       hasRewindMarker, shrunkInContext, hasNudge} every fire (the spec/10 §2.2 observable set).
 *   (4) registerTool mulligan_smoke_big → returns a large canary result. NOTE: bloatReminderHandler SKIPS
 *       mulligan_* tools (src/nudges.ts GOTCHA #3), so this tool never triggers the bloat reminder regardless
 *       of size; its role is as a shrink target (RESULT_CANARY). New defaults: global bloatThresholdBytes=16384,
 *       bloatThresholdBytesByTool={read:24576}.
 *   (5) registerCommand /mulligan_smoke <scenario> → the DETERMINISTIC driver. Dispatches per scenario using
 *       the REAL tool factories (makeRewindTool/makeShrinkTool/makeCheckpointTool — shared module, same
 *       process) and triggers an observing inference via pi.sendUserMessage("ok",{deliverAs:"followUp"}) so
 *       the filter's effect is observable (GOTCHA #2).
 *   (6) OPTIONAL: enable Mulligan's OWN corroborating filter.fire log (wrapped in try/catch; OFF-by-default).
 *
 * Anti-patterns avoided (PRP "Anti-Patterns to Avoid"):
 *   - context handler returns VOID (never {messages}) — would override Mulligan's filter.
 *   - imports the REAL tools/wrappers (never reimplements them) — tests Mulligan, not a copy.
 *   - never throws out of the factory/handlers (mirror the spike's try/catch discipline).
 */
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendFileSync, writeFileSync } from "node:fs";
// REAL mulligan tools — shared module, same process (research §6). .js extensions (ESM Bundler — GOTCHA #6).
// NOTE: Pi loads extensions via jiti, which gives EACH extension its OWN module cache. So config.ts/log.ts
// imported here are SEPARATE instances from the ones Mulligan uses → setConfig/setLogFile here do NOT affect
// Mulligan's behavior. The smoke helper therefore does NOT attempt to configure Mulligan; it observes via its
// OWN context handler + drives scenarios via the REAL tool factories (makeRewindTool etc. are stateless
// factory closures that capture `pi`, so they work correctly regardless of module cache identity).
import { makeRewindTool } from "../../src/tools/rewind.js";
import { makeShrinkTool } from "../../src/tools/shrink.js";
import { makeCheckpointTool } from "../../src/tools/checkpoint.js";
import { listCheckpoints, makeAuditTool } from "../../src/tools/audit.js";
import { makeAuditCommand } from "../../src/commands.js"; // F-useraudit — the REAL /mulligan_audit handler
import { appendRewindMarker, type RewindMarkerInput } from "../../src/markers.js";
import { getRuntime } from "../../src/runtime.js"; // SHARED module instance — same SessionRuntime src mutated
import { flushRewrites } from "../../src/rewrite-budget.js"; // [v2.1] flush trigger (b) — smoke drives activation after queued ops
import { estimateTokens } from "../../src/tokens.js"; // same estimator src uses (chars/4)

// [v1.2] mulligan_audit is a makeAuditTool(pi) factory. E12/F-useraudit call it with an EMPTY queue (the
// common case — pi is never touched for reads), so a no-op pi stand-in keeps those call sites unchanged.
// Marker-ACTIVATING scenarios must NOT flush through this stand-in (marker writes would be swallowed);
// they call flushRewrites with the REAL pi via flushQueued() instead.
const auditTool = makeAuditTool(
  {} as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI,
);

// ── Log destination (per-scenario isolation via env; orchestrator sets MULLIGAN_SMOKE_LOG) ───────────
const SMOKE_LOG = process.env.MULLIGAN_SMOKE_LOG ?? "/tmp/mulligan-smoke.log";

// Canary marker strings (GOTCHA #3 — scenario-specific observables; never one fixed canary).
const MSG_CANARY = "MULLIGAN-SMOKE-MSG-CANARY"; // injected at session_start; target of last_turn rewind
const RESULT_CANARY = "MULLIGAN-SMOKE-RESULT-CANARY"; // in mulligan_smoke_big; target of shrink
const SHRUNK_MARKER = "MULLIGAN-SMOKE-SHRUNK"; // the shrink replacement string

// SEED canaries for the deterministic HIDING assertions (P1.M3.T2.S1). The session-start MSG_CANARY precedes the first
// user message, so a last_turn rewind (which hides content AFTER the last user message) can NEVER hide it. Instead, a
// SEED model turn (a prepended `-p "Reply with exactly: <SEED>"`) commits a real assistant message AFTER the first user
// message — which the rewind CAN pin + hide. SEED_HIDDEN is the content asserted ABSENT on the observing inference;
// SEED_ANCHOR is the F-checkpoint anchor asserted PRESENT (the checkpoint must keep its anchor, not over-hide).
const SEED_ANCHOR = "MULLIGAN-SMOKE-SEED-ANCHOR";
const SEED_HIDDEN = "MULLIGAN-SMOKE-SEED-HIDDEN";

// F-consent canaries (P1.M2.T3.S1): U1/U2 live in POST-checkpoint USER prompts (consented hiding
// targets); GUARD lives in the user prompt a last_turn rewind re-lands on (must stay VISIBLE).
const CONSENT_U1 = "MULLIGAN-SMOKE-CONSENT-U1";
const CONSENT_U2 = "MULLIGAN-SMOKE-CONSENT-U2";
const CONSENT_GUARD = "MULLIGAN-SMOKE-CONSENT-GUARD";

// F-drift-userexempt canary (P1.M2.T5.S1): embedded in run-smoke.mjs's generated ~60k-token user paste.
// GOTCHA #8 — must be byte-identical to the literal in test/integration/run-smoke.mjs (no shared module).
const PASTE_CANARY = "MULLIGAN-SMOKE-PASTE-CANARY";

// Which logical scenario is running (set+normalized in driveScenario; read by the context handler so its scenario-scoped
// hiding assertions fire on the right post-rewind fire). Module-local mutable — never exported.
let currentScenario = "";

// A canonical 4-field note for the REAL rewind tool (validated by validateNote — all fields non-empty).
const SMOKE_NOTE = {
  what_happened: "smoke test rewind setup",
  avoid: "n/a — deterministic harness",
  true_current_state: "smoke scenario in progress",
  next: "continue the smoke scenario",
};

/**
 * smokeLog — append one JSONL line {ts, test, status, detail} to SMOKE_LOG AND a short line to stderr (so
 * `pi -p` captures it on stderr). NEVER throws (logging must not crash the harness — mirrors the spike's log()).
 * Exported (module-local use only; not part of the public surface).
 */
function smokeLog(test: string, status: "pass" | "fail" | "info", detail: unknown): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), test, status, detail });
  try {
    appendFileSync(SMOKE_LOG, line + "\n");
  } catch {
    /* never crash on a bad log path */
  }
  try {
    process.stderr.write(`[mulligan-smoke] ${status.toUpperCase()} ${test}: ${line}\n`);
  } catch {
    /* never crash */
  }
}

/**
 * Helper: pull the first text block out of an AgentToolResult's content (content is (TextContent | ImageContent)[]).
 */
function resultText(content: { type: string; text?: string }[] | undefined): string {
  if (!Array.isArray(content)) return "";
  const first = content[0];
  return first && typeof first.text === "string" ? first.text : "";
}

/**
 * rewindNow — call the REAL makeRewindTool(pi).execute() with a synthetic toolCallId (research §6). The
 * toolCallId becomes excludeToolCallId on the marker. Returns the result text (success vs refusal is read
 * from the text — the rewind tool encodes refusals as "Mulligan: refused — …"). NEVER throws.
 */
async function rewindNow(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  toolCallId: string,
  granularity: "last_tool_call_group" | "last_turn" | "checkpoint",
  opts?: { checkpoint?: string },
): Promise<{ text: string }> {
  try {
    const tool = makeRewindTool(pi); // shared module → REAL tool bound to the same pi
    const result = await tool.execute(
      toolCallId,
      {
        note: SMOKE_NOTE,
        granularity,
        checkpoint: opts?.checkpoint,
      },
      undefined,
      undefined,
      ctx,
    );
    const text = resultText(result.content as unknown as { type: string; text?: string }[]);
    smokeLog("tool.rewind", "info", { toolCallId, granularity, text: text.slice(0, 120) });
    return { text };
  } catch (e) {
    smokeLog("tool.rewind", "fail", { toolCallId, granularity, error: String(e) });
    return { text: String(e) };
  }
}

/**
 * flushQueued — [v2.1 rewrite budget] activate the session's queued rewrite ops via the designed "audit"
 * flush trigger (rewrite-budget.ts trigger (b)). Since v2 EVERY rewind/shrink op queues INERT first, and a
 * single small smoke op trips no volume/batch trigger (maxMoments=1, flushShedTokens=4000), so scenarios
 * that assert ACTIVE markers must drive an explicit flush. Uses the REAL pi so the flushed markers
 * (mulligan:rewind / mulligan:shrink / mulligan:note + checkpoint label consumption) persist to the
 * session JSONL. smokeLogs the FlushResult (count/ok/applied); NEVER throws.
 */
async function flushQueued(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  try {
    const rt = getRuntime(ctx.sessionManager.getSessionId());
    const res = flushRewrites(pi, ctx as unknown as ExtensionContext, rt, "audit");
    smokeLog("rewrite.flush", res.ok ? "info" : "fail", {
      count: res.count,
      ok: res.ok,
      applied: res.applied,
      momentsSpent: rt.momentsSpent,
    });
  } catch (e) {
    smokeLog("rewrite.flush", "fail", { error: String(e) });
  }
}

// ── driveScenario: the per-scenario deterministic driver (spec/10 §2.1) ───────────────────────

/**
 * bigResult — the canary string (RESULT_CANARY + padding) used by mulligan_smoke_big + the F-shrink-preventive
 * deterministic path. NOTE: mulligan_smoke_big is a mulligan_* tool → bloatReminderHandler SKIPS it
 * (src/nudges.ts GOTCHA #3), so size never triggers the reminder. Defaults now: global 16384; per-tool
 * read 24576 (bash uses the 16 KB global). The canary's job is being a shrink target, not crossing a bloat threshold.
 */
function bigResult(): string {
  // Size is moot for bloat (mulligan_* skip); the value is intentionally unchanged — a shrink-target canary.
  return RESULT_CANARY + " " + "x".repeat(9000);
}

/**
 * driveScenario — dispatch on the scenario name. Each recipe uses the REAL tools/wrappers to set up the
 * scenario's persisted state (markers, checkpoints, config). The OBSERVING INFERENCE (the model turn that
 * fires `context` so the filter's effect is observable) is triggered by the ORCHESTRATOR, which passes a
 * second `-p "continue"` prompt after the `/mulligan_smoke` command. (Print mode does NOT drain a followUp
 * queued from inside a `/cmd` dispatch — verified: the command path returns before the agent drain loop, and
 * `pi.sendUserMessage` is fire-and-forget. A second `-p` prompt reliably triggers the turn + persists the
 * session JSONL.) Each recipe is wrapped in try/catch so a scenario failure logs a fail line and never
 * crashes the command.
 *
 * CANARY STRATEGY (GOTCHA #3): a tool RESULT canary only exists if the model called the tool (we cannot
 * synthesize a toolResult — ReadonlySessionManager has no mutator). So F-rewind-core's deterministic path
 * uses granularity:"last_turn" against the session_start MSG-canary (which IS in the last turn). The context
 * handler logs BOTH canaries so each scenario asserts on the right one.
 */
async function driveScenario(pi: ExtensionAPI, ctx: ExtensionCommandContext, scenario: string): Promise<void> {
  smokeLog("scenario.start", "info", { scenario });
  try {
    // Normalize so the context-handler assertion fires during BOTH F-checkpoint phases (set + rewind).
    currentScenario = scenario.startsWith("F-checkpoint") ? "F-checkpoint" : scenario;
    switch (scenario) {
      case "F-rewind-core": {
        // Deterministic path: create a last_turn rewind marker + note. The CANARY-DROP observation (context.fire
        // count decreasing) is inherently model-driven: a last_turn rewind's target is relative to the CURRENT
        // last user message, which moves with each new prompt, so a canary injected before the observing prompt
        // is no longer "after the last user" by the time the next inference fires. The deterministic assertions
        // here are: (a) the rewind marker + note PERSIST (JSONL invariants), (b) context.fire shows
        // hasRewindMarker:true + notePresent:true (the filter sees the persisted state). The authoritative
        // canary-drop proof is the MODEL-DRIVEN path (documented in scenarios.md): the agent calls
        // mulligan_rewind mid-turn after a bloated tool call, and the next inference's filtered view drops it.
        // [v2.1] the op QUEUES inert under the rewrite budget — flushQueued() activates it via the audit trigger.
        await rewindNow(pi, ctx, "smoke-rewind-1", "last_turn");
        await flushQueued(pi, ctx);
        break;
      }
      case "F-shrink-persist": {
        // v2.0 current-turn semantics (P1.M4.T1.S3). The setup turn (the orchestrator's FIRST -p prompt) is a
        // real model turn: "Call the mulligan_smoke_big tool once…" commits an assistant + toolResult
        // (RESULT_CANARY) INSIDE the current turn span (the /mulligan_smoke command prompt is NOT a user
        // message — pi command dispatch bypasses the agent loop, so currentTurnSpan still starts after the
        // setup prompt). The shrink below drives the REAL makeShrinkTool with a two-arm in-span selector —
        // the marker PERSISTS (JSONL) and the substitution stays visible on the observing turn (the filter
        // bound is the marker's ISSUING turn — scope_guard_design.md §1–§2). The original stays on disk
        // (shrink is a view-substitution, NOT a JSONL rewrite).
        try {
          const tool = makeShrinkTool(pi);
          const result = await tool.execute(
            "smoke-shrink-1",
            { target: { by_tool_name: "mulligan_smoke_big", occurrence: "last" }, replacement: SHRUNK_MARKER, reason: "smoke test" },
            undefined,
            undefined,
            ctx,
          );
          const text = resultText(result.content as unknown as { type: string; text?: string }[]);
          smokeLog("tool.shrink", "info", { variant: "current-turn", text: text.slice(0, 120) });
        } catch (e) {
          smokeLog("tool.shrink", "fail", { variant: "current-turn", error: String(e) });
        }
        // v2.0 REFUSAL variant (replaces the deleted E19 user-message case — spec/08 E19 is MOOT in v2.0: a
        // non-toolResult shrink is no longer expressible; PRD §E19/h2.101). A by_tool_name:"read" target has
        // no in-turn match → the SAME hard-refusal string as the earlier-turn case fires end-to-end, and the
        // refusal appends NOTHING (no second mulligan:shrink marker).
        try {
          const tool2 = makeShrinkTool(pi);
          const result2 = await tool2.execute(
            "smoke-shrink-refusal",
            { target: { by_tool_name: "read", occurrence: "last" }, replacement: "n/a", reason: "v2.0 refusal path (out-of-turn target)" },
            undefined,
            undefined,
            ctx,
          );
          const text2 = resultText(result2.content as unknown as { type: string; text?: string }[]);
          smokeLog("tool.shrink", "info", { variant: "refusal", text: text2.slice(0, 120) });
        } catch (e) {
          smokeLog("tool.shrink", "fail", { variant: "refusal", error: String(e) });
        }
        // [v2.1] the successful shrink QUEUED inert — flush via the audit trigger so the marker persists
        // and the substitution is visible on the observing turn (the refusal appended nothing to the queue).
        await flushQueued(pi, ctx);
        break;
      }
      case "F-shrink-preventive": {
        // The bloat reminder fires on the tool_result EVENT when a NON-mulligan_* result exceeds its resolved
        // threshold (global bloatThresholdBytes=16384; per-tool read 24576, bash = global 16384). mulligan_smoke_big is
        // a mulligan_* tool → bloatReminderHandler SKIPS it (src/nudges.ts GOTCHA #3) → it can NEVER fire here,
        // regardless of canary size. The deterministic path also CANNOT trigger this: calling bigResult()
        // locally is a plain function call — it does NOT go through Pi's tool_result event.
        // So the deterministic assertion is: a turn-metric entry EXISTS (the turn_end handler ran). A real
        // bloatHit:true proof would require a NON-mulligan_* tool whose result exceeds its resolved threshold
        // (read >24576, bash/other >16384) — model-driven; see scenarios.md.
        try {
          const big = bigResult();
          smokeLog("tool.smoke_big", "info", { len: big.length, note: "bloatHit needs model tool call; see scenarios.md" });
        } catch (e) {
          smokeLog("tool.smoke_big", "fail", { error: String(e) });
        }
        break;
      }
      case "F-nudge-drift": {
        // The drift nudge fires when a turn's deltaTokens > driftThresholdTokens (default 3000) AND a baseline
        // exists from a previous turn. The deterministic path CANNOT force this: (a) lowering the threshold via
        // setConfig does NOT work (jiti gives smoke a separate config.ts instance from Mulligan's — verified),
        // and (b) the nudge needs two turns (turn 1 establishes the baseline, turn 2 grows past it). So the
        // deterministic assertions are: a turn-metric entry EXISTS (the turn_end handler ran) + ZERO
        // mulligan:nudge entries in the session JSONL (the §2.3 invariant — nudges are ephemeral). The
        // authoritative nudge-injection proof is the MODEL-DRIVEN path (documented in scenarios.md): a turn
        // that genuinely grows >3000 tokens shows hasNudge:true in context.fire + still 0 nudge entries on disk.
        smokeLog("config.driftLow", "info", { note: "threshold lowering is model-driven; see scenarios.md" });
        break;
      }
      case "F-protected": {
        // v1.1: F-protected = a checkpoint rewind whose scope would reach first:user is refused/blocked.
        // last_turn can no longer cross a user message (the resolver loop starts at iLastUser + 1), so the
        // discarded-user-message drive no longer exists. The first:user crossing is now covered by
        // protectedOk in the filter pipeline (see transforms.test.ts / edge-cases.test.ts).
        smokeLog("F-protected", "info", { note: "moved to checkpoint scope; see spec/10 §2.1" });
        break;
      }
      case "F-maxdepth": {
        // Create 5 rewinds (each a distinct toolCallId), then a 6th → the 6th hits maxDepth(5) and refuses.
        for (let i = 1; i <= 5; i++) {
          await rewindNow(pi, ctx, `smoke-max-${i}`, "last_tool_call_group");
        }
        const sixth = await rewindNow(pi, ctx, "smoke-max-6", "last_tool_call_group");
        smokeLog("maxdepth.sixth", "info", { text: sixth.text.slice(0, 120) });
        break;
      }
      case "F-checkpoint": {
        // Set a checkpoint, then rewind to it. The checkpoint is a label entry; the rewind hides back to it.
        // The orchestrator's second `-p` triggers the observing inference.
        try {
          const cpTool = makeCheckpointTool(pi);
          const cpRes = await cpTool.execute("smoke-cp-1", { name: "alpha" }, undefined, undefined, ctx);
          const cpText = resultText(cpRes.content as unknown as { type: string; text?: string }[]);
          smokeLog("tool.checkpoint", "info", { text: cpText.slice(0, 120) });
        } catch (e) {
          smokeLog("tool.checkpoint", "fail", { error: String(e) });
        }
        await rewindNow(pi, ctx, "smoke-cp-rw-1", "checkpoint", { checkpoint: "alpha" });
        await flushQueued(pi, ctx);
        break;
      }
      case "F-checkpoint-set": {
        // Phase 1 of the F-checkpoint HIDING flow (run-smoke.mjs drives a SEED_ANCHOR model turn BEFORE this command):
        // set the checkpoint ONLY. The SEED_ANCHOR assistant (committed by the preceding prompt) is the stable entry
        // setCheckpoint labels — so it SUCCEEDS (fixes the baseline breakage where a fresh 2-prompt session has no
        // stable entry). A SEED_HIDDEN model turn runs AFTER this, then F-checkpoint-rewind hides it (K>0).
        try {
          const cpTool = makeCheckpointTool(pi);
          const cpRes = await cpTool.execute("smoke-cp-1", { name: "alpha" }, undefined, undefined, ctx);
          const cpText = resultText(cpRes.content as unknown as { type: string; text?: string }[]);
          smokeLog("tool.checkpoint", "info", { phase: "set", text: cpText.slice(0, 120) });
        } catch (e) {
          smokeLog("tool.checkpoint", "fail", { phase: "set", error: String(e) });
        }
        break;
      }
      case "F-checkpoint-rewind": {
        // Phase 2 of the F-checkpoint HIDING flow (a SEED_HIDDEN model turn has run BETWEEN set and this): rewind to
        // 'alpha' → hides the post-checkpoint SEED_HIDDEN turn (K>0). The orchestrator's final `-p "Reply OK"` is the
        // observing inference on which F-checkpoint.hiding is asserted.
        await rewindNow(pi, ctx, "smoke-cp-rw-1", "checkpoint", { checkpoint: "alpha" });
        // [v2.1] flush so the rewind marker persists + the 'alpha' label is consumed at activation.
        await flushQueued(pi, ctx);
        break;
      }
      case "F-consent-rewind": {
        // Phase 1 of F-consent's rewind arm: the REAL checkpoint rewind. Deterministic — no model
        // dependency for the tool call itself. The '/mulligan_checkpoint delta' label was set by the
        // REAL slash command earlier in the prompt flow; this hides both post-checkpoint user prompts.
        await rewindNow(pi, ctx, "smoke-consent-rw-1", "checkpoint", { checkpoint: "delta" });
        break;
      }
      case "F-consent-guard": {
        // Guardrail arm: a last_turn rewind re-lands on the GUARD user prompt — the user message must
        // REMAIN VISIBLE (last_turn never hides a user message; only checkpoint consent does).
        await rewindNow(pi, ctx, "smoke-consent-guard-1", "last_turn");
        break;
      }
      case "F-failopen": {
        // Append a MALFORMED mulligan:rewind marker (missing note/ledger/etc) so the filter's transform
        // path is exercised with bad data. Mulligan's filter is fail-open by construction (filter.ts wraps
        // the whole body in try/catch → pass-through). Assert: the turn SURVIVES (the orchestrator's second
        // `-p` still fires context + exits 0). If no clean throw surfaces, this still verifies pass-through
        // (GOTCHA #9 — the handler-never-throws unit test in filter.test.ts is the authoritative proof).
        try {
          pi.appendEntry("mulligan:rewind", {
            schema: "pi-mulligan",
            v: 1,
            kind: "rewind",
            granularity: "last_tool_call_group",
            // intentionally missing: id, seq, ts, note, ledger, options, excludeToolCallId
          });
          smokeLog("failopen.marker", "info", { appended: "malformed" });
        } catch (e) {
          smokeLog("failopen.marker", "fail", { error: String(e) });
        }
        break;
      }
      case "F-reload": {
        // Run 1 (this process): create a rewind marker. Run 2 (a SECOND pi process with the SAME
        // --session-id) reopens the session and the orchestrator's second `-p` triggers a turn → the
        // orchestrator asserts the marker survived reload (hasRewindMarker:true + canary hidden). The
        // orchestrator runs both; this body only does run 1.
        await rewindNow(pi, ctx, "smoke-reload-1", "last_turn");
        // [v2.1] flush BEFORE exiting — run 2 (a fresh process) can never flush this in-memory queue, and the
        // marker must be ON DISK for the reload assertion to mean anything.
        await flushQueued(pi, ctx);
        break;
      }
      // ── Edge cases (E7/E11/E12/E15/E20) — spec/08 Pi-dependent cases that cannot be unit-tested ──────
      case "E7": {
        // E7 (compaction leak — KNOWN LIMITATION): create a rewind, then log the known-limitation note.
        // v1 accepts that compaction may transiently reference hidden content; no code mitigation exists.
        // This scenario documents + smoke-tests the NO-CRASH property (the turn survives). PASS-with-note.
        await rewindNow(pi, ctx, "smoke-e7-1", "last_turn");
        await flushQueued(pi, ctx); // [v2.1] activate — the JSONL marker/note assertions need it on disk
        smokeLog("E7", "info", {
          note:
            "known limitation — compaction may transiently reference hidden content (v1 accepted; mitigated by later compaction). Note survives.",
        });
        break;
      }
      case "E11": {
        // E11 (reload mid-task): run 1 creates a rewind marker. Run 2 (same --session-id, spawned by the
        // orchestrator) reopens the session → the orchestrator asserts run-2's first context.fire has
        // hasRewindMarker:true (the marker survived the reload into a new process). This body does run 1.
        await rewindNow(pi, ctx, "smoke-e11-1", "last_turn");
        await flushQueued(pi, ctx); // [v2.1] flush before exit — run 2 cannot flush run 1's in-memory queue
        break;
      }
      case "E12": {
        // E12 (getContextUsage undefined — pre-first-inference audit): call mulligan_audit as the FIRST action
        // (before any assistant message) on a fresh session. The audit's E16 fallback path must succeed with
        // NO crash. The orchestrator asserts pi exit 0 + the audit ran.
        try {
          const res = await auditTool.execute("smoke-e12-1", { top: 8 }, undefined, undefined, ctx);
          const text = resultText(res.content as unknown as { type: string; text?: string }[]);
          smokeLog("E12.audit", "info", { text: text.slice(0, 120), source: res.details.source });
        } catch (e) {
          smokeLog("E12.audit", "fail", { error: String(e) });
        }
        break;
      }
      case "E15": {
        // E15 (50 markers): seed N=50 rewind markers via the RAW appendRewindMarker wrapper (NOT the tool —
        // the tool's depth guard refuses the 6th; GOTCHA #9). Then the orchestrator's second `-p` triggers
        // an observing inference; assert the filter TERMINATES (context.fire present) + no crash. v1 does no
        // GC — markers persist intentionally (audit trail).
        try {
          let appended = 0;
          for (let i = 0; i < 50; i++) {
            // Build a widened payload (checkpoint is NOT in the frozen RewindMarkerInput TYPE, but the wrapper
            // spread preserves it at runtime — mirrors src/tools/rewind.ts GOTCHA #1; cast at the call site).
            const payload = {
              granularity: "last_tool_call_group",
              options: {},
              excludeToolCallId: `smoke-e15-${i}`,
              note: SMOKE_NOTE,
              ledger: { readFiles: [], modifiedFiles: [], bashSideEffects: [] },
            };
            const id = appendRewindMarker(pi, ctx, payload as RewindMarkerInput);
            if (id !== null) appended++;
          }
          smokeLog("E15.seed", "info", {
            appended,
            note: "markers persist intentionally (audit trail); v1 does no GC.",
          });
        } catch (e) {
          smokeLog("E15.seed", "fail", { error: String(e) });
        }
        break;
      }
      case "E20": {
        // E20 (appendEntry/sendMessage ordering): call mulligan_rewind (the REAL tool) then the orchestrator
        // reads the session JSONL + asserts the mulligan:rewind (type:custom) entry appears BEFORE the
        // mulligan:note (type:custom_message) entry in FILE ORDER. The synchronous append-then-send in the
        // rewind tool guarantees marker-before-note.
        await rewindNow(pi, ctx, "smoke-e20-1", "last_turn");
        await flushQueued(pi, ctx); // [v2.1] activate — flushRewrites appends marker-then-note, preserving order
        break;
      }
      case "F-ckptcmd": {
        // Slash-command-driven scenario (BUG-003 / spec @10-testing.md §2.1): the orchestrator's -p prompts
        // ARE the commands (/mulligan_checkpoint x, then /mulligan_checkpoint_revoke x) — they execute via
        // src/index.ts's registration and are NOT routed through /mulligan_smoke. This case exists so the
        // switch stays exhaustive; the assertions read the session JSONL label entries directly.
        break;
      }
      case "F-banner": {
        // Slash-command-driven two-run scenario (BUG-003 / spec @10-testing.md §2.1): the orchestrator drives
        // real /mulligan_checkpoint(+_revoke) prompts and reads the banner observable on context.fire lines.
        // Headless -p ⇒ ctx.hasUI === false ⇒ reconcileBanner no-ops (src/banner.ts branch (a)) and setWidget
        // is unobservable — banner state is RECOMPUTED at the fire point via listCheckpoints (P1.M2.T1.S1
        // observable, already logged by the context handler). Nothing to do here.
        break;
      }
      case "F-useraudit": {
        // F-useraudit (BUG-003 / spec @10-testing.md §2.1): report PARITY + sink SEPARATION, both consumers
        // driven back-to-back on the SAME session state inside this command dispatch (no writes between them
        // → identical inputs → identical renderAuditReport output).
        // (a) REAL agent tool: execute with the REAL ctx (its sessionManager backs both consumers). The
        // result text is the report the MODEL receives. smokeLog the FULL text (parity comparison needs it).
        try {
          const res = await auditTool.execute("smoke-useraudit-tool-1", { top: 8 }, undefined, undefined, ctx);
          const toolText = resultText(res.content as unknown as { type: string; text?: string }[]);
          smokeLog("useraudit.tool", "info", { text: toolText });
        } catch (e) {
          smokeLog("useraudit.tool", "fail", { error: String(e) });
        }
        // (b) REAL human command handler via a WRAPPER ctx: headless pi -p has ctx.hasUI === false, and
        // makeAuditCommand early-returns then. Wrap: hasUI:true + a capturing ui.notify; sessionManager is
        // the REAL ctx's (same session → same filtered view/markers → same renderAuditReport output).
        // Each consumer is independently try/caught — a fail in one must not skip the other's evidence.
        try {
          const captured: { msg: string; type: string }[] = [];
          const wrapperCtx = {
            ...ctx,
            hasUI: true,
            ui: { notify: (msg: string, type: string) => captured.push({ msg, type }) },
          } as unknown as typeof ctx;
          await makeAuditCommand(pi).handler("", wrapperCtx);
          smokeLog("useraudit.command", "info", {
            notifyCount: captured.length,
            types: captured.map((c) => c.type),
            text: captured.map((c) => c.msg).join("\n---\n"),
          });
        } catch (e) {
          smokeLog("useraudit.command", "fail", { error: String(e) });
        }
        break;
      }
      default: {
        smokeLog("scenario.unknown", "fail", { scenario, reason: "unknown scenario name" });
      }
    }
    smokeLog("scenario.done", "info", { scenario });
  } catch (e) {
    smokeLog("scenario.crash", "fail", { scenario, error: String(e) });
  }
}

// ── The factory (Pi helper extension — observer + /mulligan_smoke driver) ─────────────────────

/**
 * Default-export factory. Loaded as the SECOND `-e`. Sync (no async work at load time). Never throws at the
 * top level (the spike's discipline): each handler is independently try/catch-guarded.
 */
export default function (pi: ExtensionAPI): void {
  // (0) Truncate the smoke log ONCE at factory time (try/catch — never crash on a bad path).
  try {
    writeFileSync(SMOKE_LOG, "# mulligan smoke " + new Date().toISOString() + "\n");
  } catch {
    /* never crash */
  }

  // NOTE: Mulligan's OWN corroborating log (GOTCHA #7) CANNOT be enabled from here — Pi's jiti loader gives
  // each extension a separate module cache, so setLogFile() here would mutate a DIFFERENT log.ts instance
  // than the one Mulligan uses. The smoke helper's OWN log (SMOKE_LOG) is the sole assertion source.

  // (2) session_start → log the sessionFile (so the orchestrator can find the JSONL for §2.3 assertions) +
  //     inject the msg-canary CustomMessage (the target for last_turn rewind / content-include shrink).
  pi.on("session_start", (_event, ctx) => {
    try {
      smokeLog("session.start", "info", {
        sessionId: ctx.sessionManager.getSessionId(),
        sessionFile: ctx.sessionManager.getSessionFile(),
        leafId: ctx.sessionManager.getLeafId(),
      });
    } catch (e) {
      smokeLog("session.start", "fail", { error: String(e) });
    }
    // inject the message canary (in LLM context; a rewind target for observing-context scenarios)
    try {
      pi.sendMessage({ customType: "mulligan_smoke_canary", content: MSG_CANARY, display: false });
      smokeLog("setup.canary", "info", { ok: true });
    } catch (e) {
      smokeLog("setup.canary", "fail", { error: String(e) });
    }
  });

  // (3) context handler — THE OBSERVER (MUST return void; GOTCHA #1). Logs the spec/10 §2.2 observable set
  //     on every fire. Because smoke loads SECOND, event.messages is the POST-filter set (Mulligan already
  //     ran). Returning void = pass-through (do NOT override Mulligan's filtered set).
  pi.on("context", (event, ctx) => {
    try {
      const msgs = event.messages as unknown as Array<Record<string, unknown>>;
      const has = (s: string) => msgs.some((m) => JSON.stringify(m).includes(s));
      let entries: unknown[] = [];
      try {
        entries = ctx.sessionManager.getEntries() as unknown[];
      } catch {
        entries = [];
      }
      const hasRewindMarker = entries.some(
        (e) =>
          typeof e === "object" &&
          e !== null &&
          (e as Record<string, unknown>).type === "custom" &&
          (e as Record<string, unknown>).customType === "mulligan:rewind",
      );
      // ── SEED-canary hiding detection (P1.M3.T2.S1). Role-gated: the user PROMPT also contains the canary text, so
      //    gate on role:"assistant" to detect the seed REPLY specifically (GOTCHA #5). smoke loads SECOND → these read
      //    the POST-filter view, so seed-absence = seed-hidden-by-the-filter.
      const seedAnchorInAssistant = msgs.some(
        (m) => m?.role === "assistant" && JSON.stringify(m).includes(SEED_ANCHOR),
      );
      const seedHiddenInAssistant = msgs.some(
        (m) => m?.role === "assistant" && JSON.stringify(m).includes(SEED_HIDDEN),
      );
      // ── Banner + user-visibility observables (P1.M2.T1.S1). Headless `pi -p` has ctx.hasUI === false, so
      //    reconcileBanner no-ops (src/banner.ts branch (a)) and setWidget can never be observed — banner state
      //    is RECOMPUTED here via listCheckpoints, the same pure latest-wins label scanner reconcileBanner
      //    itself imports. This mirrors what the banner WOULD render; the post-filter msgs give user visibility.
      const checkpointNames = listCheckpoints(entries);
      const userMsgCount = msgs.filter((m) => m?.role === "user").length;
      const firstUserPresent = msgs.some((m) => m?.role === "user"); // first user prompt still visible in filtered view
      // ── F-consent canaries (P1.M2.T3.S1). Role-AGNOSTIC content scans — the canaries are unique and only
      //    appear in USER prompts, so a raw content scan cannot false-positive off another message.
      const consentU1Present = msgs.some((m) => JSON.stringify(m).includes(CONSENT_U1));
      const consentU2Present = msgs.some((m) => JSON.stringify(m).includes(CONSENT_U2));
      const consentGuardPresent = msgs.some((m) => JSON.stringify(m).includes(CONSENT_GUARD));
      // ── High-water observables (§5.2 edge latch + filtered-total/window fraction; P1.M2.T1.S2). PURE READ:
      //    we never call shouldHighWater (it mutates rt.aboveHighWater). Both extensions share ONE pi process
      //    and module instance, so getRuntime(...) returns the SAME SessionRuntime src's nudges handler just
      //    updated (observer loads second → post-update state). fraction is the FILTERED total over the window
      //    (event.messages is the post-filter set); null when the window is unknown (E12 — pre-first-inference
      //    getContextUsage may be undefined / contextWindow 0 — never divide by zero).
      let hwLatch = false;
      let hwFraction: number | null = null;
      try {
        hwLatch = getRuntime(ctx.sessionManager.getSessionId()).aboveHighWater === true;
        const windowTokens = ctx.getContextUsage()?.contextWindow ?? 0;
        if (typeof windowTokens === "number" && windowTokens > 0) {
          hwFraction = estimateTokens(msgs as never).tokens / windowTokens;
        }
      } catch {
        // E13-style tolerance: an observable computation must never break the observer.
      }
      smokeLog("context.fire", "info", {
        count: msgs.length,
        msgCanaryPresent: has(MSG_CANARY),
        resultCanaryPresent: has(RESULT_CANARY),
        notePresent: msgs.some((m) => m?.customType === "mulligan:note"),
        hasRewindMarker,
        shrunkInContext: has(SHRUNK_MARKER),
        hasNudge: msgs.some((m) => m?.customType === "mulligan:nudge"),
        seedAnchorInAssistant,
        seedHiddenInAssistant,
        banner: { activeCount: checkpointNames.length, names: checkpointNames }, // P1.M2.T1.S1 (headless recompute)
        userMsgCount, // P1.M2.T1.S1
        firstUserPresent, // P1.M2.T1.S1
        consent: { u1: consentU1Present, u2: consentU2Present, guard: consentGuardPresent }, // P1.M2.T3.S1
        pasteCanaryPresent: has(PASTE_CANARY), // P1.M2.T5.S1 — the paste is really in the filtered context
        highWater: { latch: hwLatch, fraction: hwFraction }, // P1.M2.T1.S2 (§5.2 edge latch + filtered/window fraction)
      });
      // ── Scenario-scoped HARD hiding assertions (emitted on the post-rewind fire only). These are READ BACK by
      //    run-smoke.mjs assertRewindCore/assertCheckpoint and converted to assert() — logging alone does not fail a
      //    scenario (GOTCHA #7). Two-signal guard: the tool.rewind K-text (read by the asserter) proves the seed
      //    existed+was pinned; seed-absence here proves it is hidden. If pinning regressed (BUG-001/002) the seed
      //    reply LEAKS BACK → seedHiddenInAssistant===true → FAIL.
      if (currentScenario === "F-rewind-core" && hasRewindMarker) {
        smokeLog("F-rewind-core.hiding", seedHiddenInAssistant ? "fail" : "pass", {
          seedHiddenInAssistant,
          note: seedHiddenInAssistant ? "LEAKED BACK (BUG-001/002 regression: pinned hide lost)" : "seed reply hidden on observing inference",
        });
      }
      if (currentScenario === "F-checkpoint" && hasRewindMarker) {
        // The checkpoint must HIDE the post-checkpoint SEED_HIDDEN turn AND KEEP its SEED_ANCHOR (not over-hide).
        const cpPass = !seedHiddenInAssistant && seedAnchorInAssistant;
        smokeLog("F-checkpoint.hiding", cpPass ? "pass" : "fail", {
          seedHiddenInAssistant,
          seedAnchorInAssistant,
          note: cpPass
            ? "post-checkpoint seed hidden; anchor survives"
            : seedHiddenInAssistant
              ? "post-checkpoint seed LEAKED BACK (BUG-003/001 regression)"
              : "checkpoint anchor MISSING (over-hid / checkpoint not set)",
        });
      }
    } catch (e) {
      smokeLog("context.fire", "fail", { error: String(e) });
    }
    // return void → pass-through; do NOT override Mulligan's filter (GOTCHA #1).
  });

  // (4) registerTool mulligan_smoke_big — returns a large canary result. NOTE: bloatReminderHandler SKIPS
  //     mulligan_* tools (src/nudges.ts GOTCHA #3), so this tool NEVER triggers the bloat reminder regardless
  //     of size; its role is as a shrink target (RESULT_CANARY observable). New defaults: global 16384,
  //     per-tool read 24576 (bash uses the global).
  pi.registerTool({
    name: "mulligan_smoke_big",
    label: "Big Result",
    description: "SMOKE TEST TOOL. Returns a large canary result (bloat reminder is skipped for mulligan_* tools). Call when asked.",
    parameters: Type.Object({}),
    async execute() {
      const big = bigResult();
      return { content: [{ type: "text" as const, text: big }], details: { len: big.length } };
    },
  });

  // (5) registerCommand /mulligan_smoke <scenario> — THE DETERMINISTIC DRIVER (spec/10 §2.2). Dispatches
  //     on the scenario name; each recipe uses the REAL tools + followUp (GOTCHA #2). The command handler's
  //     ctx is ExtensionCommandContext (has sessionManager) — passed to the REAL tool's execute().
  pi.registerCommand("mulligan_smoke", {
    description: "drive a mulligan smoke scenario deterministically",
    handler: async (args, ctx) => {
      const scenario = (args ?? "").trim();
      await driveScenario(pi, ctx, scenario);
    },
  });
}