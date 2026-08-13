// @ts-check
import { describe, it, expect } from "vitest";
import { extractPlaceholders } from "../../ui/utils/placeholders.ts";

describe("extractPlaceholders", () => {
  it("returns [] for empty/blank input", () => {
    expect(extractPlaceholders("")).toEqual([]);
    expect(extractPlaceholders(null)).toEqual([]);
    expect(extractPlaceholders(undefined)).toEqual([]);
    expect(extractPlaceholders("no placeholders here")).toEqual([]);
  });

  it("extracts a single placeholder name", () => {
    expect(extractPlaceholders("claude [[prompt]]")).toEqual(["prompt"]);
  });

  it("extracts multiple names in order", () => {
    expect(extractPlaceholders("run [[a]] --to [[b]]")).toEqual(["a", "b"]);
  });

  it("dedupes repeated names but keeps first-seen order", () => {
    expect(extractPlaceholders("[[x]] [[y]] [[x]]")).toEqual(["x", "y"]);
  });

  it("tolerates inner whitespace", () => {
    expect(extractPlaceholders("claude [[  prompt  ]]")).toEqual(["prompt"]);
  });

  it("ignores tokens with invalid characters", () => {
    expect(extractPlaceholders("echo [[ a-b ]] [[c.d]]")).toEqual([]);
  });

  it("is repeatable (regex lastIndex reset)", () => {
    const cmd = "x [[p]]";
    expect(extractPlaceholders(cmd)).toEqual(["p"]);
    expect(extractPlaceholders(cmd)).toEqual(["p"]);
  });

  it("ignores placeholders on comment lines", () => {
    expect(extractPlaceholders("# [[ignored]]")).toEqual([]);
    expect(extractPlaceholders("  # [[also_ignored]]")).toEqual([]);
    expect(extractPlaceholders("# [[skip]]\nclaude [[prompt]]")).toEqual(["prompt"]);
  });
});
