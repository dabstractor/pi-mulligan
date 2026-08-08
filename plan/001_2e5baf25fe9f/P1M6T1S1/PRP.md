# PRP — P1.M6.T1.S1: `tool_result` bloat annotator + bloat hit recording

**Work item:** P1.M6.T1.S1 · **Points:** 1 · **Stage:** Preventive Nudges (spec/11 §2 Step 7 — `nudges.ts`,
Nudge A; spec/03 §189; spec/07-preventive-and-nudges.md §1).
**Scope:** **CREATE two new files** — `src/nudges.ts` (the `tool_result` handler + `registerBloatReminder`)
and `test/nudges.test.ts` (handler / registration / fail-open / bloat-hit recording). **No other file is
touched.** This is **Nudge A** (one of Mulligan's two "ride-along" nudges): it appends a short reminder to a
bloated tool result's own content and records a bloat hit for the per-turn drift nudge (Nudge B,
P1.M6.T2) — **zero extra model requests** (design principle D3/D4).

> **PREREQUISITE (verified live during research):** every symbol this task imports is ALREADY SHIPPED.
> `resultBytes` + `approxTokens` (src/tokens.ts — P1.M2.T1.S2 ✅), `renderBloatReminder` (src/notes.ts —
> P1.M2.T3.S3 ✅), `getRuntime` + `BloatHit` + `SessionRuntime.pendingBloatHits` (src/runtime.ts —
> P1.M1.T4.S1 ✅), `getConfig` (src/config.ts — P1.M1.T2 ✅), `log` (src/log.ts — P1.M1.T3 ✅). **No
> dependency on filter.ts (P1.M4.T2.S1) or any P1.M5 tool** — `nudges.ts` is a fresh module.

> **Parallel execution note:** P1.M5.T4.S1 (`src/tools/audit.ts`) is being implemented concurrently. It
> creates a DIFFERENT file (`src/tools/audit.ts`); this task creates `src/nudges.ts`. **Zero file overlap,
> zero interface conflict.** Neither consumes the other. (Both are ultimately wired into `index.ts` by
> P1.M7.T1.S1, which is sequenced after both.)

---

## Goal

**Feature Goal**: Ship Mulligan's **`tool_result` event handler** — the first of two preventive nudges. It
fires after every tool execution; if a single result's in-context byte size exceeds the configured
`bloatThresholdBytes` (default 8192), the handler **appends** (never replaces) a short reminder to that
result's content telling the agent `mulligan_shrink`/`mulligan_rewind` are available, AND records a bloat
hit (`{toolName, approxTokens}`) into `rt.pendingBloatHits` so the per-turn drift nudge (P1.M6.T2.S1) can
aggregate it. It skips Mulligan's own `mulligan_*` tools. The ENTIRE body is wrapped in try/catch — on ANY
exception it logs and returns nothing (pass-through), so an extension bug can NEVER break a tool result.

**Deliverable** (CREATE two new files):
1. **`src/nudges.ts`** — exports:
   - `export function bloatReminderHandler(event: ToolResultEvent, ctx: ExtensionContext): ToolResultEventResult | void`
     — the handler logic (steps 1–7 below), wrapped in ONE try/catch (fail-open). Exported (named) so the
     test suite can call it directly with fakes (no Pi runtime needed).
   - `export function registerBloatReminder(pi: ExtensionAPI): void` — `pi.on("tool_result", bloatReminderHandler)`.
     Consumed by `index.ts` (P1.M7.T1.S1). This CREATES the `nudges.ts` module; P1.M6.T2.S1 (turn_end
     handler) and P1.M6.T2.S2 (shouldNudge/injectNudge) APPEND to it later.
2. **`test/nudges.test.ts`** — hand-rolled fakes (`makePi` capturing `.on(eventName, handler)`; `makeCtx`
   with `getSessionId`), with describe blocks for: registration; config gates (disabled master switch;
   disabled `nudges.bloatReminder`); mulligan_* skip; under-threshold no-op; over-threshold append +
   bloat-hit record; reminder is appended (not replaced); multi-result accumulation in
   `pendingBloatHits`; fail-open on every throwing dependency.

**Success Definition** (all must hold):
- `npx tsc --noEmit -p tsconfig.json` exits **0** (nudges.ts compiles under `strict`; the handler matches
  the VERIFIED `ExtensionHandler<ToolResultEvent, ToolResultEventResult>` overload; the appended text block
  type-checks via the indexed-access type — see GOTCHA #2).
- `npx vitest run test/nudges.test.ts` → all nudges tests pass.
- `npx vitest run` → **all-green, no regression** (nudges.ts adds 2 new files; it touches nothing else).
- **`registerBloatReminder` calls `pi.on("tool_result", bloatReminderHandler)` exactly once.**
- **A result over threshold**: handler returns `{content: [...original, {type:"text", text:<reminder>}]}`;
  the ORIGINAL content blocks are PRESERVED (appended, not replaced); the reminder text equals
  `renderBloatReminder(toolName, bytes, threshold)` EXACTLY (reuse, not reimplementation); and a
  `{toolName, approxTokens: approxTokens(bytes)}` entry is pushed into `rt.pendingBloatHits`.
- **A result under threshold**: handler returns `undefined` (pass-through); `rt.pendingBloatHits` is
  UNCHANGED; NOTHING is appended.
- **`config.enabled === false` OR `config.nudges.bloatReminder === false`**: handler returns `undefined`,
  appends nothing, records no hit (both gates short-circuit BEFORE any measurement).
- **`toolName.startsWith("mulligan_")`**: handler returns `undefined`, appends nothing, records no hit.
- **Fail-open**: a throwing `getConfig` / `resultBytes` / `getRuntime` / `getSessionId` /
  `renderBloatReminder` is caught → `log("error", "nudge.bloat", sessionId, {error})` → returns
  `undefined` (the tool result is delivered UNCHANGED). The agent turn is never broken (spec/03 #4,
  spec/08 E13).

---

## User Persona

**Target User**: Two consumers. (1) **`index.ts` (P1.M7.T1.S1)** — the extension factory calls
`registerBloatReminder(pi)` once at startup to arm the nudge. (2) **The model/agent loop itself** — the
`tool_result` event fires after EVERY tool execution (verified: api_verification.md §7.2). The reminder is
agent-facing text (no human UI); its content is produced by `renderBloatReminder` (P1.M2.T3.S3). Secondary
consumer: **Nudge B (P1.M6.T2.S1)** reads the `rt.pendingBloatHits` array this handler populates.

**Use Case**: The agent runs `read src/huge-log.log` and gets a 30 KB dump in context. Pi's built-in 50 KB
cap doesn't truncate it (it's under the cap), so the bloat slips through silently. The `tool_result`
handler fires: `resultBytes(content)` = 30720 > 8192 (threshold), so the handler **appends** a one-block
reminder ("This result is ~30 KB … call `mulligan_shrink` …") to the result and records
`{toolName:"read", approxTokens:7680}` into `rt.pendingBloatHits`. The agent sees the hint co-located with
the data and decides, with full information, whether to shrink. **Zero extra requests** — the reminder
rides the result that was already being delivered.

**User Journey**:
1. `index.ts` factory: `registerBloatReminder(pi)` → `pi.on("tool_result", bloatReminderHandler)` arms it.
2. Agent loop → a tool finishes → Pi fires `tool_result` with `{type, toolCallId, input, content, isError}`.
3. `bloatReminderHandler(event, ctx)`: `getSessionId()` (fresh) → `getConfig()` → (disabled? pass-through)
   → skip `mulligan_*` → `bytes = resultBytes(content)` → (under threshold? pass-through) →
   `reminder = renderBloatReminder(...)` → append block → push bloat hit → `return {content}`.
4. Pi delivers the result with the appended reminder. The agent reads it; if it shrinks, the shrink marker
   substitutes the whole result (reminder included) on the next turn — the reminder cleans itself up.

**Pain Points Addressed**: (a) Silent context bloat from individually-legal results (a 30 KB `read` is under
Pi's 50 KB cap but still ~8k tokens). (b) The agent has no cheap, in-band signal that a result is large
*relative to the rewind/shrink tools that exist to fix it*. This nudge is that signal — co-located with the
offending output, advisory (D3), and free (rides the result, D4).

---

## Why

- **This is the project's signature "free ride" nudge (spec/03 design principle #3 zero extra requests;
  spec/07 §1).** The whole thesis of Mulligan is that the agent can rewind/shrink, but the agent must
  NOTICE it should. A per-result nudge that costs a model call would be self-defeating (the bloat it warns
  about is cheaper than the warning). The `tool_result` event already fires; attaching the measurement +
  reminder to it is genuinely free. Shipping it proves the thesis end-to-end.
- **Advisory, not auto-shrink (D3; spec/07 §1).** Auto-shrinking would risk discarding data the model
  needs RIGHT NOW (e.g. a large test output it is actively diagnosing). The reminder is APPENDED (never
  replaces) so the model keeps the full output this turn and decides about future turns with full
  information. `config.shrink.autoOnBloat` is explicitly out of v1.
- **Feeds Nudge B (P1.M6.T2).** The bloat hits recorded here (`rt.pendingBloatHits`) are the bloat half of
  the per-turn drift metric. Without this handler, Nudge B's "produced N bloated result(s)" clause could
  never fire. The two nudges are decoupled (different events) but share this accumulator.
- **Fail-open is a hard product guarantee (spec/03 #4, spec/08 E13).** The handler sits on the tool-result
  path — it fires after EVERY tool. A throw here could corrupt or block a tool result, which is
  catastrophic. The entire body is one try/catch → log + return nothing (pass-through). Mirrors markers.ts,
  filter.ts, and log.ts discipline.
- **Threshold is deliberately below Pi's cap (spec/07 §1 calibration).** `bloatThresholdBytes = 8192`
  (8 KB ≈ 2k tokens) catches meaningful-but-not-catastrophic results (a 30 KB `read`) that slip under
  Pi's ~50 KB built-in truncation. Configurable up for log-analysis workflows.

---

## What

CREATE `src/nudges.ts` and `test/nudges.test.ts`. Behavior of `bloatReminderHandler(event, ctx)` (ONE
try/catch over the whole body):

1. `const sessionId = ctx.sessionManager.getSessionId();` — read FRESH, FIRST (so the catch can log it).
   (Spec/02 C12: read sessionManager fresh; never cache the handle.)
2. `const config = getConfig();` `if (!config.enabled || !config.nudges.bloatReminder) return;` — both
   gates short-circuit BEFORE any measurement or recording. (`getConfig()` never throws — returns defaults.)
3. `if (event.toolName.startsWith("mulligan_")) return;` — skip Mulligan's own tools (their results are
   small control messages; annotating them would be noise). `event.toolName` is ALWAYS a string on the
   `ToolResultEvent` union (GOTCHA #3).
4. `const bytes = resultBytes(event.content);` `if (bytes < config.nudges.bloatThresholdBytes) return;` —
   under threshold → pass-through (no append, no hit). `resultBytes` is UTF-8-multibyte-aware and never
   throws.
5. `const reminder = renderBloatReminder(event.toolName, bytes, config.nudges.bloatThresholdBytes);` — the
   reminder text (reuse the COMPLETE pure helper; do NOT reimplement).
6. `const block: ToolResultEvent["content"][number] = { type: "text", text: reminder };` — typed via the
   indexed-access type so the unexported `TextContent` need not be named (GOTCHA #2).
   `const content = [...event.content, block];` — APPEND (original blocks preserved; the spread of
   `event.content`, already `(TextContent|ImageContent)[]`, plus the typed block yields the same array type
   → `return {content}` type-checks with NO boundary cast).
7. `const rt = getRuntime(sessionId); rt.pendingBloatHits.push({ toolName: event.toolName, approxTokens: approxTokens(bytes) });`
   — record the bloat hit for the turn metric. Inline push (runtime.ts docs: callers mutate fields in
   place; `recordBloatHit` in spec/07 §1 pseudocode is NOT a real helper — GOTCHA #4).
8. `return { content };` — Pi appends the reminder to the delivered result.
9. `catch (e)`: `log("error", "nudge.bloat", sessionId, { error: String(e) });` then fall through (return
   nothing = pass-through). `log()` takes `sessionId: string`, NOT `ctx` (GOTCHA #1).

`registerBloatReminder(pi)`: `pi.on("tool_result", bloatReminderHandler);` (one line).

This subtask does **NOT**: implement the `turn_end` metric handler (P1.M6.T2.S1); implement
`shouldNudge`/`injectNudge` (P1.M6.T2.S2 — filter.ts currently holds LOCAL no-op stubs; this task does not
touch them); wire anything into `index.ts` (P1.M7.T1.S1); mutate `event.content` in place (return a NEW
array reference); replace the result's content (always append); persist anything (no `appendEntry` — the
bloat hit is in-memory only, snapshotted into the TurnMetric later by P1.M6.T2.S1); or touch any existing
file.

### Success Criteria

- [ ] `src/nudges.ts` EXISTS and EXPORTS `bloatReminderHandler` + `registerBloatReminder`.
- [ ] `test/nudges.test.ts` EXISTS and is all-green; `npx vitest run` is all-green (no regression).
- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0.
- [ ] **`registerBloatReminder` calls `pi.on("tool_result", bloatReminderHandler)` exactly once.**
- [ ] **Over-threshold result**: returns `{content:[...original, {type:"text",text:<reminder>}]}`;
      original blocks PRESERVED; reminder === `renderBloatReminder(toolName,bytes,threshold)`;
      `rt.pendingBloatHits` gained `{toolName, approxTokens: approxTokens(bytes)}`.
- [ ] **Under-threshold result**: returns `undefined`; nothing appended; `pendingBloatHits` unchanged.
- [ ] **`!config.enabled`**: returns `undefined`, no append, no hit.
- [ ] **`!config.nudges.bloatReminder`**: returns `undefined`, no append, no hit.
- [ ] **`mulligan_*` toolName**: returns `undefined`, no append, no hit.
- [ ] **Multi-result turn**: a second over-threshold result appends a second hit (pendingBloatHits
      accumulates across the turn — it is cleared only at turn_end by P1.M6.T2.S1, NOT here).
- [ ] **Never throws**: a thrown `getConfig`/`resultBytes`/`getRuntime`/`getSessionId`/`renderBloatReminder`
      is caught, logged via `log("error","nudge.bloat",sessionId,{error:String(e)})`, and returns
      `undefined`. `log` is called with `sessionId` (a string), NOT `ctx`.

---

## All Needed Context

### Context Completeness Check

> _"If someone knew nothing about this codebase, would they have everything needed to implement this
> successfully?"_ — **Yes.** The exact code for `src/nudges.ts` is given verbatim in the Implementation
> Blueprint (Task 1), and the exact fakes + describe blocks for `test/nudges.test.ts` are given verbatim
> (Task 2). Every Pi signature (`on("tool_result")` overload, `ToolResultEvent`, `ToolResultEventResult`,
> `ExtensionHandler`, `ExtensionAPI`, `ExtensionContext`) is quoted from the **verified installed `.d.ts`**
> (research/verified_signatures_and_gotchas.md §1). The two critical gotchas — `TextContent`/`ImageContent`
> are NOT exported (use indexed-access type) and `log()` takes `sessionId` not `ctx` — are called out with
> the exact workaround. Every upstream helper signature is pinned with its file + line. No prior knowledge
> beyond "create the tool_result handler as thin Pi glue over the COMPLETE pure helpers" is required.

### Scope decision (READ BEFORE CODING)

- **CREATE `src/nudges.ts` (NEW file) — it does NOT exist.** (Confirmed: `ls src/` shows index/config/
  log/runtime/tokens/ledger/notes/transforms/markers/filter — no nudges.ts. NOTE: filter.ts now EXISTS
  per the updated plan_status — P1.M4.T2.S1 is Complete — but this task does NOT import from it.) Two new
  files only; APPEND nothing to existing files.
- **ALL upstream deps are SHIPPED (verified).** `grep -n "export function resultBytes\|export function
  approxTokens" src/tokens.ts`, `grep -n "export function renderBloatReminder" src/notes.ts`,
  `grep -n "export function getRuntime\|export interface BloatHit\|pendingBloatHits" src/runtime.ts`,
  `grep -n "export function getConfig" src/config.ts`, `grep -n "export function log" src/log.ts` —
  every one MUST print a match. If any is absent, STOP (a prerequisite regressed).
- **`log()` takes `sessionId: string`, NOT `ctx`** (verified: src/log.ts). The handler reads sessionId
  FIRST (right after the try{) so the catch can log it. Do NOT copy the spec/07 §1
  `log("error","nudge.bloat",ctx,{...})` pseudocode verbatim — it will NOT type-check (ctx is not a string).
- **`TextContent`/`ImageContent` are NOT exported** from `@earendil-works/pi-coding-agent` (verified; the
  defining package `@earendil-works/pi-ai` is not resolvable). Use the indexed-access type
  `ToolResultEvent["content"][number]` for the appended block (GOTCHA #2). Do NOT write
  `import type { TextContent } from "@earendil-works/pi-coding-agent"` — it will not resolve.
- **`event.toolName` is ALWAYS a string** on the `ToolResultEvent` union (every variant — Bash/Read/…/Custom
  — has `toolName`; Custom's is `string`). Use `event.toolName.startsWith("mulligan_")` directly (the
  spec's `?.` optional-chaining is overly defensive; harmless to keep but not required).
- **`recordBloatHit` is PSEUDOCODE** (spec/07 §1). There is no such helper and none is planned. "Record a
  bloat hit" = inline `rt.pendingBloatHits.push({toolName, approxTokens: approxTokens(bytes)})`. Only this
  task WRITES pendingBloatHits; P1.M6.T2.S1 only READS + clears it (GOTCHA #4).
- **Handler may be SYNC.** `ExtensionHandler<E,R> = (event,ctx) => Promise<R|void> | R | void` permits a
  plain `R | void` return. There are zero `await`s here → a sync function is cleaner fail-open (no
  unhandled-rejection path) and type-checks identically. The spec/07 §1 pseudocode shows `async`; either is
  valid. This PRP specifies SYNC.
- **There is NO lint/format tool** (devDeps = typescript + vitest + @types/node only). The type+style gate
  is `tsc --noEmit` (TS strict IS the gate). Do NOT invent eslint/prettier/biome — "command not found".

### Documentation & References

```yaml
# MUST READ — the authoritative nudge contract (mechanism, threshold calibration, advisory-vs-autoshrink)
- file: spec/07-preventive-and-nudges.md
  section: "§1 Nudge A — bloated-result reminder (tool_result event): the mechanism pseudocode,
            renderBloatReminder format, threshold default & calibration, interaction with shrink/rewind,
            why-advisory (D3)"
  why: "§1 IS this task. The handler logic (config check → skip mulligan_* → resultBytes → threshold →
        renderBloatReminder → append → recordBloatHit → return {content}) is the verbatim 7-step plan.
        §1 'Threshold default & calibration' pins bloatThresholdBytes=8192 and WHY (below Pi's 50KB cap)."
  critical: "§1 pseudocode passes `ctx` to log() — WRONG for our codebase (log takes sessionId — GOTCHA #1).
            §1 calls `recordBloatHit(ctx,...)` — that helper does NOT exist; it is pseudocode for an inline
            pendingBloatHits.push (GOTCHA #4). §1 uses `event.content ?? []` defensively — keep that form
            even though content is typed non-optional. Follow the verified signatures, not the pseudocode."

# MUST READ — the verified Pi event contract
- file: plan/001_2e5baf25fe9f/architecture/api_verification.md
  section: "§7.2 tool_result Event (ToolResultEventBase / ToolResultEventResult / 'can modify result' +
            the explicit 'The bloat-reminder nudge returns {content:[...existing,{type:text,text:reminder}]}')
            + §9 (C4 void=pass-through, C12 read sessionManager fresh)"
  why: "§7.2 is THE verified .d.ts source for this event. Confirms: handler returns ToolResultEventResult |
        void; returning {content} APPENDS-modifies the result; returning void passes it through unchanged.
        Confirms content is (TextContent|ImageContent)[] and the bloat nudge's exact return shape."
  critical: "api_verification §7.2 names TextContent|ImageContent but does NOT say they are re-exported.
            They are NOT importable (GOTCHA #2). Use ToolResultEvent['content'][number]."

# MUST READ — design principles this nudge embodies
- file: spec/03-architecture.md
  section: "§3 design principle #3 (zero extra requests), #4 (fail open), §2.4 (fail open — every handler
            wrapped so an exception becomes a logged no-op), §7 module list (nudges.ts =
            tool_result annotator + turn_end metric + context nudge injection)"
  why: "#3 is WHY the nudge rides the result (not a new request). #4/§2.4 is the fail-open mandate: the
        WHOLE handler body is ONE try/catch. §7 confirms nudges.ts is the canonical module name."

# MUST READ — the fail-open edge case + the drift-nudge consumer of pendingBloatHits
- file: spec/08-edge-cases.md
  section: "E13 (fail-open: handler never throws)"
  why: "E13 is the explicit fail-open edge case this handler must satisfy."
- file: spec/07-preventive-and-nudges.md
  section: "§2 Nudge B (turn_end reads rt.pendingBloatHits, snapshots into TurnMetric, CLEARS it)"
  why: "Defines the DOWNSTREAM consumer of the bloat hits this task records. Confirms pendingBloatHits is
        accumulator semantics (push here, read+clear at turn_end) — so this task pushes but does NOT clear."

# THE COMPLETE helpers this handler consumes (all shipped — treat as contracts)
- file: src/tokens.ts
  section: "resultBytes(content: ResultContentBlock[] | null | undefined): number  (UTF-8 byte length,
            multibyte-aware, never throws); approxTokens(bytes: number): number  (Math.ceil(bytes/4);
            8192→2048). ResultContentBlock has [key:string]:unknown → event.content assigns in with no cast."
  why: "resultBytes measures the result; approxTokens converts bytes→tokens for the recorded hit. Both
        NEVER throw (defensive) — but the outer try/catch is still the hard guarantee."

- file: src/notes.ts
  section: "renderBloatReminder(_toolName: string, bytes: number, thresholdBytes: number): string  (returns
            '\\n---\\n' + 4-line body; ~40 tokens; NEVER throws)"
  why: "Produces the reminder text. REUSE it — do NOT reimplement the format. The first arg (_toolName) is
        accepted-but-unused in v1 (reserved for future personalization); pass event.toolName anyway."

- file: src/runtime.ts
  section: "getRuntime(sessionId: string): SessionRuntime (MUTABLE ref; same id → same live object);
            BloatHit = { toolName: string; approxTokens: number }; SessionRuntime.pendingBloatHits: BloatHit[]"
  why: "The bloat-hit accumulator. Push inline: rt.pendingBloatHits.push({toolName, approxTokens}). The map
        is MODULE-SCOPED → tests MUST clearAll() before/after (GOTCHA #5)."

- file: src/config.ts
  section: "getConfig(): MulliganConfig (defensive clone each call; NEVER throws); MulliganConfig.enabled,
            .nudges.bloatReminder (default true), .nudges.bloatThresholdBytes (default 8192)"
  why: "The two gates (master switch + nudge switch) and the threshold. Read config AFTER sessionId."

- file: src/log.ts
  section: "log(level, event, sessionId, data?) — VERIFIED third arg is sessionId: string (NOT ctx);
            never throws"
  why: "The fail-open catch logs via log('error','nudge.bloat',sessionId,{error:String(e)})."

# PROOF PATTERN — a working (UNtypechecked) tool_result handler that appends content
- file: spec/reference/looper-smoke.proto.ts
  section: "lines 122-135: pi.on('tool_result', async (event,_ctx) => { ... return { content: [{type:'text'
            as const, text: shrunk}] }; })  (the shrink_result proof)"
  why: "PROVES the primitive this handler productionizes: a tool_result handler can return {content:[...]}
        to modify the delivered result; returning nothing passes it through. Note it REPLACES content
        (shrink proof) — THIS task APPENDS instead (keep the original blocks). Also note `{type:'text' as
        const}` — our indexed-access-type approach (GOTCHA #2) makes the `as const` unnecessary."
  gotcha: "looper-smoke.proto.ts is EXCLUDED from tsconfig → its loose typing 'works'. YOUR file in src/ IS
           strict-typechecked → you MUST handle the unexported TextContent via the indexed-access type."

# SIBLING PRP — the closest pi.on() handler analog (fail-open structure, log(sessionId), registration test)
- file: plan/001_2e5baf25fe9f/P1M4T2S1/PRP.md
  section: "contextHandler structure (ONE try/catch; read sessionId first; log('error',...,sessionId,...)
            in catch; return undefined on fail), registerFilterHandler(pi) = pi.on('context',...), the
            makePi/makeCtx fake idiom"
  why: "filter.ts is the established pattern for a fail-open pi.on() handler + its unit test. Mirror its
        structure and its hand-rolled-fake test idiom. (filter.ts is COMPLETE per plan_status.)"

# DOWNSTREAM CONSUMER
- file: plan/001_2e5baf25fe9f/P1M5T4S1/PRP.md   (parallel item; mulligan_audit)
  section: "creates src/tools/audit.ts (DIFFERENT file from src/nudges.ts)"
  why: "Confirms zero file/interface conflict with this task. Neither consumes the other; both are wired
        into index.ts later by P1.M7.T1.S1."
```

### Current Codebase tree (state at this subtask's start — VERIFIED LIVE)

```bash
pi-mulligan/
├── package.json            # type:'module'; deps @earendil-works/pi-coding-agent *, typebox *; devDeps
│                           #   typescript ^5, vitest ^1, @types/node ^22; scripts.test:'vitest run'.
├── tsconfig.json           # strict, noImplicitAny, types:['node'], moduleResolution:'Bundler',
│                           #   include:['src','test'], target ES2022. exit 0 VERIFIED.
├── src/
│   ├── index.ts            # no-op stub (registerBloatReminder wired in P1.M7.T1). DO NOT TOUCH.
│   ├── config.ts           # getConfig, MulliganConfig (enabled/nudges.bloatReminder/bloatThresholdBytes). DO NOT TOUCH.
│   ├── log.ts              # log(level,event,sessionId,data?) — VERIFIED sessionId arg. DO NOT TOUCH.
│   ├── runtime.ts          # getRuntime, BloatHit, SessionRuntime.pendingBloatHits. DO NOT TOUCH.
│   ├── tokens.ts           # resultBytes + approxTokens (COMPLETE). DO NOT TOUCH.
│   ├── ledger.ts / notes.ts# renderBloatReminder lives in notes.ts (COMPLETE). DO NOT TOUCH.
│   ├── transforms.ts       # pure filter core. DO NOT TOUCH.
│   ├── markers.ts          # append*/leaveNote/setCheckpoint wrappers. DO NOT TOUCH.
│   └── filter.ts           # context handler (COMPLETE); has LOCAL shouldNudge/injectNudge stubs. DO NOT TOUCH.
├── test/
│   ├── *.test.ts (9 files) # config/ledger/log/markers/notes/runtime/tokens/transforms + tools/checkpoint. Read-only.
│   ├── tools/              # tool tests subdir. nudges.test.ts goes at test/ ROOT (mirrors markers.test.ts).
│   └── integration/        # scenarios.md (smoke). NOT this task.
└── spec/                   # 03 §2.4/§3/§7 + 07 §1/§2 + 08 E13 + 11 §2 Step7.
# VERIFIED BASELINE: `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx vitest run` → 9 files all-green.
# NOTE: NO eslint/prettier/biome. The type+style gate is `tsc --noEmit` (TS strict).
# NOTE: test imports use "../src/<name>.js" (.js resolves to .ts under Bundler) — established convention.
# NOTE: the hand-rolled-fake (no vi.fn for Pi objects) convention comes from test/markers.test.ts.
```

### Desired Codebase tree with files to be CREATED (THIS subtask — 2 new files only)

```bash
pi-mulligan/
├── src/
│   └── nudges.ts           # NEW: bloatReminderHandler (tool_result handler, fail-open) +
│                           #   registerBloatReminder(pi) = pi.on("tool_result", bloatReminderHandler).
│                           #   Imports: ToolResultEvent/ToolResultEventResult/ExtensionAPI/ExtensionContext
│                           #   (type) from pi package; getConfig + MulliganConfig(type) from config.js;
│                           #   getRuntime from runtime.js; log from log.js; resultBytes+approxTokens from
│                           #   tokens.js; renderBloatReminder from notes.js. (NO import from filter.js.)
└── test/
    └── nudges.test.ts      # NEW: hand-rolled makePi (captures .on) + makeCtx (getSessionId) + makeEvent
                            # (synthetic ToolResultEvent); clearAll() before/after; describe blocks for
                            # registration, config gates, mulligan_* skip, under/over threshold, append-
                            # not-replace, multi-result accumulation, fail-open on each throwing dep.
# No other files touched. No APPENDs to existing files. (P1.M6.T2.S1 + S2 APPEND to nudges.ts LATER.)
```

### Known Gotchas of our codebase & Library Quirks

```bash
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #1 (CRITICAL) — `log()` takes `sessionId: string`, NOT `ctx` (src/log.ts, VERIFIED).
#   signature: log(level:"debug"|"info"|"warn"|"error", event:string, sessionId:string, data?:unknown).
#   The spec/07 §1 pseudocode `log("error","nudge.bloat",ctx,{...})` is WRONG for this codebase and will NOT
#   type-check (ctx is ExtensionContext, not string). Read sessionId FIRST inside the try{} (right after the
#   opening brace) so the catch{} can log it. log() never throws (its own try/catch).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #2 (CRITICAL) — `TextContent`/`ImageContent` are NOT re-exported by @earendil-works/pi-coding-agent
#   (verified: grep index.d.ts → no match) and the defining package @earendil-works/pi-ai is NOT resolvable
#   from this repo. You CANNOT name the appended block's element type. SOLUTION: use the indexed-access type
#   `ToolResultEvent["content"][number]` (= TextContent | ImageContent, exact) for the block:
#       const block: ToolResultEvent["content"][number] = { type: "text", text: reminder };
#   Then `const content = [...event.content, block];` is `(TextContent|ImageContent)[]` automatically and
#   `return { content };` type-checks with NO boundary cast. Do NOT write
#   `import type { TextContent } from "@earendil-works/pi-coding-agent"` — it will not resolve. (Same class
#   of problem as filter.ts's AgentMessage gotcha.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #3 — `event.toolName` is ALWAYS a string on the ToolResultEvent union (Bash→"bash", …,
#   Custom→string). Use `event.toolName.startsWith("mulligan_")` directly — NO optional chaining needed
#   (the spec's `event.toolName?.startsWith` is overly defensive; harmless but unnecessary). renderBloatReminder's
#   first param is `_toolName: string` — pass event.toolName (a string) directly.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #4 — `recordBloatHit(ctx, toolName, approxTokens)` in spec/07 §1 is PSEUDOCODE. No such helper
#   exists or is planned. "Record a bloat hit" = inline mutation of the runtime map (runtime.ts docs:
#   "callers mutate fields in place"):
#       rt.pendingBloatHits.push({ toolName: event.toolName, approxTokens: approxTokens(bytes) });
#   Only THIS task WRITES pendingBloatHits; P1.M6.T2.S1 only READS + CLEARS it (at turn_end). Do NOT clear it
#   here (it accumulates across the whole turn by design — Nudge B aggregates all hits in the turn).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #5 — the runtime map is MODULE-SCOPED (runtime.ts). Tests MUST clearAll() in beforeEach AND
# afterEach or a prior test's pendingBloatHits leaks in (mirror test/markers.test.ts + test/runtime.test.ts).
# Import clearAll from "../src/runtime.js".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #6 (CRITICAL) — the ENTIRE handler body is ONE try/catch (fail-open, spec/03 #4 / spec/08 E13).
#   On ANY throw (getConfig, resultBytes, getRuntime, getSessionId, renderBloatReminder), log +
#   `return;`-equivalent (fall through → undefined = pass-through). An extension bug must NEVER break a tool
#   result. The pure helpers (resultBytes/renderBloatReminder/approxTokens) also never throw — but the outer
#   try/catch is the hard guarantee (defense-in-depth).
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #7 — APPEND, never REPLACE. The reminder rides the result so the agent sees it co-located with the
#   data it may need THIS turn; the hint is about FUTURE turns (advisory, D3). Build
#   `[...event.content, block]` (a NEW array ref) — do NOT mutate event.content in place, do NOT return a
#   fresh array that omits the original blocks. (The looper-smoke shrink proof REPLACES; this task APPENDS.)
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #8 — gate ORDER matters: read sessionId first (for the catch log), then getConfig, then BOTH config
#   gates (enabled && nudges.bloatReminder) short-circuit BEFORE measurement/recording, then the mulligan_*
#   skip, THEN resultBytes + threshold. Recording a bloat hit for a disabled nudge would be a bug (Nudge B
#   would then fire on bloat even though Nudge A is off). Both gates must precede the push.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #9 — there is NO lint/format tool (devDeps = typescript + vitest + @types/node only). The "Level 1
#   syntax & style" gate reduces to `tsc --noEmit` (TS strict IS the type+style gate). Do NOT invent
#   eslint/prettier/biome — "command not found".
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #10 — the test imports from "../src/nudges.js" (.js extension; resolves to .ts under Bundler).
#   Established convention (every existing test). nudges.test.ts is a NEW file; do not modify other tests.
# ─────────────────────────────────────────────────────────────────────────────
# GOTCHA #11 — Handler is SYNC (not async). ExtensionHandler permits `R | void` (no Promise required) and
#   there are zero awaits. A sync try/catch is the cleanest fail-open (no unhandled-rejection path). The
#   spec/07 §1 pseudocode shows `async` — that is also valid, but sync is specified here. (If you prefer
#   async to match the spec verbatim, it still type-checks and fails open identically — but sync is cleaner.)
# ─────────────────────────────────────────────────────────────────────────────
```

---

## Implementation Blueprint

### Data models and structure

`nudges.ts` defines NO new types. It reuses `ToolResultEvent` / `ToolResultEventResult` / `ExtensionAPI` /
`ExtensionContext` (type-only, from the pi package), `MulliganConfig` (type-only, config.js), and the
exported helpers. The only novel typing is the indexed-access `ToolResultEvent["content"][number]` for the
appended block (GOTCHA #2) — no `TextContent` import.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PREREQUISITES + BASELINE (no edits — run only)
  - RUN: grep -n "export function resultBytes\|export function approxTokens" src/tokens.ts   # BOTH must print.
  - RUN: grep -n "export function renderBloatReminder" src/notes.ts                          # MUST print.
  - RUN: grep -n "export function getRuntime\|export interface BloatHit\|pendingBloatHits" src/runtime.ts  # ALL must print.
  - RUN: grep -n "export function getConfig" src/config.ts   ; grep -n "export function log" src/log.ts    # BOTH must print.
  - RUN: npx tsc --noEmit -p tsconfig.json          # expect exit 0
  - RUN: npx vitest run                              # expect 9 files all-green (baseline).

Task 1: CREATE src/nudges.ts   (exact content below — copy verbatim)
  - IMPLEMENT: bloatReminderHandler(event, ctx) (ONE try/catch; steps 1–8 + catch) + registerBloatReminder(pi).
  - CONSTRAINTS:
      * Read sessionId FIRST inside try{} (for the catch log — GOTCHA #1).
      * getConfig() AFTER sessionId; BOTH gates (enabled && nudges.bloatReminder) short-circuit BEFORE
        measurement (GOTCHA #8).
      * mulligan_* skip via event.toolName.startsWith("mulligan_") (GOTCHA #3).
      * bytes = resultBytes(event.content); if bytes < config.nudges.bloatThresholdBytes return (GOTCHA: under
        threshold = pass-through, NO recording).
      * block typed via ToolResultEvent["content"][number] (GOTCHA #2); content = [...event.content, block]
        (APPEND, never replace — GOTCHA #7).
      * rt.pendingBloatHits.push({toolName: event.toolName, approxTokens: approxTokens(bytes)}) — INLINE
        (GOTCHA #4; recordBloatHit is pseudocode). DO NOT clear pendingBloatHits.
      * catch: log("error","nudge.bloat",sessionId,{error:String(e)}); then fall through (return undefined).
      * SYNC function (GOTCHA #11).
  - NAMING/PLACEMENT: new file src/nudges.ts. Exports: bloatReminderHandler, registerBloatReminder.

Task 2: CREATE test/nudges.test.ts   (exact content below — copy verbatim)
  - IMPLEMENT: hand-rolled makePi (captures .on(eventName,handler) + appendEntry/sendMessage/setLabel
    captures for completeness), makeCtx (getSessionId), makeEvent (synthetic ToolResultEvent with a
    configurable content byte size + toolName); clearAll() before/afterEach. Describe blocks:
    registration; config gates (disabled master; disabled bloatReminder); mulligan_* skip; under-threshold
    no-op; over-threshold append + hit record; reminder appended-not-replaced; reminder text ===
    renderBloatReminder(...); multi-result accumulation; fail-open on each throwing dep
    (getConfig-throw via setConfig tamper; resultBytes-throw via Proxy content; getRuntime-throw via
    bad sessionId; renderBloatReminder-throw); log called with sessionId not ctx.
  - CONSTRAINTS: hand-rolled fakes for Pi objects (no vi.fn). clearAll() before/afterEach (GOTCHA #5).
    Reuse the markers.test.ts makePi/makeCtx idiom. To force over-threshold: a text block of ≥8193 chars
    (e.g. "x".repeat(9000) → resultBytes=9000 > 8192; approxTokens=ceil(9000/4)=2250).
  - COVERAGE: every success-criteria bullet has an assertion.

Task 3: VALIDATE (no edits — run the gates in the Validation Loop)
  - Level 1 (tsc) and Level 2 (vitest). Level 3 N/A for the unit suite (Pi-coupled glue; the real
    end-to-end is the integration smoke harness P1.M7.T2). Level 4 = the fail-open + append-not-replace +
    no-hit-when-gated assertions.
```

### Implementation Patterns & Key Details

```ts
// PATTERN — the tool_result handler (fail-open, advisory append). Copy verbatim into src/nudges.ts.
import type {
  ToolResultEvent,
  ToolResultEventResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getConfig } from "./config.js";
import { getRuntime } from "./runtime.js";
import { log } from "./log.js";
import { resultBytes, approxTokens } from "./tokens.js";
import { renderBloatReminder } from "./notes.js";

/**
 * bloatReminderHandler — Nudge A (spec/07 §1). Fires after every tool execution; if the result's
 * in-context byte size exceeds config.nudges.bloatThresholdBytes, APPENDS a short reminder to the
 * result's content (advisory; the agent may need the data now) and records a bloat hit for the per-turn
 * drift nudge (Nudge B). Skips mulligan_* tools. Rides the result — zero extra requests (D3/D4).
 *
 * NEVER throws (spec/03 #4, spec/08 E13): the WHOLE body is ONE try/catch → log + return nothing
 * (pass-through). Read sessionId FIRST so the catch can log it. SYNC (ExtensionHandler permits R|void).
 *
 * @returns { content: [...original, {type:"text", text:reminder}] } when over threshold; undefined otherwise.
 */
export function bloatReminderHandler(
  event: ToolResultEvent,
  ctx: ExtensionContext,
): ToolResultEventResult | void {
  let sessionId = "";
  try {
    sessionId = ctx.sessionManager.getSessionId(); // FRESH (C12); first, so the catch can log it
    const config = getConfig();
    if (!config.enabled || !config.nudges.bloatReminder) return; // both gates BEFORE measurement (GOTCHA #8)

    if (event.toolName.startsWith("mulligan_")) return; // skip our own tools (GOTCHA #3)

    const bytes = resultBytes(event.content);
    const threshold = config.nudges.bloatThresholdBytes;
    if (bytes < threshold) return; // under threshold → pass-through, NO recording

    const reminder = renderBloatReminder(event.toolName, bytes, threshold);
    // GOTCHA #2: TextContent|ImageContent not exported → indexed-access type. APPEND, never replace (GOTCHA #7).
    const block: ToolResultEvent["content"][number] = { type: "text", text: reminder };
    const content = [...event.content, block];

    // GOTCHA #4: recordBloatHit is pseudocode — inline push. DO NOT clear (Nudge B aggregates + clears).
    const rt = getRuntime(sessionId);
    rt.pendingBloatHits.push({ toolName: event.toolName, approxTokens: approxTokens(bytes) });

    return { content };
  } catch (e) {
    log("error", "nudge.bloat", sessionId, { error: String(e) }); // GOTCHA #1: sessionId, NOT ctx
    // fail-open: return nothing (leave the result unchanged)
  }
}

/**
 * registerBloatReminder — arm Nudge A. index.ts (P1.M7.T1.S1) calls this once at startup.
 * P1.M6.T2.S1 (turn_end metric) + P1.M6.T2.S2 (shouldNudge/injectNudge) APPEND to this module later.
 */
export function registerBloatReminder(pi: ExtensionAPI): void {
  pi.on("tool_result", bloatReminderHandler);
}
```

```ts
// PATTERN — the test fake idiom (mirror test/markers.test.ts). Sketch only; full file in Task 2.
function makePi() {                              // captures .on registrations
  const onCalls: { event: string; handler: unknown }[] = [];
  const pi = { on: (event: string, handler: unknown) => { onCalls.push({ event, handler }); } };
  return { onCalls, pi: pi as unknown as ExtensionAPI };
}
function makeCtx(sessionId = "s1") {             // minimal; getSessionId is all the handler reads
  return { ctx: { sessionManager: { getSessionId: () => sessionId } } as unknown as ExtensionContext };
}
function makeEvent(toolName: string, text: string, isError = false) {  // synthetic ToolResultEvent
  return { type: "tool_result", toolCallId: "c1", input: {}, content: [{ type: "text", text }],
           isError, toolName } as unknown as ToolResultEvent;
}
// OVER-THRESHOLD fixture: makeEvent("read", "x".repeat(9000))  → resultBytes=9000>8192, approxTokens=2250.
// UNDER-THRESHOLD fixture: makeEvent("read", "small")          → resultBytes=5<8192 → pass-through.
// The captured handler is invoked directly: const h = onCalls[0].handler as typeof bloatReminderHandler;
//   const res = h(event, ctx);  expect(res).toEqual({content:[...]});  // no Pi runtime needed.
```

### Integration Points

```yaml
EVENT REGISTRATION (consumed by index.ts, P1.M7.T1.S1 — NOT this task):
  - add to: src/index.ts (factory)   [DEFERRED to P1.M7.T1.S1 — this task only SHIPS registerBloatReminder]
  - pattern: "registerBloatReminder(pi);  // arm Nudge A"

RUNTIME STATE (read/write, in-memory, NOT persisted):
  - write: "rt.pendingBloatHits.push({toolName, approxTokens}) — this task"
  - read+clear: "P1.M6.T2.S1 (turn_end) snapshots pendingBloatHits into TurnMetric and clears it"

CONFIG (read-only):
  - consume: "config.enabled, config.nudges.bloatReminder, config.nudges.bloatThresholdBytes (default 8192)"

NO DATABASE / NO PERSISTENCE: "the bloat hit is in-memory only; nothing is appended to the session (no
  appendEntry). The reminder rides the in-flight tool_result content; it is NOT a session entry."
```

---

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# There is NO eslint/prettier/biome (devDeps = typescript + vitest + @types/node). TS strict IS the gate.
npx tsc --noEmit -p tsconfig.json
# Expected: exit 0, zero errors. If errors exist, READ the output:
#   - "Cannot find name 'TextContent'" / "Module ... has no exported member 'TextContent'" → you imported
#     TextContent; switch to the indexed-access type ToolResultEvent["content"][number] (GOTCHA #2).
#   - "Argument of type 'ExtensionContext' is not assignable to parameter of type 'string'" → you passed
#     ctx to log(); pass sessionId instead (GOTCHA #1).
#   - "Property 'on' does not exist on type 'ExtensionAPI'" → impossible (verified); re-check the import.
# Fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# Test the new handler in isolation
npx vitest run test/nudges.test.ts
# Expected: all nudges tests pass.

# Full suite (no regression)
npx vitest run
# Expected: 10 files all-green (was 9; +nudges.test.ts). If a PRIOR test fails, it is a regression caused
# by this task — but this task creates 2 NEW files and touches nothing, so a prior failure means this task
# accidentally mutated a shared module. Re-check that nudges.ts only IMPORTS (never re-exports/redefines)
# from existing modules.
```

### Level 3: Integration Testing (System Validation)

```bash
# N/A for the unit suite — bloatReminderHandler is Pi-coupled glue exercised by the integration smoke
# harness (P1.M7.T2, spec/10). The handler IS directly invokable in the unit test via the captured .on
# handler (Level 2), which is the equivalent of an integration call without a live Pi runtime.
#
# The real end-to-end (a live `pi -e ./src/index.ts` session that produces a >8KB tool result and observes
# the appended reminder in the transcript) is owned by P1.M7.T2 (smoke harness) — NOT this task.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Fail-open + append-not-replace + no-hit-when-gated assertions (the heart of this nudge's correctness):
#   - assert a THROWING getConfig (setConfig with a Proxy that throws in validateConfig, or stub getConfig)
#     → handler returns undefined AND the tool result is unchanged AND nothing is pushed to pendingBloatHits.
#   - assert a THROWING resultBytes (event.content = a Proxy whose every get throws) → same fail-open.
#   - assert a THROWING getSessionId (ctx.sessionManager.getSessionId = () => { throw }) → same fail-open,
#     AND log received sessionId="" (the handler read it first, it threw, the catch logs "").
#   - assert the OVER-THRESHOLD return PRESERVES the original content blocks:
#       const orig = event.content; const res = handler(event, ctx);
#       expect(res.content.slice(0, orig.length)).toEqual(orig);   // original blocks untouched
#       expect(res.content.length).toBe(orig.length + 1);          // exactly ONE block appended
#       expect(res.content[res.content.length-1]).toEqual({type:"text", text: renderBloatReminder(...)});
#   - assert the appended text === renderBloatReminder(toolName, bytes, threshold) EXACTLY (reuse, not
#     reimplement) — import renderBloatReminder in the test and compare.
#   - assert pendingBloatHits gets {toolName, approxTokens: approxTokens(bytes)} — import approxTokens and
#     compare; for a 9000-byte result expect approxTokens=2250.
#   - assert BOTH config gates suppress recording: disabled master OR disabled bloatReminder →
#     pendingBloatHits length unchanged (toggle via setConfig before the call).
# Expected: all domain validations pass.
```

---

## Final Validation Checklist

### Technical Validation

- [ ] `npx tsc --noEmit -p tsconfig.json` exits 0 (Level 1 — the type+style gate; no lint tool exists).
- [ ] `npx vitest run test/nudges.test.ts` passes (Level 2).
- [ ] `npx vitest run` is all-green, no regression (Level 2 — 10 files).

### Feature Validation

- [ ] All success criteria from "What" section met.
- [ ] `registerBloatReminder` registers exactly one `tool_result` handler.
- [ ] Over-threshold result: reminder APPENDED (original blocks preserved); bloat hit recorded.
- [ ] Under-threshold / disabled / mulligan_* results: pass-through (undefined), no append, no hit.
- [ ] Reminder text === `renderBloatReminder(...)` (reused, not reimplemented).
- [ ] Fail-open: every throwing dependency → undefined + unchanged result + no hit + `log("error","nudge.bloat",sessionId,...)`.
- [ ] `log` called with `sessionId` (string), never `ctx`.

### Code Quality Validation

- [ ] Follows the fail-open pi.on() handler pattern established by filter.ts (P1.M4.T2.S1).
- [ ] File placement matches the desired tree (`src/nudges.ts`, `test/nudges.test.ts` at root).
- [ ] Anti-patterns avoided: does NOT replace content (appends); does NOT clear pendingBloatHits; does NOT
      import the unexported `TextContent`; does NOT pass `ctx` to `log`; does NOT touch any existing file.
- [ ] Dependencies properly managed: type-only imports for Pi types + MulliganConfig; value imports for the
      5 COMPLETE helpers (getConfig, getRuntime, log, resultBytes, approxTokens, renderBloatReminder).
- [ ] SYNC handler (no spurious async); ONE try/catch over the whole body.

### Documentation & Deployment

- [ ] Code is self-documenting (the module + function JSDoc blocks in the Blueprint state the spec refs,
      the fail-open guarantee, and each gotcha inline — copy them verbatim).
- [ ] No new environment variables (threshold is `config.nudges.bloatThresholdBytes`, already in config.ts).
- [ ] Wiring into `index.ts` is DEFERRED to P1.M7.T1.S1 (this task only ships the registration function).

---

## Anti-Patterns to Avoid

- ❌ Don't REPLACE the result's content — APPEND (the agent may need the data now; the hint is about future
  turns). The looper-smoke shrink proof replaces; this nudge must not.
- ❌ Don't import `TextContent`/`ImageContent` from the pi package — they are NOT exported. Use the
  indexed-access type `ToolResultEvent["content"][number]`.
- ❌ Don't pass `ctx` to `log()` — it takes `sessionId: string`. The spec/07 §1 pseudocode is wrong here.
- ❌ Don't invent a `recordBloatHit` helper — it's pseudocode; push inline into `rt.pendingBloatHits`.
- ❌ Don't clear `pendingBloatHits` here — it accumulates across the turn; Nudge B (P1.M6.T2.S1) clears it.
- ❌ Don't skip validation because "it should work" — run `tsc` + `vitest` after each file (Levels 1–2).
- ❌ Don't ignore failing tests — a prior-file failure means this task mutated a shared module; re-check.
- ❌ Don't record a bloat hit when a config gate is off — both gates must precede the push (GOTCHA #8).
- ❌ Don't make the handler `async` for show — it has no awaits; sync is cleaner fail-open (though async is
  also valid if you prefer to mirror the spec verbatim).

---

## Confidence Score

**9/10** for one-pass implementation success. Rationale: every upstream dependency is SHIPPED and
verified-importable; the exact handler code is given verbatim (copy-paste); the two type-system gotchas
(unexported `TextContent`; `log(sessionId)`) are pre-solved with copy-paste workarounds; the test idiom is
copied from the all-green `test/markers.test.ts`; and the only runtime novelty (the indexed-access block
type + append) is proven by the looper-smoke prototype. The -1 reserves for the possibility that the real
`TextContent` has an unexpected required field the indexed-access assertion doesn't surface (extremely
unlikely — the assertion is on a literal `{type:"text",text}`, the canonical text block).