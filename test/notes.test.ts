import { describe, it, expect, expectTypeOf } from "vitest";
import {
  validateNote,
  NOTE_INVALID_REASON,
  type NoteInput,
  type NoteValidation,
} from "../src/notes.js";

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