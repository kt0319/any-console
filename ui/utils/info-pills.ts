// Info Pills（TerminalPaneのピル群）の種別ごとの定義を1箇所に集約する
// ディスクリプタテーブル。設定ストアのフィールド一覧・デフォルト表示順
// （ui/stores/info-pill-config.ts）、設定画面のトグルのラベル・説明
// （InfoPillConfig.vue）、ピル本体（InfoPillRow.vue）と peekピル
// （TerminalPane.vue）のアイコンはすべて
// ここから導出する。新しいピルを追加する時はまずこのテーブルへ1エントリ足す
// （バックエンド server/src/settings.rs の INFO_PILL_FIELDS にも同じキーを
// 追加する。settings.rs 内のユニットテストが両者の整合を検証している）。
//
// label / note はピル本体のツールチップ文言（TerminalPane.vue）に揃える。
// 並び順は設定画面・保存値が無い時のデフォルト表示順として使われる。

export const INFO_PILLS = [
  {
    key: "files",
    label: "Workspace",
    note: "Opens the files browser. Shown for any terminal with an active session, Git or not.",
    peekIcon: "mdi-folder-outline",
  },
  {
    key: "history",
    label: "History",
    note: "Browse commit history. Only shown for Git workspaces. Hovering shows the last commit message.",
    peekIcon: "mdi-history",
    peekColor: "pill-peek-accent",
  },
  {
    key: "changes",
    label: "Changes",
    note: "Uncommitted file/insertion/deletion counts. Only shown while the workspace has uncommitted changes.",
    peekIcon: "mdi-file-document-edit-outline",
    peekColor: "pill-peek-warning",
  },
  {
    key: "branch",
    label: "Branches",
    note: "Current branch name, with push/pull counts badged on top when the branch has commits to push or pull.",
    peekIcon: "mdi-source-branch",
    // 状態をアイコンだけで示し、テキスト（ブランチ名）は通常色のまま保つ。
    peekColor: ["pill-peek-success", "pill-peek-icon-only"],
  },
  {
    key: "prs",
    label: "GitHub PRs",
    note: "Only shown when the current branch has an open GitHub pull request.",
    peekIcon: "mdi-source-pull",
    peekColor: "pill-peek-purple",
  },
  {
    key: "actions",
    label: "GitHub Actions",
    note: "Only shown while the current branch's latest GitHub Actions run is running or failed (successful/other completed runs stay hidden).",
    // アイコン・色ともWorkspaceDetail.vueのActionsタブ/通常ピルと同じ固定値
    // （状態では変えない）。
    peekIcon: "mdi-cog-play-outline",
    peekColor: "pill-peek-brown",
  },
  {
    key: "devserver",
    label: "Dev Server",
    note: "Only shown when a dev server is auto-detected listening in this workspace's directory.",
    peekIcon: "mdi-server",
    // Dev Serverは通常ピルと同じアクセント色をアイコンだけに使う
    // （テキストはこのクラスで色付けしないため icon-only 不要）。
    peekColor: "pill-peek-accent",
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
    peekIcon: "mdi-inbox-arrow-down-outline",
    peekColor: "pill-peek-pink",
  },
];

// 設定のフィールド一覧 兼 デフォルト表示順（テーブルの並び＝デフォルト順）。
export const INFO_PILL_FIELDS = INFO_PILLS.map((p) => p.key);

// ピル一覧に無いpeek専用キー（「検出されなくなった」通知のみで対応するピルが無い）。
const PEEK_ONLY_ICONS = { "devserver-stop": "mdi-server-off" };

/**
 * ピル本体・peekピルに出すmdiアイコンクラス。対応するピルが無いキー
 * （workspace等）は空文字（テンプレート側が実アイコンを直接描画する）。
 */
export function peekIconForKey(key: string | null | undefined): string {
  if (key && key in PEEK_ONLY_ICONS) return PEEK_ONLY_ICONS[key];
  return INFO_PILLS.find((p) => p.key === key)?.peekIcon || "";
}

// GitHub Actionsのstatus/conclusionを4段階の色バケットへ丸める
// （peekColorForKey専用。conclusion値の一覧はGitHub API仕様参照:
// success/failure/neutral/cancelled/skipped/timed_out/action_required/stale）。
const ACTIONS_STATUS_COLOR_BUCKET = {
  success: "success",
  failure: "failure",
  timed_out: "failure",
  action_required: "running",
  cancelled: "neutral",
  skipped: "neutral",
  neutral: "neutral",
  stale: "neutral",
};

/**
 * peekピルの色クラス。対応する通常ピルのアイコン色と揃える。
 * history/branchはアイコンだけ状態色にし、テキストは通常色（白）のまま
 * 読みやすく保つ（pill-peek-icon-only。changes/prsはテキストごと色付け）。
 * actionsはアイコンを常にブラウン固定にし（pill-peek-brownを常に含める）、
 * 名前部分は白、ステータス部分だけをpush/pullのPushed/Pulled表示と同様に
 * 色付け+boldにする（branchAction.status/conclusion。PillPeek.vue側で
 * .pill-peek-actions-name/.pill-peek-actions-statusの2spanに分けて描画
 * する）。実行中系=warning、成功=success、失敗系=error、cancelled/skipped等
 * の実害の無い終了=neutral（text-muted）と、全状態に必ず何らかの色が付く。
 */
export function peekColorForKey(
  key: string | null | undefined,
  fields?: { branchAction?: { status?: string; conclusion?: string } | null } | null,
): string | string[] {
  if (key === "actions") {
    const run = fields?.branchAction;
    if (run) {
      if (run.status !== "completed") return ["pill-peek-brown", "pill-peek-actions-running"];
      const bucket = ACTIONS_STATUS_COLOR_BUCKET[run.conclusion ?? ""] || "neutral";
      return ["pill-peek-brown", `pill-peek-actions-${bucket}`];
    }
    return "pill-peek-brown";
  }
  return INFO_PILLS.find((p) => p.key === key)?.peekColor || "";
}
