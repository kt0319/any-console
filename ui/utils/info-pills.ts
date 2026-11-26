// Info Pills の種別定義テーブル。設定ストア・設定画面・ピル・peek アイコンはここから導出する。
// 追加時は server/src/settings.rs の INFO_PILL_FIELDS にも同じキーを足す（settings.rs のテストが整合を検証）。
// 並び順はデフォルト表示順。

export const INFO_PILLS = [
  {
    key: "files",
    label: "Workspace",
    note: "Opens the files browser. Shown for any terminal with an active session, Git or not.",
    peekIcon: "mdi-folder-outline",
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
    note: "Current branch name, with push/pull counts badged on top when the branch has commits to push or pull. Also opens commit history for the workspace.",
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
    // アイコン・色は WorkspaceDetail.vue の Actions タブと同じ固定値。
    peekIcon: "mdi-cog-play-outline",
    peekColor: "pill-peek-brown",
  },
  {
    key: "devserver",
    label: "Dev Server",
    note: "Only shown when a dev server is auto-detected listening in this workspace's directory.",
    peekIcon: "mdi-server",
    peekColor: "pill-peek-lime",
  },
  {
    key: "docker",
    label: "Docker",
    note: "Only shown while a Docker Compose container from this workspace's directory is running.",
    peekIcon: "mdi-docker",
    peekColor: "pill-peek-docker",
  },
  {
    key: "issues",
    label: "GitHub Issues",
    note: "Only shown while the workspace has open GitHub issues.",
    // アイコン・色ともWorkspaceDetail.vueのIssuesタブと揃える（issue有りで黄色）。
    peekIcon: "mdi-ticket-confirmation-outline",
    peekColor: "pill-peek-warning",
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

export const INFO_PILL_FIELDS = INFO_PILLS.map((p) => p.key);

// ピル一覧に無いpeek専用キー（「検出されなくなった」通知・ジョブ自動検知で対応するピルが無い）。
const PEEK_ONLY_ICONS: Record<string, string> = { "devserver-stop": "mdi-server-off", job: "mdi-play-circle-outline" };

/** ピル本体・peek のアイコンクラス。対応ピルが無いキーは空文字（テンプレートが直接描画）。 */
export function peekIconForKey(key: string | null | undefined): string {
  if (key && key in PEEK_ONLY_ICONS) return PEEK_ONLY_ICONS[key];
  return INFO_PILLS.find((p) => p.key === key)?.peekIcon || "";
}

// GitHub Actions の status/conclusion を peekColorForKey 用の4段階に丸める。
const ACTIONS_STATUS_COLOR_BUCKET: Record<string, string> = {
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
 * peek ピルの色クラス。branch はアイコンだけ状態色（pill-peek-icon-only）。
 * actions はアイコンをブラウン固定、ステータス部分のみ状態色+bold（PillPeek.vue で2spanに分割）。
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
