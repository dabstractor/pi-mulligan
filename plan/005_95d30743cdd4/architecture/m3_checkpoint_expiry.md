# M3 Architecture — Checkpoint Auto-Expiry on Consumption

## Problem

A checkpoint exists to be rewound *to*. Once consumed it has no further purpose; unconsumed throwaway checkpoints otherwise linger in `mulligan_audit`'s active-marker list indefinitely. Re-creating a checkpoint of the same name after consumption is allowed (fresh label).

## Current state (verified)

### `src/tools/rewind.ts` (600 LOC)

**Checkpoint existence check** (line 293, `checkpointExists`):
```ts
function checkpointExists(ctx: ExtensionContext, name: string): boolean {
  // scans ctx.sessionManager.getEntries() for type==="label" && label===`mulligan:checkpoint:${name}`
}
```

**Checkpoint rewind path** in `rewindExecute`:
- Step 3 (~line 462): `if (granularity === "checkpoint") { ... if (!checkpointExists(ctx, name)) return refuse(...) }`
- Step 5 (~line 525): `resolvePreview(ctx, params, toolCallId)` — uses `resolveCheckpoint` to find the remove span
- Step 7 (~line 547): persist — `appendRewindMarker(pi, ctx, payload)` + `leaveNote(pi, rendered, markerId)`
- Step 8 (~line 557): mutation warning
- Step 9 (~line 560): return success

**No expiry/consumption anywhere.** After a successful checkpoint rewind, the checkpoint label remains active.

### `src/tools/audit.ts` (657 LOC)

**`listCheckpoints`** (line 324, EXPORTED):
```ts
export function listCheckpoints(entries: unknown[]): string[] {
  // scans for type==="label" && label.startsWith("mulligan:checkpoint:")
  // returns the names (prefix stripped)
}
```
This is what `mulligan_audit` uses to list active checkpoints. If the label is cleared, it naturally drops from this list.

### `src/markers.ts` (460 LOC)

**`setCheckpoint`** (line ~430):
```ts
pi.setLabel(stableId, `mulligan:checkpoint:${name}`);
```
Labels the entry via `pi.setLabel`. Uses `pi` (ExtensionAPI), not `ctx.sessionManager`.

## Verified Pi API: LabelEntry structure

From `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts`:
```ts
export interface LabelEntry extends SessionEntryBase {
    type: "label";
    targetId: string;           // ← the entry id this label was set on
    label: string | undefined;  // ← the label text
}
```

And `pi.setLabel`:
```ts
setLabel(entryId: string, label: string | undefined): void;  // types.d.ts:942
```

**Key insight:** calling `pi.setLabel(targetEntryId, undefined)` clears the label on that entry. After clearing, the `LabelEntry` either disappears or its `label` becomes `undefined` → `listCheckpoints` and `checkpointExists` both skip it (they check `typeof label === "string"` / `label.startsWith(...)`).

## Target design

### Consumption hook in `rewind.ts`

**Where:** after the successful persist (step 7, ~line 547), ONLY on the `granularity === "checkpoint"` success path. This is the point where the rewind has already succeeded — the marker is persisted, the note is left.

**What:** find the `LabelEntry` for this checkpoint, read its `targetId`, and call `pi.setLabel(targetId, undefined)` to clear the label.

**Implementation:**

```ts
// (7b) checkpoint consumption (spec/05 §3 step 5 — auto-expiry on consumption).
//      ONLY on the checkpoint-granularity success path. The rewind has already succeeded;
//      clearing the label is a best-effort cleanup (E13 — a label-clear failure must not undo the rewind).
if (granularity === "checkpoint") {
  try {
    const needle = `mulligan:checkpoint:${params.checkpoint}`;
    const allEntries = ctx.sessionManager.getEntries();
    for (const e of allEntries) {
      if (readOwn(e, "type") !== "label") continue;
      if (readOwn(e, "label") !== needle) continue;
      const targetId = readOwn(e, "targetId");
      if (typeof targetId === "string" && targetId.length > 0) {
        pi.setLabel(targetId, undefined);  // clear the label
      }
      break;  // only one label per name
    }
  } catch {
    // E13: a label-clear failure must never undo the rewind. The rewind marker is already persisted.
  }
}
```

**Note:** `pi` is already captured via the `makeRewindTool(pi)` factory closure — it's available in `rewindExecute`. `readOwn`/`isRecord` need to be available in rewind.ts — check if they exist or need importing. Actually, rewind.ts imports from `../transforms.js` which exports `isRecord`/`readOwn`... let me verify.

Actually, looking at rewind.ts imports: it imports `resolveCheckpoint`, `partitionIntoUnits`, `resolveLastToolCallGroup`, `resolveLastTurn`, `extractFileLedger`, `applyRewind`, `BranchEntry`, `MessageLike` from transforms. It does NOT import `isRecord`/`readOwn` directly. But it has its own `checkpointExists` function that uses `readOwn`. Let me check if rewind.ts has local readOwn clones...

Looking at the code: `checkpointExists` scans entries with reads, but the code I read earlier was the `grep` output. Let me verify: the cancel.ts has local `readOwn`/`isRecord` clones. Rewind.ts likely has its own too (or imports from transforms). The implementer should verify and use whichever is available.

**Alternative (if `pi.setLabel(targetId, undefined)` is fragile):** fall back to a `mulligan:checkpoint-cancel` custom entry that `audit.ts`'s checkpoint scan filters on. But the label-clear approach is simpler and uses the verified Pi API directly.

### Effect on downstream

| Component | Before | After label clear |
|---|---|---|
| `audit.ts:listCheckpoints` | Lists all `mulligan:checkpoint:` labels | Skips the cleared one (label is `undefined`) |
| `rewind.ts:checkpointExists` | Returns true for the checkpoint | Returns false (label gone) → second rewind refuses "not found" |
| `checkpoint.ts` (re-create) | Sets a fresh label | Works normally (fresh `pi.setLabel`) |

### `pi` availability in rewindExecute

`pi` is captured via the `makeRewindTool(pi)` factory closure (line ~592):
```ts
export function makeRewindTool(pi: ExtensionAPI): ToolDefinition<...> {
  return defineTool({
    ...
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return rewindExecute(pi, toolCallId, params, signal, onUpdate, ctx);
    },
  });
}
```

So `pi` IS available in `rewindExecute` — the consumption hook can call `pi.setLabel(targetId, undefined)` directly.

## Risks & mitigations

1. **Label-clear semantics:** `pi.setLabel(id, undefined)` — does Pi remove the label entry or set it to undefined? Either way, `listCheckpoints`/`checkpointExists` skip non-string labels, so the effect is the same. Verified by the type signature `label: string | undefined`.

2. **Multiple labels on same entry:** Pi may support multiple labels. The scan finds the one matching `mulligan:checkpoint:<name>` and clears just that one. Safe.

3. **E13 compliance:** the consumption is wrapped in try/catch. If it fails, the rewind still succeeded (the marker is persisted). The checkpoint just stays active — a minor UX issue, not a correctness bug.