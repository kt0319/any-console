import { describe, it, expect } from "vitest";
import { collectDroppedFileEntries } from "../../ui/utils/file-drop-entries.js";

function makeFile(name) {
  return new File(["x"], name, { type: "text/plain" });
}

describe("collectDroppedFileEntries", () => {
  it("webkitGetAsEntry非対応時はdataTransfer.filesへフォールバックする", async () => {
    const dataTransfer = { files: [makeFile("a.txt"), makeFile("b.txt")] };
    const entries = await collectDroppedFileEntries(dataTransfer);
    expect(entries).toEqual([
      { file: dataTransfer.files[0], relativePath: "a.txt" },
      { file: dataTransfer.files[1], relativePath: "b.txt" },
    ]);
  });

  it("dataTransferが無ければ空配列を返す", async () => {
    expect(await collectDroppedFileEntries(null)).toEqual([]);
  });

  it("名前の無いFileはフォールバック時に除外する", async () => {
    const dataTransfer = { files: [{ name: "" }, makeFile("ok.txt")] };
    const entries = await collectDroppedFileEntries(dataTransfer);
    expect(entries).toEqual([{ file: dataTransfer.files[1], relativePath: "ok.txt" }]);
  });

  it("webkitGetAsEntryでファイルエントリを平坦に集める", async () => {
    const fileEntry = {
      isFile: true,
      isDirectory: false,
      name: "a.txt",
      file: (resolve) => resolve(makeFile("a.txt")),
    };
    const items = [{ webkitGetAsEntry: () => fileEntry }];
    const dataTransfer = { items, files: [] };
    const entries = await collectDroppedFileEntries(dataTransfer);
    expect(entries).toEqual([{ file: expect.any(File), relativePath: "a.txt" }]);
  });

  it("webkitGetAsEntryでディレクトリを再帰的に辿りrelativePathを組み立てる", async () => {
    const nestedFile = {
      isFile: true,
      isDirectory: false,
      name: "app.js",
      file: (resolve) => resolve(makeFile("app.js")),
    };
    let read = false;
    const srcDir = {
      isFile: false,
      isDirectory: true,
      name: "src",
      createReader: () => ({
        readEntries: (resolve) => {
          if (read) { resolve([]); return; }
          read = true;
          resolve([nestedFile]);
        },
      }),
    };
    const items = [{ webkitGetAsEntry: () => srcDir }];
    const dataTransfer = { items, files: [] };
    const entries = await collectDroppedFileEntries(dataTransfer);
    expect(entries).toEqual([{ file: expect.any(File), relativePath: "src/app.js" }]);
  });
});
