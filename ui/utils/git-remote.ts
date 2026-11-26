// pull/push/push-branch のラベルを過去形に統一する（branch peek の "Pushed"/"Pulled" と揃える）。
// useGitRemoteAction の PUSH_PULL_ACTIONS はこの3ラベルしか渡さない。
export type RemoteLabel = "Pull" | "Push" | "Push (set upstream)";
export type RemoteResultKind = "push" | "pull" | "none";

/** branch peekに出す pull/push 等の結果。headline は色付きの要約、detail は件名等の補足。 */
export interface RemoteResult {
  kind: RemoteResultKind;
  headline: string;
  detail: string;
}

const PAST_TENSE_VERB: Record<RemoteLabel, string> = { Pull: "Pulled", Push: "Pushed", "Push (set upstream)": "Pushed" };
// コミット0件は「実行はできたが変化なし」と伝わるよう Pulled/Pushed とは別の文言にする（新着を拾えなかった不具合と区別するため）。
const ZERO_COMMIT_TEXT: Record<RemoteLabel, string> = {
  Pull: "Already up to date",
  Push: "Nothing to push",
  "Push (set upstream)": "Nothing to push",
};

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
  const latestSubject = messages.length ? String(messages[0]).split("\n")[0] : undefined;
  return {
    kind: label === "Pull" ? "pull" : "push",
    headline: `${count} ${PAST_TENSE_VERB[label]}`,
    detail: latestSubject ?? "",
  };
}

/** push/pull以外のgit操作（commit/stash/fetch）の完了をbranch peekに出すための結果。 */
export function buildActionResult(headline: string, detail = ""): RemoteResult {
  return { kind: "none", headline, detail };
}
