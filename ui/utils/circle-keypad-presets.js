// サークルキーパッドの各キーは「モディファイア（None/Ctrl/Shift/Alt の組み合わせ）」+
// 「ベースキー（矢印・文字・特殊キー）」の直積で組み立てる。手作りの固定プリセットリストより
// 組み合わせを広く網羅できる。

export const RADIAL_MODIFIER_OPTIONS = [
  { id: "none",           label: "—",              ctrl: false, shift: false, alt: false },
  { id: "shift",          label: "Shift",          ctrl: false, shift: true,  alt: false },
  { id: "ctrl",           label: "Ctrl",           ctrl: true,  shift: false, alt: false },
  { id: "alt",            label: "Alt",            ctrl: false, shift: false, alt: true },
  { id: "ctrl_shift",     label: "Ctrl+Shift",     ctrl: true,  shift: true,  alt: false },
  { id: "ctrl_alt",       label: "Ctrl+Alt",       ctrl: true,  shift: false, alt: true },
  { id: "shift_alt",      label: "Shift+Alt",      ctrl: false, shift: true,  alt: true },
  { id: "ctrl_shift_alt", label: "Ctrl+Shift+Alt", ctrl: true,  shift: true,  alt: true },
];

const LETTER_BASE_KEYS = Array.from({ length: 26 }, (_, i) => {
  const ch = String.fromCharCode(97 + i);
  return { id: ch, label: ch.toUpperCase() };
});

export const RADIAL_BASE_KEYS = [
  { id: "ArrowUp",    label: "↑" },
  { id: "ArrowDown",  label: "↓" },
  { id: "ArrowLeft",  label: "←" },
  { id: "ArrowRight", label: "→" },
  { id: "Tab",        label: "Tab" },
  { id: "Enter",      label: "↵" },
  { id: "Escape",     label: "Esc" },
  { id: "Backspace",  label: "BS" },
  { id: "Delete",     label: "Del" },
  { id: "Home",       label: "Home" },
  { id: "End",        label: "End" },
  { id: "PageUp",     label: "PgUp" },
  { id: "PageDown",   label: "PgDn" },
  { id: " ",          label: "Space" },
  ...LETTER_BASE_KEYS,
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

// デフォルトの 8 方向キー（N から時計回り）。modifier は RADIAL_MODIFIER_OPTIONS の id。
export const DEFAULT_RADIAL_KEY_DEFS = [
  { modifier: "none", key: "ArrowUp" },
  { modifier: "none", key: "Tab" },
  { modifier: "none", key: "ArrowRight" },
  { modifier: "none", key: "Enter" },
  { modifier: "none", key: "ArrowDown" },
  { modifier: "none", key: "Escape" },
  { modifier: "none", key: "ArrowLeft" },
  { modifier: "ctrl", key: "c" },
];

// 四隅の位置（左上 / 右上 / 左下 / 右下）と既定の割り当て。
export const RADIAL_CORNER_LABELS = ["Top-Left", "Top-Right", "Bottom-Left", "Bottom-Right"];
export const DEFAULT_RADIAL_SPECIALS = ["workspace", "jobs", "selcopy", "settings"];

export function findModifierOption(id) {
  return RADIAL_MODIFIER_OPTIONS.find((m) => m.id === id) || RADIAL_MODIFIER_OPTIONS[0];
}

export function findBaseKey(id) {
  return RADIAL_BASE_KEYS.find((k) => k.id === id) || null;
}

export function findSpecialPreset(id) {
  return RADIAL_SPECIAL_PRESETS.find((p) => p.id === id) || null;
}

// keyDef の ctrl/shift/alt から一致するモディファイア id を逆引きする。
export function modifierIdOf(keyDef) {
  const match = RADIAL_MODIFIER_OPTIONS.find((m) =>
    !!m.ctrl === !!keyDef?.ctrl && !!m.shift === !!keyDef?.shift && !!m.alt === !!keyDef?.alt
  );
  return match?.id || "none";
}

// keyDef.key が既知のベースキーなら id、そうでなければ空文字。
export function baseKeyIdOf(keyDef) {
  return RADIAL_BASE_KEYS.some((k) => k.id === keyDef?.key) ? keyDef.key : "";
}

export function radialKeyLabel(modifierId, keyId) {
  const mod = findModifierOption(modifierId);
  const bk = findBaseKey(keyId);
  const keyLabel = bk?.label || keyId || "";
  return mod.id === "none" ? keyLabel : `${mod.label}+${keyLabel}`;
}

export function defaultKeyDefs() {
  return DEFAULT_RADIAL_KEY_DEFS.map(({ modifier, key }) => {
    const mod = findModifierOption(modifier);
    return {
      key,
      ctrl: mod.ctrl,
      shift: mod.shift,
      alt: mod.alt,
      label: radialKeyLabel(modifier, key),
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
