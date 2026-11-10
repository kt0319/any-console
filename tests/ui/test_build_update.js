import { describe, it, expect } from "vitest";
import { extractBundleName, isNewBuildAvailable } from "../../ui/utils/build-update.ts";

const page = (hash) => `<html><script type="module" crossorigin src="/assets/index-${hash}.js"></script></html>`;

describe("extractBundleName", () => {
  it("index.html から bundle 名を取り出す", () => {
    expect(extractBundleName(page("Ab_1-c"))).toBe("assets/index-Ab_1-c.js");
  });
  it("bundle が無ければ null", () => {
    expect(extractBundleName("<html></html>")).toBeNull();
  });
});

describe("isNewBuildAvailable", () => {
  it("bundle 名が違えば true", () => {
    expect(isNewBuildAvailable(page("old"), page("new"))).toBe(true);
  });
  it("同じなら false", () => {
    expect(isNewBuildAvailable(page("same"), page("same"))).toBe(false);
  });
  it("どちらかの bundle 名が取れなければ再読み込みしない", () => {
    expect(isNewBuildAvailable(page("old"), "<html>login</html>")).toBe(false);
  });
});
