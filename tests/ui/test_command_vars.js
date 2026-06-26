// @ts-check
import { describe, it, expect, vi } from "vitest";
import { collectCommandVars } from "../../ui/utils/command-vars.js";

describe("collectCommandVars", () => {
  it("returns empty object when there are no placeholders", async () => {
    const prompt = vi.fn();
    const result = await collectCommandVars("echo hello", prompt);
    expect(result).toEqual({});
    expect(prompt).not.toHaveBeenCalled();
  });

  it("prompts once per unique placeholder in order and collects values", async () => {
    const prompt = vi.fn()
      .mockResolvedValueOnce("main")
      .mockResolvedValueOnce("v2");
    const result = await collectCommandVars("deploy [[branch]] [[tag]]", prompt);
    expect(result).toEqual({ branch: "main", tag: "v2" });
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[0][0]).toMatchObject({ title: "Enter branch", placeholder: "branch", confirmLabel: "Run" });
    expect(prompt.mock.calls[1][0]).toMatchObject({ title: "Enter tag", placeholder: "tag" });
  });

  it("returns null and stops when a prompt is cancelled (null)", async () => {
    const prompt = vi.fn()
      .mockResolvedValueOnce("main")
      .mockResolvedValueOnce(null);
    const result = await collectCommandVars("deploy [[branch]] [[tag]]", prompt);
    expect(result).toBeNull();
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("treats undefined as cancellation too", async () => {
    const prompt = vi.fn().mockResolvedValueOnce(undefined);
    const result = await collectCommandVars("run [[x]]", prompt);
    expect(result).toBeNull();
  });

  it("accepts empty-string values as valid input", async () => {
    const prompt = vi.fn().mockResolvedValueOnce("");
    const result = await collectCommandVars("run [[x]]", prompt);
    expect(result).toEqual({ x: "" });
  });
});
