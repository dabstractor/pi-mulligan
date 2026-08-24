---
name: "P1.M2.T4.S1 — Register + drive + assert F-useraudit (wrapper-ctx notify capture vs real agent tool; zero writes from the command)"
---

## Goal

**Feature Goal**: Add the `F-useraudit` scenario to the integration smoke suite (BUG-003 / spec @10-testing.md §2.1 F-useraudit pass criteria), proving end-to-end on a real `pi -p` run that the human `/mulligan_audit` command and the agent `mulligan_audit` tool render the **same report** through separated sinks: (a) the two rendered report strings (real agent `auditTool.execute` result text vs the command's captured `ctx.ui.notify` output) are IDENTICAL after normalization; (b) the command performed **ZERO session writes** (no `mulligan:*` custom entries attributable to it, no sendMessage artifacts) while the agent tool's result **did** reach the model as a tool-result entry in the session JSONL; (c) the real headless `/mulligan_audit` dispatch (a third `-p` prompt) early-returns on `!ctx.hasUI` without throwing and writes nothing; (d) `assertGlobalInvariants` holds.

**Deliverable**: Edited `test/integration/run-smoke.mjs` (SCENARIOS entry, 3-prompt `runScenario()` branch, `assertUseraudit` + ASSERTERS wiring), edited `test/integration/smoke.ts` (a `F-useraudit` case in `driveScenario` that drives the real agent tool and the real command handler with a wrapper ctx), and a new `### F-useraudit` section in `test/integration/scenarios.md`. NO production-code changes.

**Success Definition**: `npm run smoke` runs F-useraudit and reports PASS (19/19 expected at full-suite time; 18/18 if F-drift-userexempt hasn't landed — F-consent F-ckptcmd F-banner all landed earlier); `npm test` + `npx tsc --noEmit` stay green.

## Why

`makeAuditCommand` (src/commands.ts:262-360) is unit-tested (test/commands.test.ts) but the real end-to-end headless path is uncovered (BUG-003): the command early-returns when `!ctx.hasUI` (print/`-p` mode) and its report goes ONLY to `notify(ctx, report, "info")` → `ctx.ui.notify` — never `event.messages`, never `pi.sendMessage`/`pi.appendEntry`. Spec @10 §2.1 F-useraudit requires proving "the human /mulligan_audit renders the same report, never injected into event.messages" on a real run. The headless harness must therefore capture the notify output via a **wrapper ctx** (`hasUI:true` + a capture `ui.notify`, sessionManager from the REAL ctx) instead of relying on UI rendering that does not exist under `-p`.

## What

### 1. Register — `test/integration/run-smoke.mjs`

- Append `"F-useraudit"` to the SCENARIOS array (:30-44) after `"F-banner"`.
- Add `"F-useraudit": assertUseraudit` to the ASSERTERS map (:652-666).
- Single spawn — the standard `{ smoke, piRes }` asserter shape (like assertCkptcmd); no `main()` special-case.

### 2. Drive — `runScenario()` branch (~next to the F-ckptcmd/F-banner branches, ~:736)

```js
if (scenario === "F-useraudit") {
  // F-useraudit (BUG-003 / spec @10-testing.md §2.1): report PARITY + sink SEPARATION.
  // Prompt 1: /mulligan_smoke F-useraudit — deterministic command; the smoke.ts case drives BOTH the
  //   real agent auditTool (its result becomes a real toolResult the model consumes) AND the real
  //   makeAuditCommand handler via a wrapper ctx that captures ui.notify (headless pi -p has no UI —
  //   the raw command would early-return on !ctx.hasUI, so we wrap). Both report strings smokeLog'd.
  // Prompt 2: -p /mulligan_audit — the REAL headless dispatch path: hasUI:false → early return, MUST
  //   not throw, MUST not write (this is a genuine pi command dispatch through index.ts registration).
  // Prompt 3: observing inference — fires context; persists the session JSONL for the tool-result
  //   entry assertion.
  const piRes = runPi(scenario, {
    prompts: [
      "/mulligan_smoke F-useraudit",
      "/mulligan_audit",
      "Reply with exactly: OK",
    ],
  });
  const smoke = parseSmokeLog(piRes.logPath);
  return { piRes, smoke };
}
```

Fires expected: prompt 1's tool executes INSIDE the command dispatch (its result text feeds the command's model turn — one fire), prompt 3 (one fire) → ≥2 `context.fire` lines. Slash prompts 2 dispatch without inference.

### 3. smoke.ts — the `F-useraudit` driveScenario case

Imports already present: `auditTool` (line 41) and `makeRewindTool` etc. Add `makeAuditCommand` to the import from `"../../src/commands.js"` (check the existing commands import — smoke.ts imports from commands.js for `/mulligan_smoke`; extend it). New case in the switch (next to `F-ckptcmd` at :404):

```ts
case "F-useraudit": {
  // (a) REAL agent tool: execute with the REAL ctx (its sessionManager backs both consumers). The
  // result text is the report the MODEL receives. smokeLog the FULL text (parity comparison needs it).
  try {
    const res = await auditTool.execute("smoke-useraudit-tool-1", { top: 8 }, undefined, undefined, ctx);
    const toolText = resultText(res.content as unknown as { type: string; text?: string }[]);
    smokeLog("useraudit.tool", "info", { text: toolText });
  } catch (e) {
    smokeLog("useraudit.tool", "fail", { error: String(e) });
    break;
  }
  // (b) REAL human command handler via a WRAPPER ctx: headless pi -p has ctx.hasUI === false, and
  // makeAuditCommand early-returns then. Wrap: hasUI:true + a capturing ui.notify; sessionManager is
  // the REAL ctx's (same session → same filtered view/markers → same renderAuditReport output).
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
```

Key facts baked into this shape:
- `makeAuditCommand(pi)` factory is `(pi: ExtensionAPI) => { description, handler(args, ctx) }` (src/commands.ts:262-266); `pi` is captured-but-unused — any real pi works.
- The handler reads `ctx.hasUI`, `ctx.ui.notify` (via `notify()` helper, commands.ts:48-50), `ctx.sessionManager.{getSessionId, buildContextEntries, getBranch, getEntries}` — the real ctx's sessionManager supplies all of them.
- The tool and the command share `rt.lastFiltered` / the E16 fallback pipeline, so on the SAME ctx/session the `renderAuditReport` outputs are identical EXCEPT possibly confidence/time-derived fields — hence the asserter NORMALIZES before comparing (below).
- The `auditTool.execute` call happens during the command dispatch turn; its result reaches the model (persisted as a toolResult entry) — that's the sink-separation positive arm.

### 4. Assert — new `assertUseraudit({ smoke, piRes })` in run-smoke.mjs

Structure mirrors assertCkptcmd (hard-fail when JSONL missing — everything here is deterministic except the final observing prompt):

- **Sanity**: `piRes.status === 0`; `smoke.contextFires.length >= 1`; a `scenario.start`/`scenario.done` pair for F-useraudit with no `scenario.crash` line.
- **(a) Report PARITY**: read the smoke lines — `toolLine = smoke.lines.filter(l => l.test === "useraudit.tool")`, `cmdLine = ... l.test === "useraudit.command"` (both status `"pass"`-equivalent: `useraudit.tool`/`useraudit.command` FAIL lines fail the scenario). Normalize BOTH texts:
  ```js
  const norm = (s) => String(s ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^[-=─═]+$/.test(l))   // drop rule lines
    .join("\n");
  ```
  If the report contains volatile fields (grep the rendered `renderAuditReport` output for timestamps/session ids first — as of this writing it does NOT include them, but VERIFY against the actual smoke-log text during implementation; if any line is volatile, also filter it in `norm` with a comment). Assert `norm(toolText) === norm(cmdText)` with a detail diff of the first divergent line (slice both to ~400 chars for the failure detail).
- **(b) Command made ZERO writes**: JSONL entries — `countCustom(entries, "mulligan:rewind") + countCustom(entries, "mulligan:shrink") + countCustom(entries, "mulligan:cancel") === 0` for F-useraudit's session (this scenario creates NO markers anywhere in its flow — assert the TOTAL is zero), and ZERO entries whose stringified form contains the report's distinctive content: `!entries.some(e => JSON.stringify(e).includes("Mulligan context audit") || <the report's title line>)` — check `renderAuditReport`'s exact title (src/notes.ts / wherever renderAuditReport lives — grep `"Top messages"` / the header constant) and grep for THAT byte string in the JSONL. Report bytes on disk = the sink leaked.
- **(c) Sink separation positive arm**: the TOOL result DID reach the model — the JSONL contains an entry whose stringified form includes `"mulligan_audit"` (the toolResult for the smoke-useraudit-tool-1 call) — use a targeted filter (e.g. `entries.some(e => JSON.stringify(e).includes("mulligan_audit") && JSON.stringify(e).includes("toolResult"))`, mirroring assertCkptcmd's (d) grep idiom). And the COMMAND's notify capture was NOT persisted: the captured report text (from `useraudit.command` line) does NOT appear in ANY JSONL entry (same grep as (b) — one assertion covering both).
- **(d) Headless `/mulligan_audit` dispatch survived**: prompt 2 ran the REAL command with hasUI:false → early return; no throw. Since a thrown command would surface as a pi error/non-zero exit, assert `piRes.status === 0` AND no `useraudit.command`-related fail line AND zero additional session writes beyond (b). (The early-return path itself is unit-proven; here we prove it doesn't crash the real dispatch.)
- **(e)** `assertGlobalInvariants(results, entries)` — hard-fail if `entries.length === 0` (assertCkptcmd deviation: deterministic writes only... actually this scenario writes NOTHING, so the JSONL exists only if the observing turn persisted; use the skip-with-⚠ convention like assertRewindCore if `entries.length === 0`, BUT then assertions (b)/(c) must fail with a clear "JSONL needed" label — prefer: `assert(results, "session JSONL available", entries.length > 0, "model may have timed out")` and short-circuit the JSONL-dependent checks on failure).

### 5. Docs — `test/integration/scenarios.md` (Mode A, same subtask)

Add `### F-useraudit` after the F-banner section (~:357-404): document (i) the wrapper-ctx notify-capture strategy (headless `-p` ⇒ `ctx.hasUI === false` ⇒ the command early-returns, so the harness wraps the REAL ctx with `hasUI:true` + a capturing `ui.notify` — this is the ONLY way to observe the command's report under `-p`); (ii) the parity claim (same `renderAuditReport`, same filtered view/runtime cache ⇒ identical normalized strings); (iii) the sink-separation contract (notify is one-shot human UI — never `event.messages`, never persisted; the agent tool's result IS a toolResult the model consumes); (iv) the three-prompt flow and pass criteria mapping to spec @10 §2.1 F-useraudit.

### Success Criteria

- [ ] F-useraudit registered, driven, asserted; `npm run smoke` → PASS.
- [ ] (a) normalized tool report === normalized command-captured report.
- [ ] (b) zero `mulligan:*` custom entries + zero report bytes in the JSONL from the command.
- [ ] (c) the agent tool's `mulligan_audit` toolResult IS in the JSONL (reached the model).
- [ ] (d) real headless `/mulligan_audit` prompt dispatched without error; exit 0.
- [ ] (e) global invariants hold; `npm test` + `npx tsc --noEmit` green; scenarios.md section added.

## All Needed Context

### Context Completeness Check

An implementer reading only this PRP + the four files below has: the exact command handler behavior (early return, notify-only sink), the exact tool shape (plain `export const`, execute signature), the harness idioms (runPi prompts override, parseSmokeLog/readSessionEntries/countCustom/assert/assertGlobalInvariants), and the asserter template (assertCkptcmd/assertBanner).

### Documentation & References

```yaml
- file: src/commands.ts
  why: makeAuditCommand :262-360 — factory (pi)=>{description,handler(args,ctx)}; handler: enabled gate → !ctx.hasUI EARLY RETURN →
       rt.lastFiltered-or-E16-fallback → renderAuditReport (identical call to the agent tool) → notify(ctx, report, "info") ONLY;
       never pi.sendMessage/appendEntry; whole body try/catch → notify warning. notify() helper :48-50 (ctx.hasUI ? ctx.ui.notify).
  gotcha: report title/content — grep renderAuditReport's output header to get the exact JSONL-grep needle for (b)

- file: src/tools/audit.ts
  why: auditTool is a PLAIN export const :706-711 (NO factory — `auditTool.execute(...)` directly); auditExecute :576+ mirrors the
       command's steps (enabled gate, rt.lastFiltered primary / buildContextEntries+filterPipeline fallback, top=8, readMarkers,
       listCheckpoints, renderAuditReport). NEVER throws; returns {content:[{type:"text",text:report}], details}
  gotcha: E12 precedent — smoke.ts:359 already calls auditTool.execute(... , ctx) with a command ctx; reuse that call shape

- file: test/integration/smoke.ts
  why: driveScenario switch (add the case next to F-ckptcmd :404 / F-banner :411); smokeLog :79; resultText :91; imports :41 (auditTool
       already imported); ctx is ExtensionCommandContext — its sessionManager is the REAL one the wrapper reuses
  gotcha: pi is in scope in driveScenario (used by rewindNow); makeAuditCommand needs importing from ../../src/commands.js

- file: test/integration/run-smoke.mjs
  why: SCENARIOS :30-44; runPi :62-96 (prompts override); parseSmokeLog :103; readSessionEntries :127; assert :142; countCustom :150;
       ASSERTERS :652-666; runScenario F-banner branch :736-758 (custom-prompts precedent); assertCkptcmd :418-464 (asserter template
       + the "hard-fail vs skip-with-⚠" reasoning); assertGlobalInvariants :204
  gotcha: plain Node ESM, NOT type-checked — keep it shell-like and defensive; use `?.`/String() coercion on smoke-line details

- file: test/integration/scenarios.md
  why: §"How the harness works" + the F-banner section :357 — place the new ### F-useraudit section after it, same documentation style

- file: plan/008_1c8ca4d1826d/bugfix/001_9420568ef08d/P1M2T3S1/PRP.md
  why: the F-consent sibling PRP (landed before this item) — same SCENARIOS/ASSERTERS/runScenario shape; confirms placement order
       (F-consent lands between F-banner and F-failopen in the array; slot F-useraudit per its "after F-banner" guidance, adjusting
       to keep the array's logical grouping)

- file: plan/008_1c8ca4d1826d/architecture/system_context.md
  why: §commands — the research note this contract cites (makeAuditCommand headless early-return + notify-only sink)
```

### Current Codebase tree (relevant slice)

```bash
src/commands.ts               # makeAuditCommand + notify (production — READ ONLY here)
src/tools/audit.ts            # auditTool (plain const) + auditExecute
test/integration/run-smoke.mjs # orchestrator: SCENARIOS, runScenario, asserters
test/integration/smoke.ts     # driveScenario + smokeLog + context handler
test/integration/scenarios.md # scenario docs
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# No new files — edits to run-smoke.mjs, smoke.ts, scenarios.md only.
```

### Known Gotchas of our codebase & Library Quirks

```js
// CRITICAL: headless `pi -p` ⇒ ctx.hasUI === false ⇒ makeAuditCommand's handler EARLY-RETURNS at the
//   `if (!ctx.hasUI) return;` gate — without the wrapper ctx the command produces NO report and the
//   parity assertion would compare a real report against "" (vacuous fail). The wrapper is the scenario's core trick.
// CRITICAL: the wrapper MUST reuse the REAL ctx.sessionManager (spread `...ctx`, then override hasUI/ui) — a fake
//   sessionManager would give a different filtered view/markers and parity would be coincidental, not proven.
// GOTCHA: auditTool is NOT a factory (makeRewindTool is) — call `auditTool.execute(...)` directly (smoke.ts:359 precedent).
// GOTCHA: smokeLog is never-throwing; assertion happens in run-smoke.mjs by reading the smoke lines — a FAIL smoke
//   line must translate into a failing `assert(...)` in the asserter (GOTCHA #7 discipline used by F-rewind-core.hiding).
// GOTCHA: smoke lines wrap detail in JSON — the report string round-trips with \n escapes; parse via l.detail.text.
// GOTCHA: the second `-p /mulligan_audit` prompt is a REAL pi command dispatch through index.ts registration
//   (pi.registerCommand("mulligan_audit", makeAuditCommand(pi))) — it must not throw; a throw would surface in piRes.status/stderr.
// GOTCHA: report parity must be NORMALIZED before compare — verify against the actual rendered output whether any line is
//   volatile (timestamp/percentage) and filter it in norm(); do NOT weaken parity to a substring check.
// GOTCHA: run-smoke.mjs is plain ESM (no types) and defensive — mirror assertCkptcmd's style; keep the "-ne" defense
//   (globally-installed mulligan collision) untouched (it comes free via runPi).
// GOTCHA: keep canary discipline — do not introduce a string that collides with existing MULLIGAN-SMOKE-* canaries.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: EDIT test/integration/smoke.ts
  - IMPORT makeAuditCommand from ../../src/commands.js (extend the existing commands.js import)
  - ADD the "F-useraudit" case to driveScenario's switch (after F-banner, :~411): real auditTool.execute with
    the REAL ctx → smokeLog("useraudit.tool"); makeAuditCommand(pi).handler with the wrapper ctx → smokeLog("useraudit.command")
  - REUSE resultText/smokeLog; wrap each consumer in its own try/catch (a fail in one must not skip the other's evidence)

Task 2: EDIT test/integration/run-smoke.mjs — register + drive
  - APPEND "F-useraudit" to SCENARIOS (after "F-banner"; after "F-consent" if already present)
  - ADD the F-useraudit branch in runScenario(): 3-prompt flow ["/mulligan_smoke F-useraudit", "/mulligan_audit",
    "Reply with exactly: OK"] via runPi's prompts override; return { piRes, smoke }

Task 3: EDIT test/integration/run-smoke.mjs — assertUseraudit + ASSERTERS wiring
  - ADD "F-useraudit": assertUseraudit to ASSERTERS
  - IMPLEMENT assertUseraudit({ smoke, piRes }) per "What" §4: sanity, parity (norm compare + first-divergent-line detail),
    zero-writes (countCustom totals + report-bytes grep), toolResult-reached-model, headless-dispatch survival,
    assertGlobalInvariants; JSONL-dependent checks gated on entries.length > 0 with a hard assert on availability

Task 4: DOCUMENT test/integration/scenarios.md
  - ADD "### F-useraudit" after F-banner: wrapper-ctx notify-capture strategy, parity + normalization, sink separation,
    3-prompt flow, pass-criteria mapping

Task 5: VALIDATE
  - npx vitest run (unit suite untouched → green); npm run smoke (F-useraudit PASS; earlier scenarios unbroken);
    npx tsc --noEmit (smoke.ts edits typecheck)
  - Iterate on parity normalization using the ACTUAL smoke log (inspect test log under /tmp/mulligan-smoke/F-useraudit.log)
```

### Implementation Patterns & Key Details

```ts
// The wrapper ctx — THE core pattern of this scenario:
const captured: { msg: string; type: string }[] = [];
const wrapperCtx = {
  ...ctx,                                   // REAL sessionManager + everything else
  hasUI: true,                              // defeat the headless early-return gate
  ui: { notify: (msg, type) => captured.push({ msg, type }) }, // the captured human sink
} as unknown as typeof ctx;

// Parity normalization — compare RENDERED CONTENT, not byte layout:
const norm = (s) =>
  String(s ?? "").split("\n").map(l => l.trim())
    .filter(l => l.length > 0 && !/^[-=─═]+$/.test(l)).join("\n");
// If the real report shows volatile lines (percentages/timestamps), add targeted filters WITH a comment
// quoting the exact volatile line — never a blanket substring containment check.
```

### Integration Points

```yaml
# None beyond the smoke harness. No src/ changes. P1.M2.T6.S1 counts this scenario in the 19/19 gate.
# Do NOT touch F-drift-userexempt (P1.M2.T5.S1 owns it) or the checkpoint.ts deprecation (P1.M3).
```

## Validation Loop

### Level 1-2: unit + types

```bash
npx vitest run            # unit suite green (no src changes; smoke.ts is excluded from vitest globs — verify)
npx tsc --noEmit          # smoke.ts edits typecheck
```

### Level 3: the scenario itself

```bash
npm run smoke             # F-useraudit must PASS; all prior scenarios stay PASS
# Inspect evidence when iterating:
cat /tmp/mulligan-smoke/F-useraudit.log | grep -E 'useraudit|scenario\.|context\.fire' | head -40
```

### Level 4: manual cross-checks

- Confirm the parity assertion is non-vacuous: temporarily assert `toolText.length > 200` (a real report is long; an empty/refusal report would otherwise pass parity trivially — keep this as a permanent sanity assert).
- Confirm the zero-writes grep needle is a REAL report fragment (grep the report title from the smoke log, then verify zero JSONL hits).

## Final Validation Checklist

- [ ] `npm run smoke` green incl. F-useraudit; `npm test` + `npx tsc --noEmit` green
- [ ] Only test/integration/{run-smoke.mjs,smoke.ts,scenarios.md} changed (`git status`)
- [ ] Parity asserted on normalized FULL texts with a non-vacuity length guard
- [ ] Zero command writes + zero report bytes in JSONL; toolResult entry present
- [ ] Headless `/mulligan_audit` prompt dispatched, exit 0
- [ ] assertGlobalInvariants runs; scenarios.md `### F-useraudit` section added (Mode A)

## Anti-Patterns to Avoid

- ❌ Don't build a fake sessionManager for the wrapper — reuse the REAL ctx's or parity proves nothing
- ❌ Don't skip the `!ctx.hasUI` real-dispatch prompt (prompt 2) — the early-return-without-throw path is part of the contract
- ❌ Don't compare reports by `toContain`/substring — normalize, then compare for equality
- ❌ Don't edit src/commands.ts, src/tools/audit.ts, or any production file — this is a harness-only item
- ❌ Don't let a FAIL smoke line go unasserted in the asserter (GOTCHA #7), and don't weaken assertGlobalInvariants

**Confidence Score: 9/10** — the harness patterns (custom-prompts runScenario branches, smokeLog-evidence asserters, assertCkptcmd template) are all proven in-file; the only discovery left to the implementer is the exact rendered-report volatility (handled by the normalize-then-verify instruction with the actual log).