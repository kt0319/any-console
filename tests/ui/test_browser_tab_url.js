// @ts-check
import { describe, it, expect } from "vitest";
import { isAllowedBrowserTabUrl } from "../../ui/utils/browser-tab-url.ts";

describe("isAllowedBrowserTabUrl", () => {
  it("http / https のURLを許可する", () => {
    expect(isAllowedBrowserTabUrl("http://localhost:3000/")).toBe(true);
    expect(isAllowedBrowserTabUrl("https://example.com/path?x=1")).toBe(true);
  });

  it("http/https 以外のスキームを弾く（iframeのsrcへ入るため）", () => {
    expect(isAllowedBrowserTabUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedBrowserTabUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedBrowserTabUrl("data:text/html,<script>1</script>")).toBe(false);
    expect(isAllowedBrowserTabUrl("vscode://file/foo")).toBe(false);
  });

  it("URLとして不正な文字列・非文字列を弾く", () => {
    expect(isAllowedBrowserTabUrl("not a url")).toBe(false);
    expect(isAllowedBrowserTabUrl("localhost:3000")).toBe(false);
    expect(isAllowedBrowserTabUrl("")).toBe(false);
    expect(isAllowedBrowserTabUrl(null)).toBe(false);
    expect(isAllowedBrowserTabUrl(undefined)).toBe(false);
    expect(isAllowedBrowserTabUrl(123)).toBe(false);
  });
});
