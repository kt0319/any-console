import { describe, it, expect } from "vitest";
import { devServerOrigin, devServerUrl } from "../../ui/utils/preview-url.ts";

describe("devServerOrigin", () => {
  it("scheme・ホスト名・proxyポートからoriginを組み立てる", () => {
    expect(devServerOrigin({ scheme: "https", proxy_port: 23000 }, "pi.local")).toBe("https://pi.local:23000");
  });

  it("scheme未指定はhttpにフォールバックする", () => {
    expect(devServerOrigin({ proxy_port: 23000 }, "localhost")).toBe("http://localhost:23000");
  });

  it("proxy_portが無い/entryが無い場合は空文字", () => {
    expect(devServerOrigin({ scheme: "http" }, "localhost")).toBe("");
    expect(devServerOrigin(null, "localhost")).toBe("");
    expect(devServerOrigin(undefined, "localhost")).toBe("");
  });
});

describe("devServerUrl", () => {
  it("末尾スラッシュ付きのURLを返す", () => {
    expect(devServerUrl({ scheme: "http", proxy_port: 23000 }, "localhost")).toBe("http://localhost:23000/");
  });

  it("proxy_portが無い場合は空文字", () => {
    expect(devServerUrl({}, "localhost")).toBe("");
  });
});
