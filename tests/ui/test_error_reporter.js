// @vitest-environment happy-dom
// @ts-check
import { describe, it, expect, vi } from "vitest";
import {
  truncate,
  fingerprint,
  buildReport,
  pruneRecent,
  extractMessage,
  extractStack,
  installErrorReporter,
} from "../../ui/utils/error-reporter.js";

describe("truncate", () => {
  it("returns empty string for non-string input", () => {
    expect(truncate(null, 10)).toBe("");
    expect(truncate(undefined, 10)).toBe("");
    expect(truncate(123, 10)).toBe("");
  });

  it("returns the string as-is when shorter than max", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates strings longer than max", () => {
    expect(truncate("hello world", 5)).toBe("hello");
  });

  it("returns original when length equals max", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("fingerprint", () => {
  it("combines type, message, source, lineno", () => {
    const r = { type: "vue", message: "boom", source: "a.js", lineno: 10 };
    expect(fingerprint(r)).toBe("vue|boom|a.js|10");
  });

  it("treats null lineno as empty", () => {
    const r = { type: "error", message: "x", source: "", lineno: null };
    expect(fingerprint(r)).toBe("error|x||");
  });

  it("treats undefined lineno as empty", () => {
    const r = { type: "error", message: "x", source: "" };
    expect(fingerprint(r)).toBe("error|x||");
  });
});

describe("buildReport", () => {
  const env = { href: "https://example/page", userAgent: "ua-test" };

  it("populates defaults for missing fields", () => {
    const r = buildReport({}, env);
    expect(r).toEqual({
      type: "unknown",
      message: "",
      stack: "",
      source: "",
      lineno: null,
      colno: null,
      url: "https://example/page",
      user_agent: "ua-test",
      info: "",
    });
  });

  it("preserves provided fields", () => {
    const r = buildReport(
      { type: "vue", message: "boom", stack: "trace", source: "a.js", lineno: 10, colno: 5, info: "render" },
      env,
    );
    expect(r.type).toBe("vue");
    expect(r.message).toBe("boom");
    expect(r.stack).toBe("trace");
    expect(r.source).toBe("a.js");
    expect(r.lineno).toBe(10);
    expect(r.colno).toBe(5);
    expect(r.info).toBe("render");
  });

  it("truncates message beyond 2000 chars", () => {
    const long = "x".repeat(3000);
    const r = buildReport({ type: "vue", message: long }, env);
    expect(r.message.length).toBe(2000);
  });

  it("truncates stack beyond 10000 chars", () => {
    const long = "x".repeat(20000);
    const r = buildReport({ type: "vue", stack: long }, env);
    expect(r.stack.length).toBe(10000);
  });

  it("coerces non-number lineno to null", () => {
    const r = buildReport({ type: "vue", lineno: "10" }, env);
    expect(r.lineno).toBe(null);
  });
});

describe("pruneRecent", () => {
  it("removes entries older than the window", () => {
    const map = new Map([
      ["old", 0],
      ["recent", 4000],
    ]);
    pruneRecent(map, 6000, 5000);
    expect(map.has("old")).toBe(false);
    expect(map.has("recent")).toBe(true);
  });

  it("keeps entries within the window", () => {
    const map = new Map([["k", 100]]);
    pruneRecent(map, 200, 5000);
    expect(map.has("k")).toBe(true);
  });

  it("uses default 5000ms window when omitted", () => {
    const map = new Map([["k", 0]]);
    pruneRecent(map, 6000);
    expect(map.has("k")).toBe(false);
  });
});

describe("extractMessage", () => {
  it("returns 'Unknown error' for falsy input", () => {
    expect(extractMessage(null)).toBe("Unknown error");
    expect(extractMessage(undefined)).toBe("Unknown error");
  });

  it("returns string input as-is", () => {
    expect(extractMessage("plain")).toBe("plain");
  });

  it("returns err.message when present", () => {
    expect(extractMessage(new Error("boom"))).toBe("boom");
  });

  it("falls back to String() for objects without message", () => {
    expect(extractMessage({ foo: 1 })).toBe("[object Object]");
  });
});

describe("extractStack", () => {
  it("returns empty string for falsy input", () => {
    expect(extractStack(null)).toBe("");
    expect(extractStack(undefined)).toBe("");
  });

  it("returns empty string for plain string", () => {
    expect(extractStack("plain")).toBe("");
  });

  it("returns err.stack when present", () => {
    const e = new Error("x");
    expect(extractStack(e)).toBe(e.stack);
  });

  it("returns empty string when err has no stack", () => {
    expect(extractStack({})).toBe("");
  });
});

describe("installErrorReporter", () => {
  function setup() {
    const authFetch = vi.fn(async () => ({ ok: true }));
    const app = { config: {} };
    const uninstall = installErrorReporter(app, authFetch);
    return { authFetch, app, uninstall };
  }

  it("sets Vue errorHandler and posts on Vue error", async () => {
    const { authFetch, app, uninstall } = setup();
    expect(typeof app.config.errorHandler).toBe("function");
    const err = new Error("vue boom " + Math.random());
    app.config.errorHandler(err, {}, "render fn");
    await new Promise((r) => setTimeout(r, 0));
    expect(authFetch).toHaveBeenCalled();
    const [, opts] = authFetch.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(opts.body.type).toBe("vue");
    expect(opts.body.message).toContain("vue boom");
    expect(opts.body.info).toBe("render fn");
    uninstall();
  });

  it("posts on window error event", async () => {
    const { authFetch, uninstall } = setup();
    const ev = new ErrorEvent("error", {
      message: "win boom " + Math.random(),
      filename: "a.js",
      lineno: 10,
      colno: 5,
      error: new Error("inner"),
    });
    window.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 0));
    const call = authFetch.mock.calls.find((c) => c[1].body.type === "error");
    expect(call).toBeDefined();
    expect(call[1].body.source).toBe("a.js");
    expect(call[1].body.lineno).toBe(10);
    uninstall();
  });

  it("posts on unhandledrejection event", async () => {
    const { authFetch, uninstall } = setup();
    const reason = new Error("reject boom " + Math.random());
    const ev = new Event("unhandledrejection");
    /** @type {any} */ (ev).reason = reason;
    window.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 0));
    const call = authFetch.mock.calls.find((c) => c[1].body.type === "unhandledrejection");
    expect(call).toBeDefined();
    expect(call[1].body.message).toContain("reject boom");
    uninstall();
  });

  it("swallows authFetch failures silently", async () => {
    const authFetch = vi.fn(async () => { throw new Error("network"); });
    const app = { config: {} };
    const uninstall = installErrorReporter(app, authFetch);
    const err = new Error("silent boom " + Math.random());
    expect(() => app.config.errorHandler(err, {}, "")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    uninstall();
  });

  it("uninstall removes window listeners and Vue handler", () => {
    const { authFetch, app, uninstall } = setup();
    const beforeCalls = authFetch.mock.calls.length;
    uninstall();
    expect(app.config.errorHandler).toBeUndefined();
    window.dispatchEvent(new ErrorEvent("error", { message: "after-uninstall" }));
    expect(authFetch.mock.calls.length).toBe(beforeCalls);
  });
});
