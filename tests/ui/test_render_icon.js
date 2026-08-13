// @ts-check
import { describe, it, expect } from "vitest";
import { renderIconStr } from "../../ui/utils/render-icon.ts";

describe("renderIconStr", () => {
  it("returns empty string for falsy icon", () => {
    expect(renderIconStr("", "#fff")).toBe("");
    expect(renderIconStr(null, "#fff")).toBe("");
  });

  it("renders data: URL as <img>", () => {
    const html = renderIconStr("data:image/png;base64,abc", null, 20);
    expect(html).toContain('<img src="data:image/png;base64,abc"');
    expect(html).toContain('width="20"');
    expect(html).toContain('height="20"');
  });

  it("rewrites icon: prefix to /icons/ path", () => {
    const html = renderIconStr("icon:vue.svg", null);
    expect(html).toContain('src="/icons/vue.svg"');
  });

  it("renders favicon: prefix via google s2", () => {
    const html = renderIconStr("favicon:example.com", null);
    expect(html).toContain("google.com/s2/favicons");
    expect(html).toContain("domain=example.com");
  });

  it("falls back to mdi-web for IPv4 hosts", () => {
    const html = renderIconStr("favicon:100.109.44.17", null);
    expect(html).toContain("mdi-web");
    expect(html).not.toContain("s2/favicons");
  });

  it.each([
    "localhost",
    "http://localhost:3000",
    "http://192.168.1.1",
    "no-tld",
  ])("falls back to mdi-web for unsupported host %s", (host) => {
    const html = renderIconStr(`favicon:${host}`, null);
    expect(html).toContain("mdi-web");
    expect(html).not.toContain("s2/favicons");
  });

  it("extracts hostname from full URL when fetchable", () => {
    const html = renderIconStr("favicon:https://example.com/path", null);
    expect(html).toContain("s2/favicons");
  });

  it("renders mdi icons with color when provided", () => {
    const html = renderIconStr("mdi-home", "#abc");
    expect(html).toContain('class="mdi mdi-home"');
    expect(html).toContain("color:#abc");
  });

  it("ignores invalid color values", () => {
    const html = renderIconStr("mdi-home", "not-a-color");
    expect(html).not.toContain("color:");
  });

  it("uses default size of 16", () => {
    const html = renderIconStr("mdi-home");
    expect(html).toContain("font-size:16px");
  });
  it("rejects unsafe icon values", () => {
    expect(renderIconStr('mdi-home" onclick="alert(1)', "#fff")).toBe("");
    expect(renderIconStr('icon:../secret.svg', null)).toBe("");
    expect(renderIconStr('icon:bad" onerror="alert(1).svg', null)).toBe("");
    expect(renderIconStr('data:image/svg+xml,<svg onload=alert(1)>', null)).toBe("");
    expect(renderIconStr('mdi-home', null, '" onmouseover="alert(1)')).toContain('font-size:16px');
  });

});
