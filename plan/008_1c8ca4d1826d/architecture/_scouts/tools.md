# Code Context — pi-mulligan v2.0 delta recon (shrink / cancel / prepare-args)

## Files Retrieved
1. `src/tools/shrink.ts` (full, 405 lines) — the `mulligan_shrink` tool: schema, validations, advisory match, pinning, orientation line, notify echo.
2. `src/tools/cancel.ts` (full, 471 lines) — `mulligan_cancel`: target/markerId resolution, covering rules, idempotency.
3. `src/prepare-args.ts` (full, 61 lines) — `prepareObjectArgs` string→object shim (E27 failure class).
4. `src/transforms.ts` (lines 733–815) — `ShrinkTarget` type + `resolveShrinkTarget` pure resolver, incl. `by_content_includes` arm.
5. `src/index.ts` (lines 8–11, 53–56) — tool registration.
6. `src/markers.ts` (grep) — `getLeafId`/`getEntries`/`buildContextEntries` usage via wrappers.

---

## 1. shrink.ts

### ShrinkParams union — lines 80–106, verbatim
```ts
export const ShrinkParams = Type.Object({
  target: Type.Union(
    [
      Type.Object({ by_tool_call_id: Type.String({ description: "The toolCallId of the result to shrink." }) }),
      Type.Object({
        by_tool_name: Type.String({ description: "e.g. 'read', 'bash'" }),
        occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]),
      }),
      Type.Object({
        by_content_includes: Type.String({
          description: "Shrink the (first) message whose text contains this substring.",
        }),
      }),
    ],
    { description: "How to identify the message to shrink. Resolved live each turn (robust to compaction)." },
  ),
  replacement: Type.String({
    description:
      "The compact text that replaces the matched message's content. Make it a faithful summary — the model will treat it as ground truth from now on.",
  }),
  reason: Type.Optional(Type.String({ description: "Why (surfaced in audit). Optional." })),
});
```
All three arms — including `by_content_includes` — are first-class schema arms today. Type is `Type.Union` (typebox). `export type ShrinkArgs = Static<typeof ShrinkParams>;` (line ~110).

### SHRINK_DESC — lines 112–116, verbatim
```ts
export const SHRINK_DESC =
  "Replace a specific past tool result with a compact summary you provide, in your view, going forward. " +
  "Use when the call was fine but its output is too big to keep carrying. Unlike rewind, the call stays in " +
  "context (just with your summary as its result).";
```

### describeTarget — lines 185–192, verbatim
```ts
function describeTarget(target: ShrinkArgs["target"]): string {
  if (!target || typeof target !== "object") return "message";
  if ("by_tool_call_id" in target) return `tool call ${target.by_tool_call_id}`;
  if ("by_tool_name" in target) return `${target.by_tool_name} result`;
  if ("by_content_includes" in target)
    return `message containing "${target.by_content_includes.slice(0, 40)}"`;
  return "message";
}
```

### targetIsStructurallyValid — lines 215–222, verbatim
```ts
function targetIsStructurallyValid(target: ShrinkArgs["target"] | undefined): boolean {
  if (!target || typeof target !== "object") return false; // non-record → no recognizable discriminator
  if ("by_tool_call_id" in target) return isNonEmpty(target.by_tool_call_id);
  if ("by_tool_name" in target) return isNonEmpty(target.by_tool_name);
  if ("by_content_includes" in target) return isNonEmpty(target.by_content_includes);
  return false; // no recognizable discriminator key
}
```
Note: the `by_content_includes` branch refuses only empty/whitespace needles; a non-empty needle is accepted even when currently unmatched (E8). Comment (lines 205–213) explains: empty `by_content_includes` would degenerately match the FIRST message in `resolveShrinkTarget` (transforms.ts has no length check on the matching path but the needle length IS checked — see below).

### resolveTargetEntryId — lines 258–275, verbatim
```ts
function resolveTargetEntryId(
  ctx: ExtensionContext,
  target: ShrinkArgs["target"],
): { entryId: string | null; origTokens: number } {
  try {
    const entries = ctx.sessionManager.buildContextEntries(); // GOTCHA #5: snapshot, compaction-aware
    const messages = entries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[];
    const i = resolveShrinkTarget(messages, target as ShrinkTarget); // PURE resolver (transforms.ts)
    if (i === null) return { entryId: null, origTokens: 0 };
    const origTokens = estimateTokens([messages[i]] as unknown as EstMessageLike[]).tokens;
    return { entryId: entryIdAtMessageIndex(entries, i), origTokens }; // map message index → stable ENTRY id
  } catch {
    return { entryId: null, origTokens: 0 }; // E13
  }
}
```
Supporting: `entryIdAtMessageIndex` (lines ~228–243) cursor-walks `entries.flatMap(sessionEntryToContextMessages)` to map message index → stable ENTRY id (exact by construction).

**E13 advisory path** in execute (lines ~326–334): inner try/catch around `resolveTargetEntryId` (belt-and-suspenders); `const matched = entryId !== null;`. On `matched:false` the marker STILL persists.

**Pinning** (lines 338–347):
```ts
const markerId = appendShrinkMarker(pi, ctx, {
  target: params.target,
  replacement: params.replacement,
  reason: params.reason,
  ...(entryId ? { pinnedEntryId: entryId } : {}),
} satisfies ShrinkMarkerInput);
```
`pinnedEntryId` only included when matched; absent → filter falls back to live resolution (filter side: `resolvePinnedShrink` + `resolveShrinkTarget`, transforms.ts ~815–1000).

### v1.2 orientation line — lines 165–167 (function) + usage at 369–371
```ts
export function shrinkOrientationLine(k: number, tokensShed: number): string {
  return `Context updated: ${k} result(s) summarized (~${tokensShed} tokens shed). Continue exactly where you left off — no re-verification or re-reading is needed.`;
}
```
Usage (~line 369–371):
```ts
const tokensShed = Math.max(0, origTokens - estimateTokens([{ content: params.replacement }]).tokens);
const orientation = markerId ? `\n${shrinkOrientationLine(1, tokensShed)}` : "";
```
Appended to `feedbackText(matched)` only when `markerId` truthy. `feedbackText` (~line 156): `` `Mulligan: shrink recorded. Matched: ${matched ? "yes" : "no"}.` ``

### prepareArguments shim usage — line 400
```ts
prepareArguments: prepareObjectArgs<ShrinkArgs>(["target"]),
```
### notify echo — lines ~350–357
```ts
try {
  if (ctx.hasUI) {
    const capped = cap(params.replacement, config.shrink.notifyMaxChars);
    ctx.ui.notify(`Shrunk ${describeTarget(params.target)} — replacement:\n<<<\n${capped}\n>>>`, "info");
  }
} catch { /* E13 */ }
```
`cap` (~line 176): truncates to `max` chars + `…(N chars total)`.

### Refusal shape
`refusal(reason)` (lines 135–139) — RETURN OBJECT, never throws:
```ts
function refusal(reason: string): AgentToolResult<ShrinkDetails> {
  return {
    content: [{ type: "text", text: `Mulligan: refused — ${reason}.` }],
    details: {},
  };
}
```
Exact refusal strings in shrinkExecute:
- `"Mulligan: refused — Mulligan is disabled."` (line 312)
- `"Mulligan: refused — shrink is disabled."` (line 313)
- `"Mulligan: refused — replacement must be non-empty."` (line 316)
- `"Mulligan: refused — target discriminator must be non-empty."` (line 320)
- `` `Mulligan: refused — unexpected error: ${e instanceof Error ? e.message : String(e)}.` `` (line 374)

---

## 2. cancel.ts

### CancelParams.target union — lines 93–133, verbatim
```ts
export const CancelParams = Type.Object(
  {
    target: Type.Optional(
      Type.Union(
        [
          Type.Object({
            by_tool_call_id: Type.String({ description: "The toolCallId of a message the marker affected." }),
          }),
          Type.Object({
            by_tool_name: Type.String({ description: "e.g. 'read', 'bash'" }),
            occurrence: Type.Union([Type.Literal("last"), Type.Literal("first")]),
          }),
          Type.Object({
            by_content_includes: Type.String({
              description: "Match a marker whose affected message(s) include this substring.",
            }),
          }),
        ],
        {
          description:
            "How to identify the marker to cancel — the SAME hint shape mulligan_shrink uses. Resolved live each turn (robust to compaction). The most recent active marker (shrink or rewind) whose target/span covers the matched message is retired.",
        },
      ),
    ),
    markerId: Type.Optional(
      Type.String({
        description:
          "Optional explicit fallback: the markerId returned by mulligan_rewind/mulligan_shrink in details.markerId. If both target and markerId are given, markerId wins.",
      }),
    ),
  },
  {
    description:
      "Cancel accepts a `target` (preferred) or an explicit `markerId` (fallback). At least one MUST be present.",
  },
);
```
Structurally identical union to ShrinkParams.target (hard parity requirement — `params.target` is handed to `resolveShrinkTarget`). Both top-level fields Optional (Decision D1); "at least one" enforced in `cancelExecute` as a no-op, not a refusal (Decision D2).

### CANCEL_DESC — lines 140–148, verbatim
```ts
export const CANCEL_DESC =
  "Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when " +
  "you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken " +
  "transform would apply on every turn for the rest of the session. Identify the marker by `target` " +
  "(same hint shape as mulligan_shrink: by_tool_call_id, by_tool_name+occurrence, or by_content_includes) — " +
  "the most recent marker affecting that content is retired; or pass an explicit `markerId` if you have one. " +
  "The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). " +
  "Cancelling a non-existent or already-cancelled marker is a safe no-op.";
```

### Target-path resolution call — `resolveTargetUuid` (lines 256–316), call site line 387
```ts
targetUuid = resolveTargetUuid(ctx, entries, params.target);
```
Inside `resolveTargetUuid`:
```ts
const snapshotEntries = ctx.sessionManager.buildContextEntries();
const messages = snapshotEntries.flatMap((e) => sessionEntryToContextMessages(e)) as unknown as MessageLike[];
const matchedIndex = resolveShrinkTarget(messages, target);
if (matchedIndex === null) return null;
const matchedEntryId = entryIdAtMessageIndex(snapshotEntries, matchedIndex);
```

### Covering-marker check (~lines 285–305) — NOTE: no pinnedEntryId comparison
```ts
if (ct === "mulligan:shrink") {
  const shrinkTarget = readOwn(data, "target");
  const resolved = resolveShrinkTarget(messages, shrinkTarget as ShrinkTarget);
  covers = resolved === matchedIndex; // SHRINK: own target resolves to the matched index (live, not pinned)
} else {
  const hideEntryIds = readOwn(data, "hideEntryIds");
  if (matchedEntryId !== null && Array.isArray(hideEntryIds)) {
    covers = hideEntryIds.includes(matchedEntryId);
  }
}
```
Explicitly documented (line 241): "LIVE resolution — compaction-robust; NOT `pinnedEntryId`, which is the filter's identity-lock". LIFO selection: highest `data.seq` wins; malformed uuid/seq→0 skipped. `pinnedEntryId` does NOT appear in cancel.ts code at all (only in the comment explaining it's deliberately not used).

### markerId fallback (step 3a, ~lines 372–385)
Scan `entries` for `readOwn(e,"id") === params.markerId` ∧ `customType ∈ {mulligan:rewind, mulligan:shrink}` → `uuid = readOwn(data,"id")` → that uuid is `targetId`. markerId is authoritative when both given.

### Idempotency (step 5, ~lines 412–420)
Re-scan all entries for `customType === "mulligan:cancel"` ∧ `readOwn(readOwn(e,"data"),"targetId") === targetUuid` → return "already cancelled" no-op, `details:{cancelled:false}`.

### Cancel texts (verbatim)
- Refusal (only 2): `"Mulligan: refused — Mulligan is disabled."` and `` `Mulligan: refused — unexpected error: ${...}.` `` (via `refusal()` at lines 203–207; shape identical to shrink's: `{content:[{type:"text",text:…}],details:{}}`).
- No-op not-found: `"Mulligan: no active marker found with that id — nothing to cancel."` (markerId path) / `"Mulligan: no active marker found for that target — nothing to cancel."` (target/neither path) — `details:{cancelled:false}`.
- Idempotent: `"Mulligan: that marker is already cancelled."` — `details:{cancelled:false}`.
- Success: `"Mulligan: marker cancelled. The transform will no longer apply from the next turn on."` — `details:{cancelled:true, markerId}` (cancelled stays true even if markerId null).

### Shim: line 466 `prepareArguments: prepareObjectArgs<CancelArgs>(["target"])` (markerId-only calls pass through untouched).

---

## 3. Schema validation / registration (index.ts)

Registration — `src/index.ts` lines 53–56:
```ts
pi.registerTool(makeRewindTool(pi));
pi.registerTool(makeShrinkTool(pi));
pi.registerTool(auditTool);
pi.registerTool(makeCancelTool(pi));
```
Tools are `defineTool({ name, label, description, parameters, prepareArguments, execute })` from `@earendil-works/pi-coding-agent`; typebox (`typebox` package, `Type`/`Static`) schemas.

**Validation happens HOST-SIDE, BEFORE execute()**: pi-agent-core agent-loop → pi-ai `validateToolArguments` (`Value.Convert` + compiled `Check`). Consequences:
- `by_content_includes` is currently a fully valid schema arm — NOT rejected anywhere at schema level. It is accepted in both `ShrinkParams` and `CancelParams` unions and resolved by `resolveShrinkTarget` (transforms.ts:771–805, the `by_content_includes` arm at ~802).
- An UNKNOWN arm today (e.g. `by_regex: "x"`): the value matches NO anyOf member (each requires a specific property) → host validation fails pre-execute with "must be object"-style anyOf errors ×3 → the call is dead on arrival; execute never runs; no tool-body code can catch it. Same for `target` sent as a JSON string unless `prepareObjectArgs` parses it.
- Structural-validity code (`targetIsStructurallyValid`) only runs post-schema-validation and only catches empty discriminators, not unknown arms.

---

## 4. prepare-args.ts (E27 shim)

`prepareObjectArgs<T>(keys): (args: unknown) => T` — module has 0 imports (Pi-free). Behavior: if args is a record, for each key: if value is a string, `JSON.parse`; replace ONLY if parsed is a non-null non-array object; malformed JSON / arrays / scalars left as-is (host reports honest errors). Mutates the host-owned copy (host structuredClones before validation; identity preserved so agent-loop's `preparedArguments === toolCall.arguments` short-circuit holds). Never throws.

Interaction with ShrinkParams anyOf: models observed sending `target: "{\"by_tool_call_id\": \"call_bash_pclntab\"}"`. Without the shim every anyOf arm fails ("must be object" ×3) pre-execute. With it, the string is parsed to a real object before host `Value.Convert`+`Check`, so anyOf validation then runs on the object. Consumers: shrink (`target`), cancel (`target`), rewind (`note`). checkpoint/audit take scalars only — no shim.

---

## 5. Current-turn / message-snapshot APIs available to tools

Tools receive `ctx: ExtensionContext` in execute; `pi: ExtensionAPI` via factory closure (`makeShrinkTool(pi)`).
- **Message snapshot**: `ctx.sessionManager.buildContextEntries()` → `SessionEntry[]`, then `entries.flatMap(sessionEntryToContextMessages)` (imported from `@earendil-works/pi-coding-agent`) → `AgentMessage[]`, double-cast to Pi-free `MessageLike[]` (transforms.ts structural type). This is the compaction-aware snapshot both shrink (`resolveTargetEntryId`) and cancel (`resolveTargetUuid`) use. Tools never receive `event.messages` (not the context event).
- **Entry scan**: `ctx.sessionManager.getEntries()` — read FRESH each invocation (C12); cancel uses it for marker scans.
- **Leaf id / append**: markers.ts wrappers call `pi.appendEntry(customType, entry)` then `ctx.sessionManager.getLeafId()` (markers.ts:226/254/282/330) — same synchronous tick (C7/GOTCHA #5).
- **Config**: `getConfig()` read once per execute (config.ts); gates: master `config.enabled` + `config.shrink.enabled` (no `config.cancel`).
- **UI**: `ctx.hasUI` + `ctx.ui.notify(text, "info")`.

## Architecture
`index.ts` registers factories → each tool is a thin typebox-schema'd fail-open adapter (never throws, always returns `AgentToolResult` with `details`) → resolution via pure `resolveShrinkTarget` (transforms.ts) on a `buildContextEntries()` snapshot → persistence via markers.ts wrappers (`appendShrinkMarker`/`appendCancelMarker`) → authoritative substitution on next inference in filter.ts.

## Start Here
`src/tools/shrink.ts:80` (ShrinkParams) — the union and its descriptions are the surface any v2.0 arm change (e.g. removing/altering `by_content_includes`) must touch, mirrored in `src/tools/cancel.ts:93` (hard parity) and `src/transforms.ts:771` (resolver).

## Risks / notes for v2.0 delta
- Removing `by_content_includes` from the union is a three-file coordinated change (shrink schema, cancel schema, resolver + `describeTarget`/`targetIsStructurallyValid` branches) plus the anyOf parity comment contract.
- Cancel's shrink-covering check uses LIVE resolution, not `pinnedEntryId` — a pinned shrink whose live target has drifted may not be cancel-by-target-able via the drifted message.
- Unknown arm behavior is host-schema rejection pre-execute (dead call, no tool body involvement).
- `occurrence` is not validated in tool bodies (typebox-constrained; resolver defaults non-"first" → last).