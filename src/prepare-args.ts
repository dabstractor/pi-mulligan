/**
 * prepare-args.ts — the shared `prepareArguments` compatibility shim factory (string→object coercion).
 *
 * THE BUG (field report): some models send OBJECT-typed tool parameters as a JSON-ENCODED STRING — e.g.
 * `mulligan_shrink` called with `target: "{\"by_tool_call_id\": \"call_bash_pclntab\"}"`. The Pi host
 * validates tool args BEFORE execute() runs (pi-agent-core agent-loop → pi-ai `validateToolArguments`:
 * `Value.Convert` + compiled `Check`). `Value.Convert` coerces primitives only — it NEVER turns a JSON
 * string into an object (verified against typebox 1.3.7 host-side and 1.3.11 repo-side) — so every `anyOf`
 * arm fails ("must be object" ×3) and the tool call is dead on arrival: execute() never runs, so NO tool-body
 * code can catch this. The host's own edit tool hits the identical failure class ("Some models (Opus 4.6,
 * GLM-5.1) send edits as a JSON string instead of an array") and fixes it via the sanctioned
 * `ToolDefinition.prepareArguments` hook — "Optional compatibility shim to prepare raw tool call arguments
 * before schema validation" (pi-coding-agent core/extensions/types.d.ts; pi-coding-agent core/tools/edit.js
 * precedent). This module is the Mulligan counterpart.
 *
 * DESIGN:
 * - `prepareObjectArgs<T>(keys)` returns a `(args: unknown) => T` that JSON-parses each listed key's value
 *   when it is a STRING, replacing it with the parsed value ONLY if that value is a non-null, non-array
 *   object (the only shape that can satisfy an object-typed schema). Everything else is passed through
 *   untouched so the host's normal schema validation still reports it honestly (clear "must be object"
 *   errors, NOT a silent swallow).
 * - Pure + defensive (never throws — E13 spirit): non-record args pass through as-is; malformed JSON is left
 *   as the original string; parsing mutates a host-owned copy (the host `structuredClone`s args before
 *   validation, and the edit.js precedent mutates the raw input too — identity is preserved so
 *   agent-loop's `preparedArguments === toolCall.arguments` short-circuit still holds).
 * - NO Pi imports (0 imports — Pi-free like transforms.ts) so it cannot create a circular dependency and is
 *   trivially unit-testable (test/prepare-args.test.ts).
 *
 * CONSUMERS: src/tools/shrink.ts (`target`), src/tools/cancel.ts (`target` — structurally identical union;
 * the comment there makes parity a HARD requirement), src/tools/rewind.ts (`note`). checkpoint/audit take
 * scalar params only → immune → NO shim.
 */

/**
 * prepareObjectArgs — build a `ToolDefinition.prepareArguments` shim that coerces JSON-string-encoded
 * OBJECT properties back into real objects before the host's schema validation runs.
 *
 * @param keys the property names whose object-typed schema a model might send as a JSON string
 * @returns a `(args: unknown) => T` shim safe to assign to `prepareArguments` (never throws)
 */
export function prepareObjectArgs<T>(keys: readonly (keyof T & string)[]): (args: unknown) => T {
  return (args: unknown): T => {
    if (typeof args !== "object" || args === null || Array.isArray(args)) return args as T;
    const out = args as Record<string, unknown>;
    for (const key of keys) {
      const value = out[key];
      if (typeof value !== "string") continue; // already an object (or scalar) → leave alone
      try {
        const parsed: unknown = JSON.parse(value);
        // Replace ONLY with a non-null non-array OBJECT — the only shape an object-typed schema accepts.
        // Anything else (array/scalar/null) is left as the original string → honest schema error later.
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          out[key] = parsed;
        }
      } catch {
        // Malformed JSON → leave the string as-is; the host's schema validation reports it clearly.
      }
    }
    return out as T;
  };
}
