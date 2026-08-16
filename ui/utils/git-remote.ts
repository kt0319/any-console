// pull/push/push-branch のラベル（"Pull"/"Push"）を過去形の一語に統一する
// （branch peekの表記"Pushed"/"Pulled"と揃える）。該当しないラベルは
// 呼び出し元がこの関数を使わないため、フォールバックとして残すのみ。
const PAST_TENSE_VERB: Record<string, string> = { Pull: "Pulled", Push: "Pushed", "Push (set upstream)": "Pushed" };
// コミット0件の時は「実行はできたが変化は無かった」ことが伝わるよう、
// Pulled/Pushedとは別の文言にする（新着コミットを拾えなかった不具合と
// 見分けが付かなくなるのを避けるため）。
const ZERO_COMMIT_TEXT: Record<string, string> = {
  Pull: "Already up to date",
  Push: "Nothing to push",
  "Push (set upstream)": "Nothing to push",
};

export function formatRemoteToast(
  wsName: string,
  label: string,
  data: { commits?: { count?: number, messages?: unknown[] } } | null | undefined,
) {
  const commits = data?.commits;
  const count = commits?.count || 0;
  if (count === 0) {
    const text = ZERO_COMMIT_TEXT[label] || `${label} done (no changes)`;
    return `${wsName}: ${text}`;
  }
  const verb = PAST_TENSE_VERB[label] || `${label} done`;
  const header = `${wsName}: ${verb} (${count} commit${count === 1 ? "" : "s"})`;
  const messages = Array.isArray(commits?.messages) ? commits.messages : [];
  const subjects = messages.map((m) => String(m).split("\n")[0]);
  if (!subjects.length) return header;
  const lines = [header, ...subjects.map((s) => `• ${s}`)];
  const remaining = count - subjects.length;
  if (remaining > 0) {
    lines.push(`… and ${remaining} more`);
  }
  return lines.join("\n");
}
