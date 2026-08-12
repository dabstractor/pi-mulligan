# Research Notes — P2.M2.T1.S2 (index.ts: register the audit command)

## Task
Register `makeAuditCommand(pi)` (produced by P2.M2.T1.S1 in `src/commands.ts`) in `src/index.ts` via
`pi.registerCommand("mulligan_audit", makeAuditCommand(pi))`, so a human typing `/mulligan_audit` dispatches
to the handler. Update the factory JSDoc (2 → 3 human commands) and the one registration-count test
assertion (2 → 3).

## Dependency / parallel context
**P2.M2.T1.S1 is being implemented in parallel** and produces `makeAuditCommand` in `src/commands.ts`.
This PRP treats S1's PRP as a CONTRACT. Verified contract facts (from S1's PRP):
- `export function makeAuditCommand(pi: ExtensionAPI): { description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }`
- Returns `{ description: "Run the Mulligan context-bloat diagnostic — see what the model is carrying", handler }`.
- Structurally assignable to `Parameters<ExtensionAPI["registerCommand"]>[1]` (= `Omit<RegisteredCommand, "name"|"sourceInfo">`).
- `pi` is captured-but-unused (registration uniformity; the audit reads through ctx/pure helpers).
- Precondition: **S1 must land BEFORE S2's typecheck can pass.** If `makeAuditCommand` is absent from
  `src/commands.ts`, `import { makeAuditCommand } from "./commands.js"` fails `tsc` with "has no exported
  member 'makeAuditCommand'". This is a sequencing gate, not a design problem.

## Verified current state (src/index.ts after P2.M1.T1.S2 landed)
- Line 12: `import { makeCheckpointCommand, makeCheckpointRevokeCommand } from "./commands.js";` — the import S2 EXTENDS (the item description's "if P2.M1.T1.S2 already added the commands import, just add makeAuditCommand to the existing import").
- Factory JSDoc (L17-22): says "the 2 human slash commands (/mulligan_checkpoint, /mulligan_checkpoint_revoke …)" + "/mulligan_audit is added by P2.M2.T1.S2." → S2 flips "2"→"3", names all three, removes the forward-reference line.
- Comment block "// 4. Register the 2 human slash commands" with 2 `pi.registerCommand(...)` calls → S2 appends a 3rd.
- Comments "// 5. Arm the 3 event-driven handlers", "// 6. session_start", "// 7. session_shutdown" → NO renumber needed (the audit registration goes INSIDE the existing "// 4." block, not as a new step). This DIFFERS from P2.M1.T1.S2 (which inserted a new step 4 and renumbered 4→5→6→7). S2 only edits inside block 4.

## Verified current state (test/index.test.ts)
- `makePi()` (L24-46) ALREADY captures `registerCommand` (L40: `registerCommand(name, _options) { commands.push({ name }); }`) — added by P2.M1.T1.S2. **S2 makes NO change to makePi().**
- The only command-count assertion: L86-92 "registers the 2 human checkpoint slash commands" → S2 renames + bumps to 3 names.
- `grep` confirms NO other test file references the human-command count (smoke.ts uses its own `mulligan_smoke` command; checkpoint.test.ts tests the removed AGENT tool; commands.test.ts tests handlers directly). So only index.test.ts needs the assertion update.

## registerCommand contract (from external_deps.md §1, re-confirmed in P2.M1.T1.S2 PRP)
`pi.registerCommand(name: string, options: Omit<RegisteredCommand, "name"|"sourceInfo">)` where options =
`{ description?, getArgumentCompletions?, handler }`. Pass the factory's `{ description, handler }` object
WHOLE (same idiom as P2.M1.T1.S2's two checkpoint registrations). C2 (extension-injected messages don't
dispatch as commands) does NOT apply — registerCommand is direct registration of a human-typed command.

## Decision: no try/catch around registration
Mirrors P2.M1.T1.S2 GOTCHA #7 and the existing factory JSDoc ("fail-FAST on wiring errors at bootstrap").
Registration is synchronous with no bootstrap failure mode. The handler itself is fully self-protecting
(S1's PRP wraps the whole body in try/catch → unexpected-error notify). Registration does not invoke the
handler, so a handler bug can't surface at registration time.

## Decision: comment placement = INSIDE block 4, no renumber
The item description says "Add `pi.registerCommand('mulligan_audit', makeAuditCommand(pi));` alongside the
other two command registrations (after the checkpoint commands)." This means appending to the existing
"// 4. Register the human slash commands" block — NOT adding a new step. So:
- Block-4 header comment: "2 human slash commands" → "3 human slash commands"; "Both are FACTORIES" → "All three are FACTORIES".
- Steps 5/6/7 (event handlers / session_start / session_shutdown) are UNTOUCHED — no renumbering.

## Output contract (from item description)
"index.ts registers 4 tools + 3 human commands (/mulligan_checkpoint, /mulligan_checkpoint_revoke,
/mulligan_audit)." The 4 tools are unchanged (audit AGENT tool stays registered; the human /mulligan_audit
is a parallel surface, not a replacement — spec/13 §4).

## Scope discipline (what S2 does NOT do)
- Does NOT modify `src/commands.ts` (S1's territory; the factory is S1's deliverable).
- Does NOT add audit-command handler tests (P2.M2.T1.S3).
- Does NOT touch the session_start handler / banner (P2.M3.T1.S3).
- Does NOT modify makePi() (already has registerCommand capture from P2.M1.T1.S2).
- Does NOT renumber steps 5/6/7 (audit registration is inside block 4).