/**
 * checkpoint-name.ts — the shared checkpoint-name format guard (spec/05 §3 step 1; spec/04 §6; spec/08 E10).
 *
 * Extracted from src/tools/checkpoint.ts (v1.1 refactor cleanup) so the name-format rule has a single
 * canonical home that is NOT coupled to a tool factory. It is consumed by the REGISTERED user-facing
 * surface — the `/mulligan_checkpoint` HUMAN COMMAND (makeCheckpointCommand in src/commands.ts; spec/13).
 *
 * The rule: lowercase letters, digits, hyphen, underscore; 1–40 chars (`/^[a-z0-9_-]{1,40}$/`). The
 * caller (the command handler) OWNS this validation before delegating to `setCheckpoint` (markers.ts) —
 * the wrapper trusts the name and only prefixes it with `mulligan:checkpoint:`.
 */
// NAME_RE — the checkpoint-name format regex (spec/05 §3 step 1; spec/04 §6).
const NAME_RE = /^[a-z0-9_-]{1,40}$/;

/**
 * validCheckpointName — the name-format guard. Defensive `typeof` check so a non-string (impossible
 * after argument parsing in production, but possible in a hand-rolled test) refuses cleanly rather
 * than throwing on `.test()`.
 */
export function validCheckpointName(name: string): boolean {
  return typeof name === "string" && NAME_RE.test(name);
}