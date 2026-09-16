/**
 * ローカルブランチ一覧行の削除確認ダイアログを表示する。
 *
 * @param confirm `useConfirm()` から取得した confirm 関数。
 * @param branch 削除対象のブランチ。
 * @param opts.worktreeDesc 指定時のみ「Remove worktree」選択肢を出す（このブランチに
 *   worktreeが紐づく場合のみ呼び出し側が渡す）。
 * @returns true: ローカルのみ削除 / "remote": ローカル+リモート削除 /
 *          "worktree": worktree削除 / false: キャンセル
 */
export function confirmDeleteBranch(
  confirm: (msg: string, opts?: object) => Promise<boolean | string>,
  branch: { name: string },
  opts: { worktreeDesc?: string } = {},
): Promise<boolean | string> {
  return confirm(`Delete branch "${branch.name}"? This cannot be undone.`, {
    extra: {
      label: "Local + remote",
      value: "remote",
      icon: "mdi-delete-sweep",
      desc: "Also deletes the branch on origin (git push origin --delete).",
    },
    ...(opts.worktreeDesc
      ? {
          extra2: {
            label: "Remove worktree",
            value: "worktree",
            icon: "mdi-file-tree",
            desc: opts.worktreeDesc,
          },
        }
      : {}),
    ok: { label: "Local only", icon: "mdi-delete", danger: true },
  });
}
