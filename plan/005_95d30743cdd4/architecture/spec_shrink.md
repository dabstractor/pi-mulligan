# Spec Extracts — Shrink Echo, Rewind display:true, Config Knob

Extracted VERBATIM from `spec/05-tools.md` and `spec/09-configuration.md` for Delta 005 (M2 + M2.T2).
All text is the authoritative spec source of truth; the code must match it.

---

## 1. spec/05 §2 — `mulligan_shrink` Return Shape (TERSE form)

### Return shape (verbatim from spec/05 §2)

```ts
{ content: [{ type:"text", text: "Mulligan: shrink recorded. Matched: yes/no." }] }
// The replacement is NOT echoed in the result. Echoing it would place a second
// copy in the model's context — defeating the tool's entire purpose. The operator
// sees the extracted summary via ctx.ui.notify (behavior step 5) at ZERO context
// cost; the model sees only this terse line, then the replacement applied to the
// target message on the next turn.
```

**Key delta vs current code:** the current `feedbackText(matched)` returns the verbose
`"Mulligan: shrink recorded. Matched message will show the replacement from the next turn on. (Matched now: yes|no)"`.
The spec wants the terse `"Mulligan: shrink recorded. Matched: yes|no."` — note the
trailing period and the absence of the verbose "from the next turn on" clause and the
"(Matched now: ...)" parenthetical.

---

## 2. spec/05 §2 — Behavior Step 5 (ctx.ui.notify echo)

### Verbatim step 5 text

> **5. Notify the operator at zero context cost (REQUIRED):** after persisting, surface the extracted summary to the *human* via `ctx.ui` — a pure UI side-channel that is **never** added to the model's context:
> ```ts
> if (ctx.hasUI) ctx.ui.notify(
>   `Shrunk <target desc> — replacement:\n<<<\n${cap(replacement, config.shrink.notifyMaxChars)}\n>>>`,
>   "info");
> ```
> Guard with `ctx.hasUI` (no-op in print/JSON mode — there is no user to show). The tool RESULT (returned to the model) stays terse — the model does not need its own summary echoed back. `config.shrink.notifyMaxChars` (default **2048**) caps the toast for *UI ergonomics only* (not context); over-cap, append `…(<N> chars total)`. **Why not echo in the result / `sendMessage`:** both enter the model's context. `ctx.ui.notify` is the only user-facing channel that costs zero tokens — the whole point of the tool is to reduce context, so the summary must reach the human without re-entering the model's view.

### Implementation details from the verbatim text

1. **Placement:** AFTER `appendShrinkMarker` (step 4 persist) and BEFORE the return.
2. **Guard:** `if (ctx.hasUI)` — no-op when `hasUI` is false (print/JSON modes).
3. **Call:** `ctx.ui.notify(message, "info")` — type is `"info"`.
4. **Message format:** `` `Shrunk <target desc> — replacement:\n<<<\n${cap(replacement, config.shrink.notifyMaxChars)}\n>>>` ``
   - `<target desc>` is a best-effort human description of the target (not spec-pinned beyond "target desc").
   - The replacement is wrapped in `<<<\n` and `\n>>>` delimiters.
   - `cap(replacement, config.shrink.notifyMaxChars)` truncates if over-cap.
5. **Over-cap behavior:** append `…(<N> chars total)` where `<N>` is the ORIGINAL full length.
6. **Config:** `config.shrink.notifyMaxChars`, default **2048**.
7. **E13 compliance:** the notify call must be wrapped in its own try/catch — a UI failure must never break the tool.

### Why not echo in result / sendMessage (verbatim rationale)

> both enter the model's context. `ctx.ui.notify` is the only user-facing channel that costs zero tokens — the whole point of the tool is to reduce context, so the summary must reach the human without re-entering the model's view.

---

## 3. spec/05 §1 — Step 6 `display:true` Rationale (rewind note)

### Verbatim step 6 text (the display:true note)

> **(`display:true` is deliberate — it surfaces the note to the operator as well, so the human can see exactly what the model told its resumed self. This is the rewind counterpart of shrink's replacement echo: every self-directed payload is operator-visible.)**

### Also from spec/05 §1 Purpose

> **The structured self-authored note is Mulligan's flagship UX** — it is what turns a hide into a *better-informed retry*: the resumed model reads `what_happened`/`avoid`/`true_current_state`/`next` and re-plans, rather than blindly repeating the discarded work.

### What this means for M2.T2 (comment alignment only)

The code at `src/markers.ts:~378` (`leaveNote`) already passes `display:true`:
```ts
pi.sendMessage({ customType: "mulligan:note", content, display: true, details });
```

**NO behavior change needed.** The task is purely to expand the JSDoc comment to cite the
spec/05 §1 step 6 rationale verbatim: "`display:true` is deliberate — it surfaces the note
to the operator (the human sees exactly what the model told its resumed self); this is the
rewind counterpart of shrink's replacement echo."

---

## 4. spec/09 §2/§3 — `shrink.notifyMaxChars` Config Knob

### Schema & defaults (spec/09 §2, verbatim from the JSON block)

```jsonc
"shrink": {
  "enabled": true,
  "maxActive": 32,
  "staleAfterFires": 3,
  "notifyMaxChars": 2048,        // cap on the replacement shown to the operator via ctx.ui.notify (ZERO context cost)
  // "autoOnBloat": false         // NOT in v1; reserved. Auto-shrink would risk data loss.
}
```

### Rationale (spec/09 §3 table, verbatim)

| Knob | Default | Why |
|---|---|---|
| `shrink.notifyMaxChars` | `2048` | Caps the replacement text shown to the operator via `ctx.ui.notify` when a shrink is recorded. Pure UI side-channel — **zero context cost** (the tool result itself stays terse). `@05-tools.md` §2. |

### Validation (spec/09 §4, applicable rule)

> Numbers: must be finite, `>= 0` (thresholds `> 0`); invalid → default.

`notifyMaxChars` is a threshold-style positive number → use `coerceNumber("shrink.notifyMaxChars", v, cfg.shrink.notifyMaxChars, true)` (mustBePositive=true → `> 0`), matching the `maxActive`/`staleAfterFires` precedent in the same validation block.

---

## Summary of verified facts (for downstream PRP agents)

| Fact | Source | Value |
|---|---|---|
| Shrink result text (terse) | spec/05 §2 Return shape | `"Mulligan: shrink recorded. Matched: yes/no."` |
| Replacement echoed in result? | spec/05 §2 Return shape | NO — explicitly forbidden |
| Notify channel | spec/05 §2 Behavior step 5 | `ctx.ui.notify(message, "info")` |
| Notify guard | spec/05 §2 Behavior step 5 | `if (ctx.hasUI)` |
| Notify message format | spec/05 §2 Behavior step 5 | `` `Shrunk <target desc> — replacement:\n<<<\n${cap(replacement, config.shrink.notifyMaxChars)}\n>>>` `` |
| Over-cap behavior | spec/05 §2 Behavior step 5 | append `…(<N> chars total)` |
| `notifyMaxChars` default | spec/09 §2/§3 | `2048` |
| `notifyMaxChars` validation | spec/09 §4 | finite, `> 0`, `coerceNumber` pattern |
| Rewind note `display:true` | spec/05 §1 step 6 | already in code; comment-only alignment |