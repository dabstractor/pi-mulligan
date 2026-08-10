# HANDOFF — pi-looper spec brief

> **Note-to-self, in the spirit of the feature we're building.**
> This was written by a context that just spent ~150k tokens proving feasibility
> by reading pi's `.d.ts` files, session JSONL, and running a smoke harness. None
> of that archaeology is needed to write the spec — it's all compressed below.
> If you are a fresh (or rewound) context: read this, then write the spec. Do not
> re-derive anything in here; it was empirically verified on pi **0.84.0**,
> `PI_MODEL=glm-5.2`, on 2026-08-07.

---

## TL;DR

Agent self-rewind is **feasible**. Ship the **synchronous, marker-driven
context-filter path** (Path 1). It is fully proven and autonomous. The
"real tree branch from an autonomous tool" path (Path 2) is **refuted** —
see the hard constraint. Don't spec Path 2 as an agent capability.

---

## The one mechanism to spec: Path 1 (synchronous, autonomous rewind)

A tool the agent calls:

```ts
pi.appendEntry("looper:rewind", { spec, ts })          // persists intent (CustomEntry, NOT in context)
pi.sendMessage({ customType: "looper:note", content })  // the note (custom_message, IS in context)
```

A `context` event handler fires before every inference, reads rewind markers
from `ctx.sessionManager.getEntries()`, and returns `{ messages: filtered }`.

**Proven behavior:**
- The filter takes effect on the **next inference in the same agent loop**
  (canary dropped 5→4 immediately after the tool set the marker).
- The model **auto-continues** after the tool returns (normal agent loop;
  a `toolUse` turn always yields another inference). No special resume code.
- The marker persists in JSONL → the filter **re-applies on every future
  inference and survives `/resume`/restart**. Hidden content never reaches the
  model again unless the marker is cleared. This is a *permanent soft-delete*.
- `/tree` still shows the full tree → **free audit trail**.

This is "rewind" reframed: not deletion, not even branching — a persisted
view-filter. It's strictly safer (recoverable, inspectable) and synchronous.

---

## Proven primitives (all reachable from a tool's `ExtensionContext`)

| Primitive | API | Proven | Notes |
|---|---|---|---|
| Persist rewind intent (not in context) | `pi.appendEntry(customType, data)` | ✅ | returns `void` (not an id) |
| Leave a note (in context) | `pi.sendMessage({customType,content,display})` | ✅ | creates `custom_message` entry |
| Checkpoint | `pi.setLabel(entryId, label)` / `getLabel` | ✅ | round-trip works |
| Per-inference filter | `context` event → `{messages}` | ✅ | deep copy; re-applied each turn |
| Persistent in-place rewrite | `tool_result` event → `{content}` | ✅ | **persists to JSONL** + reaches next turn (2021→46 chars verified in both) |
| Token read | `ctx.getContextUsage()` | ✅ | estimate-based after last assistant msg |

---

## THE hard constraint (load-bearing — do not forget)

**Extension-injected messages bypass command dispatch.** Proven twice:
`pi.sendUserMessage("/cmd", {deliverAs:"followUp"})` from a tool, AND
`pi.sendUserMessage("/cmd")` from `agent_settled` (idle) — both delivered the
slash-string to the model as a **user message**; the command never ran
(`input` event fired with `source:"extension"`, but the "commands checked
first" step is skipped for extension sources).

Consequences:
1. An autonomous tool **cannot reach command context** → cannot call
   `navigateTree` / `fork` / `newSession` by any message route.
2. The documented `reload-runtime` example pattern is **misleading** — it
   does not actually dispatch its command either.
3. **Real tree-branching rewind is human-only** (typed slash command), not
   an agent capability. `navigateTree` itself is sound (creates real
   recoverable branches, verified in JSONL) — it's just unreachable from a
   tool. Ship it as an optional `/looper-branch` the *user* runs, or drop it.

Also note: `ExtensionContext.sessionManager` is typed `ReadonlySessionManager`
— a `Pick` of read methods only. No `branch`/`appendMessage`. Direct session
mutation from a tool is impossible by type, not just convention.

---

## Decisions the spike SETTLED (were open, now closed)

- **Synchronous rewind** — Path 1; no async two-turn dance needed.
- **Operation set** — `rewind` (filter) + `shrink_result` (`tool_result`
  rewrite) + `checkpoint` (`setLabel`) + `audit` (token breakdown). All proven.
- **Rewind ≠ compact** — compaction summarizes the HEAD and keeps the TAIL;
  can't shed recent wrong-direction work. Rewind is a distinct primitive.
- **No direct session mutation from tools** — `ReadonlySessionManager`.

## Decisions REFRAMED

- **"Branching vs deletion"** → neither; it's a **marker-driven view filter**
  (permanent soft-delete). The question becomes: *is soft-delete-via-filter
  acceptable as THE rewind semantics?* (Recommendation: yes — recoverable +
  auditable beats irreversible.)
- **"Max rollback depth"** → reframes to *marker bookkeeping*: how many
  cumulative hide-markers / how much hidden context before we refuse or warn.

## Questions that SURVIVED the spike (still genuinely open — ask the human)

1. **Retry semantics.** Soft (rewind+note+re-plan) vs hard (replay prior tool
   calls). Spike tilts hard toward **soft-only**: hidden tool calls' side
   effects persist on disk, so hard replay compounds them. Confirm soft-only.
2. **Note authorship & structure (D4).** Agent prose vs generated summary vs
   hybrid. Pi already has a strong summary generator + structured format
   (Goal/Progress/Decisions/Critical-Context + read/modified files). Enforce
   structured fields (`what_happened`, `true_current_state`, `next`)?
3. **Preventive layer (D7).** A `tool_result` hook that auto-truncates/summarizes
   big results *before* they're stored. Now trivially implementable (proven hook).
   Auto-truncate-to-pointer vs auto-summarize vs advisory-only? Built-in tools or
   custom only?
4. **Confabulation / state-ledger (D17).** After rewind the model sees
   `[older ctx] + [note]`; it may "remember" rolled-away facts or re-derive the
   same error. How prescriptive must the note be about current TRUE state?
   Note: hidden entries still exist in `/tree`, so a state-ledger in the note is
   what prevents redoing abandoned work.

## NEW questions the spike surfaced

5. **Bookkeeping drift.** Path 1 is a view-filter, so `getContextUsage()` may
   still count hidden tokens. The `audit` tool must compute tokens from the
   *filtered* set, not `getContextUsage`. Decide how.
6. **Marker lifecycle / un-rewind.** How does the agent (or user) clear a
   hide-marker to restore hidden content? A second tool? A TTL? Manual via `/tree`?
7. **Entry↔message mapping for the filter.** `context` gives `messages`, not
   entries; markers store entry specs. Robust options: relative ("drop last N
   completed turns") or match by `customType`/content. Avoid fragile positional
   indexing (compaction/branch entries don't all produce messages).
8. **Human-only branching.** Ship `/looper-branch` (uses `navigateTree`) or
   drop real-branching entirely and let Path 1 be permanent?

---

## Residual risks (low, named)

- `navigateTree` exact leaf-attachment (target vs target's parent) unconfirmed
  on user-message targets — only matters for the optional human command.
- Compaction × manual-rewind interaction (could double-summarize) — define
  precedence; simplest is "manual rewind reduces load so auto-compact fires later."
- Print/headless mode: followUp-command dispatch is dead there; but Path 1 works
  in all modes (proven in `-p`). The extension is TUI/RPC-primary regardless.

---

## Pointers (don't re-read these unless implementing)

- **Smoke harness:** `./looper-smoke.ts` — `pi -e ./looper-smoke.ts -p "/looper_test"`
  (deterministic suite) or `-p "<prompt calling looper_rewind|looper_big>"`.
  Logs to `/tmp/looper-smoke.log` + stderr.
- **Proven session artifacts:** `~/.pi/agent/sessions/--home-dustin-projects-pi-looper--/`
  — `..._looperA5.jsonl` (navigateTree branch topology), the `019fdd52/54/55`
  files (context-filter + shrink persistence).
- **Key pi APIs:** `ExtensionAPI.{appendEntry, sendMessage, sendUserMessage,
  setLabel}`, `ExtensionContext.{sessionManager(Readonly!), getContextUsage,
  compact}`, events `context` / `tool_result` / `message_end`.
- **Pi docs read during spike:** `docs/extensions.md`, `docs/session-format.md`,
  `docs/compaction.md`; examples `truncated-tool.ts`, `send-user-message.ts`,
  `trigger-compact.ts`, `bookmark.ts`.

---

## Next step

Write the technical spec against **Path 1 + `shrink_result` + `checkpoint` +
`audit`**, with real-branching as an optional human command. Resolve Q1–Q8
above with the human first (they're the only things blocking a complete spec).
Everything else is implementation.