# Test strategy + baseline state (P1.M4.T1.S2)

## Baseline (observed live during S2 research, while S1 was still "Implementing")

- `npx tsc --noEmit -p tsconfig.json` → **exit 0**.
- `npx vitest run` → **8 files, 289 tests, 288 passing / 1 failing**.
- `src/markers.ts` **EXISTS** (S1 implemented it, matching the S1 PRP verbatim): exports `MulliganEnvelope`,
  `RewindMarker`, `ShrinkMarker`, `TurnMetric`, `ShrinkTarget`, the three `*Input` types, and
  `appendRewindMarker` / `appendShrinkMarker` / `appendTurnMetric` (all `: string | null`, try/catch → null).
  Imports already present: `randomUUID` (node:crypto), `type { ExtensionAPI, ExtensionContext }`,
  `nextSeq` (runtime), `type { Granularity }` (config), `type { FileLedger }` (ledger), `type { NoteInput }` (notes).
- `test/markers.test.ts` **EXISTS** (S1): hand-rolled `makePi` + `makeCtx` fakes; `beforeEach/afterEach clearAll()`;
  pinned payloads `REWIND_DATA`/`SHRINK_DATA`/`METRIC_DATA`; describe blocks for envelope/seq/id/C7/leaf-null/
  never-throws/types.

### ⚠ Known pre-existing S1 failure (NOT S2's to fix — out of scope)

`test/markers.test.ts` ~line 142:
```ts
expect(entry.id).toBe(id); // shrink stamps an id (uuid) — …
```
`entry.id` is the stamped **uuid**; `id` is `appendShrinkMarker`'s return = the **leaf id** (`"leaf-1"`). The
assertion is always false. This is a bug in the **S1 PRP's verbatim test code**, carried into the file. **S1 owns
its fix.** S2 must NOT modify S1's existing assertions; S2's NEW describe blocks must pass independently. When S2
begins, assume S1 is complete (this line fixed) → full suite green.

## How S2 appends (zero new files — APPEND to the two S1 files)

This subtask ships by **appending** to `src/markers.ts` and `test/markers.test.ts` (both created by S1). No new
files. No import changes to `markers.ts` (everything S2 needs — `ExtensionAPI`, `ExtensionContext` — is already
imported by S1).

### `src/markers.ts` — APPEND after S1's last wrapper (`appendTurnMetric`)

Add (in order):
1. `export interface NoteDetails { schema:"pi-mulligan"; v:1; kind:"note"; rewindId:string }` — the
   `CustomMessage` details envelope for `mulligan:note` (spec/04 §3 end). **NOT** a `MulliganEnvelope`
   (`kind:"note"` ∉ the marker kind union `"rewind"|"shrink"|"turn-metric"`).
2. `export type SetCheckpointResult = { entryId: string } | { error: string }` — `setCheckpoint`'s return.
3. `export function leaveNote(pi, content, rewindId): void` — try/catch swallow; `pi.sendMessage({customType:"mulligan:note",
   content, display:true, details:{schema,v:1,kind:"note",rewindId}})`, **no options arg** (C8).
4. `export function setCheckpoint(pi, ctx, name): SetCheckpointResult` — try/catch → `{error}`;
   `leafId = ctx.sessionManager.getLeafId(); if(!leafId) return {error:"no leaf"};
   pi.setLabel(leafId, \`mulligan:checkpoint:${name}\`); return {entryId: leafId}`.

### `test/markers.test.ts` — EXTEND `makePi`, ADD imports, APPEND describe blocks

1. **EXTEND `makePi`** (additive edit): add `sent` + `labels` capture arrays, `sendMessage` + `setLabel` methods,
   and `throwOnSendMessage` / `throwOnSetLabel` options. (S1's existing `appendEntry`/`appended` stay.)
2. **EXTEND the import** from `"../src/markers.js"`: add `leaveNote`, `setCheckpoint`, `type NoteDetails`,
   `type SetCheckpointResult`.
3. **REUSE `makeCtx`** (it already has `getLeafId` with `leafId` + `throwOnGetLeafId` options — exactly what
   `setCheckpoint` needs; no change required).
4. **APPEND describe blocks** at end of file: `leaveNote` (sendMessage args + envelope + no-options/C8 + void +
   never-throws), `setCheckpoint` (setLabel prefix + `{entryId}` success + `{error:"no leaf"}` + never-throws on
   thrown setLabel/getLeafId + the C1/C9 pi-vs-ctx split + union type), and a `NoteDetails`/`SetCheckpointResult`
   types block.

## Test-fake patterns (from `spec/reference/looper-smoke.proto.ts` A2/A4)

- **A2.sendMessage** (line 224): `pi.sendMessage({customType, content, display})` → `sm.getLeafEntry()` shows
  `type:"custom_message"`, `customType` matches. Unit-test fake mirrors this: a fake `pi.sendMessage` that
  captures the message object (and the optional `options` arg, asserted `undefined`).
- **A4.setLabel** (lines 234–238): `pi.setLabel(anchor.id, "looper-checkpoint")` → `sm.getLabel(anchor.id)`
  round-trips the label. Unit-test fake mirrors this: a fake `pi.setLabel` capturing `(entryId, label)`, and a
  fake `ctx.sessionManager.getLeafId` returning a scripted leaf id.

No real `pi -e` run is needed for these unit tests — hand-rolled fakes are sufficient and faster (mirrors S1).
The real end-to-end read-back (note appears in context; checkpoint label resolves on a `granularity:"checkpoint"`
rewind) is validated by the filter (P1.M4.T2) + the F-rewind-core / F-checkpoint integration scenarios (P1.M7.T2).