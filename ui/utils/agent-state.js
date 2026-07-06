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

// watch_phrases で使うアイコンとその CSS クラスの対応（色の意味づけ）
const WATCH_PHRASE_ICON_CLASSNAMES = {
  "mdi-hand-back-right": "agent-state-blocked",
  "mdi-cursor-default-click": "agent-state-blocked",
  "mdi-arrow-decision": "agent-state-select",
  "mdi-alert-circle": "agent-state-blocked",
  "mdi-check-circle": "agent-state-done",
  "mdi-check-all": "agent-state-done",
};

/**
 * 状態名からバッジ表示定義を返す。
 * - 既知の固定状態（blocked/done/working）はそのまま返す
 * - mdi-* で始まる状態は watch_phrases のアイコン名なので動的に生成
 * - idle・未知の状態は null（＝無表示）
 * @param {string} state
 * @returns {{ icon: string, className: string, label: string } | null}
 */
export function agentStateBadge(state) {
  if (AGENT_STATE_BADGES[state]) return AGENT_STATE_BADGES[state];
  if (state && state.startsWith("mdi-")) {
    const className = WATCH_PHRASE_ICON_CLASSNAMES[state] || "agent-state-custom";
    return { icon: state, className, label: "agent state" };
  }
  return null;
}

/** watch_phrases フォームで使えるアイコン一覧 */
export const WATCH_PHRASE_ICON_OPTIONS = [
  { icon: "mdi-hand-back-right", className: "agent-state-blocked" },
  { icon: "mdi-cursor-default-click", className: "agent-state-blocked" },
  { icon: "mdi-arrow-decision", className: "agent-state-select" },
  { icon: "mdi-alert-circle", className: "agent-state-blocked" },
  { icon: "mdi-check-circle", className: "agent-state-done" },
  { icon: "mdi-check-all", className: "agent-state-done" },
  { icon: "mdi-information", className: "agent-state-custom" },
  { icon: "mdi-flag", className: "agent-state-custom" },
  { icon: "mdi-star", className: "agent-state-custom" },
  { icon: "mdi-lightning-bolt", className: "agent-state-custom" },
];

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

/**
 * 有効・無効の語句配列からチェックボックスリスト形式のアイテムを組み立てる。
 * 有効なものを先に並べ、その後ろに無効なものを追加する。
 * @param {string[]|undefined} enabled
 * @param {string[]|undefined} disabled
 * @returns {{phrase: string, enabled: boolean}[]}
 */
export function buildPhraseItems(enabled, disabled) {
  return [
    ...(Array.isArray(enabled) ? enabled : []).map((phrase) => ({ phrase, enabled: true })),
    ...(Array.isArray(disabled) ? disabled : []).map((phrase) => ({ phrase, enabled: false })),
  ];
}

/**
 * 有効・無効の watch_phrases リストから統合フォームアイテムを組み立てる。
 * @param {Array<{phrase: string, icon: string}>|undefined} enabled
 * @param {Array<{phrase: string, icon: string}>|undefined} disabled
 * @returns {Array<{phrase: string, icon: string, enabled: boolean}>}
 */
export function buildWatchPhraseItems(enabled, disabled) {
  const DEFAULT_ICON = "mdi-hand-back-right";
  return [
    ...(Array.isArray(enabled) ? enabled : []).map((wp) => ({
      phrase: wp.phrase || "",
      icon: wp.icon || DEFAULT_ICON,
      enabled: true,
    })),
    ...(Array.isArray(disabled) ? disabled : []).map((wp) => ({
      phrase: wp.phrase || "",
      icon: wp.icon || DEFAULT_ICON,
      enabled: false,
    })),
  ];
}

/**
 * フォームアイテムから有効な watch_phrases を取り出す。
 * @param {Array<{phrase: string, icon: string, enabled: boolean}>|undefined} items
 * @returns {Array<{phrase: string, icon: string}>}
 */
export function enabledWatchPhrases(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i.enabled && i.phrase.trim())
    .map((i) => ({ phrase: i.phrase.trim(), icon: i.icon || "mdi-hand-back-right" }));
}

/**
 * フォームアイテムから無効な watch_phrases を取り出す。
 * @param {Array<{phrase: string, icon: string, enabled: boolean}>|undefined} items
 * @returns {Array<{phrase: string, icon: string}>}
 */
export function disabledWatchPhrases(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => !i.enabled && i.phrase.trim())
    .map((i) => ({ phrase: i.phrase.trim(), icon: i.icon || "mdi-hand-back-right" }));
}

/**
 * チェックボックスリストから有効な語句だけを取り出す。
 * @param {{phrase: string, enabled: boolean}[]|undefined} items
 * @returns {string[]}
 */
export function enabledPhrases(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((i) => i.enabled).map((i) => i.phrase.trim()).filter(Boolean);
}

/**
 * チェックボックスリストから無効化された語句だけを取り出す。
 * @param {{phrase: string, enabled: boolean}[]|undefined} items
 * @returns {string[]}
 */
export function disabledPhrases(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((i) => !i.enabled).map((i) => i.phrase.trim()).filter(Boolean);
}
