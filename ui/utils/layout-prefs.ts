// 折りたたみスマホ等、画面幅が変化する端末向けの表示設定。
// 「狭い（ナロー、折りたたみ時/縦持ちスマホ相当）」「広い（ワイド、展開時/PC相当）」
// の2状態それぞれにタブバー位置・Keyboard bar表示・タイトルバー位置を個別に
// 持たせる（layout.ts の isNarrowViewport による幅判定と組み合わせて使う）。

export type TabPosition = "top" | "bottom";
// タイトルバー（ScreenMain.vueの.active-tab-title）は非表示もあるため
// TabPositionとは別の3値にする。"off"は非表示、それ以外はタブバー位置と
// 独立に画面のTop/Bottomどちらに出すかを表す。
export type TitleBarPosition = "off" | "top" | "bottom";

export interface LayoutPrefs {
  narrowTabPosition: TabPosition;
  wideTabPosition: TabPosition;
  narrowKeyboardBar: boolean;
  wideKeyboardBar: boolean;
  narrowTitleBarPosition: TitleBarPosition;
  wideTitleBarPosition: TitleBarPosition;
}

// 現状の自動判定（MOBILE_BREAKPOINT_PXを境に下タブ+Keyboard bar表示+タイトル
// バーBottom表示 / 上タブ+Keyboard bar非表示+タイトルバー非表示）と一致させる。
// 設定を一度も変更していないユーザーには挙動の変化が無いようにするため。
export const DEFAULT_LAYOUT_PREFS: LayoutPrefs = {
  narrowTabPosition: "bottom",
  wideTabPosition: "top",
  narrowKeyboardBar: true,
  wideKeyboardBar: false,
  narrowTitleBarPosition: "bottom",
  wideTitleBarPosition: "off",
};

function normalizeTabPosition(value: unknown, fallback: TabPosition): TabPosition {
  return value === "top" || value === "bottom" ? value : fallback;
}

function normalizeTitleBarPosition(value: unknown, fallback: TitleBarPosition): TitleBarPosition {
  return value === "off" || value === "top" || value === "bottom" ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// localStorageの内容は他バージョンでの保存形式変化や手動編集で壊れている
// 可能性があるため、キーごとに既定値へフォールバックしつつマージする。
export function normalizeLayoutPrefs(raw: unknown): LayoutPrefs {
  const r = (raw && typeof raw === "object") ? raw as Partial<LayoutPrefs> : {};
  return {
    narrowTabPosition: normalizeTabPosition(r.narrowTabPosition, DEFAULT_LAYOUT_PREFS.narrowTabPosition),
    wideTabPosition: normalizeTabPosition(r.wideTabPosition, DEFAULT_LAYOUT_PREFS.wideTabPosition),
    narrowKeyboardBar: normalizeBoolean(r.narrowKeyboardBar, DEFAULT_LAYOUT_PREFS.narrowKeyboardBar),
    wideKeyboardBar: normalizeBoolean(r.wideKeyboardBar, DEFAULT_LAYOUT_PREFS.wideKeyboardBar),
    narrowTitleBarPosition: normalizeTitleBarPosition(r.narrowTitleBarPosition, DEFAULT_LAYOUT_PREFS.narrowTitleBarPosition),
    wideTitleBarPosition: normalizeTitleBarPosition(r.wideTitleBarPosition, DEFAULT_LAYOUT_PREFS.wideTitleBarPosition),
  };
}

export function resolveTabPosition(prefs: LayoutPrefs, isNarrow: boolean): TabPosition {
  return isNarrow ? prefs.narrowTabPosition : prefs.wideTabPosition;
}

export function resolveKeyboardBarVisible(prefs: LayoutPrefs, isNarrow: boolean): boolean {
  return isNarrow ? prefs.narrowKeyboardBar : prefs.wideKeyboardBar;
}

export function resolveTitleBarPosition(prefs: LayoutPrefs, isNarrow: boolean): TitleBarPosition {
  return isNarrow ? prefs.narrowTitleBarPosition : prefs.wideTitleBarPosition;
}
