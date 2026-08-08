# Research — Report format & rendering design for `mulligan_audit`

## The exact report to reproduce (spec/05 §4, verbatim)

```md
## Mulligan audit — context you are currently carrying
Total (filtered): ~12,340 tokens  (estimate, confidence: medium)
Active markers: 1 rewind (last_tool_call_group), 0 shrink, 2 checkpoints [before-x, before-y]
Protected: will not rewind past system/first-user/latest-user.

Top messages by size:
  9,412  toolResult  read src/big.log           ⚠ above bloat threshold (8 KB)
  1,840  assistant   (thinking + toolCall x2)
    612  toolResult  grep "auth"
    ...

Suggestion: the `read src/big.log` result is the largest contributor. Consider mulligan_shrink.
```

## Line-by-line construction rules

### Line 1 — header (literal)
`## Mulligan audit — context you are currently carrying` — byte-identical, always.

### Line 2 — total
`Total (filtered): ~<TOTAL> tokens  (estimate, confidence: <CONF>)`
- `<TOTAL>` = `estimateTokens(filtered).tokens` (the WHOLE filtered list, not just `top`).
- leading `~` signals approximate (spec/01 §7 "reports estimates as estimates").
- `<CONF>` = `'low'` on the E16 fallback path; otherwise `config.audit.estimateConfidence`
  (default `'medium'`). NEVER derived from `ctx.getContextUsage()` (D5 — bookkeeping drift; the
  whole point of this tool). Two spaces before `(estimate`.

### Line 3 — active markers
`Active markers: <r> rewind (<granCSV>), <s> shrink, <c> checkpoints [<nameCSV>]`
- `<r>` = `readMarkers(ctx).rewinds.length`; `<granCSV>` = comma-join of distinct `rewinds[*].granularity`.
- `<s>` = `readMarkers(ctx).shrinks.length`.
- `<c>` + `<nameCSV>` = checkpoints, scanned SEPARATELY (readMarkers does not return them — see
  below): filter `getEntries()` for `type === "label"` && `label?.startsWith("mulligan:checkpoint:")`,
  strip the prefix → names. `[before-x, before-y]` style (comma+space separated).
- Edge: 0 checkpoints → `0 checkpoints` (omit the bracket list, or render `[]` — pick `[]` for
  parseability; spec example only shows the non-empty case). 0 rewind → `0 rewind` (no granCSV).

### Line 4 — protected (literal-ish)
`Protected: will not rewind past system/first-user/latest-user.`
- Render from `config.rewind.protectedRoles` joined as prose when possible; fall back to the
  literal default string. Keep it short and human (it's advisory). The default protectedRoles are
  `["first:user","latest:user"]`; system is always implicitly protected.

### blank line, then `Top messages by size:` (literal)

### Per-message rows
`  <TOK>  <ROLE>  <LABEL>[<space><BLOATFLAG>]`
- `<TOK>` = `estimateTokens([msg]).tokens`, right-aligned to width 6 (matches spec's column).
- `<ROLE>` = the message role (`toolResult`/`assistant`/`user`/`custom`/…).
- `<LABEL>` = `describeMessage(msg, callLookup)` — best-effort one-liner (see next section).
- `<BLOATFLAG>` (only when bloaty) = `  ⚠ above bloat threshold (<KB> KB)` where `<KB>` =
  `Math.round(config.nudges.bloatThresholdBytes / 1024)` (e.g. 8192 → `8`). Two-space gutter
  before `⚠`.
- Sort rows DESC by token count; take `params.top ?? 8`.
- Indent each row with two leading spaces (matches spec).

### Suggestion line
`Suggestion: the \`<LABEL>\` result is the largest contributor. Consider mulligan_shrink.`
- `<LABEL>` = `describeMessage` of the single largest message (the `top[0]`). Always present
  (spec/05 §4 step6 "suggest shrink on largest"). If `filtered` is empty → omit the suggestion
  and the "Top messages" block, render a short "No messages in filtered view." note instead.

## `describeMessage(msg, callLookup)` — the label builder (best-effort)

Build `callLookup: Map<string, {name, args}>` once by scanning `filtered` assistant messages'
`toolCall` blocks (`{type:"toolCall", id, name, arguments}`). Then:

| `msg.role` | label |
|---|---|
| `"toolResult"` | `${toolName} ${briefArgs(callLookup.get(toolCallId))}` |
| `"assistant"` | block summary: count `thinking`/`text`/`toolCall` → `(thinking x2, toolCall x1)` etc. (spec shows `(thinking + toolCall x2)`) |
| `"user"` | `"user"` + optional 40-char content snippet (keep short) |
| `"custom"` | `customType` (e.g. `mulligan:note`) |
| anything else / unknown | the raw role string |

`briefArgs(call?)`: extract ONE representative argument to mirror the spec example
(`read src/big.log`, `grep "auth"`):
- prefer `path`/`file_path`/`filePath` → that value
- else `command` (bash) → that value
- else `query`/`pattern`/`search_query` → `"${value}"` (quoted, like the grep example)
- else if `call` missing → `(no matching call)` and fall back to a 30-char content snippet
- always truncate the value to ~40 chars + `…`.

All field reads go through `readOwn` (a Proxy trap that throws must not crash the audit).
`describeMessage` is PURE → export it so the unit test covers label construction directly
without assembling full messages each time.

## Byte measurement for the bloat flag — reuse `resultBytes`

`resultBytes(content: ResultContentBlock[])` (tokens.ts P1.M2.T1.S2, COMPLETE) already measures
UTF-8 bytes of a `(TextContent|ImageContent)[]`. Use it for array content; add the string-content
case locally. `messageBytes(msg)`:
- `content` is a string → `Buffer.byteLength(content, "utf8")`
- `content` is an array → `resultBytes(content)` (reuses the shipped, tested helper — no dup)
- absent/other → `0`
Flag when `messageBytes(msg) > config.nudges.bloatThresholdBytes`. This matches the nudge's own
threshold (spec/07 §1) so "bloaty in the nudge" == "bloaty in the audit" — consistent UX.

## `details` field (required by `AgentToolResult<T>`)

Return a small structured object (useful for logs/debug; the type REQUIRES `details`, never omit):
```ts
details: {
  totalTokens: number;
  confidence: "low" | "medium" | "high";
  source: "cached" | "fallback";     // primary path vs E16 buildContextEntries path
  nRewinds: number; nShrinks: number; nCheckpoints: number;
  top: { tokens: number; role: string; label: string; bloaty: boolean }[];
}
```

## No config gate (mirror checkpoint GOTCHA #4)

spec/09's `audit` section has only `estimateConfidence` — NO `enabled` switch. The audit is
read-only diagnostics; it always reports (even when `config.enabled === false` the filter still
fires + caches `lastFiltered`, so the audit's filtered view stays honest). Do NOT invent
`config.audit.enabled` or refuse on `config.enabled === false`.