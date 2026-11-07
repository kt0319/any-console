// フォルダドロップ由来のrelativePath（例: "src/app.js"）を、既存の
// upload API（path=ディレクトリ, file=ファイル本体, ファイル名に"/"は不可）
// に渡せる形へ分解・合成するための純粋関数群。

import { LARGE_UPLOAD_WARN_BYTES, UPLOAD_FAILURE_TOAST_MAX } from "./constants.ts";
import { formatSize } from "./format.ts";
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

export type UploadFailure = { name: string, reason: string };

/** 失敗したファイル名と理由を列挙する。多い場合は先頭だけ出して残件数を付ける。 */
export function formatUploadFailures(failures: UploadFailure[]): string {
  const shown = failures.slice(0, UPLOAD_FAILURE_TOAST_MAX).map((f) => `${f.name} (${f.reason})`);
  const remaining = failures.length - shown.length;
  const list = shown.join("; ") + (remaining > 0 ? `; … and ${remaining} more` : "");
  return `${failures.length} file(s) failed to upload: ${list}`;
}

/** アップロード済みのうち閾値以上の大きいファイルを列挙する警告文。無ければ null。 */
export function formatLargeUploadWarning(uploaded: { name: string, size: number }[]): string | null {
  const large = uploaded.filter((f) => f.size >= LARGE_UPLOAD_WARN_BYTES);
  if (large.length === 0) return null;
  const shown = large.slice(0, UPLOAD_FAILURE_TOAST_MAX).map((f) => `${f.name} (${formatSize(f.size)})`);
  const remaining = large.length - shown.length;
  return `Large file uploaded: ${shown.join("; ")}${remaining > 0 ? `; … and ${remaining} more` : ""}`;
}
