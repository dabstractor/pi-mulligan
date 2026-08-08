# Verified Pi API signatures (P1.M4.T1.S2: leaveNote + setCheckpoint)

Verified against the **installed** Pi types at
`/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/`
(Pi `0.84.x`, matching `spec/02` proven-constraints + `api_verification.md`).
These are the load-bearing signatures for the two wrappers this subtask ships.

## 1. `pi.sendMessage` — `leaveNote`'s only Pi call

```ts
// dist/core/extensions/types.d.ts:924 (ExtensionAPI)
sendMessage<T = unknown>(
  message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
): void;
```

- **Returns `void`** (the ExtensionAPI method — the `ReplacedSessionContext` variant at line 298 returns
  `Promise<void>`, but the tool-facing `pi.sendMessage` is the synchronous `void` one; C8 calls it
  "safe and synchronous-ish"). `leaveNote` does **not** await.
- `message.content` is `string | (TextContent | ImageContent)[]` — **a plain string is valid**; `leaveNote`
  passes the rendered-note string directly.
- `message.details` is `T` (generic) → typing it as `NoteDetails` gives compile-time shape checking.
- **`options` is OPTIONAL.** Leaving it out = no `triggerTurn` = default mid-turn behavior. **CRITICAL (C8):
  do NOT pass `triggerTurn: true` from inside a tool** — we are mid-turn; the default is correct. The
  wrapper passes ONLY the message object (no second arg). The unit test asserts `options === undefined`.
- Result on disk: a `CustomMessageEntry` (see §3) that **IS in LLM context** (spec/04 §1 table;
  `mulligan:note` → `custom_message` → in context = yes). This is the whole point — the resumed model
  reads the note as its most-recent context.

## 2. `pi.setLabel` — `setCheckpoint`'s only Pi write

```ts
// dist/core/extensions/types.d.ts:942 (ExtensionAPI)
setLabel(entryId: string, label: string | undefined): void;
```

- **On `ExtensionAPI` (`pi`), NOT on `ReadonlySessionManager`.** Confirmed: `ReadonlySessionManager`
  (session-manager.d.ts:140) is a `Pick` of read methods only (`getLabel` yes, `setLabel` **no**) — C1.
  So writes go through `pi.setLabel`; reads go through `ctx.sessionManager.getLabel`. `setCheckpoint`
  takes BOTH `pi` and `ctx` for exactly this split (mirrors S1's append wrappers).
- `label` accepts `string | undefined` (undefined clears the label). `setCheckpoint` always passes a
  concrete string: `` `mulligan:checkpoint:${name}` ``.
- Result on disk: a `LabelEntry` (see §4) that does **NOT** participate in LLM context (spec/04 §6;
  checkpoints are resolved by the filter only when a `granularity:"checkpoint"` rewind targets them).

## 3. `ctx.sessionManager.getLeafId` — the checkpoint target

```ts
// dist/core/session-manager.d.ts:239 (on SessionManager → present on ReadonlySessionManager)
getLeafId(): string | null;
// also: getSessionId(): string  (line 207) ; getLabel(id): string | undefined (line 249)
```

- **Returns `string | null`** — can be null (empty session / no leaf). `setCheckpoint` MUST null-check:
  `if (!leafId) return { error: "no leaf" }`. (api_verification.md §4 + discrepancy #2.)
- C12: read `ctx.sessionManager` **fresh** each call (never cache the handle). Both wrappers honor this
  (they dereference `ctx.sessionManager` inside the function body).

## 4. Entry shapes the wrappers produce (spec/04 §1 table; session-manager.d.ts)

```ts
// dist/core/session-manager.d.ts:97 — what leaveNote's sendMessage appends
export interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
  type: "custom_message";   // ← mulligan:note becomes THIS (in LLM context)
  customType: string;       // "mulligan:note"
  content: string | (TextContent | ImageContent)[];
  details?: T;              // NoteDetails
  display: boolean;         // true
}

// dist/core/session-manager.d.ts:75 — what setCheckpoint's setLabel appends
export interface LabelEntry extends SessionEntryBase {
  type: "label";            // ← mulligan:checkpoint:<name> becomes THIS (NOT in context)
  targetId: string;         // the leafId we labeled
  label: string | undefined;// "mulligan:checkpoint:<name>"
}
```

## 5. Cross-references (the authoritative chain)

- `spec/02-proven-constraints.md`: **C1** (ReadonlySessionManager — setLabel absent),
  **C8** (sendMessage from a tool is safe; do NOT pass triggerTurn:true), **C9** (setLabel/getLabel
  round-trip works; setLabel on `pi`), **C12** (read sessionManager fresh).
- `spec/04-data-model.md`: **§1** (envelope + customType→entry-type table: `mulligan:note`=custom_message/in-context,
  checkpoint=label/not-in-context), **§3 end** (note details = `{schema:"pi-mulligan", v:1, kind:"note", rewindId}`),
  **§6** (checkpoint = LabelEntry, prefix `mulligan:checkpoint:`, names `/^[a-z0-9_-]{1,40}$/`).
- `spec/05-tools.md`: **§1 step 6** (the rewind tool's exact leaveNote call: `pi.sendMessage({customType:"mulligan:note",
  content: renderedNote, display:true, details:{schema, v:1, kind:"note", rewindId}})`), **§3** (checkpoint tool:
  validate name → `getLeafId` → `setLabel(leafId, prefix+name)` → return entry id).
- `spec/reference/looper-smoke.proto.ts`: **A2.sendMessage** (line 224) + **A4.setLabel** (lines 234–238) —
  the empirical proof patterns the unit-test fakes mirror.
- `plan/001_2e5baf25fe9f/architecture/api_verification.md`: §2.1 (sendMessage/setLabel signatures),
  §4 (getLeafId→string|null), §5 (CustomMessageEntry/LabelEntry), §9 (constraint table).

## 6. The rewindId semantics (interface note for the rewind tool, P1.M5.T1.S1)

`leaveNote(pi, content, rewindId)` is **rewindId-agnostic**: it stuffs whatever `rewindId` it's given into
`details.rewindId`. `spec/04 §3` literally says `rewindId: <marker.id>` (the marker's uuid). BUT the rewind
tool's only handle to the marker is `appendRewindMarker`'s **return value = the marker's entry id (leaf id)**,
NOT the uuid (S1's wrapper generates the uuid internally and returns the leaf id). So in practice the rewind
tool will pass the **leaf id** as `rewindId`. Both ids are unique-per-entry, so note↔marker correlation works
either way; the leaf id is the value the call chain actually yields. **`leaveNote` does not care** — this is
the rewind tool's decision (P1.M5.T1.S1). Flagged here so the interface is unambiguous.