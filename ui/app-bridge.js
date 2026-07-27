import { debugLog } from "./composables/useClientLogs.js";

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
  "oskeyboard:hide",
  "oskeyboard:show",
  "preview:showPorts",
  "settings:closed",
  "settings:open",
  "snippet:add",
  "snippet:delete",
  "snippet:use",
  "tab:close",
  "tab:refresh",
  "tab:select",
  "terminal:launch",
  "terminal:url",
  "toast:show",
  "workspace:openAdd",
  "workspace:openModal",
  "worktree:open",
]);

const KNOWN_EVENTS = new Set(BUS_EVENTS);

function checkEventName(where, event) {
  if (!KNOWN_EVENTS.has(event)) {
    debugLog(
      "[Event] ⚠ unknown event name in",
      `${where}():`,
      event,
      "— typo か、未登録なら app-bridge.js の BUS_EVENTS に追記すること"
    );
  }
}

const bus = new EventTarget();

export function emit(event, detail) {
  checkEventName("emit", event);
  debugLog("[Event]", event, detail ?? "");
  bus.dispatchEvent(new CustomEvent(event, { detail }));
}

export function on(event, handler) {
  checkEventName("on", event);
  const wrapper = (e) => handler(e.detail);
  bus.addEventListener(event, wrapper);
  return () => bus.removeEventListener(event, wrapper);
}
