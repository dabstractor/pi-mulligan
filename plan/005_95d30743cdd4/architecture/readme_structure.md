# README Structure — Delta 005 M5 Target Reference

**Source:** `README.md` (262 LOC) at HEAD `0bcaa814`. All line references verified by direct reading.

## 1. Config defaults table (§3, lines ~73–119)

Structure: markdown table with 3 columns (`Knob`, `Default`, `What it does`). Section header rows in bold (`**master**`, `**rewind**`, `**shrink**`, `**nudges**`, `**audit**`, `**log**`).

### Shrink rows (3 current):
```
| `shrink.enabled` | `true` | Enable the `mulligan_shrink` tool. |
| `shrink.maxActive` | `32` | Cap on simultaneous *active* ... markers; oldest retired when exceeded. |
| `shrink.staleAfterFires` | `3` | Auto-retire a pinned shrink whose target has been absent for this many consecutive filter fires ... |
```

**M5 addition needed:** After `shrink.staleAfterFires`, add:
```
| `shrink.notifyMaxChars` | `2048` | Caps the replacement shown to the operator via `ctx.ui.notify`; zero context cost. |
```

This brings the shrink block from 3 to 4 rows.

### nudges.bloatThresholdBytesByTool row (already correct):
```
| `nudges.bloatThresholdBytesByTool` | `{ "read": 24576 }` | ... `bash` is intentionally NOT listed ... |
```
**Confirmed already matches code** (`config.ts:146`). No change needed.

### Knob count claim:
The table intro says "All 19 knobs". Adding `shrink.notifyMaxChars` makes it **20 knobs**. **M5 MUST update this count to 20.**

## 2. JSON example (§3, lines ~105–118)

Current `shrink` line (commented):
```jsonc
//   "shrink": { "maxActive": 32, "staleAfterFires": 3 },
```

**M5 addition needed:** Add `"notifyMaxChars": 2048`:
```jsonc
//   "shrink": { "maxActive": 32, "staleAfterFires": 3, "notifyMaxChars": 2048 },
```

## 3. Tool section text (§4, lines ~126–189)

### `mulligan_cancel` (line ~182)

**Current description text (verbatim blockquote):**
> Retract (cancel) a mulligan_rewind or mulligan_shrink marker so it no longer applies going forward. Use when you issued a rewind or shrink against the wrong target and need to undo it — without it, the mistaken transform would apply on every turn for the rest of the session. Pass the markerId you received in details when you issued the marker. The transform stops applying from the next turn on (cancelled markers stay on disk for the audit trail). Cancelling a non-existent or already-cancelled marker is a safe no-op.

**Current "When to use it" text** says: "Pass the `markerId` you received in `details` when you issued the marker; the transform stops applying from the next turn on."

**M5 update:** The description text will be updated by M1 (it's the `CANCEL_DESC` string — Mode A doc). The README blockquote should be synced to match. The "When to use it" text should mention the new `target` hint: "Pass a `target` hint (same shape as `mulligan_shrink`) to identify the marker by content/role, or an explicit `markerId` as fallback — the most-recent marker affecting that content is retired."

### `mulligan_shrink` (line ~152)

**Current description text** mentions target matchers and `replacement` but NOT the operator echo.

**M5 addition:** Add a sentence about the operator echo: "When the shrink succeeds, the replacement is shown to the operator via a UI toast (the tool result itself stays terse — the replacement adds zero context cost)."

### `mulligan_checkpoint` (line ~166)

**Current text** does NOT mention auto-expiry/consumption.

**M5 addition:** Add a sentence: "A checkpoint is consumed when rewound to — it no longer appears as active in `mulligan_audit` after use. Re-create it with the same name if you need it again."

## 4. How It Works section (§5, lines ~192–225)

### Data flow diagram (lines ~196–217)
ASCII diagram showing rewind → marker → context handler → model. **No change needed** (M5 is about config + blurbs, not the data flow).

### Ride-along nudges (lines ~219–223)

**⚠️ STALE TEXT in nudge #1 (line ~220):**
> Bloated-result reminder — a `tool_result` hook appends a short reminder to any result exceeding the per-tool bloat threshold (`bash`: 32 KB, `read`: 20 KB, others: the 16 KB global default).

This says `bash: 32 KB, read: 20 KB` but the ACTUAL defaults are:
- `read`: 24576 bytes (24 KB)
- `bash`: NOT in the per-tool map → uses the 16 KB global default

**This is already wrong at HEAD** (the `bloatThresholdBytesByTool` default changed from `{bash:32768, read:20480}` to `{read:24576}`). **M5 should fix this** to: "`read`: 24 KB, others (including `bash`): the 16 KB global default."

### Nudge #2 (per-turn drift, line ~221)
The example `[mulligan: last turn +4.2k tokens; rewind available]` is illustrative. The M4 text change simplifies the actual text (drops `[mulligan]` prefix, no bloat clause). **M5 may update this example** to reflect the new format, but it's illustrative not normative.

### Nudge #3 (high-water, line ~223)
No change needed (not part of this delta).

### Retraction paragraph (line ~217)
Already mentions `mulligan_cancel` — **M5 should align** with the new target-based API wording if the §4 text changes.

## 5. Known Limitations (§7, lines ~229–244)

The D6 limitation text (line ~237) mentions `mulligan_cancel` as softening D6. **No change needed** — the behavior is the same (forward-only retraction); only the targeting method changed (markerId → target hint).

## M5 task summary

| Subtask | Location | Action |
|---|---|---|
| Config table `shrink.notifyMaxChars` | Table §3, after `shrink.staleAfterFires` row | ADD new row |
| Config table knob count "19" → "20" | Table §3 intro line | UPDATE |
| JSON example shrink keys | JSON example §3 | ADD `"notifyMaxChars": 2048` |
| `mulligan_cancel` blurb | §4 cancel section | UPDATE to mention `target` hint |
| `mulligan_shrink` blurb | §4 shrink section | ADD operator-echo sentence |
| `mulligan_checkpoint` blurb | §4 checkpoint section | ADD auto-expiry sentence |
| Bloat reminder stale thresholds | §5 nudge #1 | FIX `bash: 32 KB, read: 20 KB` → `read: 24 KB, others: 16 KB` |
| Drift nudge example text | §5 nudge #2 | OPTIONAL: align example to new text format |