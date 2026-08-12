---
name: "P2.M1.T1.S2 — index.ts: register the two checkpoint commands (/mulligan_checkpoint, /mulligan_checkpoint_revoke)"
---

## Goal

**Feature Goal**: Wire the two **human-facing slash-command factories** produced by P2.M1.T1.S1
(`makeCheckpointCommand`, `makeCheckpointRevokeCommand` in `src/commands.ts`) into the Mulligan extension
factory in `src/index.ts` via `pi.registerCommand(...)`, so that a human typing `/mulligan_checkpoint <name>`
or `/mulligan_checkpoint_revoke <name>` in the Pi TUI actually dispatches to the v1.1 checkpoint set/revoke
handlers (spec/13 §0 mechanism, §2 set, §3 revoke). This **completes** the v1.1 replacement of the removed
`mulligan_checkpoint` agent tool (E23 RESOLVED — P1.M3 removed the tool; P2.M1.T1 builds the human
replacement; this subtask is the registration that makes it live).

**Deliverable**: (a) A modified `src/index.ts` — one new import line, two `pi.registerCommand(...)` calls
placed after the 4 `registerTool` calls, the factory JSDoc updated to name the 2 human commands, and the
subsequent step-comment markers renumbered. (b) A **minimal, forced** modification to `test/index.test.ts` —
add a `registerCommand` capture to the `makePi()` fake (without it every factory test throws), plus one
registration assertion. No new files.

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`, strict) exits 0 — proves the factory output is structurally assignable
  to `Parameters<ExtensionAPI["registerCommand"]>[1]` and the import resolves.
- `npm test` (full `vitest run` suite) is GREEN — including a new assertion that exactly
  `["mulligan_checkpoint", "mulligan_checkpoint_revoke"]` are registered.
- `git status --short` shows `M src/index.ts` + `M test/index.test.ts` and nothing else in S2's diff
  (`src/commands.ts` + `src/banner.ts` are S1's untracked additions, expected).
- A human typing `/mulligan_checkpoint foo` would dispatch to `makeCheckpointCommand(pi).handler` (the
  command is in Pi's registered-commands map; verified structurally + by the assertion).

## User Persona (if applicable)

**Target User**: A Pi user working in the TUI who wants to proactively tag a transcript position before a
risky/speculative sub-task, so a later agent `mulligan_rewind(granularity:"checkpoint")` can jump back to it.
(The handlers themselves are S1's; S2 only makes them invocable.)

**Use Case**: User types `/mulligan_checkpoint before-refactor`; Pi's command runner looks up the registered
command by name and calls the handler S1 built. S2 is the registration that makes that lookup succeed.

**User Journey**: (registration is invisible to the user) → user types the slash command → it works. Without
S2, the factories exist but are never registered → Pi reports "unknown command".

**Pain Points Addressed**: Completes E23 — moving checkpoint creation from the agent (hindsight-only) to the
human (foresight). S1 built the handlers; S2 is the last wiring step to make them live.

## Why

- **Business value**: This is the **registration half** of the v1.1 human checkpoint surface. S1 built the
  factories; without S2 they are dead code. S2 is the one-line-per-command glue that makes `/mulligan_checkpoint`
  and `/mulligan_checkpoint_revoke` real, human-invokable Pi commands.
- **Position in plan**: Second subtask of P2.M1.T1. **Upstream dependency: P2.M1.T1.S1** (which created
  `src/commands.ts` exporting the two factories — verified landed; see "Verified S1 Output"). **Downstream
  consumers: P2.M1.T1.S3** (command handler tests — they will call `makeCheckpointCommand(fakePi).handler(...)`
  directly, independent of this registration) and **P2.M3.T1.S3** (the session_start banner hook reads the
  same factory seam). S2 is also a coordination point: `src/index.ts` is multi-touch (see Coordination).
- **Scope discipline**: S2 registers the **two checkpoint commands ONLY**. It does **NOT** register
  `/mulligan_audit` (that is P2.M2.T1.S2 — `makeAuditCommand` does not exist yet; importing it breaks `tsc`),
  does **NOT** touch `src/commands.ts`/`src/banner.ts` (S1's), does **NOT** write comprehensive command
  handler tests (S3), and does **NOT** add the banner hook to session_start (P2.M3.T1.S3).

## What

Two existing files are edited. No user-visible *model* behavior change (commands are write-only w\.r.t. the
model's context — they never inject into `event.messages`; spec/13 §0). The change is purely on Pi's
command-registration surface: two new entries in the registered-commands map, each backed by S1's factory.

### Success Criteria

- [ ] `src/index.ts` imports `{ makeCheckpointCommand, makeCheckpointRevokeCommand }` from `"./commands.js"`
      (the two checkpoint factories ONLY — NOT `makeAuditCommand`).
- [ ] `src/index.ts` calls `pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi))` and
      `pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi))`, placed immediately
      after the 4 `pi.registerTool(...)` calls.
- [ ] The factory JSDoc names the 2 human commands and forward-references `/mulligan_audit` as P2.M2.T1.S2
      (accurate to S2's state — does NOT claim 3).
- [ ] The subsequent step-comment markers (`// 4.`/`// 5.`/`// 6.`) are renumbered to `// 5.`/`// 6.`/`// 7.`
      so the new command-registration step is `// 4.`.
- [ ] `test/index.test.ts` `makePi()` captures `registerCommand` calls (a `commands: { name: string }[]`
      array + `registerCommand(name, _options)` method) so `indexFactory(pi)` no longer throws.
- [ ] A new test asserts exactly `["mulligan_checkpoint", "mulligan_checkpoint_revoke"]` are registered.
- [ ] `npm run typecheck` exits 0. `npm test` is GREEN.

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this codebase can implement S2 from: the verbatim before/after blocks in
"Implementation Tasks" (verified by direct read of `src/index.ts` and `test/index.test.ts`), the verified S1
output (commands.ts exports), CRITICAL GOTCHA #1 (no makeAuditCommand), CRITICAL GOTCHA #2 (registerCommand
takes the factory object directly), CRITICAL GOTCHA #3 (the makePi() fake must gain a registerCommand
capture or the whole factory test file throws), and the explicit scope boundary (audit registration is
P2.M2.T1.S2; handler tests are S3; banner hook is P2.M3.T1.S3).

### Documentation & References

```yaml
# MUST READ — the registerCommand contract (the surface S2 wires)
- docfile: plan/007_67d7d8c6e4c5/architecture/external_deps.md
  why: "§1 gives the EXACT registerCommand signature (types.d.ts:903): registerCommand(name, options) where
        options = Omit<RegisteredCommand,'name'|'sourceInfo'> = { description?, getArgumentCompletions?,
        handler:(args,ctx)=>Promise<void> }. Confirms the factory's {description, handler} object is passed
        DIRECTLY. §1 also confirms C2 does NOT block registerCommand (direct registration of human-typed
        commands, not message injection)."
  critical: "Pass the WHOLE factory object: pi.registerCommand('mulligan_checkpoint', makeCheckpointCommand(pi)).
             Do NOT rebuild a {description, handler} literal from the factory (that discards the factory)."

# MUST READ — the S1 contract (the factories S2 consumes) — read to confirm exact export names + return shape
- file: src/commands.ts
  why: "S1 created this. Exports (VERIFIED by grep): makeCheckpointCommand(pi), makeCheckpointRevokeCommand(pi),
        clearCheckpointByName(pi,ctx,name). Each factory returns { description: string; handler: (args, ctx) =>
        Promise<void> } — structurally assignable to the registerCommand options type. S2 imports the TWO
        factories (NOT clearCheckpointByName — that's an internal helper S1 uses inside the revoke handler)."
  pattern: "Factory closure idiom: pi captured at factory-call time; ctx passed to handler at invoke time.
            Identical seam to makeRewindTool(pi)/makeCancelTool(pi) already registered in index.ts."
  gotcha: "makeAuditCommand is NOT exported here (it does not exist anywhere in src/ — verified). Do NOT import it."

# MUST READ — the authoritative scope/coordination map
- docfile: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: "'index.ts Multi-Touch Coordination' lists EVERY subtask touching index.ts + the dependency order
        P1.M3 → P2.M1 → P2.M2 → P2.M3. It assigns /mulligan_audit registration to P2.M2.T1.S2 (NOT S2)."
  critical: "This doc is the authority that OVERRIDES the item description's suggestion to 'include
             makeAuditCommand here'. Audit is a later subtask; importing it now breaks tsc."

# MUST READ — the file S2 edits (primary)
- file: src/index.ts
  why: "The ONLY source file S2 modifies. Current state (verified): imports at lines 1-12 (no commands.ts
        import yet); factory registers 4 tools (makeRewindTool/makeShrinkTool/auditTool/makeCancelTool) under
        comment '// 3.'; '// 4.' Arms event handlers; '// 5.' session_start; '// 6.' session_shutdown. NO
        checkpoint tool (P1.M3 already removed it). The factory JSDoc currently lists '4 agent-callable tools,
        3 event-driven handlers ... session lifecycle' — S2 adds the 2 human commands line."
  pattern: "Registrations are FACTORY calls capturing pi: pi.registerTool(makeRewindTool(pi)). S2 mirrors this
            exactly with pi.registerCommand(name, makeCheckpointCommand(pi))."
  gotcha: "Insert AFTER the 4 registerTool calls (item description: 'after the tool registrations'), BEFORE
            '// 4. Arm the 3 event-driven handlers'. Renumber the three subsequent step-comments."

# MUST READ — the file S2 must minimally patch (forced consequence — see GOTCHA #3)
- file: test/index.test.ts
  why: "makePi() captures .on + .registerTool ONLY. index.ts will now call pi.registerCommand(...) which the
        fake lacks → TypeError → every test fails. S2 MUST add a registerCommand capture to makePi(). The
        existing 'registers all 4 tools with the exact names' test is the template for the new 'registers the
        2 commands' assertion."
  pattern: "Hand-rolled fake (no vi.fn for Pi objects): arrays captured + pushed in literal methods. Return
            { handlers, tools, commands, pi }. Tests call indexFactory(pi) then assert on the captured arrays."
  gotcha: "Only index.test.ts calls indexFactory (nudges/filter/etc. test handlers directly with their own
            makePi). So ONLY index.test.ts needs the registerCommand capture — do not touch other test files."

# REFERENCE — the spec authority for what these commands DO (S1 implemented behavior; S2 only registers)
- docfile: spec/13-human-facing-surface.md
  why: "§0 = registerCommand mechanism (C2 safe); §2 = /mulligan_checkpoint set; §3 = /mulligan_checkpoint_revoke.
        S2 does NOT implement behavior — but the registration should cite §0, §2, §3 so the wiring is traceable."
  section: "§0 (mechanism), §2 (set), §3 (revoke)"
```

### Verified S1 Output (the contract S2 consumes — confirmed by direct grep of the landed file)

```bash
# These were verified at research time; S2 can re-confirm:
$ grep -nE '^export function' src/commands.ts
55:export function clearCheckpointByName(pi: ExtensionAPI, ctx: ExtensionContext, name: string): boolean {
108:export function makeCheckpointCommand(pi: ExtensionAPI): {
160:export function makeCheckpointRevokeCommand(pi: ExtensionAPI): {
$ grep -nE '^export function' src/banner.ts
22:export function reconcileBanner(_ctx: ExtensionContext): void {
$ grep -rn "makeAuditCommand" src/    # → (no output) — CONFIRMED not present; do NOT import it
```

### Current Codebase tree (relevant slice)

```bash
src/commands.ts          # S1 (landed) — exports makeCheckpointCommand, makeCheckpointRevokeCommand, clearCheckpointByName
src/banner.ts            # S1 (landed) — reconcileBanner stub (P2.M3.T1.S2 fills it)
src/index.ts             # S2 MODIFIES: + import, +2 registerCommand, +JSDoc, +comment renumber
src/tools/checkpoint.ts  # NOT touched (RETAINED — P1.M3 kept it; validCheckpointName imported by commands.ts)
src/tools/{rewind,shrink,audit,cancel}.ts  # NOT touched
test/index.test.ts       # S2 MODIFIES (minimal/forced): makePi() +registerCommand capture, +1 assertion
test/commands.test.ts    # NOT created by S2 (that is P2.M1.T1.S3 — handler behavior tests)
```

### Desired Codebase tree

No files added or removed — S2 is a pure edit of `src/index.ts` + `test/index.test.ts`.

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL GOTCHA #1 (do NOT import makeAuditCommand): the item description says "include makeAuditCommand
//   here even if P2.M2.T1.S1 hasn't run yet." DO NOT. Verified: `grep -rn makeAuditCommand src/` returns
//   nothing — S1's commands.ts exports ONLY the two checkpoint factories + clearCheckpointByName. Importing
//   a non-existent member FAILS `npm run typecheck` ("Module ... has no exported member 'makeAuditCommand'").
//   The authoritative change_surface.md "index.ts Multi-Touch Coordination" assigns /mulligan_audit to
//   P2.M2.T1.S2, dependency order P1.M3 → P2.M1 → P2.M2 → P2.M3. S2 imports the TWO checkpoint factories ONLY.

// CRITICAL GOTCHA #2 (registerCommand takes the factory object DIRECTLY): the signature is
//   registerCommand(name, options: Omit<RegisteredCommand,'name'|'sourceInfo'>) where options = {description?,
//   getArgumentCompletions?, handler}. The factory's {description, handler} IS that object — pass it whole:
//     pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi));
//   Do NOT write pi.registerCommand("mulligan_checkpoint", { description: "...", handler: ... }) re-literal —
//   that would discard S1's factory. The item description's first sketch shows the wrong (rebuilt) shape;
//   its OWN correction ("pass the pre-built command objects from the factory") is the right one. Use that.

// CRITICAL GOTCHA #3 (test/index.test.ts makePi() lacks registerCommand → factory throws): the makePi() fake
//   captures .on and .registerTool only. indexFactory(pi) will now call pi.registerCommand(...), which the
//   fake does not have → "TypeError: pi.registerCommand is not a function" → EVERY test in index.test.ts fails
//   (they all call indexFactory). S2 MUST add a registerCommand capture to makePi():
//     const commands: { name: string }[] = [];
//     // inside the pi object literal:
//     registerCommand(name: string, _options: unknown) { commands.push({ name }); },
//     // return { handlers, tools, commands, pi: pi as unknown as ExtensionAPI };
//   This is a FORCED consequence of the registration, not optional scope creep. Only index.test.ts needs it
//   (other test files don't call indexFactory).

// GOTCHA #4 (JSDoc accuracy — 2 commands, not 3): the item description says "list the 3 human commands," but
//   S2 registers only 2. A JSDoc claiming 3 when 2 are registered misleads the next agent. List the 2 S2
//   registers and forward-reference /mulligan_audit as "added by P2.M2.T1.S2." (P2.M2.T1.S2 bumps it to 3.)

// GOTCHA #5 (comment renumbering): inserting a new "// 4. Register the human slash commands" block pushes the
//   existing "// 4. Arm the 3 event-driven handlers" / "// 5. session_start" / "// 6. session_shutdown" down.
//   Renumber them to 5/6/7. All three comment strings are unique → safe targeted edits. (Leaving them
//   misnumbered is sloppy and confuses readers; do the renumber.)

// GOTCHA #6 (C2 is satisfied — no special handling): registerCommand is direct registration of human-typed
//   commands. C2 forbids extension-injected MESSAGES dispatching as commands — unrelated. No guard needed.

// GOTCHA #7 (sync factory, fail-fast wiring): index.ts does NOT wrap registration in try/catch (the factory
//   fails fast on wiring errors by design — see the existing JSDoc). Do NOT add try/catch around the new
//   registerCommand calls; they're pure synchronous registration with no failure mode at bootstrap.
```

## Implementation Blueprint

### Data models and structure

No new data models. S2 reuses:
- `ExtensionAPI` (type) — already imported in index.ts.
- The factory return shape `{ description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }` from S1's commands.ts — passed whole to `registerCommand`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/index.ts — add the commands.ts import
  - PLACE: after the last existing import (makeCancelTool), as a new line in the 1-12 import block.
  - EXACT before/after (the current last import line):

      // BEFORE
      import { makeCancelTool } from "./tools/cancel.js"; // 4th agent-callable tool (P3.M1.T3.S1)

      // AFTER
      import { makeCancelTool } from "./tools/cancel.js"; // 4th agent-callable tool (P3.M1.T3.S1)
      import { makeCheckpointCommand, makeCheckpointRevokeCommand } from "./commands.js"; // 2 human slash commands (P2.M1.T1.S1)

  - GOTCHA #1: import ONLY the two checkpoint factories. Do NOT add makeAuditCommand (does not exist).
  - NAMING/PATH: `./commands.js` (commands.ts is in src/, same dir as index.ts — `./` prefix + `.js` ext, house convention).

Task 2: MODIFY src/index.ts — add the two registerCommand calls (+ renumber subsequent comments)
  - PLACE: immediately AFTER the 4 pi.registerTool(...) calls (under comment "// 3."), BEFORE the existing
    "// 4. Arm the 3 event-driven handlers" block.
  - PATTERN: mirror the factory-call registration idiom: pi.registerTool(makeRewindTool(pi)) →
    pi.registerCommand(name, makeCheckpointCommand(pi)). The factory object is passed WHOLE (GOTCHA #2).
  - EXACT before/after (the seam between tool registration and event-handler arming):

      // BEFORE
        pi.registerTool(makeCancelTool(pi)); // 4th tool — marker retraction (P3.M1.T3.S1 / E21)

        // 4. Arm the 3 event-driven handlers (each is a thin pi.on seam; fail-open lives INSIDE each handler).

      // AFTER
        pi.registerTool(makeCancelTool(pi)); // 4th tool — marker retraction (P3.M1.T3.S1 / E21)

        // 4. Register the 2 human slash commands (spec/13 §0 mechanism, §2 set, §3 revoke; v1.1 replaces the
        //    removed mulligan_checkpoint AGENT tool — E23 RESOLVED). FACTORIES capture pi via closure (mirrors
        //    the tool factories above); their { description, handler } output is passed DIRECTLY as the
        //    registerCommand options object. /mulligan_audit is registered separately in P2.M2.T1.S2.
        pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi));
        pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi));

        // 5. Arm the 3 event-driven handlers (each is a thin pi.on seam; fail-open lives INSIDE each handler).

  - RENUMBER (GOTCHA #5) — two more comment-only edits (each string is unique):
      "// 5. session_start → re-read config with the AUTHORITATIVE ctx.cwd on EVERY reason" → "// 6. session_start ..."
      "// 6. session_shutdown → wipe ALL per-session runtimes (full process teardown)." → "// 7. session_shutdown ..."
  - GOTCHA #7: do NOT wrap in try/catch (the factory is fail-fast by design; registration is sync, no failure mode).

Task 3: MODIFY src/index.ts — update the factory JSDoc to name the 2 human commands
  - PLACE: the factory JSDoc block (the paragraph starting "The single entry point ...").
  - EXACT before/after (GOTCHA #4 — list 2, forward-reference the 3rd):

      // BEFORE
       * The single entry point (package.json `main` + `pi.extensions`). Wires all 4 agent-callable tools,
       * the 3 event-driven handlers (context filter + 2 nudges), and the session lifecycle (runtime reset /
       * full cleanup). Config loads from merged Pi settings ...

      // AFTER
       * The single entry point (package.json `main` + `pi.extensions`). Wires all 4 agent-callable tools,
       * the 3 event-driven handlers (context filter + 2 nudges), the 2 human slash commands
       * (/mulligan_checkpoint, /mulligan_checkpoint_revoke — spec/13 §2–§3; v1.1 replaces the v1
       * mulligan_checkpoint agent tool, E23 RESOLVED), and the session lifecycle (runtime reset /
       * full cleanup). /mulligan_audit is added by P2.M2.T1.S2. Config loads from merged Pi settings ...

  - Keep the rest of the JSDoc (sync/fail-fast notes) unchanged.

Task 4: MODIFY test/index.test.ts — add registerCommand capture to makePi() (FORCED — GOTCHA #3)
  - WHY: without this, indexFactory(pi) throws on the new pi.registerCommand(...) calls and EVERY test fails.
  - EXACT before/after (the makePi() function):

      // BEFORE
      function makePi() {
        const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
        const tools: { name: string }[] = [];
        const pi = {
          on(event: string, handler: (...a: unknown[]) => unknown) {
            handlers[event] = handler;
          },
          registerTool(tool: { name: string }) {
            tools.push(tool);
          },
        };
        return { handlers, tools, pi: pi as unknown as ExtensionAPI };
      }

      // AFTER
      function makePi() {
        const handlers: Record<string, ((...a: unknown[]) => unknown) | undefined> = {};
        const tools: { name: string }[] = [];
        const commands: { name: string }[] = [];
        const pi = {
          on(event: string, handler: (...a: unknown[]) => unknown) {
            handlers[event] = handler;
          },
          registerTool(tool: { name: string }) {
            tools.push(tool);
          },
          registerCommand(name: string, _options: unknown) {
            commands.push({ name });
          },
        };
        return { handlers, tools, commands, pi: pi as unknown as ExtensionAPI };
      }

  - NOTE: `_options` is intentionally unused (no noUnusedParameters in tsconfig — verified). Other test files
    keep their own makePi unchanged (they never call indexFactory).

Task 5: MODIFY test/index.test.ts — add the registration assertion
  - PLACE: inside the existing `describe("index.ts extension factory", () => { ... })` block, right after the
    "does not register extra tools" test (mirrors its idiom; uses the new `commands` capture).
  - EXACT new test to add:

      it("registers the 2 human checkpoint slash commands with the exact names", () => {
        const { commands, pi } = makePi();
        indexFactory(pi);
        expect(commands.map((c) => c.name).sort()).toEqual(
          ["mulligan_checkpoint", "mulligan_checkpoint_revoke"].sort(),
        );
      });

  - SCOPE NOTE: this verifies S2's deliverable (the registration). Comprehensive command-HANDLER behavior
    tests (notify wording, setCheckpoint/clearCheckpointByName delegation, hasUI guards) are P2.M1.T1.S3's
    job, in a separate file — do NOT add them here.

Task 6: VALIDATE
  - RUN: `npm run typecheck` → exit 0 (proves the import resolves + the factory object is assignable to the
        registerCommand options type). This is the make-or-break gate.
  - RUN: `npm test` → full suite GREEN (the makePi() fix in Task 4 is what keeps index.test.ts green; the new
        assertion in Task 5 verifies the registration).
  - RUN: `git status --short` → `M src/index.ts` + `M test/index.test.ts` (commands.ts/banner.ts are S1's).
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (factory-object registration — mirrors the existing tool factories):
//   The tool factories are registered as pi.registerTool(makeRewindTool(pi)) — the WHOLE factory object.
//   The command factories follow the identical idiom:
pi.registerTool(makeRewindTool(pi));                                        // existing
pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi));       // NEW — whole object, not a rebuilt literal
pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi));

// WHY the whole object works (external_deps.md §1): registerCommand's 2nd param is
//   Omit<RegisteredCommand, "name"|"sourceInfo"> = { description?, getArgumentCompletions?, handler }.
//   S1's factory returns exactly { description, handler } — structurally assignable. tsc proves it.

// PATTERN (test fake captures every registration surface the factory uses):
//   makePi() already captures .on + .registerTool. S2 adds .registerCommand so indexFactory(pi) doesn't
//   throw. The capture is minimal ({ name } only) — S2 doesn't need to invoke handlers here (S3 does).
registerCommand(name: string, _options: unknown) { commands.push({ name }); },

// CRITICAL (GOTCHA #1): do NOT add makeAuditCommand to the import. Verified absent from src/. Audit is
//   P2.M2.T1.S2. Importing it = typecheck failure.
```

### Integration Points

```yaml
CODE (src/index.ts — MODIFIED):
  - import { makeCheckpointCommand, makeCheckpointRevokeCommand } from "./commands.js"   # NEW import
  - pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi))                 # NEW registration
  - pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi))    # NEW registration
  - factory JSDoc + step-comment renumber                                                # doc/structure

TEST (test/index.test.ts — MODIFIED, minimal/forced):
  - makePi() gains a registerCommand capture (commands: { name }[])                      # REQUIRED or suite breaks
  - new "registers the 2 checkpoint commands" assertion                                  # verifies S2 deliverable

DATABASE: none
CONFIG: none (the handlers read getConfig().enabled — already exists; ui.activeCheckpointBanner is P2.M3.T1.S1)
ROUTES: the two registered command names ARE the routes (/mulligan_checkpoint, /mulligan_checkpoint_revoke)

DOCS: [Mode A] factory JSDoc updated to name the 2 human commands (+ forward-ref to /mulligan_audit). Docs
      RIDE WITH the code (no separate doc file). The registration comments cite spec/13 §0/§2/§3.

COORDINATION (index.ts is multi-touch — change_surface.md "index.ts Multi-Touch"):
  - P1.M3.T1.S1 (Complete) — removed the checkpoint agent tool import + registration. ✅ already landed.
  - P2.M1.T1.S2 (THIS) — registers the 2 checkpoint commands.
  - P2.M2.T1.S2 (later) — will register /mulligan_audit AND bump the JSDoc "2 → 3 human commands".
  - P2.M3.T1.S3 (later) — will add reconcileBanner(ctx) to the session_start handler (comment "// 6." then).
  S2's edits are to the import block + the tool/registration region + the JSDoc + step comments — regions
  DISTINCT from where P2.M3.T1.S3 will edit (the session_start handler body). No merge conflict expected.
```

## Validation Loop

### Level 1: Type Check (THE make-or-break gate — after Tasks 1–3)

```bash
npm run typecheck    # = tsc --noEmit (strict + noImplicitAny; include: src+test)
echo "typecheck exit: $?"
# EXPECT: exit 0, no output. Proves: the ./commands.js import resolves with the two named exports; the
#   factory objects {description, handler} are assignable to Omit<RegisteredCommand,"name"|"sourceInfo">;
#   the makePi() registerCommand signature in test/index.test.ts is compatible.
# If it fails: "has no exported member 'makeAuditCommand'" → you ignored GOTCHA #1 (remove makeAuditCommand
#   from the import). "Property 'registerCommand' does not exist" → the makePi() fake isn't updated (Task 4).
#   "Argument of type X is not assignable to parameter of type Y" → you rebuilt a {description,handler}
#   literal instead of passing the factory object whole (GOTCHA #2).
```

### Level 2: Unit / Suite Tests (after Tasks 4–5)

```bash
npm test            # = vitest run (full suite)
echo "test exit: $?"
# EXPECT: full suite GREEN. Specifically the new "registers the 2 human checkpoint slash commands with the
#   exact names" test passes (commands === ["mulligan_checkpoint","mulligan_checkpoint_revoke"]). The existing
#   "registers all 4 tools" / "arms the 5 event handlers" tests STILL pass (the makePi() fix preserved them).
# If "registers all 4 tools" or "arms the 5 event handlers" now FAILS with "pi.registerCommand is not a
#   function" → you skipped Task 4 (the makePi() registerCommand capture). Add it.
# If the new command test fails with 0 or wrong names → the registerCommand calls aren't where Task 2 put them.
```

### Level 3: Integration (the registration IS the integration)

```bash
# S2's whole point is wiring S1's factories into Pi's command map. The integration proof is: (a) typecheck
# shows the factory object satisfies registerCommand's param type, and (b) the captured-commands assertion
# shows the exact names are registered. There is no server to start. A live-TUI dispatch test is out of scope
# (the handler behavior is S3; Pi's command runner is Pi's responsibility). Do NOT spin up a real Pi session.

# Optional reasoning check (no command needed): confirm C2 is satisfied — registerCommand is direct
# registration of a human-typed command, NOT an extension-injected message dispatching as a command
# (external_deps.md §1). No guard needed; the registration is unconditionally correct.
```

### Level 4: Scope & Traceability Gates

```bash
# (a) Scope — exactly two files modified by S2 (commands.ts/banner.ts are S1's untracked adds, not S2's):
git status --short
# EXPECT (at least): ` M src/index.ts` and ` M test/index.test.ts`. src/commands.ts + src/banner.ts may show
#   as `??` (S1's untracked adds) — that's fine, they're not S2's edits. If ANY other tracked file shows as
#   modified (src/commands.ts, src/banner.ts, src/config.ts, src/tools/*, other test files), you went out of
#   scope — revert it.

# (b) Import gate (GOTCHA #1 — makeAuditCommand must NOT be imported):
grep -n "makeAuditCommand" src/index.ts   # EXPECT: 0 hits.
grep -n "from \"./commands.js\"" src/index.ts   # EXPECT: 1 hit, importing exactly the 2 checkpoint factories.

# (c) Registration gate (the two commands are registered, whole-factory-object form):
grep -nE 'pi\.registerCommand\("mulligan_(checkpoint|checkpoint_revoke)"' src/index.ts
# EXPECT: 2 hits — one for "mulligan_checkpoint" with makeCheckpointCommand(pi), one for
#   "mulligan_checkpoint_revoke" with makeCheckpointRevokeCommand(pi). Each 2nd arg is the factory CALL,
#   not a rebuilt {description, handler} literal.

# (d) No-rebuild gate (GOTCHA #2 — must pass factory object, not a literal):
grep -cE 'registerCommand\("[^"]+", \{ description' src/index.ts   # EXPECT: 0 (no rebuilt-literal form).

# (e) JSDoc accuracy gate (GOTCHA #4 — names the 2 commands; forward-refs audit):
grep -c "the 2 human slash commands" src/index.ts                 # EXPECT: 1 (the JSDoc line).
grep -c "/mulligan_audit is added by P2.M2.T1.S2" src/index.ts    # EXPECT: 1 (the forward-reference).

# (f) Test-fake gate (GOTCHA #3 — makePi captures registerCommand):
grep -c "registerCommand(name: string" test/index.test.ts         # EXPECT: 1 (the makePi capture method).
grep -c "registers the 2 human checkpoint slash commands" test/index.test.ts   # EXPECT: 1 (the assertion).
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npm run typecheck` → exit 0.
- [ ] Level 2: `npm test` → full suite GREEN (incl. the new command-registration assertion).
- [ ] Level 4a: `git status --short` → only `src/index.ts` + `test/index.test.ts` modified by S2.
- [ ] Level 4b: zero `makeAuditCommand` references in `src/index.ts`.
- [ ] Level 4c: 2 `pi.registerCommand(...)` calls, each passing a factory call (not a literal).
- [ ] Level 4d: zero rebuilt-`{ description` literals passed to registerCommand.
- [ ] Level 4f: makePi() has a `registerCommand` capture + 1 new assertion.

### Feature Validation
- [ ] `/mulligan_checkpoint` and `/mulligan_checkpoint_revoke` are registered with their exact names
      (the assertion proves it; structurally a human typing them would dispatch to S1's handlers).
- [ ] The factory JSDoc accurately names the 2 commands registered in S2 (and forward-references audit).
- [ ] No new failure modes introduced at bootstrap (registration is sync, fail-fast — no try/catch added).

### Code Quality / Scope Discipline
- [ ] Modified ONLY `src/index.ts` + `test/index.test.ts`.
- [ ] Did NOT import `makeAuditCommand` (audit registration is P2.M2.T1.S2 — `makeAuditCommand` doesn't exist).
- [ ] Did NOT edit `src/commands.ts` / `src/banner.ts` (S1's; read-only for S2).
- [ ] Did NOT add the banner hook to session_start (P2.M3.T1.S3).
- [ ] Did NOT write comprehensive handler-behavior tests (P2.M1.T1.S3 — this PRP adds only the registration
      assertion that verifies S2's own deliverable).
- [ ] Followed conventions: `./` import paths + `.js` extensions; factory-object registration idiom;
      2-space indent / double quotes; step-comment numbering kept consistent.

### Documentation
- [ ] Factory JSDoc names the 2 human commands and cites spec/13 §2–§3 + E23.
- [ ] Registration step-comment cites spec/13 §0/§2/§3 and notes /mulligan_audit is P2.M2.T1.S2.
- [ ] No separate doc file (Mode A — docs ride with the code).

## Anti-Patterns to Avoid

- ❌ Don't import `makeAuditCommand` — it doesn't exist (verified by grep) and importing it fails `tsc`. The
  item description's "include makeAuditCommand" suggestion is overridden by the authoritative change_surface.md
  (audit is P2.M2.T1.S2). Import ONLY the two checkpoint factories. (GOTCHA #1.)
- ❌ Don't rebuild a `{ description: "...", handler: ... }` literal for registerCommand — pass the factory
  object WHOLE: `pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi))`. (GOTCHA #2.)
- ❌ Don't skip the `test/index.test.ts` makePi() update — without a `registerCommand` capture, `indexFactory(pi)`
  throws and the ENTIRE index.test.ts fails. This is forced, not optional. (GOTCHA #3.)
- ❌ Don't write "3 human commands" in the JSDoc — S2 registers 2. List 2 + forward-reference audit. (GOTCHA #4.)
- ❌ Don't leave the step comments misnumbered after inserting the new `// 4.` block — renumber 4→5, 5→6, 6→7. (GOTCHA #5.)
- ❌ Don't wrap the registerCommand calls in try/catch — the factory is fail-fast by design (see existing JSDoc);
  registration is synchronous with no bootstrap failure mode. (GOTCHA #7.)
- ❌ Don't add handler-behavior tests (notify wording, setCheckpoint/clearCheckpointByName delegation) — that is
  P2.M1.T1.S3's scope, in a separate file. S2's test change is the makePi() capture + ONE registration assertion.
- ❌ Don't touch the session_start handler to add `reconcileBanner(ctx)` — that is P2.M3.T1.S3.

## Confidence Score

**9/10** for one-pass implementation success. The change is tiny (1 import + 2 registrations + JSDoc + comment
renumber in index.ts; 1 fake-method + 1 assertion in index.test.ts), every edit is given verbatim with exact
before/after, and the three traps that would otherwise bite an implementer are called out with the exact
failure symptom and fix: (1) the makeAuditCommand import would fail tsc (verified absent; change_surface is
the authority), (2) the registerCommand literal-vs-factory-object shape, and (3) the makePi() fake missing
registerCommand would silently break the whole index.test.ts. The 1-point reserve covers the small chance the
implementer follows the item description's first (wrong) registerCommand sketch literally before reading
GOTCHA #2 — but the correction is stated in-place, so recovery is one edit.