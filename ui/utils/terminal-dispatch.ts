import { keyDefToAnsi } from "./key-ansi.ts";
import { useAgentStateStore } from "../stores/agent-state.ts";

/**
 * 指定ターミナルタブの WebSocket へキー入力（ANSI シーケンス）を送信する。
 * @returns 送信に成功したら true
 */
export function dispatchKeyToTab(
  tab: { ws?: WebSocket | null; sessionId?: string | null } | null | undefined,
  keyDef: { key: string; ctrl?: boolean; shift?: boolean },
): boolean {
  if (!tab?.ws || tab.ws.readyState !== WebSocket.OPEN) return false;
  const seq = keyDefToAnsi(keyDef);
  if (seq == null) return false;
  tab.ws.send(new TextEncoder().encode(seq));
  useAgentStateStore().clearSessionNotifyBadges(tab.sessionId);
  return true;
}

/**
 * 指定ターミナルタブの WebSocket へ生テキストを送信する。
 */
export function dispatchTextToTab(
  tab: { ws?: WebSocket | null; sessionId?: string | null } | null | undefined,
  text: string,
): boolean {
  if (!tab?.ws || tab.ws.readyState !== WebSocket.OPEN) return false;
  tab.ws.send(new TextEncoder().encode(text));
  useAgentStateStore().clearSessionNotifyBadges(tab.sessionId);
  return true;
}
