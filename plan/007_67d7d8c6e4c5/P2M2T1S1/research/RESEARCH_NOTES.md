# P2.M2.T1.S1 — Research Notes (`makeAuditCommand`)

## Item
Add `makeAuditCommand(pi)` to `src/commands.ts` — the human-facing `/mulligan_audit` slash-command factory.
Surfaces the SAME report the agent's `mulligan_audit` tool produces, via `ctx.ui.notify` only (never into
`event.messages`). Source-only addition; registration = S2, tests = S3 (P2.M2.T1.S3).

## Key files read (evidence)
- `src/commands.ts` — the factory idiom to mirror: `makeCheckpointCommand(pi): { description, handler }`,
  module-local `notify(ctx, msg, type)` (hasUI-guarded), try/catch → unexpected-error notify, `getConfig().enabled`
  gate FIRST (the contract-literal "Mulligan is disabled", NO "Mulligan: " prefix), imports already present
  (`ExtensionAPI/CommandContext/Context`, `getConfig`, `reconcileBanner`).
- `src/tools/audit.ts` — EXPORTED (reusable): `renderAuditReport(args)`, `computeFilteredTotal(ctx)`,
  `listCheckpoints(entries)`, `describeMessage`, `messageBytes`, `buildCallLookup`, type `AuditRow`,
  `AuditDetails`. MODULE-PRIVATE (must replicate): `auditExecute`, `entriesToMessages`, `readStr/readOwn/isRecord`.
- `node_modules/.../extensions/types.d.ts:68-104` — full `ExtensionUIContext` (select/confirm/input/notify/
  setStatus/setWidget/...). **NO print/transcript-append method.** `ExtensionCommandContext` (L254) = session
  control only (newSession/fork/navigateTree/...); NO appendEntry.
- `src/runtime.ts:73` — `lastFiltered: AgentMessage[] | null` (null until first context fire → E16 fallback).
- `src/config.ts:119,163` — `audit.estimateConfidence` default `"medium"`; `rewind.protectedRoles` default
  `["first:user","latest:user"]`; `enabled` default `true`.
- `src/filter.ts:136` — `readMarkers(ctx)` → `{ rewinds, shrinks, metric, cancelledIds:Set, recentMetrics }`.
- `src/transforms.ts:1370` — `filterPipeline(messages, markers, config, branchEntries?)`.
- `tsconfig.json` — `strict`, `noImplicitAny`, NO `noUnusedParameters`/`noUnusedLocals`.

## Decision 1 — Replicate `auditExecute`'s pipeline; do NOT use `computeFilteredTotal` for the total
The contract step (c) says "call computeFilteredTotal(ctx)". REJECTED for the REPORTED total:
`computeFilteredTotal`'s own JSDoc says its E16 fallback deliberately omits `filterPipeline`
(*"CHEAPER than audit's fallback (no filterPipeline re-run) — the rewind guard ... only needs an estimate.
(Audit keeps its own more-accurate fallback.)"*). If the command used it for the total but built rows from a
`filterPipeline`-filtered view, the reported total would EXCEED the ranked rows' sum on the E16 path →
self-inconsistent + diverges from the agent tool's report. Spec §130 step 1 ("Reuse the existing auditExecute
pipeline") + step 2 ("Same renderer; the sink is determined by who invoked it") demand a BYTE-IDENTICAL report.
→ The command mirrors `auditExecute` steps 1–4 verbatim (resolve filtered [cached else filterPipeline fallback],
`totalTokens = estimateTokens(filtered)` from the SAME view, rank rows, read markers+checkpoints, renderAuditReport).
`computeFilteredTotal`/`windowTokens` are NOT used (the audit needs no window-size).

## Decision 2 — Sink = `ctx.ui.notify(report, "info")`
No `print`/transcript method on `ExtensionCommandContext`; `pi.appendEntry`/`sendMessage` are FORBIDDEN
(contract: "OUTPUT DOES NOT ENTER event.messages"). Among `ctx.ui` methods: `notify` = one-shot (matches the
existing checkpoint-command pattern + the contract's "use ctx.ui.notify"); `setWidget` = persistent (wrong
lifecycle for a one-shot diagnostic + collides with the banner's widget key namespace, P2.M3). → `notify`.
The module-local `notify(ctx,msg,type)` helper already gates on `ctx.hasUI`; add an explicit `if(!ctx.hasUI) return`
AFTER the disabled gate to skip the expensive pipeline in print/JSON mode.

## Decision 3 — Gate order: disabled FIRST, then hasUI, then pipeline
Matches `auditExecute` step 0 + the sibling checkpoint commands (disabled gate early). The contract's "(i)
disabled" is a REQUIREMENT, not an execution order. Disabled message = contract-literal "Mulligan is disabled"
(NO "Mulligan: " prefix) — same as the other commands.

## Decision 4 — `pi` captured-but-unused
The audit needs no `pi` (every read goes through `ctx`/pure helpers — CRITICAL INSIGHT #1 from audit.ts, extended
to the command). Factory keeps `makeAuditCommand(pi: ExtensionAPI)` for registration uniformity with the siblings
(index.ts will do `pi.registerCommand("mulligan_audit", makeAuditCommand(pi))`). `noUnusedParameters` is OFF →
compiles; document the unused capture in the JSDoc.

## Decision 5 — Replicate `entriesToMessages` locally (~10 lines)
`audit.ts`'s `entriesToMessages` is module-private; the command needs it for the E16 fallback. Replicate it
locally (delegating to Pi's canonical `sessionEntryToContextMessages`, exactly as audit.ts does) — NOT a divergent
conversion. Named `auditEntriesToMessages` to avoid any future name clash if audit.ts ever exports its own.

## Decision 6 — `readStr` avoided; use inline `typeof ... === "string"` reads
`audit.ts`'s `readStr/readOwn` are module-private. The command needs `msg.toolName` + `msg.role` for row building.
Use clean inline guards (`typeof msg.toolName === "string" ? msg.toolName : undefined`) — no `as any`, no helper
dependency. `describeMessage`/`messageBytes`/`buildCallLookup` ARE exported and reused.

## Parallel-safety
- S1 adds ONE export to `src/commands.ts`; changes nothing in the existing two factories → `test/commands.test.ts`
  (S3, parallel, tests CHECKPOINT commands) and `test/index.test.ts:90` (asserts 2 registered commands, S2's
  territory) are UNAFFECTED. S1's factory is dead code until S2 registers it.
- `makeAuditCommand`'s tests are P2.M2.T1.S3 (future) — NOT this item.

## Validation commands (verified idioms from the S3 PRP)
- `npm run typecheck` = `tsc --noEmit` (strict, includes src+test) → the make-or-break gate (casts must match
  audit.ts verbatim).
- `npm test` = `vitest run` → full suite must stay GREEN (S1 is additive source; nothing existing calls the new
  factory, so no regression is possible — if one appears, S1 went out of scope).
- Scope gate: `git status --short` → only ` M src/commands.ts` (single modified source file).