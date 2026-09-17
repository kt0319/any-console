// 折りたたみスマホ等、画面幅が変化する端末向けの表示設定。
// 「狭い（ナロー、折りたたみ時/縦持ちスマホ相当）」「広い（ワイド、展開時/PC相当）」
// の2状態それぞれにタブバー位置・Keyboard bar表示・タイトルバー位置を個別に
// 持たせる（layout.ts の isNarrowViewport による幅判定と組み合わせて使う）。

export type TabPosition = "top" | "bottom";
// タイトルバー（ScreenMain.vueの.active-tab-title）は非表示もあるため
// TabPositionとは別の3値にする。"off"は非表示、それ以外はタブバー位置と
// 独立に画面のTop/Bottomどちらに出すかを表す。
export type TitleBarPosition = "off" | "top" | "bottom";
// Keyboard bar（ワイド画面）はタイトルバーと同じくOff/表示の2値に加え、表示時の
// 幅（セッションサイドバー分を空けるか、全体幅にするか）も持つため3値にする。
// セッションサイドバーはワイド画面でのみ開けるため、この幅モードもワイドのみ
// 持たせる（狭い画面では常にフル幅表示になり選択の余地が無い）。
export type WideKeyboardBarMode = "off" | "sidebar" | "full";
// Info Pills（ターミナルペインのステータスアイコン群）の表示モード。
// off=非表示、float-top/float-bottom=ターミナルに重ねて浮かせる、
// bar-top/bar-bottom=各ペインの上部/下部に帯で固定表示。Keyboard barの
// wideKeyboardBarMode（off/sidebar/full）と同じく、モードと表示位置を
// 1つのフラットな値にまとめている。
// Keyboard barと異なりセッションサイドバーとは無関係な機能のため、narrow/wide
// どちらも同じ5値を独立して持てる。
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

// 現状の自動判定（MOBILE_BREAKPOINT_PXを境に下タブ+Keyboard bar表示+タイトル
// バーBottom表示 / 上タブ+Keyboard bar非表示+タイトルバー非表示）と一致させる。
// 設定を一度も変更していないユーザーには挙動の変化が無いようにするため。
export const DEFAULT_LAYOUT_PREFS: LayoutPrefs = {
  narrowTabPosition: "bottom",
  wideTabPosition: "top",
  narrowKeyboardBar: true,
  wideKeyboardBarMode: "off",
  narrowTitleBarPosition: "bottom",
  wideTitleBarPosition: "off",
  // 従来のfloatは「タブバーがbottomならpillもbottom」に自動追従していた
  // （狭い画面の既定タブ位置はbottom、広い画面はtop）。位置を明示選択制に
  // した後もこの既定の見た目を保つため、narrow/wideそれぞれの初期値を
  // その結果に合わせて分ける。
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

// 旧バージョンで保存された値（位置選択が無かった頃の唯一のfloat/bar値）を
// 読み替える。legacyFloatは呼び出し側（narrow/wide）の既定位置に合わせる
// （DEFAULT_LAYOUT_PREFSの初期値決定と同じ理由）。
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

// localStorageの内容は他バージョンでの保存形式変化や手動編集で壊れている
// 可能性があるため、キーごとに既定値へフォールバックしつつマージする。
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

// ワイド画面でKeyboard barを表示する時、セッションサイドバー分の幅を空けず
// 画面全体に広げるかどうか（狭い画面はサイドバー自体が無いため常にtrue）。
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
