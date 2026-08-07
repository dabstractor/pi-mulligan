# Research Notes — P1.M1.T1.S2: Minimal `index.ts` stub

> Purpose: verify the extension-load contract so the PRP can specify a proven, deterministic
> validation gate. All findings are from the installed Pi 0.84.1 dist + docs.

## 1. Import path — VERIFIED (top-level re-export)

`ExtensionAPI` and `ExtensionFactory` are re-exported from the package root.

```
# dist/index.d.ts (line 7) — excerpt
export type { ..., ExtensionAPI, ExtensionFactory, ... } from "./core/extensions/index.ts";
```

- Package `exports` map: `"."` → `types: ./dist/index.d.ts`, `import: ./dist/index.js`.
- `package.json`: `main: ./dist/index.js`, `types: ./dist/index.d.ts`.
- **Conclusion**: `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"` resolves.
  Use `import type` (type-only) — `ExtensionAPI` is used only as a param annotation, so it is
  erased at transpile and adds zero runtime cost / risk. This matches Pi's own examples.

## 2. Factory signature — VERIFIED

`plan/.../architecture/api_verification.md §1` (verified against the .d.ts):

```ts
// dist/core/extensions/types.d.ts
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
```

- A Pi extension is a TS module with a **default-export** factory.
- May be sync or async (Pi awaits async factories before startup).
- For S2 we use a **sync** factory returning `void`.

## 3. `session_start` event — VERIFIED

`api_verification.md §7.5`:

```ts
interface SessionStartEvent {
  type: "session_start";
  reason: "startup" | "reload" | "new" | "resume" | "fork";
  previousSessionFile?: string;
}
// handler type: (event, ctx) => ... | Promise<...>
```

- Canonical usage (docs/extensions.md §session_start + examples/event-bus.ts):
  `pi.on("session_start", async (_event, ctx) => { ... })`.
- **Type-assignability of a zero-arg handler**: TS permits a function with FEWER params than the
  declared type. So `pi.on("session_start", () => { /* no-op */ })` type-checks. (Verified: the
  empirical stub below uses exactly this and `tsc --noEmit` would pass; the `-e` load also passed.)

## 4. Canonical examples (Pi's own repo)

- `examples/extensions/hello.ts` — minimal tool extension; uses
  `import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent"`.
- `examples/extensions/event-bus.ts` — uses `import type { ExtensionAPI, ExtensionContext }` and
  `pi.on("session_start", async (_event, ctx) => { ... })`.

## 5. Loading mechanism — VERIFIED

- `pi --help` → `--extension, -e <path>   Load an extension file (can be used multiple times)`.
- `pi --help` → `--print, -p   Non-interactive mode: process prompt and exit`.
- docs/extensions.md: "Extensions are loaded via jiti, so TypeScript works without compilation."
  No build/emit step. `tsc --noEmit` is a type-check gate only.

## 6. EMPIRICAL VALIDATION (the crux of this task) — PROVEN

Created the EXACT contract stub in a throwaway temp dir and ran the contract's validation command:

```ts
// index.ts (temp)
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    /* no-op stub */
  });
}
```

```
$ pi --version
0.84.1

$ env (relevant, redacted)
OPENAI_API_KEY=<set>   PI_PROVIDER=<set>   PI_MODEL=<set>

$ timeout 90 pi -e ./index.ts -p "hi"
EXIT=0
--- tail ---
Hi! I'm ready to help with coding tasks — reading files, running commands, editing code, debugging, and more. What would you like to work on?
--- grep for errors ---
(no matches)
```

**Conclusion**: the stub LOADS without error and COMPLETES A TURN (exit 0, clean model response).
This is precisely the S2 success criterion, proven end-to-end in this environment.

## 7. Load-error vs model-error distinction (for validation robustness)

`pi -e ./src/index.ts -p "hi"` does two things: (a) load+transpile+run the factory, (b) run one
model turn. A failure could come from either:

- **Load error** (what S2 must NOT produce): surfaces at startup — factory throws, import fails,
  jiti transpile error. Typically a stack trace referencing the extension file / "Failed to load
  extension". A no-op factory that only registers a `session_start` no-op cannot throw.
- **Model error** (environmental, NOT an S2 defect): surfaces during inference after the prompt —
  "Invalid API key", rate limit (429), network. If `pi -p "hi"` (WITHOUT `-e`) already fails this
  way, the extension is not to blame.

Deterministic (model-independent) signal that the stub itself is sound:
1. `npx tsc --noEmit -p tsconfig.json` exits 0 (catches bad import / wrong factory signature /
   unassignable handler) — **no model needed**.
2. jiti transpiles the file on load (the `-e` run proves this; if it didn't transpile, you'd get a
   load error, not a model response).

## 8. Dependencies on P1.M1.T1.S1 (the contract — assumed delivered)

S1 produces (per its PRP), all assumed present when S2 begins:
- `package.json` — ESM; `main:"src/index.ts"`; `pi.extensions:["./src/index.ts"]`;
  `dependencies: { "@earendil-works/pi-coding-agent":"*", "typebox":"*" }`;
  `devDependencies: { typescript:"^5", vitest:"^1", "@types/node":"^22" }`.
- `tsconfig.json` — strict, `types:["node"]`, `include:["src","test"]`.
- Dirs: `src/`, `src/tools/`, `test/`, `test/integration/`, `.pi/extensions/` (all empty).
- `node_modules/` populated via `npm install` (so `@earendil-works/pi-coding-agent` and
  `@types/node` resolve at top level → `tsc --noEmit` is meaningful, `import type` resolves).

S2 consumes these; it must NOT recreate or modify them.

## 9. Scope boundary (anti-overreach)

The contract says: "Do NOT register tools or handlers yet — this is a no-op extension that loads
cleanly." Therefore S2 writes ONLY `src/index.ts` containing:
- one `import type { ExtensionAPI }`,
- one default-export sync factory,
- one `pi.on("session_start", () => {})` no-op.

Explicitly OUT OF SCOPE (later subtasks): the `context` filter handler (P1.M4.T2), the four tools
`mulligan_*` (P1.M5), `config.ts`/`log.ts`/`runtime.ts` (P1.M1.T2–T4), any fail-open wrapper logic
(a no-op cannot fail-open meaningfully), tests (P1.M2+), README (P1.M7.T4).

The `session_start` no-op is chosen (vs. an empty factory body) because it (a) matches the literal
contract, (b) proves `pi.on(...)` resolves and the lifecycle event is wired, and (c) is the hook
`runtime.ts` (P1.M1.T4 "session_start initialization") will later populate — so it's a forward-
compatible anchor, not dead code.

## 10. Optional: project-local auto-discovery entry

S1 created `.pi/extensions/` empty and noted the entry is "finalized in S2 once index.ts exists."
The package.json `pi.extensions:["./src/index.ts"]` field already provides project-local discovery,
and the contract's validation uses `-e` directly, so populating `.pi/extensions/` is OPTIONAL. If
done, a relative symlink is the zero-duplication choice:
`ln -s ../../src/index.ts .pi/extensions/index.ts` (paths relative to the link location).
Marked optional in the PRP; not required to satisfy the stated success criterion.