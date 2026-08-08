import { describe, it, expect, expectTypeOf } from "vitest";
import {
  validateNote,
  renderNote,
  NOTE_INVALID_REASON,
  type NoteInput,
  type NoteValidation,
} from "../src/notes.js";
import type { FileLedger } from "../src/ledger.js";
import type { Granularity } from "../src/config.js";

// No beforeEach needed: notes.ts has NO module-scoped mutable state (pure functions + constants only).

/** A fully-valid note (all four fields non-empty) — a realistic spec/04 §2.1 example. */
const VALID_NOTE: NoteInput = {
  what_happened: "Ran `grep -r auth .` and dumped ~40k tokens of output I didn't need.",
  avoid: "Do not run grep without --quiet, -c, or piping to head; prefer the built-in grep tool which truncates.",
  true_current_state: "No files were modified on the abandoned span.",
  next: "Re-run the search as `grep -rl auth src/` and read only the 3 relevant files.",
};

describe("validateNote — spec/05 §1 step 2 + spec/08 E9 + spec/10 §1.8 contract (pinned)", () => {
  it("all four fields present + non-empty → { valid: true } (no reason)", () => {
    const r = validateNote(VALID_NOTE);
    expect(r.valid).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("returns a NoteValidation { valid: boolean; reason?: string }", () => {
    const ok = validateNote(VALID_NOTE);
    expect(ok).toEqual({ valid: true });
    const bad = validateNote({ ...VALID_NOTE, what_happened: "" });
    expect(bad.valid).toBe(false);
    expect(typeof bad.reason).toBe("string");
  });
});

describe("validateNote — every field is independently required (any empty/whitespace → invalid)", () => {
  const FIELDS = ["what_happened", "avoid", "true_current_state", "next"] as const;

  for (const field of FIELDS) {
    it(`empty ${field} → invalid with the pinned reason (E9)`, () => {
      const r = validateNote({ ...VALID_NOTE, [field]: "" });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("note fields must all be non-empty");
    });

    it(`whitespace-only ${field} → invalid (trim check — GOTCHA #6)`, () => {
      const r = validateNote({ ...VALID_NOTE, [field]: "   \n\t  " });
      expect(r.valid).toBe(false);
      expect(r.reason).toBe("note fields must all be non-empty");
    });
  }
});

describe("validateNote — non-string / missing fields → invalid (typeof check — GOTCHA #4)", () => {
  it("a field set to a number → invalid", () => {
    const r = validateNote({ ...VALID_NOTE, next: 42 as unknown as string });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("note fields must all be non-empty");
  });

  it("a field set to null → invalid", () => {
    const r = validateNote({ ...VALID_NOTE, avoid: null as unknown as string });
    expect(r.valid).toBe(false);
  });

  it("a field set to undefined (missing at runtime) → invalid", () => {
    const r = validateNote({ ...VALID_NOTE, what_happened: undefined as unknown as string });
    expect(r.valid).toBe(false);
  });
});

describe("validateNote — the reason is the SINGLE spec-pinned string (GOTCHA #5)", () => {
  it("NOTE_INVALID_REASON is exported and equals the pinned literal (spec/05 step2, E9)", () => {
    expect(NOTE_INVALID_REASON).toBe("note fields must all be non-empty");
    // no trailing period — the rewind tool adds "Mulligan: refused — <reason>."
    expect(NOTE_INVALID_REASON.endsWith(".")).toBe(false);
  });

  it("every failure returns the SAME reason (no per-field variation)", () => {
    const a = validateNote({ ...VALID_NOTE, what_happened: "" });
    const b = validateNote({ ...VALID_NOTE, next: "  " });
    const c = validateNote({ ...VALID_NOTE, avoid: null as unknown as string });
    expect(a.reason).toBe(NOTE_INVALID_REASON);
    expect(b.reason).toBe(NOTE_INVALID_REASON);
    expect(c.reason).toBe(NOTE_INVALID_REASON);
  });
});

describe("validateNote — trim does not over-reject genuinely-valid content", () => {
  it("fields with leading/trailing whitespace but real content → valid", () => {
    const r = validateNote({
      what_happened: "  went down a rabbit hole  ",
      avoid: " don't grep without filters ",
      true_current_state: " scratch.ts was created ",
      next: " delete scratch.ts and restart ",
    });
    expect(r.valid).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("single-character fields are valid (non-empty after trim)", () => {
    const r = validateNote({ what_happened: "x", avoid: "y", true_current_state: "z", next: "w" });
    expect(r.valid).toBe(true);
  });
});

describe("validateNote — defensive (NEVER throws — GOTCHA #3)", () => {
  it("a null note passed as NoteInput → invalid, not a throw", () => {
    expect(() => validateNote(null as unknown as NoteInput)).not.toThrow();
    expect(validateNote(null as unknown as NoteInput).valid).toBe(false);
  });

  it("an array passed as NoteInput → invalid, not a throw", () => {
    const arr = ["x", "y", "z", "w"] as unknown as NoteInput;
    expect(() => validateNote(arr)).not.toThrow();
    expect(validateNote(arr).valid).toBe(false);
  });

  it("a primitive passed as NoteInput → invalid, not a throw", () => {
    expect(() => validateNote("not a note" as unknown as NoteInput)).not.toThrow();
    expect(validateNote("not a note" as unknown as NoteInput).valid).toBe(false);
  });

  it("does not throw on a throwing-Proxy note (readOwn swallows the get-trap)", () => {
    const trap = new Proxy(
      { ...VALID_NOTE } as NoteInput,
      new Proxy(
        {},
        {
          get() {
            throw new Error("trap");
          },
        },
      ),
    );
    expect(() => validateNote(trap)).not.toThrow();
    // every property read throws → fields read as undefined → typeof !== 'string' → invalid
    expect(validateNote(trap).valid).toBe(false);
  });
});

describe("types", () => {
  it("NoteInput has exactly the four required string fields (spec/04 §2.1)", () => {
    expectTypeOf<NoteInput>().toEqualTypeOf<{
      what_happened: string;
      avoid: string;
      true_current_state: string;
      next: string;
    }>();
  });

  it("validateNote returns NoteValidation", () => {
    expectTypeOf(validateNote(VALID_NOTE)).toEqualTypeOf<NoteValidation>();
  });

  it("NoteValidation is { valid: boolean; reason?: string }", () => {
    expectTypeOf<NoteValidation>().toEqualTypeOf<{ valid: boolean; reason?: string }>();
  });

  it("NOTE_INVALID_REASON is a string", () => {
    expectTypeOf(NOTE_INVALID_REASON).toEqualTypeOf<string>();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S2 (P1.M2.T3.S2) — renderNote tests (spec/04-data-model.md §2.3 + spec/10-testing.md §1.8)
// APPENDED below the S1 validateNote tests, which are UNCHANGED.
// ─────────────────────────────────────────────────────────────────────────────

/** A ledger with all three lists empty (spec/04 §2.3 omission rule). */
const EMPTY_LEDGER: FileLedger = { readFiles: [], modifiedFiles: [], bashSideEffects: [] };

describe("renderNote — spec/04 §2.3 pinned format", () => {
  it("all ledger lists empty → no ledger blocks; header interpolates granularity VERBATIM", () => {
    const out = renderNote(VALID_NOTE, EMPTY_LEDGER, "last_turn");
    expect(out).toBe(
      [
        "## 🔄 Mulligan rewind (last_turn)",
        "",
        `**What happened:** ${VALID_NOTE.what_happened}`,
        "",
        `**Avoid:** ${VALID_NOTE.avoid}`,
        "",
        `**Current true state:** ${VALID_NOTE.true_current_state}`,
        "",
        `**Next:** ${VALID_NOTE.next}`,
      ].join("\n"),
    );
    // No trailing newline (GOTCHA #8).
    expect(out.endsWith("\n")).toBe(false);
    // No ledger block tags present at all.
    expect(out).not.toContain("<files-read>");
    expect(out).not.toContain("<files-modified>");
    expect(out).not.toContain("<bash-side-effects>");
  });

  it("all three ledger lists non-empty → all three blocks, in read→modified→bash order", () => {
    const ledger: FileLedger = {
      readFiles: ["path/a.ts", "path/b.ts"],
      modifiedFiles: ["path/c.ts"],
      bashSideEffects: ['git commit -m "wip"'],
    };
    const out = renderNote(VALID_NOTE, ledger, "last_tool_call_group");
    expect(out).toBe(
      [
        "## 🔄 Mulligan rewind (last_tool_call_group)",
        "",
        `**What happened:** ${VALID_NOTE.what_happened}`,
        "",
        `**Avoid:** ${VALID_NOTE.avoid}`,
        "",
        `**Current true state:** ${VALID_NOTE.true_current_state}`,
        "",
        "<files-read>",
        "path/a.ts",
        "path/b.ts",
        "</files-read>",
        "",
        "<files-modified>",
        "path/c.ts",
        "</files-modified>",
        "",
        "<bash-side-effects>",
        'git commit -m "wip"',
        "</bash-side-effects>",
        "",
        `**Next:** ${VALID_NOTE.next}`,
      ].join("\n"),
    );
  });

  it("each block is independently conditional — partial ledger (only readFiles) → only <files-read>", () => {
    const ledger: FileLedger = { readFiles: ["src/x.ts"], modifiedFiles: [], bashSideEffects: [] };
    const out = renderNote(VALID_NOTE, ledger, "checkpoint"); // "checkpoint" granularity rendered verbatim too
    expect(out).toContain("## 🔄 Mulligan rewind (checkpoint)");
    expect(out).toContain("<files-read>\nsrc/x.ts\n</files-read>");
    expect(out).not.toContain("<files-modified>");
    expect(out).not.toContain("<bash-side-effects>");
  });

  it("only bashSideEffects non-empty → only <bash-side-effects> block", () => {
    const ledger: FileLedger = {
      readFiles: [],
      modifiedFiles: [],
      bashSideEffects: ["rm -rf node_modules", "npm install"],
    };
    const out = renderNote(VALID_NOTE, ledger, "last_turn");
    expect(out).toContain(
      "<bash-side-effects>\nrm -rf node_modules\nnpm install\n</bash-side-effects>",
    );
    expect(out).not.toContain("<files-read>");
    expect(out).not.toContain("<files-modified>");
  });

  it("only modifiedFiles non-empty → only <files-modified> block", () => {
    const ledger: FileLedger = { readFiles: [], modifiedFiles: ["a.ts", "b.ts"], bashSideEffects: [] };
    const out = renderNote(VALID_NOTE, ledger, "last_tool_call_group");
    expect(out).toContain("<files-modified>\na.ts\nb.ts\n</files-modified>");
    expect(out).not.toContain("<files-read>");
    expect(out).not.toContain("<bash-side-effects>");
  });
});

describe("renderNote — snapshot-style cases (spec/10 §1.8)", () => {
  // toMatchInlineSnapshot() with no argument: vitest AUTO-WRITES the snapshot on first run (GOTCHA #11).
  // If your vitest version requires it, run `npx vitest run -u` once to populate, then `npx vitest run`.

  it("representative last_turn note with a full ledger", () => {
    const ledger: FileLedger = {
      readFiles: ["src/auth/session.ts"],
      modifiedFiles: ["src/auth/session.ts"],
      bashSideEffects: ["npm run build"],
    };
    expect(renderNote(VALID_NOTE, ledger, "last_turn")).toMatchInlineSnapshot(`
      "## 🔄 Mulligan rewind (last_turn)

      **What happened:** Ran \`grep -r auth .\` and dumped ~40k tokens of output I didn't need.

      **Avoid:** Do not run grep without --quiet, -c, or piping to head; prefer the built-in grep tool which truncates.

      **Current true state:** No files were modified on the abandoned span.

      <files-read>
      src/auth/session.ts
      </files-read>

      <files-modified>
      src/auth/session.ts
      </files-modified>

      <bash-side-effects>
      npm run build
      </bash-side-effects>

      **Next:** Re-run the search as \`grep -rl auth src/\` and read only the 3 relevant files."
    `);
  });

  it("representative last_tool_call_group note with an empty ledger", () => {
    expect(renderNote(VALID_NOTE, EMPTY_LEDGER, "last_tool_call_group")).toMatchInlineSnapshot(`
      "## 🔄 Mulligan rewind (last_tool_call_group)

      **What happened:** Ran \`grep -r auth .\` and dumped ~40k tokens of output I didn't need.

      **Avoid:** Do not run grep without --quiet, -c, or piping to head; prefer the built-in grep tool which truncates.

      **Current true state:** No files were modified on the abandoned span.

      **Next:** Re-run the search as \`grep -rl auth src/\` and read only the 3 relevant files."
    `);
  });
});

describe("renderNote — field values rendered AS-IS (no escaping/transform)", () => {
  it("fields containing markdown / backticks / quotes are interpolated verbatim", () => {
    const note: NoteInput = {
      what_happened: "ran `grep -r auth .` → ~38k tokens",
      avoid: "don't run wide grep; use **-l** or pipe to `head`",
      true_current_state: "no files changed; \"scratch.ts\" not created",
      next: "re-run as `grep -rl auth src/`",
    };
    const out = renderNote(note, EMPTY_LEDGER, "last_turn");
    expect(out).toContain("**What happened:** ran `grep -r auth .` → ~38k tokens");
    expect(out).toContain('**Current true state:** no files changed; "scratch.ts" not created');
    expect(out).toContain("**Next:** re-run as `grep -rl auth src/`");
  });
});

describe("renderNote — defensive (NEVER throws — GOTCHA #5)", () => {
  it("a null note passed as NoteInput → renders empty fields, not a throw", () => {
    expect(() => renderNote(null as unknown as NoteInput, EMPTY_LEDGER, "last_turn")).not.toThrow();
    const out = renderNote(null as unknown as NoteInput, EMPTY_LEDGER, "last_turn");
    expect(out).toContain("## 🔄 Mulligan rewind (last_turn)");
    expect(out).toContain("**What happened:** "); // empty value, not a crash
  });

  it("an array passed as NoteInput → renders empty fields, not a throw", () => {
    expect(() =>
      renderNote(["x", "y", "z", "w"] as unknown as NoteInput, EMPTY_LEDGER, "last_turn"),
    ).not.toThrow();
  });

  it("a null ledger passed as FileLedger → no blocks, not a throw", () => {
    expect(() => renderNote(VALID_NOTE, null as unknown as FileLedger, "last_turn")).not.toThrow();
    const out = renderNote(VALID_NOTE, null as unknown as FileLedger, "last_turn");
    expect(out).not.toContain("<files-read>");
  });

  it("a ledger with non-array lists → no blocks, not a throw", () => {
    const bad = { readFiles: "src/a.ts", modifiedFiles: null, bashSideEffects: undefined } as unknown as FileLedger;
    expect(() => renderNote(VALID_NOTE, bad, "last_turn")).not.toThrow();
    expect(renderNote(VALID_NOTE, bad, "last_turn")).not.toContain("<files-read>");
  });

  it("does not throw on a throwing-Proxy note (readOwn swallows the get-trap)", () => {
    const trap = new Proxy(
      { ...VALID_NOTE } as NoteInput,
      new Proxy(
        {},
        {
          get() {
            throw new Error("trap");
          },
        },
      ),
    );
    expect(() => renderNote(trap, EMPTY_LEDGER, "last_turn")).not.toThrow();
    // every field read throws → read as undefined → "" → rendered with empty values, no crash
    const out = renderNote(trap, EMPTY_LEDGER, "last_turn");
    expect(out).toContain("## 🔄 Mulligan rewind (last_turn)");
    expect(out).toContain("**Next:** ");
  });
});

describe("renderNote — types", () => {
  it("renderNote returns a string", () => {
    expectTypeOf(renderNote(VALID_NOTE, EMPTY_LEDGER, "last_turn")).toEqualTypeOf<string>();
  });

  it("Granularity is the three rewind granularities (consumed verbatim in the header)", () => {
    expectTypeOf<Granularity>().toEqualTypeOf<"last_tool_call_group" | "last_turn" | "checkpoint">();
  });

  it("FileLedger has the three string[] lists (consumed for the conditional blocks)", () => {
    expectTypeOf<FileLedger>().toEqualTypeOf<{
      readFiles: string[];
      modifiedFiles: string[];
      bashSideEffects: string[];
    }>();
  });
});