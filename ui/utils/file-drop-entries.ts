// ドラッグ&ドロップされたフォルダの中身を、相対パス付きのファイル一覧に
// 展開する。Chrome/Safari系のDataTransferItem.webkitGetAsEntry()を使い、
// フォルダをディレクトリツリーとして再帰的に読み取る（非対応環境では
// dataTransfer.filesのフラットな一覧にフォールバックする）。

type DroppedFileEntry = { file: File, relativePath: string };

function readEntriesAsync(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry | null, basePath: string, out: DroppedFileEntry[]) {
  if (!entry) return;
  if (entry.isFile) {
    const file = await fileFromEntry(entry as FileSystemFileEntry);
    out.push({ file, relativePath: basePath ? `${basePath}/${entry.name}` : entry.name });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const childPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    // readEntries()は一度に返せる件数に上限があるため、空配列が返るまで繰り返す。
    let batch;
    do {
      batch = await readEntriesAsync(reader);
      for (const child of batch) await walkEntry(child, childPath, out);
    } while (batch.length > 0);
  }
}

export async function collectDroppedFileEntries(dataTransfer: DataTransfer | null | undefined): Promise<DroppedFileEntry[]> {
  const items = dataTransfer?.items;
  if (items && items.length > 0 && typeof items[0]?.webkitGetAsEntry === "function") {
    const entries = Array.from(items).map((item) => item.webkitGetAsEntry()).filter(Boolean);
    if (entries.length > 0) {
      const out: DroppedFileEntry[] = [];
      for (const entry of entries) await walkEntry(entry, "", out);
      return out;
    }
  }
  return Array.from(dataTransfer?.files || [])
    .filter((f) => f && f.name)
    .map((file) => ({ file, relativePath: file.name }));
}
