// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Inline copies of pure functions from utils.js ──

function toDisplayMessage(value, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return toDisplayMessage(value.message, fallback);
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (item && typeof item === "object" && typeof item.msg === "string") {
          return item.msg;
        }
        return toDisplayMessage(item, "");
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join(" / ") : fallback;
  }
  if (typeof value === "object") {
    if ("detail" in value) return toDisplayMessage(value.detail, fallback);
    if ("message" in value) return toDisplayMessage(value.message, fallback);
    if ("msg" in value) return toDisplayMessage(value.msg, fallback);
    if ("error" in value) return toDisplayMessage(value.error, fallback);
    if ("stderr" in value) return toDisplayMessage(value.stderr, fallback);
    if ("stdout" in value) return toDisplayMessage(value.stdout, fallback);
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function formatCommitTime(timeText) {
  if (!timeText) return "-";
  const d = new Date(timeText);
  if (Number.isNaN(d.getTime())) return timeText;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function buildWorkspaceChangeSummaryHtml(ws) {
  if (!ws || ws.clean !== false) return "";
  const parts = [];
  if (ws.changed_files > 0) parts.push(`<span class="stat-files">${ws.changed_files}F</span>`);
  if (ws.insertions > 0) parts.push(`<span class="stat-add">+${ws.insertions}</span>`);
  if (ws.deletions > 0) parts.push(`<span class="stat-del">-${ws.deletions}</span>`);
  return parts.length > 0 ? parts.join(" ") : "\u25cf";
}

const VALID_ICON_COLOR = /^#[0-9a-fA-F]{3,6}$/;

function isImageDataIcon(icon) {
  return typeof icon === "string" && icon.startsWith("data:image/");
}

function faviconUrl(domain) {
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
}

// ── Tests ──

describe("toDisplayMessage", () => {
  it("returns string as-is", () => {
    assert.equal(toDisplayMessage("hello"), "hello");
  });

  it("returns fallback for null", () => {
    assert.equal(toDisplayMessage(null, "fallback"), "fallback");
  });

  it("returns fallback for undefined", () => {
    assert.equal(toDisplayMessage(undefined, "fallback"), "fallback");
  });

  it("converts number to string", () => {
    assert.equal(toDisplayMessage(42), "42");
  });

  it("converts boolean to string", () => {
    assert.equal(toDisplayMessage(true), "true");
  });

  it("extracts message from Error", () => {
    assert.equal(toDisplayMessage(new Error("oops")), "oops");
  });

  it("extracts detail from object", () => {
    assert.equal(toDisplayMessage({ detail: "some detail" }), "some detail");
  });

  it("extracts message from object", () => {
    assert.equal(toDisplayMessage({ message: "msg here" }), "msg here");
  });

  it("extracts error from object", () => {
    assert.equal(toDisplayMessage({ error: "err" }), "err");
  });

  it("extracts stderr from object", () => {
    assert.equal(toDisplayMessage({ stderr: "stderr output" }), "stderr output");
  });

  it("joins array items with /", () => {
    assert.equal(toDisplayMessage(["a", "b"]), "a / b");
  });

  it("extracts msg from array items", () => {
    assert.equal(toDisplayMessage([{ msg: "x" }, { msg: "y" }]), "x / y");
  });

  it("returns fallback for empty array", () => {
    assert.equal(toDisplayMessage([], "nothing"), "nothing");
  });

  it("returns JSON for unknown object", () => {
    assert.equal(toDisplayMessage({ foo: "bar" }), '{"foo":"bar"}');
  });

  it("detail takes priority over message", () => {
    assert.equal(toDisplayMessage({ detail: "d", message: "m" }), "d");
  });

  it("handles nested detail as array", () => {
    assert.equal(toDisplayMessage({ detail: [{ msg: "a" }] }), "a");
  });
});

describe("formatCommitTime", () => {
  it("returns '-' for empty string", () => {
    assert.equal(formatCommitTime(""), "-");
  });

  it("returns '-' for null", () => {
    assert.equal(formatCommitTime(null), "-");
  });

  it("formats valid ISO date", () => {
    // Use UTC to make test timezone-independent
    const d = new Date(2024, 0, 15, 9, 30);
    const result = formatCommitTime(d.toISOString());
    assert.match(result, /^2024-01-15/);
  });

  it("returns raw text for invalid date", () => {
    assert.equal(formatCommitTime("not-a-date"), "not-a-date");
  });
});

describe("buildWorkspaceChangeSummaryHtml", () => {
  it("returns empty for null", () => {
    assert.equal(buildWorkspaceChangeSummaryHtml(null), "");
  });

  it("returns empty for clean workspace", () => {
    assert.equal(buildWorkspaceChangeSummaryHtml({ clean: true }), "");
  });

  it("returns bullet for dirty with no stats", () => {
    assert.equal(
      buildWorkspaceChangeSummaryHtml({ clean: false, changed_files: 0, insertions: 0, deletions: 0 }),
      "\u25cf"
    );
  });

  it("includes files and insertions", () => {
    const result = buildWorkspaceChangeSummaryHtml({ clean: false, changed_files: 3, insertions: 10, deletions: 0 });
    assert.ok(result.includes("3F"));
    assert.ok(result.includes("+10"));
    assert.ok(!result.includes("-0"));
  });

  it("includes all parts", () => {
    const result = buildWorkspaceChangeSummaryHtml({ clean: false, changed_files: 2, insertions: 5, deletions: 3 });
    assert.ok(result.includes("2F"));
    assert.ok(result.includes("+5"));
    assert.ok(result.includes("-3"));
  });
});

describe("VALID_ICON_COLOR", () => {
  it("matches 3-digit hex", () => {
    assert.ok(VALID_ICON_COLOR.test("#abc"));
  });

  it("matches 6-digit hex", () => {
    assert.ok(VALID_ICON_COLOR.test("#aabbcc"));
  });

  it("rejects no hash", () => {
    assert.ok(!VALID_ICON_COLOR.test("aabbcc"));
  });

  it("rejects invalid chars", () => {
    assert.ok(!VALID_ICON_COLOR.test("#gggggg"));
  });
});

describe("isImageDataIcon", () => {
  it("returns true for data:image/ prefix", () => {
    assert.ok(isImageDataIcon("data:image/png;base64,abc"));
  });

  it("returns false for regular string", () => {
    assert.ok(!isImageDataIcon("mdi-home"));
  });

  it("returns false for null", () => {
    assert.ok(!isImageDataIcon(null));
  });
});

describe("faviconUrl", () => {
  it("returns empty for empty domain", () => {
    assert.equal(faviconUrl(""), "");
  });

  it("constructs Google favicon URL", () => {
    const result = faviconUrl("example.com");
    assert.ok(result.includes("example.com"));
    assert.ok(result.includes("favicons"));
  });

  it("encodes special characters", () => {
    const result = faviconUrl("example.com/path?q=1");
    assert.ok(result.includes(encodeURIComponent("example.com/path?q=1")));
  });
});
