import { describe, it, expect } from "vitest";
import { extractFilenameFromContentDisposition } from "../../ui/utils/content-disposition.ts";

describe("extractFilenameFromContentDisposition", () => {
  it("null/undefinedはnullを返す", () => {
    expect(extractFilenameFromContentDisposition(null)).toBeNull();
    expect(extractFilenameFromContentDisposition(undefined)).toBeNull();
  });

  it("filename*=UTF-8''形式を優先して取り出す", () => {
    const header = "attachment; filename=\"dir.zip\"; filename*=UTF-8''%E3%83%95%E3%82%A9%E3%83%AB%E3%83%80.zip";
    expect(extractFilenameFromContentDisposition(header)).toBe("フォルダ.zip");
  });

  it("filename=\"...\"形式を取り出す", () => {
    expect(extractFilenameFromContentDisposition('attachment; filename="dir.zip"')).toBe("dir.zip");
  });

  it("クォート無しfilename=...形式にもフォールバックする", () => {
    expect(extractFilenameFromContentDisposition("attachment; filename=dir.zip")).toBe("dir.zip");
  });

  it("filenameを含まなければnullを返す", () => {
    expect(extractFilenameFromContentDisposition("attachment")).toBeNull();
  });
});
