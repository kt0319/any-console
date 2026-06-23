import { keyDefToAnsi } from "./key-ansi.js";

/**
 * 指定ターミナルタブの WebSocket へキー入力（ANSI シーケンス）を送信する。
 * @param {{ ws?: WebSocket | null } | null | undefined} tab
 * @param {{ key: string, ctrl?: boolean, shift?: boolean }} keyDef
 * @returns {boolean} 送信に成功したら true
 */
export function dispatchKeyToTab(tab, keyDef) {
  if (!tab?.ws || tab.ws.readyState !== WebSocket.OPEN) return false;
  const seq = keyDefToAnsi(keyDef);
  if (seq == null) return false;
  tab.ws.send(new TextEncoder().encode(seq));
  return true;
}

/**
 * 指定ターミナルタブの WebSocket へ生テキストを送信する。
 * @param {{ ws?: WebSocket | null } | null | undefined} tab
 * @param {string} text
 * @returns {boolean}
 */
export function dispatchTextToTab(tab, text) {
  if (!tab?.ws || tab.ws.readyState !== WebSocket.OPEN) return false;
  tab.ws.send(new TextEncoder().encode(text));
  return true;
}
