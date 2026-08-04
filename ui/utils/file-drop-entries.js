// ドラッグ&ドロップされたフォルダの中身を、相対パス付きのファイル一覧に
// 展開する。Chrome/Safari系のDataTransferItem.webkitGetAsEntry()を使い、
// フォルダをディレクトリツリーとして再帰的に読み取る（非対応環境では
// dataTransfer.filesのフラットな一覧にフォールバックする）。

function readEntriesAsync(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileFromEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry, basePath, out) {
  if (!entry) return;
  if (entry.isFile) {
    const file = await fileFromEntry(entry);
    out.push({ file, relativePath: basePath ? `${basePath}/${entry.name}` : entry.name });
    return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const childPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    // readEntries()は一度に返せる件数に上限があるため、空配列が返るまで繰り返す。
    let batch;
    do {
      batch = await readEntriesAsync(reader);
      for (const child of batch) await walkEntry(child, childPath, out);
    } while (batch.length > 0);
  }
}

/**
 * @param {DataTransfer | null | undefined} dataTransfer
 * @returns {Promise<{ file: File, relativePath: string }[]>}
 */
export async function collectDroppedFileEntries(dataTransfer) {
  const items = dataTransfer?.items;
  if (items && items.length > 0 && typeof items[0]?.webkitGetAsEntry === "function") {
    const entries = Array.from(items).map((item) => item.webkitGetAsEntry()).filter(Boolean);
    if (entries.length > 0) {
      const out = [];
      for (const entry of entries) await walkEntry(entry, "", out);
      return out;
    }
  }
  return Array.from(dataTransfer?.files || [])
    .filter((f) => f && f.name)
    .map((file) => ({ file, relativePath: file.name }));
}
