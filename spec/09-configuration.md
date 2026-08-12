# 09 — Configuration

> Mulligan reads a `mulligan` object from Pi's `settings.json` (global `~/.pi/agent/settings.json` and/or project-local `<project>/.pi/settings.json`, with project-local overriding global). It works with **zero configuration** — every option has a safe default. This document specifies the schema, defaults, where each is read, and the rationale per knob.

---

## 1. Where config is read

- **Source:** the merged Pi settings object. Mulligan reads `settings.mulligan` (project-local wins over global via Pi's normal merge).
  - _Implementation note:_ Pi's extension API (v0.84.x) does not expose a settings accessor to extensions. Mulligan therefore reads the `settings.json` files directly from disk — the global file via `getAgentDir()` and the project-local file from the session `cwd` (`.pi/settings.json`) — deep-merges them internally (matching Pi's own `deepMergeObjects` semantics), and extracts `settings.mulligan`. The user-visible merge behavior is identical to Pi's normal merge.
- **When:** loaded lazily on first use and cached for the session; re-read on `/reload`. `getConfig()` returns the validated, defaulted config.
- **Validation:** unknown keys are ignored (forward-compat). Type-mismatched values fall back to the default with a warn log. This must never throw.

## 2. Schema & defaults

```jsonc
{
  "mulligan": {
    "enabled": true,                  // master switch (false → entire extension is a no-op)

    "rewind": {
      "enabled": true,
      "protectedRoles": ["first:user", "latest:user"],  // selectors never rewound past
      "maxDepth": 5,                  // max simultaneous active mulligan:rewind markers
      "maxRetriesPerPrompt": 5,       // max consecutive rewinds re-landing at the same user prompt before refusal (E22)
      "abortContextFraction": 0.9,    // refuse any rewind once filtered context reaches this fraction of the window (E22 zero-marker guard)
      "requireMutationWarning": true  // append side-effect warning when rewinding mutating spans
    },

    "shrink": {
      "enabled": true,
      "maxActive": 32,              // cap on simultaneous active mulligan:shrink markers; oldest retired when exceeded
      "staleAfterFires": 3,         // auto-retire a pinned shrink whose target has been absent this many consecutive fires
      "notifyMaxChars": 2048,        // cap on the replacement shown to the operator via ctx.ui.notify (ZERO context cost)
      // "autoOnBloat": false         // NOT in v1; reserved. Auto-shrink would risk data loss.
    },

    "nudges": {
      "bloatReminder": true,          // tool_result annotation when a result exceeds threshold
      "perTurnDrift": true,           // context-annotation when a turn grew past threshold
      "bloatThresholdBytes": 16384,   // 16 KB in-context → reminder (global catch-all; below Pi's 50 KB built-in cap)
      "bloatThresholdBytesByTool": {  // OPTIONAL per-tool overrides (keyed by toolName); fall back to bloatThresholdBytes
        "read": 24576                 // 24 KB — large source-file reads are routine and legitimate
      },                              // (bash is intentionally omitted: it uses the 16 KB global to stay sensitive)
      "driftThresholdTokens": 6000,   // windowed turn-token delta → drift nudge (see @07 §5.1)
      "driftWindowTurns": 3,          // rolling window for §5.1 windowed drift signaling
      "highWaterFraction": 0.7        // §5.2 edge-triggered high-water signal (fraction of context window)
    },

    "audit": {
      "estimateConfidence": "medium"  // "low"|"medium"|"high" — reported with token estimates
    },

    "ui": {
      "activeCheckpointBanner": true  // v1.1: persistent above-prompt-box banner while a user-set checkpoint is active (`@13` §5)
    },

    "log": {
      "file": null                    // null = off. Absolute path to append-only JSONL log for debugging.
    }
  }
}
```

## 3. Rationale per knob

| Knob | Default | Why |
|---|---|---|
| `enabled` | `true` | Feature should work out of the box; the human can disable without uninstalling. |
| `rewind.enabled` | `true` | Core feature. |
| `rewind.protectedRoles` | `["first:user","latest:user"]` | Prevent catastrophic amnesia of the original task or the current ask. v1 supports these two selectors. |
| `rewind.maxDepth` | `5` | Generous enough for legitimate retry cascades; tight enough to surface a stuck agent (the refusal text tells the agent/human something is wrong). Markers are permanent, so the cap bounds accumulation. |
| `rewind.maxRetriesPerPrompt` | `5` | Caps *consecutive* rewinds that re-land at the same latest user prompt — the runaway-loop bound (`@08-edge-cases.md` E22). Distinct from `maxDepth` (cumulative markers): the loop can persist while re-bloating between rewinds, so depth alone can't stop it. 5 matches `maxDepth`'s precedent and is enough for a legitimately flaky turn while still arresting a true loop. |
| `rewind.abortContextFraction` | `0.9` | Wall-clock backstop: refuse any rewind once the filtered-context estimate reaches this fraction of the model's window (`@08` E22). Catches the **zero-marker loop vector** (pure intra-turn re-reading driven by a re-firing bloat nudge) that the marker-counting budget cannot see. 0.9 leaves headroom below the provider's "Prompt too long" rejection. |
| `rewind.requireMutationWarning` | `true` | Side-effect safety: the agent must be told hidden writes persist. Cheap, high value. |
| `shrink.enabled` | `true` | Core feature. |
| `shrink.maxActive` | `32` | Bounds long-session filter cost and marker accumulation; the oldest shrink is retired when exceeded. Mirrors `rewind.maxDepth`. |
| `shrink.staleAfterFires` | `3` | Auto-retire a pinned shrink whose target has been absent this many consecutive fires (`@08-edge-cases.md` E15/E21). Stops dead markers from being walked every fire. |
| `shrink.notifyMaxChars` | `2048` | Caps the replacement text shown to the operator via `ctx.ui.notify` when a shrink is recorded. Pure UI side-channel — **zero context cost** (the tool result itself stays terse). `@05-tools.md` §2. |
| `nudges.bloatReminder` | `true` | Advisory; cheap; co-located with the problem. High value. |
| `nudges.perTurnDrift` | `true` | The signature "free ride" mechanism; cheap. High value. |
| `nudges.bloatThresholdBytes` | `16384` (16 KB) | Global catch-all for tools without a per-tool override. Raised from 8 KB after observation: the 8 KB default nagged on every routine source-file read (9–17 KB) — i.e. it fired on results the agent still needed. 16 KB lets a typical source file through while still catching genuinely catastrophic results (the 50 KB un-redirected `grep`, etc.). |
| `nudges.bloatThresholdBytesByTool` | `{ "read": 24576 }` | `bash` is the primary bloat surface, so it is intentionally NOT listed — it falls back to the 16 KB global to stay maximally sensitive. `read` of a large source file is normal, so it gets a higher 24 KB bar. Resolution: look up `event.toolName` in the map; on miss (including `bash`), use `bloatThresholdBytes`. |
| `nudges.driftThresholdTokens` | `6000` | Windowed (`@07-preventive-and-nudges.md` §5.1) per-turn token delta that triggers the drift nudge. Raised from 3000 after live use showed 3k false-positived on routine multi-file reads; the §5.1 windowing is what makes 6k a quiet, accurate trip point. |
| `nudges.driftWindowTurns` | `3` | Rolling window over which the drift delta is smoothed before thresholding (`@07` §5.1). Turns a noisy single-turn signal into a sustained-growth signal. |
| `nudges.highWaterFraction` | `0.7` | Fraction of the context window at which the §5.2 high-water annotation fires (edge-triggered). Catches slow steady accumulation the delta nudge misses. |
| `audit.estimateConfidence` | `"medium"` | Honest default; token estimates are approximate. |
| `log.file` | `null` | Off by default (no disk chatter). Enable for debugging/testing. |
| `ui.activeCheckpointBanner` | `true` | v1.1: shows the persistent above-prompt-box banner (`ctx.ui.setWidget(placement:"aboveEditor")`) while ≥1 user-set checkpoint is active, so the user does not forget they have armed destructive cross-prompt rewind power (`@08` E26, `@13` §5). Disablable without disabling checkpoints. |

## 4. Validation rules (in `config.ts`)

- Booleans: coerce with `!!`; invalid → default.
- Numbers: must be finite, `>= 0` (thresholds `> 0`); invalid → default.
- `protectedRoles`: must be an array of known selector strings (`"first:user"`, `"latest:user"`); unknown entries ignored (with warn). v1 does not support arbitrary role rules.
- `bloatThresholdBytesByTool`: if present, must be an object mapping tool-name strings to finite numbers `> 0`. Non-object → discard entirely (use global only). Any non-numeric or `<= 0` value in the map is dropped with a warn (the rest of the map is kept). Unknown tool names are permitted (forward-compat — the map is only consulted when a matching `event.toolName` arrives).
- `estimateConfidence`: must be one of `"low"|"medium"|"high"`; else default.
- `log.file`: if set, must be a string; opening is deferred to first write (and wrapped — a bad path must not crash the extension).
- `ui.activeCheckpointBanner`: boolean (coerce with `!!`); invalid → default `true`.
- `rewind.maxRetriesPerPrompt`: integer ≥ 1; non-integer or `<1` → default.
- `rewind.abortContextFraction`: number in (0,1]; out of range or non-number → default.
- On any per-field validation failure: log a warn naming the field and the value, use the default, continue. **Never throw.**

## 5. Environment overrides (optional, v1.1 — not required for v1)

Reserved for future: `MULLIGAN_DISABLED=1` (force-disable), `MULLIGAN_LOG=/path` (force log). Not required for v1; documented as future.

## 6. Cross-references
- Where knobs are enforced → `@05-tools.md` (enabled flags, maxRetriesPerPrompt, abortContextFraction), `@06-context-filter.md` (protect, maxDepth), `@07-preventive-and-nudges.md` (thresholds).