/**
 * banner.test.ts — unit tests for `reconcileBanner` (src/banner.ts): the SINGLE writer of the
 * `mulligan:active-checkpoint` above-editor widget (spec/13 §5; spec/08 E26).
 *
 * THIS IS THE OPPOSITE OF commands.test.ts (GOTCHA #1 / Anti-Pattern #1):
 *   - commands.test.ts `vi.mock("../src/banner.js")` and asserts the `vi.mocked(reconcileBanner)` SPY.
 *   - banner.test.ts does NOT mock banner.js. It imports the REAL `reconcileBanner`, calls it with a
 *     hand-rolled fake `ctx`, and asserts on the captured `widgets[]`.
 *
 * The fake ctx is modeled on commands.test.ts's makeCtx (GOTCHA — hasUI + ui.setWidget +
 * sessionManager.getEntries are the ONLY fields reconcileBanner reads). The reset idiom (clearAll +
 * setConfig(undefined) → DEFAULT_CONFIG) is mirrored from commands.test.ts.
 *
 * Coverage — the PRP's contract (a)-(f) + never-throws guard:
 *   (a) SET (≥1 active) → setWidget(key, [line(name)], {placement:"aboveEditor"}).
 *   (b) revoke/consume (0 active) → setWidget(key, undefined).
 *   (c) knob ui.activeCheckpointBanner=false → setWidget(key, undefined) EVEN with an active checkpoint.
 *   (d) hasUI=false → NO setWidget call (no-op).
 *   (f) multiple active → multiple lines, one per checkpoint, in listCheckpoints order.
 *   never-throws: a throwing ui.setWidget / getEntries is swallowed (reconcileBanner is on every-context fire).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { reconcileBanner } from "../src/banner.js";
import { setConfig } from "../src/config.js";
import { clearAll } from "../src/runtime.js";

// ── reset (mirror commands.test.ts) ─────────────────────────────────────────
// clearAll() + setConfig(undefined) → DEFAULT_CONFIG (enabled:true, ui.activeCheckpointBanner:true) so a
// prior knob-off / disabled test never bleeds. This is module state the SUT reads via getConfig().
beforeEach(() => {
  clearAll();
  setConfig(undefined);
});
afterEach(() => {
  clearAll();
  setConfig(undefined);
});

// ── shared literals (avoid drift; copied byte-exact from src/banner.ts) ─────
// GOTCHA #2: BANNER_WIDGET_KEY is module-PRIVATE in banner.ts (NOT exported) → use the string literal.
const BANNER_KEY = "mulligan:active-checkpoint";

// GOTCHA #3: the banner line uses the emoji '⚠' (U+26A0) and is byte-exact. Copied from src/banner.ts.
const line = (name: string) =>
  `⚠ Mulligan checkpoint active: "${name}" (you set it). The agent may rewind across your subsequent prompts back to this point. Revoke: /mulligan_checkpoint_revoke ${name}`;

// GOTCHA #6 / Anti-Pattern #6: listCheckpoints needs {type:"label", targetId:<non-empty>, label:"mulligan:checkpoint:<name>"}.
// A CLEAR entry (same targetId, label:undefined) simulates consumption/revocation (latest-wins).
const SET_ENTRY = (id: string, name: string): Record<string, unknown> => ({
  type: "label",
  targetId: id,
  label: `mulligan:checkpoint:${name}`,
});
const CLEAR_ENTRY = (id: string): Record<string, unknown> => ({
  type: "label",
  targetId: id,
  label: undefined,
});

// ── fakes (hand-rolled; modeled on commands.test.ts makeCtx) ────────────────
/**
 * A minimal fake ExtensionContext capturing every `ctx.ui.setWidget` call. `reconcileBanner` reads ONLY
 * `ctx.hasUI`, `ctx.ui.setWidget`, and `ctx.sessionManager.getEntries` — that is the full surface this
 * helper provides (see banner.ts SUT).
 */
function makeBannerCtx(opts: { hasUI?: boolean; entries?: unknown[] } = {}) {
  const widgets: { key: string; content: unknown; options?: unknown }[] = [];
  const ctx = {
    hasUI: opts.hasUI ?? true,
    ui: {
      setWidget(key: string, content: unknown, options?: unknown) {
        widgets.push({ key, content, options });
      },
    },
    sessionManager: {
      getEntries() {
        return opts.entries ?? [];
      },
    },
  };
  return { widgets, ctx: ctx as unknown as ExtensionContext };
}

// ── the SUT ─────────────────────────────────────────────────────────────────

describe("reconcileBanner — spec/13 §5 / spec/08 E26", () => {
  it("(a) SET (≥1 active) → setWidget(key, [line(name)], {placement:'aboveEditor'})", () => {
    const { widgets, ctx } = makeBannerCtx({ entries: [SET_ENTRY("leaf-1", "before-refactor")] });

    reconcileBanner(ctx);

    expect(widgets).toHaveLength(1);
    // GOTCHA #4: SET calls pass THREE args → options:{placement:"aboveEditor"}.
    expect(widgets[0]).toEqual({
      key: BANNER_KEY,
      content: [line("before-refactor")],
      options: { placement: "aboveEditor" },
    });
  });

  it("(b) after revoke/consumption (0 active checkpoints) → setWidget(key, undefined)", () => {
    // An empty entries array yields 0 active checkpoints (branch c in banner.ts).
    const { widgets, ctx } = makeBannerCtx({ entries: [] });

    reconcileBanner(ctx);

    // GOTCHA #4 / Anti-Pattern #5: CLEAR passes only (key, undefined) — 2 args, options undefined.
    expect(widgets).toEqual([{ key: BANNER_KEY, content: undefined, options: undefined }]);
  });

  it("(b-alt) a consumed checkpoint (same targetId cleared later) → setWidget(key, undefined)", () => {
    // listCheckpoints latest-wins: a later CLEAR entry over the same targetId removes the checkpoint.
    const { widgets, ctx } = makeBannerCtx({
      entries: [SET_ENTRY("leaf-1", "x"), CLEAR_ENTRY("leaf-1")],
    });

    reconcileBanner(ctx);

    expect(widgets).toEqual([{ key: BANNER_KEY, content: undefined, options: undefined }]);
  });

  it("(c) knob ui.activeCheckpointBanner=false → setWidget(key, undefined) EVEN with an active checkpoint", () => {
    // setConfig DEEP-MERGES a partial over DEFAULT_CONFIG (config.ts validateConfig), so a partial with
    // ui.activeCheckpointBanner:false is enough to flip just that knob.
    setConfig({ ui: { activeCheckpointBanner: false } });
    const { widgets, ctx } = makeBannerCtx({ entries: [SET_ENTRY("leaf-1", "x")] });

    reconcileBanner(ctx);

    // Knob off → CLEAR even though a checkpoint is active (a prior-turn banner must disappear).
    expect(widgets).toEqual([{ key: BANNER_KEY, content: undefined, options: undefined }]);
  });

  it("(d) hasUI=false → NO setWidget call (no-op)", () => {
    const { widgets, ctx } = makeBannerCtx({ hasUI: false, entries: [SET_ENTRY("leaf-1", "x")] });

    reconcileBanner(ctx);

    // (a) in banner.ts: !ctx.hasUI → return before touching ui.setWidget.
    expect(widgets).toHaveLength(0);
  });

  it("(f) multiple active → multiple lines, one per checkpoint, in listCheckpoints order", () => {
    const { widgets, ctx } = makeBannerCtx({
      entries: [SET_ENTRY("leaf-1", "alpha"), SET_ENTRY("leaf-2", "beta")],
    });

    reconcileBanner(ctx);

    // One setWidget call; content is an array of lines in FIRST-OCCURRENCE order (listCheckpoints).
    expect(widgets).toHaveLength(1);
    expect(widgets[0].content).toEqual([line("alpha"), line("beta")]);
    expect(widgets[0].options).toEqual({ placement: "aboveEditor" });
  });

  it("never throws — a throwing ui.setWidget is swallowed (spec/13 §5, hot path)", () => {
    // reconcileBanner is on EVERY context fire; a throw there would break every turn. Force a throw inside
    // the SET branch and assert it is swallowed (whole-body try/catch in banner.ts).
    const boomCtx = {
      hasUI: true,
      ui: {
        setWidget() {
          throw new Error("setWidget boom");
        },
      },
      sessionManager: {
        getEntries: () => [SET_ENTRY("l", "x")],
      },
    } as unknown as ExtensionContext;

    expect(() => reconcileBanner(boomCtx)).not.toThrow();
  });

  it("never throws — a throwing sessionManager.getEntries is swallowed", () => {
    const boomCtx = {
      hasUI: true,
      ui: {
        setWidget() {
          /* never reached: getEntries throws first */
        },
      },
      sessionManager: {
        getEntries: () => {
          throw new Error("getEntries boom");
        },
      },
    } as unknown as ExtensionContext;

    expect(() => reconcileBanner(boomCtx)).not.toThrow();
  });
});