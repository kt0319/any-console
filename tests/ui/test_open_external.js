// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";
import { openExternalUrl } from "../../ui/utils/open-external.js";

describe("openExternalUrl", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does nothing when url is empty", () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");
    openExternalUrl("");
    expect(appendSpy).not.toHaveBeenCalled();
    appendSpy.mockRestore();
  });

  it("does nothing when url is null", () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");
    openExternalUrl(null);
    expect(appendSpy).not.toHaveBeenCalled();
    appendSpy.mockRestore();
  });

  it("creates an anchor with target _blank and triggers click", () => {
    let clicked = null;
    const origCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === "a") {
        el.click = vi.fn(() => { clicked = el; });
      }
      return el;
    });
    openExternalUrl("https://example.com/");
    expect(clicked).not.toBeNull();
    expect(clicked.href).toBe("https://example.com/");
    expect(clicked.target).toBe("_blank");
    expect(clicked.rel).toBe("external noopener noreferrer");
    expect(document.body.contains(clicked)).toBe(false);
    createSpy.mockRestore();
  });
});
