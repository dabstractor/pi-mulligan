# P1.M2.T1.S2 Research — Terse result + ctx.ui.notify echo (shrink)

## Scope (one sentence)
In `src/tools/shrink.ts`: (a) make `feedbackText(matched)` terse, (b) add a `ctx.ui.notify`
operator echo (own try/catch, E13) after `appendShrinkMarker`, (c) add `cap(s,n)`, (d) add
`describeTarget(target)`. In `test/tools/shrink.test.ts`: extend `makeCtx` with a `ui` fake +
`hasUI` flag + `notifyCalls[]`, AND fix the 11 existing assertions that hardcode the OLD verbose
feedback text (S2's text change breaks them). NO new notify/config tests (those are S3).

## Verified Pi API surfaces (types.d.ts — the actual file)
```
/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  L68  export interface ExtensionUIContext {
  L76      notify(message: string, type?: "info" | "warning" | "error"): void;   ← (message, type?) : void
  L209 export interface ExtensionContext {
  L211     ui: ExtensionUIContext;        ← ctx.ui
  L215     hasUI: boolean;                ← ctx.hasUI (true in TUI + RPC modes)
```
→ `ctx` (6th shrinkExecute param, typed `ExtensionContext`) already exposes `.ui.notify` and `.hasUI`.
No import change needed in shrink.ts. The notify call is `ctx.ui.notify(msg, "info")`; guard `if (ctx.hasUI)`.

## shrink.ts — exact insertion anchors (verified by reading the file)
- `feedbackText` is at **lines 143–149** (with a JSDoc on 140–142 that says "Copy verbatim incl. the
  'from the next turn on' clause and the `(Matched now: yes|no)` slot" → becomes STALE; update it).
- **persist + return** block is at **lines 289–300**:
  - L289 `const markerId = appendShrinkMarker(pi, ctx, {`
  - L295 `} satisfies ShrinkMarkerInput);`  ← INSERT notify block AFTER this line, BEFORE the (6) return comment.
  - L297–300 `return { content:[...feedbackText(matched)...], details:{matched,markerId} };`
- The whole execute body is inside ONE outer `try { ... } catch (e) {` (E13 → refusal). The notify
  block gets its OWN inner try/catch per the contract (UI failure isolated + self-documenting).
- **In-scope vars at insertion point** (all confirmed): `config` (L262 `const config = getConfig()`),
  `params.replacement`, `params.target`, `ctx`, `matched`. So `cap(params.replacement, config.shrink.notifyMaxChars)`
  and `describeTarget(params.target)` resolve. `config.shrink.notifyMaxChars` is S1's output (default 2048).

## 🚨 THE CRITICAL FINDING — 11 existing test assertions hardcode the OLD verbose feedback text
`npm grep` of `test/tools/shrink.test.ts` for the feedback string. S2's terse change (`Mulligan: shrink
recorded. Matched: yes|no.`) makes ALL of these fail. S2 MUST update them (direct consequence of S2's
own change; NOT S3's job). Tally (verified line numbers):
- **L275–277** ONE exact `.toBe("Mulligan: shrink recorded. Matched message will show the replacement
  from the next turn on. (Matched now: yes)")` → replace whole string with `"Mulligan: shrink recorded. Matched: yes."`.
- **6×** `.toContain("(Matched now: yes)")` at **L311, L323, L334, L417, L479, L500** → `.toContain("Matched: yes")`.
- **4×** `.toContain("(Matched now: no)")` at **L255, L436, L449, L458** → `.toContain("Matched: no")`.
Why `.toContain("Matched: yes")` is safe: the terse string `Mulligan: shrink recorded. Matched: yes.`
CONTAINS the substring `Matched: yes`. (No false-positive risk — only one feedback string is produced.)
The exact `.toBe` at L275 is the yes-slot full-string check; change it to the new full terse string.

## makeCtx extension (test/tools/shrink.test.ts) — current vs target
- CURRENT: `makeCtx(opts)` returns `{ ctx: { sessionManager } as unknown as ExtensionContext }`. ONLY
  `sessionManager` is on the ctx object. There is NO `ui` and NO `hasUI`.
- TARGET (additive — does NOT break existing `const { ctx } = makeCtx(...)` consumers):
  add `hasUI?: boolean` (default **true**) to opts; build a `notifyCalls: {message:string; type?:string}[]`;
  put `hasUI: opts.hasUI ?? true` + `ui: { notify(m,t){ notifyCalls.push({message:m,type:t}); } }` on ctx;
  return `{ ctx: ctx as unknown as ExtensionContext, notifyCalls }`.
- After S2, EVERY passing-shrink test will ALSO push one notify entry (hasUI defaults true; the block
  runs after persist). That is harmless — existing tests ignore `notifyCalls`; only S3's new tests assert it.

## Cross-item dependency (S2 → S1)
S2 references `config.shrink.notifyMaxChars`, which **S1 adds** to `MulliganConfig.shrink` (default 2048,
validated). WITHOUT S1: (type) `config.shrink.notifyMaxChars` is a TS error → `npx tsc --noEmit` fails;
(runtime) cap receives `undefined` → `s.length <= undefined` is `false` → `slice(0, undefined)===""` →
empty replacement shown. So S2's cap/notify correctness REQUIRES S1 applied. File surfaces are disjoint
(S1=config.ts+test/config.ts; S2=shrink.ts+test/tools/shrink.test.ts) → no merge conflict. The
feedbackText change + 11 assertion fixes are independent of S1 but live in S2's files.

## cap + describeTarget (verified against architecture/m2_shrink_operator_echo.md)
```ts
// module-private, in the helpers region (next to isNonEmpty / targetIsStructurallyValid)
function cap(s: string, max: number): string {
  if (typeof s !== "string" || s.length <= max) return s;            // defensive typeof (matches isNonEmpty style)
  return s.slice(0, max) + `…(${s.length} chars total)`;             // U+2026 ellipsis; "<N> chars total" suffix
}
function describeTarget(target: ShrinkArgs["target"]): string {       // ShrinkArgs["target"] = the 3-arm union
  if (!target || typeof target !== "object") return "message";
  if ("by_tool_call_id" in target) return `tool call ${target.by_tool_call_id}`;
  if ("by_tool_name" in target) return `${target.by_tool_name} result`;
  if ("by_content_includes" in target) return `message containing "${target.by_content_includes.slice(0, 40)}"`;
  return "message";
}
```
- `ShrinkArgs["target"]` is the indexed access of the execute param type (3-arm union) — verified in use.
- describeTarget truncates `by_content_includes` to 40 chars in the toast (ergonomics; verified in arch doc).

## notify block (the insertion — verbatim from contract + arch doc)
```ts
    } satisfies ShrinkMarkerInput);

    // (5b) operator echo (spec/05 §2 step 5 — zero context cost; the replacement is NOT in the tool result).
    try {
      if (ctx.hasUI) {
        const capped = cap(params.replacement, config.shrink.notifyMaxChars);
        ctx.ui.notify(`Shrunk ${describeTarget(params.target)} — replacement:\n<<<\n${capped}\n>>>`, "info");
      }
    } catch {
      // E13: a UI failure must never break the tool — the marker is already persisted.
    }

    // (6) return ...
```

## Scope boundaries (S2 does NOT touch)
- S3 owns: NEW notify-echo tests (hasUI true/false, cap truncation, E13 ui-throws-never-breaks) +
  notifyMaxChars config-validation tests. S2 only fixes the 11 assertions its OWN text change breaks.
- S1 owns: config.ts (notifyMaxChars knob). S2 must NOT edit config.ts.
- Unchanged in shrink.ts: ShrinkParams schema, SHRINK_DESC, targetIsStructurallyValid,
  resolveTargetEntryId, appendShrinkMarker call, ShrinkDetails, the outer try/catch.