// サークルキーパッドの 8 方向に割り当て可能なキープリセット。
// 順序は UI のドロップダウン表示順 = サークルの N から時計回り。
export const RADIAL_KEY_PRESETS = [
  { id: "up",       label: "↑",     keyDef: { key: "ArrowUp" } },
  { id: "down",     label: "↓",     keyDef: { key: "ArrowDown" } },
  { id: "left",     label: "←",     keyDef: { key: "ArrowLeft" } },
  { id: "right",    label: "→",     keyDef: { key: "ArrowRight" } },
  { id: "tab",      label: "Tab",   keyDef: { key: "Tab" } },
  { id: "shifttab", label: "S-Tab", keyDef: { key: "Tab", shift: true } },
  { id: "enter",    label: "↵",     keyDef: { key: "Enter" } },
  { id: "esc",      label: "Esc",   keyDef: { key: "Escape" } },
  { id: "bs",       label: "BS",    keyDef: { key: "Backspace" } },
  { id: "del",      label: "Del",   keyDef: { key: "Delete" } },
  { id: "home",     label: "Home",  keyDef: { key: "Home" } },
  { id: "end",      label: "End",   keyDef: { key: "End" } },
  { id: "pgup",     label: "PgUp",  keyDef: { key: "PageUp" } },
  { id: "pgdn",     label: "PgDn",  keyDef: { key: "PageDown" } },
  { id: "space",    label: "␣",     keyDef: { key: " " } },
  { id: "ctrl_a",   label: "^A",    keyDef: { key: "a", ctrl: true } },
  { id: "ctrl_b",   label: "^B",    keyDef: { key: "b", ctrl: true } },
  { id: "ctrl_c",   label: "^C",    keyDef: { key: "c", ctrl: true } },
  { id: "ctrl_d",   label: "^D",    keyDef: { key: "d", ctrl: true } },
  { id: "ctrl_e",   label: "^E",    keyDef: { key: "e", ctrl: true } },
  { id: "ctrl_k",   label: "^K",    keyDef: { key: "k", ctrl: true } },
  { id: "ctrl_l",   label: "^L",    keyDef: { key: "l", ctrl: true } },
  { id: "ctrl_n",   label: "^N",    keyDef: { key: "n", ctrl: true } },
  { id: "ctrl_p",   label: "^P",    keyDef: { key: "p", ctrl: true } },
  { id: "ctrl_r",   label: "^R",    keyDef: { key: "r", ctrl: true } },
  { id: "ctrl_u",   label: "^U",    keyDef: { key: "u", ctrl: true } },
  { id: "ctrl_w",   label: "^W",    keyDef: { key: "w", ctrl: true } },
  { id: "ctrl_z",   label: "^Z",    keyDef: { key: "z", ctrl: true } },
];

// 四隅の特殊メニューに割り当て可能なアクション。
export const RADIAL_SPECIAL_PRESETS = [
  { id: "selcopy",   label: "Sel & Copy", action: "selection:open" },
  { id: "workspace", label: "Workspace",  action: "workspace:openModal" },
  { id: "jobs",      label: "Jobs",       action: "git:openFileModal", payload: { pane: "jobs" } },
  { id: "settings",  label: "Settings",   action: "settings:open" },
  { id: "snippets",  label: "Snippets",   action: "settings:open", payload: { view: "SnippetConfig" } },
  { id: "tabs",      label: "Tabs",       action: "settings:open", payload: { view: "TabConfig" } },
  { id: "auth",      label: "Auth",       action: "settings:open", payload: { view: "AuthConfig" } },
  { id: "sysinfo",   label: "System",     action: "settings:open", payload: { view: "ServerInfo" } },
  { id: "preview",   label: "Preview",    action: "settings:open", payload: { view: "PreviewConfig" } },
  { id: "reload",    label: "Reload",     action: "app:reload" },
  { id: "refresh",   label: "Refresh",    action: "tab:refresh" },
  { id: "totop",     label: "To Top",     action: "terminal:scrollToTop" },
  { id: "tobottom",  label: "To Bottom",  action: "terminal:scrollToBottom" },
  { id: "clear",     label: "Clear",      action: "terminal:clear" },
  { id: "paste",     label: "Paste",      action: "terminal:paste" },
  { id: "files",     label: "Files",      action: "git:openFileModal", payload: { pane: "files" } },
  { id: "history",   label: "History",    action: "git:openFileModal", payload: { pane: "history" } },
  { id: "changes",   label: "Changes",    action: "git:openFileModal", payload: { pane: "changes" } },
  { id: "github",    label: "GitHub",     action: "git:openGitHub" },
  { id: "closetab",  label: "Close Tab",  action: "tab:close" },
  { id: "hidetab",   label: "Detach Tab", action: "tab:hide" },
  { id: "nexttab",   label: "Next Tab",   action: "tab:next" },
  { id: "prevtab",   label: "Prev Tab",   action: "tab:prev" },
  { id: "splittoggle", label: "Split",    action: "layout:splitToggle" },
  { id: "newterm",   label: "New Term",   action: "terminal:newForWorkspace" },
];

// 8 方向のラベル（N から時計回り）。
export const RADIAL_DIRECTION_LABELS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];

// デフォルトの 8 方向キー（N から時計回り）。
export const DEFAULT_RADIAL_KEYS = ["up", "tab", "right", "enter", "down", "esc", "left", "ctrl_c"];

// 四隅の位置（左上 / 右上 / 左下 / 右下）と既定の割り当て。
export const RADIAL_CORNER_LABELS = ["Top-Left", "Top-Right", "Bottom-Left", "Bottom-Right"];
export const DEFAULT_RADIAL_SPECIALS = ["workspace", "jobs", "selcopy", "settings"];

export function findKeyPreset(id) {
  return RADIAL_KEY_PRESETS.find((p) => p.id === id) || null;
}

export function findSpecialPreset(id) {
  return RADIAL_SPECIAL_PRESETS.find((p) => p.id === id) || null;
}

export function defaultKeyDefs() {
  return DEFAULT_RADIAL_KEYS.map((id) => {
    const p = findKeyPreset(id);
    if (!p) return { key: "", ctrl: false, shift: false, label: "" };
    return {
      key: p.keyDef.key,
      ctrl: !!p.keyDef.ctrl,
      shift: !!p.keyDef.shift,
      label: p.label,
    };
  });
}

export function defaultSpecialDefs() {
  return DEFAULT_RADIAL_SPECIALS.map((id) => {
    const p = findSpecialPreset(id);
    return p
      ? { label: p.label, action: p.action, payload: p.payload || null }
      : { label: "", action: "", payload: null };
  });
}
