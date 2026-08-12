---
name: "P2.M2.T1.S2 — index.ts: register the /mulligan_audit human command"
---

## Goal

**Feature Goal**: Wire the **human-facing audit command factory** produced by P2.M2.T1.S1
(`makeAuditCommand` in `src/commands.ts`) into the Mulligan extension factory in `src/index.ts` via
`pi.registerCommand("mulligan_audit", makeAuditCommand(pi))`, so that a human typing `/mulligan_audit` in
the Pi TUI dispatches to the v1.1 handler (spec/13 §4). This **completes** the v1.1 human-facing surface
for audit: the agent RETAINS its own `mulligan_audit` tool (the model's path); this command is the human's
direct, context-free path to the SAME report (spec/13 §4 step 2 — "Output follows the caller").

**Deliverable**: (a) A modified `src/index.ts` — extend the existing `./commands.js` import to add
`makeAuditCommand`; append one `pi.registerCommand("mulligan_audit", makeAuditCommand(pi))` call after the
two checkpoint registrations; update the factory JSDoc from "2 human slash commands" to "3" and name all
three. (b) A **minimal** modification to `test/index.test.ts` — update the one registration-count assertion
from 2 names to 3. No new files. `makePi()` needs NO change (it already captures `registerCommand`).

**Success Definition**:
- `npm run typecheck` (`tsc --noEmit`, strict) exits 0 — proves the `makeAuditCommand` import resolves
  (i.e. **P2.M2.T1.S1 has landed**) and the factory's `{ description, handler }` output is structurally
  assignable to `Parameters<ExtensionAPI["registerCommand"]>[1]`.
- `npm test` (full `vitest run` suite) is GREEN — including the updated assertion that exactly
  `["mulligan_checkpoint", "mulligan_checkpoint_revoke", "mulligan_audit"]` are registered.
- `git status --short` shows `M src/index.ts` + `M test/index.test.ts` and nothing else in S2's diff.
- The factory JSDoc accurately names the 3 human commands (no stale "2" or forward-reference to "P2.M2.T1.S2").
- A human typing `/mulligan_audit` would dispatch to `makeAuditCommand(pi).handler` (the command is in Pi's
  registered-commands map; verified structurally + by the assertion).

## User Persona (if applicable)

**Target User**: A Pi user working in the TUI who wants to see what the model is carrying — on demand,
without spending an agent turn or polluting the model's context (spec/13 §4).

**Use Case**: Human suspects context bloat and types `/mulligan_audit`. Pi's command runner looks up the
registered command by name and calls the handler S1 built. S2 is the registration that makes that lookup
succeed.

**User Journey**: (registration is invisible to the user) → user types `/mulligan_audit` → the report
appears in their UI via `ctx.ui.notify` (S1's handler). Without S2, the factory exists but is never
registered → Pi reports "unknown command".

**Pain Points Addressed**: Completes the v1.1 human-facing surface (P2). S1 built the factory; without S2 it
is dead code. S2 is the one-line glue that makes `/mulligan_audit` real and human-invokable.

## Why

- **Business value**: The **registration half** of the v1.1 human audit command. S1 built the factory; S2 is
  the last wiring step that makes it live. The agent keeps its own `mulligan_audit` tool — this command is
  the human's parallel direct path (spec/13 §4).
- **Position in plan**: Second subtask of P2.M2.T1. **Upstream dependency: P2.M2.T1.S1** (which exports
  `makeAuditCommand` from `src/commands.ts` — treated as a CONTRACT; see "Verified S1 Output"). **Downstream
  consumers: P2.M2.T1.S3** (audit-command handler tests — they call `makeAuditCommand(fakePi).handler(...)`
  directly via the factory seam, independent of this registration). S2 is also a coordination point:
  `src/index.ts` is multi-touch (see Coordination).
- **Scope discipline**: S2 registers the **audit command ONLY**. It does **NOT** modify `src/commands.ts`
  (S1's deliverable), does **NOT** write audit-command handler tests (S3), does **NOT** touch the
  session_start handler or banner (P2.M3.T1.S3), and does **NOT** modify `makePi()` (already has the
  `registerCommand` capture from P2.M1.T1.S2).

## What

Two existing files are edited. No user-visible *model* behavior change (the command is write-only w.r.t. the
model's context — S1's handler surfaces the report via `ctx.ui.notify` and NEVER injects into
`event.messages`; spec/13 §4 step 2). The change is purely on Pi's command-registration surface: one new
entry in the registered-commands map, backed by S1's factory.

### Success Criteria

- [ ] `src/index.ts` imports `makeAuditCommand` from `"./commands.js"` (EXTENDING the existing import — NOT
      a new import line; the item description's step 1 says "if P2.M1.T1.S2 already added the commands
      import, just add makeAuditCommand to the existing import").
- [ ] `src/index.ts` calls `pi.registerCommand("mulligan_audit", makeAuditCommand(pi))` placed immediately
      after the two checkpoint `pi.registerCommand(...)` calls (item description: "alongside the other two
      command registrations, after the checkpoint commands").
- [ ] The block-4 step comment is updated ("2 human slash commands" → "3"; "Both are FACTORIES" → "All three
      are FACTORIES") and notes `makeAuditCommand`'s `pi` is captured-but-unused.
- [ ] The factory JSDoc is updated: "the 2 human slash commands" → "the 3 human slash commands"; names all
      three (`/mulligan_checkpoint`, `/mulligan_checkpoint_revoke`, `/mulligan_audit`); removes the now-stale
      "/mulligan_audit is added by P2.M2.T1.S2." forward-reference line.
- [ ] `test/index.test.ts` registration assertion renamed ("2 human checkpoint slash commands" → "3 human
      slash commands") and bumped to expect all 3 names.
- [ ] `npm run typecheck` exits 0. `npm test` is GREEN.

## All Needed Context

### Context Completeness Check

A developer who knows nothing about this codebase can implement S2 from: the verbatim before/after blocks in
"Implementation Tasks" (verified by direct read of `src/index.ts` and `test/index.test.ts`), the S1 export
contract (`makeAuditCommand`), the index.ts Multi-Touch coordination map, and the scope boundaries (no
makePi() change, no step renumbering, no handler tests).

### Documentation & References

```yaml
# MUST READ — the file S2 edits (primary). Current state is VERIFIED (post-P2.M1.T1.S2): line 12 is the
# ./commands.js import (2 named exports); factory JSDoc L17-22 says "2 human slash commands" + a forward-
# reference to "/mulligan_audit is added by P2.M2.T1.S2"; block "// 4." has the 2 checkpoint registerCommand
# calls; "// 5."/"// 6."/"// 7." are the event-handler arming / session_start / session_shutdown.
- file: src/index.ts
  why: "The ONLY source file S2 modifies. S2: (a) extends the line-12 import with makeAuditCommand;
        (b) appends one registerCommand inside block 4; (c) updates the block-4 header comment + the
        factory JSDoc. Steps 5/6/7 are UNTOUCHED."
  pattern: "Registrations are FACTORY calls capturing pi: pi.registerCommand(name, makeXCommand(pi)).
            S2 mirrors the two checkpoint registrations EXACTLY for the audit factory."
  gotcha: "Do NOT insert a new step // 4. (P2.M1.T1.S2 already did that and renumbered 4→5→6→7). S2 appends
           INSIDE the existing block 4 — no renumbering. See GOTCHA #4."

# MUST READ — the file S2 minimally patches (the one registration assertion).
- file: test/index.test.ts
  why: "makePi() (L24-46) ALREADY captures registerCommand (L40, added by P2.M1.T1.S2) — S2 makes NO change
        to the fake. The only edit: the registration-count assertion at L86-92 (currently '2 human
        checkpoint slash commands', expects 2 names) → S2 renames it + bumps to 3 names."
  pattern: "Hand-rolled fake (no vi.fn for Pi objects): the commands array is captured by makePi() and
            returned. The assertion calls indexFactory(pi) then checks commands.map(c => c.name).sort()."
  gotcha: "Do NOT touch makePi() — it already has registerCommand. Only the assertion changes."

# MUST READ — the S1 contract (the factory S2 consumes). S1 is being implemented in PARALLEL; treat its PRP
# as authoritative for the export name + return shape.
- file: plan/007_67d7d8c6e4c5/P2M2T1S1/PRP.md
  why: "Defines makeAuditCommand(pi: ExtensionAPI) → { description: string; handler: (args: string, ctx:
        ExtensionCommandContext) => Promise<void> }. description === the contract-literal 'Run the Mulligan
        context-bloat diagnostic — see what the model is carrying' (em-dash). pi is captured-but-unused
        (registration uniformity; the audit reads via ctx/pure helpers). Structurally assignable to the
        registerCommand options type (GOTCHA #2)."
  critical: "PRECONDITION: S1 must land BEFORE S2's typecheck passes. If makeAuditCommand is absent from
             src/commands.ts, `import { makeAuditCommand } from './commands.js'` fails tsc with 'has no
             exported member makeAuditCommand'. This is a sequencing gate — re-run typecheck after S1 lands."

# MUST READ — the registerCommand contract (the surface S2 wires).
- docfile: plan/007_67d7d8c6e4c5/architecture/external_deps.md
  why: "§1 gives the EXACT registerCommand signature (types.d.ts:903): registerCommand(name, options) where
        options = Omit<RegisteredCommand,'name'|'sourceInfo'> = { description?, getArgumentCompletions?,
        handler:(args,ctx)=>Promise<void> }. Confirms the factory's {description, handler} object is passed
        DIRECTLY. §1 also confirms C2 does NOT block registerCommand."
  critical: "Pass the WHOLE factory object: pi.registerCommand('mulligan_audit', makeAuditCommand(pi)). Do
             NOT rebuild a {description, handler} literal from the factory."

# MUST READ — the authoritative scope/coordination map.
- docfile: plan/007_67d7d8c6e4c5/architecture/change_surface.md
  why: "'index.ts Multi-Touch Coordination' lists EVERY subtask touching index.ts + the dependency order
        P1.M3 → P2.M1 → P2.M2 → P2.M3. It assigns /mulligan_audit registration to P2.M2.T1.S2 (this item).
        'Change 5' confirms: 'src/index.ts: pi.registerCommand(\"mulligan_audit\", { description, handler }).'"
  critical: "Confirms S2's scope is EXACTLY the audit registration in index.ts + the spec says reuses S1's
             factory output (not a rebuilt literal)."

# REFERENCE — the sibling registration PRP (the pattern S2 mirrors; the file S2's edits sit beside).
- file: plan/007_67d7d8c6e4c5/P2M1T1S2/PRP.md
  why: "P2.M1.T1.S2 registered the 2 checkpoint commands with the identical idiom. S2 reuses that exact
        idiom for the audit factory (whole-object registration, no try/catch, factory JSDoc naming the
        commands). S2 is SIMPLER than S1-of-that-item: makePi() already has registerCommand, and no step
        renumber is needed."

# REFERENCE — the authoritative human-facing spec for THIS command (also in selected_prd_content h2.130).
- docfile: spec/13-human-facing-surface.md
  why: "§0 = registerCommand mechanism (C2 safe); §4 = /mulligan_audit. step 1 'Reuse the existing
        auditExecute pipeline'; step 2 'Output follows the caller' (human → ctx.ui, NEVER event.messages).
        S2 does NOT implement behavior — but the registration should cite §0/§4 so the wiring is traceable."
  section: "§0 (mechanism), §4 (audit)"
```

### Verified S1 Output (the contract S2 consumes — per P2.M2.T1.S1's PRP)

```bash
# These are the contract facts from S1's PRP (treated as authoritative — S1 is being implemented in parallel):
# src/commands.ts exports: makeAuditCommand(pi: ExtensionAPI)
#   returns { description: "Run the Mulligan context-bloat diagnostic — see what the model is carrying",
#             handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
# The { description, handler } object is structurally assignable to Omit<RegisteredCommand, "name"|"sourceInfo">.
# pi is captured-but-unused (registration uniformity with the sibling checkpoint factories).
#
# S2 can re-confirm at implementation time (after S1 lands):
#   grep -nE '^export function makeAuditCommand' src/commands.ts   # EXPECT: 1 hit
```

### Current Codebase tree (relevant slice)

```bash
src/commands.ts          # S1 (P2.M2.T1.S1) — exports makeAuditCommand (ALSO makeCheckpointCommand,
                         #   makeCheckpointRevokeCommand, clearCheckpointByName from P2.M1.T1.S1)
src/index.ts             # S2 MODIFIES: +makeAuditCommand to the import, +1 registerCommand, +JSDoc/header updates
test/index.test.ts       # S2 MODIFIES (minimal): the 1 registration assertion (2 → 3 names)
src/tools/audit.ts       # NOT touched (the AGENT audit TOOL stays registered; the human command is a parallel surface)
test/commands.test.ts    # NOT created by S2 (audit handler tests are P2.M2.T1.S3)
src/banner.ts            # NOT touched (banner is P2.M3's concern)
```

### Desired Codebase tree

No files added or removed — S2 is a pure edit of `src/index.ts` + `test/index.test.ts`.

### Known Gotchas of our codebase & Library Quirks

```typescript
// GOTCHA #1 (EXTEND the existing import — do NOT add a second ./commands.js import line): P2.M1.T1.S2
//   already added `import { makeCheckpointCommand, makeCheckpointRevokeCommand } from "./commands.js";` at
//   line 12. The item description step 1 explicitly says "if P2.M1.T1.S2 already added the commands import,
//   just add makeAuditCommand to the existing import." Verified: line 12 exists. So S2 EDITS that one line
//   to add makeAuditCommand as a third named export. Adding a SECOND `import { makeAuditCommand } from
//   "./commands.js"` line is a duplicate-import lint error.

// GOTCHA #2 (registerCommand takes the factory object DIRECTLY): the signature is
//   registerCommand(name, options: Omit<RegisteredCommand,'name'|'sourceInfo'>) where options = {description?,
//   getArgumentCompletions?, handler}. The factory's {description, handler} IS that object — pass it whole:
//     pi.registerCommand("mulligan_audit", makeAuditCommand(pi));
//   Do NOT write pi.registerCommand("mulligan_audit", { description: "...", handler: ... }) re-literal —
//   that would discard S1's factory. (Same idiom as the two checkpoint registrations directly above it.)

// GOTCHA #3 (S1 must land FIRST — sequencing gate): `makeAuditCommand` is produced by P2.M2.T1.S1, which is
//   being implemented IN PARALLEL. If S2 runs before S1 lands, `import { makeAuditCommand } from
//   "./commands.js"` fails `npm run typecheck` with "Module ... has no exported member 'makeAuditCommand'".
//   This is NOT a design flaw — it is the documented dependency (P2.M2.T1.S1 → P2.M2.T1.S2). If the
//   implementer hits this, confirm S1 has landed (grep '^export function makeAuditCommand' src/commands.ts →
//   1 hit) and re-run typecheck. Do NOT "work around" it by stubbing makeAuditCommand — that violates the
//   contract.

// GOTCHA #4 (NO step renumbering — S2 appends INSIDE block 4): P2.M1.T1.S2 INSERTED a new step // 4. and
//   renumbered the old 4/5/6 → 5/6/7. S2 does NOT do this. The audit registration goes INSIDE the existing
//   block-4 ("Register the human slash commands") as a third registerCommand, immediately after the two
//   checkpoint calls. Steps // 5. (event handlers), // 6. (session_start), // 7. (session_shutdown) are
//   UNTOUCHED. Renumbering them would be incorrect + create churn.

// GOTCHA #5 (makePi() needs NO change): the test fake at test/index.test.ts L24-46 ALREADY captures
//   registerCommand (L40, added by P2.M1.T1.S2). Its `registerCommand(name, _options) { commands.push(...) }`
//   captures every registered command by name regardless of the options object's shape. S2 only updates the
//   ASSERTION (2 → 3 names). Adding registerCommand again or "fixing" makePi() is wrong — it's already correct.

// GOTCHA #6 (no try/catch around registration): mirrors the existing factory JSDoc ("fail-FAST on wiring
//   errors at bootstrap") and P2.M1.T1.S2 GOTCHA #7. Registration is synchronous with no bootstrap failure
//   mode; the handler's own self-protection (S1 wraps the whole body in try/catch) cannot surface at
//   registration time because registration does not invoke the handler.

// GOTCHA #7 (4 tools stay 4 — the audit AGENT tool is NOT replaced): the human /mulligan_audit command is a
//   PARALLEL surface to the agent's mulligan_audit tool, NOT a replacement (spec/13 §4). The factory JSDoc's
//   "all 4 agent-callable tools" line stays "4". ONLY the human-command count changes: 2 → 3. Do NOT bump the
//   tool count or remove the audit tool registration.

// GOTCHA #8 (remove the now-stale forward-reference line): the current factory JSDoc ends its human-commands
//   sentence with "/mulligan_audit is added by P2.M2.T1.S2." Once S2 lands, that line is factually wrong
//   (audit IS now wired). S2 must DELETE that forward-reference and fold /mulligan_audit INTO the human-
//   commands sentence (naming all three). Leaving the stale line misleads the next reader.

// GOTCHA #9 (.js import path — ESM/Bundler resolution): the import is from "./commands.js" (NOT .ts) — house
//   convention, matching every other local import in index.ts. The @earendil-works/pi-coding-agent import
//   (ExtensionAPI type) is extension-less.
```

## Implementation Blueprint

### Data models and structure

No new data models. S2 reuses:
- `ExtensionAPI` (type) — already imported in index.ts.
- S1's factory return shape `{ description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }` from `src/commands.ts` — passed whole to `registerCommand`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/index.ts — extend the ./commands.js import (line 12) to add makeAuditCommand
  - GOTCHA #1: EDIT the existing line; do NOT add a second ./commands.js import.
  - EXACT before/after:

      // BEFORE
      import { makeCheckpointCommand, makeCheckpointRevokeCommand } from "./commands.js"; // 2 human slash commands (P2.M1.T1.S1)

      // AFTER
      import { makeCheckpointCommand, makeCheckpointRevokeCommand, makeAuditCommand } from "./commands.js"; // 3 human slash commands (P2.M1.T1.S1 + P2.M2.T1.S1)

Task 2: MODIFY src/index.ts — append the audit registerCommand INSIDE block 4 (after the 2 checkpoint calls)
  - GOTCHA #2: pass the factory object WHOLE; GOTCHA #4: no step renumber; GOTCHA #6: no try/catch.
  - PLACE: immediately after `pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi));`
    and BEFORE the blank line + "// 5. Arm the 3 event-driven handlers".
  - EXACT before/after (the whole block-4 region; the header comment is also updated here):

      // BEFORE
        // 4. Register the 2 human slash commands (spec/13 §2–§3; v1.1 replaces the v1 mulligan_checkpoint
        //    agent tool — E23 RESOLVED). Both are FACTORIES capturing `pi` via closure (mirroring the tool
        //    factories above). No try/catch — fail-fast by design (GOTCHA #7).
        pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi));
        pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi));

      // AFTER
        // 4. Register the 3 human slash commands (spec/13 §2–§4; v1.1 replaces the v1 mulligan_checkpoint
        //    agent tool — E23 RESOLVED). All three are FACTORIES capturing `pi` via closure (mirroring the
        //    tool factories above). makeAuditCommand's `pi` is captured for registration-uniformity but
        //    UNUSED — its reads go through ctx/pure helpers (spec/13 §4; P2.M2.T1.S1). No try/catch — fail-fast.
        pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi));
        pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi));
        pi.registerCommand("mulligan_audit", makeAuditCommand(pi)); // human-facing audit (spec/13 §4) — SAME report
        //   as the agent's mulligan_audit tool, surfaced to the human via ctx.ui.notify (never event.messages).

Task 3: MODIFY src/index.ts — update the factory JSDoc (2 → 3 human commands; name all three; drop stale forward-ref)
  - GOTCHA #7: the "4 agent-callable tools" count STAYS 4; GOTCHA #8: delete the "/mulligan_audit is added by
    P2.M2.T1.S2." forward-reference line.
  - EXACT before/after:

      // BEFORE
       * The single entry point (package.json `main` + `pi.extensions`). Wires all 4 agent-callable tools,
       * the 3 event-driven handlers (context filter + 2 nudges), the 2 human slash commands
       * (/mulligan_checkpoint, /mulligan_checkpoint_revoke — spec/13 §2–§3; v1.1 replaces the v1
       * mulligan_checkpoint agent tool, E23 RESOLVED), and the session lifecycle (runtime reset /
       * full cleanup). /mulligan_audit is added by P2.M2.T1.S2. Config loads from merged Pi settings

      // AFTER
       * The single entry point (package.json `main` + `pi.extensions`). Wires all 4 agent-callable tools,
       * the 3 event-driven handlers (context filter + 2 nudges), the 3 human slash commands
       * (/mulligan_checkpoint, /mulligan_checkpoint_revoke — spec/13 §2–§3; v1.1 replaces the v1
       * mulligan_checkpoint agent tool, E23 RESOLVED; and /mulligan_audit — spec/13 §4, the human's direct
       * path to the same context-bloat diagnostic the agent's mulligan_audit tool produces), and the
       * session lifecycle (runtime reset / full cleanup). Config loads from merged Pi settings

  - NOTE: keep the rest of the JSDoc (SYNC/fail-fast notes) unchanged.

Task 4: MODIFY test/index.test.ts — update the registration-count assertion (2 → 3 names)
  - GOTCHA #5: make NO change to makePi() (it already captures registerCommand). Only the assertion changes.
  - PLACE: the existing "registers the 2 human checkpoint slash commands with the exact names" test (L86-92).
  - EXACT before/after:

      // BEFORE
        it("registers the 2 human checkpoint slash commands with the exact names", () => {
          const { commands, pi } = makePi();
          indexFactory(pi);
          expect(commands.map((c) => c.name).sort()).toEqual(
            ["mulligan_checkpoint", "mulligan_checkpoint_revoke"].sort(),
          );
        });

      // AFTER
        it("registers the 3 human slash commands with the exact names", () => {
          const { commands, pi } = makePi();
          indexFactory(pi);
          expect(commands.map((c) => c.name).sort()).toEqual(
            ["mulligan_checkpoint", "mulligan_checkpoint_revoke", "mulligan_audit"].sort(),
          );
        });

  - SCOPE NOTE: this verifies S2's deliverable (the audit registration). Comprehensive audit-HANDLER behavior
    tests (notify wording, report rendering, hasUI guards, disabled gate) are P2.M2.T1.S3's job, in a
    separate file — do NOT add them here.

Task 5: VALIDATE
  - RUN: npm run typecheck   → exit 0 (proves S1 landed + the makeAuditCommand import resolves + the factory
        object is assignable to the registerCommand options type). This is the make-or-break gate; GOTCHA #3.
  - RUN: npm test            → full suite GREEN (the updated assertion verifies the 3 registrations).
  - RUN: git status --short  → ` M src/index.ts` + ` M test/index.test.ts` ONLY.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN (factory-object registration — mirrors the existing tool factories + the 2 checkpoint commands):
//   The tool factories are registered as pi.registerTool(makeRewindTool(pi)) — the WHOLE factory object.
//   The command factories follow the identical idiom. S2 appends the audit one alongside the two checkpoints:
pi.registerTool(makeRewindTool(pi));                                        // existing
pi.registerCommand("mulligan_checkpoint", makeCheckpointCommand(pi));       // existing (P2.M1.T1.S2)
pi.registerCommand("mulligan_checkpoint_revoke", makeCheckpointRevokeCommand(pi)); // existing (P2.M1.T1.S2)
pi.registerCommand("mulligan_audit", makeAuditCommand(pi));                 // NEW — whole object (P2.M2.T1.S2)

// WHY the whole object works (external_deps.md §1): registerCommand's 2nd param is
//   Omit<RegisteredCommand, "name"|"sourceInfo"> = { description?, getArgumentCompletions?, handler }.
//   S1's factory returns exactly { description, handler } — structurally assignable. tsc proves it.

// CRITICAL (GOTCHA #3 — sequencing): if `npm run typecheck` fails with
//   "Module '\"./commands.js\"' has no exported member 'makeAuditCommand'", P2.M2.T1.S1 has not landed yet.
//   Confirm with `grep -nE '^export function makeAuditCommand' src/commands.ts` (expect 1 hit) and re-run.
//   Do NOT stub makeAuditCommand to force a green typecheck — that violates the contract.

// CRITICAL (GOTCHA #4 — no renumber): S2 edits INSIDE block 4. The "// 5."/"// 6."/"// 7." comments stay as-is.
//   (P2.M1.T1.S2 already did the last renumber; this item adds no new STEP, only a 3rd line in block 4.)
```

### Integration Points

```yaml
CODE (src/index.ts — MODIFIED):
  - import { makeCheckpointCommand, makeCheckpointRevokeCommand, makeAuditCommand } from "./commands.js"  # EXTENDED
  - pi.registerCommand("mulligan_audit", makeAuditCommand(pi))                                            # NEW (3rd command)
  - block-4 header comment + factory JSDoc updated (2 → 3 human commands)                                 # doc/structure

TEST (test/index.test.ts — MODIFIED, minimal):
  - the registration assertion renamed + bumped to expect 3 names                                          # verifies S2 deliverable
  - makePi() UNCHANGED (already captures registerCommand from P2.M1.T1.S2)

DATABASE: none
CONFIG: none (S1's handler reads getConfig().enabled — already exists)
ROUTES: the registered command name IS the route (/mulligan_audit)

DOCS: [Mode A] factory JSDoc updated to name the 3 human commands + cite spec/13 §2–§4. Docs RIDE WITH the
      code (no separate doc file). The block-4 comment cites spec/13 §4 + notes makeAuditCommand's pi is
      captured-but-unused.

COORDINATION (index.ts is multi-touch — change_surface.md "index.ts Multi-Touch"):
  - P1.M3.T1.S1 (Complete) — removed the checkpoint agent tool. ✅
  - P2.M1.T1.S2 (Complete) — registered the 2 checkpoint commands + renumbered steps 4→5→6→7. ✅
  - P2.M2.T1.S2 (THIS) — registers /mulligan_audit INSIDE block 4 (no renumber).
  - P2.M3.T1.S3 (later) — will add reconcileBanner(ctx) to the session_start handler (block 6). DISTINCT region.
  S2's edits (import line 12, block 4, factory JSDoc) are DISTINCT from P2.M3.T1.S3's region (session_start
  handler body). No merge conflict expected.
```

## Validation Loop

### Level 1: Type Check (THE make-or-break gate — after Tasks 1–3)

```bash
npm run typecheck    # = tsc --noEmit (strict + noImplicitAny; include: src+test)
echo "typecheck exit: $?"
# EXPECT: exit 0, no output. Proves: P2.M2.T1.S1 landed (makeAuditCommand is exported from ./commands.js); the
#   extended import resolves; the factory object {description, handler} is assignable to
#   Omit<RegisteredCommand,"name"|"sourceInfo">.
# If it fails: "has no exported member 'makeAuditCommand'" → GOTCHA #3: S1 has not landed. Confirm with
#   `grep -nE '^export function makeAuditCommand' src/commands.ts` (expect 1 hit) and re-run after S1 lands.
#   "Argument of type X is not assignable to parameter of type Y" → you rebuilt a {description,handler}
#   literal instead of passing the factory object whole (GOTCHA #2).
```

### Level 2: Unit / Suite Tests (after Task 4)

```bash
npm test            # = vitest run (full suite)
echo "test exit: $?"
# EXPECT: full suite GREEN. Specifically the updated "registers the 3 human slash commands with the exact
#   names" test passes (commands === ["mulligan_checkpoint","mulligan_checkpoint_revoke","mulligan_audit"]).
#   The existing "registers all 4 tools" / "arms the 5 event handlers" tests STILL pass (no tool/handler
#   change; makePi() untouched).
# If "registers all 4 tools" now FAILS with "pi.registerCommand is not a function" → impossible here (makePi
#   already has registerCommand); would indicate an accidental makePi() edit — revert it.
# If the updated command test fails with only 2 names → the audit registerCommand isn't in block 4 (Task 2).
```

### Level 3: Integration (the registration IS the integration)

```bash
# S2's whole point is wiring S1's factory into Pi's command map. The integration proof is: (a) typecheck
# shows the factory object satisfies registerCommand's param type, and (b) the captured-commands assertion
# shows /mulligan_audit is registered with its exact name. There is no server to start. A live-TUI dispatch
# test is out of scope (the handler behavior is S3; Pi's command runner is Pi's responsibility). Do NOT spin
# up a real Pi session.

# Optional reasoning check: C2 (extension-injected messages don't dispatch as commands) does NOT apply —
# registerCommand is direct registration of a human-typed command (external_deps.md §1). No guard needed.
```

### Level 4: Scope & Traceability Gates

```bash
# (a) Scope — exactly two files modified by S2:
git status --short
# EXPECT: ` M src/index.ts` and ` M test/index.test.ts`. If ANY other tracked file shows as modified
#   (src/commands.ts, src/banner.ts, src/tools/*, other test files), you went out of scope — revert it.

# (b) Import gate (GOTCHA #1 — ONE ./commands.js import line, naming all 3 factories):
grep -c 'from "./commands.js"' src/index.ts   # EXPECT: 1 (a single import line, extended — NOT a 2nd line).
grep -c "makeAuditCommand" src/index.ts       # EXPECT: 2 (the import + the registerCommand call).

# (c) Registration gate (the audit command is registered, whole-factory-object form — GOTCHA #2):
grep -nE 'pi\.registerCommand\("mulligan_audit", makeAuditCommand\(pi\)\)' src/index.ts   # EXPECT: 1 hit.

# (d) No-rebuild gate (must pass factory object, not a literal — GOTCHA #2):
grep -cE 'registerCommand\("mulligan_audit", \{ description' src/index.ts   # EXPECT: 0 (no rebuilt-literal form).

# (e) JSDoc accuracy gate (GOTCHA #7/#8 — 3 commands named; stale forward-ref removed):
grep -c "the 3 human slash commands" src/index.ts            # EXPECT: 1 (the JSDoc line).
grep -c "/mulligan_audit is added by P2.M2.T1.S2" src/index.ts   # EXPECT: 0 (stale line removed — GOTCHA #8).
grep -c "all 4 agent-callable tools" src/index.ts            # EXPECT: ≥1 (tool count UNCHANGED — GOTCHA #7).

# (f) No-renumber gate (GOTCHA #4 — steps 5/6/7 untouched):
grep -nE '// 5\. Arm the 3 event-driven handlers' src/index.ts    # EXPECT: 1 (still step 5).
grep -nE '// 6\. session_start' src/index.ts                      # EXPECT: 1 (still step 6).
grep -nE '// 7\. session_shutdown' src/index.ts                   # EXPECT: 1 (still step 7).

# (g) Test gate (GOTCHA #5 — makePi unchanged; assertion updated):
grep -c "registers the 3 human slash commands" test/index.test.ts   # EXPECT: 1 (the renamed assertion).
grep -c "registers the 2 human checkpoint slash commands" test/index.test.ts   # EXPECT: 0 (old name gone).
grep -c "registerCommand(name: string" test/index.test.ts          # EXPECT: 1 (the makePi capture, UNCHANGED).
```

## Final Validation Checklist

### Technical Validation
- [ ] Level 1: `npm run typecheck` → exit 0 (proves S1 landed + import resolves + factory assignable).
- [ ] Level 2: `npm test` → full suite GREEN (incl. the updated 3-command assertion).
- [ ] Level 4a: `git status --short` → only `src/index.ts` + `test/index.test.ts` modified by S2.
- [ ] Level 4b: exactly 1 `from "./commands.js"` import line (extended, not duplicated).
- [ ] Level 4c: 1 `pi.registerCommand("mulligan_audit", makeAuditCommand(pi))` (whole-object form).
- [ ] Level 4d: zero rebuilt-`{ description` literals passed to registerCommand.
- [ ] Level 4f: steps // 5. / // 6. / // 7. UNCHANGED (no renumber — GOTCHA #4).

### Feature Validation
- [ ] `/mulligan_audit` is registered with its exact name (the assertion proves it; a human typing it would
      dispatch to S1's handler).
- [ ] The factory JSDoc accurately names the 3 commands registered and cites spec/13 §2–§4.
- [ ] No new failure modes at bootstrap (registration is sync, fail-fast — no try/catch added).

### Code Quality / Scope Discipline
- [ ] Modified ONLY `src/index.ts` + `test/index.test.ts`.
- [ ] Did NOT modify `src/commands.ts` (S1's deliverable).
- [ ] Did NOT modify `makePi()` (already captures `registerCommand` — GOTCHA #5).
- [ ] Did NOT renumber steps 5/6/7 (GOTCHA #4).
- [ ] Did NOT write audit-handler tests (P2.M2.T1.S3).
- [ ] Did NOT touch the session_start handler / banner (P2.M3.T1.S3).
- [ ] Followed conventions: `./` import paths + `.js` extensions; factory-object registration idiom;
      2-space indent / double quotes; step-comment numbering kept consistent.

### Documentation
- [ ] Factory JSDoc names the 3 human commands and cites spec/13 §2–§4 + spec/13 §4 for audit.
- [ ] Block-4 step comment cites spec/13 §4 and notes `makeAuditCommand`'s `pi` is captured-but-unused.
- [ ] Stale "/mulligan_audit is added by P2.M2.T1.S2" forward-reference removed (GOTCHA #8).
- [ ] No separate doc file (Mode A — docs ride with the code).

---

## Anti-Patterns to Avoid

- ❌ Don't add a SECOND `import { makeAuditCommand } from "./commands.js"` line — EDIT the existing line 12 to
  add `makeAuditCommand` as a third named export (GOTCHA #1). A duplicate import is a lint error.
- ❌ Don't rebuild a `{ description: "...", handler: ... }` literal for registerCommand — pass the factory
  object WHOLE: `pi.registerCommand("mulligan_audit", makeAuditCommand(pi))` (GOTCHA #2).
- ❌ Don't run typecheck before P2.M2.T1.S1 lands and then "fix" the failure by stubbing `makeAuditCommand` —
  the failure is the documented sequencing gate (GOTCHA #3). Confirm S1 landed and re-run.
- ❌ Don't renumber steps 5/6/7 or insert a new step — S2 appends INSIDE the existing block 4 (GOTCHA #4).
- ❌ Don't modify `makePi()` — it already captures `registerCommand` from P2.M1.T1.S2 (GOTCHA #5). Only the
  assertion changes.
- ❌ Don't wrap the registerCommand call in try/catch — registration is sync/fail-fast by design (GOTCHA #6).
- ❌ Don't bump the tool count or remove the audit AGENT tool registration — the human command is a PARALLEL
  surface, not a replacement (GOTCHA #7). "4 agent-callable tools" stays "4".
- ❌ Don't leave the "/mulligan_audit is added by P2.M2.T1.S2." forward-reference in the JSDoc — once S2 lands
  that line is false; delete it and fold `/mulligan_audit` into the human-commands sentence (GOTCHA #8).
- ❌ Don't add audit-handler-behavior tests (notify wording, report rendering, hasUI guards, disabled gate) —
  that is P2.M2.T1.S3's scope, in a separate file. S2's test change is the one assertion update only.
- ❌ Don't touch the session_start handler to add `reconcileBanner(ctx)` — that is P2.M3.T1.S3.

## Confidence Score

**9/10** for one-pass implementation success. The change is tiny (extend 1 import + append 1 registerCommand
inside block 4 + update the JSDoc + bump 1 test assertion), every edit is given verbatim with exact
before/after, and the traps that would otherwise bite are called out with the failure symptom + fix: (1) the
sequencing gate on S1 landing (GOTCHA #3 — typecheck fails with a clear "no exported member" until S1 lands),
(2) the whole-object-vs-literal registerCommand shape (GOTCHA #2), (3) the no-renumber discipline (GOTCHA #4
— easy to over-apply P2.M1.T1.S2's renumber here), and (4) not touching makePi() (GOTCHA #5). The 1-point
reserve covers the small chance the implementer hits the S1-not-landed typecheck failure and stubs the
factory instead of waiting for S1 — but the symptom + recovery is stated in-place, so recovery is one
verification step. Scope is tightly bounded (two files; no handler tests; no banner; no makePi change),
eliminating the most common failure mode (going out of scope).