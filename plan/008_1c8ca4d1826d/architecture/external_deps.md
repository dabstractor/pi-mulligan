# External Dependencies & Toolchain — v2.0 delta

No NEW external dependencies. The delta is confined to existing surfaces. Pinned facts for downstream agents:

- **Runtime host**: `@earendil-works/pi-coding-agent` 0.84.1 (dev dep; peer `*`). Extension entry `src/index.ts`.
  - Host validates tool args BEFORE `execute()` (C13): typebox `Value.Convert` + compiled `Check`. A removed
    union arm (e.g. `by_content_includes`) becomes a **host-side schema rejection** — `execute` never runs.
    Schema-rejection tests must go through the typebox schema (see `hostPipelinePasses` harness,
    `test/prepare-args.test.ts`), not through `tool.execute`.
  - `sessionEntryToContextMessages`, `defineTool` imported from the host package (tools/shrink.ts, tools/cancel.ts).
- **typebox** (peer `*`): `Type`/`Static` — `ShrinkParams` (shrink.ts:80–106), `CancelParams` (cancel.ts:93–133).
  Both unions must stay in hard structural parity (cancel hands `params.target` straight to `resolveShrinkTarget`).
- **vitest ^1**: `vitest run`; scripts: `test`, `smoke` (= `node test/integration/run-smoke.mjs`), `typecheck`
  (= `tsc --noEmit`). Integration smoke drives a REAL `pi -e` process per scenario; canaries must stay
  byte-identical between `test/integration/smoke.ts` and `run-smoke.mjs` (GOTCHA #8).
- **Node >= 22.19** (engines).
- No docs/ dir; docs surfaces = `README.md`, `VERIFICATION.md`, JSDoc-in-src (Mode A).
- spec/ is at v2.0 (READ-ONLY for this delta — no spec edits; stale §6 strings reported to owner in wrap-up).