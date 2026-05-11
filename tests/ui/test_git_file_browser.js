// @ts-check
import { describe, it, expect } from "vitest";
import { FILE_EXT_MAP, getFileIcon, getHighlightLang, getHighlightKeyFromPath, formatFileSize } from "../../ui/utils/file-browser.js";

// ── Tests ──

describe("getFileIcon", () => {
  it("returns JS icon for .js files", () => {
    const result = getFileIcon("app.js");
    expect(result.icon).toBe("mdi-language-javascript");
    expect(result.color).toBe("#f7df1e");
  });

  it("returns Python icon for .py files", () => {
    const result = getFileIcon("main.py");
    expect(result.icon).toBe("mdi-language-python");
  });

  it("returns default icon for unknown extension", () => {
    const result = getFileIcon("file.xyz");
    expect(result.icon).toBe("mdi-file-outline");
    expect(result.color).toBe("");
  });

  it("returns default icon for extension with null icon", () => {
    const result = getFileIcon("script.pyw");
    expect(result.icon).toBe("mdi-file-outline");
  });

  it("handles dotless filenames (e.g. Dockerfile)", () => {
    const result = getFileIcon("Dockerfile");
    expect(result.icon).toBe("mdi-docker");
  });

  it("handles case-insensitive matching via lowercase extension", () => {
    const result = getFileIcon("app.JS");
    expect(result.icon).toBe("mdi-language-javascript");
  });

  it("uses last dot for multi-dot filenames", () => {
    const result = getFileIcon("archive.tar.gz");
    expect(result.icon).toBe("mdi-file-outline");
  });

  it("returns image icon for .png", () => {
    const result = getFileIcon("photo.png");
    expect(result.icon).toBe("mdi-file-image");
  });
});

describe("getHighlightLang", () => {
  it("returns 'javascript' for js", () => {
    expect(getHighlightLang("js")).toBe("javascript");
  });

  it("returns 'python' for py", () => {
    expect(getHighlightLang("py")).toBe("python");
  });

  it("returns 'xml' for html", () => {
    expect(getHighlightLang("html")).toBe("xml");
  });

  it("returns null for unknown extension", () => {
    expect(getHighlightLang("xyz")).toBe(null);
  });

  it("returns null for extension without lang", () => {
    expect(getHighlightLang("gitignore")).toBe(null);
  });

  it("returns 'python' for pyw (icon is null but lang exists)", () => {
    expect(getHighlightLang("pyw")).toBe("python");
  });
});

describe("getHighlightKeyFromPath", () => {
  it("extracts extension from simple filename", () => {
    expect(getHighlightKeyFromPath("app.js")).toBe("js");
  });

  it("extracts extension from full path", () => {
    expect(getHighlightKeyFromPath("src/components/App.tsx")).toBe("tsx");
  });

  it("returns lowercase extension", () => {
    expect(getHighlightKeyFromPath("FILE.PY")).toBe("py");
  });

  it("returns full name for dotless file", () => {
    expect(getHighlightKeyFromPath("Makefile")).toBe("makefile");
  });

  it("returns full lowercase name for dotless path", () => {
    expect(getHighlightKeyFromPath("src/Dockerfile")).toBe("dockerfile");
  });

  it("returns empty string for empty input", () => {
    expect(getHighlightKeyFromPath("")).toBe("");
  });

  it("returns empty string for null", () => {
    expect(getHighlightKeyFromPath(null)).toBe("");
  });

  it("uses last dot for multi-dot filenames", () => {
    expect(getHighlightKeyFromPath("data.test.json")).toBe("json");
  });
});

describe("formatFileSize", () => {
  it("returns empty for null", () => {
    expect(formatFileSize(null)).toBe("");
  });

  it("returns empty for undefined", () => {
    expect(formatFileSize(undefined)).toBe("");
  });

  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats 0 bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });

  it("formats 1 KB boundary", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1048576)).toBe("1.0 MB");
  });

  it("formats fractional KB", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("formats large MB", () => {
    const result = formatFileSize(5 * 1024 * 1024 + 512 * 1024);
    expect(result).toBe("5.5 MB");
  });
});
