# External Dependencies — pi-mulligan

> Verified against installed packages at
> `/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/`

## 1. Runtime Dependencies

### 1.1 `@earendil-works/pi-coding-agent`

- **Version:** Installed at `0.84.x` (globally via `/home/dustin/.local/lib/node_modules/`)
- **Role:** Provides `ExtensionAPI`, `ExtensionContext`, event types, message types,
  session manager types. Resolved by Pi at extension load time (jiti transpilation).
- **Import paths:**
  - `import type { ExtensionAPI, ExtensionContext, ContextEvent, ... } from "@earendil-works/pi-coding-agent"`
  - Re-exports available from the main package index.
- **Key re-exported types:** `defineTool`, `isToolCallEventType`, etc.
- **Critical:** At runtime, Pi resolves this from its own install. The `package.json`
  `"dependencies"` entry is for editor IntelliSense; `"*"` version spec works because
  Pi provides the actual module at load time.

### 1.2 `typebox`

- **Version:** `1.3.7` (installed at `pi-coding-agent/node_modules/typebox/`)
- **Role:** Schema definitions for tool parameters (TypeBox schemas are what Pi uses
  for tool parameter validation and LLM function-calling schema generation).
- **Import:** `import { Type } from "typebox"` — `Type` is a namespace of builder
  functions. Also `import type { Static, TSchema } from "typebox"` for type inference.
- **Verified API functions:** `Type.Object`, `Type.Union`, `Type.String`,
  `Type.Optional`, `Type.Literal`, `Type.Number`, `Type.Boolean` — all confirmed
  as callable functions.
- **Usage pattern in Mulligan tools:**
  ```ts
  const RewindParams = Type.Object({
    note: Type.Object({
      what_happened: Type.String({ description: "..." }),
      avoid: Type.String({ description: "..." }),
      true_current_state: Type.String({ description: "..." }),
      next: Type.String({ description: "..." }),
    }),
    granularity: Type.Union([
      Type.Literal("last_tool_call_group"),
      Type.Literal("last_turn"),
      Type.Literal("checkpoint"),
    ]),
    to_previous_prompt: Type.Optional(Type.Boolean()),
    checkpoint: Type.Optional(Type.String()),
  });
  ```

### 1.3 Node.js Built-ins

- `node:fs` — `appendFileSync`, `writeFileSync`, `mkdirSync` (for the structured logger)
- No other external runtime dependencies.

## 2. Dev Dependencies

### 2.1 `typescript`

- **Version:** `^5` (ESM, target ES2022, module ESNext, moduleResolution Bundler)
- **tsconfig.json** (from spec §11):
  ```json
  {
    "compilerOptions": {
      "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
      "strict": true, "noImplicitAny": true, "types": ["node"],
      "skipLibCheck": true
    },
    "include": ["src", "test"]
  }
  ```

### 2.2 `vitest`

- **Version:** `^1`
- **Role:** Unit test framework for pure helpers (Tier 1 tests).
- **Alternative:** `node:test` is also acceptable per the spec.

## 3. Package.json (from spec §11)

```jsonc
{
  "name": "pi-mulligan",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "pi": { "extensions": ["./src/index.ts"] },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^1"
  },
  "scripts": {
    "test": "vitest run",
    "smoke": "pi -e ./src/index.ts -p \"$(cat test/integration/scenarios.md)\""
  }
}
```

## 4. Extension Discovery & Loading

- **Global:** `~/.pi/agent/extensions/` — symlink or copy for auto-discovery
- **Project-local:** `<project>/.pi/extensions/`
- **Ad-hoc:** `pi -e ./src/index.ts` (loads a single extension file)
- **Transpilation:** Pi uses jiti for on-the-fly TypeScript transpilation — no build step needed.
- **Import resolution:** Extensions can import `@earendil-works/pi-coding-agent`,
  `typebox`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, and `node:` built-ins.

## 5. No Other External Dependencies

Mulligan is deliberately minimal. It does NOT depend on:
- Any tokenizer library (tokens are estimated via character-count heuristic)
- Any LLM client (zero extra model requests by design)
- Any framework beyond Pi's extension API
- Any database (state is in Pi's session JSONL via CustomEntries)