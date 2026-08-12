# 11 — File layout & build order

> The exact files to create and a prescriptive, TDD-flavored build sequence. Follow it top-to-bottom and you will have a working Mulligan. Each step is independently verifiable. Do not skip the unit-test tiers — the pure helpers are where ~all the correctness lives.

---

## 1. Repository layout

```
pi-mulligan/
├── spec/                       # this specification (read-only reference for the implementer)
│   ├── SPEC.md
│   ├── 01-…12-….md
│   └── reference/
│       ├── HANDOFF.md
│       └── looper-smoke.proto.ts
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                # extension factory: wiring
│   ├── config.ts               # load + validate + default settings
│   ├── log.ts                  # structured JSONL logger
│   ├── runtime.ts              # per-session runtime map (seq, baseline, lastFiltered)
│   ├── markers.ts              # pi.appendEntry / setLabel / sendMessage wrappers + id capture
│   ├── filter.ts               # the `context` handler (thin glue) + pipeline ordering + fail-open
│   ├── transforms.ts           # PURE: partitionIntoUnits, resolve*, applyRewind, applyShrink, filterPipeline
│   ├── ledger.ts               # PURE: extractFileLedger
│   ├── tokens.ts               # PURE: estimateTokens, resultBytes, approxTokens
│   ├── notes.ts                # PURE: validateNote, renderNote, renderBloatReminder, renderDriftNudge
│   ├── nudges.ts               # tool_result annotator + turn_end metric + shouldNudge/injectNudge
│   ├── snapshot/               # v1.2 working-tree revert: SnapshotStore + Git/CAS backends (@14-working-tree-revert.md)
│   │   ├── store.ts            # interface + detectAndCreate() factory + AsyncMutex
│   │   ├── git.ts              # GitBackend (external shadow repo: add/write-tree/commit-tree/update-ref; read-tree/checkout)
│   │   ├── cas.ts              # CasBackend (content-addressed store + mtime-shortcircuit) + explicit-paths mode
│   │   └── paths.ts            # PURE: resolveSafeWorkspacePath (reject .., NUL, .git/node_modules, abs-outside-workspace)
│   └── tools/
│       ├── rewind.ts
│       ├── shrink.ts
│       ├── checkpoint.ts
│       └── audit.ts
├── test/
│   ├── transforms.test.ts
│   ├── ledger.test.ts
│   ├── tokens.test.ts
│   ├── notes.test.ts
│   ├── pipeline.test.ts        # composition + protected + idempotency
│   └── integration/
│       ├── smoke.ts            # the integration harness (adapted from reference/looper-smoke.proto.ts)
│       └── scenarios.md        # how to run each F-* scenario from @10-testing.md
└── .pi/
    └── extensions/             # symlink or copy for auto-discovery during dev
```

### 1.1 `package.json` (minimum viable)
```jsonc
{
  "name": "pi-mulligan",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "pi": { "extensions": ["./src/index.ts"] },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "*",   // resolved by pi at load
    "typebox": "*"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^1"                            // or node:test
  },
  "scripts": {
    "test": "vitest run",
    "smoke": "pi -e ./src/index.ts -p \"$(cat test/integration/scenarios.md)\""
  }
}
```
> Note: at runtime, pi resolves `@earendil-works/pi-coding-agent` and `typebox` from its own install (extensions are jiti-loaded in pi's process). Declaring them here is for editor type-resolution and dev ergonomics; use `npm install` in the extension dir if you need local `node_modules` for IntelliSense, and consult `node_modules/@earendil-works/pi-coding-agent/dist/**/*.d.ts` for exact signatures (the spec reproduces them, but the `.d.ts` is authoritative).

### 1.2 `tsconfig.json` (minimum)
```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noImplicitAny": true, "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

---

## 2. Build order (do these in sequence; verify before proceeding)

### Step 0 — Scaffold & types (15 min)
- Create the files above as stubs. Get `pi -e ./src/index.ts -p "hi"` to load and print a `session_start` log line without error. **Verify:** no load error; a no-op extension runs.

### Step 1 — `config.ts` + `log.ts` + `runtime.ts` (30 min)
- Implement config load/validate/default (§09) and the structured logger (§04 §9).
- Implement `runtime(ctx)` returning the per-session `SessionRuntime`, created on `session_start`.
- **Verify:** a unit test that feeds a partial/invalid `mulligan` settings object and asserts the defaulted+validated output; bad values don't throw.

### Step 2 — Pure helpers: `tokens.ts`, `ledger.ts`, `notes.ts` (1–2 h)
- Implement `estimateTokens`, `resultBytes`, `approxTokens`.
- Implement `extractFileLedger` per `@04-data-model.md` §2.2.
- Implement `validateNote`, `renderNote`, `renderBloatReminder`, `renderDriftNudge`.
- **Verify:** the Tier-1 unit tests in `@10-testing.md` §1.6–1.8 pass. These have **zero Pi dependency**.

### Step 3 — Pure core: `transforms.ts` (2–3 h — the bulk)
- Implement `partitionIntoUnits`, `resolveLastToolCallGroup`, `resolveLastTurn`, `resolveCheckpoint`, `applyRewind`, `applyShrink`, `filterPipeline` exactly per `@06-context-filter.md`.
- **Verify:** Tier-1 §1.1–1.5 and §1.9 (composition, protected, idempotency) pass. Add the property tests (§3): pairing invariant, idempotency, monotonic shrinkage. **This is the most important step; do not proceed until the pairing invariant holds on randomized inputs.**

### Step 4 — `markers.ts` (30 min)
- Thin wrappers: `appendRewindMarker`, `appendShrinkMarker`, `appendTurnMetric`, `leaveNote`, `setCheckpoint`, each capturing the leaf id immediately after `pi.appendEntry` (C7) and incrementing `seq`.
- **Verify:** a tiny integration snippet that appends a marker and reads it back via `ctx.sessionManager.getEntries()`; assert shape + that it's a `custom` (not `custom_message`).

### Step 5 — `filter.ts` (1 h)
- Wire the `context` handler: read markers, call `filterPipeline`, cache `lastFiltered`, inject nudge, fail-open.
- **Verify (integration):** the F-rewind-core scenario — inject a canary, drive a rewind, assert the canary drops on the next `context.fire` and a second assistant message is produced. This is the spike's central proof, reproduced.

### Step 6 — Tools: `tools/rewind.ts`, `shrink.ts`, `audit.ts`, `cancel.ts` (2 h)
- Implement per `@05-tools.md`. Rewind composes ledger + note, persists marker + note, returns confirmation/warnings (v1.1: honors the §1 step-3b **guardrail** — no rewind wipes user input except a user-set checkpoint; `to_previous_prompt` is removed). Shrink validates + persists. Audit reads `lastFiltered` and renders. (v1.1: **`tools/checkpoint.ts` is removed** — checkpoint is now a human command; `mulligan_rewind`'s `granularity:"checkpoint"` is retained.)
- **Verify (integration):** F-shrink-persist, F-protected, F-maxdepth, F-checkpoint, F-failopen scenarios pass.

### Step 6b — Human commands + active-checkpoint banner (v1.1; ~1 h)
- Register three `pi.registerCommand` handlers: `/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit` (`@13` §2–§4). Each captures `pi` via closure, receives `(args, ctx: ExtensionCommandContext)`, writes labels + `ctx.ui.notify`. `/mulligan_audit` reuses `renderAuditReport` (`src/tools/audit.ts`) and writes to the transcript (never `event.messages`).
- Implement the **active-checkpoint banner** (`@13` §5): a `reconcileBanner(ctx)` helper that calls `ctx.ui.setWidget("mulligan:active-checkpoint", lines|undefined, {placement:"aboveEditor"})` from the active-checkpoint set; invoke it from the command handlers, `session_start`, and (defense-in-depth) at the tail of the `context` handler. Guard with `ctx.hasUI`; honor `config.ui.activeCheckpointBanner`.
- **Verify (integration):** F-ckptcmd, F-banner, F-useraudit, F-consent scenarios pass (`@10` §2.1).

### Step 6c — Working-tree revert: `snapshot/` + rewind integration (v1.2; ~3–4 h)
- Implement `snapshot/store.ts` (interface + `detectAndCreate` + `AsyncMutex`), `git.ts` (external shadow repo: `init` with external `GIT_DIR`/`GIT_WORK_TREE`; `add --all` + `write-tree` + `commit-tree` + `update-ref refs/mulligan/snapshots/*` capture; `read-tree` + `checkout --` restore — NO write command ever targets the source `.git`, only `rev-parse`/`ls-files` reads), `cas.ts` (content-addressed blobs + manifest + mtime/size short-circuit + the explicit-paths mode), `paths.ts` (pure path-safety). See `@14-working-tree-revert.md`.
- Wire `turn_start` capture + `/mulligan_checkpoint` capture (only when `config.revert.enabled`); wire `store.restore` into `rewindExecute` step 6b (`@05` §1). Honor the §1 granularity scope (`last_turn`/`checkpoint` only).
- **Verify:** `F-revert-git`, `F-revert-cas`, `F-revert-explicit`, `F-revert-failopen`, `F-revert-delete`, `F-revert-dirtyguard`, `F-revert-granularity`, `F-revert-reload` (`@10`); assert the user's `.git` is byte-identical (no new objects, no reflog/stash entry) and the shadow repo holds a protected ref that `retire()` clears; assert non-git CAS restore matches pre-span state; assert the dirty guard REFUSES (file in `refused`, context rewind still proceeds, nothing overwritten) when a file drifts after `agent_end`; assert explicit-paths mode reverts write/edit but NOT bash `sed` (warned); assert a locked file lands in `failed[]` without breaking the rewind; assert deletion is refused when `allowDeleteCreatedFiles` is off even with the flag set; assert reload still honors persisted refs.

### Step 7 — `nudges.ts` (1 h)
- `tool_result` annotator (bloat reminder) + `turn_end` metric + the `context` nudge injection path.
- **Verify (integration):** F-shrink-preventive and F-nudge-drift scenarios pass; assert `mulligan:nudge` is **never** persisted.

### Step 8 — `index.ts` wiring + edge pass (1 h)
- Register all tools; attach all handlers; wire config. Run through `@08-edge-cases.md` as a checklist (E1–E32) with targeted tests/scenarios.
- **Verify:** F-reload (markers survive `--session-id` re-open); full TUI manual smoke (§10 §4).

### Step 9 — Polish
- README (install, configure, usage). Decision-log link to `spec/`. Confirm `pi -e ./src/index.ts` with no `mulligan` config works out of the box (all defaults).
- Optional: package as a pi package (`pi install`) per `docs/packages.md`.

---

## 3. "Definition of done"

1. All Tier-1 unit tests green, including the pairing-invariant property test on randomized inputs.
2. All F-* integration scenarios green against a real `pi -p` run (log + JSONL assertions).
3. `mulligan:nudge` is provably never persisted (JSONL grep returns 0 across all scenarios).
4. Disabling via `config.enabled=false` makes the extension a pure no-op (no `context` transform, tools refuse cleanly).
5. An intentional filter exception does not break an agent turn (F-failopen).
6. README documents install, the four tools, configuration, and the "soft-delete / visible-in-`/tree`" guarantee.

## 4. Cross-references
- What each module implements → `@03-architecture.md` §7, `@04-data-model.md`, `@05-tools.md`, `@06-context-filter.md`, `@07-preventive-and-nudges.md`
- How to verify each → `@10-testing.md`