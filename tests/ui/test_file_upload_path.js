import { describe, it, expect } from "vitest";
import { splitRelativePath, resolveUploadTargetDir, formatUploadFailures } from "../../ui/utils/file-upload-path.ts";

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

describe("formatUploadFailures", () => {
  it("ファイル名と理由を列挙する", () => {
    expect(formatUploadFailures([{ name: "a/x.txt", reason: "Invalid path" }])).toBe(
      "1 file(s) failed to upload: a/x.txt (Invalid path)",
    );
  });

  it("多い場合は先頭3件だけ出して残件数を付ける", () => {
    const failures = ["a", "b", "c", "d", "e"].map((name) => ({ name, reason: "HTTP 500" }));
    expect(formatUploadFailures(failures)).toBe(
      "5 file(s) failed to upload: a (HTTP 500); b (HTTP 500); c (HTTP 500); … and 2 more",
    );
  });
});
