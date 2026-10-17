import { PILL_PEEK_SUBJECT_MAX } from "./constants.ts";

// pull/push/push-branch のラベル（"Pull"/"Push"）を過去形の一語に統一する
// （branch peekの表記"Pushed"/"Pulled"と揃える）。呼び出し元
// （useGitRemoteAction の PUSH_PULL_ACTIONS）はこの3ラベルしか渡さない。
export type RemoteLabel = "Pull" | "Push" | "Push (set upstream)";
export type RemoteResultKind = "push" | "pull" | "none";

/** branch peekに出す pull/push 等の結果。headline は色付きの要約、detail は件名等の補足。 */
export interface RemoteResult {
  kind: RemoteResultKind;
  headline: string;
  detail: string;
}

const PAST_TENSE_VERB: Record<RemoteLabel, string> = { Pull: "Pulled", Push: "Pushed", "Push (set upstream)": "Pushed" };
// コミット0件の時は「実行はできたが変化は無かった」ことが伝わるよう、
// Pulled/Pushedとは別の文言にする（新着コミットを拾えなかった不具合と
// 見分けが付かなくなるのを避けるため）。
const ZERO_COMMIT_TEXT: Record<RemoteLabel, string> = {
  Pull: "Already up to date",
  Push: "Nothing to push",
  "Push (set upstream)": "Nothing to push",
};
const DETAIL_SEPARATOR = " • ";

/**
 * コミット件名を連結する。total が件名数より多い時は末尾に残件数を付ける。
 * （サーバ応答の commits.messages / git-log の先頭N件のどちらにも使う）
 */
export function formatCommitSubjects(subjects: string[], total: number): string {
  if (!subjects.length) return "";
  const text = subjects.join(DETAIL_SEPARATOR);
  const remaining = total - subjects.length;
  return remaining > 0 ? `${text} … and ${remaining} more` : text;
}

export function buildRemoteResult(
  label: RemoteLabel,
  data: { commits?: { count?: number, messages?: unknown[] } } | null | undefined,
): RemoteResult {
  const commits = data?.commits;
  const count = commits?.count || 0;
  if (count === 0) {
    return { kind: "none", headline: ZERO_COMMIT_TEXT[label], detail: "" };
  }
  const messages = Array.isArray(commits?.messages) ? commits.messages : [];
  const subjects = messages.slice(0, PILL_PEEK_SUBJECT_MAX).map((m) => String(m).split("\n")[0]);
  return {
    kind: label === "Pull" ? "pull" : "push",
    headline: `${count} ${PAST_TENSE_VERB[label]}`,
    detail: formatCommitSubjects(subjects, count),
  };
}

/** push/pull以外のgit操作（commit/stash/fetch）の完了をbranch peekに出すための結果。 */
export function buildActionResult(headline: string, detail = ""): RemoteResult {
  return { kind: "none", headline, detail };
}
