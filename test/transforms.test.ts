import { describe, it, expect, expectTypeOf } from "vitest";
import { partitionIntoUnits, resolveLastToolCallGroup, resolveLastTurn, resolveCheckpoint, applyRewind, type Unit, type MessageLike, type BranchEntry } from "../src/transforms.js";

// No beforeEach needed: transforms.ts has NO module-scoped mutable state (pure over its arguments).

// ── fixture builders (mirror ledger.test.ts's `asst`) ───────────────────────────

/** Build an assistant message whose content is a list of toolCall blocks with the given ids. */
function asst(...callIds: string[]): MessageLike {
  return {
    role: "assistant",
    content: callIds.map((id) => ({ type: "toolCall", id, name: "tool", arguments: {} })),
  };
}

/** Build a text-only assistant (no toolCalls) → must be a plain unit. */
function asstText(text: string): MessageLike {
  return { role: "assistant", content: [{ type: "text", text }] };
}

/** Build a toolResult message for the given toolCallId. */
function result(toolCallId: string): MessageLike {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "tool",
    content: [{ type: "text", text: "..." }],
    isError: false,
  };
}

/** Build a user message. */
function user(text: string): MessageLike {
  return { role: "user", content: text };
}

/** Build a custom message (e.g. mulligan:note / mulligan:nudge) → must be a plain unit. */
function custom(customType: string): MessageLike {
  return { role: "custom", customType, content: "x", display: true };
}

/** Compact per-unit summary "kind:minIdx:len" for readable multi-unit assertions. */
function summary(units: Unit[]): string {
  return units.map((u) => `${u.kind}:${u.indices[0]}:${u.indices.length}`).join(" | ");
}

/**
 * The pairing invariant (forward direction — always true): for every toolGroup unit, (i) it contains exactly one
 * assistant member, and (ii) every OTHER member is a toolResult whose toolCallId is one of that assistant's toolCall
 * ids. Used across many tests. (The "vice versa" — every call has a result — holds only when all results are present;
 * asserted separately in the fully-paired 3+3 case — GOTCHA #13.)
 */
function expectPairingInvariant(messages: MessageLike[], units: Unit[]): void {
  for (const u of units) {
    if (u.kind === "plain") {
      expect(u.indices, "plain unit spans exactly one index").toHaveLength(1);
      continue;
    }
    // toolGroup: find the assistant member, assert every other member is a matching toolResult.
    const asstIdx = u.indices.find((i) => messages[i]?.role === "assistant");
    expect(asstIdx, "toolGroup must contain an assistant message").toBeTypeOf("number");
    const asstMsg = messages[asstIdx as number] as MessageLike;
    const content = asstMsg.content;
    expect(Array.isArray(content), "assistant content is a block array").toBe(true);
    const callIds = new Set(
      (content as Array<Record<string, unknown>>)
        .filter((b) => b?.type === "toolCall" && typeof b.id === "string")
        .map((b) => b.id as string),
    );
    expect(callIds.size, "the assistant issued ≥1 pairable toolCall").toBeGreaterThan(0);
    for (const i of u.indices) {
      if (i === asstIdx) continue;
      const r = messages[i] as MessageLike;
      expect(r?.role, "non-assistant toolGroup member is a toolResult").toBe("toolResult");
      expect(callIds.has(r.toolCallId as string), "result's toolCallId ∈ the assistant's call ids").toBe(true);
    }
  }
}

// ── spec/10 §1.1 PINNED contract (the load-bearing tests) ──────────────────────

describe("partitionIntoUnits — spec/10 §1.1 PINNED contract", () => {
  it("[user, assistant(1 toolCall), result, assistant(text)] → 3 units (plain, toolGroup[1,2], plain)", () => {
    const msgs: MessageLike[] = [user("do it"), asst("c1"), result("c1"), asstText("done")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(3);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:2 | plain:3:1");
    expect(units[0]).toEqual({ indices: [0], kind: "plain" }); // user
    expect(units[1]).toEqual({ indices: [1, 2], kind: "toolGroup" }); // assistant(c1) + result(c1)
    expect(units[2]).toEqual({ indices: [3], kind: "plain" }); // text assistant
    expectPairingInvariant(msgs, units);
  });

  it("orphan result (no matching toolCall) → its OWN plain unit; never merged (spec/08 E1)", () => {
    const msgs: MessageLike[] = [user("hi"), result("orphan-1")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(2);
    expect(summary(units)).toBe("plain:0:1 | plain:1:1");
    expect(units.every((u) => u.kind === "plain")).toBe(true); // nothing merged
    // the orphan result (index 1) stands alone as plain
    expect(units[1]).toEqual({ indices: [1], kind: "plain" });
  });

  it("assistant with 3 toolCalls + 3 results → ONE toolGroup with 4 indices", () => {
    const msgs: MessageLike[] = [asst("c1", "c2", "c3"), result("c1"), result("c2"), result("c3")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual({ indices: [0, 1, 2, 3], kind: "toolGroup" }); // 4 indices, sorted ascending
    expectPairingInvariant(msgs, units);
    // "vice versa" (reverse) — holds in the fully-paired case: every call id has a result in the unit (GOTCHA #13)
    const asstMsg = msgs[0];
    const content = asstMsg.content as Array<Record<string, unknown>>;
    const callIds = content.filter((b) => b?.type === "toolCall").map((b) => b.id as string);
    const resultIds = new Set(units[0].indices.slice(1).map((i) => (msgs[i] as MessageLike).toolCallId as string));
    for (const id of callIds) {
      expect(resultIds.has(id), `every call id ${id} has its result in the toolGroup`).toBe(true);
    }
  });

  it("invariant holds across a mixed list (the forward direction — GOTCHA #13)", () => {
    const msgs: MessageLike[] = [
      user("u"),
      asst("a"), result("a"),
      asstText("thinking..."),
      asst("b", "c"), result("b"), result("c"),
      result("orphan"),
    ];
    const units = partitionIntoUnits(msgs);
    expectPairingInvariant(msgs, units); // forward invariant; never throws, never asserts falsely
  });
});

// ── corner cases (spec/06 §2 corner cases) ─────────────────────────────────────

describe("partitionIntoUnits — spec/06 §2 corner cases", () => {
  it("assistant with toolCalls but NO results yet → toolGroup of just the assistant", () => {
    const msgs: MessageLike[] = [user("go"), asst("pending")]; // no result for "pending"
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:1");
    expect(units[1]).toEqual({ indices: [1], kind: "toolGroup" }); // NOT demoted to plain
    expectPairingInvariant(msgs, units);
  });

  it("parallel-tool mode: ONE assistant with 2 toolCalls + 2 results → ONE toolGroup (spec/06 §9)", () => {
    const msgs: MessageLike[] = [asst("p1", "p2"), result("p1"), result("p2")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual({ indices: [0, 1, 2], kind: "toolGroup" });
    expectPairingInvariant(msgs, units);
  });

  it("two SEPARATE assistant+result pairs → two toolGroups", () => {
    const msgs: MessageLike[] = [asst("a"), result("a"), asst("b"), result("b")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | toolGroup:2:2");
    expectPairingInvariant(msgs, units);
  });

  it("interleaved: asst(a), asst(b), result(a), result(b) → two toolGroups [0,2] and [1,3]", () => {
    const msgs: MessageLike[] = [asst("a"), asst("b"), result("a"), result("b")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | toolGroup:1:2");
    expect(units[0].indices).toEqual([0, 2]); // asst(a) groups with result(a) at index 2
    expect(units[1].indices).toEqual([1, 3]); // asst(b) groups with result(b) at index 3
    expectPairingInvariant(msgs, units);
  });

  it("a toolResult whose assistant had only a malformed (no-id) call → orphan → plain unit", () => {
    // assistant at 0 has a toolCall with NO valid id; result at 1 references "x" → no match → orphan plain
    const msgs: MessageLike[] = [
      { role: "assistant", content: [{ type: "toolCall", id: "", name: "t", arguments: {} }] },
      result("x"),
    ] as unknown as MessageLike[];
    const units = partitionIntoUnits(msgs);
    expect(units.every((u) => u.kind === "plain")).toBe(true); // both plain: can't confirm either pair
    expect(units).toHaveLength(2);
  });
});

// ── plain units (non-tool messages) ─────────────────────────────────────────────

describe("partitionIntoUnits — plain units (everything not in a toolGroup)", () => {
  it("empty message list → []", () => {
    expect(partitionIntoUnits([])).toEqual([]);
  });

  it("a list with NO tools → all plain units, one per message, in order", () => {
    const msgs: MessageLike[] = [user("a"), asstText("b"), custom("mulligan:note"), user("c")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("plain:0:1 | plain:1:1 | plain:2:1 | plain:3:1");
    expect(units.every((u) => u.kind === "plain")).toBe(true);
  });

  it("custom messages (mulligan:note / mulligan:nudge) → plain units", () => {
    const msgs: MessageLike[] = [custom("mulligan:note"), custom("mulligan:nudge")];
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(2);
    expect(units.every((u) => u.kind === "plain")).toBe(true);
  });

  it("a text-only assistant sandwiched between two toolGroups stays plain", () => {
    const msgs: MessageLike[] = [asst("a"), result("a"), asstText("commentary"), asst("b"), result("b")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | plain:2:1 | toolGroup:3:2");
    expect(units[1]).toEqual({ indices: [2], kind: "plain" });
    expectPairingInvariant(msgs, units);
  });
});

// ── defensive / never throws (spec/08 E13; context-handler hot path) ────────────

describe("partitionIntoUnits — defensive (NEVER throws — GOTCHA #8)", () => {
  it("null / undefined / non-array messages → [] (no throw)", () => {
    expect(partitionIntoUnits(null)).toEqual([]);
    expect(partitionIntoUnits(undefined)).toEqual([]);
    expect(partitionIntoUnits("not-an-array" as unknown as MessageLike[])).toEqual([]);
    expect(partitionIntoUnits({} as unknown as MessageLike[])).toEqual([]);
  });

  it("a non-record message element is skipped gracefully (no throw)", () => {
    const msgs = [null, 42, "raw", undefined] as unknown as MessageLike[];
    expect(() => partitionIntoUnits(msgs)).not.toThrow();
    // 4 plain units (each garbage index stands alone as plain)
    expect(partitionIntoUnits(msgs)).toHaveLength(4);
    expect(partitionIntoUnits(msgs).every((u) => u.kind === "plain")).toBe(true);
  });

  it("an assistant with non-array content → plain (no toolCall blocks read)", () => {
    const msgs: MessageLike[] = [{ role: "assistant", content: "just a string" }] as unknown as MessageLike[];
    expect(() => partitionIntoUnits(msgs)).not.toThrow();
    expect(partitionIntoUnits(msgs)).toEqual([{ indices: [0], kind: "plain" }]);
  });

  it("toolCall blocks with missing / non-string / empty ids are not pairable (GOTCHA #4)", () => {
    const msgs: MessageLike[] = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", name: "t", arguments: {} }, // missing id
          { type: "toolCall", id: 123, name: "t", arguments: {} }, // non-string id
          { type: "toolCall", id: "", name: "t", arguments: {} }, // empty id
          { type: "text", text: "hi" },
        ],
      } as unknown as MessageLike,
    ];
    const units = partitionIntoUnits(msgs);
    expect(units).toEqual([{ indices: [0], kind: "plain" }]); // no valid-id call → plain
  });

  it("duplicate toolCallId across two results → BOTH group with the assistant (orphan-safe — GOTCHA #9)", () => {
    const msgs: MessageLike[] = [asst("dup"), result("dup"), result("dup")]; // two results, one call id
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("toolGroup");
    expect(units[0].indices).toEqual([0, 1, 2]); // both results join the SAME toolGroup → no orphan on removal
  });

  it("a result appearing BEFORE its assistant still pairs (order-robust — GOTCHA #9)", () => {
    const msgs: MessageLike[] = [result("x"), asst("x")]; // result at 0, assistant at 1 (malformed order)
    const units = partitionIntoUnits(msgs);
    expect(units).toHaveLength(1);
    expect(units[0]).toEqual({ indices: [0, 1], kind: "toolGroup" }); // grouped + sorted ascending
  });

  it("never throws on a throwing-Proxy message (fail-open like tokens.ts/ledger.ts)", () => {
    const trap: MessageLike = new Proxy(
      { role: "assistant", content: [{ type: "toolCall", id: "t", name: "x", arguments: {} }] } as MessageLike,
      new Proxy(
        {},
        {
          get() {
            throw new Error("trap");
          },
        },
      ),
    );
    expect(() => partitionIntoUnits([trap])).not.toThrow();
    // every property read throws → readOwn swallows → treated as non-record/non-assistant → plain unit
    expect(partitionIntoUnits([trap])).toEqual([{ indices: [0], kind: "plain" }]);
  });

  it("accepts a real-ish Pi AgentMessage[] shape (structural typing)", () => {
    const msgs = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          { type: "toolCall", id: "call_1", name: "read", arguments: { path: "a.ts" } },
        ],
      },
      { role: "toolResult", toolCallId: "call_1", toolName: "read", content: [{ type: "text", text: "..." }], isError: false },
    ] as const;
    const units = partitionIntoUnits(msgs as unknown as MessageLike[]);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:2");
    expectPairingInvariant(msgs as unknown as MessageLike[], units);
  });
});

// ── ordering & determinism ──────────────────────────────────────────────────────

describe("partitionIntoUnits — ordering & determinism", () => {
  it("units are ordered by their minimum index (indices[0])", () => {
    const msgs: MessageLike[] = [user("u"), asst("a"), result("a"), asst("b"), result("b")];
    const units = partitionIntoUnits(msgs);
    const mins = units.map((u) => u.indices[0]);
    expect(mins).toEqual([...mins].sort((x, y) => x - y)); // strictly non-decreasing
  });

  it("toolGroup indices are sorted ascending", () => {
    const msgs: MessageLike[] = [asst("a", "b"), result("b"), result("a")]; // results in non-call order
    const units = partitionIntoUnits(msgs);
    expect(units[0].indices).toEqual([0, 1, 2]); // ascending, regardless of call/result order
  });

  it("is pure / idempotent — same input → same output across calls", () => {
    const msgs: MessageLike[] = [user("u"), asst("a"), result("a")];
    const a = partitionIntoUnits(msgs);
    const b = partitionIntoUnits(msgs);
    expect(a).toEqual(b);
  });

  it("does not mutate its input", () => {
    const msgs: MessageLike[] = [user("u"), asst("a"), result("a")];
    const snapshot = JSON.stringify(msgs);
    partitionIntoUnits(msgs);
    expect(JSON.stringify(msgs)).toBe(snapshot);
  });

  it("a representative summary is captured via inline snapshot", () => {
    const msgs: MessageLike[] = [
      user("please"),
      asst("c1"),
      result("c1"),
      asstText("ok"),
      asst("c2", "c3"),
      result("c2"),
      result("c3"),
    ];
    expect(summary(partitionIntoUnits(msgs))).toMatchInlineSnapshot(
      `"plain:0:1 | toolGroup:1:2 | plain:3:1 | toolGroup:4:3"`,
    );
  });
});

// ── types ───────────────────────────────────────────────────────────────────────

describe("types", () => {
  it("partitionIntoUnits returns Unit[]", () => {
    expectTypeOf(partitionIntoUnits([])).toEqualTypeOf<Unit[]>();
  });

  it("Unit has the spec/06 §2 shape", () => {
    const u: Unit = { indices: [0], kind: "plain" };
    expectTypeOf(u).toEqualTypeOf<Unit>();
    expectTypeOf(u.indices).toEqualTypeOf<number[]>();
    expectTypeOf(u.kind).toEqualTypeOf<"plain" | "toolGroup">();
  });

  it("MessageLike accepts real-ish Pi message shapes (structural typing)", () => {
    const m1: MessageLike = { role: "user", content: "hi" };
    const m2: MessageLike = {
      role: "assistant",
      content: [{ type: "toolCall", id: "x", name: "read", arguments: { path: "a.ts" } }],
    };
    const m3: MessageLike = { role: "toolResult", toolCallId: "x", toolName: "read", content: [{ type: "text", text: "y" }] };
    const m4: MessageLike = { role: "custom", customType: "mulligan:note", content: "note", display: true };
    expectTypeOf(m1).toEqualTypeOf<MessageLike>();
    expectTypeOf(m2).toEqualTypeOf<MessageLike>();
    expectTypeOf(m3).toEqualTypeOf<MessageLike>();
    expectTypeOf(m4).toEqualTypeOf<MessageLike>();
  });

  it("accepts null | undefined input (defensive signature)", () => {
    expectTypeOf(partitionIntoUnits(null)).toEqualTypeOf<Unit[]>();
    expectTypeOf(partitionIntoUnits(undefined)).toEqualTypeOf<Unit[]>();
  });
});

// ── resolveLastToolCallGroup — spec/10 §1.2 + corner + defensive + parallel + types ────

describe("resolveLastToolCallGroup — spec/10 §1.2 PINNED contract", () => {
  it("no exclude → returns the LAST toolGroup's indices (a(B)+r(B))", () => {
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:2 | toolGroup:3:2");
    expect(resolveLastToolCallGroup(units, msgs)).toEqual([3, 4]); // the a(B)+r(B) toolGroup
  });

  it("excludeToolCallId='B' → returns the a(A)+r(A) toolGroup's indices (skips the rewind's own)", () => {
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(resolveLastToolCallGroup(units, msgs, "B")).toEqual([1, 2]); // the a(A)+r(A) toolGroup
  });

  it("no toolGroup at all → null", () => {
    const msgs: MessageLike[] = [user("u"), asstText("thinking"), custom("mulligan:note")];
    const units = partitionIntoUnits(msgs);
    expect(units.every((u) => u.kind === "plain")).toBe(true);
    expect(resolveLastToolCallGroup(units, msgs)).toBeNull();
  });
});

describe("resolveLastToolCallGroup — exclude semantics", () => {
  it("excludeToolCallId matching NO unit → returns the last toolGroup (nothing skipped)", () => {
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(resolveLastToolCallGroup(units, msgs, "DOES-NOT-EXIST")).toEqual([3, 4]);
  });

  it("only ONE toolGroup and exclude matches it → null (the only toolGroup was the rewind's own)", () => {
    const msgs: MessageLike[] = [user("u"), asst("only"), result("only")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("plain:0:1 | toolGroup:1:2");
    expect(resolveLastToolCallGroup(units, msgs, "only")).toBeNull();
  });

  it("excludeToolCallId is undefined → never skips (same as no exclude)", () => {
    const msgs: MessageLike[] = [asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(resolveLastToolCallGroup(units, msgs, undefined)).toEqual([2, 3]);
  });

  it("excludeToolCallId is empty string / non-string → never skips", () => {
    const msgs: MessageLike[] = [asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(resolveLastToolCallGroup(units, msgs, "")).toEqual([2, 3]);
    expect(resolveLastToolCallGroup(units, msgs, 123 as unknown as string)).toEqual([2, 3]);
  });

  it("skips EVERY toolGroup whose assistant issued the exclude id, landing on an earlier one", () => {
    // three toolGroups: X(0,1), Y(2,3), Z(4,5); exclude 'Z' → returns Y([2,3])
    const msgs: MessageLike[] = [asst("X"), result("X"), asst("Y"), result("Y"), asst("Z"), result("Z")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | toolGroup:2:2 | toolGroup:4:2");
    expect(resolveLastToolCallGroup(units, msgs, "Z")).toEqual([2, 3]);
  });
});

describe("resolveLastToolCallGroup — parallel-tool mode (spec/06 §9 / spec/08 E6)", () => {
  it("rewind shares an assistant message with a sibling call → that toolGroup is skipped, previous returned", () => {
    // one assistant carries call 'X' AND the rewind call 'REW' (parallel execution) + both results
    const msgs: MessageLike[] = [
      asst("prev"),
      result("prev"),
      asst("X", "REW"), // shared assistant message
      result("X"),
      result("REW"),
    ];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | toolGroup:2:3"); // shared message is ONE toolGroup of 3 indices
    // exclude the rewind's own call 'REW' → the shared toolGroup [2,3,4] is skipped → previous [0,1] returned
    expect(resolveLastToolCallGroup(units, msgs, "REW")).toEqual([0, 1]);
  });

  it("only the shared toolGroup exists → exclude it → null", () => {
    const msgs: MessageLike[] = [asst("A", "REW"), result("A"), result("REW")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:3");
    expect(resolveLastToolCallGroup(units, msgs, "REW")).toBeNull();
  });
});

describe("resolveLastToolCallGroup — defensive (NEVER throws — spec/08 E13)", () => {
  it("non-array units → null (no throw)", () => {
    expect(resolveLastToolCallGroup(null as unknown as Unit[], [])).toBeNull();
    expect(resolveLastToolCallGroup(undefined as unknown as Unit[], [])).toBeNull();
    expect(resolveLastToolCallGroup("nope" as unknown as Unit[], [])).toBeNull();
  });

  it("a toolGroup whose assistant is a throwing-Proxy → no match → returned (fail-safe, no throw)", () => {
    // the rewind's own call id 'self' is NOT readable (every read throws) → cannot match → unit is returned
    const trap: MessageLike = new Proxy(
      { role: "assistant", content: [{ type: "toolCall", id: "self", name: "mulligan_rewind", arguments: {} }] } as MessageLike,
      new Proxy({}, { get() { throw new Error("trap"); } }),
    );
    const msgs: MessageLike[] = [asst("real"), result("real"), trap, result("self")];
    const units = partitionIntoUnits(msgs); // trap reads throw → treated as non-assistant → may land as plain/toolGroup
    expect(() => resolveLastToolCallGroup(units, msgs, "self")).not.toThrow();
    // 'self' can never be confirmed issued → the toolGroup 'real' (or the last confirmable toolGroup) is returned
    expect(resolveLastToolCallGroup(units, msgs, "self")).not.toBeNull();
  });

  it("malformed messages array (non-array) → exclude never matches → returns last toolGroup", () => {
    const msgs = "garbage" as unknown as MessageLike[];
    const units: Unit[] = [
      { indices: [0, 1], kind: "toolGroup" },
      { indices: [2, 3], kind: "toolGroup" },
    ];
    expect(resolveLastToolCallGroup(units, msgs, "whatever")).toEqual([2, 3]);
  });

  it("a malformed unit record in the list is skipped, not crashing", () => {
    const msgs: MessageLike[] = [asst("A"), result("A")];
    const units = [
      null,
      { kind: "toolGroup" }, // no indices
      { indices: [0, 1], kind: "toolGroup" },
    ] as unknown as Unit[];
    expect(() => resolveLastToolCallGroup(units, msgs)).not.toThrow();
    expect(resolveLastToolCallGroup(units, msgs)).toEqual([0, 1]);
  });
});

describe("resolveLastToolCallGroup — ordering, purity, types", () => {
  it("plain units interspersed between toolGroups are skipped", () => {
    const msgs: MessageLike[] = [asst("A"), result("A"), asstText("chat"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    expect(summary(units)).toBe("toolGroup:0:2 | plain:2:1 | toolGroup:3:2");
    expect(resolveLastToolCallGroup(units, msgs)).toEqual([3, 4]);
  });

  it("is pure / idempotent — same input → same output, no mutation", () => {
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A"), asst("B"), result("B")];
    const units = partitionIntoUnits(msgs);
    const a = resolveLastToolCallGroup(units, msgs, "B");
    const b = resolveLastToolCallGroup(units, msgs, "B");
    expect(a).toEqual(b);
    expect(JSON.stringify(units)).toBe(JSON.stringify(partitionIntoUnits(msgs))); // units unchanged
  });

  it("returns the unit's indices reference (the exact indices array)", () => {
    const msgs: MessageLike[] = [user("u"), asst("A"), result("A")];
    const units = partitionIntoUnits(msgs);
    const toolGroup = units.find((u) => u.kind === "toolGroup")!;
    expect(resolveLastToolCallGroup(units, msgs)).toBe(toolGroup.indices); // same array reference (read-only)
  });

  it("returns number[] | null", () => {
    expectTypeOf(resolveLastToolCallGroup([], [])).toEqualTypeOf<number[] | null>();
    expectTypeOf(resolveLastToolCallGroup([], [], "x")).toEqualTypeOf<number[] | null>();
  });
});

// ── resolveLastTurn — spec/10 §1.3 + corner + defensive + parallel + types ────

describe("resolveLastTurn — spec/10 §1.3 PINNED contract", () => {
  // [u0, a, r, u1, a, r] — indices 0..5; iLastUser = 3.
  const twoTurns = (): MessageLike[] => [
    user("u0"), asst("c0"), result("c0"),
    user("u1"), asst("c1"), result("c1"),
  ];

  it("default → remove indices AFTER u1 (keep u1): remove = [4,5]", () => {
    expect(resolveLastTurn(twoTurns(), {}).remove).toEqual([4, 5]);
    expect(resolveLastTurn(twoTurns(), undefined).remove).toEqual([4, 5]); // opts may be undefined
  });

  it("to_previous_prompt:true → ALSO remove u1: remove = [3,4,5] (iLastUser=3, iFirstUser=0 → allowed)", () => {
    expect(resolveLastTurn(twoTurns(), { to_previous_prompt: true }).remove).toEqual([3, 4, 5]);
  });

  it("u1 is the FIRST user → nuclear refused by protected check: { remove: [] }", () => {
    // only one user message → iLastUser === iFirstUser === 0
    const singleTurn: MessageLike[] = [user("only"), asst("c"), result("c")];
    expect(resolveLastTurn(singleTurn, { to_previous_prompt: true })).toEqual({ remove: [] });
  });
});

describe("resolveLastTurn — the rewind's OWN unit survives (default)", () => {
  it("rewind's assistant+result after iLastUser are kept; prior-turn work is removed", () => {
    // iLastUser=3. The rewind's own unit (assistant issued "REW") = [6,7]. Prior turn work [4,5] is removed.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("prev"), result("prev"), asst("REW"), result("REW"),
    ];
    expect(resolveLastTurn(msgs, {}, "REW").remove).toEqual([4, 5]); // [6,7] kept (rewind's own unit)
  });

  it("rewind's own unit is kept WHOLE even if it shares a message (parallel-tool — spec/06 §9 / spec/08 E6)", () => {
    // one assistant carries a sibling call 'sib' AND the rewind call 'REW'; both results follow.
    // iLastUser=3. rewindOwnUnit (assistant issued "REW") = the shared toolGroup [6,7,8] → all kept.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("prev"), result("prev"), asst("sib", "REW"), result("sib"), result("REW"),
    ];
    // prior-turn work [4,5] removed; shared unit [6,7,8] kept whole (siblings survive)
    expect(resolveLastTurn(msgs, {}, "REW").remove).toEqual([4, 5]);
  });
});

describe("resolveLastTurn — mulligan:* notes survive at the tail", () => {
  it("a mulligan:note after iLastUser is NOT removed", () => {
    // iLastUser=3; note at 6 → kept; assistant/result [4,5] removed.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("c1"), result("c1"), custom("mulligan:note"),
    ];
    expect(resolveLastTurn(msgs, {}).remove).toEqual([4, 5]);
  });

  it("a mulligan:nudge (ephemeral) after iLastUser is also kept", () => {
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("c1"), result("c1"), custom("mulligan:nudge"),
    ];
    expect(resolveLastTurn(msgs, {}).remove).toEqual([4, 5]);
  });

  it("multiple mulligan:* notes interspersed with removed work all survive", () => {
    // iLastUser=3; indices 4(asst),5(result) removed; 6(note),7(note) kept.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("c1"), result("c1"), custom("mulligan:note"), custom("mulligan:note"),
    ];
    expect(resolveLastTurn(msgs, {}).remove).toEqual([4, 5]);
  });
});

describe("resolveLastTurn — no-op cases", () => {
  it("no user message at all → { remove: [] }", () => {
    const msgs: MessageLike[] = [asst("c"), result("c"), custom("mulligan:note")];
    expect(resolveLastTurn(msgs, {})).toEqual({ remove: [] });
    expect(resolveLastTurn(msgs, { to_previous_prompt: true })).toEqual({ remove: [] });
  });

  it("nothing after iLastUser → { remove: [] }", () => {
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), user("u1")];
    expect(resolveLastTurn(msgs, {})).toEqual({ remove: [] });
    // nuclear still allowed here (iLastUser=3 !== iFirstUser=0) and removes just u1
    expect(resolveLastTurn(msgs, { to_previous_prompt: true }).remove).toEqual([3]);
  });
});

describe("resolveLastTurn — excludeToolCallId semantics", () => {
  it("excludeToolCallId absent → rewind's own unit is NOT kept (removed with the rest); note survives", () => {
    // no exclude → rewindOwnIndices empty → [4,5,6,7] all removed except the note at 8.
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("REW"), result("REW"), asst("c2"), result("c2"), custom("mulligan:note"),
    ];
    expect(resolveLastTurn(msgs, {}).remove).toEqual([4, 5, 6, 7]);
  });

  it("excludeToolCallId empty string / non-string → never keeps an own unit", () => {
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("REW"), result("REW"),
    ];
    expect(resolveLastTurn(msgs, {}, "").remove).toEqual([4, 5]);
    expect(resolveLastTurn(msgs, {}, 123 as unknown as string).remove).toEqual([4, 5]);
  });

  it("excludeToolCallId matching NO unit → nothing kept (same as absent)", () => {
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u1"), asst("c1"), result("c1"),
    ];
    expect(resolveLastTurn(msgs, {}, "DOES-NOT-EXIST").remove).toEqual([4, 5]);
  });
});

describe("resolveLastTurn — nuclear edge cases", () => {
  it("two user messages, nuclear on the 2nd → removes iLastUser + after (previous prompt remains)", () => {
    // iLastUser=3, iFirstUser=0 (differ) → allowed. remove = [3,4,5].
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), user("u1"), asst("c1"), result("c1")];
    expect(resolveLastTurn(msgs, { to_previous_prompt: true }).remove).toEqual([3, 4, 5]);
  });

  it("three user messages, nuclear → removes only the LAST user + after (earlier users protected by position)", () => {
    // indices: u0=0,a=1,r=2, u3=3,a=4,r=5, u5=6,a=7,r=8. iLastUser=6, iFirstUser=0 (differ) → allowed.
    // nuclear removes [6,7,8]; u0 and u3 survive (protected by position).
    const msgs: MessageLike[] = [
      user("u0"), asst("c0"), result("c0"),
      user("u3"), asst("c1"), result("c1"),
      user("u5"), asst("c2"), result("c2"),
    ];
    expect(resolveLastTurn(msgs, { to_previous_prompt: true }).remove).toEqual([6, 7, 8]);
  });

  it("default is NEVER refused on a single-user list (keeps that user)", () => {
    const msgs: MessageLike[] = [user("only"), asst("c"), result("c")];
    expect(resolveLastTurn(msgs, {}).remove).toEqual([1, 2]); // removes the turn work, keeps the user
  });
});

describe("resolveLastTurn — defensive (NEVER throws — spec/08 E13)", () => {
  it("non-array messages → { remove: [] } (no throw)", () => {
    expect(resolveLastTurn(null as unknown as MessageLike[], {})).toEqual({ remove: [] });
    expect(resolveLastTurn(undefined as unknown as MessageLike[], {})).toEqual({ remove: [] });
    expect(resolveLastTurn("nope" as unknown as MessageLike[], {})).toEqual({ remove: [] });
  });

  it("malformed opts (non-object / missing field) → treated as default (not nuclear)", () => {
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), user("u1"), asst("c1"), result("c1")];
    expect(resolveLastTurn(msgs, "bad" as unknown as { to_previous_prompt?: boolean }).remove).toEqual([4, 5]);
    expect(resolveLastTurn(msgs, { to_previous_prompt: false }).remove).toEqual([4, 5]);
  });

  it("a throwing-Proxy user message is skipped (readOwn swallows) — no throw", () => {
    const trap: MessageLike = new Proxy(
      { role: "user", content: "boom" } as MessageLike,
      new Proxy({}, { get() { throw new Error("trap"); } }),
    );
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), trap];
    expect(() => resolveLastTurn(msgs, {})).not.toThrow();
    // trap reads throw → not seen as a user message → iLastUser stays at 0 → remove = [1,2] (trap at 3 also removed)
    expect(resolveLastTurn(msgs, {}).remove).toEqual([1, 2, 3]);
  });

  it("a throwing-Proxy mulligan message is removed (cannot confirm it is mulligan:*) — no throw, no crash", () => {
    const trap: MessageLike = new Proxy(
      { role: "custom", customType: "mulligan:note", content: "n" } as MessageLike,
      new Proxy({}, { get() { throw new Error("trap"); } }),
    );
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c"), trap];
    expect(() => resolveLastTurn(msgs, {})).not.toThrow();
    expect(resolveLastTurn(msgs, {}).remove).toEqual([1, 2, 3]); // trap unreadable → not exempted → removed
  });
});

describe("resolveLastTurn — purity, ordering, types", () => {
  it("is pure / idempotent — same input → same output, no mutation", () => {
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), user("u1"), asst("c1"), result("c1")];
    const a = resolveLastTurn(msgs, {});
    const b = resolveLastTurn(msgs, {});
    expect(a).toEqual(b);
    expect(JSON.stringify(msgs)).toBe(JSON.stringify(msgs)); // unchanged (no mutation by construction)
  });

  it("remove is ASCENDING (deterministic) for the nuclear case", () => {
    const msgs: MessageLike[] = [user("u0"), asst("c0"), result("c0"), user("u1"), asst("c1"), result("c1")];
    const remove = resolveLastTurn(msgs, { to_previous_prompt: true }).remove;
    const sorted = [...remove].sort((x, y) => x - y);
    expect(remove).toEqual(sorted);
  });

  it("returns { remove: number[] } (the object wrapper, not a bare array or null)", () => {
    expectTypeOf(resolveLastTurn([], {})).toEqualTypeOf<{ remove: number[] }>();
    expectTypeOf(resolveLastTurn([], { to_previous_prompt: true })).toEqualTypeOf<{ remove: number[] }>();
    expectTypeOf(resolveLastTurn([], undefined, "x")).toEqualTypeOf<{ remove: number[] }>();
  });
});

// ── resolveCheckpoint (checkpoint targeting — entry→message mapping; spec/06 §6) ────────────

/** Build a minimal branch entry (SessionEntry-like). */
function entry(id: string, type: BranchEntry["type"], extra: Record<string, unknown> = {}): BranchEntry {
  return { type, id, parentId: null, timestamp: "t", ...extra };
}

/** Build a mulligan:checkpoint LabelEntry pointing at targetId. */
function labelEntry(id: string, targetId: string, name: string): BranchEntry {
  return { type: "label", id, parentId: null, timestamp: "t", targetId, label: `mulligan:checkpoint:${name}` };
}

describe("resolveCheckpoint — spec/06 §6 + mapping + compaction-refuse + defensive + tail-exclusions", () => {
  // NOTE: getBranch() is LEAF→ROOT; we build branchEntries in that order. Each context-producing entry yields
  // exactly 1 message, so messages[k] corresponds 1:1 to the k-th context-producing entry (root→leaf).

  it("(clean) basic mapping — checkpoint mid-branch removes strictly-later work, keeps the point + before", () => {
    // root→leaf context-producing entries → messages (1:1):
    //   e1 user   → msgs[0]
    //   e2 asst   → msgs[1]   ← CHECKPOINT targetId = e2  (iTarget = 1)
    //   e3 result → msgs[2]   ← removed (> iTarget, not excluded)
    //   e4 asst(text) → msgs[3] ← removed
    const msgs: MessageLike[] = [user("u1"), asst("c1"), result("c1"), asstText("junk")];
    // branchEntries LEAF→ROOT (getBranch order):
    const branchEntries: BranchEntry[] = [
      entry("e4", "message"), entry("e3", "message"), labelEntry("eL", "e2", "ckpt"),
      entry("e2", "message"), entry("e1", "message"),
    ];
    const res = resolveCheckpoint(msgs, branchEntries, "ckpt");
    expect(res).not.toBeNull();
    expect(res!.remove).toEqual([2, 3]); // e3(result) + e4(text asst); e2 (the checkpoint) KEPT at idx1
  });

  it("keeps the checkpoint point itself (iTarget never in remove) and everything before", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")]; // idx0 user, idx1 asst, idx2 result
    // checkpoint targets e_asst (idx1). iTarget=1. remove=[2].
    const branch: BranchEntry[] = [
      entry("e_result", "message"), labelEntry("eL", "e_asst", "p"), entry("e_asst", "message"), entry("e_user", "message"),
    ];
    const res = resolveCheckpoint(msgs, branch, "p");
    expect(res!.remove).toEqual([2]);
    expect(res!.remove).not.toContain(1); // checkpoint point kept
    expect(res!.remove).not.toContain(0); // earlier message kept
  });

  it("tail-exclusion: the rewind's own unit (assistant+result issuing excludeToolCallId) survives after iTarget", () => {
    // iTarget = 0 (checkpoint at user). After it: asst(rw)+result(rw) [own unit, KEPT] + asst(text)[removed].
    const msgs: MessageLike[] = [user("u"), asst("rw-call"), result("rw-call"), asstText("bad")];
    const branch: BranchEntry[] = [
      entry("e_text", "message"), entry("e_result", "message"), entry("e_asst_rw", "message"),
      labelEntry("eL", "e_user", "k"), entry("e_user", "message"),
    ];
    const res = resolveCheckpoint(msgs, branch, "k", "rw-call");
    expect(res!.remove).toEqual([3]); // asst(text) removed; the rewind's own unit (idx1,2) KEPT; checkpoint user idx0 kept
    expect(res!.remove).not.toContain(1);
    expect(res!.remove).not.toContain(2);
  });

  it("tail-exclusion: a mulligan:note / mulligan:nudge custom_message after iTarget survives", () => {
    const msgs: MessageLike[] = [user("u"), result("c"), custom("mulligan:note"), custom("mulligan:nudge")];
    // checkpoint at user (idx0). After it: result(idx1, removed), note(idx2 KEPT), nudge(idx3 KEPT).
    const branch: BranchEntry[] = [
      entry("e_nudge", "custom_message"), entry("e_note", "custom_message"), entry("e_result", "message"),
      labelEntry("eL", "e_user", "k"), entry("e_user", "message"),
    ];
    const res = resolveCheckpoint(msgs, branch, "k");
    expect(res!.remove).toEqual([1]); // only the result removed; note + nudge survive
  });

  it("compaction between root and checkpoint → REFUSE (null) — mapping indeterminate (spec/06 §6 / Known Gotcha #1)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
    // root→leaf: compaction, then user, asst, result. checkpoint targets the asst AFTER compaction.
    const branch: BranchEntry[] = [
      entry("e_result", "message"), labelEntry("eL", "e_asst", "k"), entry("e_asst", "message"),
      entry("e_user", "message"), entry("e_comp", "compaction", { summary: "s", firstKeptEntryId: "e_user" }),
    ];
    expect(resolveCheckpoint(msgs, branch, "k")).toBeNull();
  });

  it("compaction AFTER the checkpoint is not walked → mapping succeeds (refuse only fires for compaction in the walked range)", () => {
    // root→leaf: user, asst(ck), result, COMPACTION(leaf). checkpoint targets asst (before compaction) → walk never
    // reaches the compaction entry → mapping OK. iTarget = asst's index; remove = everything after it.
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c"), asstText("post")];
    const branch: BranchEntry[] = [
      entry("e_comp", "compaction", { summary: "s", firstKeptEntryId: "e_result" }),
      entry("e_post", "message"), entry("e_result", "message"), labelEntry("eL", "e_asst", "k"),
      entry("e_asst", "message"), entry("e_user", "message"),
    ];
    const res = resolveCheckpoint(msgs, branch, "k");
    expect(res).not.toBeNull();
    expect(res!.remove).toEqual([2, 3]); // result(idx2) + post-compaction asst(idx3) removed; checkpoint asst(idx1) kept
  });

  it("checkpoint not found on branch → null (spec/08 E10)", () => {
    const branch: BranchEntry[] = [entry("e1", "message"), entry("e2", "message")];
    expect(resolveCheckpoint([user("u")], branch, "nope")).toBeNull();
  });

  it("checkpoint targetId labels a NON-context-producing entry (e.g. a custom marker) → filtered out → null (never guess)", () => {
    const branch: BranchEntry[] = [
      labelEntry("eL", "e_marker", "k"), entry("e_marker", "custom", { customType: "mulligan:rewind", data: {} }),
      entry("e_user", "message"),
    ];
    expect(resolveCheckpoint([user("u")], branch, "k")).toBeNull();
  });

  it("nothing after iTarget → { remove: [] } (determinable-but-empty, NOT null)", () => {
    // checkpoint at the LAST context-producing entry → iTarget = last index → nothing after → remove = [].
    const msgs: MessageLike[] = [user("u"), asst("c")];
    const branch: BranchEntry[] = [
      labelEntry("eL", "e_asst", "k"), entry("e_asst", "message"), entry("e_user", "message"),
    ];
    const res = resolveCheckpoint(msgs, branch, "k");
    expect(res).not.toBeNull();
    expect(res!.remove).toEqual([]);
  });

  it("defensive: non-array messages → null; non-array branchEntries → null; empty checkpointName → null", () => {
    expect(resolveCheckpoint(null as unknown as MessageLike[], [], "k")).toBeNull();
    expect(resolveCheckpoint([], null as unknown as BranchEntry[], "k")).toBeNull();
    expect(resolveCheckpoint([], [], "")).toBeNull();
    // "   " is a non-empty string → NOT auto-refused by the guard (guard is non-EMPTY, not non-blank); it simply
    // won't match a label → null via not-found.
    expect(resolveCheckpoint([], [], "   ")).toBeNull();
  });

  it("excludeToolCallId absent/empty/non-string → rewind's own unit NOT kept (removed with the rest); note still survives", () => {
    const msgs: MessageLike[] = [user("u"), asst("rw-call"), result("rw-call"), custom("mulligan:note")];
    const branch: BranchEntry[] = [
      entry("e_note", "custom_message"), entry("e_result", "message"), entry("e_asst", "message"),
      labelEntry("eL", "e_user", "k"), entry("e_user", "message"),
    ];
    // No excludeToolCallId → the asst(rw)+result are NOT protected → removed. note survives.
    expect(resolveCheckpoint(msgs, branch, "k")!.remove).toEqual([1, 2]);
    expect(resolveCheckpoint(msgs, branch, "k", "")!.remove).toEqual([1, 2]); // empty → not kept
  });

  it("never throws on throwing-Proxy messages/entries (E13 — context-handler hot path)", () => {
    const throwingMsg = new Proxy({}, { get() { throw new Error("trap"); } });
    const throwingEntry = new Proxy({}, { get() { throw new Error("trap"); } }) as unknown as BranchEntry;
    // No assertion value — just that it returns null (or an object) WITHOUT throwing.
    expect(() => resolveCheckpoint([throwingMsg as unknown as MessageLike], [throwingEntry], "k")).not.toThrow();
  });

  it("returns { remove: number[] } | null (the exact union, never a bare array)", () => {
    expectTypeOf(resolveCheckpoint([], [], "x")).toEqualTypeOf<{ remove: number[] } | null>();
    const ok = resolveCheckpoint([user("u")], [labelEntry("eL", "e1", "x"), entry("e1", "message")], "x");
    expectTypeOf(ok).toEqualTypeOf<{ remove: number[] } | null>();
  });
});

describe("applyRewind — spec/10 §1.4 PINNED contract + defensive + composition", () => {
  it("empty remove → input UNCHANGED — SAME reference (idempotent; applyShrink §5:133 precedent)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
    // Intentional strengthening: spec says "input unchanged" (content); same-ref is the strict reading + convention.
    expect(applyRewind(msgs, [])).toBe(msgs);
  });

  it("basic removal + gap-close: drop middle indices → contiguous result, no holes, elements renumbered", () => {
    const msgs: MessageLike[] = [user("u0"), asst("c1"), result("c1"), user("u1"), asstText("x")];
    // remove indices 1,2 (an asst+result toolGroup) → survivors [u0, u1, asstText] shift into 0,1,2 (gap closed).
    const out = applyRewind(msgs, [1, 2]);
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.role)).toEqual(["user", "user", "assistant"]);
    expect(out[0]).toBe(msgs[0]); // u0 preserved
    expect(out[1]).toBe(msgs[3]); // u1 shifted into index 1 (gap closed)
    expect(out[2]).toBe(msgs[4]); // asstText shifted into index 2 (gap closed)
  });

  it("spec/10 §1.4 bullet 1 — removing a toolGroup unit keeps pairing intact (no orphan results/calls)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c1"), result("c1"), asst("c2"), result("c2"), asstText("tail")];
    // Partition → toolGroup{1,2}, toolGroup{3,4}, plain{0}, plain{5}. Remove the FIRST toolGroup (its indices).
    const units = partitionIntoUnits(msgs);
    const firstToolGroup = units.find((u) => u.kind === "toolGroup")!;
    const out = applyRewind(msgs, firstToolGroup.indices);
    // Re-partition the result + assert NO orphan: every remaining toolResult has a matching assistant & vice versa.
    expectPairingInvariant(out, partitionIntoUnits(out));
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "assistant"]); // 2nd toolGroup + tail survive
  });

  it("spec/10 §1.4 bullet 2 — removing last_turn keeps the rewind's OWN unit + mulligan notes at the tail (composition)", () => {
    // [user(u1), asst(grep), result(grep), mulligan:note, asst(rewind), result(rewind)]
    // resolveLastTurn default (exclude the rewind's call) → remove the grep toolGroup (idx 1,2); KEEP the note
    // (idx3) + the rewind's own unit (idx4,5). applyRewind closes the gap → tail keeps note + own unit.
    const exclude = "rewind-call";
    const msgs: MessageLike[] = [
      user("u1"), asst("grep"), result("grep"), custom("mulligan:note"), asst(exclude), result(exclude),
    ];
    const { remove } = resolveLastTurn(msgs, {}, exclude);
    expect(remove).toEqual([1, 2]); // the resolver computed a UNIT-AWARE removal (DERIVED by simulation — NOT copied from spec/06 §11)
    const out = applyRewind(msgs, remove);
    expect(out.map((m) => m.role)).toEqual(["user", "custom", "assistant", "toolResult"]); // tail = [user] + [note] + [rewind asst + result]
    expect((out[1] as MessageLike).customType).toBe("mulligan:note"); // the note survived
    expect(out[2]).toBe(msgs[4]); // the rewind's OWN assistant survived
    expect(out[3]).toBe(msgs[5]); // the rewind's OWN result survived
    expectPairingInvariant(out, partitionIntoUnits(out)); // no orphans
  });

  it("defensive: non-array messages → [] (mirrors partitionIntoUnits)", () => {
    expect(applyRewind(null as unknown as MessageLike[], [1])).toEqual([]);
    expect(applyRewind(undefined as unknown as MessageLike[], [0])).toEqual([]);
  });

  it("defensive: non-array remove → messages UNCHANGED (same reference, treated as no removal)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
    expect(applyRewind(msgs, null as unknown as number[])).toBe(msgs);
    expect(applyRewind(msgs, undefined as unknown as number[])).toBe(msgs);
  });

  it("defensive: out-of-range / negative / non-number / duplicate indices in remove are HARMLESS", () => {
    const msgs: MessageLike[] = [user("a"), user("b"), user("c")];
    // remove=[1, 1, 99, -3, NaN, "x"] → only index 1 is a valid match → [a, c].
    expect(applyRewind(msgs, [1, 1, 99, -3, NaN, "x" as unknown as number])).toEqual([msgs[0], msgs[2]]);
    // remove with NO valid numbers → unchanged (same reference).
    expect(applyRewind(msgs, [NaN, "y" as unknown as number])).toBe(msgs);
  });

  it("spec/08 E13 — NEVER throws: a throwing-Proxy element is never read (the filter callback ignores the element)", () => {
    const trap: MessageLike = new Proxy(
      { role: "user", content: "x" } as MessageLike,
      new Proxy({}, { get() { throw new Error("trap"); } }),
    );
    const msgs: MessageLike[] = [user("keep"), trap, user("also")];
    // Removing index 1 (the trap) must not crash: filter never reads the trap's properties.
    expect(() => applyRewind(msgs, [1])).not.toThrow();
    expect(applyRewind(msgs, [1])).toHaveLength(2);
    // Keeping the trap (removing a DIFFERENT index) must not crash either — the trap element is only copied by
    // reference into the result array, never introspected.
    expect(() => applyRewind(msgs, [0])).not.toThrow();
    expect(applyRewind(msgs, [0])).toHaveLength(2);
  });

  it("spec/10 §3 — monotonic shrinkage: result.length <= messages.length for any remove", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c"), asstText("t")];
    expect(applyRewind(msgs, []).length).toBeLessThanOrEqual(msgs.length);
    expect(applyRewind(msgs, [1, 2]).length).toBeLessThanOrEqual(msgs.length);
    expect(applyRewind(msgs, [0, 1, 2, 3]).length).toBeLessThanOrEqual(msgs.length);
  });

  it("purity: never mutates the input array (filter returns a new array; empty path returns the same unmuted ref)", () => {
    const msgs: MessageLike[] = [user("u"), asst("c"), result("c")];
    const snapshot = [...msgs];
    applyRewind(msgs, [1]);
    applyRewind(msgs, []);
    expect(msgs).toEqual(snapshot); // input untouched
    expect(msgs).toHaveLength(3);
  });

  it("returns MessageLike[] (the array type, not null/wrapped)", () => {
    expectTypeOf(applyRewind([], [])).toEqualTypeOf<MessageLike[]>();
    expectTypeOf(applyRewind([user("u")], [0])).toEqualTypeOf<MessageLike[]>();
  });
});