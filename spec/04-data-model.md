# 04 — Data model

> Authoritative schemas for every shape Mulligan persists or passes internally. Implement these **exactly** (field names, casing, optionality) — the filter, the tools, and the tests all depend on them. All persisted shapes are JSON-serializable (they live in JSONL).

---

## 1. Versioning

Every persisted `CustomEntry` written by Mulligan includes a `v` (schema version, integer) and a `schema: "pi-mulligan"` tag inside its `data`. This lets future versions migrate or ignore unknown entries. **v1** is the version specified here.

```ts
interface MulliganEnvelope {
  schema: "pi-mulligan";
  v: 1;
  kind: "rewind" | "shrink" | "turn-metric" | "cancel";
  // ...kind-specific fields...
}
```

All `customType` strings are namespaced under `mulligan:`. The `customType` is the entry's *Pi-level* discriminator (what `getEntries()` filters on); `kind` is the *Mulligan-level* discriminator inside `data`.

| Pi `customType` | Pi entry type | `data.kind` | In LLM context? |
|---|---|---|---|
| `mulligan:rewind` | `custom` | `"rewind"` | no |
| `mulligan:shrink` | `custom` | `"shrink"` | no |
| `mulligan:turn-metric` | `custom` | `"turn-metric"` | no |
| `mulligan:cancel` | `custom` | `"cancel"` | no |
| `mulligan:note` | `custom_message` | (n/a — it's a message) | **yes** |
| (checkpoint) | `label` | (n/a) | no |

## 2. The note (input + rendered)

### 2.1 `NoteInput` — what the agent passes to `mulligan_rewind`

All three fields are **required and non-empty** (enforced by the tool; see `@05-tools.md`). Free text, but each field has a mandated purpose. This structure is the primary defense against confabulation (D/D17): the resumed model is told explicitly what happened (and what to avoid), what the true state is, and what to do next.

```ts
interface NoteInput {
  /** What went wrong, concretely (past tense), AND the lesson — what to avoid
   *  doing again. Generalize the lesson. e.g. "Ran `grep -r auth .` and dumped
   *  ~40k tokens I didn't need; don't run repo-wide grep without -l or piping
   *  to head — use the built-in grep tool which truncates." */
  what_happened: string;

  /** The current TRUE world state as of the rewind — task progress, decisions,
   *  and conclusions. This is the state-ledger that prevents redoing work. The
   *  tool AUGMENTS this with a deterministic file ledger (see §3) that
   *  auto-captures files/commands, so focus this field on what the ledger
   *  cannot: decisions and where the task stands. */
  true_current_state: string;

  /** The immediate next action to take on resume. Imperative. e.g. "Re-run the
   *  search as `grep -rl auth src/` and read only the 3 relevant files." */
  next: string;
}
```

### 2.2 `FileLedger` — deterministically extracted, appended to the note

Extracted from the tool calls in the rewound span (NOT a model call). Feeds `true_current_state`. Mirrors the shape Pi's own compaction uses for cumulative file tracking, so it is familiar.

```ts
interface FileLedger {
  readFiles: string[];      // paths appearing in read/grep tool calls in the span
  modifiedFiles: string[];  // paths appearing in write/edit tool calls in the span
  bashSideEffects: string[];// non-read bash commands (heuristic: commands with >, rm, mv, mkdir, git, curl, etc.)
}
```

Extraction rules (`extractFileLedger` in `ledger.ts`, pure):
- `readFiles`: union of `path`/`file_path` args from tool calls whose `name` ∈ {`read`, `grep`, `rg`, `glob`}.
- `modifiedFiles`: union of `path`/`file_path` args from tool calls whose `name` ∈ {`write`, `edit`, `bash`} (for bash, only when the command matches a write heuristic AND a path can be parsed — best-effort; uncertain entries go to `bashSideEffects`).
- `bashSideEffects`: bash commands in the span that are not provably read-only (regex heuristic; when in doubt, include).
- De-duplicated, sorted. Relative to `cwd`.

### 2.3 Rendered note (the `CustomMessage` content)

The tool composes the note the model sees from `NoteInput` + `FileLedger`:

```md
## 🔄 Mulligan rewind (<granularity>)

**What happened:** <what_happened>

**Current true state:** <true_current_state>

<files-read>
path/a.ts
path/b.ts
</files-read>

<files-modified>
path/c.ts
</files-modified>

<bash-side-effects>
git commit -m "wip"
</bash-side-effects>

**Next:** <next>
```

The `<files-read>` / `<files-modified>` / `<bash-side-effects>` block tags mirror Pi's compaction summary convention, so a model accustomed to compaction summaries parses them naturally. If a ledger list is empty, omit its block. The agent-supplied `true_current_state` text is rendered as-is (rendered verbatim; the ledger is the authoritative file/command set, presented separately — so focus this field on decisions and task progress, not files the ledger already covers).

`renderNote(note: NoteInput, ledger: FileLedger, granularity: Granularity): string` is pure and unit-tested with snapshot-style cases.

## 3. Marker: rewind

Stored via `pi.appendEntry("mulligan:rewind", data)`. The `data`:

```ts
interface RewindMarker extends MulliganEnvelope {
  kind: "rewind";
  id: string;                 // mulligan-internal uuid; also used to correlate with the note
  granularity: "last_tool_call_group" | "last_turn";
  options: {
    protect?: string[];             // role list that must not be crossed (default from config)
  };
  /** toolCallId of THIS rewind's own tool call, so the filter can exclude the
   *  rewind's own group when resolving "last tool-call group". Captured from the
   *  tool execute()'s toolCallId argument. */
  excludeToolCallId?: string;
  /** Stable ENTRY IDs of the messages to hide, pinned ONCE at marker-creation time
   *  (by `captureHideEntryIds` in the rewind tool's creation-time snapshot). When
   *  present + non-empty, `filterPipeline` resolves them by identity → current
   *  message indices via `resolvePinnedHide` (`@06-context-filter.md` §12),
   *  guaranteeing PERMANENT soft-delete hiding across session growth (fixes
   *  BUG-001 leak-back + BUG-002 infinite loop: relative specs re-target onto
   *  new work; pinned entry IDs do not). Holds ENTRY ids (stable Pi
   *  SessionEntryBase.id UUIDs), NOT message indices (which shift on compaction).
   *  OPTIONAL for backward compatibility: absent (old markers, or when capture
   *  failed) → `filterPipeline` falls back to granularity-based relative
   *  re-resolution. See `@06-context-filter.md` §3/§4/§6/§11. */
  hideEntryIds?: string[];
  /** Monotonic per-session counter, so the filter can order markers reliably
   *  even if timestamps tie. Maintained in memory + snapshotted in the marker. */
  seq: number;
  /** The note payload, duplicated here for self-containment (the rendered note
   *  also lives in the mulligan:note CustomMessage; this is the structured form
   *  for audit/debugging and potential future tooling). */
  note: NoteInput;
  ledger: FileLedger;
  ts: number;                 // Date.now() at append
}
```

**Why store the note in the marker too?** The marker is control state (not in context); the note is a context message. Storing the structured note in the marker makes the marker self-describing for `/tree` inspection and future tooling, at no context cost. It is a duplicate-by-design.

The `mulligan:note` `CustomMessage` is appended **immediately after** the marker, via `pi.sendMessage`, with `display: true`. Its `details` (the `CustomMessage` details field) carries `{ schema:"pi-mulligan", v:1, kind:"note", rewindId: <marker.id> }` for correlation.

## 4. Marker: shrink

Stored via `pi.appendEntry("mulligan:shrink", data)`:

```ts
type ShrinkTarget =
  | { by_tool_call_id: string }
  | { by_tool_name: string; occurrence: "last" | "first" };
// v2.0: `by_content_includes` REMOVED. Both remaining arms resolve ONLY within the
// CURRENT turn's tool-result span (see Matching semantics below) — a shrink may never
// target a message from an earlier turn.

interface ShrinkMarker extends MulliganEnvelope {
  kind: "shrink";
  id: string;
  target: ShrinkTarget;
  /** The replacement content (text), stored RAW. The filter's `applyShrink`
   *  substitutes the matched message's content with the replacement WRAPPED in a
   *  render-time `<context-shrunk>` awareness stamp (`@06-context-filter.md`
   *  §5.1) and preserves isError/toolName/toolCallId so the API stays valid.
   *  This field itself is the raw model-authored summary — audit, cancel
   *  target resolution, and any future restore see it unwrapped; only the
   *  rendered content array the filter emits is stamped. */
  replacement: string;
  /** Optional reason, surfaced in audit. */
  reason?: string;
  /**
   * Pinned stable ENTRY id of the message the target matched at marker-creation time (FINDING 3 — pinned shrink).
   * When present, the filter resolves the target by IDENTITY instead of re-resolving the selector live each
   * inference, so `by_tool_name`+`last` no longer drift onto later, unrelated messages as
   * the session grows (the moving-target footgun). Mirrors `RewindMarker.hideEntryIds`. Absent when the target did
   * not match at creation (then the filter falls back to live resolution — backward compat / compaction-robust).
   * Holds an ENTRY id (stable), NOT a message index. OPTIONAL.
   */
  pinnedEntryId?: string;
  seq: number;
  ts: number;
}
```

**Matching semantics** (`@06-context-filter.md` §5): targets resolve against the *current* `event.messages` each inference (compaction-robust), **restricted to the current turn's tool-result span** (v2.0). If multiple markers match the same target, the **last** one wins (applied last in order). If a target matches nothing — including a selector that would only match in an EARLIER turn — the marker is a no-op for that inference (and silently retried next inference, in case the content reappears — e.g. before a compaction settles). The current-turn bound is enforced at BOTH creation (the tool refuses out-of-scope targets) and resolution (the filter drops out-of-scope matches) — scope holds under all circumstances.

**Pinned shrinks (FINDING 3).** When the tool resolves the target at marker-creation time it records the matched message's stable ENTRY id as `pinnedEntryId`. The filter then resolves that id by **identity** (not the live selector) on every later inference, locking the substitution to ONE message forever — `by_tool_name`+`last` can no longer silently rewrite a *later*, unrelated message that happens to match (the moving-target footgun). If the pinned entry is no longer present (compaction), the marker no-ops that inference rather than re-resolving the selector (identity-or-nothing, mirroring the rewind `hideEntryIds` precedent). `by_tool_call_id` is already stable, so pinning it is a harmless no-op. Markers without a `pinnedEntryId` (old markers, or a target that did not match at creation) fall back to the live selector as before.

## 5. Turn metric (for the nudge)

Appended at `turn_end` via `pi.appendEntry("mulligan:turn-metric", data)`. Only the **latest** one on the branch is consulted by the filter (older ones are ignored but persist).

```ts
interface TurnMetric extends MulliganEnvelope {
  kind: "turn-metric";
  seq: number;
  ts: number;
  deltaTokens: number;        // signed estimate of AGENT-ATTRIBUTABLE context growth this turn (user msgs EXCLUDED; v1.1/D10)
  bloatHit: boolean;          // any tool_result this turn exceeded bloatThreshold
  bloatHits: { toolName: string; approxTokens: number }[];
  grewOverThreshold: boolean; // deltaTokens > driftThresholdTokens
  /** The turn index this metric describes (from turn_end event.turnIndex). */
  turnIndex: number;
}
```

Because `turn_end` does not receive the message list, `deltaTokens` is computed from the **in-memory token baseline** (captured at `turn_start`/previous `turn_end`) compared to an estimate at `turn_end`. **v1.1 (D10): the estimate is AGENT-ATTRIBUTABLE only** — it sums `estimateTokens` over messages whose `role !== "user"`, so a user's prompt never inflates the delta. The drift nudge prescribes rewind/shrink, which can only legitimately target agent output; user input is ground-truth (`@07-preventive-and-nudges.md` §2, principle 8). This is inherently approximate; the nudge is advisory, so approximation is acceptable. The baseline is keyed per-session in a module-scoped map, reset on `session_start`. If the baseline is missing (e.g. first turn, or post-reload), `deltaTokens` is `null` and the nudge falls back to `bloatHit`-only signaling.

## 5½. Marker: cancel (marker retraction)

Stored via `pi.appendEntry("mulligan:cancel", data)`. This is the foundational data model for **G3 / marker retraction** (spec `@08-edge-cases.md` E21), which amends decision D6 ("agent rewinds are permanent"): a mistaken `mulligan:rewind` / `mulligan:shrink` is no longer irrevocable — it becomes retractable. The `data`:

```ts
interface CancelMarker extends MulliganEnvelope {
  kind: "cancel";
  /** The uuid `id` field of the rewind/shrink marker being cancelled
   *  (RewindMarker.id / ShrinkMarker.id) — NOT the Pi entry id. */
  targetId: string;
  seq: number;   // monotonic per-session counter (shared with rewind/shrink/turn-metric)
  ts: number;    // Date.now() at append
}
```

**No `id` field** (like `TurnMetric` in §5 — a cancel is not itself cancellable), so `appendCancelMarker` stamps NO uuid.

**`targetId` semantics.** `targetId` holds the **uuid `id` field** of the rewind/shrink marker being cancelled (`RewindMarker.id` / `ShrinkMarker.id`), NOT the Pi entry id. The cancel tool (P3.M1.T3.S1) is responsible for validating that `targetId` exists on the branch; the persistence wrapper does not.

**Retraction semantics** (applied downstream by `readMarkers`, P3.M1.T2.S1): the filter collects all `mulligan:cancel` entries, builds a `cancelledIds: Set<string>` from their `data.targetId` values, and drops any rewind/shrink whose `data.id` is in that set — **before** the filter sees them. This suppresses the cancelled marker going forward only. It does **not** undo on-disk side effects already caused by the rewind/shrink (D1/E5), nor does it replay any hidden content. See `@08-edge-cases.md` E21 for the full retraction contract.

## 6. Checkpoint

A checkpoint is **not** a `CustomEntry`; it is a Pi `LabelEntry` created by `pi.setLabel(leafId, "mulligan:checkpoint:<name>")`. Names MUST match `/^[a-z0-9_-]{1,40}$/`. The `mulligan:checkpoint:` prefix distinguishes Mulligan checkpoints from user/bookmark labels.

**v1.1: checkpoints are set ONLY by the human** via `/mulligan_checkpoint` (`@13` §2); the agent `mulligan_checkpoint` tool is removed (`@05` §3). The agent retains `mulligan_rewind(granularity:"checkpoint")` to rewind *to* a user-set checkpoint.

**No provenance control entry.** A checkpoint is just the label (`pi.setLabel`). Since only `/mulligan_checkpoint` creates checkpoints, every checkpoint is user-owned by construction — no sibling control entry is needed.

**Consent (v1.1):** a checkpoint rewind may hide `user` messages after the checkpoint because the user opted in by setting it; `first:user` stays unconditionally protected (`@06` §8).

```ts
// To set:    pi.setLabel(currentLeafId, `mulligan:checkpoint:${name}`);
// To read:   ctx.sessionManager.getLabel(id)  → string | undefined
// To list:   scan getEntries() for label entries whose label starts with the prefix
```

Checkpoints are **referenced by `mulligan_rewind`** as an alternative targeting mode (see `@05-tools.md`): `granularity: "checkpoint", checkpoint: "<name>"`. The filter resolves a checkpoint target by finding the labeled entry, then mapping it to a position in `event.messages` (see `@06-context-filter.md` §6 for the entry→message mapping algorithm). This is the one place Mulligan must do entry↔message mapping; the relative granularities avoid it.

## 7. Configuration (`mulligan` in settings.json)

Full defaults + rationale in `@09-configuration.md`. Schema summary here so data shapes are co-located:

```ts
interface MulliganConfig {
  enabled: boolean;                  // master switch; default true
  rewind: {
    enabled: boolean;                // default true
    protectedRoles: string[];        // never rewind past; default ["user" (first), "user" (latest)]
    maxDepth: number;                // max simultaneous active rewind markers; default 5
    requireMutationWarning: boolean; // warn (in tool result) if rewinding a span with write tools; default true
  };
  shrink: {
    enabled: boolean;                // default true
  };
  nudges: {
    bloatReminder: boolean;          // tool_result annotation; default true
    perTurnDrift: boolean;           // context nudge; default true
    bloatThresholdBytes: number;     // default 16384 (in-context bytes of a single result; 16 KB)
    bloatThresholdBytesByTool?: Record<string, number>; // per-tool overrides; default { read: 24576 }
    driftThresholdTokens: number;    // default 3000 (turn delta that triggers the nudge)
  };
  audit: {
    estimateConfidence: "low" | "medium" | "high"; // reported with estimates; default "medium"
  };
  log: {
    file: string | null;             // structured log path; default null (off). Set for debugging.
  };
}
```

## 8. In-memory (non-persisted) state

```ts
interface SessionRuntime {
  sessionId: string;
  seq: number;                       // monotonic marker counter; persisted INTO each marker
  tokenBaseline: number | null;      // for turn metric delta
  lastTurnIndex: number | null;
}
```

Held in a `Map<string, SessionRuntime>` keyed by `ctx.sessionManager.getSessionId()`. Reset/created on `session_start`. **Never** cache a `sessionManager` handle (C12) — only primitive values.

## 9. Logging shape (for `log.file`)

One JSON line per event, append-only:

```ts
interface LogLine {
  ts: string;                        // ISO
  level: "debug" | "info" | "warn" | "error";
  event: string;                     // e.g. "rewind.applied", "filter.fire", "nudge.inject"
  sessionId: string;
  data?: unknown;
}
```

The logger is the primary observability surface in non-TUI modes and is what the test suite asserts against (`@10-testing.md`).

## 10. Cross-references

- Tools that produce these shapes → `@05-tools.md`
- How the filter consumes them → `@06-context-filter.md`
- Defaults & where config is read from → `@09-configuration.md`