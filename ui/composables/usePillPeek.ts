import { computed, ref, watch, onBeforeUnmount, type ComputedRef, type Ref } from "vue";
import { PILL_PEEK_DURATION_MS } from "../utils/constants.ts";
import {
  trailingItemsSignature,
  findChangedTrailingItems,
  buildPeekText,
  buildPeekSignature,
} from "../utils/pill-peek.ts";
import { peekIconForKey, peekColorForKey } from "../utils/info-pills.ts";

// アイコン群のどれかの値が更新された時、ピル群全体を隠し、変化した対象のアイコン+情報
// テキストだけを乗せた1本の長いピル（PillPeek.vue）を数秒だけ表示するための状態機械。
// 変化検出・キュー・タイマーをここに集約し、TerminalPane はpeekingKeyを表示に使うだけにする。
export function usePillPeek({
  trailingPeekItems,
  paneWorkspace,
  workspaceKey,
  prsByWorkspace,
  runsByWorkspace,
  devServerEntry,
  ahead,
  behind,
  peekFields,
}: {
  trailingPeekItems: ComputedRef<{ key: string, text: string }[]>,
  paneWorkspace: ComputedRef<Record<string, any> | undefined>,
  workspaceKey: () => string | null | undefined,
  prsByWorkspace: Ref<Record<string, any[]>>,
  runsByWorkspace: Ref<Record<string, any[]>>,
  devServerEntry: ComputedRef<Record<string, any> | null>,
  ahead: Ref<number>,
  behind: Ref<number>,
  peekFields: ComputedRef<Record<string, any>>,
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
  const peekQueue: { key: string, pushCount: number, pullCount: number }[] = [];
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
    const remainingMs = Math.max(0, queueSessionEndsAt - Date.now());
    const itemMs = Math.max(1, Math.round(remainingMs / (peekQueue.length + 1)));
    peekDurationMs.value = itemMs;
    peekTimer = setTimeout(advancePeekQueue, itemMs);
  }

  function triggerPeek(key: string, pushCount = 0, pullCount = 0) {
    peekQueue.push({ key, pushCount, pullCount });
    if (!peekTimer) {
      queueSessionEndsAt = Date.now() + PILL_PEEK_DURATION_MS;
      advancePeekQueue();
    }
  }

  // 初回解決キーのベースラインを次シグネチャの値へ揃える（変化扱いにしない）。
  function carryBaseline(key: string, nextSignature: Map<string, string>) {
    const value = nextSignature.get(key);
    if (value === undefined) prevTrailingSignature.delete(key);
    else prevTrailingSignature.set(key, value);
  }

  watch(trailingPeekItems, (items) => {
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
          const [, prevAheadStr, prevBehindStr] = (prevTrailingSignature.get("branch") || "").split(":");
          const prevAhead = Number(prevAheadStr) || 0;
          const prevBehind = Number(prevBehindStr) || 0;
          if (prevAhead > 0 && ahead.value === 0) pushCount = prevAhead;
          if (prevBehind > 0 && behind.value === 0) pullCount = prevBehind;
        }
        triggerPeek(changed.key, pushCount, pullCount);
      }
    }
    prevTrailingSignature = nextSignature;
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
  const peekText = computed(() => buildPeekText(peekingKey.value, peekFields.value));
  const peekSignature = computed(() => buildPeekSignature(peekingKey.value, peekFields.value));
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
    peekIconClass,
    peekColorClass,
    peekText,
    peekSignature,
    peekActionName,
    peekActionStatusText,
  };
}
