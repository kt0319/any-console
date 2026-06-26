// @ts-check
import { describe, it, expect } from "vitest";
import { filterIcons, buildIconGridModel } from "../../ui/utils/icon-grid.js";

describe("filterIcons", () => {
  it("returns all icons for an empty query", () => {
    const icons = ["home", "account", "cog"];
    expect(filterIcons(icons, "")).toBe(icons);
  });

  it("filters by substring match", () => {
    expect(filterIcons(["home", "home-outline", "cog"], "home")).toEqual([
      "home",
      "home-outline",
    ]);
  });

  it("returns empty array when nothing matches", () => {
    expect(filterIcons(["home", "cog"], "zzz")).toEqual([]);
  });
});

describe("buildIconGridModel", () => {
  it("returns all items and zero remaining when under the limit", () => {
    const model = buildIconGridModel(["a", "b"], "", 200);
    expect(model.items).toEqual(["a", "b"]);
    expect(model.remaining).toBe(0);
  });

  it("truncates to maxDisplay and reports the remaining count", () => {
    const icons = Array.from({ length: 250 }, (_, i) => `icon-${i}`);
    const model = buildIconGridModel(icons, "", 200);
    expect(model.items).toHaveLength(200);
    expect(model.remaining).toBe(50);
  });

  it("applies the query before slicing", () => {
    const icons = ["home", "home-outline", "cog", "account"];
    const model = buildIconGridModel(icons, "home", 1);
    expect(model.items).toEqual(["home"]);
    expect(model.remaining).toBe(1);
  });

  it("never reports negative remaining", () => {
    const model = buildIconGridModel(["a"], "", 200);
    expect(model.remaining).toBe(0);
  });
});
