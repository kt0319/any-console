/**
 * エージェント状態バッジの表示定義とジョブ設定フォーム用の変換関数。
 *
 * 状態はバックエンド（api/agent_watch.py）が判定して status stream WS で届く。
 * idle は「印を出さない」デフォルト状態のため定義に含めない。
 * 色のみで状態を示さないよう、状態ごとに形の異なるアイコンを割り当てる。
 */

const AGENT_STATE_BADGES = {
  blocked: { icon: "mdi-hand-back-right", className: "agent-state-blocked", label: "agent blocked" },
  done: { icon: "mdi-check-circle", className: "agent-state-done", label: "agent done" },
  working: { icon: "mdi-loading", className: "agent-state-working", label: "agent working" },
};

/**
 * 状態名からバッジ表示定義を返す。idle・未知の状態は null（＝無表示）。
 * @param {string} state
 * @returns {{ icon: string, className: string, label: string } | null}
 */
export function agentStateBadge(state) {
  return AGENT_STATE_BADGES[state] || null;
}

/**
 * ジョブ設定フォームの「1 行 1 語句」テキストを語句リストへ変換する。
 * 前後空白を除去し、空行は捨てる。
 * @param {string} text
 * @returns {string[]}
 */
export function parsePhrasesText(text) {
  if (typeof text !== "string") return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * 語句リストをフォーム表示用の「1 行 1 語句」テキストへ戻す。
 * @param {string[]|undefined|null} phrases
 * @returns {string}
 */
export function phrasesToText(phrases) {
  if (!Array.isArray(phrases)) return "";
  return phrases.join("\n");
}

/**
 * blocked / done のフォームテキストから API へ送る state_patterns を組み立てる。
 * 空の状態はキー自体を含めない（config に残骸を残さない）。
 * @param {string} blockedText
 * @param {string} doneText
 * @returns {Record<string, string[]>}
 */
export function buildStatePatterns(blockedText, doneText) {
  /** @type {Record<string, string[]>} */
  const patterns = {};
  const blocked = parsePhrasesText(blockedText);
  const done = parsePhrasesText(doneText);
  if (blocked.length) patterns.blocked = blocked;
  if (done.length) patterns.done = done;
  return patterns;
}
