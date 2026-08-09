# Research notes — P3.M1.T3.S1 (mulligan_cancel tool + index.ts registration)

## 1. The EXACT template: src/tools/shrink.ts → makeShrinkTool(pi)

`makeShrinkTool(pi): ToolDefinition<typeof ShrinkParams, ShrinkDetails>` is the verbatim pattern to clone:
- imports from `@earendil-works/pi-coding-agent`: `defineTool`, `sessionEntryToContextMessages`(NOT needed for cancel), types `AgentToolResult`, `ExtensionAPI`, `ExtensionContext`, `SessionEntry`, `ToolDefinition`. + `Type`/`Static` from typebox.
- `.js` ESM import paths (`../markers.js`, `../config.js`).
- `refusal(reason)` helper → `{ content:[{type:"text", text:`Mulligan: refused — ${reason}.`}], details:{} }`. **Every return path includes `details`** (required by Pi's AgentToolResult<T> type).
- `defineTool({ name, label, description, parameters, async execute(toolCallId, params, signal, onUpdate, ctx) {...} })`.
- `pi` captured via closure: `makeXxxTool(pi)` returns the tool; `execute` calls a module-private `xxxExecute(pi, toolCallId, params, signal, onUpdate, ctx)`.
- The WHOLE execute body is ONE try/catch → `refusal(`unexpected error: <msg>`)` (E13 — never throws).
- Exports: `makeXxxTool`, `XxxParams`, `XxxDetails`, `XXX_DESC`.

cancel is SIMPLER than shrink: NO best-effort match, NO sessionEntryToContextMessages, NO resolveShrinkTarget, NO note. It scans getEntries(), maps entry.id → data.id (uuid), checks not-already-cancelled, calls appendCancelMarker.

## 2. markers.ts is FULLY LANDED (P3.M1.T1.S1 done)

Confirmed by grep — `appendCancelMarker`, `CancelMarker`, `CancelMarkerInput` all exist and are EXPORTED.
- `CancelMarker extends MulliganEnvelope { kind:"cancel"; targetId:string; seq:number; ts:number }` (NO own id — a cancel isn't cancellable; mirrors TurnMetric).
- `MulliganEnvelope.kind` already = `"rewind" | "shrink" | "turn-metric" | "cancel"`.
- `appendCancelMarker(pi, ctx, {targetId}): string | null` — stamps envelope + seq + ts, `pi.appendEntry("mulligan:cancel", entry)`, returns `ctx.sessionManager.getLeafId()`. NEVER throws (try/catch → null). Does NOT validate targetId exists — that's the TOOL's job.
- `test/markers.test.ts` already tests appendCancelMarker (appendCancelMarker describe block + CANCEL_DATA fixture) — DO NOT touch.

## 3. The markerId → targetId mapping (THE core logic — Pattern 3 DECISION, confirmed)

- The agent passes `markerId` = the ENTRY id returned in `details.markerId` by mulligan_rewind/mulligan_shrink (= `getLeafId()` — see appendRewindMarker/appendShrinkMarker both `return ctx.sessionManager.getLeafId()`).
- BUT readMarkers (P3.M1.T2.S1) drops markers whose `data.id` (the uuid) ∈ cancelledIds. So the cancel's `targetId` MUST be the marker's uuid `data.id`, NOT the entry id.
- THEREFORE the tool MUST MAP: markerId(entry id) → find entry → read `entry.data.id`(uuid) → that uuid is appendCancelMarker's targetId. This is the indirection that reconciles the two id spaces.

## 4. readOwn/isRecord are MODULE-PRIVATE in filter.ts → cancel.ts needs LOCAL mirrors

- `grep`: filter.ts line 55 `function isRecord(...)` and line 60 `function readOwn(...)` — BOTH unexported (module-private).
- filter.ts is OUT OF SCOPE for this task (P3.M1.T2.S1 owns it). So cancel.ts CANNOT import readOwn.
- DECISION: define local `isRecord` + `readOwn` in cancel.ts (verbatim copy of filter.ts's ~8-line helpers). Defense-in-depth: a Proxy get-trap may throw → readOwn swallows → undefined → safe. This matches the codebase convention exactly.

## 5. SessionEntry shape (from Pi core/session-manager.d.ts)

- `SessionEntryBase { type: string; id: string; parentId: string|null; timestamp: string }`.
- `CustomEntry<T> extends SessionEntryBase { type:"custom"; customType: string; data?: T }`.
- So a rewind/shrink entry: `e.type==="custom"` && `e.customType==="mulligan:rewind"|"mulligan:shrink"` && `e.id` (entry id) && `e.data.id` (uuid) && `e.data.kind==="rewind"|"shrink"`.
- A cancel entry: `e.customType==="mulligan:cancel"` && `e.data.targetId` (uuid) && `e.data.kind==="cancel"`.
- Note: CustomMessageEntry ALSO has customType (e.g. mulligan:note). The customType∈{rewind,shrink} guard excludes notes automatically (note customType is "mulligan:note").

## 6. Config gate — MASTER only (no config.cancel knob)

- The contract step 1: `if (!getConfig().enabled) return refusal("Mulligan is disabled")` (E14 master switch).
- There is NO `config.cancel` in MulliganConfig (config.ts) — cancel retraction is governed by the master `enabled` only. So just `getConfig().enabled` (read ONCE).
- (rewind/shrink have sub-feature gates config.rewind.enabled / config.shrink.enabled; cancel has none — intentional: retraction is a safety/escape hatch, always on when mulligan is on.)

## 7. Test pattern (test/tools/shrink.test.ts) + the ONE difference for cancel

House idiom: vitest, hand-rolled makePi()/makeCtx() fakes (NO vi.fn), `.js` imports, expectTypeOf type asserts, clearAll() in beforeEach+afterEach (nextSeq mutates shared runtime map).
- makePi({throwOnAppend?}): fake ExtensionAPI capturing appendEntry into `appended: {customType,data}[]`; cast `pi as unknown as ExtensionAPI`.
- makeCtx({...}): fake ExtensionContext exposing sessionManager.{getSessionId, getLeafId, buildContextEntries}.
- **CRITICAL DIFFERENCE for cancel**: cancel scans `ctx.sessionManager.getEntries()` (FRESH — C12), NOT buildContextEntries. shrink's makeCtx does NOT expose getEntries. So cancel.test.ts's makeCtx MUST script `getEntries()` returning a scripted `SessionEntry[]`. Add a `getEntries` method to the fake sessionManager (or a dedicated makeCtx variant).

Test cases (from contract MOCKING §5):
1. cancel an existing rewind → appendCancelMarker called with right targetId + confirmation text; details.cancelled===true.
2. cancel a shrink → same.
3. non-existent markerId → no-op text "no active marker found..." + details.cancelled===false + appendEntry NOT called.
4. already-cancelled (a mulligan:cancel entry with data.targetId===uuid present) → no-op text "already cancelled" + cancelled===false + appendEntry NOT called.
5. config.enabled===false → refusal text "Mulligan: refused — Mulligan is disabled." + details:{}.
6. appendEntry throws (makePi throwOnAppend) → catch → refusal text "unexpected error..." (never throws).
7. Registration metadata: makeCancelTool returns {name:"mulligan_cancel", label, description===CANCEL_DESC VERBATIM, parameters===CancelParams}.

## 8. index.ts wiring (src/index.ts)

- Existing: `import { makeShrinkTool } from "./tools/shrink.js";` + `pi.registerTool(makeShrinkTool(pi));`.
- ADD: `import { makeCancelTool } from "./tools/cancel.js";` (alphabetical-ish, after checkpoint) + `pi.registerTool(makeCancelTool(pi));` alongside the other 4 registerTool calls.
- The index.ts comment "Registers all 4 agent-callable tools" → update to "5".

## 9. spec/05-tools.md docs (Mode A: rides with the work)

- §1 rewind, §2 shrink, §3 checkpoint, §4 audit, §5 registration summary, §6 cross-refs.
- ADD new section for mulligan_cancel. To AVOID renumbering §4/§5/§6: insert as `## 3.5 mulligan_cancel` between §3 (checkpoint) and §4 (audit) — OR renumber audit→§5 etc. Simplest = insert "## 5. mulligan_cancel" and bump registration→§6, cross-refs→§7. The contract says "new §3.5 or renumber". Either is acceptable; renumber is cleaner for markdown headings. I'll recommend insert-after-audit as new §5 (so the 4 "create" tools group together, cancel as the 5th retraction tool), registration→§6, cross-refs→§7. Actually cleanest minimal-diff: insert between checkpoint(§3) and audit(§4) renumbering audit→§4 stays? No — inserting shifts. I'll let implementer insert as §3.5 (a half-numbered heading) OR renumber. Recommend: place as a new `## 5. mulligan_cancel` AFTER audit, bump registration summary to §6 and cross-refs to §7. This groups the 4 original tools + adds cancel as §5. Wait that conflicts with audit being §4. Let me just say: insert mulligan_cancel as a new top-level section; renumber subsequent sections. Minimal churn = place it as §5 (after audit §4), registration→§6, cross-refs→§7.
- MUST also update §registration-summary code block: add `pi.registerTool({ name:"mulligan_cancel", label:"Mulligan Cancel", description: CANCEL_DESC, parameters: CancelParams, execute: cancelExecute });` (5th line).
- MUST add CANCEL_DESC to the description-strings list in §registration summary.
- Reference the D6-amendment framing (spec/SPEC.md §9 D6-amended, spec/08 E21).

## 10. Validation commands (verified)

- Type-check: `npx tsc --noEmit` (typescript ^5 devDep; no separate build).
- Single file test: `npx vitest run test/tools/cancel.test.ts`.
- Full suite: `npm test` (= `vitest run`).
- No linter/formatter configured (package.json has only "test" + "smoke" scripts).
- tsconfig is strict (shrink.ts comment confirms strict typecheck; every return path needs `details`).