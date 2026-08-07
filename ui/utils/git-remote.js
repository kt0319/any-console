// pull/push/push-branch のラベル（"Pull"/"Push"）を過去形の一語に統一する
// （branch peekの表記"Pushed"/"Pulled"と揃える）。該当しないラベルは
// 呼び出し元がこの関数を使わないため、フォールバックとして残すのみ。
const PAST_TENSE_VERB = { Pull: "Pulled", Push: "Pushed" };

export function formatRemoteToast(wsName, label, data) {
  const commits = data?.commits;
  const count = commits?.count || 0;
  const verb = PAST_TENSE_VERB[label] || `${label} done`;
  const header = count > 0
    ? `${wsName}: ${verb} (${count} commit${count === 1 ? "" : "s"})`
    : `${wsName}: ${verb}`;
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
