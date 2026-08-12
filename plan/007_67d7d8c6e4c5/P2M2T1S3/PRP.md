name: "P2.M2.T1.S3 — Tests for the `/mulligan_audit` command"
description: |
  Test-only work item (Mode A). Add a new section to `test/commands.test.ts` that proves the
  human-facing `/mulligan_audit` command (the `makeAuditCommand` factory from S1, registered in S2)
  renders the SAME report string as the agent's `renderAuditReport`, delivers it ONLY to the human
  sink (`ctx.ui.notify`), makes ZERO writes that could enter `event.messages` (no `pi.sendMessage` /
  `pi.appendEntry`), and refuses cleanly when Mulligan is disabled. Four contract cases + bonuses,
  all green. No production code changes, no docs.

---

## Goal

**Feature Goal**: Add a vitest section to `test/commands.test.ts` covering the `makeAuditCommand`
handler path with four contract assertions: (a) the handler renders a byte-identical string to what
`renderAuditReport` produces for the same inputs; (b) that string is delivered to the human sink
(`ctx.ui.notify`, type `"info"`); (c) the handler never calls `pi.sendMessage` or `pi.appendEntry`
(the report never bloats the model's context — the **F-useraudit** invariant); (d) `config.enabled=false`
refuses with the contract-literal `"Mulligan is disabled"`.

**Deliverable**: A self-contained `describe("/mulligan_audit", …)` section appended to
`test/commands.test.ts` (no new file). Mirrors the existing checkpoint-command test idiom already
in that file (hand-rolled fakes, `.js` imports, `clearAll()` + `setConfig(undefined)` reset). Plus a
minimal, non-breaking extension of the file's existing `makePi`/`makeCtx` fakes to capture the
audit-specific surfaces (`appendEntry`/`sendMessage` spies; `sessionManager.getSessionId` +
`buildContextEntries`). All assertions use the SAME pure helpers the production handler calls.

**Success Definition**: `npx vitest run test/commands.test.ts` is green (existing checkpoint tests
untouched + new audit tests pass), `npm run typecheck` (`tsc --noEmit`) is clean, and the four
contract cases (a)–(d) are each explicitly present and passing.

## User Persona (if applicable)

**Target User**: pi-mulligan maintainers / the implementer's regression net (these are unit tests).

**Use Case**: Regression-guard the v1.1 human-facing audit command so the "report never enters the
model's context" property cannot silently regress (the whole point of F-useraudit / spec/13 §4).

**Pain Points Addressed**: Without these tests, a future refactor could accidentally route the audit
report into `event.messages` (via `pi.sendMessage`/`appendEntry`) and bloat the model's context —
exactly the failure mode the human command exists to avoid.

## Why

- **Invariant enforcement (F-useraudit)**: spec/13 §4 step 2 + spec/09 §2.1 F-useraudit mandate that
  the human `/mulligan_audit` output reaches the transcript / `ctx.ui` and is **never** injected into
  `event.messages`, while the agent's `mulligan_audit` tool result still reaches the model. Same
  renderer; the sink is determined by who invoked it. Case (c) is the load-bearing assertion.
- **Renderer parity (F-useraudit "both render the same report")**: case (a) proves the command path
  produces the same string the agent tool path produces — it catches any divergence between the
  command's inline arg-building and a direct `renderAuditReport` call.
- **Cheap, deterministic, isolated**: pure unit tests with fakes — no real Pi, no LLM, no file I/O.
  They run on every `npm test` and gate `prepublishOnly`.

## What

User-visible behavior: **none** (test-only). Technical requirement: a new test section + two
minimal, non-breaking fake extensions. The existing 14 `it(...)` checkpoint tests in
`test/commands.test.ts` MUST remain green and unmodified.

### Success Criteria

- [ ] Case (a): running the handler and re-deriving `renderAuditReport`'s args from the same seeded
  inputs yields `expect(actualNotifyMsg).toBe(expectedReport)` — exact string equality, for at least
  one fixture on the PRIMARY (cached `rt.lastFiltered`) path.
- [ ] Case (b): `notifies` has length 1, `notifies[0].type === "info"`, and
  `notifies[0].msg` contains the report.
- [ ] Case (c): after a successful run, the fake `pi.appendEntry` and `pi.sendMessage` spy arrays
  each have length 0 (zero writes — the report never reaches `event.messages`).
- [ ] Case (d): `setConfig({ enabled: false })` → exactly one notify, type `"warning"`, message
  exactly `"Mulligan is disabled"` (NO `"Mulligan: "` prefix).
- [ ] Existing checkpoint tests unchanged and green; `npx vitest run test/commands.test.ts` all pass.
- [ ] `npm run typecheck` clean (no `any` leaks; casts mirror the production handler's).

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase, they would need: the exact `makeAuditCommand` handler
contract (provided below verbatim from the landed `src/commands.ts`), the `renderAuditReport` arg
shape, the file-local test idiom already established in `test/commands.test.ts`, and the set of pure
helpers available to re-derive the expected report. All of that is inline below — no external reads
required to implement.

### Documentation & References

```yaml
# MUST READ — these are the spec anchors the four contract cases trace to.
- url: plan/007_67d7d8c6e4c5/prd_snapshot.md (heading "h2.130" — §4 `/mulligan_audit` user-facing)
  why: "§4 step 2: output follows the caller; human → ctx.ui, NEVER event.messages. Banner-aware.
        args ignored (reserved for future `top` override). Same renderer as the agent tool."
  critical: "The human command MUST NOT bloat the model's context. This is the F-useraudit property."

- url: plan/007_67d7d8c6e4c5/prd_snapshot.md (heading "h3.69" — §2.1 F-useraudit row)
  why: "Pass criteria: both render the same report via renderAuditReport; the command's output goes to
        the human/transcript and is NOT in event.messages; the tool result still reaches the model."
  critical: "Cases (a) = 'same report', (b)+(c) = 'human sink, not event.messages', (d) = E14 disabled gate."

# PRODUCTION CODE UNDER TEST — read these to mirror exact logic.
- file: src/commands.ts
  why: "makeAuditCommand(pi) — the INPUT factory. The handler is a VERBATIM mirror of auditExecute.
        All four contract cases assert against THIS handler's observable behavior."
  pattern: "factory returning { description, handler: async (args, ctx) => Promise<void> }; handler body
            wrapped in try/catch → notify(ctx, `Mulligan: unexpected error: …`, 'warning'); NEVER throws."
  gotcha: "args is IGNORED (reserved for future `top`); pi is captured-but-UNUSED (the audit reads only
           via ctx + pure helpers). The disabled gate fires FIRST, BEFORE the !ctx.hasUI early return."

- file: src/tools/audit.ts
  why: "Exports renderAuditReport, listCheckpoints, describeMessage, messageBytes, buildCallLookup, AuditRow.
        Case (a) calls renderAuditReport directly with re-derived args and asserts the handler's notify
        string === that output."
  pattern: "renderAuditReport(args) is PURE — same inputs → same bytes. Args shape documented below."
  gotcha: "DO NOT use the module-private entriesToMessages from audit.ts; the command has its own local
           auditEntriesToMessages. For the PRIMARY (cached) path this does not matter (filtered comes
           from rt.lastFiltered). Drive the PRIMARY path to sidestep the fallback entirely."

# TEST TEMPLATES — copy these idioms exactly.
- file: test/commands.test.ts
  why: "THE FILE YOU EDIT. Already covers makeCheckpointCommand/makeCheckpointRevokeCommand/
        clearCheckpointByName with the house idiom. Append a new describe() section for the audit command.
        Reuse/extend its makePi + makeCtx fakes."
  pattern: "vitest; hand-rolled makePi()/makeCtx() (NO vi.fn for Pi objects); `.js` import paths;
            clearAll() + setConfig(undefined) in file-level beforeEach/afterEach; verbatim-string
            assertions; expectTypeOf for the {description, handler} shape. vi.mock('../src/banner.js')
            is FILE-SCOPED at the top — the audit handler does NOT call reconcileBanner, so it is inert."
  gotcha: "getRuntime() is a MODULE-SCOPED Map keyed by sessionId — a prior test's lastFiltered LEAKS
           unless clearAll() runs (it does, in beforeEach). Seed fresh in each audit test."

- file: test/tools/audit.test.ts
  why: "The sibling tool test. Contains the EXACT renderAuditReport arg shape, the fixture builders
        (userMsg/toolResult/checkpointEntry/…), the makePi no-op-spy idiom, and the report's first-lines
        format. Reuse its fixture builders by copying them into the audit section (they are not exported)."
  pattern: "makePi no-op spy: appended[]/sent[]/labels[] arrays pushed on call; assert length===0.
            Pre-seed getRuntime('s1').lastFiltered for the cached path."
  gotcha: "The COMMAND disabled-notify ('Mulligan is disabled', no prefix) differs from the TOOL's
           disabled result ('Mulligan: refused — Mulligan is disabled.'). S3 tests the COMMAND string."
```

### Current Codebase tree (the files this item touches)

```bash
test/commands.test.ts          # EDIT — append describe("/mulligan_audit", …) + extend makePi/makeCtx
src/commands.ts                # READ ONLY — makeAuditCommand lives here (landed in S1)
src/tools/audit.ts             # READ ONLY — renderAuditReport + label helpers (exported)
test/tools/audit.test.ts       # READ ONLY — idiom/fixture template
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
test/commands.test.ts          # MODIFIED — +1 describe() section (audit), +2 fake extensions
                               #   (NO new files — Mode A test-only)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: the handler reads getConfig() for the disabled gate AND for confidence/protectedRoles/
// threshold. The test must read the SAME getConfig() when re-deriving the expected report (case a).
// setConfig(undefined) → DEFAULT_CONFIG (enabled:true). setConfig({enabled:false}) for case (d).

// CRITICAL: rt.lastFiltered is MODULE-SCOPED per sessionId. clearAll() (in the file-level beforeEach)
// wipes it. Seed getRuntime("s1").lastFiltered = [...] inside EACH audit test BEFORE invoking the handler.

// CRITICAL: the PRIMARY (cached) path uses rt.lastFiltered and sets confidence = config.audit.estimateConfidence.
// The E16 FALLBACK path re-runs filterPipeline and sets confidence = "low". Drive the PRIMARY path
// (pre-seed lastFiltered) for case (a) so the re-derived confidence matches without re-running the pipeline.

// CRITICAL: totalTokens in the handler = estimateTokens(filtered).tokens — NOT computeFilteredTotal
// (whose E16 fallback deliberately omits filterPipeline and would diverge). Re-derive with estimateTokens.

// CRITICAL: rows are built as filtered.map→{tokens,msg}.sort(b-a).slice(0,8).map→AuditRow, where each
// AuditRow = { tokens, role: typeof msg.role==="string"?msg.role:"?", label: describeMessage(msg, callLookup),
//   bloaty: messageBytes(msg) > bloatThresholdFor(toolName, config), thresholdBytes }.
// toolName = typeof msg.toolName==="string" ? msg.toolName : undefined.
// The test's expected-rows builder MUST replicate this EXACTLY (same map/sort/slice/order) or the
// string-equality assertion in case (a) will fail on row ordering / label formatting.

// GOTCHA: pi is captured-but-UNUSED by the audit handler. Case (c) asserts pi.appendEntry/sendMessage
// were called 0 times — which holds trivially because the handler never calls pi at all. This is the
// INTENDED test: it proves the report is not routed through any session-writing surface.

// GOTCHA: the disabled gate fires BEFORE the !ctx.hasUI early return. So enabled:false + hasUI:true →
// the disabled notify fires (case d). enabled:true + hasUI:false → silent early return (bonus case).
// Do NOT combine disabled + hasUI:false expecting silence — the disabled notify still fires.

// GOTCHA: the file-level vi.mock("../src/banner.js") is inert for the audit handler (it never calls
// reconcileBanner). Do NOT add any reconcileBanner assertion in the audit section.

// GOTCHA: vitest's vi.mock is HOISTED and FILE-SCOPED — already present in commands.test.ts. Do NOT
// add a second one.
```

## Implementation Blueprint

### Data models and structure

No new data models. The test reuses these EXISTING exported types/values:

```typescript
// renderAuditReport arg shape (VERBATIM — the contract for the expected-report builder in case (a)):
type AuditArgs = {
  totalTokens: number;
  confidence: "low" | "medium" | "high";
  rewinds: RewindMarker[];        // from readMarkers(ctx).rewinds
  shrinks: ShrinkMarker[];        // from readMarkers(ctx).shrinks
  checkpointNames: string[];      // from listCheckpoints(ctx.sessionManager.getEntries())
  protectedRoles: string[];       // from config.rewind.protectedRoles
  rows: AuditRow[];               // re-derived (see gotcha above)
  filtered: unknown[];            // the SAME view the handler used (rt.lastFiltered)
  cancelledCount: number;         // readMarkers(ctx).cancelledIds.size
};
type AuditRow = { tokens: number; role: string; label: string; bloaty: boolean; thresholdBytes: number };
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EXTEND the file-local makePi() fake to capture appendEntry/sendMessage/setLabel (NON-BREAKING)
  - FILE: test/commands.test.ts (the existing makePi near the top)
  - IMPLEMENT: add `appendEntry(){ appended.push(true) }`, `sendMessage(){ sent.push(true) }` to the
    fake pi object; add `set()` over an object spy is NOT needed — mirror audit.test.ts's no-op-spy:
    push `true` (or the args) onto appended[]/sent[]/labels[] arrays. Return { appended, sent, labels, pi }.
  - FOLLOW pattern: test/tools/audit.test.ts makePi() no-op spy (appended/sent/labels arrays).
  - PRESERVE: existing checkpoint tests call makePi() and read only `labels` + the throwOnSetLabel opt.
    Adding appendEntry/sendMessage to the object literal and returning extra keys is NON-BREAKING
    (they destructure `{ labels, pi }` — extra keys are ignored). Keep `throwOnSetLabel` working.
  - NAMING: `appended`, `sent`, `labels` (match audit.test.ts).
  - GOTCHA: do NOT use vi.fn for the pi object (house rule — GOTCHA #3 in the file header).

Task 2: EXTEND the file-local makeCtx() fake to expose sessionManager.getSessionId + buildContextEntries (NON-BREAKING)
  - FILE: test/commands.test.ts (the existing makeCtx)
  - IMPLEMENT: add opts `sessionId?: string` (default "s1") and `contextEntries?: unknown[]` (default []);
    in the returned `sessionManager` object add `getSessionId(){ return opts.sessionId ?? "s1" }` and
    `buildContextEntries(){ if(throwOnBuildContext) throw…; return opts.contextEntries ?? [] }`.
    Keep getBranch/getEntries/getLabel/getLeafId as-is. Optionally add `throwOnGetSessionId`/`throwOnBuildContext`
    opts for the never-throws bonus (Task 6).
  - FOLLOW pattern: test/tools/audit.test.ts makeCtx (sessionId/contextEntries/branch/entries opts).
  - PRESERVE: existing checkpoint tests call only getBranch/getEntries/getLabel/getLeafId. Adding
    getSessionId/buildContextEntries to the object literal is NON-BREAKING. Keep `hasUI`, `ui`,
    `notifies`/`widgets` capture intact.
  - GOTCHA: the handler calls getSessionId() BEFORE buildContextEntries()/getBranch() (PRIMARY path
    returns early via rt.lastFiltered, so buildContextEntries is NOT called on the cached path).
    getSessionId must ALWAYS be defined (default "s1") or every audit test throws.

Task 3: ADD a shared fixture+helper block for the audit section
  - FILE: test/commands.test.ts (above the new describe("/mulligan_audit"))
  - IMPLEMENT (copy from test/tools/audit.test.ts — they are NOT exported):
      userMsg(text)            → { role: "user", content: text }
      toolResult(id,name,text) → { role: "toolResult", toolCallId: id, toolName: name,
                                    content: [{ type: "text", text }] }
  - IMPLEMENT a local expected-report builder used by cases (a) and (b):
      function buildExpectedReport(filtered, ctx): string {
        const config = getConfig();
        const totalTokens = estimateTokens(filtered).tokens;
        const callLookup = buildCallLookup(filtered);
        type TM = Parameters<typeof estimateTokens>[0];
        const rows = (filtered as any[])
          .map((m) => ({ tokens: estimateTokens([m] as unknown as TM).tokens, msg: m }))
          .sort((a, b) => b.tokens - a.tokens)
          .slice(0, 8)
          .map(({ tokens, msg }) => {
            const toolName = typeof msg.toolName === "string" ? msg.toolName : undefined;
            const rowThreshold = bloatThresholdFor(toolName, config);
            return { tokens, role: typeof msg.role === "string" ? msg.role : "?",
                     label: describeMessage(msg, callLookup),
                     bloaty: messageBytes(msg) > rowThreshold, thresholdBytes: rowThreshold };
          });
        const markers = readMarkers(ctx);
        const checkpointNames = listCheckpoints((ctx.sessionManager.getEntries() as any) ?? []);
        return renderAuditReport({ totalTokens, confidence: config.audit.estimateConfidence,
          rewinds: markers.rewinds as RewindMarker[], shrinks: markers.shrinks as ShrinkMarker[],
          checkpointNames, protectedRoles: config.rewind.protectedRoles, rows, filtered,
          cancelledCount: markers.cancelledIds.size });
      }
  - IMPORTS to add at the top of the file:
      from "../src/commands.js": add makeAuditCommand to the existing import.
      from "../src/tools/audit.js": renderAuditReport, listCheckpoints, describeMessage, messageBytes,
        buildCallLookup, type AuditRow.
      from "../src/tokens.js": estimateTokens.
      from "../src/filter.js": readMarkers.
      from "../src/nudges.js": bloatThresholdFor.
      from "../src/runtime.js": add getRuntime to the existing { clearAll } import.
      from "../src/config.js": add getConfig to the existing { setConfig } import (already imported).
      from "../src/markers.js": type RewindMarker, type ShrinkMarker (type-only).
  - FOLLOW pattern: the row-building loop MUST be byte-identical to src/commands.ts makeAuditCommand
    step 6 (same map/sort/slice/map, same guards). This is what makes case (a) pass.
  - GOTCHA: buildExpectedReport must NOT call getRuntime or seed anything — it derives ONLY from the
    `filtered` array + `ctx` it is handed (the caller seeds rt.lastFiltered separately before running
    the handler, then passes the SAME filtered to buildExpectedReport).

Task 4: ADD describe("/mulligan_audit") with the FOUR contract cases
  - FILE: test/commands.test.ts (append at the end)
  - CASE (a) — renders the same string as renderAuditReport (PRIMARY/cached path):
      const filtered = [userMsg("hello world"), toolResult("c1", "read", "big file body")];
      getRuntime("s1").lastFiltered = filtered;            // PRIMARY path seed
      const { pi } = makePi();
      const { notifies, ctx } = makeCtx({ entries: [] });  // no markers, no checkpoints
      await makeAuditCommand(pi).handler("", ctx);
      const expected = buildExpectedReport(filtered, ctx);
      expect(notifies).toHaveLength(1);
      expect(notifies[0].msg).toBe(expected);              // EXACT string equality
  - CASE (b) — report delivered to the human sink (info notify):
      (reuse the run from (a) or a fresh one)
      expect(notifies[0].type).toBe("info");
      expect(notifies[0].msg).toContain(expected);         // "contains the report" (== holds; use toContain)
  - CASE (c) — ZERO writes to event.messages-equivalent:
      const { appended, sent, pi } = makePi();
      const { ctx } = makeCtx();                           // seeded rt.lastFiltered as in (a)
      await makeAuditCommand(pi).handler("", ctx);
      expect(appended).toHaveLength(0);                    // no pi.appendEntry
      expect(sent).toHaveLength(0);                        // no pi.sendMessage
  - CASE (d) — config.enabled=false → "Mulligan is disabled":
      setConfig({ enabled: false });
      try {
        const { pi } = makePi();
        const { notifies, ctx } = makeCtx();
        await makeAuditCommand(pi).handler("", ctx);
        expect(notifies).toHaveLength(1);
        expect(notifies[0].type).toBe("warning");
        expect(notifies[0].msg).toBe("Mulligan is disabled");   // NO "Mulligan: " prefix
      } finally { setConfig(undefined); }                  // reset so disabled state doesn't leak
  - FOLLOW pattern: test/commands.test.ts checkpoint describe() blocks (verbatim-string asserts,
    try/finally reset for disabled, clearAll() in file-level beforeEach).
  - NAMING: describe("/mulligan_audit", …); it("renders the same report as renderAuditReport (cached path)", …) etc.

Task 5: ADD bonus cases mirroring the checkpoint section's thoroughness
  - CASE (e) — enabled + hasUI=false → silent early return (no notify, no throw):
      const { pi } = makePi(); const { notifies, ctx } = makeCtx({ hasUI: false });
      getRuntime("s1").lastFiltered = [userMsg("x")];
      await expect(makeAuditCommand(pi).handler("", ctx)).resolves.toBeUndefined();
      expect(notifies).toHaveLength(0);
  - CASE (f) — never throws: a throwing getSessionId → caught → "Mulligan: unexpected error: …" warning, no throw:
      makeCtx({ throwOnGetSessionId: true }) + valid seed →
      await expect(run).resolves.toBeUndefined();
      expect(notifies[0].type).toBe("warning");
      expect(notifies[0].msg).toContain("Mulligan: unexpected error:");
  - CASE (g) — args IGNORED (future `top` override): pass "20" → runs normally, report still emitted
      (same as case (a) but handler("20", ctx); assert a notify was produced and it === expected).
  - CASE (h) — types (mirror the existing expectTypeOf block):
      const cmd = makeAuditCommand(makePi().pi);
      expectTypeOf(cmd.description).toEqualTypeOf<string>();
      expectTypeOf(cmd.handler).parameters.toEqualTypeOf<[string, ExtensionCommandContext]>();
      expectTypeOf(cmd.handler).returns.toEqualTypeOf<Promise<void>>();
  - FOLLOW pattern: the never-throws + hasUI-guard + types blocks already in commands.test.ts.

Task 6: VERIFY — run the targeted file, then the full suite, then typecheck
  - RUN: npx vitest run test/commands.test.ts   (expect: all green — 14 existing + new)
  - RUN: npm test                                (vitest run — full suite; expect green, no regressions)
  - RUN: npm run typecheck                       (tsc --noEmit; expect clean — no `any` leaks beyond the
    documented casts that mirror the production handler)
```

### Implementation Patterns & Key Details

```typescript
// The testable seam — call the factory's handler directly (no real Pi), exactly like the checkpoint tests:
async function runAudit(pi: ExtensionAPI, ctx: ExtensionCommandContext, args = "") {
  await makeAuditCommand(pi).handler(args, ctx);
}

// Seeding the PRIMARY (cached) path — getRuntime is a module-scoped Map; clearAll() wipes it each test:
beforeEach(() => { clearAll(); setConfig(undefined); });   // already present at file scope (reuse it)
// inside each test:
getRuntime("s1").lastFiltered = [userMsg("hello world"), toolResult("c1", "read", "…")];

// Case (a) parity assertion — the heart of the test. expected is re-derived from the SAME filtered+ctx
// the handler consumed, so if the handler diverges from renderAuditReport this fails loudly:
const expected = buildExpectedReport(filtered, ctx);   // pure: estimateTokens + readMarkers + listCheckpoints + renderAuditReport
await runAudit(pi, ctx);
expect(notifies[0].msg).toBe(expected);                // EXACT string equality (case a)
expect(notifies[0].type).toBe("info");                 // (case b)
expect(notifies[0].msg).toContain(expected);           // (case b alt)

// Case (c) — the F-useraudit invariant: the report must NOT enter event.messages.
// The handler never calls pi at all, so both spy arrays stay empty. Asserting length===0 proves it.
expect(appended).toHaveLength(0);
expect(sent).toHaveLength(0);

// Case (d) — disabled gate fires FIRST (before !ctx.hasUI). Contract-literal, NO "Mulligan: " prefix.
setConfig({ enabled: false });
try {
  await runAudit(pi, ctx);
  expect(notifies[0].msg).toBe("Mulligan is disabled");
  expect(notifies[0].type).toBe("warning");
} finally { setConfig(undefined); }
```

### Integration Points

```yaml
TEST FILE:
  - add to: test/commands.test.ts (append a new describe() section; extend the existing makePi/makeCtx)
  - pattern: "mirror test/tools/audit.test.ts makePi no-op-spy + the commands.test.ts checkpoint idiom"

IMPORTS (top of test/commands.test.ts):
  - extend "../src/commands.js"  : + makeAuditCommand
  - extend "../src/runtime.js"   : + getRuntime            (for seeding rt.lastFiltered)
  - extend "../src/config.js"    : + getConfig             (already imports setConfig)
  - new   "../src/tools/audit.js": renderAuditReport, listCheckpoints, describeMessage, messageBytes,
                                   buildCallLookup, type AuditRow
  - new   "../src/tokens.js"     : estimateTokens
  - new   "../src/filter.js"     : readMarkers
  - new   "../src/nudges.js"     : bloatThresholdFor
  - new   "../src/markers.js"    : type RewindMarker, type ShrinkMarker   (type-only, for the cast)

CONFIG:
  - none (test-only; setConfig({enabled:false}) / setConfig(undefined) controls the gate in-process)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Typecheck the whole project (the test file imports flow through tsc).
npm run typecheck          # tsc --noEmit — expect: zero errors.
# If type errors appear in the new section, they are almost certainly:
#   (1) a missing cast mirroring src/commands.ts (use the same `as unknown as TM` / `as RewindMarker[]`
#       casts the production handler uses), or (2) an import typo (must use `.js` extensions).
```

### Level 2: Unit Tests (Component Validation)

```bash
# Targeted: the file under test.
npx vitest run test/commands.test.ts -v
# Expected: ALL green — the 14 existing checkpoint it()s UNCHANGED + the new audit it()s pass.
# If an existing checkpoint test breaks, you changed makePi/makeCtx in a breaking way — revert and
# re-extend NON-BREAKINGLY (add methods/keys, never remove or rename existing ones).

# Full suite (regression net — the audit section must not leak module-scoped state).
npm test                   # = vitest run
# Expected: full suite green. clearAll() in beforeEach prevents rt.lastFiltered leakage.
```

### Level 3: Integration Testing (System Validation)

```bash
# Not applicable — this is a pure unit-test work item (Mode A). There is no server, no DB, no network.
# The integration smoke harness (test/integration/smoke.ts, F-useraudit scenario) is owned by a SEPARATE
# work item; do NOT add to it here.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# None for Mode A test-only. The four contract cases (a)–(d) ARE the domain validation.
# (The real F-useraudit human-vs-agent sink divergence is exercised by the smoke harness, not here.)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run typecheck` clean (no `any` beyond the documented casts; `.js` imports resolve).
- [ ] `npx vitest run test/commands.test.ts -v` — all green (existing checkpoint tests UNMODIFIED + new).
- [ ] `npm test` — full suite green, no module-scoped state leakage.

### Feature Validation (the four contract cases)

- [ ] (a) `expect(notifies[0].msg).toBe(buildExpectedReport(filtered, ctx))` passes — exact string equality.
- [ ] (b) `notifies[0].type === "info"` and `notifies[0].msg` contains the report; exactly one notify.
- [ ] (c) `appended.length === 0` AND `sent.length === 0` after a successful run (F-useraudit invariant).
- [ ] (d) `setConfig({ enabled: false })` → one notify, `"Mulligan is disabled"`, type `"warning"`.
- [ ] Bonuses present: hasUI=false silent return; never-throws (throwing getSessionId); args ignored; types.

### Code Quality Validation

- [ ] New code follows the EXISTING commands.test.ts idiom (hand-rolled fakes, no `vi.fn` for Pi,
      `.js` imports, verbatim-string asserts, try/finally disabled reset).
- [ ] makePi/makeCtx extensions are NON-BREAKING (existing checkpoint tests untouched and green).
- [ ] buildExpectedReport's row loop is byte-identical to src/commands.ts makeAuditCommand step 6.
- [ ] No production code modified; no docs added (Mode A).

---

## Anti-Patterns to Avoid

- ❌ Don't add a second `vi.mock("../src/banner.js")` — it's already file-scoped at the top (inert for audit).
- ❌ Don't assert on `reconcileBanner` in the audit section — the handler never calls it.
- ❌ Don't use `vi.fn` for the `pi` object — the file's GOTCHA #3 forbids it; use plain push-onto-array spies.
- ❌ Don't re-seed `rt.lastFiltered` AFTER running the handler (the handler reads it at call time; seed before).
- ❌ Don't drive case (a) through the E16 FALLBACK path (re-runs filterPipeline, confidence "low") unless you
  also replicate that — prefer the cached PRIMARY path so `confidence = config.audit.estimateConfidence`.
- ❌ Don't assert `notifies[0].msg === "Mulligan is disabled"` WITHOUT the disabled gate — that string only
  appears when `config.enabled === false` (enabled runs the full pipeline → a long multi-line report).
- ❌ Don't modify `src/commands.ts`, `src/tools/audit.ts`, or any production file — this is Mode A test-only.
- ❌ Don't add tests to `test/tools/audit.test.ts` — the COMMAND lives in `src/commands.ts`; test it in
  `test/commands.test.ts` alongside its sibling checkpoint-command tests.

---

## Confidence Score

**9 / 10** — one-pass success likelihood.

Rationale: the handler under test is already landed and fully specified; the file being edited already
contains the exact idiom (checkpoint commands) to mirror; `renderAuditReport` and all re-derivation
helpers are exported and pure; and the four contract cases are unambiguous. The only residual risk is
the row-building loop in `buildExpectedReport` drifting from the production handler's step 6 — which is
precisely what case (a) catches, so a drift surfaces as a clear test failure with an actionable diff.
The `-1` accounts for the small chance the implementer accidentally makes a breaking change to the
shared `makePi`/`makeCtx` fakes; the validation loop's "existing checkpoint tests must stay green" gate
catches that immediately.