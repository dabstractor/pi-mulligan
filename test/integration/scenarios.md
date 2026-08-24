# Mulligan integration smoke harness — scenario playbook

> The integration layer for Mulligan (spec/10-testing.md §2). This doc is the playbook: how to run each F-*
> scenario, what to expect in the logs/JSONL, and what "pass" means. The deterministic suite is the default CI
> gate (`npm run smoke`); the model-driven prompts are the authoritative proof for the 3 model-dependent
> scenarios (F-rewind-core canary-drop, F-shrink-preventive bloat, F-nudge-drift nudge).

---

## How the harness works

### The two-extension load order (CRITICAL)

```
pi -e ./src/index.ts -e ./test/integration/smoke.ts …
#         ① FIRST               ② SECOND
```

Pi loads extensions in `-e` flag order, and context/tool_result/turn_end handlers **chain** in that order —
each handler receives the prior handler's transformed messages. So:

- **Mulligan** (`src/index.ts`) loads **first** → its `context` handler runs first → it returns the
  **filtered** message list.
- **The smoke helper** (`test/integration/smoke.ts`) loads **second** → its `context` handler runs second →
  it sees the **post-filter** messages and logs them (it is an **observer only** — it returns `void` so it
  never overrides Mulligan's filter).

If you reverse the `-e` order, the smoke helper sees pre-filter messages and every assertion fails.

### The deterministic command path

```
pi … -p "/mulligan_smoke <scenario>" -p "Reply with exactly: OK"
```

- The **first** `-p` dispatches the `/mulligan_smoke` extension command (Pi intercepts `/cmd` prompts and runs
  the command handler — no model call). The command sets up the scenario's persisted state using the **REAL**
  Mulligan tools (`makeRewindTool`/`makeShrinkTool`/`makeCheckpointTool` — imported from `src/`, same process).
- The **second** `-p` triggers a model turn, which (a) fires the `context` event so Mulligan's filter runs and
  the smoke helper logs `context.fire`, and (b) produces an assistant message so Pi **persists the session
  JSONL** (Pi only flushes the session file once an assistant message exists).

> **Why a second prompt instead of a queued follow-up?** Print mode (`pi -p`) does NOT drain a follow-up
> queued from inside a `/cmd` dispatch — the command path returns before the agent's drain loop, and
> `pi.sendUserMessage({deliverAs:"followUp"})` is fire-and-forget. A second `-p` prompt reliably triggers the
> observing turn + persists the session. (Verified against Pi 0.84.x `agent-session.js` / `print-mode.js`.)

Some scenarios use more than the canonical two `-p` flags: three-prompt flows (F-shrink-persist) and
split-phase seeding (F-consent) — each subsequent `-p` is an ordinary observing turn that fires `context`
and flushes the session JSONL.

### The two-run `/resume` pattern

Scenarios that prove state persists across a process restart (F-banner run 2, F-reload, E11) run **twice**:
a second `pi` invocation with the **same `--session-id`**, which pi reopens/resumes (see `### F-banner`'s
Run 1 / Run 2 blocks for the reference form). Those runs also pass `-ne` (`pi -ne`, used by F-banner and
F-ckptcmd) to isolate from a globally-installed older mulligan build's extension collision — environment
defense, not a suite requirement.

### The log + the session JSONL

- **Smoke log** (`/tmp/mulligan-smoke.log`, or `$MULLIGAN_SMOKE_LOG`): JSONL, written by the smoke helper.
  One line per event: `session.start`, `setup.canary`, `context.fire`, `tool.rewind`, `tool.shrink`,
  `tool.checkpoint`, `scenario.*`. This is the **primary** assertion source.
- **Session JSONL** (`~/.pi/agent/sessions/--<cwd>--/<ts>_<id>.jsonl`): persisted by Pi. The smoke helper
  logs its path in the `session.start` line's `detail.sessionFile`. Used for the §2.3 entry-shape invariants.

### A `context.fire` line

```json
{"test":"context.fire","status":"info","detail":{
  "count": 3,
  "msgCanaryPresent": true,      // the session_start canary (MULLIGAN-SMOKE-MSG-CANARY)
  "resultCanaryPresent": false,  // the mulligan_smoke_big canary (MULLIGAN-SMOKE-RESULT-CANARY)
  "notePresent": true,           // a mulligan:note custom message is in context
  "hasRewindMarker": true,       // a mulligan:rewind custom entry exists on the branch
  "shrunkInContext": false,      // the shrink replacement (MULLIGAN-SMOKE-SHRUNK) is in context
  "hasNudge": false,             // a mulligan:nudge custom message is in context (ephemeral)
  "seedAnchorInAssistant": true, // the seed REPLY anchor is visible (role-gated)
  "seedHiddenInAssistant": false, // the seed-hidden reply is hidden by the filter
  "banner": {"activeCount": 1, "names": ["cp"]}, // recomputed checkpoint labels (banner would show headless)
  "userMsgCount": 2,            // role==="user" messages in the filtered view
  "firstUserPresent": true      // a user prompt is still visible in the filtered view
  "highWater": {"latch": false, "fraction": 0.42} // §5.2 edge latch (aboveHighWater, post-handler read) and filtered-tokens/contextWindow; fraction null when the window is unknown (E12)
}}
```

The v1.1 observables are consumed by: `banner` → F-banner, `userMsgCount`/`firstUserPresent` → F-consent,
`highWater` → F-drift-userexempt.

### The §2.3 entry-shape invariants (asserted for every marker-creating scenario)

| Entry | Pi `type` | In context? |
|---|---|---|
| `mulligan:rewind` | `custom` | No (control state) |
| `mulligan:shrink` | `custom` | No |
| `mulligan:turn-metric` | `custom` | No |
| `mulligan:note` | `custom_message` | **Yes** (the resumed model reads it) |
| `mulligan:checkpoint:<name>` | `label` | No |
| `mulligan:nudge` | (never persisted) | (ephemeral — constructed in the filter copy only) |

**ZERO `mulligan:nudge` entries may appear on disk** (the §2.3 headline invariant).

### API-key tolerance

The deterministic command path persists all markers **before** any model call. The second `-p "Reply with
exactly: OK"` only needs the model to produce a trivial reply (to persist the session JSONL). If the model is
unavailable or times out, the smoke log assertions (markers, tool results) still hold; only the session-JSONL
assertions are skipped (with a note). So the suite is CI-runnable with any/no working key.

---

## The F-* scenarios (14)

Ten v1.0 scenarios plus the five v1.1 additions (F-consent, F-ckptcmd, F-banner, F-useraudit,
F-drift-userexempt — BUG-003 / spec @10-testing.md §2.1, added in the v2.0 post-validation round).
F-retrycap and F-abortfraction below are documented manual (Tier-2) paths, not auto-run; spec-only
F-cancel has no section (unit-covered). Everything else here is driven by `npm run smoke`.

### F-rewind-core

**Tests:** a rewind marker + note persist; the filter sees them on the next inference.

**Run (deterministic):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-rewind-core \
  -p "/mulligan_smoke F-rewind-core" -p "Reply with exactly: OK"
```

**Run (model-driven — the authoritative canary-drop proof):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts \
  -p "Call mulligan_smoke_big, then use mulligan_rewind (granularity last_tool_call_group) to undo it, leaving yourself a note."
```
The model calls the tools; `context.fire` shows `resultCanaryPresent` go `true → false` (the bloated result is
hidden after the rewind) and the message count drops.

**Expect in log:** `tool.rewind` (succeeded); `context.fire` with `hasRewindMarker:true`, `notePresent:true`.

**Expect in JSONL:** `mulligan:rewind` (custom) + `mulligan:note` (custom_message).

**Pass (deterministic):** marker + note persist; context.fire shows the filter sees them; §2.3 invariants hold.
*(The canary-drop / count-decrease + auto-prompt are model-driven — SOFT in the deterministic suite.)*

---

### F-shrink-persist

**Tests:** v2.0 current-turn shrink semantics end-to-end: a shrink marker persists; the substitution appears in the filtered view on the NEXT turn (the filter bound is the marker's issuing turn); the original stays on disk. Also proves the v2.0 hard refusal (out-of-turn target) fires end-to-end and appends nothing.

**Run (deterministic, 3-prompt flow):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-shrink-persist \
  -p "Call the mulligan_smoke_big tool once, then reply with exactly: DONE" \
  -p "/mulligan_smoke F-shrink-persist" \
  -p "Reply with exactly: OK"
```
The first prompt commits a real `mulligan_smoke_big` toolResult (RESULT_CANARY) in the current turn; the
`/mulligan_smoke` command prompt is NOT a user message (command dispatch bypasses the agent loop), so the
toolResult is still in the current-turn span at command time.

**Run (model-driven):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts \
  -p "Call mulligan_smoke_big, then mulligan_shrink it (by_tool_call_id of that call, or by_tool_name + occurrence) to a one-line summary."
```

**Expect in log:** `tool.shrink` variant `current-turn` (succeeded) and variant `refusal` (refused — "previous turn"); `context.fire` with `shrunkInContext:true` AND `resultCanaryPresent:false` (two-signal).

**Expect in JSONL:** `mulligan:shrink` (custom) — exactly the successful shrink count (the refusal variant appends nothing); the **original** RESULT_CANARY still present (shrink is a view-substitution, NOT a JSONL rewrite).

**Pass:** shrink marker persists; substitution visible on the observing turn and the original on disk — the
end-to-end mirror of the unit regression (an in-span shrink keeps applying after the next user message); the
v2.0 refusal variant hard-refuses out-of-turn targets and appends no second marker (the old E19 user-message
case is MOOT in v2.0 — a non-toolResult shrink is no longer expressible; spec/08 E19 / PRD §E19/h2.101); §2.3
invariants hold.

---

### F-shrink-preventive

**Tests:** the bloat reminder fires on a tool result exceeding its resolved per-tool bloat threshold (read: 24 KB, all other tools — including bash: 16 KB global default); a turn-metric with `bloatHit:true` is recorded.

**Run (deterministic):** the deterministic path cannot trigger the bloat reminder (a local `bigResult()` call
does not go through Pi's `tool_result` event, so Mulligan's `bloatReminderHandler` never sees it). It asserts
only that a turn-metric exists.

```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-shrink-preventive \
  -p "/mulligan_smoke F-shrink-preventive" -p "Reply with exactly: OK"
```

**Run (model-driven):** `bloatHit:true` is **not achievable via `mulligan_smoke_big`** — it is a `mulligan_*` tool, and `bloatReminderHandler` skips every tool whose name starts with `mulligan_` (src/nudges.ts GOTCHA #3, the `if (event.toolName.startsWith("mulligan_")) return;` line), so its result — however large — never fires the bloat reminder (see smoke.ts lines 14–17, 139–141, 205–211). The smoke harness registers no non-mulligan tool that can produce a >threshold result, so `bloatHit:true` is currently **unprovable in this harness**.

A genuine `bloatHit:true` proof requires a **non-`mulligan_*`** model tool call whose result exceeds its resolved per-tool threshold, e.g. a `read` of a file larger than 20 KB or a `bash` command outputting more than 32 KB:
```bash
# Run against a checkout that contains a >20 KB file (e.g. a generated log), NOT the stock smoke harness:
pi -e ./src/index.ts -e ./test/integration/smoke.ts \
  -p "Read the file big.log with the read tool and summarize it."
```
Such a real `tool_result` event appends the `[mulligan]` bloat reminder to the result and records `bloatHit:true` in the turn-metric.

**Expect in log (deterministic):** `tool.smoke_big` logged.

**Expect in JSONL:** `mulligan:turn-metric` (custom) exists.

**Pass (deterministic):** turn-metric exists; §2.3 invariants hold. *(bloatHit:true is unprovable in the smoke harness — see the model-driven note above; not asserted here.)*

---

### F-nudge-drift

**Tests:** a turn that grows past the drift threshold injects an ephemeral `mulligan:nudge`; ZERO nudges on disk.

**Run (deterministic):** the deterministic path cannot force the nudge — (a) lowering `driftThresholdTokens`
via `setConfig` does not work (Pi's jiti loader gives the smoke helper a separate `config.ts` module instance
from Mulligan's), and (b) the nudge needs two turns (turn 1 establishes the baseline, turn 2 grows past it).
It asserts only that a turn-metric exists + ZERO nudge entries (the §2.3 invariant).

```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-nudge-drift \
  -p "/mulligan_smoke F-nudge-drift" -p "Reply with exactly: OK"
```

**Run (model-driven — the authoritative nudge-injection proof):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts \
  -p "Tell me a very long, detailed story." -p "Now tell me another long one."
```
A turn that grows >3000 tokens (default `driftThresholdTokens`) → the next context fire ends with a
`mulligan:nudge` custom message (`hasNudge:true`); still ZERO `mulligan:nudge` entries in the session JSONL.

**Expect in log (deterministic):** `config.driftLow` logged.

**Expect in JSONL:** `mulligan:turn-metric` (custom) exists; ZERO `mulligan:nudge` entries.

**Pass (deterministic):** turn-metric exists; ZERO nudges on disk; §2.3 invariants hold. *(hasNudge:true is
model-driven — SOFT.)*

---

### F-protected

**Tests:** a rewind that would cross the first-user boundary is blocked by the filter's `protectedOk` check (defense-in-depth; v1.1 removed the discarded-latest-user-message drive, so the deterministic F-protected scenario is a no-op — the protection is asserted in `transforms.test.ts` / `edge-cases.test.ts`).

**Run (deterministic):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-protected \
  -p "/mulligan_smoke F-protected" -p "Reply with exactly: OK"
```

**Expect in log:** `tool.rewind` with text containing "refused" (the tool-level refusal: when the rewind would cross the first/only user message, `rewind.ts:step-5b` refuses before persisting).

**Expect in JSONL:** ZERO `mulligan:rewind` markers (the refusal is pre-persist — no marker is created). §2.3 invariants hold.

**Pass:** the protected rewind refused (tool text contains "refused"); ZERO rewind markers persisted; the turn survived (pi exit 0).

---

### F-maxdepth

**Tests:** after 5 active rewind markers, a 6th is refused with a depth message.

**Run (deterministic):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-maxdepth \
  -p "/mulligan_smoke F-maxdepth" -p "Reply with exactly: OK"
```

**Expect in log:** 5 `tool.rewind` lines (succeeded) + a 6th containing "max rewind depth" / "refused".

**Expect in JSONL:** exactly 5 `mulligan:rewind` (custom) entries.

**Pass:** 6th rewind refused with depth message; exactly 5 markers persisted; §2.3 invariants hold.

---

### F-retrycap

**Tests:** the per-prompt retry budget (E22 a–d). With `rewind.maxRetriesPerPrompt:2`, repeated `last_turn`
rewinds that re-land at the SAME prompt are refused at the 3rd attempt with the "per-prompt retry budget"
message; a fresh user prompt restores the budget.

**Run (deterministic):** set `rewind.maxRetriesPerPrompt:2` (via config), then drive repeated same-prompt rewinds.

**Expect in log:** 2 `tool.rewind` lines (succeeded) + a 3rd containing "per-prompt retry budget" / "refused";
a subsequent rewind after a NEW user message succeeds again.

**Expect in JSONL:** exactly 2 `mulligan:rewind` markers persisted for the first prompt (the 3rd refused
persists nothing); the post-new-prompt rewind adds a 3rd marker.

**Pass:** 3rd same-prompt rewind refused with the budget text and persists nothing; fresh prompt restores the
budget; `mulligan_shrink`/`mulligan_audit` remain callable throughout. §2.3 invariants hold.

> Deterministic unit coverage lives in `test/tools/rewind.test.ts` (P4.M1.T3.S1 / spec/10 §1.10); this is the
> Tier-2 live-reproduction path, documented, not auto-run.

---

### F-abortfraction

**Tests:** the context-fraction stop (E22 e). When the filtered context is ≥ `rewind.abortContextFraction`
of the window, a rewind is refused with the "context is at …% of the window" message even though the retry
budget remains; `mulligan_shrink` / `mulligan_audit` stay callable.

**Run (deterministic):** force the filtered view to ≥ `abortContextFraction` (default 0.9) of the window —
e.g. seed a large `mulligan_shrink`-able result so `rt.lastFiltered` ≈ the window — then attempt a rewind.

**Expect in log:** `tool.rewind` refused with "context is at" / "% of the window"; a `mulligan_shrink` call in
the same turn still succeeds (non-refusal).

**Expect in JSONL:** NO new `mulligan:rewind` marker (the rewind was refused before persisting); the
`mulligan:shrink` marker from the still-callable shrink persists.

**Pass:** rewind refused with the context-fraction text and persists nothing; shrink/audit callable; §2.3
invariants hold.

> Deterministic unit coverage lives in `test/tools/rewind.test.ts` (P4.M1.T3.S1 / spec/10 §1.10); this is the
> Tier-2 live-reproduction path, documented, not auto-run.

---

### F-checkpoint

**Tests:** a checkpoint label is set; a rewind to it persists; the label + rewind marker are on disk.

**Run (deterministic):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-checkpoint \
  -p "/mulligan_smoke F-checkpoint" -p "Reply with exactly: OK"
```

**Expect in log:** `tool.checkpoint` (succeeded) + `tool.rewind` (checkpoint granularity).

**Expect in JSONL:** a `label` entry `mulligan:checkpoint:alpha` + a `mulligan:rewind` (custom).

**Pass:** checkpoint label + rewind marker persist; §2.3 invariants hold.

---

### F-ckptcmd

**Tests:** the HUMAN slash commands `/mulligan_checkpoint` + `/mulligan_checkpoint_revoke` drive the label
lifecycle end-to-end through the real Pi command dispatch (`src/index.ts` registration → `src/commands.ts`
handlers → `pi.setLabel` → LabelEntry in the session JSONL). BUG-003 / spec @10-testing.md §2.1.

**Run (deterministic — the orchestrator drives 4 literal prompts; commands are NOT routed through `/mulligan_smoke`):**
```bash
pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-ckptcmd \
  -p "Reply with exactly: SETANCHOR" \
  -p "/mulligan_checkpoint x" -p "/mulligan_checkpoint_revoke x" -p "Reply with exactly: OK"
```

Prompt 1 is a SEED model turn — slash-command prompts do NOT create user message entries (command dispatch
bypasses the agent loop), so the seed assistant reply is the real message the checkpoint labels (same
baseline-breakage fix as F-checkpoint). Prompt 2 sets `mulligan:checkpoint:x`; prompt 3 revokes it
(`setLabel(id, undefined)`, latest-wins); prompt 4 is an observing inference that commits the session JSONL.
The set/revoke dispatch is deterministic — no model call is needed for those two steps.

**Expect in JSONL:** a `{type:"label", label:"mulligan:checkpoint:x"}` set entry and a
`{type:"label", label:undefined}` clear entry with the SAME `targetId`.

**Pass:**
- (a) `mulligan:checkpoint:x` was SET (label entry exists; the clear comes AFTER the set)
- (b) after revoke, `labelActive(entries, "mulligan:checkpoint:x") === false` — a clear entry targets the
  SAME entry the set labeled (latest-wins)
- (c) ZERO custom `mulligan:checkpoint` entries — checkpoints are Pi LabelEntries (no control entry)
- (d) ZERO `mulligan_checkpoint` TOOL invocations in the JSONL (no agent checkpoint tool exists;
  unit-pinned at test/index.test.ts:74 — exactly 4 registered tools)
- (e) §2.3 global invariants (incl. `mulligan:checkpoint:` labels are `type:label`)

Unlike marker scenarios, a missing session JSONL is a HARD FAIL here — every assertion is JSONL-based and
the label writes are deterministic, so an absent JSONL means the spawn failed.

---

### F-banner

**Tests:** the active-checkpoint banner state end-to-end on a real `pi -p` run (BUG-003 / spec
@10-testing.md:103 §2.1): the banner **PERSISTS** across turns while a checkpoint is active, **CLEARS within
ONE fire** of `/mulligan_checkpoint_revoke`, is **RESTORED on `/resume`**, and contributes **ZERO banner
bytes** to the filtered view.

**Run (deterministic — two runs sharing `--session-id`; commands are NOT routed through `/mulligan_smoke`):**
```bash
# Run 1: seed → set → 2 observing fires (persistence) → revoke → 1 observing fire (cleared).
pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-banner \
  -p 'Reply with exactly: BANNERSEED' \
  -p '/mulligan_checkpoint beta' \
  -p 'Reply with exactly: OK' -p 'Reply with exactly: OK again' \
  -p '/mulligan_checkpoint_revoke beta' \
  -p 'Reply with exactly: OK3'
# Run 2 (SAME --session-id → pi reopens/resumes it): set a checkpoint, observe it on the resumed session.
pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-banner \
  -p '/mulligan_checkpoint gamma' -p 'Reply with exactly: OK4'
```

Prompt 1 is a SEED model turn — slash-command prompts do NOT create user message entries, so on a fresh
session `/mulligan_checkpoint beta` would have no real message to label (the same baseline breakage
F-ckptcmd fixed); the seed assistant reply is the label target. The four observing prompts use DISTINCT
reply texts (`OK` / `OK again` / `OK3` / `OK4`) so a model echo can never confuse fire attribution; the
reply content itself is not asserted. NOTE: smoke.ts's factory TRUNCATES the log per spawn, so run 2's log
holds ONLY run-2 lines — the orchestrator parses run-1's log BETWEEN the two spawns and concatenates the
two fire arrays for the cross-run assertions.

**Headless observable strategy:** `ctx.ui.setWidget` is **unobservable in `-p` mode** (`ctx.hasUI === false`
→ `reconcileBanner` branch (a) no-ops — src/banner.ts). The scenario instead asserts the pure
`listCheckpoints` recompute logged on every `context.fire` (the P1.M2.T1.S1 observable: the same
latest-wins label scanner `reconcileBanner` itself imports — `banner: {activeCount, names}`) **plus** a
0-banner-bytes grep of the filtered view (the banner is UI-only and never injected into `event.messages` —
E26 acceptance (d) — and the observable stores only names, so a whole-detail JSON grep for the fragment
`Mulligan checkpoint active:` is a true filtered-view check). The `/resume` restore is proven with a second
spawn reusing the same `--session-id` (the F-reload/E11 two-run pattern): the label persisted in the
reopened session JSONL, and `src/index.ts:87`'s `session_start` `reconcileBanner` path exists for it in UI
mode — headless, we assert the pure state it would render.

**Pass:**
- (a) pre-revoke fires (the two between set and revoke): `banner.activeCount ≥ 1` AND `banner.names`
  includes `"beta"` (persistence across turns)
- (b) first post-revoke fire: `banner.activeCount === 0`, no later run-1 active fire (clears within ONE fire)
- (c) some run-2 fire: `banner.activeCount ≥ 1` AND `banner.names` includes `"gamma"` (restored on /resume)
- (d) ZERO banner bytes: no `context.fire` detail in either run contains `Mulligan checkpoint active:`;
  `hasNudge === false` on every fire
- (e) both spawns exited 0 (soft-⚠-tolerated like F-reload when logs are present)

Zero context fires across both runs is a HARD FAIL (spawn/model failure — never a vacuous pass).

---

### F-consent

**Tests:** the v1.1 CONSENT model end-to-end on a real `pi -p` run (BUG-003 / spec @10-testing.md §2.1
:101): a user-set checkpoint consents to having their **subsequent user prompts hidden** by a checkpoint
rewind — the ONE place a rewind may hide user messages — while a `last_turn` rewind **NEVER** hides a user
message (the guardrail).

**Run (8-prompt split-phase flow; the two rewinds are deterministic via `/mulligan_smoke` → `rewindNow`,
the REAL `makeRewindTool`):**
```bash
pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-consent \
  -p 'Reply with exactly: SETANCHOR' \
  -p '/mulligan_checkpoint delta' \
  -p 'User says: MULLIGAN-SMOKE-CONSENT-U1 — reply with exactly: OK' \
  -p 'User says: MULLIGAN-SMOKE-CONSENT-U2 — reply with exactly: OK' \
  -p '/mulligan_smoke F-consent-rewind' \
  -p 'User says: MULLIGAN-SMOKE-CONSENT-GUARD — reply with exactly: OK' \
  -p '/mulligan_smoke F-consent-guard' \
  -p 'Reply with exactly: OK'
```

- **Seed anchor first** (prompt 1): slash-command prompts create NO user message entries, so a committed
  model turn must precede `/mulligan_checkpoint delta` for `setCheckpoint`'s backwards anchor walk
  (src/markers.ts:456-490) to find a stable entry — the same baseline breakage F-ckptcmd/F-banner fixed.
- **TWO user canaries** (U1/U2, prompts 3+4): the hiding assertion must not pass vacuously if one prompt
  fails to commit — each is independently verified visible pre-rewind, then hidden post-rewind.
- **Guard arm** (prompts 6+7): the GUARD canary lives in a user prompt a `last_turn` rewind re-lands on;
  it must stay VISIBLE (only checkpoint consent hides user messages).
- **Observing fire** (prompt 8): ALL hiding/visibility verdicts read off the LAST `context.fire` detail.
  Expected fires: 5 (prompts 1, 3, 4, 6, 8 — the slash prompts dispatch without inference).

**Observables** (smoke.ts, computed on EVERY fire): `consent: {u1, u2, guard}` — role-agnostic content
scans of the POST-filter view (the canaries are unique and only appear in user prompts); plus the
P1.M2.T1.S1 `userMsgCount` / `firstUserPresent` fields.

**Pass:**
- (a) the checkpoint rewind succeeded with K>0 (text not refused / not `0 messages will be hidden`);
  JSONL has the `mulligan:checkpoint:delta` label SET and CONSUMED (auto-expiry), and ≥2
  `mulligan:rewind` markers (checkpoint + guard)
- (b) on the final fire `consent.u1 === false` AND `consent.u2 === false` (both post-checkpoint user
  prompts hidden — THE consent behavior) while `userMsgCount ≥ 2` and the pre-checkpoint user prompts
  remain visible; at least one pre-rewind fire showed each of u1/u2 `true` (no vacuous pass)
- (c) `firstUserPresent === true` on EVERY fire (`first:user` is protected — config.ts `protectedRoles`)
- (d) on the final fire `consent.guard === true` — the re-landed GUARD user prompt remains visible after
  the `last_turn` rewind, and that rewind ran without refusal
- (e) global invariants hold; a missing JSONL is a HARD fail (every write is deterministic)

---

### F-drift-userexempt

**Tests:** the D10 **user-exemption** of the drift nudge end-to-end on a real `pi -p` run (BUG-003 /
spec @10-testing.md §2.1, fifth v1.1 scenario): a large (~60k-token) USER paste does **NOT** fire the
drift nudge, while the window-level **high-water** signal (which counts ALL context, user included)
still observes it. The negative-space counterpart of F-nudge-drift.

**Run (4-prompt flow; NO `/mulligan_smoke` dispatch — the paste must be genuine user prompts via
`-p`, because a command dispatch bypasses the agent loop and would defeat the D10 point):**
```bash
pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-drift-userexempt \
  -p '<generated paste part 1 — MULLIGAN-SMOKE-PASTE-CANARY + FILLER lines; runtime-generated>' \
  -p '<generated paste part 2 — FILLER lines>' \
  -p '<generated paste part 3 — FILLER lines>' \
  -p 'Reply with exactly: OK'
```

- **Generated paste**: ~60k tokens ≈ 240KB of argv total. Linux `MAX_ARG_STRLEN` caps a single argv
  argument at 128KB, so `run-smoke.mjs` splits the paste into 3 chunks of ~20k tokens (~80KB argv
  each) — every chunk is still a genuine user prompt, all user-attributable, so the D10 exemption
  and the ~60k-token total growth are preserved. The filler is generated deterministically at
  runtime (repeated `MULLIGAN-SMOKE-PASTE-FILLER-…` lines, ~4 chars/token per src/tokens.ts
  `CHARS_PER_TOKEN`); a checked-in 240KB fixture would bloat the repo and is forbidden.
- **D10 rationale**: `estimateAgentTokens` (src/tokens.ts:126-143) excludes `role==='user'`
  messages from the drift delta — the exemption is **structural** (there is no `50000` constant;
  spec/07:174's "50k" is illustrative).

**Expect in log** (`context.fire` detail on every fire): `hasNudge:false`, and
`pasteCanaryPresent:true` on post-paste fires (the `MULLIGAN-SMOKE-PASTE-CANARY` line proves the
paste is actually in the filtered context).

**Expect in JSONL:** ZERO `mulligan:nudge` entries (the §2.3 invariant + the exemption); global
invariants hold; a missing JSONL degrades to smoke-log assertions (model-timeout tolerance).

**Pass:**
- (a) HARD — pi exits 0; `hasNudge === false` on EVERY fire; ZERO `mulligan:nudge` entries on disk;
  `pasteCanaryPresent === true` on ≥1 fire; global invariants hold
- (b) SOFT (window-dependent) — `highWater.latch`/`fraction` (P1.M2.T1.S2) SHOULD show the 0.7
  crossing when the provider window is small enough; on huge windows (60k cannot cross 0.7) the
  result is a `⚠ SOFT` note with the measured max fraction — cf. F-nudge-drift's model-dependent arm
- (c) contrast — the "agent-attributable growth DOES fire the drift nudge" criterion is covered by
  the existing green F-nudge-drift scenario (above); cross-reference only, no duplication

---

### F-useraudit

**Tests:** the human `/mulligan_audit` command and the agent `mulligan_audit` tool render the **SAME
report** through **separated sinks** on a real `pi -p` run (BUG-003 / spec @10-testing.md §2.1
F-useraudit): the command's report goes ONLY to `ctx.ui.notify` (a one-shot human sink — never
`event.messages`, never persisted), while the agent tool's result reaches the model as a `toolResult`
entry; the real headless `/mulligan_audit` dispatch early-returns on `!ctx.hasUI` without throwing and
writes nothing.

**Run (3-prompt flow):**
```bash
pi -ne -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-useraudit \
  -p '/mulligan_smoke F-useraudit' \
  -p '/mulligan_audit' \
  -p 'Use the mulligan_audit tool with top 8 now, then reply with exactly: OK'
```

**Wrapper-ctx notify-capture strategy (THE core trick):** headless `-p` mode has `ctx.hasUI === false`,
and `makeAuditCommand`'s handler **early-returns** at that gate (src/commands.ts) — the raw command
would produce NO report and the parity assertion would compare a real report against `""` (a vacuous
fail). The `F-useraudit` smoke.ts case therefore wraps the **REAL** ctx: spread `...ctx`, override
`hasUI: true` + a capturing `ui.notify`. The wrapper REUSES the real `ctx.sessionManager` — a fake would
give a different filtered view/markers and parity would be coincidental, not proven.

**Parity claim:** prompt 1's case drives BOTH consumers back-to-back inside the one command dispatch —
the REAL `auditTool.execute("smoke-useraudit-tool-1", {top:8}, …, ctx)` and the REAL
`makeAuditCommand(pi).handler("", wrapperCtx)` — with NO session writes between them, so both hit the
same `rt.lastFiltered`-or-E16-fallback path and the identical `renderAuditReport` inputs. The asserter
compares the FULL texts after normalization (trim lines, drop blanks + `─`/`=` rule lines) with a
non-vacuity guard (the tool report must exceed 200 chars). The renderer emits no timestamps/volatile
fields (verified against `renderAuditReport` in src/tools/audit.ts), so normalized equality is exact.

**Sink-separation contract:**
- the command's captured notify output is NEVER persisted — the JSONL must contain ZERO report bytes
  (grep needle: the report title `Mulligan audit — context you are currently carrying`) outside the
  **sanctioned agent toolResult sink**
- the agent tool's result DID reach the model: prompt 3 has the model call `mulligan_audit` FOR REAL —
  pi only persists `toolResult` entries issued by the agent loop (a direct `execute` inside a command
  dispatch persists nothing — verified empirically), so the "reached the model" positive arm requires a
  genuine model tool call (the proven F-shrink-persist "Call the mulligan_smoke_big tool once…" setup
  pattern)
- prompt 2 (`-p /mulligan_audit`) is the REAL headless command dispatch through index.ts registration:
  `hasUI:false` → early return; it must not throw (pi exit 0) and must not write

**Pass:**
- (a) normalized tool report === normalized command-captured report (non-vacuous, full-text)
- (b) ZERO `mulligan:rewind`/`shrink`/`cancel` entries + ZERO report bytes outside the toolResult sink
- (c) a `mulligan_audit` toolResult entry IS in the session JSONL (the tool result reached the model)
- (d) the headless `/mulligan_audit` dispatch survived: pi exit 0, no crash/fail lines, zero extra writes
- (e) global invariants hold; a missing JSONL is a HARD fail for (b)/(c)

---

### F-failopen

**Tests:** the filter is fail-open — a malformed marker does NOT crash the turn (pass-through).

**Run (deterministic):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-failopen \
  -p "/mulligan_smoke F-failopen" -p "Reply with exactly: OK"
```

The command appends a malformed `mulligan:rewind` marker (missing `note`/`ledger`/etc). Mulligan's filter
wraps its whole body in try/catch → pass-through.

**Expect in log:** `failopen.marker` (appended); `context.fire` still logged (the filter ran without crashing).

**Pass:** pi exited 0 (the turn survived); context.fire logged. *(The authoritative "handler never throws"
proof is the unit test in `filter.test.ts` — GOTCHA #9. The harness verifies pass-through end-to-end.)*

---

### F-reload

**Tests:** a rewind marker survives a session reload (a second `pi` process with the same `--session-id`).

**Run (deterministic — two runs sharing `--session-id`):**
```bash
# Run 1: create the rewind marker.
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-reload \
  -p "/mulligan_smoke F-reload" -p "Reply with exactly: OK"
# Run 2: reopen the SAME session (--session-id smoke-F-reload) and run an observing turn.
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-F-reload \
  -p "/mulligan_smoke F-reload" -p "Reply with exactly: OK"
```

**Expect in log:** run-1 `tool.rewind`; run-2 `context.fire` with `hasRewindMarker:true`.

**Expect in JSONL:** `mulligan:rewind` (custom) persisted across the reload (both runs append to the same file).

**Pass:** run-2 sees the marker (`hasRewindMarker:true`); marker persisted on disk; §2.3 invariants hold.

---

## Edge-case scenarios (E7 / E11 / E12 / E15 / E20)

> These 5 scenarios (added by P1.M7.T3.S1) cover the spec/08 edge cases that are **Pi-dependent** — they
cannot be faithfully unit-tested because they need a real `pi` process, the real session JSONL, or a
pre-first-inference state. They APPEND to the 9 F-* scenarios above (the harness's surface); the consolidated
**unit-tier** E1–E20 coverage lives in `test/edge-cases.test.ts`.

### E7 — Compaction may transiently reference hidden content (KNOWN LIMITATION)

**Tests:** a rewind marker + note persist; the turn survives. v1 ACCEPTS that compaction may transiently
reference hidden content (no code mitigation exists; mitigated by later compaction). This scenario documents
the limitation + smoke-tests the no-crash property.

**Run (deterministic):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-E7 \
  -p "/mulligan_smoke E7" -p "Reply with exactly: OK"
```

**Expect in log:** `tool.rewind`; an `E7` info line carrying the known-limitation note.

**Expect in JSONL:** `mulligan:rewind` (custom) + `mulligan:note` (custom_message); §2.3 invariants hold.

**Pass:** pi exit 0 (no crash); the note persists. **PASS-with-note** is the accepted outcome (v1 limitation).

### E11 — Reload mid-task (marker survives reload)

**Tests:** a rewind marker created in run 1 survives a session reload — run 2 (same `--session-id`) reopens
the session and the filter sees the persisted marker.

**Run (deterministic — two runs sharing `--session-id smoke-E11`):**
```bash
# Run 1: create the rewind marker.
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-E11 \
  -p "/mulligan_smoke E11" -p "Reply with exactly: OK"
# Run 2: reopen the SAME session and run an observing turn.
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-E11 \
  -p "/mulligan_smoke E11" -p "Reply with exactly: OK"
```

**Expect in log:** run-1 `tool.rewind`; run-2 `context.fire` with `hasRewindMarker:true`.

**Expect in JSONL:** `mulligan:rewind` (custom) persisted across the reload.

**Pass:** run-2's first `context.fire` has `hasRewindMarker:true` (marker survived reload). **SOFT:** the first
run-2 turn-metric has `deltaTokens:null` (baseline lost on reload → drift nudge falls back to bloat-only).

### E12 — `getContextUsage` undefined (audit before any inference)

**Tests:** `mulligan_audit` is called as the FIRST action on a fresh session (before any assistant message).
The audit's E16 fallback path (no cached `lastFiltered`) must succeed with NO crash.

**Run (deterministic):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-E12 \
  -p "/mulligan_smoke E12" -p "Reply with exactly: OK"
```

**Expect in log:** an `E12.audit` info line (the audit ran + its source); no `E12.audit` fail line.

**Pass:** pi exit 0 (no crash); the audit ran via the E16 fallback path (`details.source` is `"fallback"`,
`details.confidence` is `"low"`). **SOFT:** a turn-metric is persisted on the observing turn (the `turn_end`
handler ran).

### E15 — 50 rewind markers (filter terminates, no GC)

**Tests:** 50 rewind markers are seeded via the RAW `appendRewindMarker` wrapper (NOT the tool — the tool's
depth guard refuses the 6th; the wrapper has no guard). The filter must TERMINATE (time-bounded) + no crash.
v1 does no GC — markers persist intentionally (audit trail).

**Run (deterministic):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-E15 \
  -p "/mulligan_smoke E15" -p "Reply with exactly: OK"
```

**Expect in log:** an `E15.seed` info line with `appended:50`; a `context.fire` line (filter terminated).

**Expect in JSONL:** exactly 50 `mulligan:rewind` (custom) entries; §2.3 invariants hold.

**Pass:** 50 markers seeded; pi exit 0; `context.fire` present (filter terminated). Message count did not
increase (monotonic shrinkage — shrinks only ever substitute/remove).

### E20 — `appendEntry`/`sendMessage` ordering (marker before note)

**Tests:** when `mulligan_rewind` runs, the synchronous append-then-send guarantees the `mulligan:rewind` entry
(an entry whose `type` is `"custom"`) appears BEFORE the `mulligan:note` entry (whose `type` is
`"custom_message"`) in FILE ORDER.

**Run (deterministic):**
```bash
pi -e ./src/index.ts -e ./test/integration/smoke.ts --session-id smoke-E20 \
  -p "/mulligan_smoke E20" -p "Reply with exactly: OK"
```

**Expect in JSONL:** the `mulligan:rewind` entry's file-order index is less than the `mulligan:note` entry's
index.

**Pass:** rewind (`custom`) appears BEFORE note (`custom_message`) in file order; §2.3 invariants hold.

---

## Running the whole suite

```bash
npm run smoke
```

Runs all 19 deterministic scenarios (14 F-* + 5 E*) via `test/integration/run-smoke.mjs`. Prints a `PASS`/`FAIL`
line per scenario (with per-assertion detail on failure), then a summary; exits 0 if all pass, 1 otherwise.

**Notes:**
- Each scenario spawns a fresh `pi` process with a stable `--session-id` (so F-reload can reopen). The smoke
  log is isolated per scenario under `$TMPDIR/mulligan-smoke/<scenario>.log`.
- Model-dependent sub-criteria (canary-drop, bloatHit, hasNudge, auto-prompt) are **SOFT** (warned, not failed)
  in the deterministic suite. The model-driven prompts above are the authoritative proofs for those.
- If `pi` exits non-zero with an empty smoke log, the orchestrator reports `EXTENSION LOAD FAILED` — look at
  `src/index.ts`, not the harness (GOTCHA #12).