// @ts-check
import { describe, it, expect } from "vitest";
import { filterPaletteItems, movePaletteIndex } from "../../ui/utils/command-palette.ts";

const noop = () => {};
const items = [
  { id: "a", group: "Actions", label: "New Terminal", icon: "mdi-console", run: noop },
  { id: "b", group: "Tabs", label: "any-console | main", icon: "mdi-tab", run: noop },
  { id: "c", group: "Jobs", label: "any-console | Build", icon: "mdi-play", run: noop },
];

describe("filterPaletteItems", () => {
  it("returns all items for an empty or blank query", () => {
    expect(filterPaletteItems(items, "")).toEqual(items);
    expect(filterPaletteItems(items, "   ")).toEqual(items);
  });

  it("matches case-insensitively", () => {
    expect(filterPaletteItems(items, "NEW term").map((i) => i.id)).toEqual(["a"]);
  });

  it("requires every whitespace-separated word to match", () => {
    expect(filterPaletteItems(items, "console build").map((i) => i.id)).toEqual(["c"]);
    expect(filterPaletteItems(items, "console nothing")).toEqual([]);
  });

  it("matches the group name", () => {
    expect(filterPaletteItems(items, "tabs").map((i) => i.id)).toEqual(["b"]);
  });
});

describe("movePaletteIndex", () => {
  it("moves within range", () => {
    expect(movePaletteIndex(0, 1, 3)).toBe(1);
    expect(movePaletteIndex(2, -1, 3)).toBe(1);
  });

  it("wraps around at both ends", () => {
    expect(movePaletteIndex(2, 1, 3)).toBe(0);
    expect(movePaletteIndex(0, -1, 3)).toBe(2);
  });

  it("returns 0 when there are no items", () => {
    expect(movePaletteIndex(0, 1, 0)).toBe(0);
  });
});
