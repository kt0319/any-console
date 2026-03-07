// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inline copies of pure functions from git-file-browser.js ──

const FILE_EXT_MAP = {
  js: { icon: "mdi-language-javascript", color: "#f7df1e", lang: "javascript" },
  mjs: { icon: "mdi-language-javascript", color: "#f7df1e", lang: "javascript" },
  cjs: { icon: "mdi-language-javascript", color: "#f7df1e", lang: "javascript" },
  ts: { icon: "mdi-language-typescript", color: "#3178c6", lang: "typescript" },
  tsx: { icon: "mdi-language-typescript", color: "#3178c6", lang: "typescript" },
  jsx: { icon: "mdi-react", color: "#61dafb", lang: "javascript" },
  py: { icon: "mdi-language-python", color: "#3776ab", lang: "python" },
  pyw: { icon: null, color: null, lang: "python" },
  html: { icon: "mdi-language-html5", color: "#e34f26", lang: "xml" },
  css: { icon: "mdi-language-css3", color: "#1572b6", lang: "css" },
  json: { icon: "mdi-code-json", color: "#f7df1e", lang: "json" },
  md: { icon: "mdi-language-markdown", color: "#83b5d3", lang: "markdown" },
  sh: { icon: "mdi-console", color: "#89e051", lang: "bash" },
  dockerfile: { icon: "mdi-docker", color: "#2496ed", lang: "dockerfile" },
  makefile: { icon: null, color: null, lang: "makefile" },
  gitignore: { icon: "mdi-git", color: "#f05032" },
  png: { icon: "mdi-file-image", color: "#a074c4" },
  pdf: { icon: "mdi-file-pdf-box", color: "#e5252a" },
};

function getFileIcon(name) {
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx > 0 ? name.slice(dotIdx + 1).toLowerCase() : name.toLowerCase();
  const entry = FILE_EXT_MAP[ext];
  if (!entry || !entry.icon) return { icon: "mdi-file-outline", color: "" };
  return { icon: entry.icon, color: entry.color || "" };
}

function getHighlightLang(ext) {
  return FILE_EXT_MAP[ext]?.lang || null;
}

function getHighlightKeyFromPath(path) {
  const name = (path || "").split("/").pop().toLowerCase();
  const dotIdx = name.lastIndexOf(".");
  return dotIdx > 0 ? name.slice(dotIdx + 1) : name;
}

function formatFileSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Tests ──

describe("getFileIcon", () => {
  it("returns JS icon for .js files", () => {
    const result = getFileIcon("app.js");
    assert.equal(result.icon, "mdi-language-javascript");
    assert.equal(result.color, "#f7df1e");
  });

  it("returns Python icon for .py files", () => {
    const result = getFileIcon("main.py");
    assert.equal(result.icon, "mdi-language-python");
  });

  it("returns default icon for unknown extension", () => {
    const result = getFileIcon("file.xyz");
    assert.equal(result.icon, "mdi-file-outline");
    assert.equal(result.color, "");
  });

  it("returns default icon for extension with null icon", () => {
    const result = getFileIcon("script.pyw");
    assert.equal(result.icon, "mdi-file-outline");
  });

  it("handles dotless filenames (e.g. Dockerfile)", () => {
    const result = getFileIcon("Dockerfile");
    assert.equal(result.icon, "mdi-docker");
  });

  it("handles case-insensitive matching via lowercase extension", () => {
    const result = getFileIcon("app.JS");
    assert.equal(result.icon, "mdi-language-javascript");
  });

  it("uses last dot for multi-dot filenames", () => {
    const result = getFileIcon("archive.tar.gz");
    assert.equal(result.icon, "mdi-file-outline");
  });

  it("returns image icon for .png", () => {
    const result = getFileIcon("photo.png");
    assert.equal(result.icon, "mdi-file-image");
  });
});

describe("getHighlightLang", () => {
  it("returns 'javascript' for js", () => {
    assert.equal(getHighlightLang("js"), "javascript");
  });

  it("returns 'python' for py", () => {
    assert.equal(getHighlightLang("py"), "python");
  });

  it("returns 'xml' for html", () => {
    assert.equal(getHighlightLang("html"), "xml");
  });

  it("returns null for unknown extension", () => {
    assert.equal(getHighlightLang("xyz"), null);
  });

  it("returns null for extension without lang", () => {
    assert.equal(getHighlightLang("gitignore"), null);
  });

  it("returns 'python' for pyw (icon is null but lang exists)", () => {
    assert.equal(getHighlightLang("pyw"), "python");
  });
});

describe("getHighlightKeyFromPath", () => {
  it("extracts extension from simple filename", () => {
    assert.equal(getHighlightKeyFromPath("app.js"), "js");
  });

  it("extracts extension from full path", () => {
    assert.equal(getHighlightKeyFromPath("src/components/App.tsx"), "tsx");
  });

  it("returns lowercase extension", () => {
    assert.equal(getHighlightKeyFromPath("FILE.PY"), "py");
  });

  it("returns full name for dotless file", () => {
    assert.equal(getHighlightKeyFromPath("Makefile"), "makefile");
  });

  it("returns full lowercase name for dotless path", () => {
    assert.equal(getHighlightKeyFromPath("src/Dockerfile"), "dockerfile");
  });

  it("returns empty string for empty input", () => {
    assert.equal(getHighlightKeyFromPath(""), "");
  });

  it("returns empty string for null", () => {
    assert.equal(getHighlightKeyFromPath(null), "");
  });

  it("uses last dot for multi-dot filenames", () => {
    assert.equal(getHighlightKeyFromPath("data.test.json"), "json");
  });
});

describe("formatFileSize", () => {
  it("returns empty for null", () => {
    assert.equal(formatFileSize(null), "");
  });

  it("returns empty for undefined", () => {
    assert.equal(formatFileSize(undefined), "");
  });

  it("formats bytes", () => {
    assert.equal(formatFileSize(500), "500 B");
  });

  it("formats 0 bytes", () => {
    assert.equal(formatFileSize(0), "0 B");
  });

  it("formats kilobytes", () => {
    assert.equal(formatFileSize(2048), "2.0 KB");
  });

  it("formats 1 KB boundary", () => {
    assert.equal(formatFileSize(1024), "1.0 KB");
  });

  it("formats megabytes", () => {
    assert.equal(formatFileSize(1048576), "1.0 MB");
  });

  it("formats fractional KB", () => {
    assert.equal(formatFileSize(1536), "1.5 KB");
  });

  it("formats large MB", () => {
    const result = formatFileSize(5 * 1024 * 1024 + 512 * 1024);
    assert.equal(result, "5.5 MB");
  });
});
