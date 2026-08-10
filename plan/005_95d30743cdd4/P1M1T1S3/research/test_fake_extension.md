# Research: Extending makePi / makeCtx for the target path

## Why the fakes must change (the S2 contract)

S2's rewritten `cancelExecute` resolves the target hint through a **message snapshot** it builds itself:

```
resolveTargetUuid(ctx, entries, target):
  snapshotEntries = ctx.sessionManager.buildContextEntries()          // NEW surface call
  messages        = snapshotEntries.flatMap(sessionEntryToContextMessages)
  matchedIndex    = resolveShrinkTarget(messages, target)             // null → no-match
  matchedEntryId  = entryIdAtMessageIndex(snapshotEntries, matchedIndex)
  // scan `entries` for covering markers; LIFO by data.seq
```

The existing `makeCtx` (test/tools/cancel.test.ts) scripts ONLY `getEntries()`. The **target path additionally calls `buildContextEntries()`**, so without scripting it the fake's `sessionManager` has no such method → `ctx.sessionManager.buildContextEntries is not a function` at runtime.

**The markerId path does NOT call `buildContextEntries()`** (S2 keeps it byte-for-byte), so the existing 7 markerId-path cases pass unchanged when `makeCtx` is extended backward-compatibly (default `contextEntries: []`, default non-throwing).

## The extended makeCtx (drop-in, backward compatible)

```ts
function makeCtx(opts: {
  sessionId?: string;
  leafId?: string | null;
  entries?: SessionEntry[];            // getEntries()  — marker entries (rewind/shrink/cancel)
  contextEntries?: SessionEntry[];     // buildContextEntries() — message entries (the snapshot)  ← NEW
  throwOnGetEntries?: boolean;
  throwOnBuildContextEntries?: boolean; // ← NEW (mirrors shrink.test.ts)
} = {}) {
  const sessionId = opts.sessionId ?? "s1";
  const scriptedLeafId: string | null = opts.leafId === undefined ? "leaf-1" : opts.leafId;
  const entries = opts.entries ?? [];
  const contextEntries = opts.contextEntries ?? [];
  const sessionManager = {
    getSessionId() { return sessionId; },
    getLeafId() { return scriptedLeafId; },
    getEntries() {
      if (opts.throwOnGetEntries) throw new Error("getEntries boom");
      return entries;
    },
    buildContextEntries() {                                   // ← NEW
      if (opts.throwOnBuildContextEntries) throw new Error("buildContextEntries boom");
      return contextEntries;
    },
  };
  return { ctx: { sessionManager } as unknown as ExtensionContext };
}
```

This is **structurally identical to shrink.test.ts's `makeCtx`** PLUS the `getEntries`/`throwOnGetEntries` arms cancel already has. shrink.test.ts is the verified precedent (it scripts exactly this `buildContextEntries` shape with `contextEntries` + `throwOnBuildContextEntries`).

## makePi — UNCHANGED

cancel only ever calls `pi.appendEntry` (via `appendCancelMarker`). The existing makePi (captures appendEntry, `throwOnAppend` flag) is complete. Do NOT touch it.

## CRITICAL alignment invariant

`snapshotEntries` (buildContextEntries result) and the marker `entries` (getEntries result) are **two separate arrays** in the fake, but they must be ALIGNED for the rewind-covering check:

- `entryIdAtMessageIndex(snapshotEntries, matchedIndex)` returns the ENTRY id of the message that matched.
- A rewind fixture's `data.hideEntryIds` must INCLUDE that exact entry id.
- So: the contextEntries (snapshot) entry that yields the matched message must have an `id` that also appears in some rewind's `hideEntryIds`.

The real `sessionEntryToContextMessages` returns `[entry.message]` for a `{type:"message"}` entry (verified Pi shape — shrink.test.ts GOTCHA #12). So a `{type:"message", id:"msg-A", message:{role:"toolResult", toolCallId:"call-A", ...}}` produces ONE message, and `entryIdAtMessageIndex([thatEntry], 0)` → `"msg-A"`.

## Fixture pattern (reuse shrink.test.ts's msgEntry / toolResult)

shrink.test.ts already defines the exact helpers we need:

```ts
let entrySeq = 0;
function msgEntry(role: string, extra: Record<string, unknown> = {}): SessionEntry {
  entrySeq += 1;
  return { type:"message", id:`e-${entrySeq}`, parentId:null, timestamp:"",
           message:{ role, ...extra } } as unknown as SessionEntry;
}
function toolResult(toolCallId: string, toolName: string, text: string) {
  return { role:"toolResult", toolCallId, toolName, content:[{type:"text", text}] };
}
```

Use these to build `contextEntries` (the snapshot). The marker fixtures (`makeRewindEntry`/`makeShrinkEntry`) live in cancel.test.ts already but need parameterization (see target_resolution_contract.md).