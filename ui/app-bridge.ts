import { debugLog } from "./composables/useClientLogs.ts";

// アプリ内イベントバスで流れるイベント名のカタログ（単一の出所）。
//
// emit / on の両側はここに載った名前だけを使う。新しいイベントを足すときは
// この一覧にも追記する。未登録の名前で emit / on するとデバッグモード時に
// 警告が出るため、タイプミスや emit↔on 間の名前ズレが「沈黙して壊れる」のでは
// なく可視化される（カタログ自体の更新漏れも同様に可視化されるので、ここが
// 新たなサイレントな同期点にはならない）。
export const BUS_EVENTS = Object.freeze([
  "connectivity:back",
  "dispatch:itemRemoved",
  "git:browseToFolder",
  "git:checkoutBranch",
  "git:commitDone",
  "git:openFileModal",
  "git:openGitHub",
  "git:openHistory",
  "git:selectDiffFile",
  "git:selectDirty",
  "git:stashSave",
  "jobs:refresh",
  "keyboard:deactivate",
  "keyboard:setDraft",
  "layout:fitAll",
  "modal:close",
  "notification:open-session",
  "settings:open",
  "tab:close",
  "tab:refresh",
  "tab:select",
  "terminal:launch",
  "terminal:url",
  "toast:show",
  "workspace:openModal",
  "worktree:open",
]);

const KNOWN_EVENTS = new Set(BUS_EVENTS);

function checkEventName(where: "emit" | "on", event: string) {
  if (!KNOWN_EVENTS.has(event)) {
    debugLog(
      "[Event] ⚠ unknown event name in",
      `${where}():`,
      event,
      "— typo か、未登録なら app-bridge.ts の BUS_EVENTS に追記すること"
    );
  }
}

const bus = new EventTarget();

export function emit(event: string, detail?: unknown) {
  checkEventName("emit", event);
  debugLog("[Event]", event, detail ?? "");
  bus.dispatchEvent(new CustomEvent(event, { detail }));
}

export function on(event: string, handler: (detail: any) => void): () => void {
  checkEventName("on", event);
  const wrapper = (e: Event) => handler((e as CustomEvent).detail);
  bus.addEventListener(event, wrapper);
  return () => bus.removeEventListener(event, wrapper);
}
