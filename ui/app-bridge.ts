import { debugLog } from "./composables/useClientLogs.ts";

// アプリ内イベントバスのイベント名カタログ（単一の出所）。emit / on は載った名前だけを使い、未登録名はデバッグモードで警告される。
export const BUS_EVENTS = Object.freeze([
  "command-palette:open",
  "connectivity:back",
  "dispatch:itemRemoved",
  "files:opDone",
  "git:actionResult",
  "git:browseToFolder",
  "git:clearDiffSelection",
  "git:historyInvalidated",
  "git:openFileModal",
  "git:openGitHub",
  "git:selectDiffFile",
  "github:activity",
  "jobs:refresh",
  "keyboard:deactivate",
  "keyboard:setDraft",
  "layout:fitAll",
  "modal:close",
  "notification:openSession",
  "session:jobBound",
  "session:workspaceBound",
  "settings:open",
  "tab:close",
  "tab:reconnect",
  "tab:select",
  "terminal:launch",
  "terminal:path",
  "terminal:url",
  "toast:dismiss",
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
