---
name: "P2.M2.T1.S1 — commands.ts: makeAuditCommand(pi) — the human-facing /mulligan_audit factory"
---

## Goal

**Feature Goal**: Add `makeAuditCommand(pi)` to `src/commands.ts` — a third human-facing slash-command factory
(alongside `makeCheckpointCommand` / `makeCheckpointRevokeCommand`) that produces the **byte-identical**
context-bloat diagnostic report the agent's `mulligan_audit` tool produces, and surfaces it to the **human** via
`ctx.ui.notify` only. The report NEVER enters `event.messages` (a human command must not bloat the model's
context — spec/13 §4 step 2). Same renderer as the tool; the sink is determined by who invoked it
(human → human via `ctx.ui`, agent → agent via the tool result).

**Deliverable**: `makeAuditCommand` exported from `src/commands.ts` (the ONLY file touched). Returns the
`{ description, handler }` shape structurally assignable to `Parameters<ExtensionAPI["registerCommand"]>[1]`.
`pi` is captured by the closure (registration-uniformity with the sibling factories) but is **unused** — the
audit, like its tool, needs no `pi` (every read goes through `ctx` / pure helpers). Registration is **S2**
(P2.M2.T1.S2); tests are **S3** (P2.M2.T1.S3). This item is **source-only**.

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`, strict) exits 0 — the casts mirror `src/tools/audit.ts` verbatim.
- `npm test` (full `vitest run`) stays GREEN — the new factory is additive dead code (unregistered until S2),
  so no existing test can regress from S1's diff.
- The handler: (1) refuses `"Mulligan is disabled"` when `getConfig().enabled === false`; (2) skips work when
  `!ctx.hasUI` (print/JSON mode); (3) resolves the filtered view exactly as `auditExecute` does (cached
  `rt.lastFiltered`, else the E16 `filterPipeline` fallback) — NEVER `ctx.getContextUsage()` (D5); (4) renders
  the identical report via the exported `renderAuditReport`; (5) surfaces it via `ctx.ui.notify(report, "info")`;
  (6) NEVER throws (whole body in try/catch → unexpected-error notify); (7) NEVER calls `pi.sendMessage` /
  `pi.appendEntry`.

## User Persona (if applicable)

**Target User**: The human operator of a Pi coding-agent session (developer/power user) who wants to see what
the model is carrying — on demand, without asking the agent to run `mulligan_audit`.

**Use Case**: The human suspects context bloat (a big `read`, a verbose tool result) and types
`/mulligan_audit` to get the same per-message token breakdown + bloat flags + active-marker (incl. active
checkpoints) view the agent would see — then decides whether to ask the agent to rewind/shrink, or revoke a
checkpoint.

**User Journey**: Human types `/mulligan_audit` → Pi dispatches the registered command handler → handler
resolves the filtered view, renders the report, calls `ctx.ui.notify(report, "info")` → the report appears in
the human's UI. The model's context is untouched.

**Pain Points Addressed**: Today the human's only path to the audit is asking the agent (which consumes a turn
+ injects the tool result into the model's context). This command gives a direct, context-free diagnostic.

## Why

- **Business value**: Completes the v1.1 human-facing surface (P2). The agent RETAINS its `mulligan_audit` tool
  (P1.M5.T4.S1, Complete); this command is the human's parallel direct path (spec/13 §4). It reuses the EXISTING
  report renderer (`renderAuditReport`) — zero new reporting logic.
- **Integration with existing features**: Sits in `src/commands.ts` beside the two checkpoint factories (P2.M1,
  landed). Reuses exported pure helpers from `src/tools/audit.ts` (`renderAuditReport`, `listCheckpoints`,
  `describeMessage`, `messageBytes`, `buildCallLookup`, `AuditRow`) + the standard deps (`getRuntime`,
  `getConfig`, `filterPipeline`, `readMarkers`, `estimateTokens`, `bloatThresholdFor`). Consumed by S2
  (registration) + S3 (tests).
- **Problems this solves / for whom**: Lets the human self-diagnose context bloat without spending an agent
  turn or polluting the model's context (spec/13 §4 step 2: "A human command must not bloat the model's context").

## What

One new exported factory function in `src/commands.ts`. No user-visible MODEL behavior change (the command is
write-only w.r.t. the model's context — it never injects into `event.messages`; spec/13 §0/§4). The command
ignores its `args` (reserved for a future `top` override: `/mulligan_audit 20` — spec/13 §4 last line).

### Success Criteria

- [ ] `makeAuditCommand` is exported from `src/commands.ts` and returns
      `{ description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }`.
- [ ] `description` === the contract-literal
      `"Run the Mulligan context-bloat diagnostic — see what the model is carrying"` (note the em-dash —).
- [ ] Disabled gate fires FIRST: `getConfig().enabled === false` → `notify(ctx, "Mulligan is disabled", "warning")`
      (NO "Mulligan: " prefix — same as the sibling commands) and returns BEFORE any session access.
- [ ] `!ctx.hasUI` → early return (skip the expensive pipeline in print/JSON mode).
- [ ] Filtered-view resolution mirrors `auditExecute` EXACTLY: `rt.lastFiltered` (cached, confidence =
      `config.audit.estimateConfidence`) else the E16 fallback (`buildContextEntries() → auditEntriesToMessages
      → filterPipeline`, confidence `"low"`). NEVER `ctx.getContextUsage()` (D5).
- [ ] `totalTokens = estimateTokens(filtered)` from the SAME filtered view used for the rows (NOT
      `computeFilteredTotal` — see Decision 1 / GOTCHA #1).
- [ ] Rows built from the filtered view (top 8; `args` ignored): `buildCallLookup` + rank by
      `estimateTokens([m])` desc + `describeMessage`/`messageBytes`/`bloatThresholdFor` per row.
- [ ] `markers = readMarkers(ctx)`; `checkpointNames = listCheckpoints(ctx.sessionManager.getEntries())`;
      `cancelledCount = markers.cancelledIds.size`.
- [ ] `report = renderAuditReport({ totalTokens, confidence, rewinds, shrinks, checkpointNames, protectedRoles,
      rows, filtered, cancelledCount })` — the SAME call the tool makes.
- [ ] `notify(ctx, report, "info")` surfaces it to the human. NO `pi.sendMessage` / `pi.appendEntry`.
- [ ] Whole handler body wrapped in try/catch → `notify(ctx, "Mulligan: unexpected error: " + msg, "warning")`.
- [ ] `npm run typecheck` exit 0; `npm test` GREEN; `git status --short` shows ONLY ` M src/commands.ts`.

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this codebase can implement S1 from: (1) the EXACT handler code in
"Implementation Patterns" (copy-adapt into the existing factory idiom), (2) the 6 decisions in
`research/RESEARCH_NOTES.md` (esp. Decision 1 = do NOT use `computeFilteredTotal`; Decision 2 = sink is
`ctx.ui.notify`), (3) the verbatim casts copied from `src/tools/audit.ts` (typecheck parity), and (4) the
existing `src/commands.ts` (the factory idiom + the module-local `notify` helper + the existing imports to
reuse/extend). Every gate string and cast is given literally.

### Documentation & References

```yaml
# MUST READ — the module under edit. Copy the factory idiom (closure-captured pi; { description, handler };
# try/catch → unexpected-error notify), reuse the module-local notify(ctx,msg,type) helper, and EXTEND its
# import block (it already imports getConfig, reconcileBanner, the type imports). The disabled-gate message is
# the contract-literal "Mulligan is disabled" (NO prefix) — copy byte-for-byte from makeCheckpointCommand.
- file: src/commands.ts
  why: "The file S1 edits. The two existing factories are the structural template. notify() is module-local
        and hasUI-guarded — reuse it for EVERY notify in the audit handler. JSDoc convention (cites spec §,
        Mode A) is the doc standard."
  pattern: "export function makeXCommand(pi: ExtensionAPI): { description: string; handler: (args: string,
            ctx: ExtensionCommandContext) => Promise<void> } { return { description: '...', handler: async
            (args, ctx) => { try { ...if (!getConfig().enabled) { notify(ctx,'Mulligan is disabled','warning'); return; }... } catch (e) { notify(ctx, `Mulligan: unexpected error: ${...}`, 'warning'); } } }; }"
  gotcha: "notify() already gates on ctx.hasUI — but add an EXPLICIT `if (!ctx.hasUI) return;` after the
           disabled gate to SKIP the expensive pipeline in print/JSON mode (the audit does real work; the
           checkpoint commands do not)."

# MUST READ — the pipeline to mirror. auditExecute (module-private) is the reference implementation; copy its
# steps 1–4 (resolve filtered view, estimateTokens total, rank rows, read markers+checkpoints, renderAuditReport)
# VERBATIM into the command handler. The EXPORTED helpers (renderAuditReport, listCheckpoints, describeMessage,
# messageBytes, buildCallLookup, AuditRow) are the reusable surface. The MODULE-PRIVATE pieces (auditExecute,
# entriesToMessages, readStr/readOwn/isRecord) MUST be replicated (see Implementation Patterns).
- file: src/tools/audit.ts
  why: "The single source of truth for the report. Spec §130 step 1 'Reuse the existing auditExecute pipeline'
        + step 2 'Same renderer' demand a BYTE-IDENTICAL report — the only safe way to guarantee that is to copy
        auditExecute's resolution + ranking verbatim (same casts, same calls)."
  pattern: "Lines ~360-470 (auditExecute body): the cached-vs-E16-fallback branch, the estimateTokens total, the
            buildCallLookup + ranked + rows mapping, the readMarkers + listCheckpoints, the renderAuditReport call."
  critical: "GOTCHA #1 — do NOT use computeFilteredTotal for the REPORTED total. Its E16 fallback omits
             filterPipeline (its own JSDoc: 'Audit keeps its own more-accurate fallback'); using it would make
             the human report diverge from the agent tool's report on the E16 path (violating 'Same renderer').
             Compute totalTokens = estimateTokens(filtered) from the SAME view used for rows."

# MUST READ — the ExtensionUIContext + ExtensionCommandContext surfaces (settles the sink question).
- docfile: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: "L68-104 ExtensionUIContext: notify(L76), setWidget(L97/98), setStatus(L80), select/confirm/input — the
        full ctx.ui menu. L254 ExtensionCommandContext extends ExtensionContext: session-control methods only
        (newSession/fork/navigateTree/switchSession/reload/waitForIdle/getSystemPromptOptions)."
  section: "L68-104 (ExtensionUIContext), L254-296 (ExtensionCommandContext)"
  critical: "There is NO print/transcript-append method on ExtensionCommandContext. pi.appendEntry/sendMessage
             are FORBIDDEN by the contract. So the report sink is ctx.ui. Among ctx.ui methods: notify = one-shot
             (matches the existing command pattern); setWidget = persistent (wrong lifecycle for a one-shot
             diagnostic + collides with the banner's widget key namespace, P2.M3). → ctx.ui.notify(report,'info')."

# MUST READ — the authoritative human-facing spec for THIS command (also in selected_prd_content h2.130).
- docfile: spec/13-human-facing-surface.md
  why: "§4 = /mulligan_audit. step 1 'Reuse the existing auditExecute pipeline' (resolve filtered, rank, flag,
        list active markers AND active checkpoints, render). step 2 'Output follows the caller' (human →
        transcript/ctx.ui, NEVER event.messages; agent → agent). step 3 banner-aware: the report's Active
        markers line includes 'N checkpoints [names]' (already produced by renderAuditReport). Last line:
        '/mulligan_audit ignores its args (reserved for a future top override)'."
  section: "§4 (all steps)"

# REFERENCE — the readMarkers return shape + filterPipeline signature (called directly by the handler).
- file: src/filter.ts
  why: "readMarkers(ctx) (L136) returns { rewinds: RewindMarker[], shrinks: ShrinkMarker[], metric,
        cancelledIds: Set<string>, recentMetrics }. The handler uses markers.rewinds, markers.shrinks,
        markers.cancelledIds.size."
  pattern: "readMarkers(ctx) — defensive (never throws; returns empty bundle on a throwing getEntries)."
- file: src/transforms.ts
  why: "filterPipeline (L1370) signature: (messages, markers, config, branchEntries?). The 4th arg is
        branchEntries (getBranch()), NOT ctx — pass `branch as unknown as Parameters<typeof filterPipeline>[3]`
        exactly as audit.ts does."
  gotcha: "param 2 type is MarkerBundle (singular) but readMarkers returns MarkersBundle (plural) — they are
           structurally compatible (audit.ts passes readMarkers(ctx) directly and typechecks). Copy the call
           verbatim from audit.ts; do NOT introduce an intermediate cast."

# REFERENCE — the runtime cache (rt.lastFiltered) + config shape.
- file: src/runtime.ts
  why: "L73 lastFiltered: AgentMessage[] | null — null until the first context fire (→ E16 fallback).
        getRuntime(sessionId) returns the per-session SessionRuntime."
- file: src/config.ts
  why: "getConfig() returns MulliganConfig: .enabled (default true), .audit.estimateConfidence (default
        'medium'), .rewind.protectedRoles (default ['first:user','latest:user']). All three are read by the handler."

# REFERENCE — the Pi canonical entry→message conversion (used by the replicated auditEntriesToMessages).
- file: src/tools/audit.ts  # the entriesToMessages reference impl (module-private — replicate, don't import)
  why: "audit.ts's entriesToMessages delegates to sessionEntryToContextMessages (imported from
        @earendil-works/pi-coding-agent) so the audit never invents a divergent conversion. The command replicates
        this ~10-line helper locally (named auditEntriesToMessages) because the original is module-private."
  pattern: "for each entry: msgs = sessionEntryToContextMessages(entry); push record-shaped msgs into out[]. try/catch
            per entry (best-effort, spec/06 §7)."
```

### Current Codebase tree (relevant slice)

```bash
src/commands.ts          # EDIT — add makeAuditCommand (3rd factory). Has makeCheckpointCommand,
                         #   makeCheckpointRevokeCommand, clearCheckpointByName (P2.M1.T1.S1, landed) +
                         #   module-local notify(ctx,msg,type) + imports (getConfig, reconcileBanner, types).
src/tools/audit.ts       # READ-ONLY — EXPORTS renderAuditReport, computeFilteredTotal, listCheckpoints,
                         #   describeMessage, messageBytes, buildCallLookup, AuditRow. PRIVATE: auditExecute,
                         #   entriesToMessages, readStr/readOwn/isRecord.
src/runtime.ts           # getRuntime(id).lastFiltered  (cached filtered view)
src/config.ts            # getConfig() — .enabled / .audit.estimateConfidence / .rewind.protectedRoles
src/filter.ts            # readMarkers(ctx) — { rewinds, shrinks, cancelledIds:Set, ... }
src/transforms.ts        # filterPipeline(messages, markers, config, branchEntries?)
src/tokens.ts            # estimateTokens(messages) → { tokens }
src/nudges.ts            # bloatThresholdFor(toolName|undefined, config) → bytes
src/markers.ts           # type-only: RewindMarker, ShrinkMarker
src/banner.ts            # NOT used by the audit command (audit is one-shot; banner is persistent state)
test/index.test.ts:90    # asserts 2 registered commands — S2's territory (do NOT touch in S1)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/commands.ts          # MODIFIED — +1 export: makeAuditCommand(pi). +1 module-local helper:
                         #   auditEntriesToMessages(entries) (E16 fallback entry→msg conversion, ~10 lines).
                         #   Extended imports: estimateTokens, getRuntime, filterPipeline, readMarkers,
                         #   bloatThresholdFor from their modules; renderAuditReport, listCheckpoints,
                         #   describeMessage, messageBytes, buildCallLookup, AuditRow from ./tools/audit.js;
                         #   sessionEntryToContextMessages + type SessionEntry from the package;
                         #   type RewindMarker, ShrinkMarker from ./markers.js (type-only).
# (no new files — S1 is a single-file source addition)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (do NOT use computeFilteredTotal for the REPORTED total):
//   computeFilteredTotal (audit.ts) is EXPORTED "so audit + rewind share one computation" — but its E16
//   fallback DELIBERATELY omits filterPipeline (its JSDoc: "CHEAPER than audit's fallback (no filterPipeline
//   re-run) — the rewind guard ... only needs an estimate. (Audit keeps its own more-accurate fallback.)").
//   The contract step (c) says "call computeFilteredTotal(ctx)" — this is a RESEARCH IMPRECISION. If the command
//   used it for the total but built rows from a filterPipeline-filtered view, the reported total would EXCEED
//   the ranked rows' sum on the E16 path → self-inconsistent + diverges from the agent tool's report.
//   Spec §130 step 1 ("Reuse the existing auditExecute pipeline") + step 2 ("Same renderer") demand a
//   BYTE-IDENTICAL report. FIX: mirror auditExecute — totalTokens = estimateTokens(filtered) from the SAME
//   filtered view used for the rows. (windowTokens is unused by the audit; computeFilteredTotal is not called.)

// CRITICAL GOTCHA #2 (the casts MUST match audit.ts verbatim or typecheck fails under strict):
//   audit.ts uses `as unknown as TokenMessages` (where `type TokenMessages = Parameters<typeof estimateTokens>[0]`)
//   at each estimateTokens call, and `branch as unknown as Parameters<typeof filterPipeline>[3]` for the 4th
//   filterPipeline arg. Copy these EXACTLY. Do NOT "simplify" them — MessageLike/AgentMessage/BranchEntry are
//   nominal-ish Pi types that are NOT directly assignable to Record<string,unknown>[]; the double-cast is load-
//   bearing. (`filtered = rt.lastFiltered` and `filtered = filterPipeline(...)` assign WITHOUT a result cast in
//   audit.ts — copy that too; the result IS assignable to Record<string,unknown>[].)

// GOTCHA #3 (readStr/readOwn/isRecord are MODULE-PRIVATE in audit.ts — do not import them):
//   The row builder needs msg.toolName + msg.role. audit.ts reads them via its private readStr(msg,"toolName").
//   The command has no readStr. Use clean inline guards: `typeof msg.toolName === "string" ? msg.toolName :
//   undefined` and `typeof msg.role === "string" ? msg.role : "?"`. NO `as any` (noImplicitAny + clean).
//   describeMessage/messageBytes/buildCallLookup ARE exported — reuse them (do NOT re-derive labels).

// GOTCHA #4 (entriesToMessages is MODULE-PRIVATE — replicate it locally):
//   audit.ts's entriesToMessages (the E16 fallback's entry→message conversion) is NOT exported. The command
//   needs it. Replicate it as a module-local `auditEntriesToMessages(entries: SessionEntry[])` that delegates to
//   Pi's canonical `sessionEntryToContextMessages` (imported from the package) — the SAME conversion audit.ts
//   uses, so the command never invents a divergent one. ~10 lines, try/catch per entry (best-effort, spec/06 §7).

// GOTCHA #5 (NO print/transcript sink exists; notify is correct, setWidget is WRONG):
//   ExtensionCommandContext has NO print/append method (only session-control). ctx.ui has notify + setWidget +
//   setStatus + select/confirm/input. The audit is a ONE-SHOT diagnostic → notify (one-shot). setWidget is
//   PERSISTENT (the banner's mechanism, P2.M3) — wrong lifecycle + collides with the banner's widget key
//   namespace. Use notify(ctx, report, "info"). notify() is already hasUI-guarded; add an explicit
//   `if (!ctx.hasUI) return;` after the disabled gate to SKIP the expensive pipeline in print/JSON mode.

// GOTCHA #6 (pi is captured-but-unused — that is CORRECT, not a bug):
//   The audit needs no pi (every read goes through ctx/pure helpers — CRITICAL INSIGHT #1 from audit.ts). The
//   factory keeps makeAuditCommand(pi: ExtensionAPI) for registration uniformity with the siblings (index.ts:
//   pi.registerCommand("mulligan_audit", makeAuditCommand(pi))). tsconfig has NO noUnusedParameters → it
//   compiles. Document the unused capture in the JSDoc (do NOT prefix with _ — match the contract + siblings).

// GOTCHA #7 (disabled gate FIRST; the message has NO "Mulligan: " prefix):
//   Mirror auditExecute step 0 + makeCheckpointCommand: check getConfig().enabled BEFORE any session access.
//   The message is the contract-literal "Mulligan is disabled" (warning) — NO "Mulligan: " prefix (every OTHER
//   command notify IS prefixed; the disabled one is the sole exception). Copy byte-for-byte.

// GOTCHA #8 (.js import paths — ESM/Bundler resolution): import from "./tools/audit.js", "./runtime.js",
//   "./config.js", "./filter.js", "./transforms.js", "./tokens.js", "./nudges.js", "./markers.js" (NOT .ts).
//   The @earendil-works/pi-coding-agent imports (sessionEntryToContextMessages value + ExtensionAPI/
//   ExtensionCommandContext/SessionEntry types) import WITHOUT extension.

// GOTCHA #9 (args is IGNORED — reserved for a future `top` override): spec/13 §4 last line: "/mulligan_audit
//   ignores its args (reserved for a future top override: /mulligan_audit 20)". Hardcode `const top = 8;` in
//   the row builder (matches audit.ts default). Do NOT parse args. Name the handler param `args` with a comment
//   (signature matches the declared type `(args: string, ctx)` for registration parity).

// GOTCHA #10 (the report MUST NOT enter event.messages): NEVER call pi.sendMessage / pi.appendEntry with the
//   report (contract: "OUTPUT DOES NOT ENTER event.messages"). ctx.ui.notify is a human-only sink — it does not
//   touch the session tree. This is the spec/13 §4 step 2 invariant ("a human command must not bloat the
//   model's context").

// GOTCHA #11 (filterPipeline param-2 naming: MarkerBundle vs MarkersBundle): transforms.ts types param 2 as
//   `MarkerBundle | undefined`; readMarkers returns `MarkersBundle`. They are structurally compatible (audit.ts
//   passes readMarkers(ctx) directly and typechecks). Copy `filterPipeline(base, readMarkers(ctx), config,
//   branch as unknown as Parameters<typeof filterPipeline>[3])` VERBATIM — do not add an intermediate cast.
```

## Implementation Blueprint

### Data models and structure

No new data models. S1 reuses existing exported types:
- `AuditRow` (from `./tools/audit.js`) — the per-message ranked row (`{ tokens, role, label, bloaty, thresholdBytes }`).
- `RewindMarker`, `ShrinkMarker` (type-only, from `./markers.js`) — passed to `renderAuditReport`.
- `SessionEntry` (type-only, from the package) — the param of the replicated `auditEntriesToMessages`.

The factory's return type is the SAME `{ description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }` as the sibling factories (structurally assignable to `Omit<RegisteredCommand, "name" | "sourceInfo">`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EXTEND the import block in src/commands.ts (top of file)
  - ADD value imports:
      import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
      import { estimateTokens } from "./tokens.js";
      import { getRuntime } from "./runtime.js";
      import { filterPipeline } from "./transforms.js";
      import { readMarkers } from "./filter.js";
      import { bloatThresholdFor } from "./nudges.js";
      import { renderAuditReport, listCheckpoints, describeMessage, messageBytes, buildCallLookup } from "./tools/audit.js";
  - ADD type imports:
      import type { SessionEntry } from "@earendil-works/pi-coding-agent";   // (ExtensionAPI/CommandContext/Context already imported)
      import type { AuditRow } from "./tools/audit.js";
      import type { RewindMarker, ShrinkMarker } from "./markers.js";
  - NOTE: getConfig is ALREADY imported (the checkpoint commands use it). reconcileBanner is imported but NOT
    used by the audit command (do NOT call it — the audit mutates no checkpoint/banner state).
  - GOTCHA #8: .js extensions on local imports; the package import is extension-less.

Task 2: ADD module-local auditEntriesToMessages (place it just ABOVE makeAuditCommand, after the existing
        module-local notify() helper)
  - IMPLEMENT: a local replica of audit.ts's module-private entriesToMessages (GOTCHA #4).
  - BODY: for each entry, try { const msgs = sessionEntryToContextMessages(entry); if Array.isArray(msgs) push
          record-shaped msgs } catch { /* best-effort, contributes [] */ }. Return Record<string,unknown>[].
  - NAMING: auditEntriesToMessages (NOT entriesToMessages — avoids a future clash if audit.ts ever exports its own).
  - JSDoc: cite spec/06 §7 + "local replica of audit.ts's module-private entriesToMessages; delegates to Pi's
            canonical sessionEntryToContextMessages so the command never invents a divergent conversion".

Task 3: ADD export function makeAuditCommand(pi: ExtensionAPI) (place it AFTER makeCheckpointRevokeCommand)
  - RETURN: { description: <contract-literal string>, handler: async (args, ctx) => { ... } }.
  - DESCRIPTION (verbatim): "Run the Mulligan context-bloat diagnostic — see what the model is carrying"
    (note the em-dash —).
  - HANDLER BODY (whole thing in ONE try/catch → GOTCHA: never throws):
      try {
        // (i) disabled gate FIRST (mirror auditExecute step 0 + the sibling commands; GOTCHA #7)
        const config = getConfig();
        if (!config.enabled) { notify(ctx, "Mulligan is disabled", "warning"); return; }
        // (a) hasUI guard — skip the expensive pipeline in print/JSON mode (GOTCHA #5)
        if (!ctx.hasUI) return;
        // (b)+(1) Resolve the FILTERED view — mirror auditExecute (NEVER getContextUsage — D5; GOTCHA #1)
        const sessionId = ctx.sessionManager.getSessionId();   // read FRESH (C12)
        const rt = getRuntime(sessionId);
        let filtered: Record<string, unknown>[];
        let confidence: "low" | "medium" | "high";
        if (Array.isArray(rt.lastFiltered)) {
          filtered = rt.lastFiltered;                         // no result cast (matches audit.ts)
          confidence = config.audit.estimateConfidence;
        } else {
          // E16 fallback (spec/06 §7): entries → messages → re-run the SAME pipeline
          const entries = ctx.sessionManager.buildContextEntries();
          const base = auditEntriesToMessages(entries);
          const branch = ctx.sessionManager.getBranch();
          filtered = filterPipeline(base, readMarkers(ctx), config,
            branch as unknown as Parameters<typeof filterPipeline>[3]);   // verbatim cast (GOTCHA #2/#11)
          confidence = "low";
        }
        // (2) Total from the filtered view (NOT computeFilteredTotal — GOTCHA #1)
        type TM = Parameters<typeof estimateTokens>[0];
        const totalTokens = estimateTokens(filtered as unknown as TM).tokens;
        // (e) Build AuditRows (top 8; args IGNORED — GOTCHA #9)
        const top = 8;
        const callLookup = buildCallLookup(filtered);
        const ranked = filtered
          .map((m) => ({ tokens: estimateTokens([m] as unknown as TM).tokens, msg: m }))
          .sort((a, b) => b.tokens - a.tokens)
          .slice(0, top);
        const rows: AuditRow[] = ranked.map(({ tokens, msg }) => {
          const toolName = typeof msg.toolName === "string" ? msg.toolName : undefined;   // GOTCHA #3 (no readStr)
          const rowThreshold = bloatThresholdFor(toolName, config);
          return {
            tokens,
            role: typeof msg.role === "string" ? msg.role : "?",                           // GOTCHA #3
            label: describeMessage(msg, callLookup),
            bloaty: messageBytes(msg) > rowThreshold,
            thresholdBytes: rowThreshold,
          };
        });
        // (d)+(f) markers + checkpoints
        const markers = readMarkers(ctx);
        const checkpointNames = listCheckpoints(ctx.sessionManager.getEntries() as unknown[]);
        // (g) Render the report (identical to the agent tool's renderAuditReport output — spec §130 step 2)
        const report = renderAuditReport({
          totalTokens,
          confidence,
          rewinds: markers.rewinds as RewindMarker[],
          shrinks: markers.shrinks as ShrinkMarker[],
          checkpointNames,
          protectedRoles: config.rewind.protectedRoles,
          rows,
          filtered,
          cancelledCount: markers.cancelledIds.size,
        });
        // (h) Surface to the human ONLY (GOTCHA #5/#10 — never into event.messages)
        notify(ctx, report, "info");
      } catch (e) {
        notify(ctx, `Mulligan: unexpected error: ${e instanceof Error ? e.message : String(e)}`, "warning");
      }
  - JSDoc: cite spec/13 §4; note pi is captured-for-registration-uniformity-but-unused (GOTCHA #6); note args is
            reserved/ignored (GOTCHA #9); Mode A (docs ride with the code).

Task 4: VALIDATE
  - RUN: npm run typecheck   → exit 0 (the make-or-break gate; casts must match audit.ts — GOTCHA #2).
  - RUN: npm test            → full suite GREEN (S1 is additive source; nothing existing calls the new factory).
  - RUN: git status --short  → ONLY ` M src/commands.ts` (single modified file; no new files; no test changes).
```

### Implementation Patterns & Key Details

```typescript
// ── Task 2: the local E16-fallback helper (GOTCHA #4 — replica of audit.ts's module-private entriesToMessages) ──
/** auditEntriesToMessages — local replica of audit.ts's module-private entriesToMessages (spec/06 §7 E16
 *  fallback). DELEGATES to Pi's canonical sessionEntryToContextMessages so the command never invents a divergent
 *  conversion. Defensive (never throws — a throwing entry contributes []). Module-local (not exported). */
function auditEntriesToMessages(entries: SessionEntry[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const entry of entries) {
    try {
      const msgs = sessionEntryToContextMessages(entry);
      if (Array.isArray(msgs)) {
        for (const m of msgs) {
          if (typeof m === "object" && m !== null && !Array.isArray(m)) {
            out.push(m as Record<string, unknown>);
          }
        }
      }
    } catch {
      // best-effort (spec/06 §7) — a throwing entry contributes []
    }
  }
  return out;
}

// ── Task 3: the factory (the deliverable). pi is captured-but-unused (GOTCHA #6). ──────────────────────
/**
 * makeAuditCommand — factory for the `/mulligan_audit` HUMAN-facing command (spec/13 §4). Produces the SAME
 * report the agent's `mulligan_audit` tool produces (renderAuditReport) and surfaces it to the human via
 * ctx.ui.notify ONLY — the report NEVER enters event.messages (a human command must not bloat the model's
 * context; spec/13 §4 step 2). The agent retains its own mulligan_audit tool; same renderer, sink = who invoked.
 *
 * pi is captured by the closure for registration uniformity with the sibling factories (index.ts does
 * pi.registerCommand("mulligan_audit", makeAuditCommand(pi))) but is UNUSED — the audit, like its tool, needs
 * no pi (every read goes through ctx / pure helpers). args is IGNORED (reserved for a future `top` override,
 * spec/13 §4; hardcoded top=8). The whole body is wrapped in try/catch → unexpected-error notify; NEVER throws.
 *
 * @param pi the Pi ExtensionAPI (captured by the closure; unused — the audit is read-only via ctx)
 */
export function makeAuditCommand(pi: ExtensionAPI): {
  description: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
} {
  return {
    description: "Run the Mulligan context-bloat diagnostic — see what the model is carrying",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      // args reserved for a future `top` override (/mulligan_audit 20); ignored for now (spec/13 §4).
      try {
        const config = getConfig();
        if (!config.enabled) {                                   // disabled gate FIRST (GOTCHA #7)
          notify(ctx, "Mulligan is disabled", "warning");        // contract-literal, NO "Mulligan: " prefix
          return;
        }
        if (!ctx.hasUI) return;                                   // skip the pipeline in print/JSON (GOTCHA #5)

        const rt = getRuntime(ctx.sessionManager.getSessionId()); // read FRESH (C12)
        let filtered: Record<string, unknown>[];
        let confidence: "low" | "medium" | "high";
        if (Array.isArray(rt.lastFiltered)) {                     // PRIMARY: cached filtered view (spec/06 §7)
          filtered = rt.lastFiltered;
          confidence = config.audit.estimateConfidence;
        } else {                                                  // E16 fallback: entries → msgs → filterPipeline
          const base = auditEntriesToMessages(ctx.sessionManager.buildContextEntries());
          const branch = ctx.sessionManager.getBranch();
          filtered = filterPipeline(
            base,
            readMarkers(ctx),
            config,
            branch as unknown as Parameters<typeof filterPipeline>[3], // verbatim cast (GOTCHA #2/#11)
          );
          confidence = "low";
        }

        type TM = Parameters<typeof estimateTokens>[0];
        const totalTokens = estimateTokens(filtered as unknown as TM).tokens; // SAME view as rows (GOTCHA #1)

        const top = 8;                                            // args ignored (GOTCHA #9)
        const callLookup = buildCallLookup(filtered);
        const rows: AuditRow[] = filtered
          .map((m) => ({ tokens: estimateTokens([m] as unknown as TM).tokens, msg: m }))
          .sort((a, b) => b.tokens - a.tokens)
          .slice(0, top)
          .map(({ tokens, msg }) => {
            const toolName = typeof msg.toolName === "string" ? msg.toolName : undefined; // GOTCHA #3
            const rowThreshold = bloatThresholdFor(toolName, config);
            return {
              tokens,
              role: typeof msg.role === "string" ? msg.role : "?",                       // GOTCHA #3
              label: describeMessage(msg, callLookup),
              bloaty: messageBytes(msg) > rowThreshold,
              thresholdBytes: rowThreshold,
            };
          });

        const markers = readMarkers(ctx);
        const report = renderAuditReport({                        // identical to the agent tool's call
          totalTokens,
          confidence,
          rewinds: markers.rewinds as RewindMarker[],
          shrinks: markers.shrinks as ShrinkMarker[],
          checkpointNames: listCheckpoints(ctx.sessionManager.getEntries() as unknown[]),
          protectedRoles: config.rewind.protectedRoles,
          rows,
          filtered,
          cancelledCount: markers.cancelledIds.size,
        });

        notify(ctx, report, "info");                              // human sink ONLY (GOTCHA #5/#10)
      } catch (e) {
        notify(ctx, `Mulligan: unexpected error: ${e instanceof Error ? e.message : String(e)}`, "warning");
      }
    },
  };
}

// NOTE on `pi` being unused: tsconfig has NO noUnusedParameters, so this compiles. If a future linter flags it,
// prefix the param `_pi` — but keep the factory TAKING pi (registration uniformity). Do NOT remove the param:
// index.ts (S2) calls makeAuditCommand(pi).
```

### Integration Points

```yaml
SOURCE (src/commands.ts — MODIFIED, the only file):
  - +1 export: makeAuditCommand(pi). +1 module-local helper: auditEntriesToMessages(entries).
  - Extended imports (see Task 1). Reuses the existing module-local notify(ctx,msg,type) helper.
  - Does NOT call reconcileBanner (the audit mutates no checkpoint/banner state — it is read-only).
  - Does NOT touch makeCheckpointCommand / makeCheckpointRevokeCommand / clearCheckpointByName.

REGISTRATION: NONE in S1. P2.M2.T1.S2 (index.ts) will add:
    pi.registerCommand("mulligan_audit", makeAuditCommand(pi));
  and update test/index.test.ts:90 (the 2-command assertion → 3 commands). S1 leaves both untouched.

TESTS: NONE in S1. P2.M2.T1.S3 will add audit-command tests (likely appending to test/commands.test.ts).
  S1's factory is dead code until S2 registers it; S3 tests it via the factory seam (handler called directly
  with fakes, mirroring the S3 checkpoint-command idiom).

DATABASE: none.
CONFIG: reads getConfig() (.enabled / .audit.estimateConfidence / .rewind.protectedRoles); writes nothing.
ROUTES: the command NAME "/mulligan_audit" is S2's registration concern; S1 only builds the factory.

DOCS: [Mode A] JSDoc on makeAuditCommand + auditEntriesToMessages cites spec/13 §4 + spec/06 §7. Rides with the
      code (no separate doc file).

COORDINATION (parallel safety):
  - P2.M1.T1.S3 (parallel, Implementing) creates test/commands.test.ts for the CHECKPOINT commands. S1 ADDS an
    export to src/commands.ts — does NOT modify the checkpoint factories → S3's imports + assertions are
    UNAFFECTED. No merge conflict (S3 = test/ file; S1 = src/ file).
  - P2.M2.T1.S2 (next) — registers makeAuditCommand in index.ts + patches test/index.test.ts. S1's export is the
    contract S2 consumes.
  - P2.M2.T1.S3 (after S2) — audit-command tests. S1's factory + its verbatim gate/disabled strings are the
    contract S3 asserts.
  - P2.M3 (later) — the active-checkpoint banner. The audit command does NOT touch the banner (read-only); the
    report's "Active markers … N checkpoints [names]" line is already produced by renderAuditReport.
```

## Validation Loop

### Level 1: Type Check (the make-or-break gate — after Task 3)

```bash
npm run typecheck    # = tsc --noEmit (strict + noImplicitAny; include: src+test)
echo "typecheck exit: $?"
# EXPECT: exit 0, no output. Proves: the extended imports resolve (./tools/audit.js exports the 5 helpers +
#   AuditRow; sessionEntryToContextMessages + SessionEntry from the package); the casts match audit.ts (GOTCHA
#   #2); renderAuditReport's args object is well-typed; the handler return type matches the declared
#   { description, handler }; makeAuditCommand's return is structurally assignable to Omit<RegisteredCommand,...>.
# If it fails: "Property 'renderAuditReport' does not exist" → wrong/missing import from ./tools/audit.js.
#   "Type 'X' is not assignable to 'Record<string, unknown>[]'" → you changed a cast audit.ts relies on
#   (revert to the verbatim casts in Implementation Patterns). "has no exported member 'AuditRow'" → type import
#   typo (use `import type { AuditRow } from "./tools/audit.js"`).
```

### Level 2: Full Suite (no regression — S1 is additive source)

```bash
npm test            # = vitest run (full suite)
echo "exit: $?"
# EXPECT: full suite GREEN. S1 adds an exported factory that NOTHING calls yet (unregistered until S2), so no
#   existing test can regress from S1's diff. If an EXISTING test regresses → S1 accidentally modified a second
#   file or changed an existing export (check git status --short; revert the stray change — S1 = src/commands.ts ONLY).
```

### Level 3: Scope & Traceability Gates

```bash
# (a) Scope — EXACTLY one modified source file, ZERO new files, ZERO test changes:
git status --short
# EXPECT: only ` M src/commands.ts`. If any `??` (new file) or ` M` on another path appears → S1 went out of
#   scope (registration = S2; tests = S3). Revert it.

# (b) The factory is exported with the contract-literal description:
grep -nE 'export function makeAuditCommand' src/commands.ts                       # EXPECT: 1 hit
grep -nF 'Run the Mulligan context-bloat diagnostic — see what the model is carrying' src/commands.ts  # EXPECT: 1 hit (em-dash)

# (c) The disabled gate fires FIRST with the NO-PREFIX contract-literal message (GOTCHA #7):
grep -nF '"Mulligan is disabled"' src/commands.ts    # EXPECT: ≥3 (the 2 checkpoint factories + the audit factory)

# (d) The report sink is ctx.ui.notify (NOT setWidget, NOT sendMessage/appendEntry) — GOTCHA #5/#10:
grep -nE 'notify\(ctx, report' src/commands.ts       # EXPECT: 1 hit (the report surface)
grep -nE 'setWidget|sendMessage|appendEntry' src/commands.ts   # EXPECT: 0 hits in the audit handler (none added by S1)

# (e) computeFilteredTotal is NOT used for the reported total (GOTCHA #1):
grep -nE 'computeFilteredTotal' src/commands.ts      # EXPECT: 0 hits (the command mirrors auditExecute instead)

# (f) The verbatim audit.ts casts are present (GOTCHA #2):
grep -nE 'as unknown as (TM|Parameters<typeof filterPipeline>)' src/commands.ts   # EXPECT: ≥3 (total + per-msg + branch)

# (g) The local E16-fallback helper exists (GOTCHA #4) and delegates to sessionEntryToContextMessages:
grep -nE 'function auditEntriesToMessages' src/commands.ts                          # EXPECT: 1 hit
grep -nE 'sessionEntryToContextMessages' src/commands.ts                            # EXPECT: ≥2 (import + call)

# (h) renderAuditReport is called with the full args object (incl. checkpointNames + cancelledCount):
grep -nE 'renderAuditReport\(\{' src/commands.ts                                    # EXPECT: 1 hit
grep -nE 'checkpointNames:|cancelledCount:' src/commands.ts                         # EXPECT: ≥1 each
```

### Level 4: Behavioral Sanity (manual — no automated test in S1)

```bash
# S1 writes no test (that is S3). To sanity-check the handler in isolation BEFORE S2/S3 land, a maintainer can
# temporarily call the factory's handler from a scratch script / node REPL with a hand-rolled fake ctx that
# scripts rt.lastFiltered (via getRuntime/setRuntime) + getEntries + buildContextEntries, then assert the
# captured notify message starts with "## Mulligan audit — context you are currently carrying" and contains the
# "Active markers:" line. (This is OPTIONAL — S3 is the real test. Do NOT commit a scratch file.)
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npm run typecheck` → exit 0 (the casts match audit.ts verbatim — GOTCHA #2).
- [ ] Level 2: `npm test` → full suite GREEN (S1 is additive; no regression possible).
- [ ] Level 3a: `git status --short` → ONLY ` M src/commands.ts` (no new files, no test changes).
- [ ] Level 3e: `grep computeFilteredTotal src/commands.ts` → 0 hits (GOTCHA #1 — mirror auditExecute instead).
- [ ] Level 3f: the 3 verbatim casts present (`as unknown as TM` x2 + `as unknown as Parameters<typeof filterPipeline>[3]`).

### Feature Validation
- [ ] `makeAuditCommand` exported; returns `{ description, handler }`; description is the contract-literal string.
- [ ] Disabled gate FIRST → "Mulligan is disabled" (warning, NO prefix) → return before any session access.
- [ ] `!ctx.hasUI` → early return (skips the pipeline in print/JSON mode).
- [ ] Filtered view mirrors auditExecute (cached `rt.lastFiltered` else E16 `filterPipeline` fallback); NEVER `getContextUsage()` (D5).
- [ ] `totalTokens = estimateTokens(filtered)` from the SAME view as the rows (NOT computeFilteredTotal — GOTCHA #1).
- [ ] Rows: top 8, ranked by `estimateTokens([m])` desc, via `buildCallLookup` + `describeMessage` + `messageBytes` + `bloatThresholdFor`.
- [ ] `checkpointNames = listCheckpoints(getEntries())`; `cancelledCount = markers.cancelledIds.size`.
- [ ] `report = renderAuditReport({...})` — identical call to the agent tool.
- [ ] `notify(ctx, report, "info")` — human sink ONLY; NO `pi.sendMessage`/`pi.appendEntry`.
- [ ] Whole body in try/catch → "Mulligan: unexpected error: …" (warning); NEVER throws.

### Code Quality / Scope Discipline
- [ ] Modified ONLY `src/commands.ts` (added 1 export + 1 module-local helper + extended imports).
- [ ] Did NOT touch `src/index.ts` (registration = S2) or `test/index.test.ts` (the 2-command assertion = S2).
- [ ] Did NOT write tests (that is S3 / P2.M2.T1.S3).
- [ ] Did NOT call `reconcileBanner` (the audit is read-only; banner = P2.M3's persistent-state concern).
- [ ] Did NOT use `computeFilteredTotal` for the reported total (GOTCHA #1) — computed `estimateTokens(filtered)` instead.
- [ ] Followed conventions: `.js` local imports; type-only imports for `RewindMarker`/`ShrinkMarker`/`AuditRow`/`SessionEntry`; the module-local `notify()` helper; try/catch → unexpected-error notify; Mode A JSDoc citing spec/13 §4.

### Documentation
- [ ] JSDoc on `makeAuditCommand` cites spec/13 §4; notes pi is captured-but-unused (GOTCHA #6) + args reserved/ignored (GOTCHA #9).
- [ ] JSDoc on `auditEntriesToMessages` cites spec/06 §7 + "local replica of audit.ts's module-private entriesToMessages".
- [ ] No separate doc file (Mode A — docs ride with the code as comments).

---

## Anti-Patterns to Avoid

- ❌ Don't use `computeFilteredTotal(ctx)` for the REPORTED total (GOTCHA #1). Its E16 fallback omits
  `filterPipeline` (its own JSDoc: "Audit keeps its own more-accurate fallback"); using it would make the human
  report diverge from the agent tool's report on the E16 path (violating spec §130 "Same renderer"). Compute
  `totalTokens = estimateTokens(filtered)` from the SAME filtered view used for the rows. (The contract step (c)
  "call computeFilteredTotal" is a research imprecision — superseded by the spec's "Reuse the existing
  auditExecute pipeline" + "Same renderer".)
- ❌ Don't "simplify" the casts (GOTCHA #2). `estimateTokens(filtered as unknown as TM)`,
  `estimateTokens([m] as unknown as TM)`, and `branch as unknown as Parameters<typeof filterPipeline>[3]` are
  load-bearing under strict TS (MessageLike/AgentMessage/BranchEntry are nominal-ish Pi types). Copy them
  verbatim from `src/tools/audit.ts`. Removing them → typecheck failure.
- ❌ Don't import `readStr`/`readOwn`/`isRecord`/`entriesToMessages`/`auditExecute` from `./tools/audit.js` —
  they are MODULE-PRIVATE (GOTCHA #3/#4). Use inline `typeof … === "string"` guards for `msg.toolName`/`msg.role`,
  and replicate `entriesToMessages` locally as `auditEntriesToMessages`. `describeMessage`/`messageBytes`/
  `buildCallLookup`/`renderAuditReport`/`listCheckpoints` ARE exported — reuse those.
- ❌ Don't surface the report via `ctx.ui.setWidget` or `pi.sendMessage`/`pi.appendEntry` (GOTCHA #5/#10).
  `setWidget` is persistent (wrong lifecycle for a one-shot diagnostic + collides with the banner's widget key
  namespace, P2.M3); `sendMessage`/`appendEntry` inject into the model's context (spec §130 step 2 forbids it).
  Use `ctx.ui.notify(report, "info")`.
- ❌ Don't put the disabled gate AFTER the pipeline, or prefix its message. It fires FIRST (mirror auditExecute
  step 0 + the sibling commands) with the contract-literal "Mulligan is disabled" (NO "Mulligan: " prefix —
  GOTCHA #7). When disabled, the context handler is pass-through, so reporting a transformed view would mislead
  (D5) — refuse before any session access.
- ❌ Don't register the command, patch `test/index.test.ts`, or write tests (GOTCHA: scope). Registration = S2
  (P2.M2.T1.S2); tests = S3 (P2.M2.T1.S3). S1 = add the factory to `src/commands.ts` ONLY. `git status --short`
  must show only ` M src/commands.ts`.
- ❌ Don't parse `args` (GOTCHA #9). `/mulligan_audit` ignores its args (spec §13 §4; reserved for a future `top`
  override). Hardcode `const top = 8;`.
- ❌ Don't call `reconcileBanner` from the audit handler. The audit is READ-ONLY — it mutates no checkpoint or
  banner state. `reconcileBanner` is for the checkpoint commands' SUCCESSFUL MUTATION paths (P2.M1) + the banner
  refresh hooks (P2.M3). Calling it here would be a spurious banner refresh on a read-only command.
- ❌ Don't remove the `pi` parameter or prefix it `_pi` unless a linter forces it. Keep `makeAuditCommand(pi)`
  for registration uniformity with the siblings (index.ts calls `makeAuditCommand(pi)`). It is intentionally
  unused (GOTCHA #6); tsconfig has no `noUnusedParameters`.

## Confidence Score

**9/10** for one-pass implementation success. The deliverable is a single-source-file addition whose entire
handler body is a verbatim mirror of `auditExecute` (an existing, typechecked, tested reference implementation),
so the implementing agent is transcribing a proven pipeline into the command idiom — not designing new logic.
The exact code (imports, the `auditEntriesToMessages` replica, the factory + handler) is given in "Implementation
Patterns" copy-adapt-ready. The four traps that would otherwise bite are called out with the failure symptom +
fix: (1) the `computeFilteredTotal`-vs-mirror decision (GOTCHA #1 — the single most important one; the contract's
step (c) is a research imprecision, corrected in 4 places), (2) the load-bearing casts (GOTCHA #2 — removing them
fails typecheck), (3) the module-private helpers that must be replicated not imported (GOTCHA #3/#4), and (4) the
sink = `ctx.ui.notify` not `setWidget`/`sendMessage` (GOTCHA #5/#10). The 1-point reserve covers the small chance
the implementing agent literal-copies the contract's "call computeFilteredTotal" before reading GOTCHA #1 — but
the correction is stated in-place in 4 places (Decision 1, GOTCHA #1, Task 3, Anti-Pattern #1), so recovery is
one-line (delete the `computeFilteredTotal` call, use `estimateTokens(filtered)`). Scope is tightly bounded
(source-only; registration + tests are explicitly deferred to S2/S3), eliminating the most common failure mode
(going out of scope).