# Config Validation Design — `bloatThresholdBytesByTool` Coercion

## Pattern to Follow

The existing `coerceProtectedRoles` function (config.ts ~line 274) is the closest analog — it
implements **per-entry drop-with-warn** semantics over a collection:

```typescript
function coerceProtectedRoles(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    warnConfig("rewind.protectedRoles", value);
    return fallback;
  }
  const known: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && KNOWN_PROTECTED_ROLES.has(entry)) {
      known.push(entry);
    } else {
      warnConfig("rewind.protectedRoles entry", entry);
    }
  }
  return known;
}
```

The new `bloatThresholdBytesByTool` coercion follows the same pattern but over an object map
instead of an array.

## Available Helpers in config.ts

- `isRecord(value: unknown): value is Record<string, unknown>` — checks `typeof === "object" && !null && !Array.isArray`
- `safeGet(obj, key)` — try/catch property access
- `coerceNumber(field, value, fallback, mustBePositive)` — validates a single number, warns + falls back on invalid
- `warnConfig(field, value)` — `console.warn` with field name + safeStringify
- `safeStringify(value)` — JSON.stringify with circular ref guard
- `Number.isFinite(n)` — standard JS (used to check finite numbers)

## Validation Rules (spec/09 §4)

### Field placement in validateConfig

Inside the existing `if (isRecord(nudgesRaw))` block (after `driftThresholdTokens` handling):

```typescript
v = safeGet(nudgesRaw, "bloatThresholdBytesByTool");
if (v !== undefined) cfg.nudges.bloatThresholdBytesByTool = coerceBloatThresholdByTool(v, cfg.nudges.bloatThresholdBytesByTool);
```

### New coerce function (following coerceProtectedRoles pattern)

```typescript
function coerceBloatThresholdByTool(
  value: unknown,
  fallback: Record<string, number>,
): Record<string, number> {
  if (!isRecord(value)) {
    // null, primitive, array → discard entirely, use default map
    warnConfig("nudges.bloatThresholdBytesByTool", value);
    return fallback;
  }
  const result: Record<string, number> = {};
  for (const [toolName, threshold] of Object.entries(value)) {
    if (typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0) {
      result[toolName] = threshold;
    } else {
      warnConfig("nudges.bloatThresholdBytesByTool entry", { [toolName]: threshold });
    }
  }
  return result;
}
```

### Edge cases to handle:
1. **Absent/undefined** → keep default map `{ bash: 32768, read: 20480 }`, no warn (the `if (v !== undefined)` guard handles this).
2. **Present but not a record** (null, string, number, array) → discard entirely, return fallback (default map), warn once.
3. **Present as record with invalid values** (e.g., `{ bash: -1, read: "big" }`) → drop invalid entries with per-value warn, keep valid ones.
4. **Present as record with unknown tool names** (e.g., `{ custom_tool: 5000 }`) → keep them (forward-compat per spec/09 §4).
5. **Never throws** — the existing `validateConfig` try/catch wrapper already covers this.

## Merge Semantics Note

When a user provides a partial map (e.g., `{ bash: 99999 }`), the result should NOT blindly replace
the default map — it should MERGE. However, looking at the validation design more carefully:

The `validateConfig` starts from `structuredClone(DEFAULT_CONFIG)` as the base. When
`bloatThresholdBytesByTool` is present as a valid record, the coerce function processes ONLY the
user-provided entries. This means a partial override `{ bash: 99999 }` would result in a map
containing ONLY `{ bash: 99999 }` — NOT merged with defaults.

**BUT** — the PRD §2.1 says "confirm the map is **not** blindly replaced when partially provided
(merge semantics per spec/09 §4: valid entries kept, invalid dropped, defaults preserved for
unmentioned tools)."

This means the coerce function needs to START from the default map and merge user entries:

```typescript
function coerceBloatThresholdByTool(
  value: unknown,
  fallback: Record<string, number>,  // ← this IS the default map from structuredClone(DEFAULT_CONFIG)
): Record<string, number> {
  if (!isRecord(value)) {
    warnConfig("nudges.bloatThresholdBytesByTool", value);
    return fallback;  // ← returns full default map
  }
  // Start from defaults, then apply valid user overrides
  const result = { ...fallback };
  for (const [toolName, threshold] of Object.entries(value)) {
    if (typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0) {
      result[toolName] = threshold;
    } else {
      warnConfig("nudges.bloatThresholdBytesByTool entry", { [toolName]: threshold });
    }
  }
  return result;
}
```

This ensures: `{ bash: 99999 }` → `{ bash: 99999, read: 20480 }` (read preserved from default).

**CRITICAL**: The `fallback` parameter passed from `validateConfig` is `cfg.nudges.bloatThresholdBytesByTool`,
which at that point is the DEFAULT_CONFIG's map (from `structuredClone(DEFAULT_CONFIG)`). So
spreading `fallback` gives us the merge behavior automatically.