import { computed, reactive, ref, watch, onBeforeUnmount, type ComputedRef, type Ref } from "vue";
import { PILL_PEEK_DURATION_MS, PILL_PEEK_SUBJECT_MAX } from "../utils/constants.ts";
import { formatLatestCommitSubject, type RemoteResult } from "../utils/git-remote.ts";
import { useBusListener } from "./useBusListener.ts";
import { buildPeekText, buildPeekSignature } from "../utils/pill-peek.ts";
import {
  createTrailingPeekState,
  reduceTrailingPeek,
  reduceDevServerStop,
  startPeekSession,
  advancePeekQueue as nextPeekQueueStep,
  type PeekQueueItem,
} from "../utils/pill-peek-state.ts";
import { peekIconForKey, peekColorForKey } from "../utils/info-pills.ts";
import { statusStreamSettled } from "../utils/status-stream-sync.ts";
import { usePillPeekGitHubActivity } from "./usePillPeekGitHubActivity.ts";

// アイコン群のどれかの値が更新された時、ピル群全体を隠し、変化した対象のアイコン+情報
// テキストだけを乗せた1本の長いピル（PillPeek.vue）を数秒だけ表示するための状態機械。
// 変化検出・キュー・タイマーをここに集約し、TerminalPane はpeekingKeyを表示に使うだけにする。
export function usePillPeek({
  trailingPeekItems,
  sessionId,
  paneWorkspace,
  workspaceKey,
  prsByWorkspace,
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
  function prsResolvedFor(workspace: string | null | undefined) {
    return !!workspace && prsByWorkspace.value[workspace] !== undefined;
  }
  function actionsResolvedFor(workspace: string | null | undefined) {
    return !!workspace && runsByWorkspace.value[workspace] !== undefined;
  }
  // paneWorkspace等は非同期フェッチのためマウント直後は未解決(undefined)になりうる。
  // 一度も解決していない間は変化検出をスキップし、解決した最初の1回はベースラインの更新だけ行う
  // （reduceTrailingPeek 側で判定）。
  let trailingState = createTrailingPeekState({
    items: trailingPeekItems.value,
    workspace: workspaceKey(),
    upstreamHead: peekFields.value?.upstreamHead as string | undefined,
    workspaceResolved: paneWorkspace.value !== undefined,
    prsResolved: prsResolvedFor(workspaceKey()),
    actionsResolved: actionsResolvedFor(workspaceKey()),
  });

  // ほぼ同時に複数のピルが変化した場合、後の変化が前の変化のpeek表示を即座に上書きしない
  // よう、表示中ならキューに積んで前のpeekが閉じてから順番に表示する。表示時間は1件ずつ
  // PILL_PEEK_DURATION_MSではなく、キュー全体の合計がPILL_PEEK_DURATION_MSに収まるよう
  // 残り時間を残件数で割る。
  let peekQueue: PeekQueueItem[] = [];
  let queueSessionEndsAt = 0;

  function advancePeekQueue() {
    const step = nextPeekQueueStep(peekQueue, queueSessionEndsAt, Date.now());
    const next = step.item;
    peekQueue = step.queue;
    if (!next) {
      peekingKey.value = null;
      peekTimer = null;
      branchPushCount.value = 0;
      branchPullCount.value = 0;
      branchRemoteResult.value = null;
      noticeText.value = "";
      return;
    }
    peekingKey.value = next.key;
    branchPushCount.value = next.pushCount || 0;
    branchPullCount.value = next.pullCount || 0;
    branchRemoteResult.value = next.remote;
    noticeText.value = next.text;
    queueSessionEndsAt = step.nextSessionEndsAt;
    peekDurationMs.value = step.itemMs;
    peekTimer = setTimeout(advancePeekQueue, step.itemMs);
  }

  function triggerPeek(key: string, pushCount = 0, pullCount = 0, remote: RemoteResult | null = null, guaranteed = false, text = "") {
    peekQueue.push({ key, pushCount, pullCount, remote, guaranteed, text });
    if (!peekTimer) {
      queueSessionEndsAt = startPeekSession(remote, Date.now());
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

  const { claimCompletedRun } = usePillPeekGitHubActivity({ workspaceKey, trailingPeekItems, peekFields, triggerPeek });

  // 素のターミナルへのワークスペース/ジョブの自動紐付け。paneWorkspaceが未解決から解決に
  // 変わる同tickの変化は初回誤検知ガードで握りつぶされるため、検知イベントから直接出す。
  useBusListener("session:workspaceBound", ({ sessionId: boundId }: { sessionId?: string }) => {
    if (boundId && boundId === sessionId()) triggerPeek("workspace", 0, 0, null, true);
  });
  useBusListener("session:jobBound", ({ sessionId: boundId }: { sessionId?: string }) => {
    if (boundId && boundId === sessionId()) triggerPeek("job", 0, 0, null, true);
  });

  watch([trailingPeekItems, () => peekFields.value?.upstreamHead as string | undefined], ([items, upstreamHead]) => {
    const workspace = workspaceKey();
    const run = peekFields.value?.branchAction;
    const result = reduceTrailingPeek(trailingState, {
      items,
      workspace,
      workspaceResolved: paneWorkspace.value !== undefined,
      prsResolved: prsResolvedFor(workspace),
      actionsResolved: actionsResolvedFor(workspace),
      branch: peekFields.value?.branch,
      ahead: ahead.value,
      behind: behind.value,
      upstreamHead,
      completedActionRun: run?.status === "completed" ? { id: run.id } : null,
      canFetchSubjects: !!fetchRecentSubjects && !!workspace,
      now: Date.now(),
      lastRemoteResultAt,
      resyncing: !statusStreamSettled.value,
    });
    trailingState = result.state;
    for (const effect of result.effects) {
      if (effect.type === "peek") {
        if (effect.claimRunId !== undefined && !claimCompletedRun(effect.claimRunId)) continue;
        triggerPeek(effect.key, effect.pushCount, effect.pullCount);
        continue;
      }
      // 件名は取得でき次第detailへ反映する（取得前・失敗時は「N Pushed/Pulled」のみ）。
      const { kind, total } = effect;
      const remote = reactive<RemoteResult>({
        kind,
        headline: `${total} ${kind === "push" ? "Pushed" : "Pulled"}`,
        detail: "",
      });
      triggerPeek("branch", 0, 0, remote);
      void fetchRecentSubjects!(workspace!, Math.min(total, PILL_PEEK_SUBJECT_MAX)).then((subjects) => {
        remote.detail = formatLatestCommitSubject(subjects[0], total);
      });
    }
  }, { deep: true });

  // Dev Serverが検出されなくなった瞬間だけ知らせる。trailingPeekItemsはdevServerEntryが
  // 無い間キー自体を積まないため、findChangedTrailingItemsでは「消えたこと」を検知できない
  // （新規出現/値変化しか拾えない）。devServerEntry自体を直接見て真→偽への遷移だけを拾う。
  // status stream の切断中・再同期前に消えた場合は保留し、同期後も無ければ1回だけ出す。
  let devServerStopPending = false;
  function applyDevServerStop(event: Parameters<typeof reduceDevServerStop>[1]) {
    const result = reduceDevServerStop(devServerStopPending, event);
    devServerStopPending = result.pending;
    if (result.fire) triggerPeek("devserver-stop");
  }
  watch(devServerEntry, (entry, prevEntry) => {
    applyDevServerStop({ type: "entryChanged", present: !!entry, hadPrevious: !!prevEntry, settled: statusStreamSettled.value });
  });
  watch(statusStreamSettled, (settled) => {
    applyDevServerStop({ type: "settledChanged", settled, present: !!devServerEntry.value });
  });

  onBeforeUnmount(() => {
    if (peekTimer) {
      clearTimeout(peekTimer);
      peekTimer = null;
    }
    peekQueue = [];
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
