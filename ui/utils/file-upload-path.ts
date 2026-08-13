// フォルダドロップ由来のrelativePath（例: "src/app.js"）を、既存の
// upload API（path=ディレクトリ, file=ファイル本体, ファイル名に"/"は不可）
// に渡せる形へ分解・合成するための純粋関数群。

import { basename, dirname } from "./path.ts";

export function splitRelativePath(relativePath: string): { dir: string, name: string } {
  return { dir: dirname(relativePath), name: basename(relativePath) };
}

/**
 * 現在アップロード先にしているディレクトリ（baseUploadPath）と、
 * ドロップされたファイルの相対ディレクトリ（relativeDir、無ければ""）を
 * 合成して実際のアップロード先パスを返す。
 */
export function resolveUploadTargetDir(baseUploadPath: string, relativeDir: string): string {
  if (!relativeDir) return baseUploadPath || "";
  return baseUploadPath ? `${baseUploadPath}/${relativeDir}` : relativeDir;
}
