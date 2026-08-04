import { describe, it, expect } from "vitest";
import { splitRelativePath, resolveUploadTargetDir } from "../../ui/utils/file-upload-path.js";

describe("splitRelativePath", () => {
  it("階層が無ければdirは空文字", () => {
    expect(splitRelativePath("app.js")).toEqual({ dir: "", name: "app.js" });
  });

  it("階層があればdir/nameに分解する", () => {
    expect(splitRelativePath("src/app.js")).toEqual({ dir: "src", name: "app.js" });
  });

  it("多段階層でも最後の/で分解する", () => {
    expect(splitRelativePath("src/components/Foo.vue")).toEqual({ dir: "src/components", name: "Foo.vue" });
  });
});

describe("resolveUploadTargetDir", () => {
  it("relativeDirが無ければbaseUploadPathをそのまま返す", () => {
    expect(resolveUploadTargetDir("docs", "")).toBe("docs");
    expect(resolveUploadTargetDir("", "")).toBe("");
  });

  it("baseUploadPathが無ければrelativeDirをそのまま返す", () => {
    expect(resolveUploadTargetDir("", "src")).toBe("src");
  });

  it("両方あれば連結する", () => {
    expect(resolveUploadTargetDir("docs", "src/components")).toBe("docs/src/components");
  });
});
