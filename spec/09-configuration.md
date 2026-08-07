# 09 — Configuration

> Mulligan reads a `mulligan` object from Pi's `settings.json` (global `~/.pi/agent/settings.json` and/or project-local `<project>/.pi/settings.json`, with project-local overriding global). It works with **zero configuration** — every option has a safe default. This document specifies the schema, defaults, where each is read, and the rationale per knob.

---

## 1. Where config is read

- **Source:** the merged Pi settings object. Mulligan reads `settings.mulligan` (project-local wins over global via Pi's normal merge).
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
      "requireMutationWarning": true  // append side-effect warning when rewinding mutating spans
    },

    "shrink": {
      "enabled": true
      // "autoOnBloat": false         // NOT in v1; reserved. Auto-shrink would risk data loss.
    },

    "nudges": {
      "bloatReminder": true,          // tool_result annotation when a result exceeds threshold
      "perTurnDrift": true,           // context-annotation when a turn grew past threshold
      "bloatThresholdBytes": 8192,    // 8 KB in-context → reminder (below Pi's 50 KB built-in cap)
      "driftThresholdTokens": 3000    // turn token delta → drift nudge
    },

    "audit": {
      "estimateConfidence": "medium"  // "low"|"medium"|"high" — reported with token estimates
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
| `rewind.requireMutationWarning` | `true` | Side-effect safety: the agent must be told hidden writes persist. Cheap, high value. |
| `shrink.enabled` | `true` | Core feature. |
| `nudges.bloatReminder` | `true` | Advisory; cheap; co-located with the problem. High value. |
| `nudges.perTurnDrift` | `true` | The signature "free ride" mechanism; cheap. High value. |
| `nudges.bloatThresholdBytes` | `8192` | Below Pi's 50 KB cap to catch meaningful-but-not-catastrophic results (a 30 KB `read`, etc.). Tunable per project (log-analysis projects may raise). |
| `nudges.driftThresholdTokens` | `3000` | A turn that adds ~3k+ tokens is worth a glance. Tunable. |
| `audit.estimateConfidence` | `"medium"` | Honest default; token estimates are approximate. |
| `log.file` | `null` | Off by default (no disk chatter). Enable for debugging/testing. |

## 4. Validation rules (in `config.ts`)

- Booleans: coerce with `!!`; invalid → default.
- Numbers: must be finite, `>= 0` (thresholds `> 0`); invalid → default.
- `protectedRoles`: must be an array of known selector strings (`"first:user"`, `"latest:user"`); unknown entries ignored (with warn). v1 does not support arbitrary role rules.
- `estimateConfidence`: must be one of `"low"|"medium"|"high"`; else default.
- `log.file`: if set, must be a string; opening is deferred to first write (and wrapped — a bad path must not crash the extension).
- On any per-field validation failure: log a warn naming the field and the value, use the default, continue. **Never throw.**

## 5. Environment overrides (optional, v1.1 — not required for v1)

Reserved for future: `MULLIGAN_DISABLED=1` (force-disable), `MULLIGAN_LOG=/path` (force log). Not required for v1; documented as future.

## 6. Cross-references
- Where knobs are enforced → `@05-tools.md` (enabled flags), `@06-context-filter.md` (protect, maxDepth), `@07-preventive-and-nudges.md` (thresholds).