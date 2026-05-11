// @ts-check
import { describe, it, expect } from "vitest";
import { renderFileIcon, renderFileIconFromPath } from "../../ui/utils/file-icon.js";

describe("renderFileIcon", () => {
  it("returns a directory icon for dir entries", () => {
    const html = renderFileIcon({ type: "dir", name: "src" });
    expect(html).toContain("<span style=\"color:");
  });

  it("returns a symlink icon for symlink entries", () => {
    const symlinkHtml = renderFileIcon({ type: "symlink", name: "link" });
    expect(symlinkHtml).toContain("color:#7aa2f7");
  });

  it("falls back to renderFileIconFromPath for files", () => {
    const fileHtml = renderFileIcon({ type: "file", name: "main.js" });
    expect(fileHtml).toContain("#f1e05a");
  });

  it("handles missing entry safely", () => {
    expect(renderFileIcon(undefined)).toContain("<span");
  });
});

describe("renderFileIconFromPath", () => {
  it("matches known filename map (README.md)", () => {
    expect(renderFileIconFromPath("docs/README.md")).toContain("#083fa1");
  });

  it("matches name without dot (LICENSE)", () => {
    expect(renderFileIconFromPath("LICENSE")).toContain("#d4aa00");
  });

  it("matches by extension lowercase", () => {
    expect(renderFileIconFromPath("App.TS")).toContain("#3178c6");
  });

  it("falls back to default icon for unknown extensions", () => {
    const html = renderFileIconFromPath("strange.unknown-ext");
    expect(html).toContain("#6d8086");
  });

  it("matches dockerfile by extension", () => {
    expect(renderFileIconFromPath("Containerfile.dockerfile")).toContain("#2496ed");
  });

  it("returns default icon for empty path", () => {
    expect(renderFileIconFromPath("")).toContain("#6d8086");
  });
});
