// narrow / wide の2状態それぞれにタブバー位置・Keyboard bar・タイトルバー・Info Pills を個別に持つ（幅判定は layout.ts の isNarrowViewport）。

export type TabPosition = "top" | "bottom";
// 非表示（"off"）があるため TabPosition とは別の3値。top/bottom はタブバー位置とは独立。
export type TitleBarPosition = "off" | "top" | "bottom";
// 表示時の幅（セッションサイドバー分を空けるか全幅か）も持つ3値。サイドバーはワイドのみのため narrow には無い。
export type WideKeyboardBarMode = "off" | "sidebar" | "full";
// Info Pills の表示モード。float-* はターミナルに重ね、bar-* は各ペイン上部/下部に帯で固定する。
export type InfoPillDisplayMode = "off" | "float-top" | "float-bottom" | "bar-top" | "bar-bottom";

export interface LayoutPrefs {
  narrowTabPosition: TabPosition;
  wideTabPosition: TabPosition;
  narrowKeyboardBar: boolean;
  wideKeyboardBarMode: WideKeyboardBarMode;
  narrowTitleBarPosition: TitleBarPosition;
  wideTitleBarPosition: TitleBarPosition;
  narrowInfoPillMode: InfoPillDisplayMode;
  wideInfoPillMode: InfoPillDisplayMode;
}

// 設定未変更のユーザーの見た目が変わらないよう、従来の幅による自動判定（MOBILE_BREAKPOINT_PX 境）と一致させる。
export const DEFAULT_LAYOUT_PREFS: LayoutPrefs = {
  narrowTabPosition: "bottom",
  wideTabPosition: "top",
  narrowKeyboardBar: true,
  wideKeyboardBarMode: "off",
  narrowTitleBarPosition: "bottom",
  wideTitleBarPosition: "off",
  // 旧挙動の「タブバー位置にpillが追従」と同じ見た目を保つ
  narrowInfoPillMode: "float-bottom",
  wideInfoPillMode: "float-top",
};

function normalizeTabPosition(value: unknown, fallback: TabPosition): TabPosition {
  return value === "top" || value === "bottom" ? value : fallback;
}

function normalizeTitleBarPosition(value: unknown, fallback: TitleBarPosition): TitleBarPosition {
  return value === "off" || value === "top" || value === "bottom" ? value : fallback;
}

function normalizeWideKeyboardBarMode(value: unknown, fallback: WideKeyboardBarMode): WideKeyboardBarMode {
  return value === "off" || value === "sidebar" || value === "full" ? value : fallback;
}

// 旧バージョンの保存値 "float" / "bar" を読み替える。legacyFloat は narrow/wide の既定位置に合わせる。
function normalizeInfoPillDisplayMode(
  value: unknown,
  fallback: InfoPillDisplayMode,
  legacyFloat: "float-top" | "float-bottom",
): InfoPillDisplayMode {
  if (value === "bar") return "bar-top";
  if (value === "float") return legacyFloat;
  return value === "off" || value === "float-top" || value === "float-bottom" || value === "bar-top" || value === "bar-bottom"
    ? value
    : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// localStorage は形式変化や手動編集で壊れうるため、キーごとに既定値へ戻しつつマージする。
export function normalizeLayoutPrefs(raw: unknown): LayoutPrefs {
  const r = (raw && typeof raw === "object") ? raw as Partial<LayoutPrefs> : {};
  return {
    narrowTabPosition: normalizeTabPosition(r.narrowTabPosition, DEFAULT_LAYOUT_PREFS.narrowTabPosition),
    wideTabPosition: normalizeTabPosition(r.wideTabPosition, DEFAULT_LAYOUT_PREFS.wideTabPosition),
    narrowKeyboardBar: normalizeBoolean(r.narrowKeyboardBar, DEFAULT_LAYOUT_PREFS.narrowKeyboardBar),
    wideKeyboardBarMode: normalizeWideKeyboardBarMode(r.wideKeyboardBarMode, DEFAULT_LAYOUT_PREFS.wideKeyboardBarMode),
    narrowTitleBarPosition: normalizeTitleBarPosition(r.narrowTitleBarPosition, DEFAULT_LAYOUT_PREFS.narrowTitleBarPosition),
    wideTitleBarPosition: normalizeTitleBarPosition(r.wideTitleBarPosition, DEFAULT_LAYOUT_PREFS.wideTitleBarPosition),
    narrowInfoPillMode: normalizeInfoPillDisplayMode(r.narrowInfoPillMode, DEFAULT_LAYOUT_PREFS.narrowInfoPillMode, "float-bottom"),
    wideInfoPillMode: normalizeInfoPillDisplayMode(r.wideInfoPillMode, DEFAULT_LAYOUT_PREFS.wideInfoPillMode, "float-top"),
  };
}

export function resolveTabPosition(prefs: LayoutPrefs, isNarrow: boolean): TabPosition {
  return isNarrow ? prefs.narrowTabPosition : prefs.wideTabPosition;
}

export function resolveKeyboardBarVisible(prefs: LayoutPrefs, isNarrow: boolean): boolean {
  return isNarrow ? prefs.narrowKeyboardBar : prefs.wideKeyboardBarMode !== "off";
}

// 狭い画面はサイドバーが無いため常に true。
export function resolveKeyboardBarFullWidth(prefs: LayoutPrefs, isNarrow: boolean): boolean {
  return isNarrow || prefs.wideKeyboardBarMode === "full";
}

export function resolveTitleBarPosition(prefs: LayoutPrefs, isNarrow: boolean): TitleBarPosition {
  return isNarrow ? prefs.narrowTitleBarPosition : prefs.wideTitleBarPosition;
}

export function resolveInfoPillDisplayMode(prefs: LayoutPrefs, isNarrow: boolean): InfoPillDisplayMode {
  return isNarrow ? prefs.narrowInfoPillMode : prefs.wideInfoPillMode;
}

export function isInfoPillBarMode(mode: InfoPillDisplayMode): boolean {
  return mode === "bar-top" || mode === "bar-bottom";
}
