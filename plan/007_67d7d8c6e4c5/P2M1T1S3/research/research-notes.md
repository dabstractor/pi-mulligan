# P2.M1.T1.S3 — Research Notes (Tests for the checkpoint commands)

## What this item builds
A NEW file `test/commands.test.ts` covering all paths of the two checkpoint slash-command factories +
the exported `clearCheckpointByName` helper. Test-only (Mode A: no docs).

## Verified inputs (S1 is COMPLETE — commands.ts landed)
`grep -nE '^export function' src/commands.ts` →
- `clearCheckpointByName(pi: ExtensionAPI, ctx: ExtensionContext, name: string): boolean`  (line ~55)
- `makeCheckpointCommand(pi): { description; handler: (args, ctx) => Promise<void> }`         (line ~108)
- `makeCheckpointRevokeCommand(pi): { description; handler: (args, ctx) => Promise<void> }`  (line ~160)

`makeCheckpointCommand(pi).handler(args, ctx)` is the testable seam — call it directly with the fakes.
`args` is the RAW string (e.g. `"before-refactor"`); `ctx` is `ExtensionCommandContext`.

## CRITICAL reconciliation #1 — reconcileBanner is a STUB; do NOT assert setWidget
- `src/banner.ts` exports `reconcileBanner(_ctx)` = **typed no-op stub**. Real impl is P2.M3.T1.S2 (Planned).
- Item description case (a) says: "reconcileBanner called (verify setWidget called)". The parenthetical
  assumes the banner is real → it would call `ctx.ui.setWidget`. The stub does NOT.
- ⇒ Asserting `expect(widgets).toHaveLength(1)` would FAIL. The CORRECT contract assertion is:
  commands.ts CALLS `reconcileBanner(ctx)` after a successful set/revoke. Verify it via a `vi.mock` spy
  on the banner module (exact idiom used by test/index.test.ts for settings.js + log.js):
    `vi.mock("../src/banner.js", () => ({ reconcileBanner: vi.fn() }));`
    then `import { reconcileBanner } from "../src/banner.js";` and `vi.mocked(reconcileBanner).toHaveBeenCalledWith(ctx)`.
- This is robust to P2.M3.T1.S2 filling the stub: commands.test.ts owns the COMMAND contract (it calls
  reconcileBanner), P2.M3.T1.S4 will own the BANNER behavior separately. Provide setWidget on the fake
  ctx anyway (defensive + matches item description's fake-ctx spec) but never assert on it.

## House test idiom (mirror test/tools/checkpoint.test.ts EXACTLY)
- vitest: `import { describe, it, expect, expectTypeOf, beforeEach, afterEach, vi } from "vitest";`
- Hand-rolled fakes — NO `vi.fn()` for Pi objects (arrays captured + pushed in literal methods).
- `.js` import paths (`../src/commands.js`).
- Reset in beforeEach/afterEach: `clearAll()` (runtime map) + `setConfig(undefined)` (config → DEFAULT_CONFIG,
  enabled:true) so a prior disabled test never bleeds. (checkpoint.test.ts does exactly this.)
- `describe` block per concern; `it.each` for regex accept/reject tables.

## Fake shapes required
### makePi (captures setLabel; label can be `string | undefined` — revoke passes undefined)
```
function makePi(opts: { throwOnSetLabel?: boolean } = {}) {
  const labels: { entryId: string; label: string | undefined }[] = [];
  const pi = {
    setLabel(entryId: string, label: string | undefined) {
      if (opts.throwOnSetLabel) throw new Error("setLabel boom");
      labels.push({ entryId, label });
    },
  };
  return { labels, pi: pi as unknown as ExtensionAPI };
}
```
NOTE: registerCommand is NOT needed here — the factory captures pi; tests call `.handler(...)` directly.
(Only index.test.ts's makePi needs registerCommand.)

### makeCtx (ExtensionCommandContext minimal surface: hasUI, ui.{notify,setWidget}, sessionManager.{getBranch,getEntries,getLabel,getLeafId})
```
function makeCtx(opts: { hasUI?: boolean; branch?: unknown[]; entries?: unknown[]; labelMap?: Record<string,string|undefined> } = {}) {
  const notifies: { msg: string; type: string }[] = [];
  const widgets: { key: string; content: unknown; options?: unknown }[] = [];
  const branch = opts.branch ?? [ {type:"message",id:"u1",parentId:null,message:{role:"user",content:[]}},
                                  {type:"message",id:"leaf-1",parentId:"u1",message:{role:"assistant",content:[]}} ];
  const entries = opts.entries ?? [];
  const labelMap = opts.labelMap ?? {};
  const ctx = {
    hasUI: opts.hasUI ?? true,
    ui: { notify(msg,t){ notifies.push({msg,type:t}); }, setWidget(k,c,o){ widgets.push({key:k,content:c,options:o}); } },
    sessionManager: { getBranch(){ return branch; }, getEntries(){ return entries; },
                      getLabel(id){ return labelMap[id]; }, getLeafId(){ return "leaf-1"; } },
  };
  return { notifies, widgets, ctx: ctx as unknown as ExtensionCommandContext };
}
```

## Verbatim notify strings to assert (read straight from src/commands.ts)
SET valid success (spec/13 §2 step 5, type "warning"):
  `Mulligan: checkpoint '<name>' set. Until you revoke it, the agent may rewind across your subsequent prompts back to this point (your prompts after here can be hidden). Revoke with /mulligan_checkpoint_revoke <name>.`
SET invalid name (spec/13 §2 step 1, type "warning"):
  `Mulligan: invalid checkpoint name '<name>' (lowercase, digits, hyphen, underscore; max 40)`
SET/REVOKE disabled (NO "Mulligan: " prefix, type "warning"):
  `Mulligan is disabled`
REVOKE success (spec/13 §3 step 5, type "info"):
  `Mulligan: checkpoint '<name>' revoked. The agent can no longer rewind across your prompts to it.`
REVOKE not-found (spec/13 §3 step 2, type "info"):
  `Mulligan: no active checkpoint named '<name>'.`

## setCheckpoint behavior (markers.ts:455) — what the SET handler delegates to
- walks `ctx.sessionManager.getBranch()` ROOT→LEAF BACKWARDS to last `message` entry with a non-empty
  `message.role` string → `stableId`. (getBranch must end in a message entry for the valid test.)
- `pi.setLabel(stableId, "mulligan:checkpoint:"+name)`; returns `{entryId:stableId}`.
- empty branch / no message entry → `{error:"no conversation message to checkpoint (...)"}` → handler
  notifies "could not set checkpoint: ...". (Good bonus: no-stable-entry path.)
- Never throws (try/catch).

## clearCheckpointByName behavior (commands.ts:55) — two-phase discovery+confirm (THE key design)
1. DISCOVERY: scan `ctx.sessionManager.getEntries()` for entries `{type:"label", label===needle, targetId:string}`
   → collect candidate targetIds.
2. CONFIRM: for each candidate, if `ctx.sessionManager.getLabel(id) === needle` (latest-wins) →
   `pi.setLabel(id, undefined)`, `cleared=true`.
3. Returns `cleared` (true iff ≥1 cleared). Never throws.
WHY two-phase: Pi label map is APPEND-ONLY; a revoke appends a CLEAR entry, so the raw historical SET entry
stays in getEntries(). Confirming via getLabel(id) filters out STALE labels.
⇒ HIGH-VALUE bonus test: script entries=[{type:label,needle,"leaf-1"}] but labelMap={"leaf-1":undefined}
   (already cleared) → clearCheckpointByName returns FALSE, setLabel NOT called (validates the confirm phase).

## Disabled gate ordering
makeCheckpointCommand: parse name → `getConfig().enabled` check → `validCheckpointName` check.
⇒ disabled fires BEFORE name validation. Bonus test: disabled + invalid name → still "Mulligan is disabled".
(makeCheckpointRevokeCommand: parse name → enabled check → clearCheckpointByName.)

## S2 context (parallel — index.ts registration, NOT this item's concern)
S2 registers the two commands in src/index.ts via pi.registerCommand + adds a makePi registerCommand
capture to test/index.test.ts. S3 is INDEPENDENT: it tests the handler factories directly
(makeCheckpointCommand(fakePi).handler(args, fakeCtx)). S3 does NOT touch index.ts or index.test.ts.

## Validation commands (verified from package.json)
- `npm run typecheck` = `tsc --noEmit` (strict; include src+test)
- `npm test` = `vitest run` (full suite) — run the new file in isolation: `npx vitest run test/commands.test.ts`