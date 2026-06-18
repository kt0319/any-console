// @ts-check
import { describe, it, expect } from "vitest";
import {
  RADIAL_KEY_PRESETS,
  RADIAL_SPECIAL_PRESETS,
  RADIAL_DIRECTION_LABELS,
  RADIAL_CORNER_LABELS,
  DEFAULT_RADIAL_KEYS,
  DEFAULT_RADIAL_SPECIALS,
  findKeyPreset,
  findSpecialPreset,
  defaultKeyDefs,
  defaultSpecialDefs,
} from "../../ui/utils/radial-key-presets.js";

describe("RADIAL_*_PRESETS metadata", () => {
  it("has 8 direction labels", () => {
    expect(RADIAL_DIRECTION_LABELS).toHaveLength(8);
  });

  it("has 4 corner labels", () => {
    expect(RADIAL_CORNER_LABELS).toHaveLength(4);
  });

  it("default key list matches direction count", () => {
    expect(DEFAULT_RADIAL_KEYS).toHaveLength(8);
  });

  it("default special list matches corner count", () => {
    expect(DEFAULT_RADIAL_SPECIALS).toHaveLength(4);
  });

  it("every default key id resolves to a preset", () => {
    for (const id of DEFAULT_RADIAL_KEYS) {
      expect(findKeyPreset(id)).not.toBeNull();
    }
  });

  it("every default special id resolves to a preset", () => {
    for (const id of DEFAULT_RADIAL_SPECIALS) {
      expect(findSpecialPreset(id)).not.toBeNull();
    }
  });
});

describe("findKeyPreset / findSpecialPreset", () => {
  it("returns null for unknown id", () => {
    expect(findKeyPreset("no-such")).toBeNull();
    expect(findSpecialPreset("no-such")).toBeNull();
  });

  it("returns matching preset", () => {
    const up = findKeyPreset("up");
    expect(up?.keyDef.key).toBe("ArrowUp");
    const selcopy = findSpecialPreset("selcopy");
    expect(selcopy?.action).toBe("selection:open");
  });
});

describe("defaultKeyDefs / defaultSpecialDefs", () => {
  it("returns 8 normalized key entries with ctrl/shift booleans", () => {
    const defs = defaultKeyDefs();
    expect(defs).toHaveLength(8);
    for (const d of defs) {
      expect(typeof d.key).toBe("string");
      expect(typeof d.ctrl).toBe("boolean");
      expect(typeof d.shift).toBe("boolean");
      expect(typeof d.label).toBe("string");
    }
  });

  it("Ctrl+C entry has ctrl=true", () => {
    const defs = defaultKeyDefs();
    const ctrlc = defs.find((d) => d.key === "c" && d.ctrl);
    expect(ctrlc).toBeTruthy();
  });

  it("returns 4 normalized special entries", () => {
    const defs = defaultSpecialDefs();
    expect(defs).toHaveLength(4);
    for (const d of defs) {
      expect(typeof d.label).toBe("string");
      expect(typeof d.action).toBe("string");
    }
  });
});

describe("RADIAL_KEY_PRESETS entries", () => {
  it("each entry has key/label/keyDef.key", () => {
    for (const p of RADIAL_KEY_PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(typeof p.keyDef.key).toBe("string");
    }
  });
});

describe("RADIAL_SPECIAL_PRESETS entries", () => {
  it("each entry has id/label/action", () => {
    for (const p of RADIAL_SPECIAL_PRESETS) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(typeof p.action).toBe("string");
    }
  });
});
