import { computed, reactive, ref, watch, onBeforeUnmount, type ComputedRef, type Ref } from "vue";
import { PILL_PEEK_DURATION_MS, PILL_PEEK_REMOTE_DURATION_MS, PILL_PEEK_REMOTE_DEDUP_MS, PILL_PEEK_SUBJECT_MAX } from "../utils/constants.ts";
import { formatCommitSubjects, type RemoteResult } from "../utils/git-remote.ts";
import { useBusListener } from "./useBusListener.ts";
import {
  trailingItemsSignature,
  findChangedTrailingItems,
  buildPeekText,
  buildPeekSignature,
} from "../utils/pill-peek.ts";
import { peekIconForKey, peekColorForKey } from "../utils/info-pills.ts";
import { describeNewActivity, snapshotActivity, type ActivityItem, type ActivitySnapshot } from "../utils/github-activity.ts";

// アイコン群のどれかの値が更新された時、ピル群全体を隠し、変化した対象のアイコン+情報
// テキストだけを乗せた1本の長いピル（PillPeek.vue）を数秒だけ表示するための状態機械。
// 変化検出・キュー・タイマーをここに集約し、TerminalPane はpeekingKeyを表示に使うだけにする。
export function usePillPeek({
  trailingPeekItems,
  sessionId,
  paneWorkspace,
  workspaceKey,
  prsByWorkspace,
  issuesByWorkspace,
  runsByWorkspace,
  devServerEntry,
  ahead,
  behind,
  peekFields,
  fetchRecentSubjects,
}: {
  trailingPeekItems: ComputedRef<{ key: string, text: string }[]>,
  sessionId: () => string | null | undefined,
  paneWorkspace: ComputedRef<Record<string, any> | undefined>,
  workspaceKey: () => string | null | undefined,
  prsByWorkspace: Ref<Record<string, any[]>>,
  issuesByWorkspace: Ref<Record<string, any[]>>,
  runsByWorkspace: Ref<Record<string, any[]>>,
  devServerEntry: ComputedRef<Record<string, any> | null>,
  ahead: Ref<number>,
  behind: Ref<number>,
  peekFields: ComputedRef<Record<string, any>>,
  // HEADから新しい順に先頭count件のコミット件名を返す（失敗時は空配列）。CLI・エージェント
  // 経由のpush/pull（APIの結果が無い検出ベースのpeek）に件名を添えるために使う。
  fetchRecentSubjects?: (workspace: string, count: number) => Promise<string[]>,
}) {
  const peekingKey = ref<string | null>(null);
  // このpeekが実際に表示される時間（キューで分割された場合はPILL_PEEK_DURATION_MSより
  // 短くなる）。PillPeek.vueがマーキーの再生時間をこれに合わせるため。
  const peekDurationMs = ref(PILL_PEEK_DURATION_MS);
  let prevTrailingSignature = trailingItemsSignature(trailingPeekItems.value);
  let peekTimer: ReturnType<typeof setTimeout> | null = null;
  // branchのpeekでahead/behindが消えた瞬間、ブランチ名の横に「Pushed (N)」「Pulled (N)」を
  // 出す（0は非表示、直前のahead/behind値が実際に押し出された/取り込まれた件数）。
  const branchPushCount = ref(0);
  const branchPullCount = ref(0);
  // pull/push を実行した結果（git:remoteDone）。コミット件名を含むためahead/behindの
  // 変化検出（件数だけ）では出せない。branch peekの間だけ値を持つ。
  const branchRemoteResult = ref<RemoteResult | null>(null);
  let lastRemoteResultAt = 0;
  // peekに固有の文言（ファイル操作の完了・PR/Issueへのコメント通知）。通常のpeek文言より優先する。
  const noticeText = ref("");
  // paneWorkspace等は非同期フェッチのためマウント直後は未解決(undefined)になりうる。
  // このタイミングでprevTrailingSignatureを確定させると、情報が届いた瞬間に「新規に現れた」
  // と誤検知してpeekが一瞬表示されてしまう。一度も解決していない間は変化検出をスキップし、
  // 解決した最初の1回はベースラインの更新だけ行う。
  let workspaceEverResolved = paneWorkspace.value !== undefined;
  function prsResolvedFor(workspace: string | null | undefined) {
    return !!workspace && prsByWorkspace.value[workspace] !== undefined;
  }
  let prsEverResolved = prsResolvedFor(workspaceKey());
  function actionsResolvedFor(workspace: string | null | undefined) {
    return !!workspace && runsByWorkspace.value[workspace] !== undefined;
  }
  let actionsEverResolved = actionsResolvedFor(workspaceKey());

  // ほぼ同時に複数のピルが変化した場合、後の変化が前の変化のpeek表示を即座に上書きしない
  // よう、表示中ならキューに積んで前のpeekが閉じてから順番に表示する。表示時間は1件ずつ
  // PILL_PEEK_DURATION_MSではなく、キュー全体の合計がPILL_PEEK_DURATION_MSに収まるよう
  // 残り時間を残件数で割る。
  const peekQueue: { key: string, pushCount: number, pullCount: number, remote: RemoteResult | null, guaranteed: boolean, text: string }[] = [];
  let queueSessionEndsAt = 0;

  function advancePeekQueue() {
    const next = peekQueue.shift();
    if (!next) {
      peekingKey.value = null;
      peekTimer = null;
      return;
    }
    peekingKey.value = next.key;
    branchPushCount.value = next.pushCount || 0;
    branchPullCount.value = next.pullCount || 0;
    branchRemoteResult.value = next.remote;
    noticeText.value = next.text;
    const remainingMs = Math.max(0, queueSessionEndsAt - Date.now());
    const sharedMs = Math.max(1, Math.round(remainingMs / (peekQueue.length + 1)));
    // pull/pushの結果・ワークスペース/ジョブの検知は、先行peekで残り時間を使い切られていても
    // 一定時間は必ず表示する（共有枠に任せると1msで切り替わってしまう）。
    const guaranteedMs = next.remote ? PILL_PEEK_REMOTE_DURATION_MS : next.guaranteed ? PILL_PEEK_DURATION_MS : 0;
    const itemMs = guaranteedMs ? Math.max(sharedMs, guaranteedMs) : sharedMs;
    if (guaranteedMs) queueSessionEndsAt = Math.max(queueSessionEndsAt, Date.now() + itemMs);
    peekDurationMs.value = itemMs;
    peekTimer = setTimeout(advancePeekQueue, itemMs);
  }

  function triggerPeek(key: string, pushCount = 0, pullCount = 0, remote: RemoteResult | null = null, guaranteed = false, text = "") {
    peekQueue.push({ key, pushCount, pullCount, remote, guaranteed, text });
    if (!peekTimer) {
      queueSessionEndsAt = Date.now() + (remote ? PILL_PEEK_REMOTE_DURATION_MS : PILL_PEEK_DURATION_MS);
      advancePeekQueue();
    }
  }

  // branchピルが出ていない（Off・非gitリポジトリ）ペイン/行では何も出さない。
  useBusListener("git:remoteDone", ({ wsName, result }: { wsName?: string, result?: RemoteResult }) => {
    if (!result || wsName !== workspaceKey()) return;
    if (!trailingPeekItems.value.some((item) => item.key === "branch")) return;
    lastRemoteResultAt = Date.now();
    triggerPeek("branch", 0, 0, result);
  });

  useBusListener("files:opDone", ({ wsName, text }: { wsName?: string, text?: string }) => {
    if (!text || wsName !== workspaceKey()) return;
    if (!trailingPeekItems.value.some((item) => item.key === "files")) return;
    triggerPeek("files", 0, 0, null, true, text);
  });

  // PR/Issueへの新着コメント・レビュー。ポーリング結果の前回値との差分で検出する。
  // 前回値が無い（初回取得・ワークスペース変更直後）時は基準値の記録だけ行う。
  function watchGitHubActivity(
    source: Ref<Record<string, any[]>>,
    key: "prs" | "issues",
    isTarget: (item: ActivityItem) => boolean,
  ) {
    let baseline: { workspace: string, snapshot: ActivitySnapshot } | null = null;
    watch(() => source.value[workspaceKey() || ""], (items) => {
      const workspace = workspaceKey();
      if (!workspace || !items) return;
      const prev = baseline?.workspace === workspace ? baseline.snapshot : null;
      baseline = { workspace, snapshot: snapshotActivity(items) };
      if (!prev || !trailingPeekItems.value.some((item) => item.key === key)) return;
      for (const text of describeNewActivity(prev, items.filter(isTarget))) {
        triggerPeek(key, 0, 0, null, true, text);
      }
    });
  }
  // PRピルは現在ブランチのPRだけを指すため、通知もそのPRに揃える。
  watchGitHubActivity(prsByWorkspace, "prs", (item) => item.number === peekFields.value?.branchPR?.number);
  watchGitHubActivity(issuesByWorkspace, "issues", () => true);

  // 素のターミナルへのワークスペース/ジョブの自動紐付け。paneWorkspaceが未解決から解決に
  // 変わる同tickの変化は初回誤検知ガードで握りつぶされるため、検知イベントから直接出す。
  useBusListener("session:workspaceBound", ({ sessionId: boundId }: { sessionId?: string }) => {
    if (boundId && boundId === sessionId()) triggerPeek("workspace", 0, 0, null, true);
  });
  useBusListener("session:jobBound", ({ sessionId: boundId }: { sessionId?: string }) => {
    if (boundId && boundId === sessionId()) triggerPeek("job", 0, 0, null, true);
  });

  // 初回解決キーのベースラインを次シグネチャの値へ揃える（変化扱いにしない）。
  function carryBaseline(key: string, nextSignature: Map<string, string>) {
    const value = nextSignature.get(key);
    if (value === undefined) prevTrailingSignature.delete(key);
    else prevTrailingSignature.set(key, value);
  }

  let prevUpstreamHead = peekFields.value?.upstreamHead as string | undefined;
  watch([trailingPeekItems, () => peekFields.value?.upstreamHead as string | undefined], ([items, upstreamHead]) => {
    const nextSignature = trailingItemsSignature(items);
    const prsJustResolved = !prsEverResolved && prsResolvedFor(workspaceKey());
    if (prsJustResolved) {
      prsEverResolved = true;
      carryBaseline("prs", nextSignature);
    }
    const actionsJustResolved = !actionsEverResolved && actionsResolvedFor(workspaceKey());
    if (actionsJustResolved) {
      actionsEverResolved = true;
      carryBaseline("actions", nextSignature);
    }
    const justResolved = !workspaceEverResolved && paneWorkspace.value !== undefined;
    if (justResolved) workspaceEverResolved = true;
    if (workspaceEverResolved && !justResolved) {
      for (const changed of findChangedTrailingItems(items, prevTrailingSignature)) {
        let pushCount = 0;
        let pullCount = 0;
        if (changed.key === "branch") {
          // 直前のシグネチャ（branch:ahead:behind）と比べahead/behindが>0から0へ
          // 変わった＝push/pull完了の瞬間。直前の値がそのまま送信/取得されたコミット数になる。
          // ブランチ名が変わっている場合はブランチ切替（別ブランチのahead/behindを見ている
          // だけ）であってpush/pull完了ではないため対象外にする。
          const [prevBranch, prevAheadStr, prevBehindStr] = (prevTrailingSignature.get("branch") || "").split(":");
          const prevAhead = Number(prevAheadStr) || 0;
          const prevBehind = Number(prevBehindStr) || 0;
          // pushはリモート追跡ref（upstream）を動かす（force pushも同じ）。resetはローカルの
          // ブランチだけを動かすため、upstreamが動かないままaheadが0になったら「Pushed」にしない。
          const upstreamMoved = prevUpstreamHead !== upstreamHead;
          if (prevBranch === peekFields.value?.branch) {
            if (prevAhead > 0 && ahead.value === 0 && upstreamMoved) pushCount = prevAhead;
            if (prevBehind > 0 && behind.value === 0) pullCount = prevBehind;
          }
        }
        // 直前にgit:remoteDoneで同じ結果を出している時は、ahead/behindが0に落ちたことの
        // 検出による「N Pushed/Pulled」を重ねて出さない。
        const coveredByRemoteResult = (pushCount > 0 || pullCount > 0)
          && Date.now() - lastRemoteResultAt < PILL_PEEK_REMOTE_DEDUP_MS;
        if (coveredByRemoteResult) continue;
        const workspace = workspaceKey();
        const exactlyOneDirection = (pushCount > 0) !== (pullCount > 0);
        if (changed.key === "branch" && exactlyOneDirection && fetchRecentSubjects && workspace) {
          // 件名は取得でき次第detailへ反映する（取得前・失敗時は「N Pushed/Pulled」のみ）。
          const total = pushCount || pullCount;
          const remote = reactive<RemoteResult>({
            kind: pushCount > 0 ? "push" : "pull",
            headline: `${total} ${pushCount > 0 ? "Pushed" : "Pulled"}`,
            detail: "",
          });
          triggerPeek("branch", 0, 0, remote);
          void fetchRecentSubjects(workspace, Math.min(total, PILL_PEEK_SUBJECT_MAX)).then((subjects) => {
            remote.detail = formatCommitSubjects(subjects, total);
          });
          continue;
        }
        triggerPeek(changed.key, pushCount, pullCount);
      }
    }
    prevTrailingSignature = nextSignature;
    prevUpstreamHead = upstreamHead;
  }, { deep: true });

  // Dev Serverが検出されなくなった瞬間だけ知らせる。trailingPeekItemsはdevServerEntryが
  // 無い間キー自体を積まないため、findChangedTrailingItemsでは「消えたこと」を検知できない
  // （新規出現/値変化しか拾えない）。devServerEntry自体を直接見て真→偽への遷移だけを拾う。
  watch(devServerEntry, (entry, prevEntry) => {
    if (!entry && prevEntry) triggerPeek("devserver-stop");
  });

  onBeforeUnmount(() => {
    if (peekTimer) {
      clearTimeout(peekTimer);
      peekTimer = null;
    }
    peekQueue.length = 0;
  });

  // peekピルの表示に使う派生値もここで返す（TerminalPane / SessionSidebarRow で共有）。
  const peekIconClass = computed(() => peekIconForKey(peekingKey.value));
  const peekColorClass = computed(() => peekColorForKey(peekingKey.value, peekFields.value));
  const peekText = computed(() => noticeText.value || buildPeekText(peekingKey.value, peekFields.value));
  // 結果の文言はマーキー再測定のトリガー（PillPeek.vueのsignature watch）にも
  // 反映する。同じbranchキーのまま内容だけ差し替わるとDOMが再マウントされないため。
  const peekSignature = computed(() => {
    const base = buildPeekSignature(peekingKey.value, peekFields.value);
    const remote = branchRemoteResult.value;
    if (remote) return `${base}:${remote.headline}:${remote.detail}`;
    return noticeText.value ? `${base}:${noticeText.value}` : base;
  });
  // actionsは名前部分（白固定）とステータス部分（実行中/失敗で色分け）を別spanに分けて
  // 表示するため、PillPeek.vueへ個別に渡す。
  const peekActionName = computed(() => peekFields.value?.branchAction?.name || "");
  const peekActionStatusText = computed(() => {
    const run = peekFields.value?.branchAction;
    return run ? (run.conclusion || run.status) : "";
  });

  return {
    peekingKey,
    peekDurationMs,
    branchPushCount,
    branchPullCount,
    branchRemoteResult,
    peekIconClass,
    peekColorClass,
    peekText,
    peekSignature,
    peekActionName,
    peekActionStatusText,
  };
}
