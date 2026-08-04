// フォルダドロップ由来のrelativePath（例: "src/app.js"）を、既存の
// upload API（path=ディレクトリ, file=ファイル本体, ファイル名に"/"は不可）
// に渡せる形へ分解・合成するための純粋関数群。

/**
 * @param {string} relativePath
 * @returns {{ dir: string, name: string }}
 */
export function splitRelativePath(relativePath) {
  const idx = relativePath.lastIndexOf("/");
  if (idx < 0) return { dir: "", name: relativePath };
  return { dir: relativePath.slice(0, idx), name: relativePath.slice(idx + 1) };
}

/**
 * 現在アップロード先にしているディレクトリ（baseUploadPath）と、
 * ドロップされたファイルの相対ディレクトリ（relativeDir、無ければ""）を
 * 合成して実際のアップロード先パスを返す。
 * @param {string} baseUploadPath
 * @param {string} relativeDir
 * @returns {string}
 */
export function resolveUploadTargetDir(baseUploadPath, relativeDir) {
  if (!relativeDir) return baseUploadPath || "";
  return baseUploadPath ? `${baseUploadPath}/${relativeDir}` : relativeDir;
}
