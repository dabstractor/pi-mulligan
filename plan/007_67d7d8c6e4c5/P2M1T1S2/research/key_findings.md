# Research Notes — P2.M1.T1.S2 (index.ts: register the two checkpoint commands)

Files read directly: `plan/007_.../P2M1T1S1/PRP.md` (S1 contract), `src/index.ts` (current), `src/commands.ts`
(S1 already landed — verified exports), `src/banner.ts` (stub verified), `test/index.test.ts`,
`plan/007_.../architecture/external_deps.md`, `plan/007_.../architecture/change_surface.md`,
`package.json`, `tsconfig.json`.

## 1. S1 contract (the factories S2 consumes) — VERIFIED against the actual landed file

`src/commands.ts` now exists (S1 implemented it in parallel) and exports EXACTLY:
- `makeCheckpointCommand(pi): { description: string; handler: (args, ctx) => Promise<void> }`
- `makeCheckpointRevokeCommand(pi): { description: string; handler: ... }`
- `clearCheckpointByName(pi, ctx, name): boolean` (not used by S2 — S2 only registers the two factories)

`src/banner.ts` exports `reconcileBanner(_ctx): void` (stub — P2.M3.T1.S2 fills it).

The factory return shape `{ description, handler }` is **structurally assignable** to `Omit<RegisteredCommand,
"name"|"sourceInfo">` (verified: handler is `(args: string, ctx: ExtensionCommandContext) => Promise<void>`,
matching the Pi contract exactly). So `pi.registerCommand(name, makeCheckpointCommand(pi))` typechecks —
the factory output IS the options object.

## 2. CRITICAL #1 — do NOT import makeAuditCommand (the item description is wrong here)

The item description says: "include makeAuditCommand here even if P2.M2.T1.S1 hasn't run yet — coordinate
or add incrementally." This is UNSAFE:
- `grep -rn makeAuditCommand src/` → **NOT PRESENT**. S1's commands.ts exports only the 2 checkpoint factories.
- Importing a non-existent export → `npm run typecheck` FAILS ("has no exported member 'makeAuditCommand'").
- The AUTHORITATIVE `change_surface.md` §"index.ts Multi-Touch Coordination" lists the dependency order
  **P1.M3 → P2.M1 → P2.M2 → P2.M3** and assigns `/mulligan_audit` registration to **P2.M2.T1.S2** (a later
  subtask). P2.M2.T1.S1 (makeAuditCommand factory) is still Planned.

**Resolution**: S2 imports and registers ONLY the two checkpoint commands. `/mulligan_audit` is P2.M2.T1.S2.
This is the build-safe, scope-disciplined choice.

## 3. CRITICAL #2 — registerCommand signature (external_deps.md §1, types.d.ts:903)

```ts
registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void;
// Omit<..., "name"|"sourceInfo"> = { description?: string; getArgumentCompletions?: ...; handler: (args, ctx)=>Promise<void> }
```
Pass the factory's `{ description, handler }` DIRECTLY (the whole object), NOT a re-built options literal:
`pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi))`. (The item description's first sketch
"pi.registerCommand('mulligan_checkpoint', { description:'...', handler:... })" is the WRONG shape — it would
discard the factory; use the pre-built object.)

C2 does NOT block this (external_deps.md §1): registerCommand is direct registration of human-typed commands;
C2 only forbids extension-injected *messages* dispatching as commands.

## 4. CRITICAL #3 — test/index.test.ts makePi() fake lacks registerCommand → factory throws

`test/index.test.ts` `makePi()` captures `.on` + `.registerTool` ONLY. It has NO `registerCommand` method.
The moment S2 adds `pi.registerCommand(...)` to index.ts, `indexFactory(pi)` throws `TypeError: pi.registerCommand
is not a function` → EVERY test in index.test.ts fails (they all call indexFactory). This is a FORCED
consequence, not optional: S2 MUST add a `registerCommand` capture to makePi(). Minimal change:
```ts
const commands: { name: string }[] = [];
// ...inside pi:
registerCommand(name: string, _options: unknown) { commands.push({ name }); },
// return { handlers, tools, commands, pi: ... }
```
Other test files (nudges/filter/etc.) have their own makePi but never call indexFactory, so they're unaffected.
Only index.test.ts needs this. The registration assertion (2 commands, exact names) belongs in index.test.ts
(mirrors the existing "registers all 4 tools" test); S3 owns comprehensive handler-behavior tests in a NEW file.

## 5. JSDoc accuracy — list 2 commands (not 3)

The item description says "Update the factory JSDoc to list the 3 human commands." But S2 registers only 2.
A JSDoc claiming "3" when 2 are registered is inaccurate. Resolution: list the 2 S2 registers, forward-reference
/mulligan_audit as "added by P2.M2.T1.S2." When P2.M2.T1.S2 lands it bumps to 3.

## 6. Placement + comment renumbering

Insert the 2 registerCommand calls after the 4 registerTool calls (item description: "after the tool
registrations"), before "// 4. Arm the 3 event-driven handlers". This requires renumbering the subsequent
comment markers 4→5, 5→6, 6→7 (session_start, session_shutdown). All three comment strings are unique →
targeted edits are safe.

## 7. Validation commands (verified from package.json)

- `npm run typecheck` = `tsc --noEmit` (strict + noImplicitAny; include: src+test). EXISTS as a script. ✅
- `npm test` = `vitest run` (full suite). ✅
- `git status --short` → expect `M src/index.ts` + `M test/index.test.ts` (commands.ts/banner.ts are S1's untracked adds).