// コマンド文字列内の [[name]] プレースホルダーを扱うユーティリティ。
// 実行時にユーザーへ値を入力させ、サーバ側で shlex.quote して差し込む。

const PLACEHOLDER_RE = /\[\[\s*([A-Za-z0-9_]+)\s*\]\]/g;

/**
 * コマンド内の [[name]] トークン名を、出現順かつ重複なしで返す。
 * @param {string|null|undefined} command
 * @returns {string[]}
 */
export function extractPlaceholders(command) {
  if (!command) return [];
  const names = [];
  const lines = command.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  PLACEHOLDER_RE.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER_RE.exec(lines)) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}
