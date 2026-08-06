// Info Pills（TerminalPaneのピル群）の種別ごとの定義を1箇所に集約する
// ディスクリプタテーブル。設定ストアのフィールド一覧・デフォルト表示順
// （ui/stores/info-pill-config.js）、設定画面のトグルのラベル・説明
// （InfoPillConfig.vue）、peekピルのアイコン（TerminalPane.vue）はすべて
// ここから導出する。新しいピルを追加する時はまずこのテーブルへ1エントリ足す
// （バックエンド api/routers/settings.py の INFO_PILL_FIELDS にも同じキーを
// 追加する。tests/test_api_settings.py が両者の整合を検証している）。
//
// label / note はピル本体のツールチップ文言（TerminalPane.vue）に揃える。
// 並び順は設定画面・保存値が無い時のデフォルト表示順として使われる。

export const INFO_PILLS = [
  {
    key: "files",
    label: "Workspace",
    note: "Shows the workspace's own icon (with a dirty-changes dot when applicable) and opens the files browser. Shown for any terminal with an active session, Git or not.",
    peekIcon: "mdi-folder-outline",
  },
  {
    key: "history",
    label: "History",
    note: "Browse commit history. Only shown for Git workspaces. Hovering shows the last commit message.",
    peekIcon: "mdi-history",
  },
  {
    key: "changes",
    label: "Changes",
    note: "Uncommitted file/insertion/deletion counts. Only shown while the workspace has uncommitted changes.",
    peekIcon: "mdi-file-document-edit-outline",
  },
  {
    key: "branch",
    label: "Branches",
    note: "Current branch name, with push/pull counts badged on top when the branch has commits to push or pull.",
    peekIcon: "mdi-source-branch",
  },
  {
    key: "prs",
    label: "GitHub PRs",
    note: "Only shown when the current branch has an open GitHub pull request.",
    peekIcon: "mdi-source-pull",
  },
  {
    key: "actions",
    label: "GitHub Actions",
    note: "Only shown while the current branch's latest GitHub Actions run is running or failed (successful/other completed runs stay hidden).",
    // アイコンはWorkspaceDetail.vueのActionsタブと同じ固定アイコンにし、
    // 状態はpeekの色クラスで示す（branch peekと同じ方式）。
    peekIcon: "mdi-cog-play-outline",
  },
  {
    key: "devserver",
    label: "Dev Server",
    note: "Only shown when a dev server is auto-detected listening in this workspace's directory.",
    peekIcon: "mdi-server",
  },
  {
    key: "add",
    label: "Add / Open",
    note: "Register or open the current directory as a workspace. Only shown for terminals not yet tied to a Git workspace.",
    peekIcon: "mdi-folder-plus-outline",
  },
  {
    key: "dispatch",
    label: "Dispatch",
    note: "Only shown when a /dispatch API request is waiting for approval against this workspace. Tapping it opens the request directly if there's just one, or the full queue if there are several.",
    peekIcon: "mdi-tray-full",
  },
];

// 設定のフィールド一覧 兼 デフォルト表示順（テーブルの並び＝デフォルト順）。
export const INFO_PILL_FIELDS = INFO_PILLS.map((p) => p.key);

// ピル一覧に無いpeek専用キー（「検出されなくなった」通知のみで対応するピルが無い）。
const PEEK_ONLY_ICONS = { "devserver-stop": "mdi-server-off" };

/**
 * peekピルに出すmdiアイコンクラス。対応するピルが無いキー（workspace等）は
 * 空文字（テンプレート側が実アイコンを直接描画する）。
 * @param {string | null | undefined} key
 * @returns {string}
 */
export function peekIconForKey(key) {
  if (key && key in PEEK_ONLY_ICONS) return PEEK_ONLY_ICONS[key];
  return INFO_PILLS.find((p) => p.key === key)?.peekIcon || "";
}
